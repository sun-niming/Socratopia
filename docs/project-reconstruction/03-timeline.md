# 开发时间线（阶段 D 视图 1）

> 状态：**初稿**（批次 B-1，2026-09-14）
> 证据引用见 `EVIDENCE.md`。凡"合理推断"必须写出依据。

## 0. 时间范围与覆盖率（先说清楚）

| 区间 | 证据类型 | 覆盖度 |
|---|---|---|
| ~2026-06-02 之前 | 几乎无（无文档、无 git） | **黑洞** — 只知道应用本体早已存在 |
| 2026-06-02 ~ 06-17 | 仅 Electron 运行时文件日期、`VOICE_MODEL_MAPPING_REPORT.md`(06-05) | 极低 |
| 2026-06-17 ~ 2026-08-30 | git 19 提交 + `RENAME.md` + `改动日志.md` | **高**（有目的、有前后行为） |
| 2026-08-31 ~ 2026-09-14 | 大量**未被 git 跟踪**的文档与工作区改动 | 中（有材料，但无提交史） |

**覆盖率结论**：能给出因果关系的是 **2026-06-17 起的近三个月**。更早的"最初愿景"证据薄弱（Q-003、Q-012）。

---

## 1. 项目的第一层事实：这是一条"魔改"分支

**已证实**（E-080，`recovered/RENAME.md` 第 5、9 行）：
> "Socratopia 最初只是一个可运行的苏格拉底式 AI 教学桌面应用；这条分支逐步把它扩展成了一个带有自适应教学、教材知识图谱、出题练习、教学进度锚定、PDF 精读、多知识源检索、长推理检查、课后记忆和本地语音优化的大型实验性学习系统。"

含义：**应用本体（Electron + Next.js 的 Socratopia 原始版本）不是本项目写的**。本项目的工作是：拿到一个已封装的成品，反编译定位接缝，注入新能力。

这解释了此后所有奇怪现象（改 bundle、无构建链、ASAR 重打包、smoke test 保底）。它**不等于**产品的"最初愿景"——原始 Socratopia 的愿景来自更上层的团队（Q-012）。

---

## 2. 时间线正文

### 2.1 史前（~2026-06-17 之前）

- **已证实**：根目录 Electron 运行时文件（`icudtl.dat`、`*.pak`、`v8_context_snapshot.bin`、`LICENSE.electron.txt`）日期均为 **2026-06-02**，`uninstallerIcon.ico` 为 2026-04-09 → 打包发生在此前后。E-040 周边。
- **已证实**：`VOICE_MODEL_MAPPING_REPORT.md` 日期 2026-06-05，内容为课堂/群聊角色语音模型映射。→ 语音改造**早于 git 起点**。
- **合理推断**：2026-06-02 那次打包是"基线成品"的来源；`Socratopia.exe` 的原始版本。

### 2.2 2026-06-17 建立补丁仓库

- `b7ad6eb Initialize lightweight patch repository`（E-002）。
- **已证实**（E-080）："将 Windows 打包产物纳入版本管理，确立了'以成品为基线、对编译结果做小步补丁'的维护方式。"
- **已证实**：同阶段语音侧最早改造 —— 产出伴语音模型映射、GPT-SoVITS 预热/推理参数/缓存、群聊语音按发言人排序派发并降并发、课堂流式播放实验；加入 `fix-asar-integrity.js` 解决 ASAR 重打包后完整性校验失效。
- **已证实（反向）**：`fix-asar-integrity.js` 曾长期被跟踪，**后在 `4f1f907` 被删除**，而当前工作区 `git status` 也记为 ` D`（未提交的删除）。

### 2.3 2026-06-18 转向自适应教学（第一次大扩张）

四个提交，同日完成：
- `6a3db1e` Spike: verify new API route registration —— **验证在打包后的 Next 里能否注册新路由**（技术可行性验证先行）
- `9f72251` Add route generator script + fix manifest formatting
- `c926129` Add adaptive teaching data layer (Prompt 2)
- `e53d153` Finalize packaged teaching feature updates

