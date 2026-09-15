# 模块档案：自适应教学闭环（第一代 + 第二代 + stage-d 实验）

> 阶段 C 档案 4/…（批次 C-4a，2026-09-14）。证据 E-200 ~ E-214。
> **本模块是分支最大的一块（`lib/adaptive/` 10,057 行），也是"计划 / 已落地 / 实验"三种状态混杂最严重的地方。**

---

## 1. 用途与所属流程

目标：把"诊断 → 规划 → 教学 → 评价"做成可审计、可回放、可降级的闭环（E-113、E-115），替代"巨型聊天 Prompt 自由发挥"。

**但用户几乎看不见它**——前端只有极少量调用（见 §6）。属于**事实上的后台/实验能力**。

## 2. 实现位置与规模

`resources/server/lib/adaptive/` 共 30 个文件、**10,057 行**（其中约 4,300 行是 smoke test）。

**生产代码（按行数降序）**：
| 文件 | 行数 | 角色 |
|---|---|---|
| `diagnostician.js` | 1062 | 学情诊断 |
| `orchestrator.js` | 1022 | 一轮教学的准备/执行/提交协调 |
| `concept-graph-builder.js` | 932 | 教材概念图谱抽取 |
| `chat-service.js` | 526 | 把自适应决策接进聊天链路 |
| `external-evidence-service.js` | 507 | 约束练习/卡片等外部证据如何进入掌握度 |
| `data-layer.js` | 379 | 第一代数据层 |
| `transaction-journal.js` | 349 | 跨文件写入的事务日志与恢复 |
| `evidence-ledger.js` | 340 | 可追溯学习证据台账 |
| `assessment-engine.js` | 333 | 统一评估入口 |
| `storage-v2.js` | 304 | 第二代持久化 |
| `mastery-engine.js` | 233 | 据受信证据更新掌握度 |
| `policy-engine.js` | 177 | 据状态选择下一步教学动作 |
| `stage-d-metrics.js` | 176 | Stage D 效果指标 |
| `stage-d-replay.js` | 165 | Stage D 回放 |
| `stage-d-migration.js` | 109 | Stage D 迁移 |
| `stage-d-exposure-store.js` | 72 | Stage D 曝光记录 |
| `stage-d-cli.js` | 34 | Stage D 命令行 |

**路由**：`/api/adaptive-teaching`、`/api/adaptive-concept-graph`、`/api/adaptive-diagnosis`（均分支新增，E-172）。

## 3. 三代演进（**关键：三种状态必须分开看**）

`RENAME.md`（E-080）与 `方案.md`（E-113，自述 2026-08-19）区分了三代：

### 3.1 第一代（2026-06-18 落地，已上线但前端未用）
`data-layer.js`、`concept-graph-builder.js`、`diagnostician.js` + 2 个路由。
`方案.md` §2.3 第 1 条原话：**"前端没有调用任何 adaptive API，自适应能力没有进入真实课堂数据流。"**
`/api/adaptive-teaching` 当时"**仅为注册/回显桩**"。

### 3.2 第二代（2026-08-21 前后，工作区状态）
`assessment-engine` / `evidence-ledger` / `mastery-engine` / `policy-engine` / `orchestrator` / `storage-v2` / `transaction-journal` / `chat-service` / `external-evidence-service`。
设计要点（E-080）：区分"已验证作答 / 提示后作答 / 普通聊天 / 阅读 / 模型推断"的证据等级；用事务保证"回复已输出"与"状态已落盘"不互相打架。

### 3.3 stage-d（实验，**未被 server.js 引用**）
`stage-d-*.js` 6 文件约 727 行。**已证实**：`grep "stage-d" server.js` = **0 次命中**。
它们由 `06c0256`（2026-08-26）随"删除历史文档"一并加入。→ 目前只有 CLI/测试能触达，**属未接线实验**。
对应 `方案.md` §13 的 Stage D（效果评估与校准）。

## 4. 启用条件（**默认关闭 + 白名单**，E-200）

| 开关 | 值 |
|---|---|
| `SOCRATOPIA_ADAPTIVE_ENABLED` | 总开关 |
| `SOCRATOPIA_ADAPTIVE_PROFILE_ALLOWLIST` | 允许的 profile 白名单 |
| 错误文案 | `server.js:957` "Adaptive teaching is not enabled for this profile" |

与 `方案.md` §3.1 "先以默认关闭的实验能力上线"一致。

## 5. 装配（`server.js`，E-201）

`server.js` 只 require 6 个 adaptive 模块：`orchestrator`、`chat-service`、`concept-graph-builder`、`diagnostician`、`data-layer`、`external-evidence-service`。
`orchestrator` 由 `llm-gateway` 注入两个 prompt caller：
```js
builderCallLLM: gateway.createPromptCaller({ task: "concept_graph", role: "strong", requiresJson: true }),
diagnosisCallLLM: gateway.createPromptCaller({ task: "diagnosis", role: "weak", requiresJson: true }),
```
→ 概念图谱用 **strong** 模型，诊断用 **weak** 模型（成本分层，与 `model-router` 一致）。
`orchestrator` 模块导出仅 `createOrchestrator` 与 `OrchestratorError`，另有 `readiness()` 供健康检查。

## 6. 前端接入程度（**实测，E-202**）

| 路由 | 前端引用文件数 | 判断 |
|---|---|---|
| `/api/practice` | **5** | 有真实 UI |
| `/api/math-speech` | 2 | 有接入 |
| `/api/adaptive-teaching` | **1** | 仅弱接入 |
| `/api/adaptive-concept-graph` | **0** | 无 UI |
| `/api/adaptive-diagnosis` | **0** | 无 UI |
| `/api/knowledge-source` | **0** | 无 UI |
| `/api/long-reasoning-demo` | **0** | 无 UI |

