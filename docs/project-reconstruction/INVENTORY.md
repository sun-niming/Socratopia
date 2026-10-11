# 资料与模块清单 (INVENTORY)

> 状态：`未检查` / `已索引` / `深入中` / `已形成文档` / `N/A(生成噪声)`
> 本文件只做**索引与状态**，细节写专题文档。
> 最后更新：2026-09-14（批次 A）

---

## 1. 顶层目录

| 路径 | 性质 | 状态 | 备注 |
|---|---|---|---|
| `resources/server/lib/` | 手写服务端源码 | 深入中 | 18 个子系统目录，核心调查对象 |
| `resources/server/.next/server/app/api/` | 编译产物：34 个 route.js | 已索引 | 阶段 C 逐个建档 |
| `resources/server/.next/server/chunks/` | 编译产物：27 个 chunk | 已索引 | 含模块 64092 重复定义 |
| `resources/server/.next/static/chunks/` | 编译产物：前端 bundle | 已索引 | 含人工命名的补丁 chunk |
| `resources/server/server.js` | 手写入口 92KB | 未检查 | 全局注入契约所在 |
| `main.js` / `preload.js`（根） | Electron 产物 | 已索引 | **运行时以 ASAR 内为准** |
| `_asar_extracted/` | ASAR 解包工作副本 | 未检查 | gitignore |
| `tools/` | 24 个维护脚本 | 已索引 | 含 smoke 矩阵、补丁器、迁移器 |
| `角色/` | 角色素材（≥10 个编号目录） | 已索引 | 用户数据还是随包资源待判 |
| `outputs/` | 研究/方案/验收临时产物 | 已索引 | 大量重复版本 |
| `tmp/` | 调试脚本与快照 | 已索引 | |
| `win-unpacked/` | 打包产物副本 | 已索引 | 与 resources/ 重复 |
| `release/win-unpacked/` | 打包产物副本 | 已索引 | 第三份 |
| `node_modules/` | 依赖 | N/A | |
| `locales/` | Electron locale | N/A | |
| `.agents/` | 空 | N/A | |
| `.codex/` | codex 配置 | 已索引 | |
| `.claude/` | gitignore | N/A | |
| `accounts/` | 用户数据 | 已索引 | 根目录副本 |

## 2. `resources/server/lib/` 子系统

| 模块 | 文件数 | 状态 | 初判职责 |
|---|---|---|---|
| `adaptive/` | 22 | 未检查 | 自适应教学（domain/orchestrator/policy/mastery/diagnostician/storage-v2/journal/stage-d 系列） |
| `close-reading/` | 15 | 未检查 | 精读 |
| `companion-continuity/` | 6 | 未检查 | 同伴连续性（end-class-commit / resolver / transaction） |
| `knowledge/` | 10 | 未检查 | 知识库证据（daimon-bridge / provider / trust-policy） |
| `markdown/` | 2 | 未检查 | progress-cursor |
| `math-speech/` | 26 | 未检查 | 数学语音合成（latex→mathml→ast→中文渲染），测试最密集 |
| `ocr/` | 16 | 未检查 | OCR（rapidocr / cache / quality / vision-budget） |
| `practice/` | 11 | 未检查 | 练习（tutoring-session / pdf-ocr / source-adapter） |
| `progress/` | 9 | 未检查 | 进度（progress-guard / kb-progress / exercise-context） |
| `reading/` | 5 | 未检查 | 自动推进 auto-advance |
| `reasoning/` | 16 | 未检查 | 长推理（long-context / batch-check / kb-inventory） |
| `resume/` | 2 | 未检查 | 续课 |
| `lib/*.js`（顶层） | ~20 | 未检查 | route-auth / local-request-auth / model-router / llm-gateway / kb-publisher / pdf-ocr-coordinator / voice-catalog / responses-api-compat / global-injection 相关 |

## 3. 根目录文档

见 `EVIDENCE.md` B 节 E-010 ~ E-034，状态与判断记录在那里，本表不重复。

## 4. API 路由（34 个 route.js）

`account` `adaptive-concept-graph` `adaptive-diagnosis` `adaptive-teaching` `chat` `companion` `concept-summary` `conversations` `custom-companions` `diary` `flashcard` `forum` `groupchat` `jump-page` `knowledge-source` `lesson-summary` `long-reasoning-demo` `math-speech` `pdf-assets` `practice` `profile` `reading-context` `search` `stats` `system` `test-key` `textbook` `tts-audio` `world`
（另有嵌套：`companion/reconcile-persona`、`custom-companions/merge-persona` 等，合计 34）

## 5. 待办：尚未检查的顶层区域
- `resources/server/.system/`
- `resources/server/public/`
- `_asar_extracted/` 全量
- `resources/bundled-content/`
- `resources/rules/`
