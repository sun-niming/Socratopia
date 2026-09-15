# 未决问题 (OPEN-QUESTIONS)

> 状态标记：`[阻塞]` 影响范围或结论 / `[待查]` 可继续调查 / `[需用户]` 只能由用户回答。
> **编号顺序 ≠ 文件顺序**：Q-021 ~ Q-024 是后期追加的，物理位置在 Q-002 之后，编号按提出时间递增。按编号检索即可。
> 引用格式 `见 Q-012`。

---

## Q-001 `[已解答]` 兄弟副本 `Socratopia_2.0` 到底在哪？
- 冲突：`AGENTS.md` L7 与 `CLAUDE.md` 均称"兄弟工作副本：`E:\huanjing\sogeladi\Socratopia_2.0\Socratopia`"。
- **实测（2026-09-14）**：`/e/huanjing/sogeladi/` 下只有 `Socratopia/` 一个子目录，**`Socratopia_2.0` 不存在**。
- 结论：该路径已失效。但是否存在"换了位置的兄弟副本"仍未确认 → 见 Q-002。

## Q-002 `[已解答 — 用户确认 2026-09-14]` 是否有可访问的兄弟副本或源码仓库？
- **答案：无源码仓库。** 本目录的编译产物**就是**唯一的"源码"。
- 同时确认：`AGENTS.md`/`CLAUDE.md` 引用的兄弟副本 `E:\huanjing\sogeladi\Socratopia_2.0\Socratopia` **不存在**（Q-001）。
- **由此确立的硬前提**：不存在"改源码后重新构建"这条路。所有修改**只能**落在：
  - 手写文件（`resources/server/server.js`、`resources/server/lib/**`）
  - 编译产物（`.next/server/app/api/**/route.js`、`.next/server/chunks/**`、`.next/static/chunks/**`）
  - Electron 产物（`main.js`/`preload.js` + ASAR 重打包）
- **派生影响**：
  1. 重构路线必须先回答"是否重建一条可重复构建链路"，而不是假设它已存在（→ Q-021）。
  2. `PRACTICE_FEATURE_TECHNICAL_PLAN_AND_CLAUDE_PROMPTS.md`（E-116）当时的判断是"如果只能在当前打包产物上热修，风险更高，**不建议作为第一选择**"——现实是已经**被迫**长期走这条路近三个月。
  3. `方案.md`（E-113）与 `RENAME.md`（E-080）中所有"在源仓库实现"的设想都需重新对齐。
- 详见 `DECISIONS.md` D-010。

## Q-021 `[待查 / 关键]` 是否可能/值得重建一条可重复构建链路？
- 前置事实：无源码（Q-002）。现有产物是 Next.js webpack 输出 + esbuild 输出。
- **已查（2026-09-14）**：
  - **无任何 sourcemap**（E-123，`*.map` 数量 = 0）→ 反推源码只能靠产物特征。
  - 版本与依赖**完全已知**（E-120~E-122）：`next 16.1.6`、`react 19.2.3`、`electron ^40.8.0` + 28 项其他依赖，ASAR 根 `package.json` 与 `resources/server/package.json` 均有声明。
  - ASAR 根只有 `package.json` + `dist-electron/{main.js,preload.js}`，**没有源码目录**。
- **仍未查**：
  1. `.next/` 内是否有 `build-manifest.json`/`app-build-manifest.json` 等能反推 webpack 配置与完整入口图的产物（若有，重建可行性大增）。
  2. `PRACTICE_...md` 提到的源路径 `src/app/api/practice/route.ts`、`src/components/...`、`src/app/page.tsx` 与产物结构是否一一对应。
  3. `release-runtime-manifest.json`（494KB）能提供多少文件级信息。
  4. 产物中是否有 webpack `/* harmony */`、模块 id 到原路径的映射残留（如 `__webpack_require__.m` 或注释）。
- 影响：决定"永久改 bundle"还是"重建工程"；这是阶段 E 重构路线的**分叉点**。
- 注意：**不要假设重建一定可行**，也不要把"改 bundle"当成临时状态——它已经是最接近发布形态的现状。

