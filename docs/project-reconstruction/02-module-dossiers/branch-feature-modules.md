# 模块档案（合卷）：分支新增的功能模块

> 阶段 C 档案 5/…（批次 C-4b，2026-09-14）。证据 E-220 ~ E-242。
> 本文件合并归档**尚未单独建档的分支新增模块**。已完成度分级见 §0。

---

## §0 完成度分级方法（先看这个）

**量化手段**：`grep -rl "api/<route>" resources/server/.next/static/chunks/ | wc -l`。
**基线值 = 5**：仓库有 5 个主前端页面 chunk（`page-3a1fef7566e26c43.js`、`page-87daa6ca210ab9dc.js`、`page-practice-ui-20260622.js`、`-20260625-jyfix.js`、`-20260626-postclass-notes.js`）。**本体路由普遍命中 5**（E-220）→ 说明"5 = 已完整接入前端"。据此：

| 分级 | 判据 | 含义 |
|---|---|---|
| **A 已上线** | 前端引用 ≥5，或本体路由 | 用户能用到 |
| **B 部分接入** | 前端引用 1~4 | 有入口但不成体系 |
| **C 无 UI** | 前端引用 0，但 server.js 已接线 | 服务端可用，用户看不见 |
| **D 未接线** | 前端 0 且 server.js 未引用 | 死代码/实验 |

**全部 34 个路由的前端引用实测（E-220）**：命中 5 的 26 个（全部本体路由 + `practice`）、命中 2 的 `math-speech`、命中 1 的 `adaptive-teaching` 与 `tts-audio`、命中 **0** 的 `adaptive-concept-graph`、`adaptive-diagnosis`、`knowledge-source`、`long-reasoning-demo`、`test-key`。

---

## §1 练习（Practice）—— 分级 **A（唯一完整接入的新功能）**

| 项 | 内容 |
|---|---|
| 用途 | 出题 / 解题 / 讲题工作台，定位"不是搜答案，而是把题讲到你会"（E-116） |
| 路由 | `/api/practice`（前端引用 **5**，E-220） |
| 实现 | `lib/practice/` 4 个生产文件 / 2003 行：`data-layer.js`(607)、`tutoring-session.js`(298)、`source-adapter.js`、`windows-ocr.ps1` |
| 前端 | 3 个专用页面 chunk：`page-practice-ui-20260622.js`、`-20260625-jyfix.js`、`-20260626-postclass-notes.js`（**正是 E-152 的"人工命名覆盖层"**） |
| 测试 | `smoke-test.js`、`tutoring-session-smoke-test.js`、`coordinator-smoke-test.js`、`source-adapter-smoke-test.js`、`runtime-e2e-smoke.js`、`pdf-ocr-smoke-test.js`、`pdf-cmap-real-smoke-test.js`、`pdf-render-real-smoke-test.mjs`、`tutoring-session-account-scope-smoke-test.js` |
| 历史 | `e53d153`（06-18）落地；`ef5e1dc`（07-21）修集成；`cb74cdd`（master，未合入）"Scope practice data and tutoring sessions by account" |
| 状态 | **A**。但注意：**前端由 3 个日期/人名命名的补丁层叠加**，改动风险高（Q-011） |
| 风险 | 账户隔离修复 `cb74cdd` **不在当前分支**（Q-017）→ 需确认盘上是否已含该逻辑 |

---

## §2 数学语音（math-speech）—— 分级 **B**

