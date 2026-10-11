# 工作状态 (WORKSTATE)

最后更新：2026-09-26
当前阶段：**课后笔记 v2 阶段 A~E 已完成并接线；剩阶段 F（最终集中验收，含个别真实模型验收）**
上下文使用批次：A-1~A-2、B-1~B-4、C-1~C-6、D-1、E-1~E-4、V-1~V-12、PN-V2-A/B/C/D/E

---

## 当前阶段目标（阶段 A）
建立项目地图：材料在哪、哪些支持愿景与历史、真实运行实现在哪、与外部副本关系、下一批查什么。

## 已完成

### 批次 A-1 初始勘察（2026-09-14）
- 确认仓库根、git 状态、分支、提交历史规模。
- 定位根目录全部文档、`resources/` 结构、`tools/`、`角色/`、`outputs/`、`tmp/`、`PROJECT_MATH_SPEECH_DOSSIER/`。
- 确认无独立早期产品愿景文档（Q-012）。

### 批次 A-2 地图与工作控制文件固化（2026-09-14）
- 新建 `docs/project-reconstruction/`，落盘 README / WORKSTATE / INVENTORY / EVIDENCE / OPEN-QUESTIONS / DECISIONS / RESUME。
- 汇总 14 条未决问题、4 条关键冲突。

## 本批关键确认（全部有证据，详见 EVIDENCE.md）

| 结论 | 证据 |
|---|---|
| git 历史仅 2026-06-17 起，19 提交，无 tag | E-001 E-002 E-003 |
| 兄弟副本 `Socratopia_2.0` **不存在** | E-070 Q-001 |
| 存在仓库外第三份部署 `/e/huanjing/AAA/`（用 `SOCRATOPIA_DESKTOP_DATA_DIR`，2026-07-23） | E-071 |
| `上下文.md` 讲的是**另一个 C 语言 WebServer 作业** | E-013 Q-005 |
| API 路由实际 34 个（AGENTS.md 说 28） | E-045 Q-007 |
| smoke 测试文件实际 146 个（AGENTS.md 说 20+） | E-060 Q-013 |
| ASAR 内只有 `dist-electron/main.js` + `preload.js` + `package.json`；根 `main.js` 是它的副本 | E-042 |

---

### 批次 B-1 取回被删历史材料（2026-09-14）

把 git 里仍存在、工作区已消失的文档导出到 `recovered/`，并据此写出时间线初稿。

**新增强证据**
- `E-080` `recovered/RENAME.md` —— 项目**自述开发史**《Socratopia 魔改历程》。含完整时间线、方向变化、被放弃方案、8 条工程规矩。
- `E-081` `recovered/改动日志.md` —— 知识源 Phase1/2、`/Close_Reading` P1 的逐条改动 + 验证结果 + 核收指标编号。
- `E-082` `recovered/CLAUDE-400line-2026-08.md`（400 行，8 月版指令文件）。
- `E-083`~`E-085` `recovered/knowledge-source-provider/{计划书,核收指标,此对话上下文}.md`。

**新确认的关键事实**
1. **这是一条"魔改"分支**（E-080）：应用本体是别人写的成品，本项目工作在编译产物上注入能力。→ 早期愿景需与"本体愿景"区分。
2. **git 里还有一条非主线的 Codex 归档分支**（E-091，4 个游离提交）和 `master` 上一条孤立提交（E-090）。
3. **2026-08-31 之后的工作几乎无 git 保护**（E-093）：`CLAUDE.md`、所有近期 `*_CHANGELOG.md`/`*_FIX_*.md`/`MATH_SPEECH_CORE_*`/`DEEPSEEK_V4_*`、`PROJECT_MATH_SPEECH_DOSSIER/`、`角色/`、`tools/`、`outputs/` 全部未跟踪。
4. 两次"删历史"事件：`ca07d17`(08-14) 与 `06c0256`(08-26) —— 这是文档混乱的直接成因。

**产出**：`03-timeline.md` 初稿（含覆盖率声明、方向变化轴、放弃清单）。

## 阻塞项
- ~~**Q-004**：server 部署路径矛盾~~ → **已解答（E-100，代码实测）**。
- **Q-002**：源码仓库位置未知 → 决定重构路线。
- **Q-016**：08-31 后工作无版本保护。

---

### 批次 C-1 Electron 运行时与启动链路（2026-09-14）

产出 `02-module-dossiers/electron-runtime-and-launch.md`（首份模块档案）。

**关键判决（实证，非推断）**：
- **Q-004 结案**：`prepareServerDir()` 返回 `process.resourcesPath/server`，`fork(serverDir/server.js)` —— **原地运行，不复制**。`CLAUDE.md` 对、`AGENTS.md` 错。
- **重要副作用**：应用会写自己的安装目录 —— `wipeRuntimeServerDir()`/`ensureNodeModules()` 会 rm 并重建 `resources/server/.next/node_modules`（来自 `deps.zip`）。手工放进该目录的东西可能在启动时被清掉。
- 新发现 `v109.md`（版本化变更文档）被代码注释引用，但**不在仓库**（Q-019）。
- `SOCRATOPIA_DESKTOP_DATA_DIR` 在当前 `main.js` 中搜不到（Q-020）。
- 根 `main.js` 与 `_asar_extracted` 版本**不同步**（差 45 字节）。

## 下一步（批次 C-2）

**先做一件前置工作**：划清"本体自带能力"与"本分支新增能力"的边界（`方案.md` §2.2 有线索，E-114）。这决定阶段 C 的模块归档怎么分组，也避免把本体功能记成成果。

然后按用户流程分批建档，建议顺序（每批 1~2 个模块）：
1. 账号/鉴权/请求上下文（`local-request-auth`、`route-auth`、`account-request-context`、`/api/account`、`/api/profile`）
2. 课堂主链路（`/api/chat`、`resources/rules/*`、`progress-guard`、`kb-progress`、`auto-advance`、`markdown/progress-cursor`）
3. 自适应教学（`lib/adaptive/*` 22 文件 + 3 个 adaptive 路由）—— 体量大，需再拆
4. 练习/闪卡/概念摘要/日记/总结
5. 教材导入与 OCR/KB 构建
6. 精读、知识源、长推理
7. 语音 TTS + 数学语音
8. 前端（chunk 命名机制、页面结构）
9. 支撑：model-router、llm-gateway、responses-api-compat、缓存、错误处理

其他待查：Q-015（KIMI 报告）、Q-017（master 孤立提交）、Q-018（游离提交）、Q-019（`v109.md`）。

### `方案.md` 骨架（已提取，供 B-2 定位）
`1 结论 / 2 当前系统基线(2.1三层结构 2.2可复用能力 2.3关键缺口) / 3 设计目标与非目标 / 4 闭环总体结构 / 5 证据体系(5.1-5.4) / 6 概念状态与转移规则 / 7 策略引擎 / 8 模块体系 / 9 数据存储(含 TurnTransaction 契约) / 10 API 设计 / 11 与现有课堂的集成方式 / 12 端到端逻辑链 / 13 分阶段实施(A-D) / 14 Stage A 验收场景 / 15 验证命令与完成标准 / 16 可观测性与效果指标 / 17 风险与控制 / 18 回滚策略 / 19 审批与执行边界`

## 本批新增/更新文件
- 新增：`03-timeline.md`、`recovered/`（6 个文件 + 1 子目录）
- 更新：`EVIDENCE.md`（F/G 节）、`OPEN-QUESTIONS.md`（Q-003/Q-008 进展，Q-015~Q-018）、`WORKSTATE.md`、`RESUME.md`、`README.md`

---

### 批次 B-2 产品愿景与演变（2026-09-14）

产出 `01-product-vision-and-evolution.md`。

**核心突破**：找到**原始产品愿景的一手材料** —— `resources/bundled-content/zh/initial_world/world_preset.md`（E-110）。含"天性教育法之问"、`伙伴 + 苏格拉底 = 3X · 3A`、苏格拉底实验室、九人筛选、氛围指南、成功标准。

**由此确立最重要的分析框架（E-110 + E-080）**：产品有**两层愿景**，此前一直混着：
- **L1 产品本体愿景**（原始团队，问答 Q-012 的对象）
- **L2 本仓库补丁分支的目标**（自适应/练习/精读/知识源/语音）

**关键判断（合理推断，依据充分）**：产品从 L1 的"伙伴 + 苏格拉底式自由学习"漂移到"以教材为轴、服务端强管控进度的智能课堂"。可能牺牲了 L1 明说的"允许闲聊和跑题"的日常感。**无用户研究验证**。

**新增证据**：E-110 ~ E-118（含 `方案.md` 真实编写日期 2026-08-19、`PRACTICE_...md` 明说"不建议只在打包产物上热修"）。

**修正的错误假设**：此前认为"仓库内无早期愿景材料"（Q-012）→ 已更正，材料一直随包存在，只是没去找。

---

### 批次 B-3 无源码前提 + 本体身份（2026-09-14）

- 用户确认**无源码仓库**（E-130）→ 写 `DECISIONS.md` **D-010**（硬前提），全文约束生效。
- 用户确认 2026-03~06-17 "没做什么"（E-131）、`world_preset.md` 由原始团队撰写（E-132）、无更早需求文档（E-133）。
- 发现应用本体身份（E-120/E-121）：ASAR `package.json` → `name:socratopia`、`version:2.0.0`、`description:"Socratopia — Socratic Roleplay Learning"`、`author:"Lemin"`，**含 31 项依赖清单**。
- **无任何 sourcemap**（E-123）→ 新增 Q-021（重建构建链路可行性，阶段 E 分叉点）。

### 批次 C-2 账号/鉴权/请求上下文（2026-09-14）

产出 `02-module-dossiers/account-auth-and-request-context.md`。

**关键发现**：
- 门禁设计清晰且 fail-closed：唯一公开路径 `/api/account/init`；accountId **只信令牌**，scope 从 query/body 取；13 个编译产物消费该 facade。
- **文档错误**：`CLAUDE.md` 旧版 global 表写的 `__ROUTE_AUTH__` 实际不存在，真名是 `__SOCRATOPIA_ROUTE_AUTH__` / `__SOCRATOPIA_REQUEST_AUTH__`（同一对象两个名字）。
- **第二条同步约束**：`route-auth.js` 注释明说还有 **5 份内联 account-helper 副本**，`CLAUDE.md`/`AGENTS.md` 均未记载。
- **多账户形同单账户**：`ADAPTIVE_AUTH_ACCOUNT_ID` 硬编码 `"local"`，但目录结构是 `accounts/<accountId>/`。
- 待验证风险：`server.js` 读完密钥后 `secret.fill(0)`，verifier 是否仍可验签（**未跑 smoke**）。

> 另注：用户在本批期间更新了 `CLAUDE.md`（已修正 `__SOCRATOPIA_ROUTE_AUTH__` 命名、补充 `server.js:881-900` 注入表位置、`release-runtime-manifest.json` 双重哈希固定、动态端口等）。但**第 12 行仍保留失效的 `Socratopia_2.0` 兄弟副本引用**。