## Q-022 `[需用户]` `Lemin`（ASAR `author`）与 git 作者 `逆铭` 是同一人吗？
- 证据：E-120（`_asar_extracted/package.json` 的 `author: "Lemin"`）vs E-003（全部 19 个提交作者均为 `逆铭`）。
- 影响：决定"本体 vs 分支"的叙事定性 —— 是**作者给自己的成品做增强**，还是**外部团队二次开发**。这会影响"本体功能算不算团队成果"的表述。
- 也影响 Q-012 关于 `world_preset.md` 作者的推断（用户已答"原始团队"，E-132；本问题用于确认"原始团队"与本地开发者的关系）。

## Q-023 `[待查]` `AGENTS.md` 是否是从上游/原始团队沿用的文档？
- 线索（E-178）：`AGENTS.md` 写"API route handlers（**28 routes**）"，而基线原版正好有 **27** 个路由——数字对得上，说明这句话是照着**原版**写的。
- 另两条一致线索：它声称 `CLAUDE.md` 缺失；它引用不存在的 `Socratopia_2.0` 兄弟副本（E-070）——都像"上游环境与本地不同"。
- 若成立，则 `AGENTS.md` 是**本体文档**被分支沿用，其"过时"不是笔误而是**上游与本地的差异**，改它等于改上游约定。
- 影响：阶段 E 决定"两个指令文件合一"时的处理方式。
- 反证方向：`AGENTS.md` 也写了分支特有的东西（module 64092、ASAR 重打包），说明至少被分支增补过。→ 可能是**混合体**。

## Q-024 `[需用户]` 基线 `b7ad6eb` 之前（2026-06-05 ~ 06-17）的语音改造量有多少？
- 基线已含 `VOICE_MODEL_MAPPING_REPORT.md`（06-05）与 `tts-audio` 路由（E-017/E-176）。
- `RENAME.md` 说 06-17 那批提交"留下了最早的一批语音侧改造"，与"基线已含语音工作"存在**时间重叠**。
- 影响：`09-original-vs-branch-boundary.md` §3.1 中"本体 vs 分支"的语音部分归类。
- 用户已说 2026-03~06-17"没有做什么"（E-131），但 06-05 的报告与该表述需要对齐——**是"没做多少"还是"完全没做"**。

## Q-025 `[待查]` 英文课堂规则为什么是测试桩？`noEnd` 从哪来？
- **已证实**（E-182）：`resources/rules/rules_en_classroom_compact.md` 只有 140 字节，正文是 `# Test classroom rules`。它 ≥100 字符且以 `#` 开头，**会通过加载校验**被英文课堂真正使用。
- 同时 `rules_en.md`（非 compact 版）**在 `resources/rules/` 下根本不存在** → 英文课堂两种模式都会落到这个测试桩，或落到 HTTP 代理回退（E-180）。
- `zh-TW`（`chinese-traditional`）同理：**没有 `rules_zh-TW*.md`** → 也依赖代理回退。
- 待查：
  1. 这是有意（英文内容由远端 `/rules` 提供）还是遗漏？
  2. `noEnd` 参数的真实来源与语义（决定走 compact 还是全量）。
  3. 代理 `SOCRATOPIA_PROXY_URL` 在本地部署下是否可用；不可用时英文课堂拿到什么。
- 影响：**英文与繁中用户的课堂行为完全未在本地验证过**。

## Q-026 `[已解答 — V-3 实况 2026-09-14]` 劫持式挂载是否生效？
- **答案：在真实运行中生效。** 运行日志中 `[kb-progress]` 前缀出现 **198 次**、`[kb-progress][C3]` 9 次（E-406），说明 `kb-progress.js` 的 `Module._load` 补丁确实挂上并持续包裹 chat 的 POST。
- **仍未解答**：**是否有测试断言"挂载已生效"**。当前只有在应用跑起来看日志才能确认；`tools/run-smoke-matrix.js` 跳过 `.next/`。→ 对应重构建议 C4。

## Q-027 `[待查 / 需用户]` 自适应教学的开关在本地实际被打开过吗？
- 证据：E-200 — `SOCRATOPIA_ADAPTIVE_ENABLED` + `SOCRATOPIA_ADAPTIVE_PROFILE_ALLOWLIST` 双闸门，**默认关闭**。
- 若从未打开，则 `lib/adaptive/` 的 10,057 行在真实使用中**一次都没跑过**（除未接线的 stage-d 外）。
- 待查：谁在何时设置这两个变量（`main.js` 的 fork env？外部启动脚本？）；`%APPDATA%/socratopia/project-data/adaptive-teaching/` 是否有落盘内容。