| 项 | 内容 |
|---|---|
| 用途 | 把 LaTeX 公式转成稳定、可审计的中文数学朗读文本（E-112）。**产品动机明确**：原 TTS 把公式统一念成"这个公式"，丢失数学信息 |
| 链路 | `LaTeX → KaTeX MathML → 规范化 MathML → 数学语义AST → 词典/结构/数字规则 → semantic/structural/detailed/skip → 冻结文本` |
| 实现 | `lib/math-speech/` **24 个生产文件 / 4251 行**（分支单目录第二多），含 `latex-to-mathml.js`、`mathml-to-ast.js`、`normalize-ast.js`、`resolve-intent.js`、`symbol-scope.js`、`seal-policy.js`、`render-zh.js`、`lexicon-zh.js`、`numbers-zh.js`、`contracts.js`、`corpus/` |
| 路由 | `/api/math-speech`（前端引用 **2**，E-220） |
| 语义安全原则（E-112） | `正确且自然 > 正确但结构化 > 静默跳过 > 错误猜测（禁止）`；输出**冻结**，后续上下文只能影响未来公式 |
| 测试 | 极密集：16 个 `math-speech-*-test.js`（ast/corpus/determinism/lexicon/malformed/number/remediation/ambiguity/benchmark/manual-audit），另有 `math-speech-smoke-test.js`、`math-speech-route-smoke-test.js` |
| 文档 | `MATH_SPEECH_CORE_DEVELOPMENT_SPEC.md`(32.5KB)、`MATH_SPEECH_CORE_ACCEPTANCE_SPEC.md`(27.7KB)、`MATH_SPEECH_CORE_COMPLETION_REPORT.md`(9.2KB)、`PROJECT_MATH_SPEECH_DOSSIER/`(8 文档)、`outputs/math-speech-acceptance-round{2,3,4}/` |
| 状态 | **B**（前端引用仅 2）。这是**文档最完整、测试最密集**的分支模块，有 4 轮验收记录 |

---

## §3 PDF 精读（close-reading）—— 分级 **C**

| 项 | 内容 |
|---|---|
| 用途 | `/Close_Reading` 按需 PDF 页级精读，**刻意与课堂隔离**（不推进页码、不污染常驻 Prompt、原始证据不入库） |
| 实现 | `lib/close-reading/` 9 个生产文件 / 1003 行：`skill.js`、`command-parser.js`、`excerpt-reader.js`、`excerpt-reader-coordinator.js`、`vision-transcriber.js`、`text-normalizer.js`、`memory-candidate.js`、`index.js`、`pdf-page-worker.mjs` |
| 入口 | **命令行式**：`isCommand()` / `parseCommand()` 匹配 `/Close_Reading`、`/close_reading`、`/精读`；在 `kb-progress.js:1099-1101` 于 chat 之前拦截 |
| 前端引用 | `0` 对 `/api/*`——它**寄生在 `/api/chat` 的文本里**，没有独立路由（E-221） |
| 开关 | `改动日志.md` 称有 `closeReading.enabled` 与 `SOCRATOPIA_CLOSE_READING=false`（E-081），但**本次在 `server.js` 的 env 列表中没搜到 `SOCRATOPIA_CLOSE_READING`**（E-222）→ 待确认（Q-030） |
| 测试 | `smoke-test.js`(13 项)、`close-reading-integration-smoke-test.js`、`coordinator-smoke-test.js`、`memory-context-smoke-test.js`、`native-responses-fallback-smoke-test.js`、`ui-smoke-test.js`、`vision-budget-integration-smoke-test.js` |
| 状态 | **C**：服务端完整、有集成测试，但**无 UI 入口**（用户必须知道要打 `/精读`） |

---

## §4 多知识源检索（knowledge-source）—— 分级 **C**