## 用户补充答复（2026-09-14，E-130 ~ E-133）

| 编号 | 主题 | 答复 |
|---|---|---|
| E-130 | 源码仓库 | **无源码仓库** → 硬前提 D-010，关闭 Q-002 |
| E-131 | 2026-03 ~ 06-17 | **没做什么**；是功能注入的起始；"更多的不方便阐述" → 关闭 Q-003 主体 |
| E-132 | `world_preset.md` 作者 | **原始团队** → E-110 确立为 L1 权威材料 |
| E-133 | 更早的需求文档/设计稿 | **无** → 阶段 B 不必再找 |

**注意**：E-130~E-133 是**用户口头确认，无文件载体**，引用时须标注来源。

### 批次 C-3a 本体/分支边界（2026-09-14）

产出 `09-original-vs-branch-boundary.md`。方法：以 git 根提交 `b7ad6eb`（分支起点）为基线做差集。

**结论（定量、已证实）**：
- 基线 `resources/server/lib/` **只有 1 个文件**（`pdf-worker.mjs`）→ 现 **238 个** ⇒ **分支从零建了整棵服务端源码树**。
- 基线 API 路由 **27 个** → 现 **34**：**新增 7、删除 0**。新增的是 adaptive-concept-graph / adaptive-diagnosis / adaptive-teaching / knowledge-source / long-reasoning-demo / math-speech / practice。
- **22 个原路由被就地改写**（81%），`server.js` 已提交改动 **+1038 / −141 行**。
- 本体能力 = 世界/角色扮演/课堂/群聊/论坛/日记/闪卡/统计 —— **与 L1 愿景吻合，不是分支做的**。

**副产品**：解开 `AGENTS.md`"28 routes"之谜 —— **≈ 基线原版 27**，说明该文档疑似**上游沿用**（新 Q-023）。

**对后续的直接约束**：阶段 C 必须**本体与分支分开建档**；本体侧只写"分支改了它什么"。

### 批次 C-3b 课堂主链路（2026-09-14）

产出 `02-module-dossiers/classroom-main-chain.md`。

**三条最重要发现**：
1. **劫持式挂载**（E-184）：`kb-progress.js` 猴补丁 `Module._load`，拦截 `chat/route.js` 的 require 并包裹其 `POST`。**分支不改路由文件，而是在外层挂整条守卫链**（精读分流 → 进度守卫 → 课前准备 → 执行 → 课后提交）。→ 读 chat route 源码**看不到主逻辑**；重打包后可能**静默失效**（新 Q-026）。
2. **主规则文本无版本历史**（E-182/E-183）：中文课堂行为由 `resources/rules/rules_zh.md`（830 行）决定，而它**未被 git 跟踪**（`.gitignore` 的 `resources/rules/*`，只白名单了 compact 版）。
3. **英文/繁中课堂未在本地验证**：`rules_en_classroom_compact.md` 140 字节，正文就是 `# Test classroom rules`（测试桩）；`rules_en.md`、`rules_zh-TW*.md` 本地**都不存在**，只能走 HTTP 代理回退（新 Q-025）。

**其他**：进度体系（标记注释 `<!-- kbProgress:{...} -->` + 流式剥除 + `progress_state.json` v2 + 守卫四函数 + 课堂任务态 lecture/exercise + auto-advance 1743 行）全部为分支新增，已是课堂的实际控制层。

### 批次 C-4a 自适应教学档案（2026-09-14）

产出 `02-module-dossiers/adaptive-teaching.md`。**这是分支最大的一块：`lib/adaptive/` 30 文件 / 10,057 行。**

**关键判断（回答总目标第 6 问"哪些只是计划/实验/未验证"）**：
- **默认关闭 + profile 白名单**（`SOCRATOPIA_ADAPTIVE_ENABLED` / `SOCRATOPIA_ADAPTIVE_PROFILE_ALLOWLIST`，E-200）。
- **前端几乎没接**：7 个新路由的前端引用数实测 —— `practice` 5、`math-speech` 2、`adaptive-teaching` **1**、其余 4 个 **0**（E-202）。唯一那 1 处还是通用认证适配器 `adaptiveFetch()`，不是业务调用。
- **stage-d 6 文件（约 727 行）完全未接线**：`grep -c "stage-d" server.js` = **0**（E-204）。
- 因此：**一万行代码 + 完整测试套件，但在真实使用中大概率一次都没跑过**（待 Q-027 确认）。

**三代并存**：一代（data-layer/concept-graph/diagnostician）、二代（orchestrator/evidence-ledger/mastery-engine/policy-engine/storage-v2/transaction-journal 等）、stage-d 实验。`方案.md` §3.2 明说"不自动删除或破坏旧版数据"，所以两代数据层同时留着。

**完成度结论**：设计完整、代码完整、单元测试充足，但**接线度极低**；Stage B（课堂实验）疑似未做（Q-028）。

### 批次 C-4b 其余分支模块（合卷，2026-09-14）

产出 `02-module-dossiers/branch-feature-modules.md`。

**方法（可复用）**：`grep -rl "api/<route>" .next/static/chunks/ | wc -l`。**基线值 5** = 5 个主前端页面 chunk；**全部 26 个本体路由恰好命中 5**，证明"5 = 已完整接入"（E-220）。

**总判断**：分支新增 7 路由 / 237 个服务端模块 / 约 2.4 万行生产代码，**但只有 `practice` 与语音真正接进用户界面**。

完成度分级（A 已上线 / B 部分 / C 无 UI / D 未接线）：
- **A**：`practice`（前端 5 + 3 个专用 UI chunk）、语音 TTS
- **B**：`math-speech`（前端 2；但文档最全、测试最密，4 轮验收）
- **C**：自适应教学（默认关闭）、精读（无独立路由，靠 `/精读` 文本触发）、知识源（前端 0）、长推理（前端 0 且自称 demo）、OCR/KB 构建、同伴连续性
- **D**：`stage-d`

**关键结论**：绝大多数分支模块是"**服务端完备、无 UI 入口**"——用户看得见的分支成果远少于代码量暗示的规模。

### 批次 C-5 前端产物与"五包同步"（2026-09-14）

产出 `02-module-dossiers/frontend-bundles.md`。**解开 Q-011。**

**结论（已证实）**：
- 仓库有 5 个约 760 KB 的页面 bundle，**浏览器只加载 1 个**（`page-87daa6ca210ab9dc.js` —— 唯一出现在 `route_client-reference-manifest.js` 里的页面 chunk；非 smoke 引用 33 次）。
- 其余 4 个（`page-3a1fef7566e26c43.js` + 3 个 `page-practice-ui-*.js`）**非 smoke 引用数 = 0**，它们**不是覆盖层，而是"批量补丁目标"**。
- 机制：`tools/remediate-tutoring-ui-bundles.js` 等把 5 个文件硬编码进 `pages` 数组、逐个跑同一 `replaceOnce`（带幂等短路 + 恰好命中一次的校验）；8 个前端 smoke test 再逐个断言字符串存在以保证一致。
- **补丁面 5×，运行面 1×** → **改前端默认要改 5 个文件**。

**操作含义**：优先复用 `tools/` 现成的批量补丁脚本；查"功能在不在"只看 `page-87daa6ca210ab9dc.js`，但改必须改 5 个。

### 批次 C-6 支撑基础设施（2026-09-14）

产出 `02-module-dossiers/support-infrastructure.md`。

**要点**：模型路由（`TASK_POLICY`：`MINI_THEN_ESCALATE`/`DEFAULT_HIGH`，仅内容失败才升级）、LLM 网关（`createGateway`，第二代产物）、Responses API 兼容层（787 行，猴补丁 `global.fetch`）、语音目录/情绪协议、KB 原子发布（`__building__`→`__previous__`）、PDF/OCR 协调（`PDF_COMMANDS`/`OCR_SCHEMA`）、错误分层（`codedError` 家族，模式统一但各建各类）。

**产出"必须同步多处"清单（6 类）**：64092 ×8、account-helper ×5、前端 bundle ×5、语音库 ×2、manifest ×3、自适应数据层 ×2 → **重构清单第一手材料**。

**缺口**：无统一缓存抽象（6 处缓存语义不一）；`thinking` 字样未在 `llm-gateway.js` 命中（Q-035）。

---

### 批次 D-1 BUG 台账（2026-09-14）

产出 `04-bug-ledger.md`。**已细化 7 条 BUG + 明确列出来源可靠的"未修 8 项"（含 2 个 P1）。**

| 编号 | 一句话 | 状态 |
|---|---|---|
| BUG-0001 | 自动推进导致模型跳读整段章节（KUym 第13章事件） | 有修复代码；**C5 明确保留未修** |
| BUG-0002 | LLM 思考开关被模型名白名单静默丢弃 → 全站 JSON 任务失败 | 有修复代码 + 4 变体对照实验 |
| BUG-0003 | 课后保存失败（解析器过严 + 无截断检测） | 有修复代码 |
| BUG-0004 | 旧 KB 概念队列劫持章末习题课堂（含行号证据链） | 仅诊断，修复待核实 |
| BUG-0005 | 流式静默丢音 + 旁白混入语音队列 | 声称修复 |
| BUG-0006 | TTS 零帧成功与未处理 rejection | 有修复代码 |
| BUG-0007 | TTS 会话/并发加固 + 本地 TTS API 防护 | 有修复代码 |
| BUG-0008 | 结构化进度开关屏蔽阈值推进 | **保留未修** |

**关键自评（务必保留）**：
- 6/7 条集中在 **2026-09-11 ~ 09-13 三天**。
- **本批一条 smoke 都没跑** → 没有任何一条达到"通过针对性验证"层级。
- `outputs/backend-security-audit-20260901.md` 的**未修 8 项**（P1×2 / P2×4 / P3×2）是**当前最可核查的已知问题清单**，可整段引用到阶段 E 风险章。

### 批次 V-1 第一次实跑验证（2026-09-14）

产出 `10-verification-baseline.md`。**这是本项目历史上第一次有记录的验证执行。**

**执行前定性（按 Q-032）**：确认无真实 API、无用户数据写入、不改运行环境；TTS `-live-*` 需 `SOCRATOPIA_RUN_TTS_LIVE=1`，默认自跳过 → 安全。

**结果：145 例执行 / 140 通过 / 3 失败 / 2 跳过**（另 3 个 TTS live 自跳过）。通过率 96.6%。

**3 个失败全部可定位、可复现，且都是真实缺陷**：

| 新 BUG | 现象 | 意义 |
|---|---|---|
| BUG-0009 | `release/win-unpacked/` 缺 `lib/knowledge/daimon-bridge.js` → 该树启动即崩 | 把"多产物并存危险"从推断**升级为已证实** |
| BUG-0010 | 根 `main.js` 与 ASAR 副本差 45 字节、内容分叉；`issueAdaptiveCapability`/`ADAPTIVE_IMAGE_PATHS` **只在根副本** | 把"Electron 双副本会漂移"从推断**升级为已证实**；ASAR 是运行时真源，风险直接 |
| BUG-0011 | 前端能力助手吞掉 legacy 降级路径（`.next` 测试 :202） | 把"矩阵跳过 `.next` 导致改动缺保护"**升级为已证实**——失败正落在被跳过区 |