## Q-028 `[待查 / 需用户]` `方案.md` §13 的 Stage B（课堂实验）究竟做过没有？
- `方案.md` §19.1 明确要求 "Stage B 独立授权与执行顺序"，即 Stage A 通过后才谈 B。
- 现状：Stage A/B/C/D 的边界在实际代码里**没有对应标记**（stage-d 是唯一带名字的一段，且未接线）。
- 影响：判断自适应闭环"完成度"的关键——**是设计完成、还是连验收都做过**。

## Q-029 `[待查]` 哪些 adaptive 模块属于"写了但没人调"？
- 建议做法（阶段 E 的"接线审计"）：对 `lib/adaptive/` 每个模块统计"被谁 require"。
- 已知线索：`server.js` 只 require 6 个（E-201）；`stage-d-*` 被 require 0 次（E-204）。
- 影响：回答总目标第 6 问（哪些是残留/未验证实现），并决定接入还是归档。

## Q-030 `[待查]` 精读的开关到底在哪里、默认值是什么？
- `改动日志.md`（E-081）称"配置：`closeReading.enabled=false`；亦可用环境变量 `SOCRATOPIA_CLOSE_READING=false` 紧急停用"。
- **实测**：`server.js` 的 env 清单里**没有 `SOCRATOPIA_CLOSE_READING`**（E-222）；在 `server.js`/`kb-progress.js` 中 grep `closeReading` 也未命中开关读取。
- 待查：开关是否被移除（即精读恒开）、还是读 `settings.json`（内容不入上下文，需查结构）。
- 影响：判断精读是否真的可停用，以及"默认启用"这一说法是否仍成立。

## Q-031 `[待查]` `practice` 的账户隔离修复是否已在盘上生效？
- `cb74cdd Scope practice data and tutoring sessions by account` 在 `master`，**未合入 `codex/push`**（E-090/Q-017）。
- `lib/practice/tutoring-session.js` 有对应测试 `tutoring-session-account-scope-smoke-test.js` → **合理推断**该逻辑已以别的路径落盘，但**未核实**。
- 影响：`practice` 是唯一完整接入的功能，若账户隔离缺失则是真实越权风险。

## Q-032 `[已解答 — V-1/V-2 实测 2026-09-14]` 哪些 smoke 测试真的会触网 / 写盘？
- **答案：默认不触外网、不写用户数据。**
  - 3 个 TTS `*-live-*` 测试默认自跳过（需 `SOCRATOPIA_RUN_TTS_LIVE=1`），但它们打的是**本地** TTS 服务 `127.0.0.1:8000`（实测在运行，HTTP 200）——V-2 设 env 后 4 个 live 测试全部 PASS。
  - `tts-classic-stream-zero-audio-live-smoke-test.js` **无 env 守卫**，V-1 中已直接打到本地服务并通过。
  - V-1 全部 145 例在无 app、无 `SOCRATOPIA_*`、无外网条件下跑通。
- 残留待查：`knowledge/daimon-bridge-diag.js`、`reasoning/long-reasoning-real-kb-check.js` 是否触网（二者非 `smoke-test` 命名，不在矩阵内，未跑）。

## Q-033 `[待查]` 5 个页面 bundle 是历史遗留还是有意冗余？
- 事实：只有 `page-87daa6ca210ab9dc.js` 被加载（E-240）。
- 待查：`page-3a1fef7566e26c43.js` 与 3 个 `page-practice-ui-*` 是否**曾经**被加载过（可查更早的 git 版本或 `win-unpacked/` 快照），还是从一开始就是冗余镜像。
- 影响：若确认从未被加载，可大幅简化前端工作流（改 1 份而非 5 份）。

## Q-034 `[待查]` 5 个 bundle 的内部结构为何能长期保持一致？
- `replaceOnce` 依赖 5 个文件的 needle 上下文完全相同（E-241）。
- 待查：是否存在生成步骤（改完一份复制成 5 份），还是纯手工同步？「改动前 5 份是否字节级一致」可验证：`md5sum` 对比。
- 影响：决定能否把"改 5 份"降为"改 1 份 + 自动镜像"。