**已证实**（E-080）：一次性落地
- 课程/学生/会话/掌握度数据模型；教材概念图谱抽取与诊断代理；模型路由与高阶模型配置
- `/api/adaptive-teaching`、概念图谱、诊断、长推理实验路由
- `/api/practice` 出题/判题/提示/讲解/变式题；练习工作台前端；练习记录、错题、教学会话持久化
- 长上下文、长边连接、边审计、批量检查、构建前检查
- 教学结束后的进度恢复基础设施；面向打包产物的补丁脚本 + 成套 smoke test

**转折意义**（E-080 原话）："从这一阶段开始，项目不再只依赖一个巨型聊天 Prompt，而是尝试将'诊断—规划—教学—评价'拆成可观察、可测试的服务能力。"

> 注意"Prompt 2"这个字样 —— 说明存在按编号推进的 prompt 驱动开发流程，配套文档为 `ADAPTIVE_TEACHING_MODE_TECHNICAL_REPORT.md`（06-24）与 `PRACTICE_FEATURE_TECHNICAL_PLAN_AND_CLAUDE_PROMPTS.md`（06-24）。

### 2.4 2026-06-24 ~ 06-27 把进度钉死在教材上

| 提交 | 日期 | 目的（据 E-080） |
|---|---|---|
| `42ce3de` Restore Markdown raw-window teaching path | 06-25 | 恢复 Markdown 原始窗口教学路径，引入**进度游标** |
| `732fac0` Anchor packaged teaching progress | 06-25 | 把打包版课堂进度锚定到教材内容 |
| `1d25b3b` Add progress-guard module + end-class anchor normalization | 06-26 | 加 progress guard，统一下课进度锚点 |
| `ccebfe0` Add preview launch configuration | 06-26 | 预览启动配置 |
| `adc66db` Refine chat auto-advance handling for markdown progress | 06-26 | 修正 Markdown 进度下自动推进 |
| `f253e3a` Tighten chat teaching rules | 06-27 | 收紧课堂规则 |

**背景**（E-080）："早期功能虽然丰富，但课堂推进容易被模型自由发挥带偏。"
**形成的原则**（E-080 原话，可直接作设计约束）：
1. 模型可以组织讲法，但不能随意宣布已讲完未覆盖的内容；
2. 当前页、已读范围、阶段切换由服务端守卫约束；
3. "下课并保存"必须先完成状态绑定和进度归一化；
4. 恢复课堂时优先读持久化锚点，而非猜上下文；
5. Markdown 教材窗口与知识库抽取路径必须一致。

> ⚠️ 同期 `master` 分支另有一条提交 `cb74cdd Scope practice data and tutoring sessions by account`（无日期记录于本文件，位于 `1d25b3b` 之上），**未合并进 `codex/push`**。

### 2.5 2026-06-29 知识源 provider 化（无对应主分支提交）

- **已证实**（E-081，`recovered/改动日志.md`）：多知识源路由从单一本地 KB 扩展为 provider 架构。围绕"Phase 1 验收"修补核收指标 R1（超时控制）、R4（可观测）、C4（缓存可禁用）、R5（重试）、A6（外部配置入口）。
- 具体改动：`source-router.js` 加 `timeoutPromise` + `Promise.race` + for 重试循环 + 指数退避 + `configure()`；`evidence-cache.js` 加 `setEnabled/isEnabled`；smoke 从 39 → 46 cases。
- `KIMI_DESKTOP_COMPATIBILITY_REPORT.md`：只读调查 `%APPDATA%/kimi-desktop`，映射到 Daimon Control WebSocket `ws://127.0.0.1:62856/control`，作为 Phase 3 desktop_bridge 首选入口。
  该报告**文件本体已不在仓库中**（仅 `providers/kimi-desktop-provider.js`、`kimi-client-provider.js` 存在）。
- 配套文档 `docs/knowledge-source-provider/{计划书,核收指标,此对话上下文}.md`（435+180+164 行）**已于 `feb5ca9` 从跟踪中删除**，本批已从 git 取回至 `recovered/knowledge-source-provider/`。

### 2.6 2026-07-21 教材抽取与续接集中修复

- `ef5e1dc Repair textbook extraction and teaching progress`（有提交）。
- **已证实**（E-080）：强化 PDF 文字层/CMap/页面提取；Windows 加 OCR 降级；加知识库发布器与质量门禁；加 KB 构建进度与 SSE；修课堂结束/练习路由/阅读范围集成问题；加教材修复工具；为真实 PDF/KB 构建/下课保存/恢复加集成测试。
- **动机原话**："教材必须真的能读出来，进度必须真的能保存下来，失败时不能悄悄产出一份看似成功的空知识库。"