| 项 | 内容 |
|---|---|
| 用途 | 外部证据来源路由，带超时/重试/可信度/降级，防止某 provider 卡死课堂 |
| 实现 | `lib/knowledge/` 7 个生产文件 / 2126 行：`source-router.js`(529)、`provider-contract.js`、`evidence-cache.js`、`evidence-normalizer.js`、`trust-policy.js`、`daimon-bridge.js` + `providers/` 6 个（`local-kb`、`rag`、`search`、`database`、`kimi-client`、`kimi-desktop`） |
| 核收指标（E-081） | R1 超时（`maxLatencyMs` 默认 45000）、R4 可观测（结构化日志）、C4 缓存可禁用、R5 重试（指数退避 500ms×2^n）、A6 `configure()` 外部配置 |
| 路由 | `/api/knowledge-source`（前端引用 **0**，E-220） |
| 配套文档 | `docs/knowledge-source-provider/{计划书,核收指标,此对话上下文}.md`（**已从跟踪删除，本工作已取回**，E-083~E-085）；`KIMI_DESKTOP_COMPATIBILITY_REPORT.md` **至今下落不明**（Q-015） |
| 测试 | `smoke-test.js`（46 cases）、`daimon-bridge-diag.js`（可能触网） |
| 状态 | **C**。工程完成度高（超时/重试/降级/可信度齐全），但用户看不见 |

---

## §5 长推理（long-reasoning）—— 分级 **C**

| 项 | 内容 |
|---|---|
| 用途 | 基于概念图谱 + 知识卡片构建"长上下文推理"提示块，做先修追溯与关联检索 |
| 实现 | `lib/reasoning/` 8 个生产文件 / 2251 行：`long-context.js`(328，`buildLongReasoningContext`/`locateFocus`/`tracePrerequisites`/`findRelated`/`kbFallbackGraph`)、`long-reasoning-batch-check.js`、`long-reasoning-build-preflight.js`、`long-reasoning-edge-audit.js`、`long-reasoning-kb-inventory.js`、`long-reasoning-long-edge-linker.js`、`long-reasoning-long-edge-review.js`、`long-reasoning-real-kb-check.js` |
| 路由 | `/api/long-reasoning-demo`（前端引用 **0**） |
| 消费方 | 仅该路由自身 + `server.js`（E-223） |
| 命名 | 路由带 `-demo` 后缀 → **自认是演示** |
| 状态 | **C/D 之间**：工具链很全（审计、盘点、预检、批量检查），但无 UI、命名即 demo |

---

## §6 OCR 与知识库构建 —— 分级 **C**

| 项 | 内容 |
|---|---|
| 实现 | `lib/ocr/` 6 个生产文件 / 1126 行：`ocr-cache.js`、`ocr-cache-v2.js`、`ocr-quality.js`、`vision-budget.js`、`rapidocr-runner.mjs`、`local-ocr-runner.mjs` + `rapidocr-v5/` 模型目录 + `fixtures/` |
| 顶层 | `kb-builder.mjs`、`kb-builder-coordinator.js`、`kb-publisher.js`、`kb-quality.js`、`pdf-ocr-coordinator.js`、`pdfjs-paths.js`、`pdf-worker.mjs` |
| 开关 | `SOCRATOPIA_LOCAL_OCR`、`SOCRATOPIA_KB_PREBUILT_MAX_PAGES`、`SOCRATOPIA_KB_DISTILL_TIMEOUT_MS`、`SOCRATOPIA_KB_DISTILL_FOREGROUND_WAIT_MS`（E-222） |
| 质量门禁 | `kb-quality.js` + "失败时不能悄悄产出一份看似成功的空知识库"（E-080） |
| 方案迭代 | `outputs/` 有 **9 个版本**的 `OCR_TRANSCRIPTION_PLAN*.md`（E-151） |
| 测试 | `ocr-*`、`rapidocr-*`、`local-ocr-runner`、`pdf-ocr-*`、`kb-*`、`strict-windows-ocr-language-*`、`textbook-import-fence-*` 等大量 |
| 状态 | **C**（由教材导入流程间接驱动，无独立 UI） |

---

## §7 同伴连续性（companion-continuity）—— 分级 **C**

| 项 | 内容 |
|---|---|
| 实现 | `lib/companion-continuity/` 3 文件 / 1097 行：`resolver.js`、`transaction.js`、`end-class-commit.js` |
| 开关 | `SOCRATOPIA_COMPANION_CONTINUITY_V1`（E-222） |
| 调用 | `server.js:996-1005` 装配；下课流程写入 |
| 测试 | `resolver-smoke-test.js`、`transaction-smoke-test.js`、`end-class-commit-smoke-test.js`、`close-reading-candidate-smoke-test.js` |
| 状态 | **C**（后台能力） |