## Q-035 `[待查]` `thinking:{type:"disabled"}` 现在在哪构造？
- 背景：BUG-0002（E-281）记载该逻辑原在 `callLLM` 内、带写死的模型名白名单，2026-09-11 修为"模型家族判断"。
- 本批在 `lib/llm-gateway.js` 中**未检索到 `thinking` 字样**（E-261）→ 合理推断它在被网关调用的下层（模块 64092 定义处或 route 内联 payload 构造）。
- 待查：定位实际位置并确认修复仍在（模块 64092 有 8 处定义，需全覆盖核对）。
- 影响：这是 2026-09 最严重的 BUG 之一，**若只修了部分副本，按路由会再次出现空内容**。

## Q-036 `[待查]` `resources/server/.system/` 是什么？
- 尚未检查。可能是迁移产物或运行时状态目录。

## Q-037 `[待查]` 缓存与错误处理是否值得抽公共基类？
- 现状（E-270）：6 处缓存各写各的（TTL/负缓存/可禁用语义不一致）；5 种 `*Error` 构造器模式相同但各建各类。
- 影响：阶段 E 的重构范围判断。

## Q-038 `[已解答 — V-2 实测 2026-09-14]` BUG-0004 的修复是否已落地？
- **答案：已落地，且有精确回归测试。** 尽管诊断文档自称"仅诊断，未修改运行程序"。
- 证据：`kb-progress.js` 新增 `checkEvidence()`，注释直接引用 2026-09-13 事件；判定改为 `conceptBound && studentAnswered`；`finalQuestionTail()` 防概念名夹带。函数已从诊断时的 `responseHasCheckQuestion` 改名为 `endsWithCheckQuestion`。
- 回归断言（全 PASS）：`kb-progress-sse-smoke-test.js:178`（"末尾问号单独不计数"）、`:182`、`:211`；`exercise-mode-smoke-test.js:206`。
- 注意：`TWO_CHECK_LIMIT_REACHED` 硬上限**保留**——修的是"什么算一次检查"，不是取消上限。

## Q-039 `[待查]` `uncommitted-changes-fix-plan-2026-09-01.md` 的 5 项是否已执行？
- 5 项：下课保存真实锚点、下课事务 account/sessionEpoch 栅栏、同一伙伴普通编辑保留实例 ID、使用真实 `textbook_index` 路径、Tutoring 持久化后发送唯一 done。
- 待查：逐项核对盘上代码。**注意其中"account/sessionEpoch 栅栏"与账户隔离直接相关。**

## Q-040 `[待查]` §3 附录各条 BUG 的实际根因
- 需对 `42ce3de` `732fac0` `1d25b3b` `adc66db` `f253e3a` `ef5e1dc` `7b5f473` `a86f4ca` 逐条 `git show`（提交正文可能含原因）。

## Q-041 `[待查]` 是否存在同一 BUG 被跨月重复修复的情况？
- 线索：进度漂移在 2026-06-25~27 修过一轮，2026-09-11 又以 KUym 事件形式修一轮（BUG-0001）。
- 也是：看到"TTS 乱序"在 06-17 修过、09-12 又有"静默丢音"。
- 待查：区分"同一根因反复修"与"不同根因"。**不许直接合并成一次成功修复。**

## Q-042 `[待查 / 阻塞 BUG-0011]` 前端能力助手的 legacy 降级是"改坏了"还是"测试旧了"？
- 现状：`flashcard-adaptive-evidence-smoke-test.js:202` 期望"无 `getAdaptiveCapability` 时降级到 raw-account 并只发一次请求"，实际抛 `stage_c_request_uncertain`（E-304）。
- bundle 实现把任何非 Abort 错误归一为 `stage_c_request_uncertain`（意图是不泄漏含 token 的原始错误，测试也断言了这点）。
- 两种可能：(a) `tools/synchronize-frontend-capability-helper.js` 补丁改坏了降级分支；(b) 有意变更、测试已旧。
- **判断方法**：查该 tool 的补丁前后文本 + `git log` 上该测试的修改时间；对比 `page-87daa6ca210ab9dc.js`（运行件）与其他 4 份是否一致。
- 影响：前端 5 个 bundle；`flashcard`/`practice` 的 adaptive evidence 上报路径。

## Q-043 `[待查 / 阻塞 BUG-0010]` `main.js` 与 ASAR 副本哪一侧是期望态？
- 已证实两侧差 45 字节且内容不同（E-305），`issueAdaptiveCapability` 与 `ADAPTIVE_IMAGE_PATHS` 只在根副本。
- 待查：这两个符号是否曾提交过（`git log -p main.js`），以判断"根副本是新的"还是"ASAR 是新的"。
- **另需先解决**：`fix-asar-integrity.js` 已被删除（E-092），重打包后**用哪个脚本修 integrity** 未明。

