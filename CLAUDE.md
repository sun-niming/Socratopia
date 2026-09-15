# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A **packaged Windows build artifact** of Socratopia (Electron + Next.js Socratic-tutoring app). There is no source tree and no build pipeline: everything under `resources/server/.next/` is compiled webpack output and root `main.js` is esbuild output. Edits are surgical patches to generated code, validated with `node --check`/acorn plus a co-located smoke test.

Hand-written files that are safe to edit as ordinary source: **`resources/server/server.js`** and everything under **`resources/server/lib/`**.

- Source repo (macOS): `socralab-app/v2`
- Sibling working copy: `E:\huanjing\sogeladi\Socratopia_2.0\Socratopia` — diff against it before editing unfamiliar code
- `AGENTS.md` covers the same ground for other agents

## Architecture

### Three layers, three different edit/restart rules

1. **Electron main** — `dist-electron/main.js` + `preload.js` inside `resources/app.asar`. Spawns the server, owns native APIs (API keys, PDF export, device id), exposes them as `window.electronAPI`. Root `main.js`/`preload.js` are the working copies of the same files (see "two copies" below).
2. **Next.js server** — `resources/server/server.js`, forked as a child process on `127.0.0.1:<dynamic port>` with `cwd = resources/server/`.
3. **React frontend** — compiled bundles in `resources/server/.next/static/chunks/`, rendered in a BrowserWindow.

### Two copies of the runtime

The repo root is the live runtime — you edit and launch it (`./Socratopia.exe`). `win-unpacked/` is a **committed snapshot of a clean release** with the same layout, refreshed by hand. Its `Socratopia.exe` + `resources/app.asar` are a self-consistent pair, but nothing auto-syncs it — until someone re-stages it, it silently lags the root by however many commits have landed since.

- `tools/stage-clean-win-release.js` copies an allowlisted tree **one-way, root → destination**: `node tools/stage-clean-win-release.js stage [source] [destination]` (default destination `<source>/release/win-unpacked`; destination basename must be `win-unpacked`). `verify` mode and `tools/verify-clean-win-release.js <target>` re-check a staged tree.
- `release/` is gitignored. If you change root `main.js`/`preload.js`, note they are **not** in the staging allowlist — they ship inside `app.asar` only.

To refresh the committed snapshot, stage first and then mirror. Passing `win-unpacked` as the destination directly is refused (`source must not be inside destination`):

```bash
node tools/stage-clean-win-release.js stage . release/win-unpacked
rm -rf win-unpacked && cp -r release/win-unpacked win-unpacked
cp resources/settings.json resources/set.json win-unpacked/resources/   # required, see below
```

- **`win-unpacked/resources/settings.json` and `set.json` must be copied back by hand.** Staging skips them on purpose (`forbiddenReleasePath`), so a staged tree carries no live API key — but the packaged server reads `CONTENT_ROOT/../settings.json`, and a strict mirror makes the snapshot log `Could not load … using defaults` and run with no provider key. Verification uses the looser `forbiddenStagedPath`, which tolerates exactly those two paths and still rejects everything else.

### The global-injection contract

`server.js` loads config and modules onto `global.*` before Next starts; compiled bundles that cannot `require()` a module read it from there instead. The module table is `server.js:881-900` (via `__loadOptionalGlobal__`), plus the config blocks at the top of the file and `__SOCRATOPIA_ROUTE_AUTH__` / `__SOCRATOPIA_REQUEST_AUTH__` / `__SOCRATOPIA_ACCOUNT_REQUEST_CONTEXT__` around `server.js:905-930`.