**本次实跑同时证实**：145 个测试自包含、不触网、不写用户数据（在无 app、无 env 条件下全部跑通）。

**回归基线已固化**：`node tools/run-smoke-matrix.js` + `.next` 补跑；后续任何改动验收不得低于 140 通过。

**仍未证实**：未启动应用 → 无端到端验证；BUG 台账 §1 的 7 条修复未逐条验证（**仍为 0 条达"通过针对性验证"**）；劫持挂载是否生效（Q-026）未确认。

### 批次 E-1~E-3 阶段 E 全部完成（2026-09-14）

产出三份：
- `05-tech-debt-and-risks.md` —— **风险登记表 R-01 ~ R-20**，含严重度/概率/证据；另列"明确不算债"的 6 项（公允记录）。
- `07-legacy-docs-assessment.md` —— 根目录 18 份文档逐份判断（有效 9 / 部分过时 1 / 历史资料 3 / 待确认 4）+ 目录级材料判断 + **新旧映射表**。
- `06-refactor-roadmap.md` —— **P0~P5 六批路线**，四类分开（文档组织 / 产品范围 / 代码架构 / 测试发布），每条含问题+证据、影响、目标范围、依赖、风险工作量、验收条件、回滚、优先级理由。

**路线核心判断**：
- **当前最贵的不是架构，是"改动没有保护"**。故 P0 是止血而非重构。
- **P0 三件事零到极低风险**：① 纳入版本控制 ② 固化回归基线 ③ **让 smoke 矩阵覆盖 `.next`**（约一行改动，把风险最高的 25 个测试纳入保护）。
- P5 的"评估重建构建链路"**只做评估、不承诺重建**。
- 明确"不做"清单：不新增功能、不大搬迁、不假设可重建、不删文档、不重写巨石模块。

**旧文档评估结论**：本仓库经历过两次"删历史"，故**默认倾向保留**；`RENAME.md` 与本次整理是同一件事的两次尝试，不冲突（前者为史料，后者为索引）。

### 批次 E-4 收口与校验（2026-09-14）

- 产出 `11-completion-report.md`（实际覆盖 / 未覆盖 / 执行过的验证 / 结论保质期 / 无敏感数据与无副作用确认）。
- **追溯性校验**：各文档引用的 `E-nnn`（218 个）与 `Q-nnn`（48 个）对照定义表 → **悬空为 0**；新增 `EVIDENCE.md` §V 补齐 38 个原悬空编号。
- **文件存在性校验**：README 引用的文件全部存在（3 处初判 MISS 为相对路径假阳性，已复核）。

**本轮总产出**：专题文档 11 份 + 模块档案 7 份 + 控制文件 7 份 + 取回史料 6 份 ≈ 293 KB；证据 226 编号；BUG 11 条；风险 20 条；路线 21 条；未决问题 48 条。

### 批次 V-2 BUG 逐条验证（2026-09-14）

产出 `12-bug-verification-round.md`。**§1 的 7 条历史 BUG 全部升级为 `通过针对性验证`。**

| BUG | 验证方式 | 结果 |
|---|---|---|
| 0001 | 文档 §五的 10 个 smoke + 3 文件语法 | 10/10 PASS + 3/3 OK |
| 0002 | 7 文件修复点核对 + `end-class-llm-smoke-test` | 全到位 + PASS（单元级） |
| 0003 | `outputs/post-class-save-fix-20260913/verification.json` 6 项 + 相关测试 | 日志全在且 PASS |
| 0004 | **意外**：修复已落地，4 条精确回归断言 | 全 PASS |
| 0005/0006/0007 | 前端 voice smoke + 4 个 `-live-`（打本地 TTS `127.0.0.1:8000`） | 全 PASS |

**两个副产品**：
1. **Q-049 结案**：`tmp/patch-asar-integrity.js` 是**重写加强版**（幂等、正确哈希算法），非副本 → **BUG-0010 解除阻塞**，但工具躺在 gitignore 的 `tmp/` 里。
2. `tmp/llm-thinking-probe.js`、`tmp/llm-budget-probe.js` **已消失**（文档仍引用）→ 印证 R-02。

**重要观察**：7 条全部带有匹配的、精确到根因的回归测试 → **问题在组织，不在修复能力。** §1 可从"待验证风险"降级为"已验证的历史修复"。

### 批次 V-3 端到端实况取证（2026-09-14）

应用**已在运行**（PID 39712，server 18:32 启动；17:00 后无代码改动 → 加载的是当前代码），故未启动也未杀进程，直接读日志 + 探活。产出 `13-live-e2e-smoke.md`。

**正面（此前"推断"升级为"运行实证"）**：
- 全部模块启动加载成功（含 5 个 knowledge provider、23 情绪音色、continuity enabled）
- 动态端口 **13713**（再次证实 `AGENTS.md` 的 "3000" 错误）
- **鉴权 fail-closed 生效**：无令牌 `POST /api/chat` → 401 `auth_missing` + traceId；公开路径 `/api/account/init` 放行
- **Q-026 结案**：劫持挂载在真实运行中生效（`[kb-progress]` 198 次）
- **BUG-0002 补全为含运行时的通过验证**（`applied=true` ×190 / `applied=false` ×0；模型名 `DeepSeek-V4.1-Flash` 证明修复必要）

**新缺陷 BUG-0012（当前可复现，真实使用中）**：16 次 EPERM 丢失课后进度保存（09-11~09-14，每天 3~5 次），根因定位到 `auto-advance.js:142-156` 重试仅 5 次/≈375ms（对比 `kb-progress.js` 10 次/≈1.1s），且 `PROGRESS_SAVE_FAILED` 静默（计数 0）。
**教训**：BUG-0001 的 10 个测试全绿却没覆盖 Windows 跨句柄竞争 → **"通过针对性验证" ≠ "真实环境无残留"**。

### 批次 V-4 BUG-0012 修复（2026-09-14）——**本轮首次改业务代码**

产出 `14-bug0012-fix.md`。**Q-051 结案（竞争者定位）**：
- 竞争者 = `chat/route.js:917` 的 `prefetchCandidate({...}).catch(...)`——**未 await 的后台预取**，与同轮前台收尾**并发写同一个 `textbook_index.json`**。
- auto-advance 的 `withLock` 只序列化自身 11 个入口，**kb-progress 不在锁内**；两侧各靠重试对抗且**预算不一致**（5 次/≈375ms vs 10 次/≈1.1s）→ 短的先崩。

**修复**：`auto-advance.js` 重试 5 次 → **10 次 ≈1.4s**（对齐 kb-progress），1 行 + 说明注释。
**回归测试**：新增 `auto-advance-atomic-write-retry-smoke-test.js`（注入 EPERM 重命名风暴）。**判别力已证明**（修复前场景 1 FAIL、失败栈与生产同形；修复后 2/2 PASS）。
**验证**：相关 9 测试全 PASS；矩阵 121/117/2/2（基线 120/116/2/2，失败项相同）；`.next` 24/1 一致 → **零回归**，合计 146/141/3/2。
**生效**：服务端原地加载，**重启应用即生效**（当前运行实例仍是旧代码）。
**未完成**：① 真实课堂验收（须重启后观察）② `PROGRESS_SAVE_FAILED` 仍静默（Q-052）③ 结构根治（两模块各写同一文件互不协调）。

## 待办总览（后续批次）
- [x] A-1~A-2 项目地图
- [x] B-1 取回被删历史材料
- [x] B-2 产品愿景与一手材料
- [x] B-3 无源码硬前提 + 本体身份
- [x] B-4 信息混乱根因分析
- [x] C-1 Electron 运行时（Q-004 结案）
- [x] C-2 账号 / 鉴权 / 请求上下文
- [x] C-3a 本体/分支边界（定量）｜[x] C-3b 课堂主链路
- [x] C-4a 自适应教学｜[x] C-4b 其余分支模块（合卷）
- [x] C-5 前端产物 + 5 包机制（Q-011 结案）
- [x] C-6 支撑设施
- [x] D-1 BUG 台账（7 条细化 + 8 项未修）
- [x] E-1 技术债与风险｜[x] E-2 旧文档判断｜[x] E-3 重构路线｜[x] E-4 收口校验
- [x] V-1 实跑验证基线（145 例 / 140 通过 / 3 失败）
- [x] V-2 逐条验证 §1 的 7 条修复（**7/7 升级为通过验证**）
- [ ] **D-2** 时间线细化（`git show` 补 §3 附录 8 提交根因；核实 Q-039）
- [x] **V-3** 端到端实况取证（应用已在运行；新发现 BUG-0012）
- [ ] **待授权执行路线 P0**：A1 纳入版本控制 / D1 固化基线 / C1 矩阵覆盖 `.next` / A2 指令文件主从
- [ ] **BUG-0012 真实验收**：重启应用后跑若干真实课堂轮次，确认 `post-response progress save failed` 归零
- [x] BUG-0012 有过一次修复（V-4，重试加宽）；[ ] **但 V-5 判定该修复无效**，需按 R-23/Q-054 的方向重做；[ ] P1 其余：BUG-0009/0010/0011
- [ ] 补缺口：本体原件模块建档（forum/search/stats/system 等）、前端页面构成、`角色/` 清点


## 2026-09-14 课后笔记 JSON 解析错误排查

- **现象**：生成课后笔记提示 `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`。
- **证据**：`logs/socralab_debug.log` 记录 `/api/concept-summary` 在托管模式（`hosted=true`）调用模型时失败；直接探测 `https://deepseek.nwafu.edu.cn/v1/chat/completions` 返回 HTTP 403 `text/html` 页面（网页标题为学校站点拦截页）。
- **根因**：托管调用同时携带 `strong.baseUrl`。共享 `callLLM` 先解析出托管代理，随后无条件用传入 `baseURL` 覆盖，导致托管请求绕过本地代理并命中被拦截公网地址。
- **修复**：在 4 个实际包含该 LLM 定义的 bundle/route 文件中，将 baseURL 覆盖条件改为仅在 `!q.isHosted` 时执行；同步修改 `chunks/1576.js`、`chunks/4092.js`、`concept-summary/route.js`、`flashcard/route.js`。其余路由副本未包含该精确实现，已核对。
- **验证状态**：已完成静态替换和变更核对；当前 shell 未安装 `node`（`node: command not found`），因此语法检查和 smoke test 待在带 Node 的运行环境执行。

## 2026-09-14 第二轮修复：托管模式仍被 BYOK 分支抢占