## Q-044 `[待查]` 发布暂存 allowlist 漏了哪些目录？
- `release/win-unpacked/` 缺 `lib/knowledge/daimon-bridge.js`（E-302）。
- 待查：`tools/stage-clean-win-release.js` 的 allowlist 内容；是否还漏了别的（可用 `tools/verify-clean-win-release.js` 对目标树复核）。
- 影响：发布流程可用性。

## Q-045 `[待查]` `DEEPSEEK_V4_FLASH_CLASSROOM_*` 三份的先后关系与落地比例？
- 三份为 PLAN / IMPLEMENTATION_CHECKLIST / ACCEPTANCE，共 40,781 B，**全部未跟踪**。
- 待查：checklist 的勾选情况、acceptance 是否真的执行过；三份的写作先后。
- 影响：`07-legacy-docs-assessment.md` 的 A4 处置；以及"课堂上下文治理"这一主题的完成度（另见记忆条目"课堂上下文治理方案状态：批次 A 已落地，B2/C 待定"）。

## Q-046 `[待查 / 需用户]` `上下文.md` 是有意保留的对照材料还是误放？
- 内容讲的是另一个 C 语言 WebServer 作业（E-013/Q-005），但日期与本仓库同期（2026-08-31）。
- 影响：是否移入 `docs/external/` 或加说明。

## Q-047 `[待查]` `tmp/` 下测试与 `resources/server/lib/` 下同名测试的关系？
- `tmp/` 有 `_anchor1.txt`、`analyze-ctx-log.js`、`matrix.txt`、`embedded-check/` 等，部分是临时脚本、部分可能是在跑测试的副本。
- 待查：哪份是权威；`tmp/*.py`（角色导入/模板优化）是否应提升到 `tools/`（E-153）。

## Q-048 `[已解答 — V-3，2026-09-14]` 端到端冒烟是否需要启动应用？
- **不需要——应用当时已在运行**（主进程 PID 39712，server 于 18:32 启动，且在其后无代码改动，E-417）。直接读运行日志 + 探活即完成 V-3，**未启动也未杀进程**。
- 结果见 `13-live-e2e-smoke.md`：挂载生效、鉴权生效、BUG-0002 运行时验证通过；新发现 BUG-0012。

## Q-003 `[已解答 — 用户 2026-09-14 补充]` 是否有 git 之外的更早历史？
- 事实：git 起点 `b7ad6eb` 2026-06-17；但存在 2026-06-05 的 `VOICE_MODEL_MAPPING_REPORT.md`、2026-06-02 的 Electron 运行时文件。
- **用户答复（2026-09-14）**：**2026-03 ~ 2026-06-17 期间"没有做什么"**。该区间是**功能注入的起始点**（即本分支的起点），但"更多的不方便阐述"。
- **据此确立**：
  1. 阶段 B/D 的**实质历史区间就是 2026-06-17 起**，此前不必强行填充（D-007 的"合理推断"要求可放宽）。
  2. "功能注入的起始"= 本分支的 t=0，与 E-080"魔改分支"定性一致。
  3. 存在一类**无法从仓库材料自证的背景知识**（用户"不便阐述"）→ 在文档中标注为"外部背景，待用户补充"。
- **已解答副产品**：`06c0256` 删的是 `RENAME.md`/`改动日志.md`，**已取回**（E-080/E-081），覆盖 2026-06-17 起。
- 遗留：该区间的 6-02 打包、6-05 语音报告仍是**无背景的孤立事实**。

## Q-004 `[已解答 — 已由代码实测证实]` 服务端代码是"复制到 %APPDATA%"还是"原地运行"？
- **答案：原地运行，不复制。** `CLAUDE.md` 正确，`AGENTS.md` 第 49 行错误。
- 证据（E-100）：`main.js` `prepareServerDir()` 返回 `path.join(process.resourcesPath,"server")`，即 `resources/server/`；`startServerOnce()` 对该目录下的 `server.js` 直接 `fork`，`cwd` 即该目录。
- 唯一的"复制"：`resources/server/.next/node_modules` 完整性校验失败时，从 `resources/server/deps.zip`(36MB) 解压重建（E-101）。
- 副作用：**应用会写入自己的安装目录**（`wipeRuntimeServerDir()` 可能删除并重建 `.next/node_modules`）。
- 依据此结论的后续决策：改 `resources/server/**` 只需重启应用。
- 详见 `02-module-dossiers/electron-runtime-and-launch.md`。

