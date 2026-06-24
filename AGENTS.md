# Repository Guidelines

## Project Structure & Module Organization
This repository is the packaged Windows build artifact for the Socratopia Electron app, not the original TypeScript/React source tree. Edit bundled files directly.

- `main.js` and `preload.js`: root working copies of Electron main/preload code.
- `resources/server/server.js`: standalone Next.js server bootstrap.
- `resources/server/lib/`: editable helpers for adaptive teaching, practice, resume, reasoning, PDF, and model routing.
- `resources/server/.next/server/app/api/`: compiled API route bundles.
- `resources/server/.next/static/chunks/`: compiled frontend bundles.
- `resources/server/public/` and `resources/rules/`: static assets, avatars, metadata, and seeded rules.
- `tools/`: patch and route-generation utilities.

Temporary work belongs in `tmp/` or `outputs/`; avoid committing bulky runtime artifacts unless required for a patch.

## Build, Test, and Development Commands
- `./Socratopia.exe`: launch the packaged desktop app.
- `node --check <file>`: validate JavaScript syntax after editing compiled bundles.
- `node resources/server/lib/adaptive/smoke-test.js`: run the adaptive data-layer smoke test.
- `node resources/server/lib/practice/smoke-test.js`: run the practice data-layer smoke test.
- `node resources/server/lib/model-router-smoke-test.js`: run model-router assertions.
- `node tools/new-route.js <name> [--methods GET,POST] [--dry-run]`: scaffold and register a new API route.
- `node fix-asar-integrity.js`: repair the ASAR hash after repacking Electron files.

There is no root build pipeline for regenerating bundles in this checkout.

## Coding Style & Naming Conventions
Use the surrounding bundled style. Most server helpers are CommonJS IIFEs exporting plain objects; preserve that pattern. Use two-space indentation where files already do, `camelCase` for functions and variables, and `PascalCase` for data models such as `LearnerModel`. Keep comments short and reserved for non-obvious bundle or persistence behavior.

## Testing Guidelines
Prefer the nearest smoke test for the changed module, then run `node --check` on every edited `.js` file. Name new smoke tests as `<module>-smoke-test.js` beside the module. For runtime API behavior, launch `Socratopia.exe` and exercise the route or use `resources/server/lib/practice/runtime-e2e-smoke.js`.

## Commit & Pull Request Guidelines
Recent commits use concise imperative subjects, for example `Add adaptive teaching data layer (Prompt 2)`. Follow that style and keep the subject focused on shipped behavior.

Pull requests should include a short summary, subsystems touched, exact smoke tests or syntax checks run, and screenshots only for visible UI changes. Mention any ASAR repack or manifest updates.

## Security & Configuration Tips
Do not commit real API keys, local project data, or user profile contents. When changing Electron `main.js` or `preload.js`, mirror edits into the ASAR workflow, repack, and run `node fix-asar-integrity.js` before distributing.
