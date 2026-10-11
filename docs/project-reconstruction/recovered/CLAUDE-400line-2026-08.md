# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository nature

This is the **packaged Windows build artifact** of the Socratopia Electron desktop app, not the source repository. TypeScript/React source is compiled by Next.js and bundled by esbuild/electron-builder. All edits must be made directly to the compiled artifacts; there is no build step that regenerates bundles from source.

Source repository reference: `socralab-app/v2` (macOS build machine path: `/Users/leminwu/Documents/Github/socralab-app/v2`).
Sibling working copy: `E:\huanjing\sogeladi\Socratopia_2.0\Socratopia` (contains additional changes that can be used for comparison). When investigating a bug or an intended behavior, diff corresponding files against the sibling copy before editing.

## What to edit for each kind of change

| If you need to change... | Edit these files | Restart needed | Extra steps |
|---|---|---|---|
| API route logic (chat, profile, custom-companions, etc.) | `resources/server/.next/server/app/api/*/route.js` | Yes, `./Socratopia.exe` | Run `node --check` on edited files. Include `*-manifest.json` if distributing a patch. |
| Shared server logic (LLM calls, file I/O, data access) | `resources/server/.next/server/chunks/*.js` | Yes | Run `node --check`. Avoid `require("fs")`; use `global.__FS__`. |
| React frontend behavior | `resources/server/.next/static/chunks/**/*.js` | Yes | Run `node --check`. |
| Electron main process (storage, PDF, window, IPC) | Root `main.js` **and** `_asar_extracted/dist-electron/main.js` | Yes | Repack ASAR + run `node fix-asar-integrity.js`. |
| Preload bridge (`window.electronAPI`) | Root `preload.js` **and** `_asar_extracted/dist-electron/preload.js` | Yes | Repack ASAR + run `node fix-asar-integrity.js`. |
| API endpoints / model mapping | Synchronize module **64092** across all 8 locations (see below). | Yes | Run `node --check` on every changed file. |

For server/route changes, editing `resources/server/` is enough because `main.js` copies that tree to `%APPDATA%/socratopia/server/` on every launch. For Electron changes, the runtime reads from `resources/app.asar`, so the root copies are only convenient working copies until repacked.

## Available commands

There is no root build pipeline. The root `package.json` only declares `acorn` for syntax checking; run `npm install` once if `node_modules/acorn` is missing.

| Command | Purpose |
|---------|---------|
| `npm install` | Install root dev dependency (`acorn`) for precise syntax error location |
| `./Socratopia.exe` | Launch the packaged desktop app |
| `node --check <file>` | Validate JS syntax after editing a bundle |
| `node -e "const acorn=require('acorn'); acorn.parse(require('fs').readFileSync('<file>','utf-8'),{ecmaVersion:2022})"` | Locate syntax errors precisely in long minified lines |
| `npx asar extract resources/app.asar _asar_extracted/` | Extract ASAR to edit `main.js` / `preload.js` |
| `npx asar pack _asar_extracted/ resources/app.asar` | Repack ASAR after edits |
| `node fix-asar-integrity.js` | Recalculate and patch the `ELECTRONASAR` hash in `Socratopia.exe` after repacking |
| `node tools/new-route.js <name> [--methods GET,POST] [--dry-run]` | Scaffold a new API route: allocates collision-free module IDs, writes `route.js`, registers in manifests, runs `node --check` |

## Smoke tests

Most server helpers have a co-located smoke test. Each is self-contained, sets a temporary `PROJECT_ROOT`, and requires no running app, LLM, webpack, or Next.js. Run a single test with `node <path>`:

| Test file | Command |
|-----------|---------|
| Adaptive data layer (69 assertions) | `node resources/server/lib/adaptive/smoke-test.js` |
| Concept graph builder (144 assertions) | `node resources/server/lib/adaptive/concept-graph-smoke-test.js` |
| Diagnostician (83 assertions) | `node resources/server/lib/adaptive/diagnostician-smoke-test.js` |
| Practice data layer (56 assertions) | `node resources/server/lib/practice/smoke-test.js` |
| Practice source adapter (43 assertions) | `node resources/server/lib/practice/source-adapter-smoke-test.js` |
| Tutoring session layer (46 assertions) | `node resources/server/lib/practice/tutoring-session-smoke-test.js` |
| Resume/progress helper (37 assertions) | `node resources/server/lib/resume/smoke-test.js` |
| Long-context reasoning (36 assertions) | `node resources/server/lib/reasoning/long-context-smoke-test.js` |
| Model router (95 assertions) | `node resources/server/lib/model-router-smoke-test.js` |

Live runtime E2E for the practice endpoint: `node resources/server/lib/practice/runtime-e2e-smoke.js`. Requires a running `./Socratopia.exe`; set `PRACTICE_E2E_BASE_URL`, `PRACTICE_E2E_PROFILE_ID`, `PRACTICE_E2E_WORLD_ID`, `PRACTICE_E2E_ACCOUNT_ID`, and `PRACTICE_E2E_TEXTBOOK_ID` to override auto-detection.

