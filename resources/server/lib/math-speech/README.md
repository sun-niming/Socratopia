# Offline Math Speech Core

This directory implements the currently closed mathematics-speech phase for
Socratopia. It is a server-side, side-effect-free CommonJS module and is not
connected to React, the TTS queue, audio storage, IndexedDB, Electron, or any
UI action.

## Pipeline

`prepareMathSpeech(input)` uses the following fixed pipeline:

1. Validate and clone the caller-owned input and apply bounded limits.
2. Render LaTeX through the installed KaTeX `renderToString` MathML output
   with `throwOnError: true`, `trust: false`, `strict: "warn"`, and
   `maxExpand: 1000`. A caller may also provide a MathML string directly.
3. Parse the controlled MathML tree with a strict local reader. External
   entities and declarations are rejected; no XML or network service is used.
4. Convert presentation MathML to a normalized AST and retain compact source
   tag/attribute information for diagnostics.
5. Normalize number fragments, unary/binary operators, fences, function calls,
   large-operator bounds, differentials, matrices, piecewise tables, and
   common accents.
6. Resolve only evidence-backed symbol facts. Critical unresolved meanings
   use structural speech and are recorded in `decision.unresolvedAmbiguities`.
   In particular, `P(A|B)` requires an explicit probability fact, an explicit
   MathML/input intent, or the unambiguous `\\Pr` command.
7. Render deterministic Chinese speech, enforce output safety, deep-clone the
   result, and freeze it before returning.

## Dependency decision

No package was added. The server already contains KaTeX and no existing direct
dependency provides a declared, stable XML DOM contract needed by this phase.
The parser therefore accepts only the bounded MathML subset emitted by KaTeX
or explicitly supplied as MathML; it rejects declarations, external entities,
unsupported nodes, and malformed nesting. This keeps the runtime offline and
does not add a frontend dependency or require a runtime-manifest change.

## Public contract

```js
const { prepareMathSpeech } = require("./index");

const result = prepareMathSpeech({
  latex: "\\sum_{i=1}^{n} a_i",
  locale: "zh-Hans",
  style: "concise",
  context: { symbolFacts: {} },
});
```

Successful results contain `ok`, `version`, `locale`, `source`, `ast`, a
sealed `decision`, string `speech`, and diagnostics. Unsupported or dangerous
input returns `ok: false`, `decision.mode: "skip"`, `speech: ""`, and a stable
diagnostic code/reason. Neither path throws an exception for malformed user
expressions.

## Stable ambiguity policy

The core does not guess meanings for vertical bars, intervals/tuples,
implicit products, inverse powers, set subtraction, or standalone
differentials. Explicit facts with `evidence: "explicit"` may make a result
more specific on a future call; they never mutate a previously returned frozen
result. Domain hints alone do not eliminate a critical ambiguity.

## Limits

The defaults are 4096 input characters, AST depth 64, 2000 AST nodes, 1200
speech characters, 64×64 table dimensions, and at most 9 matrix cells read
individually. Matrices above 3×3 are represented by dimensions only. Parse
errors, unknown MathML nodes, unsafe controls, unclosed structures, and
unbounded output are skipped safely.

## Local verification

The co-located scripts are dependency-free apart from the existing KaTeX
runtime and do not require a running app or network:

```text
node math-speech-smoke-test.js
node math-speech-corpus-test.js
node math-speech-number-test.js
node math-speech-ambiguity-test.js
node math-speech-malformed-test.js
node math-speech-determinism-test.js
node math-speech-lexicon-test.js
node math-speech-ast-test.js
node math-speech-remediation-test.js
node math-speech-independent-remediation-test.js
node math-speech-manual-audit.js
node math-speech-benchmark.js
```

The `corpus/` directory contains 276 frozen cases across the eight required
categories, with no duplicate normalized expressions and with detailed-mode
coverage. The remediation suite adds 90 independent black-box combinations,
including scientific notation, missing differentials, logical negation,
scope conflicts, control characters, malicious accessors, and benchmark
fault validity. The frontend admission state remains `CLOSED`; no regeneration
of speech or historical audio is implemented here.
