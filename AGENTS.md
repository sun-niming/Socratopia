# AGENTS.md

A **packaged Windows build artifact** of Socratopia (Electron + Next.js Socratic-tutoring app). No build pipeline regenerates bundles from source — every edit is a surgical patch to compiled webpack/esbuild output, validated with `node --check`/acorn plus a co-located smoke test.

`CLAUDE.md` carries the full detail (architecture, global-injection contract, auth model, LLM layer). This file is the compact version for non-Claude agents; keep the two in sync when architecture changes.

## Primary reference

- Source repo: `socralab-app/v2` (macOS). Sibling working copy: `E:\huanjing\sogeladi\Socratopia_2.0\Socratopia` — diff before editing unfamiliar code.
- Hand-written, safe to edit as source: `resources/server/server.js` and everything under `resources/server/lib/`. Everything else is generated.
- Repo root is the live runtime; `win-unpacked/` is a committed snapshot of an older release and is **not** auto-synced.

## Architecture (3 layers)

1. **Electron main** — `dist-electron/main.js` inside `resources/app.asar` (root `main.js` is its working copy). Starts Next.js, owns native APIs. Packaged as `window.electronAPI` via `preload.js`.
2. **Next.js server** — `resources/server/server.js`, forked as a child process with `cwd = resources/server/` on `127.0.0.1:<dynamic port>` (published to `<userData>/.server-port`; do not assume 3000).
3. **React frontend** — rendered in a BrowserWindow, IPC via `preload.js`.

`server.js` installs config and `global.*` module handles before Next starts (table at `server.js:881-900`); compiled chunks that cannot `require()` read from there. Adding a module compiled code needs means adding a row to that table.

**Figure orders**: the tutor may order a figure inline with `![alt](book://<textbookId>/p<page>#x0,y0,x1,y1)` (crop the PDF) or a ```svg fence (draw it). `lib/assets/intents.js` (`global.__ASSETS_INTENTS__`) materializes both into `asset://` anchors on the `POST /api/conversations` write path; the client renders live fences through the markdown `pre` override, and `lib/assets/prefetch.js` (`global.__ASSETS_PREFETCH__`) warms the pages just past the reading window. Provenance shows as a corner badge driven by `GET /api/assets/<id>?meta=1`. **When** to order a figure (as opposed to the syntax) lives only in `figureOrderGuide`, which is injected every turn; the three `resources/rules/*` files just point at it — keep the policy in the guide, not duplicated into rules. See `IMAGE_ASSET_LAYER_T13_COMPLETION_REPORT.md` §13-§14, §16.

**Chat deletes are soft.** The only path that removes a conversation is the sidebar's confirm-free trash button → `DELETE /api/conversations`. That route now moves `chats/<id>.json` into `chats/.trash/` via `lib/chat-trash.js` (`global.__CHAT_TRASH__`, old unlink kept as fallback), so a misclick is recoverable; `GET /api/conversations?trash=1` lists the trash.

## Critical constraints (miss these = breakage)