After any code change, also run `node --check` on every edited `.js` bundle.

## High-level architecture

Socratopia is an Electron + Next.js standalone app with three layers:

1. **Electron main process** (`main.js` inside `resources/app.asar`) — starts the Next.js server, manages native APIs (storage, PDF export, auto-updater stub, device ID), and renders the browser window.
2. **Next.js standalone server** (`resources/server/`) — forked as a Node child process on a local port (default 3000). Serves the React frontend and API routes.
3. **React frontend** — rendered inside the Electron window, communicating with the main process via `preload.js` IPC bridge.

### Startup flow

- `main.js` calls `prepareServerDir()` to copy `resources/server/` to `%APPDATA%/socratopia/server/`.
- It then forks `server.js` (in the copied directory) with `NODE_PATH` set to `.next/node_modules`.
- `server.js` boots Next.js standalone mode using a hardcoded `nextConfig` (output from `next.config.ts`).
- The main process probes the server port, then loads `http://localhost:<port>` in a `BrowserWindow`.

### IPC bridge (`preload.js`)

`window.electronAPI` exposes these APIs to the renderer:
- `getApiKey` / `setApiKey` — API key management via `electron-store`
- `getSessionToken` / `setSessionToken` — session token management via `safeStorage`
- `exportPdf` — HTML to PDF export
- `openSocratopia` — open user data file (path validated in main process)
- `getDeviceId` / `getDeviceInfo` — device fingerprinting
- `checkForUpdate` / `downloadUpdate` / `installUpdate` / `onUpdateStatus` — auto updater stubs (disabled)

## Key files