### 2.7 2026-08-06 ~ 08-14 `/Close_Reading` 独立精读

- **已证实**（E-081）：P1 需求实现，新增按需 PDF 精读链路，**刻意与课堂隔离**：不自动推进页码、不污染常驻 Prompt、原始页级证据不入知识库、仅显式要求才生成课后候选、有界降级。
- 改动 11 个文件（`server.js` 加载 `global.__CLOSE_READING__`，`kb-progress.js` 外层分流，`close-reading/*` 8 个模块，2 个 smoke）。
- 验证：`node --check` 全过；`close-reading/smoke-test.js` 13/13；集成 smoke 通过；`resume/smoke-test.js` 86 assertions。
- **已知验证边界（原文）**："未调用真实外部视觉 API"；"仅改服务端运行资源，无需重打 ASAR"。
- `ca07d17`（08-14）把知识 provider、Daimon bridge、证据缓存、信任策略、精读菜单纳入成品包 → "课堂内部知识"与"外部检索证据"正式连接（E-080）。同提交**把 3 个知识源文档与 CLAUDE.md 从跟踪中删除**。

### 2.8 2026-08-12 Codex 快照分叉（旁支，未合入）

`d986417`、`8bfa3af`、`5a0c495`、`feb5ca9` 四个 `Codex worktree snapshot: archive-cleanup`（均 2026-08-12，父提交分别是 `c926129`、`1d25b3b`×2、`ef5e1dc`）。
- **已证实**：`feb5ca9` 删除 `CLAUDE.md`(400行)、`docs/knowledge-source-provider/*`(3 文件)，新增 `preview-server.js`、`output/pdf/english_practical_writing_review.pdf`、`.codex/environments/environment.toml`。
- **合理推断**：这是 Codex 智能体的归档清理分支，**未合回 `codex/push`** —— 所以今天的 CLAUDE.md 是它删剩后又重新落盘的无跟踪文件。

### 2.9 2026-08-19 ~ 08-23 Responses API 兼容与鉴权

| 提交 | 日期 | 内容 |
|---|---|---|
| `7b5f473` | 08-19 | Responses API 兼容层 + 回归测试；精读视觉转录与原生 fallback；概念图谱缓存延长到 24h |
| `2c09aca` | 08-23 | 安全的 adaptive 能力令牌握手（新增 `RENAME.md`） |
| `6a91a0b` | 08-25 | 批量更新打包产物 |
| `06c0256` | 08-26 | **删除 `RENAME.md`、`改动日志.md`、rapidocr-v5 README**；新增 `adaptive/stage-d-*` 5 个模块 |
| `a86f4ca` | 08-28 | 保留会话切换时的阅读投影 |
| `4f1f907` | 08-30 | 打包行为改进；删 `fix-asar-integrity.js`、`Socratopia.exe - 快捷方式.lnk` |

- **已证实**（E-080）：LLM 核心在多文件重复内联，这类兼容改动"推动仓库形成了'所有定义副本必须同步修改'的硬约束"。
- **已证实**：`06c0256` 一次性删掉项目自己写的两份历史文档，**之后 git 里就再也看不到它们** —— 这是"信息混乱"的直接成因之一。

### 2.10 2026-08-21 前后：第二代自适应教学闭环（当时"进行中"）

- **已证实**（E-080 原文）：工作区未提交改造，试图把第一代自适应教学升级为有事务边界的闭环：`assessment-engine`、`evidence-ledger`、`mastery-engine`、`policy-engine`、`orchestrator`、`storage-v2`、`transaction-journal`、`chat-service`、`external-evidence-service`、`llm-gateway`、本地请求认证、账户上下文、Electron 能力声明、前端适配。
- 设计要点：区分"已验证作答 / 提示后作答 / 普通聊天 / 阅读 / 模型推断"的证据等级；用事务保证"回复已输出"与"状态已落盘"不互相打架。
- 配套方案：`方案.md`（99KB，标题为"自适应教学闭环实现方案"，含 Stage A/B/C/D 分期、证据体系、状态机、TurnTransaction 契约、验收场景、回滚策略）。→ **这是深挖阶段 C/E 的一手材料**。