- **新证据**：重启后日志仍显示 `hosted=true`，但请求继续命中 `https://deepseek.nwafu.edu.cn/v1/chat/completions`。
- **根因**：`callLLM` 的 provider 解析先执行 `if (w && x) return ...`。本机全局 settings 存在 API Key 和 endpoint 时，该条件成立，托管 session 分支永远到不了；此前的 `!q.isHosted` 修复只能处理已进入托管分支后的覆盖问题。
- **修复**：将 BYOK 快速返回条件增加托管排除：`!(c?.accessMode === "hosted" && c?.sessionToken) && w && x`，同步所有包含该 LLM 定义的 server bundle/route 副本。
- **验证限制**：当前 shell 仍无 `node` 命令；待带 Node 的环境执行语法与 smoke test。应用需再次重启以加载修改。

## 2026-09-14 第三轮修复：强制 hosted 配置优先

为避免运行时 hosted 对象字段异常或被其它参数污染，BYOK 快速分支进一步收紧为仅在没有任何调用上下文 `c` 时生效（`if (!c && w && x)`）。lesson/concept summary 传入 hosted 上下文时将必然落入托管分支。

## 2026-09-14 最终根因确认与回退

- **复现闭环**：使用当前 `resources/settings.json` 的 key 对 `https://deepseek.nwafu.edu.cn/v1/chat/completions` 发起真实 POST，故障时返回 HTTP 403、`text/html`、学校站点拦截页；次日再次用完全相同配置探测，恢复为 HTTP 200、`application/json`。当前 endpoint 存在间歇性网关/访问控制异常。同一 key 对 `https://api.nwafu-ai.cn/v1/chat/completions` 返回 HTTP 401，因为它不是该网关对应的 key。
- **对照证据**：使用同目录备份配置中的另一把 key 对 `api.nwafu-ai.cn` 发起相同 POST，返回 HTTP 200、`application/json`，含有效 `choices`。因此当前 key 已失效（或不属于当前网关），当前 endpoint 也不是可用 API 入口。
- **结论**：课后笔记 JSON 错误是当前上游网关间歇性返回 HTML 403 后，被 `concept-summary` 内嵌的 `response.json()` 误报为 JSON 解析错误；不是 lesson-summary、React、缓存、webpack 模块加载或 hosted 分支优先级问题。
- **代码处理**：回退本轮三次错误的 bundle 分支改动，避免改变普通调用语义。另确认 `concept-summary/route.js` 自带的 `64092` 仍直接调用 `response.json()`；因此 HTML 403 被显示成 `Unexpected token '<'`。这是次级的错误呈现缺陷，不是生成失败的根因。
- **后续动作**：短期可在网关恢复后重试；长期应让 `concept-summary` 先按文本读取响应并识别 HTML/Content-Type，向界面返回明确的上游错误。若要求在该网关长时间 403 时仍能生成，需要配置独立可用的备用 endpoint 与对应 key；代码无法把学校拦截页转换成模型结果。

## 2026-09-15 课后笔记超时与截断修复

- **新现象**：界面提示 `This operation was aborted`。
- **时间证据**：`/api/concept-summary` 于 `02:05:19.816Z` 发起，`02:08:19.823Z` 中止，耗时 180.007 秒，精确命中路由传给 `callLLM` 的 `timeoutMs: 180000`。
- **请求规模**：80 条消息、20,003 个正文字符；网关计量为 14,078 prompt tokens；原配置允许 8,192 output tokens。
- **重试证据**：第二次请求的第一轮耗时约 150 秒并返回 HTTP 200，但 `message.content` 为空；自动第二轮耗时约 126 秒，返回 5,836 字符的不完整 JSON，在数组中途截断，最终解析失败。
- **受控探测**：同样 80 条消息与当前模型，`max_tokens=2048` 在 16.5 秒返回；`max_tokens=4096 + response_format=json_object + 1800 字符约束` 在 64.5 秒返回 HTTP 200、完整 JSON、`finish_reason=stop`。
- **根因**：DeepSeek-V4.1-Flash 在 `thinking: disabled` 下仍可能生成大量 reasoning；课后笔记采用非流式请求，8,192 token 输出预算会显著拉长等待，并增加空 content 或 JSON 截断概率。
- **修复**：`concept-summary/route.js` 将最大输出降为 4,096 tokens，启用 `json_object` 响应格式，并要求整份 JSON 不超过 1,800 字符；同时将 abort 与 HTML JSON 解析异常映射为可操作的中文提示。
- **回归测试**：新增 `concept-summary-response-budget-smoke-test.js`，先在旧实现上失败，再在修复后通过。

## 2026-09-15 课后笔记质量与可靠性开发方案

- **需求**：在不牺牲长课笔记质量的前提下解决 HTML、超时、空 content 和 JSON 截断问题；所有修改点和运行阶段必须留痕；避免频繁测试。
- **方案文件**：`POST_CLASS_NOTES_QUALITY_RELIABILITY_DEVELOPMENT_PLAN.md`。
- **目标架构**：短课单次结构化生成；长课按完整问答轮次分片提炼、保存检查点，再合并为 3,000～5,000 字符的完整中文笔记；最终合并失败时由片段证据确定性组装降级结果。
- **留痕设计**：PN-001～PN-012 变更编号、job/traceId、JSONL 运行日志、quality.json、阶段验证 manifest、改前/改后哈希和精确回滚 patch。
- **测试频率**：限定为 A～F 共 6 个集中门禁批次；全 smoke matrix 只在最终阶段运行一次；真实模型仅做一次短课和一次长课验收。
- **当前状态**：仅完成方案编制，尚未开始 v2 实施；当前 4,096-token、1,800 字符止血限制继续生效，直到 v2 长课路径通过最终门禁。

## 2026-09-15 课后笔记 v2 实施（方案 §10 A~F 阶段）

> 方案：`POST_CLASS_NOTES_QUALITY_RELIABILITY_DEVELOPMENT_PLAN.md`
> 本次范围（用户指定）：**只做阶段 A~C，停在路由接入（阶段 D）之前**。
> 留痕规则：每个改动点使用方案 §9.1 的 PN 编号；每阶段只跑一次集中门禁（§11）。

### PN-013 新增模块 `post-class-notes/provider.js`（方案 §4.1 表外补充）

- **时间**：2026-09-15
- **目标**：把方案 §6.1 的"先读 text、再判 Content-Type、再分类"落到可单测的手写模块。
- **根因/设计依据**：方案 §6.1 要求文本优先读取；而内嵌 `callLLM`(64092) 直接 `response.json()`，HTML 拦截页必然被误报为 JSON 语法错误。若只把 `callModel` 作为依赖注入，`response.json()` 缺陷会原样带进来。
- **边界**：**provider 解析（provider/key/baseURL/hosted 头）仍留在编译 route**，因为它依赖 `__SOCRATOPIA_SETTINGS__` 与每次请求的 hosted 上下文；手写侧只负责"发请求 + 读响应 + 分类错误"。
- **修改文件**：`resources/server/lib/post-class-notes/provider.js`（新增）、其 smoke。
- **风险**：与 64092 的行为可能漂移（json mode / thinking 字段）。控制：只服务课后笔记一条链路，参数由调用方显式传入。
- **回滚方法**：删除该文件即可，无调用方（阶段 D 才接线）。

## 阶段 A：固定基线与回滚材料（PN-V2-A）

### PN-V2-A 基线与回滚材料

- **时间**：2026-09-15T03:12Z ~ 03:19Z
- **目标**：不改任何业务行为，固化基线、回滚材料与缺陷登记。
- **改前证据**：应用正在运行；`socralab_debug.log` 中 `02:05:19.816Z → 02:08:19.823Z` 精确 180.007s abort；`content:null` + `reasoning` 完整；重试 5836 字符截断。
- **根因/设计依据**：见 `04-bug-ledger.md` §1d BUG-0013（结构层五条成因）。
- **修改文件**：
  - 新增 `outputs/post-class-notes-v2/baseline-20260915T031249Z/`
  - `docs/project-reconstruction/04-bug-ledger.md`（新增 §1d BUG-0013）
  - `docs/project-reconstruction/EVIDENCE.md`（新增 §Z，E-PN-001~010）
  - `docs/project-reconstruction/WORKSTATE.md`（本条目）
  - **业务代码零改动**
- **修改摘要**：保存 6 个目标文件的 sha256 与 before 副本、248 行未提交 patch、日志证据摘录、阶段门禁结果。
- **数据兼容性**：无。
- **风险**：无（只读采集）。
- **回滚方法**：删除 `outputs/post-class-notes-v2/` 与文档条目即可。
- **本阶段验证命令**：
  ```text
  node --check resources/server/.next/server/app/api/concept-summary/route.js
  node --check resources/server/server.js
  node resources/server/.next/server/app/api/concept-summary/concept-summary-format-smoke-test.js
  node resources/server/.next/server/app/api/concept-summary/concept-summary-markdown-smoke-test.js
  node resources/server/.next/server/app/api/concept-summary/concept-summary-response-budget-smoke-test.js
  ```
- **结果与退出码**：**5/5 PASS，全部 exit=0**（`results.json`）。
- **产物目录**：`outputs/post-class-notes-v2/baseline-20260915T031249Z/`
- **尚未验证**：真实长课端到端（属阶段 F）；应用当前运行实例为旧代码。
- **阶段门禁**：**通过（1/1 批次）**。

### 基线哈希（改前锚点，位于 baseline/before.sha256）

| 文件 | sha256 前 16 位 | 字节 |
|---|---|---:|
| `.next/server/app/api/concept-summary/route.js` | `c747e1bc26f78c08` | 34,400 |
| `resources/server/server.js` | `10b3b21c64d4367f` | 92,232 |
| `resources/server/smoke-test-utils.js` | `e12df62452fc2a23` | 14,783 |
| `docs/project-reconstruction/WORKSTATE.md` | `7a057af49bc75e9c` | 33,923 |
| `docs/project-reconstruction/04-bug-ledger.md` | `8dd7c035325d6938` | 22,202 |
| `POST_CLASS_NOTES_...PLAN.md` | `1e4feadc256bcb0c` | 31,952 |

## 阶段 B：实现纯逻辑核心（PN-001/002/003/005/013）

- **时间**：2026-09-15T04:00Z ~ 05:58Z
- **目标**：完成分片、schema、错误分类、质量评分四个纯逻辑模块，**不接入真实路由**。
- **产物目录**：`outputs/post-class-notes-v2/stageB-20260915T055000Z/`
- **阶段门禁**：**12/12 PASS**（5 个模块 `node --check` + 6 个模块 smoke + 1 个共享工具回归复跑）。
- **接线状态**：无任何编译产物 require 这些模块 → 对运行中的应用**零影响**。

### PN-001 `partitioner.js` — 消息清洗、token 估算与保轮次分片