| File | Purpose |
|------|---------|
| `resources/app.asar` | Electron ASAR archive containing `dist-electron/main.js` and `dist-electron/preload.js` |
| `resources/server/server.js` | Next.js standalone bootstrap; loads `settings.json` + `set.json`, sets globals (`__FS__`, `__PATH__`, `__RULES_DIR__`, `__SOCRATOPIA_SETTINGS__`, `__SOCRATOPIA_SET__`, `__KB_DISTILL__`, `__ADAPTIVE__`, `__ADAPTIVE_CONCEPT_GRAPH__`, `__ADAPTIVE_DIAGNOSTICIAN__`, `__PRACTICE__`, `__PRACTICE_SOURCE__`, `__PRACTICE_TUTOR__`, `__RESUME__`, `__LONG_REASONING__`, `__MODEL_ROUTER__`), hardcodes `nextConfig`, calls `startServer()` |
| `resources/server/.next/server/chunks/*.js` | Webpack-compiled server chunks containing shared logic (LLM calls, file I/O, data access) |
| `resources/server/.next/server/app/api/*/route.js` | Individual API route handlers |
| `resources/server/.next/server/app/page.js` | Main application page (React root) |
| `resources/server/.next/static/chunks/**/*.js` | Minified React frontend bundles (components, hooks, pages) |
| `resources/bundled-content/` | Packaged static initial content: `initial_world/` (with `candidates_pic/`), plus localized variants `en/`, `zh/`, `zh-TW/` (each containing `initial_world/candidates/`) |
| `resources/rules/` | Seeded system rules cached locally (fetched from remote on first chat and auto-saved) |
| `resources/settings.json` | Central API configuration loaded at startup by `server.js` (chat / group chat) |
| `resources/set.json` | Teaching-pipeline model tiers (`strong`/`kb`/`weak`/`premium`/`routing`/`vision`); loaded into `global.__SOCRATOPIA_SET__` |
| `resources/server/lib/kb-builder.mjs` | JS knowledge-base builder worker; spawned on upload, writes `knowledge_base/` (cards + teaching map). Uses `pdfjs-dist` + `@napi-rs/canvas` to render image-dense PDF pages and sends them directly to the card model. `set.json.vision` is an optional fallback — the default pipeline does not depend on it. |
| `resources/server/lib/pdf-worker.mjs` | Standalone PDF extraction worker (ESM); used by the textbook upload/extraction path. `kb-builder.mjs` loads `pdfjs-dist` directly for KB builds. |
| `resources/server/lib/adaptive/data-layer.js` | Adaptive teaching data layer (IIFE); loaded by `server.js` into `global.__ADAPTIVE__`. Stores LearnerModel, ConceptGraph, TeachingSession, TeachingEvents under `<PROJECT_ROOT>/adaptive-teaching/` |
| `resources/server/lib/adaptive/concept-graph-builder.js` | ConceptGraph generation (LLM + KB + dry-run paths); loaded by `server.js` into `global.__ADAPTIVE_CONCEPT_GRAPH__`. Exports buildConceptGraph, validateConceptGraph, normalizeConceptGraph. |
| `resources/server/lib/adaptive/diagnostician.js` | Structured diagnosis agent; loaded by `server.js` into `global.__ADAPTIVE_DIAGNOSTICIAN__`. Exports diagnose(), buildDiagnosisPrompt(), normalizeDiagnosis(), validateDiagnosis(), makeFallbackDiagnosis(). |
| `resources/server/lib/practice/data-layer.js` | Practice workbench data layer (IIFE); loaded by `server.js` into `global.__PRACTICE__`. Stores PracticeProblemSet, PracticeAnswerRecord, PracticeMistake under `<PROJECT_ROOT>/profiles/<pid>/worlds/<wid>/practice/` (problem_sets/, sessions/, mistakes/). NOT under adaptive-teaching/. |
| `resources/server/lib/practice/source-adapter.js` | Practice source adapter (IIFE); loaded by `server.js` into `global.__PRACTICE_SOURCE__`. Resolves generate source text for sourceType manual/textbook-page/chapter/conversation (reads textbooks/<tid>/pages, current_reading.md, concept-summaries, lesson_summaries, chats). Read-only; never creates files. Optional ConceptGraph context via `global.__ADAPTIVE__`. |
| `resources/server/lib/resume/progress-resume.js` | Structured resume-state helper; loaded by `server.js` into `global.__RESUME__`. Reads/writes `textbooks/<tid>/progress_state.json` (merge-on-write, never drops fields), parses progress.md first line (zh `# 当前页码：第 N 页` / en `# Current Page: Page N`), resolves resume start page (progress_state → progress.md → currentPage), locates the KB teaching_map focus phase from resume state (by page coverage / title / explicit phaseIndex), and exposes a one-shot `setPending/takePending(convId)` stash so the chat first-turn can hand resumeState to the `read_textbook_pages` tool. Also `stateHash()` for cache keying. |
| `resources/server/lib/practice/tutoring-session.js` | Tutoring session data layer (IIFE); loaded by `server.js` into `global.__PRACTICE_TUTOR__`. Per-problemSet AI讲题 chat sessions bound to a companion. Stores under `profiles/<pid>/worlds/<wid>/practice/tutoring_sessions/<problemSetId>.json` (atomic-write, corrupt-JSON tolerant). Exports `module.exports = api`. |
| `resources/server/lib/reasoning/long-context.js` | Long-distance reasoning context (Graph-RAG prototype, **demo only**); loaded by `server.js` into `global.__LONG_REASONING__`. READ-ONLY — never touches the live classroom chain. Given a focus page/concept/query, recalls cross-page prerequisites, related cards and evidence from an existing ConceptGraph (saved → dry-run → KB fallback) and emits a hidden classroom-context `promptBlock`. Exports `buildLongReasoningContext(input)` plus `_`-prefixed test helpers. |
| `resources/server/lib/model-router.js` | Unified cost-aware model router (CommonJS); loaded by `server.js` into `global.__MODEL_ROUTER__`. Exports `resolveModelRoute`, `callRoutedLLM`, `shouldEscalateAfterFailure`, `validateRoutedOutput`, `classifyError`. mini-default + single premium escalation on content failures. See "Model router" section. |
| `resources/server/lib/practice/runtime-e2e-smoke.js` | Runtime E2E smoke: auto-detects the running Socratopia.exe HTTP port (Windows PowerShell, falls back to candidate ports) and exercises `/api/practice` generate/grade/hint/explain/variant against the live service using the built-in strong LLM chain (no external apiKey). |
| `tools/new-route.js` | Route generator script; auto-allocates collision-free webpack module IDs by scanning all existing routes, then writes and registers a new API route |
| `resources/app-update.yml` | Auto-update config (disabled — points to `http://127.0.0.1:9`) |
| `main.js` (repo root) | Working copy of the Electron main process bundle for editing |
| `preload.js` (repo root) | Working copy of the preload script for editing |
| `fix-asar-integrity.js` | Automates ELECTRONASAR hash repair in `Socratopia.exe` after repacking |
| `AGENTS.md` | Companion guidelines for agent-based work in this repo (project structure, commands, style, commits) |

**Note on `_asar_extracted/`**: This directory is gitignored. After pulling changes or switching branches, any extracted ASAR contents may be stale; re-extract from the current `resources/app.asar` before editing.

The root-level `main.js` and `preload.js` are editable working copies only. The Electron runtime loads them from inside `resources/app.asar`; editing the root copies does **not** affect the running app until they are repacked into the ASAR and the integrity hash is repaired. Mirror the same edits into `_asar_extracted/dist-electron/` when using the ASAR workflow.

## API routes

All routes live under `resources/server/.next/server/app/api/`. The routes most commonly edited are **chat** (core LLM streaming), **groupchat**, **profile**, **custom-companions**, and **tts-audio**.

