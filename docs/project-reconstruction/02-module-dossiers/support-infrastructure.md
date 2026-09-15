# 模块档案：支撑基础设施

> 阶段 C 档案 7/…（批次 C-6，2026-09-14）。证据 E-260 ~ E-278。
> 覆盖：模型路由、LLM 网关、Responses API 兼容、语音目录/情绪协议、KB 发布与质量、PDF/OCR 协调、缓存、错误分层、数据迁移。

---

## 1. 模型路由（`lib/model-router.js`，326 行）

**职责**：把"任务"解析成模型档位，默认走 mini，只在**内容失败**时最多升级一次。

**档位**：`weak` / `kb` / `strong` / `premium`（+ `vision`、`ocrVision` 见 `set.json`）。
**策略表（E-260，已证实）**：
```js
var ALWAYS_MINI = { ... };
var MINI_THEN_ESCALATE = { kb_build: 1, kb_distill: 1, diagnosis: 1 };
var DEFAULT_HIGH = { concept_graph: 1 };
var TASK_POLICY = { ... };
```
**升级规则**：`_toRoute(block, tier, reason, canEscalate)`；只在 **bad JSON / schema 缺口**这类内容失败时升级，**鉴权 / 配额 / 429 / 网络错误不升级**（`CLAUDE.md`）。

**消费方**：`llm-gateway.createPromptCaller({task, role, requiresJson})`（E-201 实例）。

---

## 2. LLM 网关（`lib/llm-gateway.js`，180 行）

**职责**：收拢所有模型调用入口（第二代自适应的产物，E-080）。
**API**：`createGateway(options)` → `{ createPromptCaller }`；内部 `routerFor` / `baseConfigFor` / `publicRoute` / `parseJson`；错误类型 `GatewayError(code, message, status, cause)`。
**装配点**：`server.js:934` —— `var gateway = require("./lib/llm-gateway.js").createGateway();`

> ⚠️ **与记忆条目的交叉验证点**：既往记忆记载"自建 payload 不传 `thinking:{type:"disabled"}` 会把 `max_tokens` 烧光、content 空串"（DeepSeek）。本批**未在 `llm-gateway.js` 中检索到 `thinking` 字样**（E-261）—— 合理推断该逻辑在被网关调用的下层 payload 构造处，**需在下批核实**（Q-035）。

---

## 3. Responses API 兼容层（`lib/responses-api-compat.js`，787 行）

**职责**：把 `/chat/completions` 请求改写到 `/responses`，供只支持 Responses API 的模型使用。
**锚点（E-262）**：`CHAT_COMPLETIONS_SUFFIX = "/chat/completions"`、`RESPONSES_SUFFIX = "/responses"`、`INSTALL_MARK = "__SOCRATOPIA_RESPONSES_FALLBACK_INSTALLED__"`、`isChatCompletionsUrl()`、`responsesUrl()`、`isResponsesOnlyError(status, text)`、`prefersResponses(body)`。
**装配**：`server.js` 中猴补丁 `global.fetch`（`CLAUDE.md` 的 global 表最后一行）。
**测试最密**：`responses-api-compat-smoke-test.js`、`responses-api-compat-abort-smoke-test.js`、`responses-first-contract-smoke-test.js`、`close-reading/native-responses-fallback-smoke-test.js`。

> 历史：`7b5f473 Add secure adaptive auth…` 附近的 `7b5f473`（08-19）"增加 Responses API 兼容层与专门回归测试"。`RENAME.md` 指此举推动形成"所有定义副本必须同步修改"的硬约束（E-080）。

---

## 4. 语音目录与情绪协议

| 文件 | 行数 | 要点 |
|---|---|---|
| `lib/voice-catalog.js` | 287 | `MODES = {"default","fixed","auto"}`、`FORBIDDEN_TAGS`、`EMOTION_LABELS`、`validateCatalog`、`resolveReference`、`allowedEmotionIds`、`resolveVoiceRequest` |
| `lib/voice-emotion-protocol.js` | 387 | 协议标签名 `voice`；`FORBIDDEN_TAG_TEXT`（"厌恶、disgust、disgusted、angry、生气"）；`buildPromptBlock`；流式边界处理 `OPEN_PREFIX` / `pendingPrefixLength` |