- **修改文件**：`resources/server/lib/post-class-notes/partitioner.js`（新增）、`partitioner-smoke-test.js`、`fixtures/generate-fixtures.js` + 6 个 fixture JSON。
- **关键设计**：`sourceIndex` 保留原始数组下标，供证据引用 `sourceMessageIndexes`；一轮 = 一条学习者发言 + 其后的伙伴发言，**整轮不可切开**；相邻片段重叠 1 轮。
- **校准证据**：生产实测 20,003 字符 → 网关计量 14,078 tokens（0.70 tok/char）。估算器 CJK 记 1、其他记 1/3.5，smoke 断言在该规模下漂移 ≤25%。
- **fixture 规模**：`long-80` 7,444 tokens / 2 片；`stress-160` 14,277 tokens / 4 片。
- **尚未验证**：真实课堂的分片边界质量（属阶段 F）。

### PN-002 `schema.js` — 两级 schema、宽松 JSON 抽取与 markdown 归一化

- **修改文件**：`resources/server/lib/post-class-notes/schema.js`（新增）、`schema-smoke-test.js`。
- **关键设计**：
  - `parseJsonLoose` 返回 `{ok, value, truncated}`；**截断必须显式暴露**，这是方案 §6.2「截断不得当作成功保存」的判定依据；
  - 括号配平按 `{}`/`[]` 栈闭合，字符串内的花括号不提前结束扫描；
  - `repairBackslashes` 只修非法 JSON 转义（`\(` → `\(`），保留合法 `\n`；
  - `normalizeMarkdown` 从现有 route 逐字移植（围栏换行修复 / `\(...\)` 数学 / 裸语言名开栏），保持与既有笔记一致的呈现；
  - 最终 summary 保留前端已有的 8 种 section 类型，未知类型丢弃并计入 warnings。
- **兼容性**：`generationMeta` 之外的额外字段（`sourceMessageIndexes`）旧前端忽略即可，无需迁移。

### PN-003 `errors.js` — 上游错误分类与 §6.2 重试矩阵

- **修改文件**：`resources/server/lib/post-class-notes/errors.js`（新增）、`errors-smoke-test.js`。
- **关键设计**：**HTML 拦截页与 JSON 401/403 必须分开** —— 前者是间歇性网关故障（重试 1 次、延迟 3s），后者是配置错误（不重试）。
- **留痕安全**：`bodyPreview` 截断到 160 字符并压成单行；`toPublicError` 对未编码错误一律回落 `internal_error`，不泄漏原始 message。
- **红→绿**：初次遗漏 `upstream_timeout` 的重试策略，与方案 §6.3 矛盾 → 已补 `{attempts:1, delayMs:1000, jitterMs:1000}`。

### PN-005 `quality.js` — 质量评分与确定性降级

- **修改文件**：`resources/server/lib/post-class-notes/quality.js`（新增）、`quality-smoke-test.js`。
- **关键设计**：
  - 评分权重与方案 §7.3 逐项一致；`sourceIntegrity < 1` **无条件降级为 repair**；
  - `assembleDegraded` 按 §3.5 做确定性组装：同名概念去重（而非按片段堆叠）、复习题取 3～5、学习轨迹按证据顺序；
  - 降级结果经 `schema.validateSummary` 校验并单独评分 —— smoke 断言其分数 ≥ repair 门槛，证明"保底笔记"确实可用。
- **红→绿**：重复率原按"最相似一对"计，把共享套话的正常概念判成 100% 重复 → 改为 §2.3 的「重复 section 比例」口径（阈值 0.85）。

### PN-013 `provider.js` — 文本优先的单一上游调用

- **修改文件**：`resources/server/lib/post-class-notes/provider.js`（新增）、`provider-smoke-test.js`、`resources/server/smoke-test-utils.js`（MockLLM 扩展）。
- **关键设计（本方案的核心修复点）**：内嵌 `callLLM`(64092) 直接 `response.json()`，HTML 拦截页必然变成 `Unexpected token '<'`。本模块按 §6.1 顺序：`text()` → 记录 status/content-type/字节/耗时 → 分类 → 再解析 envelope。
- **边界**：**provider 解析（key/baseURL/hosted 头）仍留在编译 route**；手写侧只负责"发请求 + 读响应 + 分类"。
- **不重试**：本模块只发一次；重试记账统一由 orchestrator 按 §6.2 承担。
- **测试证据**：22 个场景全部通过（含 HTML 403、200+HTML、非 JSON 200、空 content、`finish_reason=length`、外部 abort、超时、DNS 失败、连接拒绝、API key 不出现在返回结构）。
- **共享工具改动**：MockLLM 新增 `setRawResponse` 与 async generator 支持 → 已复跑真实消费者 `chat-teaching-progress-format-smoke-test.js`，零回归。

### 阶段 B 已知缺口

- `provider.js` 与 64092 的参数行为（json mode / thinking 字段）存在**双份实现**，需在阶段 D 接线时用同一组参数做一次对齐核对。
- 真实模型从未被调用；所有断言基于 fixture 与 MockLLM。

## 阶段 C：检查点与 orchestrator（PN-004/006/014）

- **时间**：2026-09-15T??Z ~ 14:50Z
- **目标**：完成可恢复的生成任务，**不修改前端、不接入路由**。
- **产物目录**：`outputs/post-class-notes-v2/stageC-20260915T145000Z/`
- **阶段门禁**：**23/23 PASS**（16 个文件 `node --check` + 7 个模块 smoke，一次集中执行）。
- **接线状态**：`server.js` **未**注入 `__POST_CLASS_NOTES__`；编译产物不引用新模块 → **运行中的应用行为零变化**。
- **稳定性**：orchestrator smoke 在修掉终态竞态后**连续 6 次 PASS**（此前为间歇性失败）。

### PN-004 `checkpoint-store.js` — 原子写、断点续跑、清理与 single-flight

- **修改文件**：`resources/server/lib/post-class-notes/checkpoint-store.js`（新增）、`checkpoint-store-smoke-test.js`。
- **目录结构**（方案 §5.1，全部落在 `<concept-summaries>/.jobs/<conversationId>/<jobId>/`）：`job.json` / `partition.json` / `chunks/*.json` / `quality.json` / `trace.jsonl`。
- **原子写**：临时文件 → `fsync` → `rename`，**整段序列重试 10 次（20ms 线性退避 ≈ 1.1s）**，对齐 `kb-progress.js` 的既有预算；`write-file-atomic` v7 不重试 rename（E-411），故手写。非 EPERM 错误立即上抛，不白等。
- **不毁旧笔记**：只有新笔记成功落盘才替换旧文件；smoke 用注入的持久失败验证「旧笔记仍可读」。
- **路径防逃逸**：`conversationId` / `jobId` 走与编译 route 相同的 `[\/\]|\.\.` 守卫；`removeTree` 拒绝删除 store 之外的路径。
- **清理**（§5.4）：成功 7 天、失败 14 天、每会话最多 5 个 job；**清理器永不删除正式笔记**。
- **single-flight**：同 key 的并发请求共享同一 promise，失败不污染 key。
- **尚未验证**：真实 Windows 句柄竞争下的 rename 表现（阶段 F 实机验收）。

### PN-006 `orchestrator.js` — 任务状态机

- **修改文件**：`resources/server/lib/post-class-notes/orchestrator.js`（新增）、`orchestrator-smoke-test.js`、`prompts.js`。
- **状态机**：`created → partitioning → mapping → reducing → validating → persisting → ready|degraded`，另有 `retry_wait`（隐含于退避）与 `cancelled`；**只有 ready/degraded 才写正式笔记**。
- **短课/长课分流**：≤40 条且 ≤8000 tokens 走单次 direct 调用；否则按教学轮次分片，并发上限 2，每片成功即写检查点。
- **成功者的可观测性承诺**：**终态状态最后发布** —— 先写笔记、再写 trace、最后发终态并落 `job.json`。这样"观察到 ready"就等价于"笔记已落盘且 trace 完整"。
- **一次定向修复**：`job.repairs` 预算，schema 不合格与质量分偏低**共用同一次**修复机会（方案 §7.3 的"一次"）。
- **降级**（§3.5）：reduce 失败或某片永久失败时，用已成功片段确定性组装笔记并标记 `degraded`；只有"无任何检查点"才判 `failed`。
- **保存失败特例**（§5.2）：`persist_failed` **不重新调用模型**，保留检查点，`retry` 只重跑合并阶段（smoke 断言 retry 后调用序列恰为 `["reduce"]`）。
- **幂等与续跑**（§5.3）：幂等键 = accountId+profileId+worldId+conversationId+sourceHash+pipelineVersion；已完成直接返回、运行中返回同一 jobId、部分完成**只补缺失片段**（smoke 断言仅重新提取 chunk-002）。
- **预算**（§6.3）：软上限 5 分钟停止新重试、硬上限 8 分钟、单 job 调用数上限 40；`Retry-After` 被真实 sleep 尊重（smoke 断言 ≥12s）。
- **调用次数上限**：smoke 断言**单个模型请求最多 2 次上游调用**，与 §6.2 末句一致。
- **留痕纪律**（§9.2）：trace 只写计数、状态、耗时、HTTP 状态与用量；smoke 用 fixture 原文片段反查，断言 trace / job.json **不含课堂正文**，且不含 key。

### PN-014 `prompts.js` — 三种模型角色的提示词

- **修改文件**：`resources/server/lib/post-class-notes/prompts.js`（新增）。
- **三个角色**：`direct`（短课：完整对话 → 完整笔记，沿用现有 route 已验证的 8 类 section 规范）、`map`（单片 → 只抽证据）、`reduce`（证据 → 合并笔记）、`repair`（定向修复）。
- **从提示词层强制证据链**：concept 与 key-insight 必须带 `sourceMessageIndexes`，编号来自正文行首 `[n]`；"补不上编号就不要写"。
- **篇幅改为自适应**：不再出现 1,800 字符上限，改为按有效消息数给出目标区间（§7.1），并明说"不要为凑长度而注水"。

### 阶段 C 修掉的 4 个真实缺陷（红→绿，详见 manifest.json）

1. **不可解析输出永远走不到定向修复** —— `requestJson` 直接抛错，修复逻辑不可达。改为返回 `{ok:false, reason}` 由 `finalizeNote` 统一决策。
2. **每个 job 可以修复两次** —— 与 §7.3 不符且调用数翻倍。加 `job.repairs` 预算。
3. **终态竞态（间歇性）** —— 被取代的运行仍能覆盖新运行的终态；`PCN_DEBUG=1` 打开日志后竞态窗口改变，症状消失，是典型时序缺陷。修法：`job.runToken` 所有权令牌 + 所有状态写入点 `superseded()` 守卫；`retry`/`start` 先夺权。**这条是本次最有价值的发现**。
4. **已发布终态但仍在收尾的运行被当作"正在运行"** → `retry` 被静默吞掉，任务永不重启。改为 `runtimes.has && !TERMINAL[status]`。

另有 1 个顺序缺陷：**终态状态先于 trace 与 job 文件发布**，导致观察到 ready 时留痕尚未完整 → 调整 `persistNote` 顺序。

### 阶段 C 已知缺口