## Q-005 `[已解答]` `上下文.md` 是不是本项目文档？
- **不是**。全文描述 `C:\Users\ASUS\webserver` 的 C 语言 HTTP 静态服务器作业（12 号题），与 Electron/Next.js 无关。
- 判断：**误放入本仓库的外部材料**。但日期 2026-08-31 与本仓库同期，不排除是有意保留的对照材料。

## Q-006 `[待查]` 仓库内存在多份重复的打包产物，哪份是权威？
- `resources/`（Electron 运行时 + server）
- `win-unpacked/`（2026-08-26 目录，内含 `resources/app.asar` 1389384B）
- `release/win-unpacked/`（2026-08-29）
- `/e/huanjing/AAA/`（2026-07-23，仓库外）
- `resources/app.asar` = 1392521B（2026-09-01）
- 未知：启动 `./Socratopia.exe`（2026-09-01）实际加载哪一个。需查 `main.js` 的路径解析。
- 影响：修改 Electron 层时改错文件会"看起来没生效"。

## Q-007 `[已解答]` 有几个 API 路由？
- `AGENTS.md` L17 说 28 个；`find ... -name route.js` 实测 **34 个**。
- 结论：AGENTS.md 的数字**已过时**。

## Q-008 `[已解答]` `06c0256 Remove outdated project history` 删除了哪些文档？
- **已解答**（2026-09-14）：删除 `RENAME.md`(201行)、`改动日志.md`(193行)、`resources/server/lib/ocr/rapidocr-v5/{README,THIRD_PARTY_NOTICES}.md`；同时新增 `adaptive/stage-d-*` 5 个模块。
- 前两份**已从 git 取回**为 `recovered/RENAME.md`、`recovered/改动日志.md`（E-080/E-081）。
- 附带发现：`ca07d17`(08-14) 与 `feb5ca9` 还删过 `CLAUDE.md`(400行) 与 `docs/knowledge-source-provider/*`(3 文件)，**也已取回**（E-082~E-085）。
- 新问题：`KIMI_DESKTOP_COMPATIBILITY_REPORT.md`（`改动日志.md` 提到、仅新增文档）**当前不在仓库、也拼不出 git 路径**，是否存在于某提交中 → Q-015。

## Q-009 `[待查]` `AGENTS.md` vs `CLAUDE.md` 谁是权威？
- 用户指示优先读 `AGENTS.md`；但 `AGENTS.md` 自称"CLAUDE.md 不存在"（实际存在），且比 CLAUDE.md 旧（8-31 vs 9-11）。
- `AGENTS.md` 若干数字过时（28 routes、20+ smoke tests；实际 34 routes、146 个 smoke 文件）。
- 应对：两者并读，冲突处实测。**不擅自修改**。

## Q-010 `[待查]` `resources/server/.system/` 与 `public/` 是什么？
- 尚未检查。

## Q-011 `[已解答 — 已由代码实测证实]` 前端 chunk 名带日期/人名后缀的含义
- **答案：它们是"批量补丁目标"，不是浏览器加载的覆盖层。**
- 事实（E-240）：5 个页面 bundle 中**只有 `page-87daa6ca210ab9dc.js` 被真正引用**（唯一的 client-reference-manifest 条目）。其余 4 个（`page-3a1fef7566e26c43.js` + 3 个 `page-practice-ui-*`）**非 smoke 引用数 = 0**。
- 机制（E-241/E-242）：`tools/remediate-tutoring-ui-bundles.js` 等脚本把 5 个文件硬编码为 `pages` 数组、逐个执行同一 `replaceOnce`；8 个前端 smoke test 再对 5 个文件逐个断言字符串存在，以此保证一致。
- 即：**补丁面 5×，运行面 1×**。改前端默认要改 5 个文件。
- 详见 `02-module-dossiers/frontend-bundles.md`（含可复用的 `replaceOnce` 模式与风险）。
- 例：`page-practice-ui-20260622.js`、`page-practice-ui-20260625-jyfix.js`、`page-practice-ui-20260626-postclass-notes.js`。
- 说明存在**手工命名的补丁产物覆盖机制**，需确认前端如何选择加载哪一个（是否多个同时加载 / 后加载覆盖）。