---

## §8 语音（voice-catalog / voice-emotion-protocol / tts-audio）—— 分级 **A / B**

| 项 | 内容 |
|---|---|
| 本体部分 | `tts-audio` 路由（本体）；课堂语音由前端语音库 chunk `4137-131d0676e3b5bef7.js` 合成播放；群聊由 `/api/groupchat` 服务端调本地 `http://127.0.0.1:8000/infer_classic` 并写 `tts-cache`（E-160、E-017） |
| 分支新增 | `lib/voice-catalog.js`、`lib/voice-emotion-protocol.js`、`__VOICE_CATALOG__` / `__VOICE_EMOTION__` 全局；`角色/` 素材目录（编号 `001-八重神子`…）；`TTS_OPTIMIZATION_CHANGELOG.md`、`VOICE_MODEL_MAPPING_REPORT.md` |
| 已知同步负担 | 语音库在**前端 `4137` chunk 与服务端 `3461` chunk 内容基本重复**（E-160）；记忆条目另记"5 包同步约束" |
| 测试 | `voice-catalog-smoke-test.js`、`voice-catalog-parity-smoke-test.js`、`voice-emotion-protocol-smoke-test.js` + 7 个 `tts-*` smoke（含多个 `-live-*`，**可能触网**） |
| 状态 | **A**（用户能听到）。属**投入最集中的体验面**之一（09-12 起仍在迭代） |
| 风险 | 多副本同步；`*-live-*` 测试可能真的打本地 TTS 服务 |

---

## §9 汇总：完成度一览

| 模块 | 分级 | 依据 |
|---|---|---|
| 练习 practice | **A** | 前端引用 5 + 3 个专用 UI chunk |
| 语音 voice/TTS | **A** | 本体链路 + 分支强化，用户可感 |
| 数学语音 math-speech | **B** | 前端 2；文档/测试最完整 |
| 自适应教学 | **C**（默认关闭） | 前端 1；E-200 |
| 精读 close-reading | **C** | 无独立路由，靠 `/精读` 文本触发 |
| 知识源 knowledge-source | **C** | 前端 0 |
| 长推理 long-reasoning | **C/D** | 前端 0 + 路由自称 demo |
| OCR / KB 构建 | **C** | 随教材流程间接驱动 |
| 同伴连续性 | **C** | 后台 |
| stage-d（自适应） | **D** | server.js 引用 0 |

**总体判断**：分支共新增 7 个路由 / 237 个服务端模块 / 约 2.4 万行生产代码，但**只有 `practice` 与语音真正端到端接进用户界面**。其余大部分是"服务端完备、无 UI 入口"。

---

## §10 证据
E-220 全部 34 路由的前端引用计数（§0 表）
E-221 `close-reading` 无独立路由，入口在 `kb-progress.js:1099-1101` 文本拦截
E-222 `server.js` 全部 `process.env.*` 与 `SOCRATOPIA_*` 清单
E-223 `__LONG_REASONING__` 仅被 `long-reasoning-demo/route.js` 与 `server.js` 引用
E-224 `wc -l` 各目录生产文件规模（§1~§8 表内数字）
E-225 各模块 smoke 测试文件名清单
E-226~E-242 见 `EVIDENCE.md` P 节

## §11 待确认
- Q-030：`closeReading.enabled` / `SOCRATOPIA_CLOSE_READING` 究竟在哪读、默认值是什么。
- Q-031：`practice` 的账户隔离（`cb74cdd`）是否已在盘上生效。
- Q-032：哪些 `tts-*-live-*` / `daimon-bridge-diag` 测试真的会触网（影响"能否安全跑"）。