- `chat/route.js` — core LLM chat endpoint; builds prompt context (rules, persona, relationships, world, learner info, textbook content, lesson plan, group chat history) and streams responses
- `textbook/route.js` — textbook CRUD, page reading, TOC extraction
- `world/route.js` — world / companion CRUD
- `companion/reconcile-persona/route.js` — companion persona reconciliation
- `companion/avatar/route.js` — companion avatar upload / fetch
- `custom-companions/route.js` — custom companion CRUD
- `custom-companions/avatar/route.js` — custom companion avatars
- `custom-companions/merge-persona/route.js` — merge custom companion persona
- `conversations/route.js` — conversation history
- `diary/route.js` — diary entries
- `flashcard/route.js` — flashcard generation
- `concept-summary/route.js` — concept summaries
- `groupchat/route.js` — group chat messages
- `forum/route.js` — forum posts (disabled — API URL points to `http://127.0.0.1:9`)
- `tts-audio/route.js` — serves locally cached TTS audio files (WAV/MP3) from `%APPDATA%/socratopia/project-data/tts-cache/`; includes path-traversal protection and filename validation
- `lesson-summary/route.js` — lesson summaries
- `search/route.js` — search
- `stats/route.js` — usage statistics
- `profile/route.js` — user profile CRUD
- `profile/avatar/route.js` — user avatar upload / fetch
- `profile/reset/route.js` — profile reset
- `reading-context/route.js` — reading context / state
- `jump-page/route.js` — page jumping
- `pdf-assets/route.js` — PDF asset serving
- `system/route.js` — system operations
- `account/init/route.js` — account initialization
- `adaptive-teaching/route.js` — adaptive teaching mode (currently no-op echo route / placeholder for future orchestrator)
- `adaptive-concept-graph/route.js` — ConceptGraph generation endpoint (POST build/dry-run, GET read)
- `adaptive-diagnosis/route.js` — Diagnosis endpoint (POST); calls `global.__ADAPTIVE_DIAGNOSTICIAN__` for structured student diagnosis
- `practice/route.js` — Practice workbench. **Workbench actions** (calls `global.__PRACTICE__` + `__PRACTICE_SOURCE__`): GET list/read; POST action=generate\|grade\|hint\|explain\|variant\|saveMistake\|listMistakes. Choice/fill grading is local (no LLM); subjective grading + generate/hint/explain/variant use the teaching-model LLM. `generate` source resolution is delegated to `global.__PRACTICE_SOURCE__` (manual/textbook-page/chapter/conversation, with concept-summary→lesson-summary→recent-messages fallback for conversation). **Tutoring actions** (AI讲题, calls `global.__PRACTICE_TUTOR__`): getProblemSet, getTutoringSession, listTutoringSessions, deleteTutoringSession, setTutoringCompanion, tutorExample, tutorExplain, tutorFreeChat, tutorFullAnswer, tutorHint, tutorRephrase, tutorVariant. Stores under `profiles/<pid>/worlds/<wid>/practice/` (problem_sets/, sessions/, mistakes/, tutoring_sessions/).
- `long-reasoning-demo/route.js` — Graph-RAG long-distance reasoning demo (GET); calls `global.__LONG_REASONING__.buildLongReasoningContext` (read-only, never persists). Requires `profileId`/`worldId`/`textbookId` query params.
- `test-key/route.js` — API key validation

Voice/TTS synthesis APIs are disabled (URLs point to `http://127.0.0.1:9`), but the `tts-audio` endpoint remains active to serve cached audio used by group chat TTS.

## Voice / TTS model mapping: distributed, not config-driven

Like module 64092, voice selection is **duplicated across files** rather than driven by a single config table. See `VOICE_MODEL_MAPPING_REPORT.md` (repo root) for the authoritative breakdown. Key points when changing voices:

- The `voiceKey -> GPT-SoVITS model` table is repeated in the frontend voice lib (`static/chunks/4137-*.js`), the server-side equivalent (`server/chunks/3461.js`), and the group-chat route's `_ttsV` table (`api/groupchat/route.js`).
- Two **separate** default `candidateId -> voiceKey` maps exist and can drift out of sync: the classroom map (in `static/chunks/app/page-*.js` / `server/app/page.js`) and the group-chat map (`_cidToVk` in `api/groupchat/route.js`).
- Classroom flow synthesizes/plays in the frontend; group-chat flow synthesizes server-side and writes to `tts-cache`. A voice change must usually be applied to all of these to stay consistent.

## Planning & report documents (repo root)

These Markdown files hold design intent and investigation notes that are **not** derivable from the compiled code. Read the relevant one before implementing the corresponding feature:

| Document | Purpose |
|----------|---------|
| `ADAPTIVE_TEACHING_MODE_TECHNICAL_REPORT.md` | Design for a new self-contained adaptive teaching mode (learner model, multi-agent roles, teaching loop). Analysis only — explicitly says do not modify product code yet. Includes phased Claude Code prompts. |
| `PRACTICE_FEATURE_TECHNICAL_PLAN_AND_CLAUDE_PROMPTS.md` | Plan for a new "generate / solve / explain problems" practice workbench reusing textbook, KB, flashcard, and dialogue capabilities. Includes phased Claude Code prompts. |
| `VOICE_MODEL_MAPPING_REPORT.md` | Investigation of where voice selection lives (see section above). |
| `TTS_OPTIMIZATION_CHANGELOG.md` | Record of GPT-SoVITS TTS latency optimizations, including changes in the external model-server repo (`D:\model_tts\...`) and the Socratopia call chain. |

## Module 64092: LLM core (`mx` / `callLLM` / `$b`)

Module 64092 is the LLM configuration and invocation core. It contains three key exports:
- **`mx()` (function `f`)** — builds request config (`apiKey`, `baseURL`, `apiType`, `extraHeaders`)
- **`callLLM()` (function `g`)** — executes the fetch call to the LLM API
- **`$b` (variable `d`)** — provider-to-model-ID mapping from `settings.json`

This module is duplicated across **8 files**. Any change to API selection logic must be synchronized to all of them:

| File | Module ID | How |
|------|-----------|-----|
| `resources/server/.next/server/chunks/4092.js` | 64092 | Defines the module body |
| `resources/server/.next/server/chunks/1576.js` | 64092 | Defines the module body |
| `resources/server/.next/server/app/api/flashcard/route.js` | 64092 | Inlines module definition (`64092:(...)`) |
| `resources/server/.next/server/app/api/concept-summary/route.js` | 64092 | Inlines module definition |
| `resources/server/.next/server/app/api/custom-companions/merge-persona/route.js` | 64092 | Inlines module definition |
| `resources/server/.next/server/app/api/companion/reconcile-persona/route.js` | 64092 | Inlines module definition |
| `resources/server/.next/server/app/api/chat/route.js` | 64092 | Imports from chunk (`c(64092)`) |
| `resources/server/.next/server/app/api/groupchat/route.js` | 64092 | Imports from chunk; also has inline BYOK error path |

Additional consumers that dynamically load module 64092 (via `c.bind(c,64092)`): `chunks/2751.js`, `app/api/lesson-summary/route.js`. These don't define the module but will break if its exports change.

When editing module 64092 logic, change all 6 files that **define** it (2 chunks + 4 inlined routes). The 4 files that import it will pick up changes automatically from the chunks.

After editing any of these files, run `node --check <file>` to verify syntax.

## Critical constraint: editing webpack bundles

All edits are applied directly to compiled webpack bundles (very long single lines). This imposes strict constraints.

### `require("fs")` is unreliable inside chunks

Inside `chunks/*.js`, webpack's custom `require()` cannot resolve Node.js built-ins like `"fs"`. Calling `require("fs")` there fails silently (often swallowed by try/catch).

Distinction:
- **`chunks/*.js`** — do not use `require("fs")`; use `global.__FS__` (set in `server.js` before Next.js loads) or `process.stdout.write()` for debug logging.
- **API `route.js` files** (e.g. `app/api/chat/route.js`) — can use `require("fs")` directly because they run in a webpack context with proper Node.js module resolution.

Workaround: `server.js` sets `global.__FS__`, `global.__PATH__`, and `global.__RULES_DIR__` before Next.js boots. Route files use the `global.__FS__ || require("fs")` pattern for robust access.

### Debugging syntax errors

Common causes of `SyntaxError`:
- Unescaped single quote `'` inside a `'...'` string (e.g. `hasn't`)
- ASCII double quote `"` used where Chinese quotes are intended inside `"..."` strings
- Unmatched backticks in template literals

`node --check` reports inaccurate positions on minified single-line files. Use `acorn` for precise locations (see command in "Available commands").