- **No `require("fs")` in `.next/server/chunks/*.js`** — webpack can't resolve it. Use `global.__FS__`. Route files (`app/api/*/route.js`) *can* use `require("fs")`.
- **Module `64092`** (LLM core: `mx`/`callLLM`/`$b`) is duplicated across **6 definer files** — chunks `1576.js` and `4092.js`, plus routes `chat`, `concept-summary`, `flashcard`, `companion/reconcile-persona`, `custom-companions/merge-persona`. Change all definers when editing LLM logic.
- **Safe string editing in minified bundles**: escape `'` → `\'`, `"` → `\"`, `` ` `` → `` \` ``, `${` → `\${`. Locate syntax errors with acorn: `node -e "require('acorn').parse(require('fs').readFileSync('<file>','utf-8'),{ecmaVersion:2022})"`
- **`release-runtime-manifest.json` is hash-pinned twice** — `main.js:35347` holds its sha256, and it pins `deps.zip` + `.next/node_modules` + `lib/ocr/rapidocr-v5`. Regenerate with `node tools/generate-release-runtime-manifest.js` *and* update that constant if you touch those.
- **Repacking `app.asar` requires re-embedding the `ELECTRONASAR` hash in `Socratopia.exe`.** `fix-asar-integrity.js` is gone — use `node tools/patch-asar-integrity.js` (`--check` to verify only), and close the app first.

## Exact commands

| Action | Command |
|--------|---------|
| Syntax check | `node --check <file>` |
| Launch app | `./Socratopia.exe` |
| ASAR extract / repack | `npx asar extract resources/app.asar _asar_extracted/` / `npx asar pack _asar_extracted/ resources/app.asar` |
| Re-embed EXE integrity hash | `node tools/patch-asar-integrity.js` (`--check` to verify only) |
| Repack + re-embed in one go, or safe-abort when the EXE is locked | `node tools/finish-asar-repack.js` (`--check` report only; `--copy` keeps the new asar and emits a patched `Socratopia.patched.exe`) |
| Stage a clean release tree | `node tools/stage-clean-win-release.js stage [src] [dst]` |
| Smoke test (any) | `node <path-to-smoke-test>` (self-contained, no deps, no running app) |
| All smoke tests | `node tools/run-smoke-matrix.js` |
| Gateway probe | `node tools/gateway-monitor/probe-agent-gw.js` (`--report` for stats) — permanent monitor for `agent-gw.kimi.com` (diagnoses `Model attempt execution lease expired`); see `tools/gateway-monitor/README.md`, do NOT delete in cleanups |
| Figure layer | ON by default; `assets.figureLayer: false` in set.json silences the per-turn guide + catalogue. `assets.boxMode` (`geometry` default, `vision`, `off`) only controls how a crop gets its rect |
| Figure adoption over N days | `node tools/figure-adoption-report.js [--days=7] [--since=ISO] [--world=KU]` — turns vs. replies that ordered a figure vs. dead `[图片: …]` leftovers; test: `node tools/figure-adoption-report-smoke-test.js` (the matrix skips `tools/`) |

`tools/new-route.js` was removed; scaffold routes by hand and keep the 3 route manifests consistent.

## Edit targets per change type

| Change | Edit | Restart | Extra |
|--------|------|---------|-------|
| API route logic | `resources/server/.next/server/app/api/*/route.js` | app | `node --check`; include `*-manifest.json` in patches |
| Shared server logic | `resources/server/.next/server/chunks/*.js` | app | No `require("fs")`; edit all 64092 definers |
| React frontend | `resources/server/.next/static/chunks/**/*.js` | app | `node --check` |
| Electron main/preload | Root `main.js` + `preload.js` | app | Repack ASAR + re-patch `ELECTRONASAR` |

Server changes need only a restart (the server runs in place from `resources/server/`). The ASAR is the runtime source for the Electron layer.

## Smoke tests

145 files, co-located with their module. **The matrix skips `.next/`**, so the 25 tests under `.next/` must be run by hand — e.g. after editing `chat/route.js` run `node resources/server/.next/server/app/api/chat/chat-end-class-integration-smoke-test.js`. Always run the relevant test plus `node --check` on edited files.

## Never commit

`resources/settings.json` (API keys), `resources/set.json` (teaching-model config), `resources/app.asar`, `resources/rules/*` (except `rules_zh_classroom_compact.md`), or user data.

Tracked on purpose: `resources/bundled-content/` (read-only seed content, and the publishing home for world-lore card bundles at `<lang>/world-lore/<canon>/`) and `资料/` (world-lore evidence archive). `.gitattributes` disables line-ending conversion under `资料/来源原文/**` and `资料/可用文本/**` because `资料/索引/下载清单.json` pins LF-based SHA-256 values and the repo runs `core.autocrlf=true`.

## Style

- Match surrounding bundled code (CommonJS, 2-space indent, camelCase, PascalCase for models); never reformat generated files.
- Put temp work in `tmp/` or `outputs/`.
- New smoke tests: `<module>-smoke-test.js` beside the module.
- Commit subjects: concise imperative, focused on shipped behavior.