- `resume` 依赖调用方重新提供原始消息（分片边界是确定性的，但消息不在 job.json 里 —— 这是**隐私选择**：job 目录只保存状态与计数）。阶段 D 的 route 必须把 `messages` 一并传给 `retry`。
- `prompts.js` 的 `direct` 规范与现有编译 route 内置提示词**目前是两份**；阶段 D 接线后以 `prompts.js` 为准。

### 阶段 D 交接清单（未执行，仅记录前置依赖）

阶段 D 需要做且**当前尚未做**的事：

1. `resources/server/server.js` 的 `__loadOptionalGlobal__` 表新增
   `["__POST_CLASS_NOTES__", "./lib/post-class-notes/orchestrator.js", "[post-class-notes] Orchestrator"]`；
2. 编译 route `concept-summary/route.js` 收缩为薄适配层：鉴权、参数校验、构建 `callModel`（provider 解析仍留在 route 内）、调用 orchestrator、返回结果；
3. route 必须把 **`messages` 一并传给 `start`/`retry`** —— orchestrator 不保存原始正文（隐私选择），续跑依赖调用方重新提供；
4. `start` 返回的 job 是**异步**的：route 需要提供 `status`（轮询）与 `cancel`，并且 GET 单笔/GET index 的既有契约保持不变；
5. route 缺少 `global.__POST_CLASS_NOTES__` 时 **fail-closed**，返回稳定错误码 `missing_dependency`；
6. 三处一致性问题需要在接线时对齐：`prompts.js` 的 direct 规范 vs 编译 route 现有内置提示词；`provider.js` vs 模块 64092 的 json mode / thinking 参数；`schema.normalizeMarkdown` vs route 内 `ab()`（当前是逐字移植，接线后应删掉 route 内那份）。

### 阶段 D 的三个已核实障碍（2026-09-17）

不是猜测，全部在盘上核对过：

**D1｜只做阶段 D 会当场打断在用前端（最严重）**

`static/chunks/app/page-87daa6ca210ab9dc.js` 的 POST 处理是**同步**的：

```js
let{summary:s}=await n.json();S({kind:"ready",summary:s})
```

且**当前没有任何轮询**（该 chunk 只有 2 处 `setInterval`，与概念笔记无关）。改成异步 job 后 POST 返回的是 `{jobId,status,traceId,...}`，`summary` 为 `undefined`，界面会直接空白。

两条路，必须选一条：
- **路线甲**：阶段 D 让 route 阻塞到终态再返回 `{summary}`（契约不变，前端不动），进度体验留到阶段 E；
- **路线乙**：D+E 合并交付。

**D2｜三个现有 smoke 与 route 内部实现强耦合，收缩 route 就会红**

| 测试 | 依赖的 route 内部字符串 |
|---|---|
| `concept-summary-format-smoke-test.js` | 按字符串下标切出 `function ab(a){` … `let K=` |
| `concept-summary-markdown-smoke-test.js` | 切出 `function ab(a){` … `}\nlet K=`（**锚点含真实换行**，极脆） |
| `concept-summary-response-budget-smoke-test.js` | `maxTokens:4096`、`responseFormat:"json_object"`、中英文 1800 字符提示、两条错误文案 |

即：删掉 route 内的 `ab()`、`K` 常量或那两条文案，这三个测试立刻失败。阶段 D 必须**同时**决定：保留这些内部结构，还是一并改写三个测试。

**D3｜前端补丁面是 5 个 chunk，不是 1 个（影响阶段 E）**

五个页面 bundle 含**完全相同**的同步调用点（各命中 1 次），沿用 `tools/remediate-tutoring-ui-bundles.js` 的批量补丁模式。方案 §8 写的是"当前实际加载的前端 page chunk"，实际要按 5 处改。

### 本轮结束时的仓库状态

- 业务运行代码**零改动**（`resources/server/server.js`、`resources/server/.next/**` 均未改）。
- 唯一被修改的既有文件是 `resources/server/smoke-test-utils.js`（MockLLM 增量扩展）。
- 新增全部集中在 `resources/server/lib/post-class-notes/`（23 个文件，含 6 个 fixture）。
- 观察到的仓库外变化：`win-unpacked/` 整棵树在 2026-09-15T04:26Z 被整体重写（疑似一次 `stage-clean-win-release` 运行），**与本轮改动无关**，本次未触碰该目录。

### D1 决策（2026-09-17）：走路线乙 —— D+E 合并交付

- **决策**：阶段 D 与阶段 E 同批交付，POST 保持**异步 job + 前端轮询**，不做"route 阻塞到终态"的临时契约。
- **理由**：不留"后端已异步、前端仍按同步读 `summary`"的不一致窗口；进度体验一次到位。
- **代价**：批次变大，D 不能再单独验收；中间态必须一起验。
- **对 D2/D3 的影响**：D2 照常处理（三个 smoke 必须与新 route 对齐）；D3 从"阶段 E 的注意事项"升级为**本批必做**（5 个 bundle 一起改）。

---

## 2026-09-18 批次 V-5：BUG-0012 真实验收 —— **未通过**，根因推翻重写

> 证据 E-431 ~ E-440。产出：`14-bug0012-fix.md`（新增验收附录 §9~§13）、`outputs/bug0012-livelock/repro.js`；
> 同步修改 `04-bug-ledger.md`、`05-tech-debt-and-risks.md`（新增 R-23、改写 R-21）、`OPEN-QUESTIONS.md`（改正 Q-051、新增 Q-054/Q-055）。

### 结论一句话
**上轮的修复（把 EPERM 重试预算 375ms → 1.4s）已确实生效，但在结构上不可能有效，失败没有实质下降。**

### 数据
| 窗口 | chat | EPERM | 失败率 |
|---|---|---|---|
| 生效前 | 152 | 17 | 11.2% |
| 生效后（09-14 15:33Z ~ 09-18） | 85 | 6 | 7.1%（n=85 不显著） |

### 决定性证据：时延
生效后 6 次失败的"距上一条带时间戳日志行"时延为 **1250/1253/1255/1257/1265/1270 ms（极差 20ms）**；
生效前 18 次为 328~610ms。旧退避 250ms、新退避 1125ms —— 差值吻合。
**离散度只有 20ms** ⇒ 每次都**烧光整条预算才抛**，不是撞上随机外部占用。

### 根因（推翻上轮结论）
1. 两侧写入器（`auto-advance.js`、`kb-progress.js`）**都是纯同步**，同进程两个同步写不可能交叠 → 上轮"并发写导致 EPERM"的说法不成立。
2. 真正机制：**同步重试（`Atomics.wait`）阻塞事件循环**；若持句柄的是**同进程的异步 fs 任务**，其 fd 只能由 JS 续体 `close()`，续体在阻塞期间永远跑不到 → **自锁**，必然烧光预算。
3. 本机已复现（`outputs/bug0012-livelock/repro.js`：无持有者→首次成功；异步持有者→40 次全耗尽 / `holderClosed=false`）。

### 下一步（**需用户授权才能动业务代码**）
- 修复方向按性价比：① 读者改同步读（最小） ② 失败者让出事件循环 ③ 共享写入器/统一锁。**不要再加长预算。**
- 新验收标准：**看时延特征**（成功应远小于 1125ms；失败不再集中于 1255ms），不能只看失败率。
- 待查 Q-054（谁持有句柄）、Q-055（还有多少处同模式）。

### 仍未闭合
Q-052（失败对用户无声）、BUG-0009/0010/0011、§2 的 8 项未修、D-2 时间线细化。

---

## 2026-09-20 批次 V-6：BUG-0012 方向①落地（3 处异步读改同步读）

> 证据 E-441 ~ E-449。产出 `15-bug0012-reader-sync-fix.md`。**用户授权动业务代码。**

### 做了什么
把**读 `textbook_index.json` 的异步读改成同步读**，让读者不再留跨 `await` 的 fd，自锁窗口归零：
1. `lib/companion-continuity/transaction.js` `readTextOrNull()`
2. `lib/companion-continuity/end-class-commit.js` `readText()`
3. `.next/server/chunks/2751.js` `y()`（五条路由共用）

**未改**写入器、`atomicWrite` 语义、重试预算数值。

### 验证（零回归）
- 三个改动文件 `node --check` 通过；相邻 4 个 smoke 全 PASS。
- 新回归断言（场景 3：同进程打开句柄 ⇒ 抛 EPERM）3/3 PASS —— 钉死 R-23，防后人再加预算。
- 全量矩阵 **129/128/1**（唯一失败=本地 TTS 未运行，环境）；`.next` **28/27/1**（失败=既有 BUG-0011）。
- **本轮改动造成的回归 = 0。**

### 意外观察（非本轮所为）
**BUG-0009 / BUG-0010 已由外部修复**：`release/win-unpacked/.../daimon-bridge.js` 已存在；
`main.js` 与 `_asar_extracted/dist-electron/main.js` 均 1388110 B。时间落在 2026-09-15~09-20 之间（2026-09-20 观察到）。
**未取 commit 证据 → 记为"观察到已修复"。**

### 下一步
- **等生效后的真实课堂样本**：验收看**时延特征**（成功应远小于 1125ms；失败不再整齐聚在 1255ms），**不看失败率**。
- ⚠️ 若失败时延**仍**整齐聚在 1255ms → 还有别的异步持有者（回 Q-054），或改走方向②/③。
- 仍需重启应用才有新样本；重启前记得：三处都是原地加载文件，重启即生效。

## 阶段 D + E：server 注入 / route 接入 / 前端轮询（PN-007/008/009，2026-09-18）

> 按 D1 决策**合并交付**（路线乙）。批次变大，但不存在"后端已异步、前端仍按同步读 summary"的中间窗口。
> 阶段门禁：**D 16/16 PASS**、**E 22/22 PASS**。

### PN-007 `server.js` 注入 `__POST_CLASS_NOTES__`

- **修改文件**：`resources/server/server.js`（`__loadOptionalGlobal__` 表新增一行，带 `pipeline: post-class-v2` 加载日志）。
- **单入口**：注入目标是 `lib/post-class-notes/orchestrator.js`，并**转出** `createProvider` / `createStore` / `errors` / `getOrchestrator`。编译 route 因此**不需要自己 `require` 相对路径**——只碰 `global.__POST_CLASS_NOTES__`，与方案 §4.2 一致。
- **orchestrator 进程内单例**：`getOrchestrator` 按 `storeRoot` 缓存。这是必需的，不是优化——`runtimes`（在途 AbortController）与 `jobsById` 是进程内状态，按请求新建会让 status 轮询认不出自己的 job、让双击去重退化为"重新开始"。
- **回滚**：删掉表里那一行即可；route 会 fail-closed 返回 `missing_dependency`。

### PN-008 `concept-summary/route.js` 收缩为薄适配层