## Q-012 `[已解答 — 用户 2026-09-14]` 产品最初想为谁解决什么问题？
- **已找到并确认**（E-110）：`resources/bundled-content/zh/initial_world/world_preset.md` 是完整原始叙事 —— 天性教育法之问、`伙伴 + 苏格拉底 = 3X · 3A`、苏格拉底实验室、面向"孩子/学生/学者/终身学习者"、成功标准是"回答天性教育法之问"。
- **用户确认**：该文件由**原始团队**撰写；**不存在更早的需求文档或设计稿**。
- **据此定案**：E-110 就是 L1 愿景的**唯一且权威**材料。阶段 B 不必再找更早的愿景文档。
- **仍待判断（非材料问题，属分析结论）**：
  1. 从"全世界学习者"到"以教材为轴的学生课堂"是**决策还是漂移**。
  2. 有无教育效果成功标准/用户数据（现有全是技术指标）。
  3. **原始应用与本分支的功能边界**——阶段 C 建档必须先划清（`方案.md` §2.2 提供线索，E-114；ASAR `description: "Socratic Roleplay Learning"` 是本体定位的旁证，E-124）。
- 详见 `01-product-vision-and-evolution.md` §1、§3.2。

## Q-013 `[待查]` `146` 个 smoke 测试文件的真实可执行比例
- 数字来自 `find resources -name '*smoke-test*' | wc -l`。其中混有前端测试、`.mjs`、fixtures 引用等。
- 需要确认：多少能独立跑通、哪些会触网/写用户数据。

## Q-014 `[待查]` 是否存在真实 API 调用风险的脚本
- `resources/server/lib/knowledge/daimon-bridge-diag.js`、`long-reasoning-real-kb-check.js`、`*-live-smoke-test.js` 系列按名看会打真实网络。
- 运行前需逐一定性。

## Q-015 `[待查]` `KIMI_DESKTOP_COMPATIBILITY_REPORT.md` 在哪？
- `改动日志.md`（E-081）称其于 2026-06-29 新增，完整记录 Kimi Desktop / Daimon Control WebSocket 调查结论。
- 当前工作区**无此文件**，`find` 未命中。需用 `git log --all --diff-filter=A -- '*KIMI*'` 与 dangling 对象翻查。

## Q-016 `[阻塞]` 2026-08-31 之后的工作为何未经版本跟踪？
- **已证实**（E-093）：`CLAUDE.md`、`AUTO_ADVANCE_WINDOW_REPAIR_CHANGELOG.md`、`LLM_THINKING_FIX_CHANGELOG.md`、`MATH_SPEECH_CORE_*.md`(3)、`POST_CLASS_SAVE_FIX_2026-09-13.md`、`DEEPSEEK_V4_FLASH_CLASSROOM_*`(3)、`PROJECT_MATH_SPEECH_DOSSIER/`、`角色/`、`tools/`、`outputs/` 全部**未被 git 跟踪**，工作区还有大量未提交修改（E-004）。
- 影响：这是"资料分散、随时可能丢失"的最大结构性风险；也意味着**阶段 D 最后三周的历史只能靠文档日期重建**。
- 待确认：是有意（临时工作区）还是疏漏。

## Q-017 `[待查]` `master` 分支的孤立提交 `cb74cdd` 是否已包含在 `codex/push` 中？
- `cb74cdd Scope practice data and tutoring sessions by account` 位于 `master`，父为 `1d25b3b`，**不在 `codex/push` 祖先链上**。
- 其改动含 `release/win-unpacked/**`、`app.asar`、`bundled-content` 等。
- 需判断：其"practice 数据与辅导会话按账户隔离"的逻辑是否已在当前盘上代码中（可能经由别的路径落地）。

## Q-018 `[待查]` 4 个 `Codex worktree snapshot` 游离提交是否含独有内容？
- `d986417`/`8bfa3af`/`5a0c495`/`feb5ca9`（2026-08-12）均不在分支 tip。
- `feb5ca9` 独有：`preview-server.js`、`output/pdf/english_practical_writing_review.pdf`、`.codex/environments/environment.toml`、`opencode.json` 变更。
- 需判断是否有值得取回的独有实现。

## Q-019 `[待查]` `v109.md` 在哪？
- **已证实**（E-102）：`main.js` 在 fork server 处的代码注释写着 "See v109.md §主题 3 — Node 17+ IPv6-preferred OS configs..."。
- 当前仓库根目录**没有 `v109.md`**。它按版本编号命名，可能是一整套按版本切分的变更文档，也可能只存在于别处。
- 需查 git（含 dangling 对象）与磁盘其他目录。