Safe string editing rules:
- Inside `'...'`: escape every `'` as `\'`
- Inside `"..."`: escape every `"` as `\"`
- Inside template literals: escape `` ` `` as `` \` `` and `${` as `\${`
- Chinese quotes must use Unicode curly quotes (U+201C/U+201D) or be escaped

## Incremental patches / distribution

When distributing an incremental update (patch) to users who have an older build, the changed files are typically limited to:
- `resources/server/.next/server/app/api/*/route.js` — modified API routes
- `resources/server/.next/server/chunks/*.js` — modified shared logic
- `resources/server/.next/static/chunks/**/*.js` — modified frontend bundles
- `resources/server/.next/*-manifest.json` — **must be included** when any route or page changes, or Next.js will serve stale mappings
- `CLAUDE.md` — documentation changes

Files to **exclude** from patch packages: `.claude/`, `node_modules/`, `package.json`, `package-lock.json`.

Before distributing a patch, validate:
1. `node --check` passes on every edited `.js` file.
2. For Electron changes, `Socratopia.exe` launches successfully after `node fix-asar-integrity.js`.
3. For server/route changes, the app launches without `Error: Cannot find module` in the Next.js server logs.
4. If a route or page file changed, at least one `*-manifest.json` under `resources/server/.next/` is included and its timestamp matches the new bundles.

## Rules local caching

The `m()` function in the chat route implements a local-first rules fetch:

1. Read local file from `%APPDATA%/socratopia/rules/rules_{lang}.md` via `global.__RULES_DIR__`
2. On miss: fetch from `{rulesUrl}/rules?lang={code}` using the session token
3. Auto-save the response to `%APPDATA%/socratopia/rules/` for later use
4. Seed rules in `resources/rules/` ship with the app

`rulesUrl` resolution order: `process.env.SOCRATOPIA_PROXY_URL` → `settings.json.rulesUrl` → `https://llm.socratopia.app`.

## Data and state locations

- **User data**: `%APPDATA%/socratopia/project-data/` — worlds, textbooks, profile, diary, etc.
- **TTS cache**: `%APPDATA%/socratopia/project-data/tts-cache/` — cached TTS audio files served by `tts-audio` route
- **Rules cache**: `%APPDATA%/socratopia/rules/` — locally cached system rules
- **Server copy**: `%APPDATA%/socratopia/server/` — copied from `resources/server/` on every launch
- **Storage**: `electron-store` at `%APPDATA%/socratopia/config.json`
- **Session token**: encrypted via Electron `safeStorage`

## Running and testing changes

Run the app with `./Socratopia.exe`. There is no build step.

Edit files under `resources/` (for server/route changes) or `main.js`/`preload.js` (for Electron changes), then restart `Socratopia.exe`. `main.js` copies `resources/server/` into `%APPDATA%/socratopia/server/` on each launch, so `resources/server/` edits take effect immediately.

- Launch from a terminal to see `process.stdout.write()` output from chunks
- `console.log()` works directly in route files
- Toggle the Chromium DevTools with `Ctrl+Shift+I` (or `F12`) to inspect the renderer and view network requests to `localhost`
- Main-process logs appear in the terminal that launched `Socratopia.exe`

### ASAR edit workflow

1. `npx asar extract resources/app.asar _asar_extracted/`
2. Edit `_asar_extracted/dist-electron/main.js` and/or `_asar_extracted/dist-electron/preload.js`
3. `npx asar pack _asar_extracted/ resources/app.asar`
4. `node fix-asar-integrity.js`
5. Restart `Socratopia.exe`

`fix-asar-integrity.js` automates hash repair: it computes the SHA256 of the ASAR JSON header (bytes 16 through end of JSON), locates the `ELECTRONASAR` resource in `Socratopia.exe`, and replaces the old hash with the new one.

## Auto-updater status

Auto-update is completely disabled in this deployment:
- `main.js`: `fireBeacon` is a no-op; `initAutoUpdater` registers stub IPC handlers
- `preload.js`: update APIs return `Promise.resolve` no-ops
- `resources/app-update.yml`: points to `http://127.0.0.1:9` (unreachable)
- `elevate.exe`: removed (no longer needed for updates)

## Settings (`resources/settings.json`)

Example structure:

```json
{
  "endpoint": "https://api.nwafu-ai.cn/v1",
  "apiKeys": {
    "codex": "..."
  },
  "gpt": {
    "apiKeyGroup": "codex",
    "models": {
      "gpt": "gpt-5.4-mini",
      "openai": "gpt-5.4-mini",
      "strong": "gpt-5.5",
      "kb": "gpt-5.4-mini",
      "weak": "gpt-5.4-mini"
    }
  },
  "proxyUrl": "",
  "rulesUrl": ""
}
```

### API selection logic in `mx()`

This deployment uses **codex-only** (GPT provider). Legacy `other`/`deepseek`/`gemini` are no longer configured — the `server.js` normalize function no longer auto-creates an `other` block with hardcoded `zanzhu` key. All fallback paths now resolve to `gpt`/`codex`.

## Teaching-model config (`resources/set.json`)

Separate from `settings.json` (which still drives chat/group-chat via module 64092), `set.json` configures the **teaching pipeline** with lightweight role blocks. Each role can be as small as `{apiType, model}`; `server.js` fills `baseUrl` and `apiKey` from `settings.json`.

- **`strong`** — page-turn prep, flashcards, classroom/lesson summaries, concept summaries. **Defaults to `gpt-5.4-mini` (mini) for cost control** — `strong` is a "strong-task role", not "always the expensive model". The high-value model lives in `premium`.
- **`kb`** — page-turn knowledge distillation (`__KB_DISTILL__`) and KB auto-build card model. This role currently uses gpt-5.4-mini for cost control. If the configured model supports images, it can receive PDF page images directly for transcription + card generation in one pass; otherwise the builder falls back to text-only extraction. Delete this block to auto-fall-back to `strong`.
- **`weak`** — teaching dialogue
- **`premium`** — **high-value model** (`gpt-5.5`). Used only for inherently-complex tasks (concept graph, cross-chapter diagnosis), high input complexity, explicit user high-quality mode, or a single failure-escalation when a mini attempt returns empty/unparseable/schema-invalid output. **Optional**: if absent, the router silently never escalates (`reason=no_premium_config`). Mirrored in `settings.json.gpt.models.premium`.
- **`routing`** — tunes `global.__MODEL_ROUTER__`: `defaultQualityMode` (`auto`/`fast`/`high`), `miniInputTokenLimit` (default 12000), `miniPageLimit` (default 12), `enableFailureEscalation`, `enableDirectHighForConceptGraph`.
- **`vision`** — **optional fallback** for KB auto-build. Only used if the multimodal card model rejects images AND text-only card generation also fails. Not configured by default; add a `vision` block to `set.json` only if you want this third-level safety net.

### Model router (`lib/model-router.js`, `global.__MODEL_ROUTER__`)

Unified, cost-aware model selection so routes don't each hand-pick a model. Exports `resolveModelRoute(input)`, `callRoutedLLM(input, caller)`, `shouldEscalateAfterFailure(input, failure)`, `validateRoutedOutput(task, rawOutput, parsedOutput)`, plus `classifyError`. Policy: `weak`/`kb`/`strong` default to mini; escalate to `premium` **once** only on inherently-complex tasks, high input complexity, explicit `userQualityMode:"high"`, or a content failure (empty / JSON parse / missing schema fields / 0 cards / abnormal graph / image rejected). Transport failures (auth/401, quota/402, 429, network/timeout) **never** escalate; `fast` mode never escalates. Every decision logs `task/role/tier/model/reason/fallbackAttempt` (never the apiKey). Wired into `server.js __KB_DISTILL__` (task `kb_distill`) and, via env (`KB_PREMIUM_*`), into `kb-builder.mjs` (escalates a chunk once when the mini card model yields 0 cards). Smoke test: `node resources/server/lib/model-router-smoke-test.js` (95 assertions).

`server.js` loads `set.json` from `CONTENT_ROOT/../set.json` into `global.__SOCRATOPIA_SET__`. If the file is absent, it derives both `strong` and `weak` from the `gpt` block of `settings.json`. Group chat does **not** use `set.json`; it stays on `settings.json`.

### `__KB_DISTILL__` (server.js)

`global.__KB_DISTILL__(rawText, startPage, endPage, textbookDir, resumeState?)` turns the current page window into a "verified knowledge" block before it reaches the weak teaching model. The optional 5th arg `resumeState` (from `global.__RESUME__`) lets the renderer pick the **correct** teaching_map focus phase when resuming a previous lesson instead of always expanding phase 1; old callers that omit it behave exactly as before. Resolution order:

1. Prefer a pre-built knowledge base: `<textbookDir>/knowledge_base/index.json` + `cards/`.
2. Fallback: distill on the fly with `set.kb || set.strong` via `global.__MODEL_ROUTER__` (task `kb_distill`, mini-first; escalates to `premium` once if the mini output is empty/unparseable). Result is **not** written to disk, to avoid polluting the KB with unverified content. If the router is unavailable it falls back to a single direct call on `set.kb || set.strong` (legacy behavior).
3. On any failure or missing strong model: return `null`, and callers fall back to the raw page text — the teaching path never breaks.

An in-memory LRU cache (`__KB_CACHE__`) de-dupes identical windows and merges concurrent calls (chat page-turn + jump-page on the same window) into one. Both the in-memory key and the on-disk `runtime_cache` key fold in `resumeState` (via `__RESUME__.stateHash`), and the disk cache hits **only on an exact `rawHash` match** — it never falls back to `sameRange`/`covered` entries, so a different lesson progress (or a changed page window) can never reuse another render's "current focus". Consumers of `__KB_DISTILL__` / `__SOCRATOPIA_SET__`: `chat`, `jump-page`, `flashcard`, `concept-summary`, `lesson-summary` routes, plus `chunks/9654.js`.

### Lesson resume: structured `progress_state.json` (`global.__RESUME__`)

When a learner opens a new classroom and says "continue last lesson", the chat first turn must resume from where the previous lesson actually ended — not snap back to teaching_map phase 1. This is handled by `lib/resume/progress-resume.js` (loaded into `global.__RESUME__`):

- **Source of truth**: `textbooks/<tid>/progress_state.json` (`schemaVersion`, `currentPage`/`lastTaughtPage`, `windowStartPage`/`windowEndPage`, `lastFocus`/`currentFocus`, optional `phaseIndex`/`title`/`conceptId`, `completedConceptIds`/`completedTitles`, `updatedAt`, `conversationId`). Written on `[下课]` alongside `progress.md` via `writeState` (merge — never drops existing fields; `completed*` arrays are unioned). Falls back to parsing `progress.md`'s first line, then `textbook.currentPage`.
- **Init flow** (`chat/route.js` first turn): `resolveStartPage()` picks the start page and stashes the resolved `resumeState` via `setPending(convId, …)`. The `read_textbook_pages` tool handler (`chunks/9654.js`) calls `takePending(convId)` (one-shot) and passes it as the 5th arg to `__KB_DISTILL__`. Normal mid-lesson page turns carry no pending state, so they render with no resume bias.
- **Focus rendering** (`server.js` `renderCards`): with a `resumeState`, the focus phase is located by `focusFromState()` (page coverage of `lastTaughtPage`, or explicit `title`/`conceptId`/`phaseIndex`). Earlier phases are collapsed and marked "已学过，除非学生主动要求不要重讲"; the focus phase is expanded; later phases stay collapsed. The `TEACHING_DIRECTIVE` no longer hardcodes "阶段 1". When the phase can't be pinned down it emits a soft directive ("从已记录掌握的内容之后继续").

### Knowledge base auto-build on upload (`lib/kb-builder.mjs`)

When a textbook is uploaded (PDF, Markdown, or PPTX), module **82751** (`chunks/2751.js`) automatically triggers a background knowledge-base build by spawning `node lib/kb-builder.mjs` as a detached child process. The worker writes `<textbookDir>/knowledge_base/{index.json, cards/*.json, teaching_map.json, build_status.json}` — exactly the format `__KB_DISTILL__` expects.

**Pipeline (no Python; pure JS):**
1. PDF: `pdfjs-dist` extracts text per page. Sparse-text pages (<80 chars + visual ops) are rasterized to PNG via `@napi-rs/canvas`.
2. Markdown: split into heading-delimited blocks — no rendering.
3. Pages are chunked (~4 pages per chunk). Each chunk carries both extracted text and rendered page images.
5. Each chunk is sent to the **card model** (`set.json.kb || set.json.strong`) as a multimodal request (text + image data URLs). With gpt-5.4-mini this is the cost-controlled path; if images are rejected, the builder falls back to text-only generation.
6. If the multimodal card model rejects images → auto-fall-back to text-only card generation (JSON mode).
7. If `set.json.vision` is configured → used as a third-level fallback (vision transcription of images → text-only card generation).
8. All cards are assembled into a teaching map via the card model (phased sequence, ~16 cards per segment).
9. Output is written to `knowledge_base/` (including per-chunk build log in `build_status.json`); runtime `__KB_DISTILL__` consumes it on the next page-turn.

**Config (zero hardcoding):** The upload route reads config from `global.__SOCRATOPIA_SET__` (resolved by `server.js` from `set.json` + `settings.json`). The card model is `set.json.kb || set.json.strong` (currently gpt-5.4-mini for cost control). **`set.json.vision` is an optional fallback** — the pipeline does not depend on it; it is only used as a last resort if the card model cannot handle images directly. All config is passed to the worker via environment variables — never hardcoded in code.

**Dependency: `@napi-rs/canvas`** — bundled alongside `sharp` in `resources/server/.next/node_modules/@napi-rs/`. Ships with a prebuilt win32-x64-msvc binary (~27 MB). Included in `deps.zip` so `prepareServerDir` self-heal restores it.

**Note on sentinels:** `main.js` `SERVER_NODE_MODULES_SENTINELS` checks `[next, react, react-dom, sharp]` only. A missing `@napi-rs/canvas` will not be caught by the integrity check. However, `deps.zip` now includes it, so a clean re-extract will restore both packages.

**Limitations:**
- `.pptx` files are supported for upload and KB auto-build via OpenXML slide text extraction. Legacy `.ppt` is still unsupported because it requires an external converter such as LibreOffice.
- From-library Markdown: when a library Markdown is imported, it is encrypted to `.qbook` format and the original `.md` is deleted. A temporary `_kb_src.md` copy is saved before deletion so the KB builder can still process the raw markdown. If the copy fails (disk full, permission), the KB build is skipped silently.

## Localization

Supported languages: `en`, `zh`, `zh-TW`. Rules are cached per language: `rules_en.md`, `rules_zh.md`, `rules_zh-TW.md`.

## Environment variables

- `PORT`, `HOSTNAME`, `NODE_ENV` (always `"production"`)
- `PROJECT_ROOT` — user data directory
- `CONTENT_ROOT` — packaged content directory
- `SOCRATOPIA_OPENAI_API_KEY` — override the GPT/codex key from `settings.json`
- `SOCRATOPIA_API_TYPE` — force `"gpt"` (`"openai"` remains a legacy alias)
- `SOCRATOPIA_PROXY_URL` — override proxy / rules base URL
