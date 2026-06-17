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

There is no build system, test suite, or linter in this directory. The root `package.json` only declares `acorn` (for syntax checking); run `npm install` at the root if you need it. The actual app dependencies are already bundled inside `resources/server/.next/node_modules/`.

| Command | Purpose |
|---------|---------|
| `npm install` | Install root dev dependency (`acorn`) — only needed once for syntax checking |
| `./Socratopia.exe` | Launch the app |
| `node --check <file>` | Validate JS syntax after editing a bundle |
| `node -e "const acorn=require('acorn'); acorn.parse(require('fs').readFileSync('<file>','utf-8'),{ecmaVersion:2022})"` | Locate syntax errors precisely in long minified lines |
| `npx asar extract resources/app.asar _asar_extracted/` | Extract ASAR to edit `main.js` / `preload.js` |
| `npx asar pack _asar_extracted/ resources/app.asar` | Repack ASAR after edits |
| `node fix-asar-integrity.js` | Recalculate and patch the `ELECTRONASAR` hash in `Socratopia.exe` after repacking |
| `python tools/kb_builder.py --selftest` | Offline knowledge-base builder; verify LLM endpoint connectivity (see "Offline knowledge base") |

Python tooling (`tools/kb_builder.py`) runs in the miniconda `code` env (`E:/Py/MiniConda/envs/code`, already has `pymupdf`/`requests`). Use a **PowerShell** terminal: `conda activate code` then `python tools/kb_builder.py ...`.

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
| `resources/server/server.js` | Next.js standalone bootstrap; loads `settings.json` + `set.json`, sets globals (`__FS__`, `__PATH__`, `__RULES_DIR__`, `__SOCRATOPIA_SETTINGS__`, `__SOCRATOPIA_SET__`, `__KB_DISTILL__`), hardcodes `nextConfig`, calls `startServer()` |
| `resources/server/.next/server/chunks/*.js` | Webpack-compiled server chunks containing shared logic (LLM calls, file I/O, data access) |
| `resources/server/.next/server/app/api/*/route.js` | Individual API route handlers |
| `resources/server/.next/server/app/page.js` | Main application page (React root) |
| `resources/server/.next/static/chunks/**/*.js` | Minified React frontend bundles (components, hooks, pages) |
| `resources/bundled-content/` | Packaged static initial content: `initial_world/` (with `candidates_pic/`), plus localized variants `en/`, `zh/`, `zh-TW/` (each containing `initial_world/candidates/`) |
| `resources/rules/` | Seeded system rules cached locally (fetched from remote on first chat and auto-saved) |
| `resources/settings.json` | Central API configuration loaded at startup by `server.js` (chat / group chat) |
| `resources/set.json` | Teaching-pipeline model tiers (`strong`/`kb`/`weak`); loaded into `global.__SOCRATOPIA_SET__` |
| `tools/kb_builder.py` | Offline knowledge-base builder (miniconda `code` env) |
| `resources/app-update.yml` | Auto-update config (disabled — points to `http://127.0.0.1:9`) |
| `main.js` (repo root) | Working copy of the Electron main process bundle for editing |
| `preload.js` (repo root) | Working copy of the preload script for editing |
| `fix-asar-integrity.js` | Automates ELECTRONASAR hash repair in `Socratopia.exe` after repacking |

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
- `test-key/route.js` — API key validation