- **修改文件**：route（34400 → 21969 字节）、3 个同目录 smoke、新增 `concept-summary-route-integration-smoke-test.js`。
- **契约**（`action` 字段）：`start` / `status` / `cancel` / `retry`。
  - `start` 200 + `{jobId, traceId, status, stage, progress, completedChunks, totalChunks}`；命中缓存笔记或短课占位时**直接带 summary**（省一次往返）。
  - `status` 带 jobId 精确查询；**不带 jobId 时返回该会话最新的 job** —— 这是"关页面再回来"的续查入口。
  - 失败分两层：job 级失败仍是 HTTP 200 + 稳定 `code`；参数/鉴权/模块缺失走 400/404/503。
- **删除 route 内的提示词常量 K/L/M/N/O/P 与内联解析/写盘** → `prompts.js` 成为唯一真相。
- **保留 `ab`/`aa`**：GET 读盘仍做 markdown 归一化，旧笔记继续能读。
- **provider 解析仍留在 route**（依赖 `__SOCRATOPIA_SETTINGS__` 与每请求 hosted 上下文），复刻旧 `callLLM` 的 baseURL/apiKey 兜底后再交给 `provider.js` 发请求。

### PN-009 前端改为轮询 + 阶段文案 + 错误码

- **修改文件**：5 个 page chunk、新增 `tools/patch-post-class-notes-ui.js` 与 `post-class-notes-ui-smoke-test.js`。
- **动手前先定位到的硬约束（D3）**：5 个 bundle 含**完全相同**的同步调用点，方案 §8 只写了"当前实际加载的 chunk"。按 `tools/remediate-tutoring-ui-bundles.js` 的 `replaceOnce` 模式批量打，脚本幂等、恰好命中一次。
- **行为**：start → 轮询 status（1.5s → 30 秒后 3s → 失焦 8s）；五阶段文案三语内联（不依赖 i18n 字典，避免给 4 个语言包补键）；错误按稳定 code 映射三语文案并附短 traceId；`degraded` 正常渲染 + 一行轻提示。
- **两个只在真机路径上才暴露的设计点**：
  1. **PCRUN 令牌**：新一次生成或组件卸载都会让在途轮询作废，防止旧响应覆盖新状态。
  2. **终态但读不回笔记**不能裸渲染 —— 否则 `summary.sections` 直接 crash。前端转成可重试的 coded error；后端对应地在 `status()`/`latest()` 里把这种 job 降级为 `failed/resumable`（见下）。

### 阶段 D/E 期间补掉的两个真实缺陷（服务端）

1. **`failIfStale`** —— 非终态但进程内已无 runtime 的 job（典型：服务端重启过）此前会永远停在 `running`，`latest()` 会一直把它当成"正在运行"。现在首次被看见即降级为 `failed/resumable` 并留 `job_interrupted` trace；`retry` 随后复用检查点续跑。
2. **`noteForTerminal`** —— `ready` 但笔记文件读不回来的 job 不再裸发布：降级为 `failed/persist_failed/resumable`，避免前端在 `summary.sections` 上崩。

两条都补了 smoke（新增 3 个场景，orchestrator smoke 共 25 个）。

### D2 的处置

方案 §10 阶段 D 要求"把 route 收缩为薄适配层"，而 3 个现有 smoke 通过**字符串下标切 route 源码**（`function ab(a){` … `let K=`）。处置：

- `concept-summary-format-smoke-test.js`：切片改为哨兵 `Q=(0,y.pW)` 定位后 `lastIndexOf("}")` 回退——不再依赖相邻语句的空白写法；并断言末字符必须是 `}`。
- `concept-summary-markdown-smoke-test.js`：同样改为回退到补齐花括号（原来是 `}let K=` / `}\nlet K=` 两个候选，其中一个依赖真实换行）。
- `concept-summary-response-budget-smoke-test.js`：**重写语义**——预算已搬到 orchestrator，断言改为"route 是薄适配层（含 `__POST_CLASS_NOTES__`/`getOrchestrator`/`createProvider`、不含 `w.callLLM(`）+ 限额仍等于 §6.3 + §7.1 自适应长度取代 1800 字符 + §8.3 三语文案仍在"。
- **红→绿**：format smoke 首次改完先 PASS 后 FAIL——切片尾部残留 `let `，sloppy 模式下 `let ;` 先被当标识符后当表达式。已由"回退到 `}`"确定性修掉，连续 3 次 PASS。

### 本轮末状态

- 应用**需重启**才能加载新 route 与新 server.js（服务端原地加载，产物不落磁盘到别处）。
- 真实模型调用与真实课堂端到端**仍未做**（属阶段 F）。
- 真实浏览器视觉确认**未做**：DOM 级断言有 smoke 覆盖，像素级没看。

### 阶段 D 交接清单：已全部处置（2026-09-18 结清）

| 条目 | 处置 |
|---|---|
| D1 只做 D 会打断前端 | 走路线乙，D+E 合并交付 |
| D2 三个 smoke 与 route 内部强耦合 | 两个改锚点、一个重写语义（详见上文） |
| D3 前端补丁面是 5 个 chunk | 按 5 处批量打，脚本幂等 |
| 清单第 1~5 条（注入行 / 薄适配 / messages 透传 / status+cancel / fail-closed） | 全部落实 |
| 清单第 6 条（三处重复实现需对齐） | `prompts.js` 已成唯一真相；`provider.js` 参数由 route 显式传入；route 内 `ab` 仅服务于 GET 读盘 |

**仍未做（属阶段 F）**：真实短课/长课各一次真实验收、`.next` 手工补跑清单、`tools/run-smoke-matrix.js` 全量一次。

---

## 2026-09-25 批次 V-7：最新一节完整课堂复盘

> 证据 E-450 ~ E-465。产出 `16-live-lesson-review-20260925.md`。**只读日志 + 盘上代码，未改业务代码。**

### ✅ 最重要的正面结论：BUG-0012 真实验收**通过**
- 该节课 `post-response progress save failed` = **0 次**；修复后累计 **115 轮 / 0 次**（修复前 255 轮 / 25 次 = 9.8%，泊松 p≈1.2e-5）。
- 三处方向①改动复核仍在盘。**建议再观察一周后正式关闭。**

### 🔴 新发现（详见 §1e 与 `16-…md`）
- **BUG-0014（高）**：`thinking` 注入判据写死 `/^deepseek/i` → 09-23 换成 `gpt-5.6-terra` 后**再没发过 thinking**（09-25 全 52 轮 `applied=false`）；三处防"reasoning 吃光 max_tokens"的护栏**一起失效**。且 `/responses` 协议不认 `thinking` 只认 `reasoning`。**影响面 7 个 64092 定义文件 + 3 个 lib。**
- **BUG-0015（中）**：`lesson-summary` 3× 连接超时（10s 打在慢主机上）+ 1× abort，对用户无声。
- **BUG-0016（中）**：连续 6 轮 `taught_page_regressed` → C3 页级降级 → 窗口无法推进（**C5 现象的现场**）。首要待办：rejected 时打双方页码。

### 观察项
上下文长期超预算（42060>28000）、窗口每轮恒定被截断、前端 4 分钟高频轮询、KB 提炼 238 秒。

## 2026-09-25 批次 V-8（并行会话，课后笔记线）：课后笔记 v2 首次真机复盘

> 证据 E-466 ~ E-478。产出 `17-post-class-notes-live-review-20260925.md`（**已改写为纯客观报告，不含优先级判断，供决策输入**）。**只读日志与盘上代码，未改业务代码。**
> 同一节课的其他功能面在 V-7（`16-live-lesson-review-20260925.md`）；本批只覆盖课后笔记 v2。

### 结论一句话
**机械部分全绿，但 4/4 job 全部降级、零 ready。** 根因不在 v2 结构，而在换模型后"关思考"整条链路断了。

### 🔴 BUG-0017（P0，本批最重要）
`gpt-5.6-sol` → `responses-api-compat.js` 改写到 `/responses`（改写日志与我们的请求相差 1ms）→ 兼容层只映射 `reasoning`/`reasoning_effort`、**不映射 `thinking`** → reasoning 常开 → 单片 80~86 秒紧贴 90 秒上限 → 约半数分片超时；而超时重试**不缩短预算**，同一请求再撞一次 → 片永久失败 → job 降级。
与 BUG-0014 同源不同路：那条是编译产物判据导致不发 thinking，本条是手写 `provider.js` 发了却被吞，**且无日志可见**。

### 另三条实现级缺陷
- **BUG-0018**：新建 job 字面量漏 `modelCalls: 0` → `NaN` → 调用预算恒不触发（job.json 记 `null`）。
- **BUG-0019**：`cleanup()` 有定义无调用 → `.jobs` 无界增长。
- **BUG-0020**：降级笔记 6,736 字符 vs 3,000~4,000 目标（`lengthFitness=0.27`），且 `warnings=[]`、质量分看不见缺片（0.909 掩盖了 25% 内容缺失）。

### 正面（要写下来，避免下一批只盯着坏的）
trace 洁净（无 key / 无课堂正文）、fail-closed 鉴权、超时分类正确、**检查点真的救回了 3/4 片**、前端轮询与错误码按设计（8~9s 是失焦分支不是 bug）、笔记确实从 1,800 字符止血压制恢复到 6,736。

### 修复优先级（未执行）
1. `provider.js` 在 `thinking===false` 时同发 `reasoning:{effort:"low"}`（或让 compat 做映射）—— 治根因；
2. 超时纳入 `shortenTarget`；
3. 90s 单次超时按实测 p95 重定，或先做并发 1 路对照；
4. 补 `modelCalls` 初始化 + 接入 `cleanup()`；
5. `assembleDegraded` 感知目标长度，降级时把缺片写进 warnings。

---

## 2026-09-25 批次 V-9：BUG-0016 可观测性落地（用户授权）

> 证据 E-500 ~ E-504。**第三轮改业务代码。**

### 做了什么
`resources/server/lib/progress/kb-progress.js`：
- 两处 `reject(reason)` → `reject(reason, detail)`；
- `taught_page_regressed` 与两处 `taught_page_outside_loaded_range` 现在带
  `{ reportedPage, recordedPage, loadedRange }`；
- 调用点 `console.warn("[kb-progress] marker rejected:", reason, detail)` 一并打印；
- `validatePageMarker` 里 `previousPage` 上移，使 outside-range 也能带上"已记录页"。

新增 5 条断言进 `kb-progress-smoke-test.js`。**实测日志形态**：
```
[kb-progress] marker rejected: taught_page_regressed { reportedPage: 10, recordedPage: 12, loadedRange: '10-14' }
```

### 为什么只改这个
BUG-0016 已连续 6 轮复现却**无法定案**（日志只有一行光秃秃的 reason）。加两个字段成本极低、零风险。
**根因不在这轮定案——等下一节课的日志。**

### 验证
四个 kb-progress 相关 smoke 全 PASS。全量矩阵首跑 132/131/1（复跑 132/132/0），首跑唯一失败 `kb-inflight-contract-smoke-test.js`
经 3 次独立复跑均 PASS → **判为 flake**（该测试内含 6s 等待，负载敏感，且与本次改动模块无关）。

