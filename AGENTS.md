# AGENTS.md

This is a **packaged Windows build artifact** of Socratopia (Electron + Next.js). No build pipeline regenerates bundles from source. All edits are on compiled webpack/esbuild output.

## Primary reference
- This file (`AGENTS.md`) is the sole instruction file. The previously referenced `CLAUDE.md` is absent from this repo.
- Source repo: `socralab-app/v2` (macOS). Sibling working copy: `E:\huanjing\sogeladi\Socratopia_2.0\Socratopia` — diff before editing.

## Architecture (3 layers)
1. **Electron main** (`main.js` in `resources/app.asar`) — starts Next.js, manages native APIs
2. **Next.js server** (`resources/server/`) — forked child process on port 3000
3. **React frontend** — rendered in BrowserWindow, IPC via `preload.js`

## Server-side code layout
| Path | Role |
|------|------|
| `resources/server/.next/server/app/api/*/route.js` | API route handlers (28 routes) |
| `resources/server/.next/server/chunks/*.js` | Shared webpack chunks (no `require("fs")`) |
| `resources/server/lib/` | Shared server logic (model-router, adaptive, kb, reasoning, practice, resume) |
| `resources/server/.next/static/chunks/**/*.js` | React frontend bundles |
| `resources/server/server.js` | Server entrypoint (loads settings, forked by Electron) |

Dependencies: all real deps in `resources/server/package.json`; root `package.json` has only `acorn` (for syntax checks).

## Critical constraints (miss these = breakage)
- **No `require("fs")` in `chunks/*.js`** — webpack can't resolve it. Use `global.__FS__` instead. Route files (`app/api/*/route.js`) *can* use `require("fs")`.
- **Module 64092** (LLM core: `mx`/`callLLM`/`$b`) is duplicated across **8 files** (2 chunks + 4 inlined routes + 2 dynamic consumers). Change all definers when editing LLM logic.
- **Safe string editing in minified bundles**: escape `'` → `\'`, `"` → `\"`, `` ` `` → `` \` ``, `${` → `\${`. Use `acorn` for precise syntax error location: `node -e "const a=require('acorn'); a.parse(require('fs').readFileSync('<file>','utf-8'),{ecmaVersion:2022})"`

## Exact commands
| Action | Command |
|--------|---------|
| Syntax check | `node --check <file>` |
| Launch app | `./Socratopia.exe` |
| ASAR extract | `npx asar extract resources/app.asar _asar_extracted/` |
| ASAR repack | `npx asar pack _asar_extracted/ resources/app.asar` |
| Fix hash after repack | `node fix-asar-integrity.js` |
| Scaffold API route | `node tools/new-route.js <name> [--methods GET,POST] [--dry-run]` |
| Smoke test (any) | `node <path-to-smoke-test>` (self-contained, no deps, no running app) |

## Edit targets per change type
| Change | Edit | Restart | Extra |
|--------|------|---------|-------|
| API route logic | `resources/server/.next/server/app/api/*/route.js` | app | `node --check`; include `*-manifest.json` in patches |
| Shared server logic | `resources/server/.next/server/chunks/*.js` | app | No `require("fs")` |
| React frontend | `resources/server/.next/static/chunks/**/*.js` | app | `node --check` |
| Electron main/preload | Root `main.js` + `preload.js` **and** `_asar_extracted/dist-electron/` | app | Repack ASAR + `fix-asar-integrity.js` |

For server/route changes, editing `resources/server/` is enough (copied to `%APPDATA%` on launch). For Electron changes, the ASAR is the runtime source.

## Smoke tests (20+)
All co-located with their module, run with `node <path>`, require no running app. Always run relevant smoke test + `node --check` on edited files after changes.

## Never commit
- `resources/settings.json` — API keys
- `resources/set.json` — teaching model config
- `resources/app.asar` — built artifact
- Real API keys or user data in any file

## Style
- Match surrounding bundled code (CommonJS IIFEs, 2-space indent, camelCase, PascalCase for models)
- Put temp work in `tmp/` or `outputs/`
- New smoke tests: `<module>-smoke-test.js` beside the module
- Commit subjects: concise imperative, focused on shipped behavior