那 1 处 `adaptive` 引用实际是前端通用适配器 `adaptiveFetch()`（在 `static/chunks/app/page-3a1fef7566e26c43.js`）：
调用 `window.electronAPI.getAdaptiveCapability()` 取能力令牌，带 `Authorization: Socratopia <cap>` 发 POST，失败码 `adaptive_auth_unavailable`。
→ 即**前端有认证管道，但业务上几乎没接**。与 E-116 的 `frontend-adaptive-adapter-smoke-test.js` 对应。

## 7. 与其他模块的关系

- 上游：`route-auth`（门禁）、`account-request-context`（账号）、`llm-gateway`（模型调用收口）、`model-router`（分层）。
- 平行：`external-evidence-service` 是 **practice / flashcard 通往掌握度的唯一合法入口**（防杂音污染）。
- 下游：`chat-service` → 课堂（`__ADAPTIVE_TEACHING_RUNTIME__` 在 `chat/route.js` 命中 1 次）。
- 数据：`storage-v2`、`transaction-journal`、证据台账 → 落盘于 `PROJECT_ROOT/adaptive-teaching/`（E-048 记忆条目：`adaptive-teaching/` 已 gitignore）。

## 8. 实现与验证状态

- **实现**：代码完整、结构清晰（事务、证据分级、策略引擎俱全）。
- **验证资产充足**：`adaptive-teaching-smoke-test.js`(400)、`diagnostician-smoke-test.js`(546)、`concept-graph-smoke-test.js`(535)、`chat-service-smoke-test.js`(347)、`adaptive-domain-smoke-test.js`(305)、`storage-v2-smoke-test.js`、`transaction-journal-smoke-test.js`、`adaptive-side-effect-boundary-smoke-test.js`、`adaptive-teaching-route-smoke-test.js`、`adaptive-runtime-smoke-test.js`、`adaptive-eligibility-runtime-smoke-test.js` 等。
- **本批未执行任何 smoke。**
- **未验证的层面**：以上全是**单元/契约级**。真正"课堂里有没有按自适应走"从未在本地端到端验证过（前端没接 + 默认关闭 + 白名单）。

## 9. 判断：计划 / 已落地 / 实验（回答总目标第 6 问）

| 项 | 状态 | 依据 |
|---|---|---|
| 概念图谱抽取（`concept-graph-builder`） | **已落地可用**，无 UI | 有路由、有 server.js 装配、有 535 行测试 |
| 学情诊断（`diagnostician`） | **已落地可用**，无 UI | 同上 |
| 自适应教学闭环 v2（orchestrator 等 9 模块） | **已落地但默认关闭**，无 UI | `SOCRATOPIA_ADAPTIVE_ENABLED` + allowlist（E-200） |
| `chat-service` 接入课堂 | **已接线，命中 1 次** | E-189 |
| Stage A 验收（`方案.md` §14） | 计划 | — |
| Stage B（课堂实验） | **未做/未验证** | `方案.md` §19.1 要求 Stage B 独立授权 |
| Stage C（practice/flashcard 证据接入） | **部分**：`external-evidence-service` 已写 | 无 UI 证据 |
| Stage D（效果评估与校准） | **仅写代码，未接线** | `stage-d` 0 次被 server.js 引用 |

## 10. 风险、重复与重构建议

| 项 | 说明 |
|---|---|
| **三代并存未清理** | `data-layer.js`（一代）与 `storage-v2.js`（二代）同时在树里；`方案.md` §3.2 说"不自动删除或破坏旧版数据" |
| **最大的一块却几乎无人使用** | 10,057 行 / 前端 1 处引用 → 投入产出比问题，也是"完成度"最难判定处 |
| **stage-d 死代码风险** | 未接线、无文档引用（除 `RENAME.md` 一句提及），易被后来者误认为在用 |
| **默认关闭 + 白名单** | 环境变量驱动、无前端开关，普通用户无法自助开启 |
| **重复实现风险** | `assessment-engine` 与 `evidence-ledger`、`mastery-engine` 职责边界需核对（`方案.md` §8 有模块表，可对账） |
| **建议** | 阶段 E 应先做一次"接线审计"：列出每个 adaptive 模块的**被引用者**，把无引用者明确标注为实验/待接线，再决定接入或归档 |

## 11. 证据
E-200 `SOCRATOPIA_ADAPTIVE_ENABLED` / `SOCRATOPIA_ADAPTIVE_PROFILE_ALLOWLIST` / `server.js:957` 错误文案
E-201 `server.js` 仅 require 6 个 adaptive 模块 + `createPromptCaller({task:"concept_graph",role:"strong"})` / `({task:"diagnosis",role:"weak"})`
E-202 前端引用计数（§6 表）+ `adaptiveFetch()` 实现（`page-3a1fef7566e26c43.js`，锚点 `getAdaptiveCapability`、`adaptive_auth_unavailable`）
E-203 `wc -l lib/adaptive/*.js` → 总 10,057 行；文件级行数见 §2
E-204 `grep -c "stage-d" server.js` → 0
E-205 `orchestrator.js` 导出 `createOrchestrator` / `OrchestratorError` / `readiness()`
E-206~E-214 见前引 E-080 / E-113 / E-115 / E-172 / E-189 / E-184

## 12. 待确认
- Q-027：`SOCRATOPIA_ADAPTIVE_ENABLED` 在本地部署是否被设置？谁设置？
- Q-028：Stage B（课堂实验）究竟做过没有；`方案.md` §19.1 的"独立授权"是否发生过。
- `adaptive-teaching/` 实际落盘目录是否存在内容（需看 `%APPDATA%`，本批未查）。