### 同时：Q-056 结案（用户口述）
`gpt-5.6-*` **默认开启 reasoning** → **BUG-0014 由"定时炸弹"升级为"正在发生的浪费"**：
推理在跑，而三处防"reasoning 吃光 max_tokens → content 空串"的护栏全部失效。
**修法据此确定，尚未动手**（需再授权，影响面 7 个 64092 定义文件 + 3 个 lib）。

## 2026-09-25 批次 V-9：FIX-0017 ~ FIX-0020 实施

> 依据 `17-post-class-notes-live-review-20260925.md` §8 的方案执行。产物 `outputs/post-class-notes-v2/fix-20260925T120000Z/`。
> 方法：每个 FIX 先补测试确认红灯 → 再改实现转绿；全部完成后集中跑一次门禁（遵循方案 §11 的测试频率约束）。

### 改动（4 个 FIX，6 个文件）
- **FIX-0017**：`responses-api-compat.js` 的 `chatRequestToResponses()` 增加 `thinking` → `reasoning` 兜底映射（显式 reasoning/reasoning_effort 仍优先；两种入参形态都兼容）。
- **FIX-0018**：`orchestrator.js` 新建 job 字面量补 `modelCalls: 0`。
- **FIX-0019**：新增 `sweepCheckpoints()`，挂在全部终态落盘点，fire-and-forget + catch。
- **FIX-0020**：降级组装收 `targetRange` 并逐档压缩；写 warnings（含缺片）；新增 `chunkCompleteness` 并按比例折减 score —— **口径由用户在动手前选定"缺片计入 score（折减）"**。

### 实施中另外发现并修掉
`assembleDegraded` 的 `atFullDetail` 被循环覆盖 → 压缩已发生却报 "assembled at full detail"。

### 门禁与回归
- 相关模块 9/9 PASS、语法 6/6 OK、`.next` 手工补跑 9/9 PASS
- 全量矩阵 **132 / 130 通过 / 0 失败 / 2 跳过**，与改动前最近基线（2026-09-25T19:28，132/130/0/2）一致 → **零回归**
- ⚠️ **教训（已写进产物 results.json）**：首次矩阵报 2 个假失败（`chat-auth-contract`、`close-reading-integration`），原因是与 `.next` 手工测试**并行**执行；两者单独重跑各 3/3 通过。**矩阵不要与其它测试并行跑。**

### 未验证（需你重启应用后跑一节长课）
1. **FIX-0017 的实际收益**：分片耗时是否降到 90 s 以下 —— 这是把报告 C-2 从推断升级为结论的唯一对照；
2. FIX-0020 在真实 18 概念 / 缺 1 片规模下的产物长度；
3. 前端是否要把 `generationMeta.warnings` 展示出来（当前仍是统一降级提示文案，未接具体 warnings）。

---

## 2026-09-26 批次 V-10：BUG-0014 判据由模型名改为能力（用户授权）

> 证据 E-505 ~ E-512。产出 `18-bug0014-thinking-gate-fix.md`。**第四轮改业务代码。**

### 做了什么
`/^deepseek/i` 改为 `/^(?:deepseek|gpt-5\.6)/i`，**10 个文件 17 处全覆盖**：
7 个模块 64092 定义文件（`chat`/`concept-summary`/`flashcard`/`companion-reconcile`/`custom-companions-merge` 五条 route + chunks 1576/4092）
+ 3 个手写 lib（`llm-gateway.js`、`kb-builder-coordinator.js`、`kb-builder.mjs`）。
配套：`unsupportedOptionalField` 加入 `"reasoning"` 兜底；新增 `lib/thinking-gate-smoke-test.js`（4/4 PASS）。
未改判据以外的语义，未动写入器。

### 分工（重要）
字段「发出来后没人认」那一半由**并行会话**的 FIX-0017 于 09-25 19:40 解决（compat 映射 thinking→reasoning）。
本轮补的是「压根没发出来」。两者必须同时具备才有意义。

### 验证
syntax 10/10 通过；compat 系 4 测试 PASS；`.next` 30/29/1（失败=既有 BUG-0011）；
矩阵 133/132/1 与 133/133/0（唯一失败 `pdf-ocr-priority` 已证为无关 flake，8 次独立复跑失败 2 次）。

### ⚠️ 验收未完成
现模型已切回 `DeepSeek-V4.1-Flash`（老判据本就命中）→ 日志 `applied=true` **不能区分修复前后**。
**必须等切到 `gpt-5.6-*`**：届时应为 `[chat] thinking=enabled applied=true model=gpt-5.6-…`（修复前为 `applied=false`）。

### 已知 flake 已增至 3 个（非产品缺陷）
`kb-inflight-contract`（6s 等待）、`pdf-ocr-priority`（`delay(30)` 时序假设），以及并行会话记录的 `chat-auth-contract`。

---

## 2026-09-26 批次 V-11：BUG-0016 根因定案 + 阶段一/二修复（用户授权）

> 证据 E-513 ~ E-518。方案与实施记录：根目录 `AUTO_ADVANCE_PAGE_ONLY_STALL_FIX_PLAN.md`。**第五轮改业务代码。**

### 背景
09-26 课堂（会话 `l8CSY0K4pq761mzn_LSNy`，KUyw《编译原理》648 页，无 knowledge_base）窗口 70–75 讲完后**无法自动推进**：delta 9 爬升中、`structuredTeachingProgress=true`、`pageOnlyTeachingProgress=true`、`lastTaughtPage=75`、candidate 76–91 已预取却等不到装载指令。**V-9 加的可观测性正是定案手段**：07:24Z/07:59Z 两次 `marker rejected: taught_page_outside_loaded_range { reportedPage: 76, loadedRange: '70-75' }` —— 模型讲完报 76 被**整单**拒收，`windowComplete` 声明一并丢失。

### 根因（三条自动推进路径同时堵死，属结构性复发）
1. `auto-advance.js completeTurn` 用**协议标志**（每个 PDF 回合都传 `requiresTeachingProgress: true`）无条件武装 C5 门闩，而页级教材永远产不出已验证概念 marker → 武装后无解锁路径，且该值会投影进 `progress_state.json` 并终身免疫；
2. `PAGE_LEVEL_WINDOW_COMPLETE_ENABLED = false` → 页级 `windowComplete` 恒 false → 无已验证 `pendingAdvance`；
3. `validatePageMarker` 拒收"窗口末页+1" → 模型无任何合法方式表达"讲完了"。
→ 报 75 被忽略、报 76 被拒 = 死锁；09-23~26 另有 4 个会话命中同款 C5 告警。

### 做了什么（阶段一 M1–M5 + 阶段二 M6，未动编译产物/ASAR/manifest）
- M1 协议语义（留在 `turn.requiresTeachingProgress`）与门闩语义（只由已验证概念 marker 置位）拆开；
- M2/M3 页级分支与播种路径清除中毒 flag（**存量自愈，无迁移脚本**）；
- M4 门闩加页级豁免（纵深防御：中毒会话不必等 marker，delta 到 12 即恢复阈值兜底）；日志 tag `[C5-未修复]` → `[C5]`；
- M6 页级 marker 接纳 `end+1` + 显式 `windowComplete` 并钳制进窗口（`end+2`/无声明仍拒签，防静默跳页），带一次性观测日志。

### 验证
3 文件 `node --check` 通过；**5 个新场景用"临时回退单点 → 对应断言先红"实证判别力**（非事后补测）；相关回归 15 项全 PASS；全量矩阵 **133/131/0/2** 与基线一致。测试数：auto-advance teaching state machine 13→18 场景，kb-progress 新增 9 条断言。

### ⚠️ 未做
- **应用尚未重启**，真机复测待做（预期：delta 到 12 出现 `threshold_pre_turn` 换窗至 76–91，且不再出现 `reportedPage: 76` 整单拒收）；
- 阶段三（`PAGE_LEVEL_WINDOW_COMPLETE_ENABLED` 翻 true）需先积累观测日志读数；
- 阶段四完成信号词表未动；`markerDirective` 未动（是否告知模型可报 end+1，待观测后再定）。

### 编号说明（避免混淆）
本方案内文自称 BUG-0017，与台账 §1f 的 BUG-0017（thinking→reasoning 链路）**不是同一条**；台账归属 **BUG-0016**。

---

## 2026-09-26 批次 V-12：独立复验并行会话的 BUG-0016（页级死锁）修复 + 补前置数据

> 证据 E-519 ~ E-525。**只读代码 + 只读日志，未改业务代码。**

### 背景
用户要求接手"另一条腿"。核查后发现：**并行会话已自行完成**——根目录 `AUTO_ADVANCE_PAGE_ONLY_STALL_FIX_PLAN.md`（其内文编号「BUG-0017」，**台账归属 BUG-0016**，文档第 5 行已写明对照）记录了阶段一+二（M1~M6）全部实施 + 先红后绿测试。
所以本轮不做重写，做**独立复验 + 查缺口 + 补它做不了的事**。

### 独立复验结论：**通过（零回归）**
- 其声明的回归集 15 项全部 PASS（含 `auto-advance-protocol-bundle`、`auto-advance-teaching-state-machine`、`kb-progress`、`chat-teaching-progress-format` 等）。
- 全量矩阵 133/132/1：唯一失败 `pdf-ocr-priority` 是本队早先已记录的**既有 flake**（E-511）→ 零回归。
- 代码审读确认 M4 的纵深防御（`pageOnlyTeachingProgress !== true`）确实覆盖"投影已中毒但尚未提交过 marker"的态，S2a 已测。

### 查到的两处缺口
1. **台账失效引用**：BUG-0016 的"可观测性"证据引作 `E-479~E-481`，但那三个号属并行会话（本队 09-26 整体改号到 E-500+ 所致）→ 已改为 `E-500~E-502` 并注明。
2. **§10.5「应用尚未重启」已过期**：应用 `startedAt 2026-09-26T09:44:08Z`（本地 17:44）**晚于**修复全部改动（16:56~17:19）→ **修复已在运行实例里**，真机复测只是缺回合数据（重启后日志 69 行、无 marker）。已改写台账。

### 补做：阶段三（M7）的前置数据
方案 §10.5 把阶段三开启条件定为"观测读数 / regressed 频率 / 申报是否伴随真实尾部教学"。全日志（09-01~09-26，只读）量得：
- `[C5]` 告警 14 次命中 **11 个不同会话**；`[C3]` 页级降级 41 次命中 **17 个会话** → 结构性、非偶发；
- 9 次 `outside_range` 拒签里**仅 2 次带 detail，而这 2 次全是 end+1**（`reportedPage=76 / loadedRange=70-75`）；
- `taught_page_regressed` 15 次 > `outside_range` 9 次 → "往回报"比"报过头"更常见。

已作为 **§十一 附录**写进方案文档（标注为另一会话、只读不改码），并给出**谨慎判读**：样本仅 2 次、同会话同窗口，**不能据此宣布 outside_range 全是 end+1**；建议先攒 ≥10 条 end+1+claim 观测再做阶段三决策。