### 2.11 2026-08-31 ~ 2026-09-14：无 git 覆盖的高强度工作期

**已证实（关键风险）**：此期间大量文档与代码改动**未被 git 跟踪**。仅 `AGENTS.md`、`方案.md`、`上下文.md`、`TTS_OPTIMIZATION_CHANGELOG.md` 等少数文件在跟踪列表中；以下全部是**盘上无跟踪文件**：
`CLAUDE.md`、`AUTO_ADVANCE_WINDOW_REPAIR_CHANGELOG.md`、`LLM_THINKING_FIX_CHANGELOG.md`、`MATH_SPEECH_CORE_*.md`(3)、`POST_CLASS_SAVE_FIX_2026-09-13.md`、`DEEPSEEK_V4_FLASH_CLASSROOM_*`(3)、`PROJECT_MATH_SPEECH_DOSSIER/`、`角色/`、`tools/`、`tmp/`、`outputs/`，以及 `resources/server/**` 的大量未提交修改。

按材料可见的主题（各条待阶段 D 细化）：
- **课堂上下文治理**（`DEEPSEEK_V4_FLASH_CLASSROOM_CONTEXT_PLAN/CHECKLIST/ACCEPTANCE`，09-12 ~ 09-13）
- **LLM thinking 修复**（`LLM_THINKING_FIX_CHANGELOG.md` 09-11）
- **自动推进窗口修复**（`AUTO_ADVANCE_WINDOW_REPAIR_CHANGELOG.md` 09-11）
- **课后保存修复**（`POST_CLASS_SAVE_FIX_2026-09-13.md` 09-13）
- **数学语音核心**（规格/验收/完成报告，09-02 ~ 09-04；`lib/math-speech/` 26 文件 + 4 轮验收目录）
- **TTS 优化与角色/情绪**（09-12 起；`角色/` 素材、`voice-catalog.js`、`voice-emotion-protocol.js`）
- **后端安全审计**（`outputs/backend-security-audit-20260901.md`）
- **OCR 方案 8 轮迭代**（`outputs/OCR_TRANSCRIPTION_PLAN*.md`）
- **角色库导入**（`tmp/import-character-library.py`、`outputs/character-import-20260913/`）

---

## 3. 方向变化（演变轴）

| 阶段 | 重心 | 触发原因（有证据的） |
|---|---|---|
| 史前 | 成品应用本体 | — |
| 06-17 | 证明"能改"：语音 + ASAR 完整性 | 需要可维护的补丁基线 |
| 06-18 | 从聊天 Prompt → 诊断/规划/教学/评价服务化 | 巨型 Prompt 不可控 |
| 06-25~27 | 进度确定性：游标、守卫、锚点归一化 | "课堂推进容易被模型自由发挥带偏" |
| 06-29 | 证据外部化：多 provider + 可信度 + 降级 | 不满足于本地上下文 |
| 07-21 | 稳定性：教材真能读、进度真能存 | 真实资料上的失败 |
| 08-06~14 | 精读隔离 + 知识连接层 | 避免污染课堂主链路 |
| 08-19~23 | 接口兼容 + 鉴权 | Responses API、多账户 |
| 08-21~ | 闭环化：证据分级 + 事务 | 第一代代理/散文件的可靠性不足 |
| 09 | 课堂上下文治理、语音/数学语音、角色库 | 成本与体验（DeepSeek 思考模式、缓存、TTS） |

**已被放弃/搁置**（有证据）：
- `local_readonly_discovery` 独立模式 —— 计划书 Phase 2 建议删除（E-081）。
- Kimi Desktop 窗口自动化 —— 降级为 fallback，首选 Daimon Control WebSocket（E-081）。
- 知识源 provider 三个配套文档 —— 08-14 从跟踪删除（Q-008）。
- `fix-asar-integrity.js` —— 08-30 删除，但工作区仍是"未提交删除"状态（E-004）。

---

## 4. 本文件仍缺什么

- git 提交的**实际 diff 内容**（目前多数描述来自 `RENAME.md` 的二手叙述，需用 `git show` 抽验若干条）。
- 2026-06-02 ~ 06-17 的确切事件。
- 08-31 之后各主题的**先后顺序与因果**（目前只有文档日期）。
- BUG 级别的记录 → 见 `04-bug-ledger.md`（未开始）。