**同步负担**：语音库在前端 `4137-131d0676e3b5bef7.js` 与服务端 `.next/server/chunks/3461.js` **内容基本重复**（E-160）；另有"5 包同步"（E-240，指前端 5 个页面 bundle）。
**测试**：`voice-catalog-smoke-test.js`、`voice-catalog-parity-smoke-test.js`（明确以"parity"为名 → 专测两侧一致）、`voice-emotion-protocol-smoke-test.js`。

---

## 5. KB 发布与质量门禁

| 文件 | 行数 | 要点 |
|---|---|---|
| `lib/kb-publisher.js` | 76 | 三段式原子发布：`knowledge_base.__building__` → 校验 → `knowledge_base`，旧版移入 `knowledge_base.__previous__`；`insideTextbook()` 路径护栏 |
| `lib/kb-quality.js` | 209 | 卡片排序与校验：`conceptOrdinal` / `cardOrderKey` / `sortCards` / `teachingPhasesPreserveOrder` / `assessPdfText` |
| `lib/kb-builder.mjs` | — | 构建器本体 |
| `lib/kb-builder-coordinator.js` | 665 | 作业协调：`sameAccount` / `normalizedConfig` / `digestFile` / `createBoundedFrameReader` |

**动机（E-080 原话）**："失败时不能悄悄产出一份看似成功的空知识库。"
**开关**：`SOCRATOPIA_KB_DISTILL_TIMEOUT_MS`、`SOCRATOPIA_KB_DISTILL_FOREGROUND_WAIT_MS`、`SOCRATOPIA_KB_PREBUILT_MAX_PAGES`（E-222）。

---

## 6. PDF / OCR 协调

| 文件 | 行数 | 要点 |
|---|---|---|
| `lib/pdf-ocr-coordinator.js` | 816 | `PDF_COMMANDS = {"meta","extract","extract_adaptive","scan","render","toc"}`、`OCR_SCHEMA = "local-ocr-v2"`、`RAPID_OCR_FINGERPRINT`、错误 `codedError` |
| `lib/pdfjs-paths.js` | 16 | PDF.js 资源路径解析（本体 `pdf-worker.mjs` 的配套） |
| `lib/pdf-worker.mjs`、`lib/practice/windows-ocr.ps1` | — | 子进程 worker 与 Windows OCR 脚本 |

**开关**：`SOCRATOPIA_LOCAL_OCR`。
**测试面最宽**：`pdf-ocr-deadline-race`、`pdf-ocr-lifecycle`、`pdf-ocr-roundtrip`、`rapidocr-runner-hardening`、`ordinary-pdf-ocr-bundle`、`pdf-ocr-coordinator-hardening`、`strict-windows-ocr-language` 等（含 `.mjs`）。

---

## 7. 缓存（多处分散，无统一层）

| 缓存 | 位置 | 失效策略 |
|---|---|---|
| 规则文本 | `chat/route.js` 内存 Map | 成功 1h / 失败负缓存 30s（E-180） |
| 概念图谱 prompt | — | 缓存延长到 **24h**（`7b5f473`，E-080） |
| OCR | `lib/ocr/ocr-cache.js`、`ocr-cache-v2.js` | v2 与 v1 并存 |
| 知识证据 | `lib/knowledge/evidence-cache.js` | 可 `setEnabled(false)`（C4 指标，E-081） |
| 语音 | `%APPDATA%/…/project-data/tts-cache` | **应用退出时清理**（`before-quit`，E-107） |
| 前端页面 | 5 个 760KB bundle，1 个加载 | 见档案 `frontend-bundles.md` |

**判断**：**没有统一缓存抽象**，各模块自建，语义（TTL/负缓存/可禁用）互不一致。

---

## 8. 错误处理（统一模式：`codedError` 家族）