| Global | Source |
|---|---|
| `__SOCRATOPIA_SETTINGS__` | `resources/settings.json` (endpoint, apiKeys) |
| `__SOCRATOPIA_SET__` | `resources/set.json` — role→model: `strong`, `weak`, `kb`, `premium`, `vision`, `ocrVision` |
| `__FS__`, `__PATH__`, `__RULES_DIR__` | `require("fs")`/`require("path")` handles and `resources/rules/` |
| `__SOCRATOPIA_ROUTE_AUTH__`, `__SOCRATOPIA_REQUEST_AUTH__`, `__SOCRATOPIA_ACCOUNT_REQUEST_CONTEXT__` | `lib/route-auth.js`, `lib/local-request-auth.js`, `lib/account-request-context.js` |
| `__MODEL_ROUTER__`, `__ADAPTIVE_TEACHING_RUNTIME__`, `__ADAPTIVE__`, `__ADAPTIVE_CONCEPT_GRAPH__`, `__ADAPTIVE_DIAGNOSTICIAN__`, `__PRACTICE__`, `__PRACTICE_SOURCE__`, `__PRACTICE_TUTOR__`, `__RESUME__`, `__MD_CURSOR__`, `__PROGRESS_GUARD__`, `__CLASSROOM_TASK__`, `__EXERCISE_CONTEXT__`, `__KB_PROGRESS__`, `__LONG_REASONING__`, `__KNOWLEDGE_SOURCE__`, `__CLOSE_READING__`, `__VOICE_CATALOG__`, `__VOICE_EMOTION__` | matching `lib/` subsystem (all in the `server.js` table) |
| `__KB_DISTILL__` / `__KB_DISTILL_PREFETCH__`, `__KB_BUILDER_COORDINATOR__`, `__AUTO_ADVANCE__`, `__COMPANION_CONTINUITY__`, `__PDF_OCR_COORDINATOR__`, `__OCR_VISION_BUDGET__` | installed inline by the corresponding installer block in `server.js` |
| `global.fetch` | patched by `lib/responses-api-compat.js` |

To add a module compiled code needs, add a row to that `server.js` table (or another `global.x =` installer) — a chunk cannot reach it otherwise.

### Runtime paths

- **Packaged:** `PROJECT_ROOT = %APPDATA%/socratopia/project-data`, `CONTENT_ROOT = resources/bundled-content`, `NODE_PATH = resources/server/.next/node_modules`. The server runs **in place** from `process.resourcesPath/server`; server changes need only an app restart.
- **Dev** (`app.isPackaged === false`): both roots resolve to the repo root and `main.js` skips launching the server entirely.
- The listen port is **dynamic** (chosen by main, `PORT` env, default 3000 otherwise); main publishes it to `<userData>/.server-port` and a PID to `.server-pid`, and binds `HOSTNAME=127.0.0.1` on purpose (avoids the IPv6 `::1` race). Don't assume port 3000.
- User data is account-scoped: `PROJECT_ROOT/accounts/<accountId>/profiles/<pid>/worlds/<wid>/{story.md,npc_*.md,textbooks/,chats/,diary/,practice/,lesson_summaries/}`; adaptive state lives in `PROJECT_ROOT/adaptive-teaching/`.
- `resources/bundled-content/{zh,en,zh-TW}/initial_world/` is read-only seed content (world presets, candidate avatars), never user data. `resources/rules/*.md` are classroom prompt rules consumed only by the `/api/chat` route.

### Auth model

Every API route except `/api/account/init` (`lib/route-auth.js:9`) requires a short-lived capability token (`Authorization: Socratopia <jwt>`) minted by Electron main via `adaptive:getCapability` and verified by `lib/local-request-auth.js`. The verified account id travels in AsyncLocalStorage via `lib/account-request-context.js`. The token is installed before Next starts so a request can never race a lazy route import and fall back to `X-Account-Id`. Raw `X-Account-Id` headers, query params, and body account ids are rejected with 403 by design — do not add fallbacks to them.

### LLM layer

`lib/model-router.js` resolves a task to a tier (`weak`/`kb`/`strong`/`premium`), defaults to the mini model, and escalates to premium at most once on *content* failures (bad JSON, schema gaps) — never on auth/quota/429/network errors. `lib/responses-api-compat.js` monkey-patches global fetch to rewrite `/chat/completions` → `/responses` for models that require the Responses API.

## Critical constraints