Voice/TTS synthesis APIs are disabled (URLs point to `http://127.0.0.1:9`), but the `tts-audio` endpoint remains active to serve cached audio used by group chat TTS.

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
  "Base_API": "openai",
  "apiType": "openai",
  "deepseek": {
    "baseUrl": "https://api.deepseek.com",
    "apiKey": "...",
    "models": {
      "deepseek": "deepseek-v4-flash",
      "openai": "gpt-4o-mini",
      "anthropic": "claude-sonnet-4-20250514",
      "gemini": "gemini-2.5-flash",
      "qwen": "qwen-plus",
      "moonshot": "moonshot-v1-auto",
      "minimax": "MiniMax-M2.7-highspeed"
    }
  },
  "openai": {
    "baseUrl": "https://api.nwafu-ai.cn/v1",
    "apiKey": "...",
    "models": { "openai": "gpt-5.5", "deepseek": "deepseek-v4-flash", "...": "..." }
  },
  "proxyUrl": "http://127.0.0.1:9",
  "rulesUrl": "http://127.0.0.1:9"
}
```

### API selection logic in `mx()`

`Base_API` is present in `settings.json` for backwards compatibility but is not the primary runtime selector. The active provider and model are determined by `apiType` and the matching provider block (`openai`, `deepseek`, etc.).

1. `apiType === "openai"` → OpenAI API (checked first)
2. `apiType === "deepseek"` and `apiKey` is set → direct DeepSeek
3. `accessMode === "hosted"` + session token → hosted mode (only when `apiType` is unset)
4. Provider is `"openai"` → OpenAI API (fallback)
5. `apiKey` argument provided → DeepSeek BYOK mode
6. Otherwise → throws `BYOK_NOT_AVAILABLE`

## Teaching-model config (`resources/set.json`)

Separate from `settings.json` (which still drives chat/group-chat via module 64092), `set.json` configures the **teaching pipeline** with three tiers, each a flat `{apiType, baseUrl, apiKey, model}` block:

- **`strong`** — page-turn prep, flashcards, classroom/lesson summaries, concept summaries
- **`kb`** — page-turn knowledge distillation (`__KB_DISTILL__`); cheaper "flash" model. Delete this block to auto-fall-back to `strong`.
- **`weak`** — teaching dialogue

`server.js` loads `set.json` from `CONTENT_ROOT/../set.json` into `global.__SOCRATOPIA_SET__`. If the file is absent, it derives `strong` from the `openai` block and `weak` from the `deepseek` block of `settings.json`. Group chat does **not** use `set.json`; it stays on `settings.json`.

### `__KB_DISTILL__` (server.js)

`global.__KB_DISTILL__(rawText, startPage, endPage, textbookDir)` turns the current page window into a "verified knowledge" block before it reaches the weak teaching model. Resolution order:

1. Prefer a pre-built knowledge base: `<textbookDir>/knowledge_base/index.json` + `cards/`.
2. Fallback: distill on the fly with `set.kb || set.strong` (result is **not** written to disk, to avoid polluting the KB with unverified content).
3. On any failure or missing strong model: return `null`, and callers fall back to the raw page text — the teaching path never breaks.

An in-memory LRU cache (`__KB_CACHE__`) de-dupes identical windows and merges concurrent calls (chat page-turn + jump-page on the same window) into one. Consumers of `__KB_DISTILL__` / `__SOCRATOPIA_SET__`: `chat`, `jump-page`, `flashcard`, `concept-summary`, `lesson-summary` routes, plus `chunks/9654.js`.

### Offline knowledge base (`tools/kb_builder.py`)

Standalone Python script (touches no compiled bundle, zero runtime risk) that pre-builds the `knowledge_base/` consumed above. It reads model/endpoint/key **dynamically** from `settings.json` (mirroring `mx()`: `apiType` selects the block, `models[apiType]` the model) — never hardcode credentials. Output is simplified-Chinese only. Uncertain cards get a `needs_verification` flag + `verify_query` for later human/WebSearch follow-up; the script itself does not go online. Common invocations: `--selftest` (connectivity), `--dry-run` (extract+chunk only), `--start-page/--end-page`, `--max-chunks N` (cost control), `--provider` (force a block).

## Localization

Supported languages: `en`, `zh`, `zh-TW`. Rules are cached per language: `rules_en.md`, `rules_zh.md`, `rules_zh-TW.md`.

## Environment variables

- `PORT`, `HOSTNAME`, `NODE_ENV` (always `"production"`)
- `PROJECT_ROOT` — user data directory
- `CONTENT_ROOT` — packaged content directory
- `SOCRATOPIA_DEEPSEEK_API_KEY`, `SOCRATOPIA_OPENAI_API_KEY` — override `settings.json`
- `SOCRATOPIA_API_TYPE` — force `"openai"` or `"deepseek"`
- `SOCRATOPIA_PROXY_URL` — override proxy / rules base URL