已证实存在的错误类型（跨模块一致的模式）：
`AuthError`（`local-request-auth.js`）、`GatewayError`（`llm-gateway.js`）、`OrchestratorError`（`adaptive/orchestrator.js`）、`PortConflictError`（`main.js`）、`codedError()`（`kb-builder-coordinator.js`、`pdf-ocr-coordinator.js`、`auto-advance.js`）。
**共性**：`(code, message, status, details)`；错误码正则约束 `^[a-z0-9_]{1,64}$`；HTTP 层由 `route-auth.errorResponse` 归一为 `{error:{code,message,status,traceId}}`。

**判断**：模式统一（这是优点），但**各模块自建类**，无共享基类。

---

## 9. 数据迁移与版本化

| 机制 | 位置 | 版本 |
|---|---|---|
| 进度游标 | `lib/markdown/progress-cursor.js` | `SCHEMA_VERSION = 2`，含 `mirrorLegacyPageFields()` 兼容旧字段 |
| 课堂任务 | `lib/progress/classroom-task.js` | `SCHEMA_VERSION = 1` |
| 自适应存储 | `lib/adaptive/storage-v2.js` + `stage-d-migration.js` | v2；`方案.md` §3.2 "不自动删除或破坏旧版 `adaptive-teaching` 数据" |
| 账户迁移 | `tools/migrate-reading-state-v2.js`、`resources/server/.system/`（未查） | — |
| 发布运行时 | `release-runtime-manifest.json` + `RUNTIME_MANIFEST_SHA256`（`main.js:35347`） | 双重哈希固定 |

**风险**：迁移脚本**不在 smoke 矩阵常规路径**，且 `stage-d-migration.js` 属于未接线模块（E-204）。

---

## 10. 重复实现汇总（本仓库的"必须同步多处"清单）

| 类别 | 处数 | 证据 |
|---|---|---|
| LLM 核心模块 64092 | **8** 处定义 | `CLAUDE.md`/`AGENTS.md` |
| 内联 account-helper | **5** 处 | E-141 |
| 前端页面 bundle | **5** 处（1 运行 + 4 镜像） | E-240 |
| 语音库 | **2** 处（前端 `4137` / 服务端 `3461`） | E-160 |
| 路由 manifest | **3** 个 | `CLAUDE.md` |
| 自适应数据层 | 2 代并存 | `data-layer.js` + `storage-v2.js` |

> **这张表是重构清单的第一手材料**，建议在阶段 E 提升为独立文档并配一致性校验脚本。

---

## 11. 证据
E-260 `model-router.js` 的 `ALWAYS_MINI`/`MINI_THEN_ESCALATE`/`DEFAULT_HIGH`/`TASK_POLICY`/`_toRoute`
E-261 `llm-gateway.js` 180 行、`GatewayError`/`createGateway`/`routerFor`/`baseConfigFor`/`parseJson`；`thinking` 字样未命中
E-262 `responses-api-compat.js` 锚点常量与函数名
E-263 `voice-catalog.js` `MODES`/`FORBIDDEN_TAGS`/`EMOTION_LABELS`
E-264 `voice-emotion-protocol.js` `TAG_NAME`/`FORBIDDEN_TAG_TEXT`/`buildPromptBlock`
E-265 `kb-publisher.js` `FINAL_NAME`/`STAGE_NAME`/`PREVIOUS_NAME`/`prepare`/`publish`
E-266 `kb-quality.js`、`kb-builder-coordinator.js` 函数清单
E-267 `pdf-ocr-coordinator.js` `PDF_COMMANDS`/`OCR_SCHEMA`/`RAPID_OCR_FINGERPRINT`
E-268 各模块 `codedError`/`*Error` 构造器与 `route-auth.errorResponse` 错误体
E-269 `progress-cursor.js` `SCHEMA_VERSION=2`、`classroom-task.js` `SCHEMA_VERSION=1`
E-270~E-278 见前引 E-080/E-081/E-107/E-141/E-160/E-204/E-222/E-240

## 12. 待确认
- Q-035：`thinking:{type:"disabled"}` 是否仍在某处构造（记忆条目 vs 本批未命中）。
- Q-036：`resources/server/.system/` 是什么（迁移产物？运行时状态？）——尚未检查。
- Q-037：是否存在**统一的缓存/错误基类**重构可行性（当前各模块自建）。