- **No `require("fs")` inside `.next/server/chunks/*.js`** — webpack cannot resolve it there. Use `global.__FS__`. Route files (`app/api/*/route.js`) *may* use `require("fs")`.
- **Module `64092`** (LLM core: `mx` / `callLLM` / `$b`) has duplicate *definers* across 6 files — chunks `1576.js` and `4092.js`, plus routes `chat`, `concept-summary`, `flashcard`, `companion/reconcile-persona`, `custom-companions/merge-persona`. Changing LLM core behavior means editing every definer or the app diverges by route.
- **String escaping in minified bundles**: inside a long JS string literal, escape `'` → `\'`, `"` → `\"`, backtick → `` \` ``, and `${` → `\${`. A missed escape throws a syntax error far from the edit — locate it with acorn, not `node --check` output.
- **Keep the three route manifests consistent** when adding/removing routes: `.next/app-path-routes-manifest.json`, `.next/routes-manifest.json`, `.next/server/app-paths-manifest.json`.
- **`resources/server/release-runtime-manifest.json` is hash-pinned twice.** `main.js:35347` holds `RUNTIME_MANIFEST_SHA256`, checked on every launch; the manifest itself pins `deps.zip` plus every file under `.next/node_modules` (2677) and `lib/ocr/rapidocr-v5` (9). So: editing `lib/*.js` or `.next/**` is free, but touching rapidocr models, `.next/node_modules`, or `deps.zip` requires `node tools/generate-release-runtime-manifest.js` **and** pasting the new file hash into that `main.js` constant — the generator does not update it.
- **ASAR integrity is an EXE-embedded hash.** `Socratopia.exe` carries an `ELECTRONASAR` resource containing `sha256(asar header JSON)`. Repacking `resources/app.asar` without re-patching it bricks launch.

## Commands

| Action | Command |
|---|---|
| Syntax check | `node --check <file>` |
| Precise syntax error location | `node -e "require('acorn').parse(require('fs').readFileSync('<file>','utf8'),{ecmaVersion:2022})"` |
| Run one smoke test | `node <path-to-smoke-test.js>` |
| Run all smoke tests | `node tools/run-smoke-matrix.js` (add `--json <out>` for a report) |
| Extract ASAR | `npx asar extract resources/app.asar _asar_extracted/` |
| Repack ASAR | `npx asar pack _asar_extracted/ resources/app.asar` |
| Re-embed EXE integrity hash after repack | `node tools/patch-asar-integrity.js` (add `--check` to verify only) |
| Stage a clean release tree | `node tools/stage-clean-win-release.js stage [src] [dst]` |
| Regenerate runtime manifest | `node tools/generate-release-runtime-manifest.js` |
| Launch app | `./Socratopia.exe` |

### Electron-layer change workflow

Root `main.js` is the working copy of the file that ships as `dist-electron/main.js` inside `app.asar`. The two are kept in sync by copying, never by re-typing — `electron-adaptive-capability-smoke-test.js` compares them byte-for-byte: 

```bash
# close the app first - a running Socratopia.exe is file-locked
npx asar extract resources/app.asar _asar_extracted/   # skip if already fresh
cp main.js _asar_extracted/dist-electron/main.js       # after editing root main.js
npx asar pack _asar_extracted/ resources/app.asar
```

Then re-embed the integrity hash — the old `fix-asar-integrity.js` was replaced by `tools/patch-asar-integrity.js`, which recomputes `sha256(asar header JSON)` and rewrites the EXE's `ELECTRONASAR` value in place:

```bash
node tools/patch-asar-integrity.js                     # defaults to Socratopia.exe + resources/app.asar
node tools/patch-asar-integrity.js --check             # verify only, exit 1 when out of sync
node tools/patch-asar-integrity.js <exe> <asar>        # e.g. the win-unpacked pair
```

Two traps it handles that a naive script gets wrong: the `ELECTRONASAR` resource *name* is UTF-16LE while its payload JSON is plain ASCII, and other embedded resources also contain `"value":"` — patch only the entry following this marker. `--check` reads the EXE, so it works even while the app is running; writing does not.

## Edit targets

| Change | Edit | Then |
|---|---|---|
| API route logic | `resources/server/.next/server/app/api/*/route.js` | `node --check`; sync the 3 manifests if the route set changed |
| Shared server logic | `resources/server/lib/*.js` (hand-written) or `.next/server/chunks/*.js` | no `require("fs")` in chunks |
| React frontend | `resources/server/.next/static/chunks/**/*.js` | `node --check` |
| Electron main/preload | root `main.js`/`preload.js` | repack ASAR + re-patch `ELECTRONASAR` (above) |

Server-layer edits need only an app restart; the ASAR is the runtime source for the Electron layer only.

## Smoke tests

`*-smoke-test.js` files sit beside the module they cover and run standalone (`node <path>`): no app, no network, no real API keys. The total drifts constantly as modules are added — re-derive it, don't trust a number in here.

- **`tools/run-smoke-matrix.js` only walks `resources/server/` minus `node_modules` and `.next`**, so it reaches about four fifths of them (126 of 158, with 124 actually executed: `pdf-cmap-real` / `pdf-render-real` are auto-skipped because they need fixtures — exit code 2 means skipped and the matrix normalizes it to PASS, capping each test at 120s). The blind spots are structural and few:
  - **under `.next/` (26 today)** — run by hand, e.g. `node resources/server/.next/server/app/api/chat/chat-end-class-integration-smoke-test.js` after touching `chat/route.js`.
  - **under `tools/` (5 today)** — `node tools/<name>-smoke-test.js`.

  So a clean matrix run is not proof your module is covered: check whether the thing you touched has a test inside one of those two trees.
- `resources/server/smoke-test-utils.js` supplies shared HTTP + `MockLLM` helpers; several tests boot a real server against a mock provider.
- **Two tests fail on environment drift, not logic** — check them first when they break out of nowhere:
  - `electron-adaptive-capability-smoke-test.js` asserts root `main.js` and `_asar_extracted/dist-electron/main.js` are byte-identical. Pure CRLF-vs-LF drift fails it (git has `core.autocrlf=true`), and the diff reads like an "adaptive protocol block" divergence. Copy the file, never re-type it — then re-run the repack workflow above.
  - `staged-ws-runtime-smoke-test.js` needs a *complete* staged release at `release/win-unpacked`; if `release/` is stale or absent, run the staging command first, or point it at the committed snapshot: `node resources/server/lib/staged-ws-runtime-smoke-test.js win-unpacked`.
- After any change: run the smoke test for the touched module plus `node --check` on every edited file.

## Never commit

`resources/settings.json` and `resources/set.json` (API keys, teaching-model config), `resources/app.asar`, `resources/rules/*` (except `rules_zh_classroom_compact.md`), `resources/bundled-content/`, or user data. See `.gitignore`.

Caveat: those ignore rules are anchored to the repo root, so the snapshot's own copies under `win-unpacked/resources/` **are** tracked — including a `settings.json` with a live API key (see the release section above). This repo currently has no git remote, so nothing has been published; scrub that key before adding one.

## Working conventions

- Put scratch work in `tmp/` or `outputs/` — both gitignored.
- Match surrounding bundled style (CommonJS, 2-space indent); never reformat generated files.
- Name new tests `<module>-smoke-test.js` beside the module.
- Commit subjects: concise imperative describing shipped behavior (e.g. "Preserve reading projections across conversation transitions").
- Repo docs are a mix of Chinese and English. Ship-behavior detail lives in `TTS_OPTIMIZATION_CHANGELOG.md`, `PRACTICE_FEATURE_TECHNICAL_PLAN_AND_CLAUDE_PROMPTS.md`, `ADAPTIVE_TEACHING_MODE_TECHNICAL_REPORT.md`, and `MATH_SPEECH_CORE_DEVELOPMENT_SPEC.md`.
- `resources/server/package.json` and its `scripts/` are inherited from the source repo and are **not** runnable here (no `scripts/` dir); treat it as a dependency list, not a build config.