## Q-020 `[待查]` `SOCRATOPIA_DESKTOP_DATA_DIR` 环境变量是否还有效？
- `/e/huanjing/AAA/Start-Socratopia.cmd`（2026-07-24）设置该变量指向自带 `project-data/`。
- 但**当前 `main.js` 中完全搜索不到该字符串**（实测 count=0）。
- 合理推断：该变量已被废弃，或被下游 `server.js` 读取而非 `main.js`。需在 `resources/server/**` 中搜索确认。

## Q-049 `[已解答 — 2026-09-14 实测比对]` `tmp/patch-asar-integrity.js` 与已删除的 `fix-asar-integrity.js` 关系？
- **答案：不是副本，是重写加强版。**
- 比对（旧版 95 行 / 2,937 B vs 新版 31 行 / 1,478 B，128 行差异）显示新版有三处实质改进：
  1. **算法更正确**：直接用 ASAR 头部长度字段 `asar.readUInt32LE(12)` 算 `[16, 16+len)`，旧版用手写大括号计数扫描 JSON；
  2. **幂等**：相等则输出 `in sync` 不写；
  3. **更安全**：只在 `ELECTRONASAR` 标记之后定位 `"value":"`，避免误改其他内嵌资源；参数化为 `<exe> <asar>`；注明"先关应用，运行中的 exe 会 EBUSY"。
- **结论**：可用工具**存在且更好**，但它躺在被 gitignore 的 `tmp/` 里。
- 影响：**Q-043/BUG-0010 被解除阻塞**——有可用的 integrity 修复工具。
- 遗留：该脚本应提升到 `tools/`（并入 A1 的"tmp 脚本提升"动作）。

## Q-050 `[待查]` `tmp/` 被清理过几次？丢失了什么？
- 已证实：`LLM_THINKING_FIX_CHANGELOG.md` 提到的 `tmp/llm-thinking-probe.js`、`tmp/llm-budget-probe.js` **已不在**（E-396）。
- `tmp/` 被 gitignore → 无版本保护。
- 待查：是否有别的文档引用了已消失的 tmp 脚本。
- 影响：印证 `R-02`；也提示"文档里写 tmp 路径"本身不可靠。

## Q-051 `[已解答 — V-4，2026-09-14]` BUG-0012 的竞争者是谁？
- **答案：同一轮里的后台预取进程。** `chat/route.js:917` 调 `prefetchCandidate({...}).catch(...)` **未 await**，它与前台收尾并发写同一个 `textbook_index.json`（E-420）。
- 两侧各靠**重试**对抗、预算不一致（auto-advance 5 次/≈375ms vs kb-progress 10 次/≈1.1s），短的一方先放弃（E-423）。
- auto-advance 的 `withLock` 只序列化自身 11 个入口，**kb-progress 不在锁内**（E-422）→ 锁不能作为跨模块互斥。
- **已据此修复**（预算对齐至 10 次/≈1.4s，E-425）并配可判别回归测试（E-426~E-428）。
- **仍未根治**：结构上"两个模块各写同一文件且互不协调"仍在 → 记入重构路线 C3/C5。

## Q-052 `[待查]` `PROGRESS_SAVE_FAILED` 为何没送达前端？
- 已证实：`kb-progress.js:1401-1409` 的 catch 里有 `controller.enqueue(... PROGRESS_SAVE_FAILED ...)`，但运行日志中该事件计数为 **0**（E-413）。
- 待查：是 enqueue 发生在 stream 已 close 之后被丢弃，还是前端未渲染该 warning 类型。
- 影响：BUG-0012 的"对用户无声"这一判断，以及修复的完整性（改重试后仍应让用户知情）。

## Q-053 `[待查]` LLM 端点在 14 天内更换过 5 次，是常态还是临时排查？
- 已证实：`api.deepseek.com`(179)、`api.nwafu-ai.cn`(200)、`api.starcommunity.asia:8012`(65)、`deepseek.nwafu.edu.cn`(28)（E-414）。
- 另有一次 URL 拼接异常（baseURL 带 query 又追加路径）。
- 影响：`settings.json` 的稳定性；以及"某个端点是否有特殊行为"（如是否支持 thinking / 缓存）。