# BUG 台账

> 阶段 D 视图 2（批次 D-1，2026-09-14；**批次 V-2 已于同日完成逐条验证**）。证据 E-280 ~ E-299、E-390 ~ E-397。
> **三种状态必须分开**：`声称修复`（commit/文档说修了）< `有修复代码`（能在盘上找到）< `通过针对性验证`（有测试或明示的实机验证）。

## ⚠️ 批次 V-2 结论（2026-09-14）
**§1 的 7 条全部已升级为 `通过针对性验证`** —— 方法是逐条复现各修复文档自己声明的验证方式。
- 6 条为完整复现（含测试通过）
- BUG-0002 为单元级（其运行时日志验证需启动应用）
- BUG-0004 有意外：诊断文档当时称"仅诊断"，**实际修复已落地且带精确回归测试**
- 详见 `12-bug-verification-round.md`
- **仍未闭合的**：BUG-0011、BUG-0013、**§1e 新增 BUG-0014/0015/0016** + §2 的 8 项未修。BUG-0009/0010 已由外部修复；**BUG-0012 已通过真实验收**

## ⚠️ 批次 V-3 补充（2026-09-14，实况取证）
- **BUG-0002 已补全为"含运行时"的通过验证**（`applied=true` ×190、`applied=false` ×0，见 E-407）。
- **BUG-0001 存在真实环境残余**：其 EPERM 症状仍在发生 → 新列 **BUG-0012**。
- 教训写死一句：**"通过针对性验证" ≠ "真实环境无残留"** —— BUG-0001 的 10 个测试全绿，却没覆盖 Windows 句柄竞争。

---

## 0. 覆盖范围声明

| 区间 | BUG 记录来源 | 本批处理 |
|---|---|---|
| 2026-06-17 ~ 08-30 | git 提交标题 + `RENAME.md` / `改动日志.md` | 部分（标题级，见 §3 附录） |
| 2026-08-31 ~ 09-14 | 4 份 `*_FIX_*/CHANGELOG` 文档 + `outputs/` 诊断与审计 | **本批重点（§1，7 条）** |
| 更早 | 无 | 未覆盖 |

**本批已细化 7 条**（BUG-0001 ~ BUG-0007），另有 1 条"保留未修"（BUG-0008）与 6 条"审计未修"（§2）。

---

## §1 已细化的 BUG

### BUG-0001 自动推进让模型跳读整段章节（KUym 第 13 章事件）
- **症状**：学习者质问"跳跃这么快吗，不从 13.1 开始讲是有什么理由吗"。模型从 p174（12.5）直接跳 p190（13.5），跳过 p175–189。
- **影响面**：课堂主链路；教材为**无知识库**（无 `knowledge_base/`）时最严重。
- **触发条件**：教材无 KB → 所有进度标记被 `empty_queue` 拒绝 → `lastTaughtPage` 恒空 → 投影反复把"当前学习页码"报成窗口起点；且历史 `structuredTeachingProgress=true` 关掉了唯一的兜底换窗触发器。
- **根因（三条机械成因，E-280）**：① 无 KB 时进度无法落库；② 结构化进度开关屏蔽了 delta≥12 的兜底换窗；③ 30k 字符无框 OCR 正文既无"你在这里"也无章节骨架。
- **附带缺陷**（同文档）：
  - `conversationSeed` 在 `current_reading.md` 为空时用 `wrapRange("")` 播种，产生"有范围、无正文"的空窗口，`recover` 只比对一致性永远修不到；
  - 聊天路由**从不调用 `commitRange`**，但工具仍按 v1 习惯写投影文件，v2 把它当外部篡改并回滚（171–183 页正文被 `external_legacy_mutation` 隔离回滚）；
  - 预取预算 30s 常态超时（`ocr_request_deadline`）；
  - `kb-progress.atomicWrite` 单次 `renameSync` 与 auto-advance 抢同一 `progress_state.json` → Windows `EPERM`。
- **修复**：C1 快照定位头、C2 空窗口重载、C4 跳页窗口落库 + prefetch 预算 + EPERM 重试；C3 阶段一追加"无知识库教材的页级进度降级"。**C5（结构化进度开关屏蔽阈值推进）明确保留未修，只留日志。**
- **状态**：**`通过针对性验证`**（V-2，2026-09-14）。文档 §五声明的 10 个 smoke 全部复现通过，`node --check`+acorn 3 文件通过。修复时新增了 `auto-advance-window-recovery-smoke-test.js`。回滚锚点齐全。
- **⚠️ V-3 实况发现残余（2026-09-14）**：其本已覆盖的 `EPERM` 症状**仍在发生** —— 日志中 16 次 `post-response progress save failed: EPERM`（09-11 起，09-14 当天 5 次），但**根因已定位到另一处代码**（`auto-advance.js` 的重试预算），故单列为 **BUG-0012**。
  → 教训：**该条 10 个声明测试全部通过，却没有覆盖 Windows 真实句柄竞争**；"通过针对性验证" ≠ "真实环境无残留"。
- **证据**：`AUTO_ADVANCE_WINDOW_REPAIR_CHANGELOG.md`（18,633 B，2026-09-11）§一/§二/§三/§五/§七。

### BUG-0002 LLM "关闭思考"开关被模型名白名单静默丢弃
- **症状**：课后笔记生成失败，前端报 `Failed to parse LLM JSON output`；教材导入、目录提取返回空内容。
- **影响面**：全站依赖 `callLLM` 的所有 JSON 型任务。
- **触发条件**：`set.json` 把 `strong`/`kb`/`weak`/`premium` 全指向 `deepseek-flash`（混合推理模型，`reasoning_content` 与 `content` 共享 `max_tokens`）。
- **根因（E-281）**：`callLLM` 中关闭思考的开关带**写死的模型名白名单**：
  ```js
  ...void 0!==m&&("deepseek-chat"===d||d.startsWith("deepseek-v4"))
      ?{thinking:{type:m?"enabled":"disabled"}}:{}
  ```
  `deepseek-flash` 两个条件都不满足 → 各路由显式传入的 `thinking:false` 被静默丢弃 → 模型自由推理耗尽输出预算。生产日志特征：`content:""` 而 `reasoning_content` 完整；4 次尝试各耗 37–41s。
- **对照实验（原文）**：仅禁思考 → `finish_reason: stop`、content 5667、推理 token 0、16.8s、**可解析**；仅把 `max_tokens` 提到 32768 → 仍 `length`、**不可解析**。→ 单纯加预算无效。
- **修复**：门控由写死模型名改为**模型家族判断**，并加可观测日志；改 7 个文件 / 8 处（`chat/route.js` 另有 1 处有意未动）。
- **状态**：**`通过针对性验证（含运行时）`**（V-2 单元级 + V-3 实况，2026-09-14）。
  - V-2：7 个文件家族判断全部到位；chat 残留的 1 处旧白名单经核对正是文档声明"有意未改"的 `q` 行；`end-class-llm-smoke-test.js` 断言通过。
  - **V-3 实况**（E-407/E-408）：运行日志中 `[callLLM] thinking=disabled applied=true` **37 次**、`[chat] thinking=enabled applied=true` **145 次**、`applied=false` **0 次**。观察到的模型名含 **`DeepSeek-V4.1-Flash`（大写）**，而旧白名单 `startsWith("deepseek-v4")` **大小写敏感会判 false** → 修复不仅有效，而且是必要前提。
  - 满足该修复文档 §五自己写的运行时验证要求。
- **关联**：BUG-0003 的同源背景（同一天、同一模型、同属"输出预算被推理吃光"）。转录文档明说"514 字符报告为何提前结束缺少上游 finish_reason 证据，不能断言一定耗尽额度"。
- **证据**：`LLM_THINKING_FIX_CHANGELOG.md`（4,943 B，2026-09-11）。

### BUG-0003 课后记录保存失败（解析器与截断双重问题）
- **症状**：课后报告保存失败、自动重试失败。
- **影响面**：下课流程（用户记忆落盘）。
- **触发条件与证据（原文，E-282）**：
  - 01:28:20 报告仅 514 字符，只含告别语与部分伙伴记忆；
  - 01:29:54 报告 3724 字符、含结束标记，但段落标记形如 `===\nDIARY_ENTRY\n===`，而**旧解析器只接受单行 `===DIARY_ENTRY===`** → 误判缺段落。
- **根因**：① 解析器对标记换行/空格过严；② 缺少输出截断检测与恢复路径。
- **修复（E-282）**：7 类已知标记兼容行内空格/两行/三行/CRLF/CR；六段完整性校验（仅 `RELATION_MD` 允许空）；仅对 `END_CLASS_INVALID_REPORT` / `END_CLASS_OUTPUT_TRUNCATED` 触发**一次**受限重试；课后专用参数 8192 tokens + `thinking=false`；在**模块 64092 的六处定义同步**增加 end-class 专用 `finish_reason=length` 检查；诊断日志。
- **状态**：**`通过针对性验证`**（V-2，2026-09-14）。`outputs/post-class-save-fix-20260913/verification.json` 的 6 项检查对应日志全部存在且 PASS（解析器 20 项含事故特征用例）；`end-class-parser` / `chat-end-class-integration` 测试复现通过。回滚材料完整（`changes.patch`+`before/`）。
- **注意**：明确"没有代替用户重新生成真实课程记录，没有调用真实模型服务"；"修改不会自动补写先前失败的记录"。
- **证据**：`POST_CLASS_SAVE_FIX_2026-09-13.md`（10,113 B，2026-09-13T13:02:31+08:00）。

### BUG-0004 旧 KB 概念队列劫持章末习题课堂
- **症状**：用户要求按章末习题逐题训练，课堂却被旧 KB 概念队列拽走，回答从 P7 的 HTTP 时延转去讲"欢迎套接字"。
- **影响面**：课堂；教材有 KB 且走习题模式时。
- **根因（E-283，带行号证据链）**：
  - `kb-progress.js:728` `responseHasCheckQuestion` **仅凭末尾问号**判定"发生了一次检查"，**不校验题目或知识点语义**；
  - `:733` `recordConceptCheck` 把它计入 `expectedConceptId`；
  - `:404` `checkCount >= 2` 时选后续卡片；`:676` 生成 `TWO_CHECK_LIMIT_REACHED`，要求收束旧概念并立即讲新概念；`:714` 在最新用户消息前插入 `role=system` 的 `KB_PROGRESS_INTERNAL`；
  - `:1193` 即使缺少进度标记，正常响应仍可能进入 `recordConceptCheck`。
- **原文判断**："这条证据链比'模型自由联想''长历史导致遗忘''教学教练可能误判'更直接。"且明确**未**把 TAE 当已确认原因。
- **修复**：**已落地**（V-2 发现，诊断文档未提）。`kb-progress.js` 新增 `checkEvidence()`，注释直接引用 2026-09-13 事件；判定改为 `conceptBound && studentAnswered`，另有 `finalQuestionTail()` 防夹带。`TWO_CHECK_LIMIT_REACHED` 上限机制保留（修的是"什么算一次检查"）。
- **状态**：**`通过针对性验证`**（V-2，2026-09-14）。4 条精确回归断言（`kb-progress-sse-smoke-test.js:178/182/211`、`exercise-mode-smoke-test.js:206`）全部通过。**Q-038 结案。**
- **证据**：`outputs/deepseek-classroom-20260913-diagnosis.md`（2026-09-13，声明"仅诊断；未修改运行程序、用户进度或配置，未发送付费 API 请求"）。

### BUG-0005 流式链路静默丢音 + 旁白混入语音队列
- **症状**：流式播放时音频静默丢失；动作旁白被念出来。
- **修复**：`2026-09-12 Fix silent playback loss in the streamed chunk chain`、`2026-09-12 Keep action narration out of the speech queue`。
- **状态**：**`通过针对性验证`**（V-2，2026-09-14）。6 个 `voice-*` 前端 smoke + `tts-classic-stream-frontend-smoke-test` 全部通过；4 个 `-live-` 测试对运行中的本地 TTS 服务（`127.0.0.1:8000`）全部通过。
- **证据**：`TTS_OPTIMIZATION_CHANGELOG.md` §"2026-09-12"两条。

### BUG-0006 TTS 零帧成功与未处理 rejection（安全审计已修项）
- **症状**：TTS 返回"成功"但零音频帧；未处理 promise rejection。
- **修复**：审计报告列为"已修复问题 #1"；配套 3 个测试（零帧/会话安全/播放任务隔离）。
- **状态**：**`通过针对性验证`**（V-2，2026-09-14）。`tts-classic-stream-zero-audio-live-smoke-test.js` 对真实本地 TTS 服务**通过**。
- **证据**：`outputs/backend-security-audit-20260901.md` §已修复问题 1。

### BUG-0007 TTS 会话/终端/并发加固 + 本地 TTS API 防护
- **症状类**：会话串扰、终端事件竞态、并发过高；本地 TTS HTTP 服务无防护。
- **修复**：审计"已修复问题 #2、#3"。测试：`tts-classic-stream-session-safety-*`、`tts-local-api-security-smoke-test.js`、`tts-player-task-isolation-smoke-test.js`。
- **状态**：**`通过针对性验证`**（V-2，2026-09-14）。`tts-classic-stream-session-safety-`、`tts-local-api-security-`、`tts-player-task-isolation-smoke-test.js` 全部通过。

---

## §1b 实跑发现的新 BUG（批次 V-1，2026-09-14）

> 来源：第一次实跑 145 个 smoke（见 `10-verification-baseline.md`）。**这 3 条是"当前可复现"级别**，与 §1 的历史 BUG 分开。

### BUG-0009 发布暂存树缺 `daimon-bridge.js`，该树启动即崩
- **症状**：`Cannot find module './lib/knowledge/daimon-bridge.js'`，requireStack 指向 `release/win-unpacked/resources/server/[eval]`。
- **影响面**：`release/win-unpacked/` 这份发布暂存**完全不可用**。
- **根因（待确认）**：`tools/stage-clean-win-release.js` 的 allowlist 可能漏了 `lib/knowledge/`。
- **状态**：✅ **已修复（外部；2026-09-20 观察到）** —— 矩阵中 `rawExitCode=0, skipped=false`；`release/win-unpacked/resources/server/lib/knowledge/daimon-bridge.js` 已存在（24351 B，E-449）。具体做法未取 commit 证据，归为"观察到已修复"。
- **证据**：E-302、**E-449**。
- **修复方向**：补齐 staging allowlist；用 `tools/verify-clean-win-release.js <target>` 复核。
- **回滚**：无需（暂存树可再生）。

### BUG-0010 根 `main.js` 与 ASAR 副本内容漂移 45 字节
- **症状**：`electron-adaptive-capability-smoke-test.js` 断言 `root and ASAR runtime must share the same adaptive protocol block` 失败。
- **根因（已证实）**：两侧内容不同（根 1,388,110 B / ASAR 1,388,065 B），CRLF 数相同故非行尾问题；`issueAdaptiveCapability` 与 `ADAPTIVE_IMAGE_PATHS` **只存在于根副本**。
- **影响面**：**ASAR 是 Electron 层运行时真源**（D-010）→ ASAR 侧可能缺少能力签发逻辑，直接影响自适应能力令牌握手。
- **状态**：✅ **已修复（外部，同上）** —— 两侧 `main.js` 与 `_asar_extracted/dist-electron/main.js` 现均为 `1388110` B（E-449），矩阵 `rawExitCode=0`。
- **证据**：E-303、E-305、**E-449**。
- **修复方向**：确定哪一侧是期望态（倾向：根副本更新，需把差量同步进 ASAR 并重打包 + 修 integrity）。
- **回滚**：重打包前的 `app.asar` 备份即可。
- **注意**：`fix-asar-integrity.js` 已被删除（E-092），但文档仍教它 → 修复前需先确认用哪个脚本修 integrity。

### BUG-0011 前端能力助手吞掉 legacy 降级路径
- **症状**：`flashcard-adaptive-evidence-smoke-test.js:202` 的"无 `getAdaptiveCapability` 时应降级到 raw-account"场景，实际抛 `stage_c_request_uncertain`。
- **根因（线索）**：bundle 内实现 `async function l(e,t){try{return await n(e,t)}catch(e){if(e?.name==="AbortError")throw e;throw Error("stage_c_request_uncertain")}}` —— 把任何非 Abort 错误一律归一，降级分支被吞。
- **两种可能（待判，Q-042）**：(a) `tools/synchronize-frontend-capability-helper.js` 补丁改坏了降级；(b) 补丁有意，测试已旧。
- **影响面**：前端 5 个 bundle（补丁面 5×，E-240）；`flashcard` 与 `practice` 的 adaptive evidence 上报。
- **状态**：**当前可复现**，且**因矩阵跳过 `.next` 而长期未被发现**。
- **证据**：E-304。

---

## §1c 实况发现的新 BUG（批次 V-3，2026-09-14）

> 来源：对**正在运行的应用**的日志取证（见 `13-live-e2e-smoke.md`）。属"当前可复现（真实使用中反复发生）"。

### BUG-0012 真实课堂上反复丢失课后进度保存（EPERM）
- **症状**：日志 `[kb-progress] post-response progress save failed: EPERM … rename 'textbook_index.json.<数字>' -> 'textbook_index.json'`，**16 次**。
- **分布**：09-11 ×5、09-12 ×3、09-13 ×3、09-14 ×5 → **每天 3~5 次，未在改善**。
- **影响**：该轮**学习进度未落盘**（回答已送达）。**且对用户基本无声**——`PROGRESS_SAVE_FAILED` 警告事件在日志中计数为 **0**。
- **根因（已定位到行）**：
  1. 临时名带数字后缀 = `write-file-atomic` 的 `getTmpname()`；全仓库**仅 `auto-advance.js`** 使用该库（L15/L144）；
  2. `auto-advance.js` 的 `atomicWrite`（L142-156）**只重试 5 次、≈375ms**；`write-file-atomic` v7 自身**不做 rename 重试**；
  3. 对照：`kb-progress.js:1105` 的 `atomicWrite` 重试 **10 次、≈1.1s**（约 3 倍）——同仓库两套预算不一致，短的那套不够；
  4. 异常冒泡到 `kb-progress.js:1404` 外层 catch，本轮进度保存整体作废。
- **时间关联**：09-11 前日志无 EPERM，09-11 起出现 → 与当日 auto-advance v2 重写吻合，属**新引入或新暴露**。
- **状态**：⚠️ **修复已生效，但 2026-09-18 真实验收未通过** —— 见下方"验收"。
- **Q-051 已解答（竞争者是谁）**：`chat/route.js:917` 的 `prefetchCandidate(...)` **未 await**（后台预取），与同轮前台收尾**并发写同一文件**；auto-advance 的 `withLock` 只序列化 auto-advance 自己（11 个入口），**`kb-progress` 不在锁内**，两侧各靠重试对抗而预算不一致 → 短的先放弃。
  ⚠️ **需修正**：实测两侧写入器**都是纯同步的**，同进程两个同步写不可能真正交叠 → 真正持有句柄的是**一个跨 `await` 的异步句柄**（见下）。
- **修复**：`auto-advance.js:140-158` 重试 5 次/≈375ms → **10 次 ≈1.4s**（对齐 `kb-progress.js` 的 ≥10 次），1 行 + 说明注释。
- **新增回归测试**：`lib/reading/auto-advance-atomic-write-retry-smoke-test.js`（注入 EPERM 重命名风暴，2 场景）。判别力已证明：修复前场景 1 失败（失败栈与生产同形），修复后 2/2 通过。
- **单元级验证**：直接相关 9 测试全 PASS；全量矩阵 121/117/2/2；`.next` 24/1 → **零回归**。

#### ⚠️ 真实验收（2026-09-18）：**未通过**
- **窗口**：修复落盘 `2026-09-14T11:09:24Z`；其后首次启动 `2026-09-14T15:33:54Z`，至 09-18 共 9 次重启，修复全程在线。
- **计数**：生效前 chat 152 / EPERM 17 = 11.2%；生效后 chat 85 / EPERM 6 = **7.1%**。n=85 下卡方≈1.0，**不显著** → 没有可证实的改善。
- **决定性证据（时延）**：每次失败距上一条带时间戳日志行 —— 生效前 18 次散布 **328~610ms**（旧退避 250ms）；生效后 6 次为 1250/1253/1255/1257/1265/1270ms（新退避 1125ms），**极差仅 20ms**。
  → 每次都是**烧光整条预算才抛**。随机外部瞬时占用会给出散布很宽的时延，只有"阻塞者根本不会松手"才这样。

#### 修正后的根因：**同步重试饿死唯一的解锁者（自锁）**
- 两侧写入器均为纯同步（`writeFileAtomic.sync` / `writeFileSync`+`renameSync`）且都用 `Atomics.wait` 退避，后者**阻塞事件循环**。
- 只要**任何**进程对目标持有打开的句柄，`rename` 就持续 EPERM（Node 不以 `FILE_SHARE_DELETE` 打开，普通只读句柄即可阻塞）。
- 若持句柄的是**同进程的异步 fs 任务**，其 fd 由 JS 续体 `close()`——而续体在阻塞期间永远跑不到：
  `开始重试 → 事件循环停 → close() 无法执行 → 一直 EPERM → 烧光预算 → 抛出 → 循环恢复 → 持有者才 close`。
- → **加宽预算在结构上不可能有效**：不是窗口不够长，是窗口里阻塞者不会松手。
- **本机复现通过**：`outputs/bug0012-livelock/repro.js`（A 无持有者→首次成功；B 异步持有者→40 次全耗尽/2496ms/`holderClosed=false`）。
- **持有者候选（合理推断，未定案 → Q-054）**：`chunks/2751.js` 的 `async function y()` 用 `await readFile(textbook_index.json)`，被 `chat`/`reading-context`/`textbook`/`jump-page`/`groupchat` 五条 route 共用。
- **回滚**：`attempt >= 9` 改回 `attempt >= 4`（该文件本次前已有用户未提交改动，勿直接 checkout）。注意回滚后失败率不会变差（已验证），只是窗口从 1.1s 缩回 250ms。
- **仍未完成**：① 真正修复（方向：让失败者让出事件循环 / 让读者不留跨 await 句柄 / 共享写入器）② `PROGRESS_SAVE_FAILED` 仍静默（Q-052）③ 结构性问题未根治。
- **证据**：E-410 ~ E-413、E-419 ~ E-430、**E-431 ~ E-438**。详见 `14-bug0012-fix.md`（含验收附录）。

#### 🔧 方向①已落地（2026-09-20，`15-bug0012-reader-sync-fix.md`）
- **做法**：把**读 `textbook_index.json` 的异步读全改为同步读**，使读者不再留跨 `await` 的 fd → 自锁窗口归零。
  1. `lib/companion-continuity/transaction.js` `readTextOrNull()`
  2. `lib/companion-continuity/end-class-commit.js` `readText()`
  3. `.next/server/chunks/2751.js` `y()`（五条路由共用的索引读）
- **未改**：两个写入器、`atomicWrite` 语义、重试预算数值。
- **新回归断言**：`auto-advance-atomic-write-retry-smoke-test.js` 场景 3 —— 同进程打开句柄 ⇒ 抛 EPERM（钉死 R-23，防后人再加预算）。
- **零回归**：矩阵 129/128/1（唯一失败是环境：本地 TTS 未运行）、`.next` 28/27/1（失败为 BUG-0011）。
- ⚠️ **尚无生效后的真实课堂样本** → 状态是"已落地、待观察"，**不是"已修好"**。
- **验收标准**：看**时延特征**（成功应远小于 1125ms；失败不再整齐聚在 1255ms），不看失败率。
- **证据**：**E-441 ~ E-449**。

---

## §1d 实况发现的新 BUG（2026-09-15，课后笔记生成）

> 来源：用户真实使用中的界面报错 + `%APPDATA%/socratopia/logs/socralab_debug.log` 逐条时间戳取证。
> 与 §1 的 BUG-0002 / BUG-0003 **同源但不同层**：那两条是"输出预算被推理吃光"和"保存解析器过严"，本条是**整条生成链路的可靠性缺失**（无分类、无检查点、无续跑、无质量门禁）。

### BUG-0013 长课堂课后笔记生成四症状（HTML 误解析 / 超时 / 空 content / 截断）

- **症状（四种，全部真实发生）**：
  1. 界面报 `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`；
  2. 界面报 `This operation was aborted`；
  3. HTTP 200 但 `message.content` 为空；
  4. HTTP 200 但 JSON 数组中途截断。
- **时间戳证据（`socralab_debug.log`，2026-09-15）**：
  - `02:05:19.816Z` 发起 → `02:08:19.823Z` `FATAL ERROR: This operation was aborted`，**180.007 秒**，精确命中 `timeoutMs: 180000`（E-PN-001）；
  - 请求规模：`msgCount=80`、`substantive user msgs: 40`（E-PN-002）；
  - `02:10:59.942Z` `LLM response length: 0`，`callLLM-DIAG` 显示 `status: 200`、`choices[0].message.content: null`、**`message.reasoning` 完整**（E-PN-003）→ 空 content 病因是 reasoning 与 content 共享输出预算；
  - 紧接着 `02:10:59.942Z` 自动重试第二轮，`LLM response length: 5836`、`parse failed on attempt 2/2`、`JSON parse failed after 2 attempts`（E-PN-004）→ **截断**；
  - 网关计量 `promptTokens: 14078`（E-PN-002）。
- **对照探测（E-PN-005 / E-PN-006）**：同样 80 条消息，`max_tokens=2048` 约 16.5s 返回；`max_tokens=4096 + response_format=json_object + ≤1800 字符约束` 约 64.5s 返回完整 JSON、`finish_reason=stop`。
- **HTML 403 证据（E-PN-007 / E-PN-008）**：同一上游后来恢复 HTTP 200 → 网关异常**间歇性**，不能按永久鉴权失败处理。
- **根因（结构层，非单点）**：
  1. 整堂课只有**一次大调用**，输入、reasoning 与最终内容共享同一输出时限；
  2. `route.js` 内嵌的 `callLLM`(64092) 对响应直接 `response.json()`，HTML 拦截页被误报成 JSON 语法错误；
  3. "最多重试两次"只覆盖模型正文 JSON 解析失败，网络异常 / HTML / abort **直接跳出循环**；
  4. 无分段检查点，最后一步失败即丢失全部计算；
  5. 无 `finish_reason` 与结构完整性校验 → 截断结果可能被当作成功。
- **临时止血（已落地，2026-09-15 上午）**：`maxTokens` 8192 → 4096、加 `response_format:json_object`、整份 JSON ≤1800 字符、abort / HTML 映射为可操作中文提示。带回归测试 `concept-summary-response-budget-smoke-test.js`（先红后绿）。
  **代价**：长课笔记被压到 1,800 字符，细节丢失。
- **状态**：**当前可复现（真实使用中）**；止血已落地，根治由本方案 v2 承担。
- **修复方向**：短课单次结构化生成 / 长课按完整问答轮次分片 + 检查点 + 合并 + 确定性降级；稳定错误分类；质量评分取代单一长度上限。见 `POST_CLASS_NOTES_QUALITY_RELIABILITY_DEVELOPMENT_PLAN.md`。
- **回滚**：基线 `outputs/post-class-notes-v2/baseline-20260915T031249Z/`（哈希 + before 副本 + 未提交 patch）。
- **证据**：E-PN-001 ~ E-PN-008；日志摘录 `outputs/post-class-notes-v2/baseline-20260915T031249Z/logs/app-concept-summary-episode.log`。

---

## §1e 最新一节完整课堂复盘发现的新 BUG（批次 V-7，2026-09-25）

> 来源：用户完成一节完整课堂后的日志取证（`16-live-lesson-review-20260925.md`，E-450~E-465）。
> **本节也包含 BUG-0012 的验收结论（通过）。**

### ✅ BUG-0012 真实验收：**通过**（方向①有效）
- 该节课 `post-response progress save failed` = **0 次**；修复后累计 **115 轮 / 0 次**（修复前 255 轮 / 25 次 = 9.8%，泊松 p≈1.2e-5，E-451/E-452）。
- 三处方向①改动复核仍在盘，应用 `08:06:35Z` 启动晚于全部改动（E-453）。
- **状态**：`通过真实验收（4 天样本）`。建议再观察一周后正式关闭；二重确认标准仍是"失败时延不再聚在 1255ms"。
- 归因保留：同期另有模型/端点更换（09-23）等变量，但分界在 09-20，方向不冲突。

### BUG-0014 🔴 思考（thinking/reasoning）注入对当前模型全线失效，防烧 token 护栏一起落空
- **现象**：`[chat] thinking=enabled applied=false model=gpt-5.6-terra` —— 09-25 全 52 轮如此；09-22 及以前 100% `applied=true`（E-454）。
- **根因（已定位到表达式）**：`app/api/chat/route.js` 里 `applied` 就是字面量 `/^deepseek/i.test(model)`；不匹配时 **整个 `thinking` 字段被省略**（E-455）。
- **第二层**：本次 chat 全被改写成 Codex `/responses`，而 `lib/responses-api-compat.js` **完全没有 `thinking` 处理**，只认 `reasoning` / `reasoning_effort`（E-456）→ 放开判据也不够，字段名也得换。
- **真正危害**：三处**手写护栏**（`llm-gateway.js`、`kb-builder-coordinator.js`、`kb-builder.mjs`）同样只判 deepseek，注释写明是防"reasoning 吃光 max_tokens → content 空串"。换模型后 **三道护栏全部落空**，该致命组合重新裸奔（E-457）。
- **影响面**：`/^deepseek/i` 命中 **7 个模块 64092 定义文件** + 3 个 lib，改动须全覆盖（E-458）。
- **状态**：✅ **已修（2026-09-26）→ 待 gpt-5.6 实测验收**。
  - **修法**：判据由模型名改为能力 —— `/^deepseek/i` 改为 `/^(?:deepseek|gpt-5\.6)/i`，**10 个文件 17 处全覆盖**（7 个模块 64092 定义文件 + 3 个手写 lib）。配套：`unsupportedOptionalField` 加入 `"reasoning"` 兜底；新增 `lib/thinking-gate-smoke-test.js`（4/4 PASS）钉住「全覆盖 + 下游能认」。
  - **分工**：字段「发出来之后没人认」那一半由并行会话的 FIX-0017（`responses-api-compat` 映射 thinking 到 reasoning，2026-09-25 19:40）解决；本轮补的是「压根没发出来」。
  - **验收判据**：切到 `gpt-5.6-*` 后日志应为 `[chat] thinking=enabled applied=true model=gpt-5.6-…`（修复前为 `applied=false`）。⚠️ 当前模型已切回 `DeepSeek-V4.1-Flash`，老判据本就命中 → **现有 `applied=true` 不能证明修复**。
  - **验证**：syntax 与 compat 系测试全过；矩阵 133/132/1 与 133/133/0（唯一失败为无关 flake）。
- **修复方向**：把判据从"模型名"改为"模型能力/协议"（例如声明式 tier→是否支持 reasoning，或在目标是 `/responses` 时改发 `reasoning`）。
- **证据**：E-454~E-458、**E-505~E-512**。详见 `18-bug0014-thinking-gate-fix.md`。

### BUG-0015 🟠 `lesson-summary` 连接超时，对用户无声
- **现象**：本窗口 4 次（3× `ConnectTimeoutError (api.nwafu-ai.cn:443, timeout: 10000ms)`、1× `AbortError @chunks/1576.js:25:5389`），只落 `[Next:err]`（E-459）。
- **判读**：同一链路另有 238 秒的 KB 提炼 → 建连慢/抖动，10s 连接超时偏紧。历史同形可追到 09-07/09-08。
- **状态**：**当前可复现**。
- **修复方向**：连接超时与总超时分离（建连 ≥30s）；失败要冒泡给前端。
- **证据**：E-459。

### BUG-0016 🟠 进度标记连续被拒 → 降级页级 → 窗口无法推进（C5 现象的原生成因）
- **现象**：第一段课堂**连续 6 轮** `marker rejected: taught_page_regressed`（E-460）。
- **降解链（本节完整走通）**：`marker rejected` → `[C3] 教材没有可用的概念卡队列，已切换为页级进度模式`（`cause: loadQueue 找不到可用的 knowledge_base`）→ `authoritative window is empty; reloading`（`conversationSeed seeded a header-only window from an empty current_reading.md projection`）→ `[C5-未修复] 阈值自动推进被屏蔽`（E-461/E-462）。
  ⚠️ 日志 tag 已于 2026-09-25 修复时由 `[C5-未修复]` 改为 `[C5]`（修复后该文案自相矛盾）；历史日志里仍是旧 tag，`grep "\[C5"` 两侧都命中。
- **加重**：`页级进度已讲到窗口末页（阶段二未启用）` 已到达窗口末页（`loadedRange: 40-54`），却因阶段二默认关闭而无法提交 `windowComplete`。
- **状态**：**根因已定案并已修（2026-09-26），待真机复测**。方案 + 实施记录：根目录 `AUTO_ADVANCE_PAGE_ONLY_STALL_FIX_PLAN.md`（该文档内文沿用它自己写的编号「BUG-0017」，**与 §1f 的 BUG-0017 不是同一条**；台账归属本条目）。
- **根因定案（2026-09-26，三个断点，实测证据 E-513/E-514）**：三条自动推进触发路径**同时**堵死——
  1. `auto-advance.js:1419 completeTurn` 用「走教学进度协议」这个协议标志无条件武装 C5 门闩（chat 路由对**每个 PDF 回合**都传 `requiresTeachingProgress: true`），而页级教材永远产不出已验证概念 marker → **武装后没有任何解锁路径**；
  2. `kb-progress.js:25 PAGE_LEVEL_WINDOW_COMPLETE_ENABLED = false` → 页级 `windowComplete` 恒 false → `commitTeachingProgress` 永不创建已验证 `pendingAdvance`；
  3. `kb-progress.js:591 validatePageMarker` 拒收"窗口末页+1"申报 → 模型讲完报 76（`loadedRange: 70-75`）被**整单**拒收，其中的 `windowComplete` 声明一并丢弃。
  → 报 75 被阶段二忽略、报 76 被拒，**死锁**；09-23~26 另有 4 个会话命中同款 C5 告警 → 结构性复发，不是偶发。
- **修复（阶段一+二，M1~M6）**：M1 把协议语义（留在回合级 `turn.requiresTeachingProgress`）与门闩语义（只由已验证概念 marker 置位）拆开；M2/M3 在页级分支与播种路径清除中毒 flag（存量自愈，无迁移脚本）；M4 门闩加页级豁免（纵深防御：中毒会话不必等 marker，delta 到 12 即恢复阈值兜底）；M6 接纳 `end+1` + 显式 `windowComplete` 并钳制进窗口，`end+2` 与无声明仍拒签。
- **验证（E-515/E-516）**：5 个新场景/断言用「临时回退单点 → 对应断言先红」实证判别力；相关回归 15 项全 PASS；全量矩阵 133/131/0/2 与基线一致。**应用已于 2026-09-26 17:44 重启（晚于全部修复改动），修复已在线；真机复测所需的回合数据尚在积累**（重启后日志仅 69 行、仅一条 C3 页级提示、尚无 marker）。未做项：阶段三开关仍 `false`、阶段四词表未动。
- **可观测性已修（2026-09-25）**：`kb-progress.js` 的 `reject()` 现携带 `detail`，`taught_page_regressed` / `taught_page_outside_loaded_range` 均打出 `{ reportedPage, recordedPage, loadedRange }`；调用点一并打印。新增 5 条断言进 `kb-progress-smoke-test.js`。（正是这条可观测性让根因在下一节课的日志里定案：07:24Z/07:59Z 两次 `reportedPage: 76` 整单拒收。）
- **证据**：E-460~E-462、**E-500~E-502**（本队的可观测性证据已于 2026-09-26 整体改号到 E-500+，此前这里误引为 E-479~E-481，那三个号属并行会话的课后笔记线）、E-513~E-518。
- **独立复验（2026-09-26，非作者本人）**：声明回归集 15 项全 PASS；全量矩阵 133/132/1，唯一失败为既有 flake `pdf-ocr-priority`（E-511），**零回归**。详见 E-519~E-522。

---

---

## §1f 课后笔记 v2 首次真机复盘发现的新 BUG（批次 V-8，2026-09-25）

> 来源：用户完成一节完整课堂后的日志 + `.jobs/**` 取证。详见 `17-post-class-notes-live-review-20260925.md`（E-466~E-478）。
> **本节同时是本方案 v2 的首次真机验收结论：机械部分全绿，但 4/4 job 全部降级、零 ready。**

### BUG-0017 🔴 换模型后"关闭思考"整条链路断了 → 长课笔记 100% 降级
- **修复状态**：**已修（有回归测试），待真机复测**（2026-09-25）：`responses-api-compat.js` 增加 thinking→reasoning 兜底映射；compat smoke 新增 7 条断言先红后绿。真机复测未做。

- **现象**：4 个真实 job 全部 `degraded`，`ready` = 0；`degradedReason` 全是 `chunk_failures`，失败码全是 `upstream_timeout` / `upstream_network`。
- **根因链（四步，每步有盘上证据）**：
  1. `set.json` 的 `strong.model = gpt-5.6-sol`；
  2. `lib/responses-api-compat.js:39` 的 `prefersResponses()` 命中 `^gpt-5\.6` → 请求被改写到 `/responses`（改写日志与我们的 `provider_request` 相差 1ms，E-468）；
  3. 改写函数 `chatRequestToResponses()` 只映射 `reasoning` / `reasoning_effort`（`:170-171`），**不映射 `thinking`** → `provider.js` 发的 `thinking:{type:"disabled"}` 被静默丢弃（E-469）；
  4. reasoning 常开 → 单片 80.6/85.8/79.6 秒，紧贴 §6.3 的 90 秒单次超时 → 2 片撞线（E-466）。
- **重试救不回**：§6.2 的 `shortenTarget` 只挂 `upstream_empty_content` / `output_truncated`，**超时行没有** → 重试是同一请求，chunk-003 再次精确撞 90.000s（E-467）。
- **与 BUG-0014 同源不同路**：那条是编译产物 `/^deepseek/i` 判据导致不发 thinking；本条是手写 `provider.js` 发了但被兼容层吃掉，且**无任何日志能看出被吃**（无条件带字段，连 `applied=false` 都没有）。
- **状态**：**当前可复现（真实使用中，100% 命中）**。
- **修复方向**：`provider.js` 在 `thinking===false` 时同时发 `reasoning:{effort:"low"}`；或让 compat 把 `thinking.disabled` 映射为 `reasoning`。另建议超时纳入 `shortenTarget`、单次超时按实测 p95 重定、并发 1 路对照。
- **证据**：E-466~E-469。

### BUG-0018 🟠 单个 job 的模型调用预算从未生效
- **修复状态**：**已修（有回归测试）**（2026-09-25）：新建 job 补 `modelCalls: 0`；smoke 用 maxCallsPerJob=1 构造可判别场景（修前 4 次调用，修后 1 次且错误码为 budget_exceeded）。

- **根因**：`orchestrator.js` 新建 job 的字面量里**漏了 `modelCalls: 0`**（只有接管分支与 retry 分支有）→ `+= 1` 得 `NaN` → `ensureBudget` 的 `NaN >= maxCallsPerJob` 恒 false。
- **证据**：三个新 job 的 `job.json` 写 `"modelCalls": null`（NaN 的序列化）；唯一写对的走了 retry 分支（E-470）。
- **状态**：**当前可复现**。
- **修复方向**：补初始化；顺手把 `runToken: {}`（内存令牌被序列化）从 job.json 里剔掉。

### BUG-0019 🟠 检查点清理器从未被调用
- **修复状态**：**已修（有回归测试）**（2026-09-25）：新增 `sweepCheckpoints()` 挂在全部终态点，fire-and-forget + catch；smoke 断言终态触发与清理抛错容错。

- **根因**：`orchestrator.cleanup()` 有定义、无调用点 → §5.4 的"成功 7 天 / 失败 14 天 / 每会话最多 5 个"全部没执行。
- **证据**：全仓库 `.cleanup(` 只有定义处一行（E-471）；`.jobs/` 下 4 个 job 目录只增不减。
- **状态**：**当前可复现**。
- **修复方向**：`start`/`status` 触发一次、节流到每天一次。

### BUG-0020 🟡 降级笔记结构性超长，且质量分看不见缺片
- **修复状态**：**已修（有回归测试），待真机复测**（2026-09-25）：降级组装接收 targetRange 并逐档压缩、写入 warnings、新增 chunkCompleteness 并按比例折减 score（口径由用户选定）；真机规模未复测。

- **现象**：降级产出 6,736 可见字符，而 73 条消息的目标带是 3,000~4,000 → `lengthFitness = 0.269`；`warnings=[]`。
- **根因**：`quality.assembleDegraded()` 逐主题输出 facts(≤6)+examples(≤3)，**完全不看 `visibleTargetRange`**；18 个概念堆出 1.7 倍超长。质量分 `0.909` 是相对幸存证据算的，`evidenceTopicCount=19` 只数了 3 片 → **缺 25% 内容不扣分**。
- **讽刺点**：v2 立项就是为了"不再压成 1,800 字符"，降级路径从反方向越界。
- **状态**：**当前可复现**。
- **修复方向**：`assembleDegraded` 接受目标长度并按比例裁剪；降级时把"缺哪一片"写进 warnings 与笔记可见处。

### BUG-0021 🔴 教材窗口 OCR 超时 → `ocr_request_deadline` 死循环（新对话永远发不出第一条消息）
- **修复状态**：**已修（有判别力回归测试）**（2026-10-11）。测试：`resources/server/lib/pdf-ocr-batch-cache-flush-smoke-test.js`（修前：失败的那次调用缓存写入 0 条，重试仍从头 OCR 并在同一处再死；修后：已完成的批次全部落缓存，重试一次即收敛）。
- **现象**：实机 `chats/0f9ZkTS5I1WeySr7dIiVY.json`（KUyw 教材）第 1/2/3 轮的 assistant 消息内容就是字面的 `\n\n**ocr_request_deadline**`（`failed:true`、`notAccepted:true`），每轮间隔恰好 120.0s，永远不成功。日志同轮伴随 `[auto-advance] authoritative window is empty; reloading the current range`，`conversations/<id>/current_reading.md` 停在 38 字节（只有范围头、无正文）。
- **根因（两处叠加）**：
  1. `lib/reading/auto-advance.js` 的 C2 空窗口重载会 `await input.loadRange(...)`（`beginTurn`，约 :1299），而负载是 `/api/chat` 的 OCR 请求围栏 `_captureOcrRequestFence(a,12e4)`（120s）→ 冷缓存下 30 页窗口的 OCR 撞上围栏，抛 `ocr_request_deadline`，`beginTurn` 整体回滚（`turns:{}`、窗口仍空）。
  2. `lib/pdf-ocr-coordinator.js` 的 `execute()` 把每批 OCR 结果只堆进 `pendingCacheWrites`，**真正的 `cache.write` 在批次循环结束之后**（`withLifecycleMutation`）。围栏一到就整单抛出 → 已完成批次全部白干 → 重试仍是冷缓存、仍在同一秒死 → 窗口永远提交不了。**这是死循环的关键**：不是慢，而是每次都从零重来。
- **修复**：
  1. `pdf-ocr-coordinator.js`：新增局部 `mergeRecognizedPages()`，每批结束立刻把该批结果折进 `pages` 并写 OCR 缓存（写入成功即从 `pendingCacheWrites` 摘除，尾部循环只补写残项）；抛 deadline/abort 前先 flush 一次。
  2. `app/api/chat/route.js`：轮次 OCR 围栏 120s → 180s，使围栏变成兜底而非主限；此时 `execute()` 内部的 120s OCR 预算会以 `ocr_timeout` 优雅降级（返回部分页）而不是整单抛错。
- **连带**：`[auto-advance] background prefetch failed ... ocr_request_deadline`（BUG-0001 附带项）同源——预取失败同样是整单丢弃已完成批次；修复后预取的部分结果也会留在缓存里供前台复用。
- **证据**：日志 `06:42:52.669` / `06:45:52.608` 两轮 `authoritative window is empty` + 120.0s 静默 + `06:44:52.661` / `06:47:52.627` 才到 `figure catalogue`；`chats/0f9Zk…json` 的三条 `**ocr_request_deadline**`。

### BUG-0022 🟠 新对话流式输出会覆盖「已结束对话」的展示（前端全局流缓冲未按会话隔离）
- **修复状态**：**已修（有回归测试）**（2026-10-11）。回归：`resources/server/.next/static/chunks/app/llm-generation-lifecycle-smoke-test.js` 新增两条断言（离线断言编译产物，非真机跑）。
- **现象**：在**新对话**里发消息、它正在 thinking 时，切回/并排看**已聊完的旧对话**，旧对话最后一条 assistant 气泡被新对话的实时流式文本顶掉，并显示 thinking 光标与 thinking 心情；流结束后又跳回。
- **根因**：`resources/server/.next/static/chunks/app/page-87daa6ca210ab9dc.js` 里聊天面板的实时缓冲是**组件级全局**（`e_`/`eF`/`eB`/`eW` = isGenerating / 流式文本 / toolUses / mood），而消息数组绑定的是**当前激活会话** `K`。`tj` 渲染时把「当前会话最后一条 assistant 气泡」无条件替换为全局 `streamContent`：`c=o?l:t.content` 且 `o=...&&isStreaming`。于是谁的流在跑，当前屏幕上的那条气泡就被谁接管。
- **附带（同源，已一并加固）**：`r7` 的 `finally` 无条件清空共享的 `ro.current`/`eK.current` 等，所以**任何**一次发送结束都会掐掉另一次仍在跑的流的实时状态（`onStop` 随之失效、`e_` 变 false）。并发入口真实存在：侧栏跳页 `an`、下课 `ai`、AI 代答 `as` 都不过 `e_` 闸门。
- **修复**：
  1. 新增 `_streamConvId` 状态；`r7` 在解析出目标会话 `r` 后立即 `_setStreamConvId(r)`。
  2. 渲染侧只有在 `_streamConvId===q`（即被流式写入的会话正是当前显示的会话）时才下发 `isStreaming/streamContent/streamToolUses/streamMood/isPreparingLesson`。
  3. `finally` 改为 `var _ownerStream=ro.current===l;`，只有仍是「最新一次发送」才清空共享状态，并仅在 `_streamConvId` 仍等于自己的 `r` 时清空它。
- **未修（同批审计发现，留待下一批）**：
  - `as`（AI 代答）末尾按**当时的** `q` 调 `r7`，预流期间切会话会把代答写进错的会话；
  - `__SocratopiaLiveSpeechHints__` 的消费者只比对 `messageId`、不比对 `conversationId`（`__SocratopiaLiveSpeechSegments__` 是对的）；
  - `r7` 使用闭包里的 `W` 快照（而非已存在的 `conversationRef.current`）做 persist；`addMessage` 的 1500ms 全量覆盖定时器没有任何取消点，1.5s 内完成的流可能被陈旧快照写回磁盘。
- **服务端同源背景（本轮未改）**：auto-advance 是**按教材的单例**（`state.owner` 只有一个会话），新对话的第一条消息会在模型执行前抢走 owner 并重写**共享**的 `textbooks/<id>/progress_state.json` / `textbook_index.json`；新对话又从这份共享文件播种，因此拿到的是别人的页码 + 38 字节空壳窗口（`recover()` 对非 owner 故意不重投影）。这正是 BUG-0021 里「空窗口 → 必须重载 → 撞围栏 → 空窗口」的入口。

---

## §2 明确"未修复"的问题（来自审计与文档，勿当成已解决）

### BUG-0008（保留未修）结构化进度开关屏蔽阈值推进
- 文档原文：C5 "仅保留现象日志与原因/背景/危害说明"。来源：BUG-0001 同一文档 §四。

### 审计未修清单（`outputs/backend-security-audit-20260901.md` §尚未修复 / §其它未修）
| 级别 | 问题 |
|---|---|
| P1 | EPUB ZIP 资源耗尽 |
| P1 | 聊天 GPT 流缺少取消与统一 deadline |
| P2 | renderer 直连本地 TTS 的身份边界 |
| P2 | 生产日志仍可能记录模型输出/上游错误预览 |
| P2 | 公开 bootstrap 迁移路由 |
| P2 | 客户端可选模型及大输入缺少统一配额 |
| P3 | 内部错误 message 直接返回 |
| P3 | 头像与音频读取大小限制 |

> 这是**当前最可核查的"已知问题"清单**，且来自一次有明确范围的审计。**已完成档案化，可整段引用到阶段 E 的风险章。**

---

## §3 附录：标题级 BUG 线索（2026-06 ~ 08，未细化）

| 日期 | 提交/文档 | 线索 |
|---|---|---|
| 2026-06-25~27 | `42ce3de` `732fac0` `1d25b3b` `adc66db` `f253e3a` | 课堂进度漂移的一组连续修复（游标/锚定/守卫/归一化/规则收紧） |
| 2026-07-21 | `ef5e1dc` | 教材抽取与续接的集中修复（PDF/OCR/KB 质量门禁/下课保存） |
| 2026-08-19 | `7b5f473` | 概念图谱缓存、Responses API 兼容回归 |
| 2026-08-28 | `a86f4ca` | 跨会话切换的阅读投影丢失 |
| 2026-09-01 | `outputs/uncommitted-changes-fix-plan-2026-09-01.md` | 5 项修复计划（下课锚点、事务 account/sessionEpoch 栅栏、伙伴实例 ID 保留、真实 textbook_index 路径、Tutoring 唯一 done）→ **需核实是否落地（Q-039）** |
| 2026-09-02~04 | `outputs/math-speech-remediation/REMEDIATION_REPORT.md`、`known-limitations.md`、`failures-before/after.json` | 数学语音独立整改，含故障注入与哈希审计 |
| 08-29 前后 | `outputs/acceptance/20260829-*/` | 两轮验收记录 |

---

## §4 台账质量自评

- **可靠**：§1 的 7 条与 §2 的未修清单都有**具体证据文件 + 行号/日志时间戳**，且 5 条带对照实验或证据链。§1b 的 3 条有**可复现命令**。
- **弱**：§3 全是标题级，"根因"字段多为未知。
- **状态分层现状（截至 2026-09-14 V-2 完成后）**：
  - `通过针对性验证`：**7 条**（§1 全部；其中 BUG-0002 已含运行时）
  - `当前可复现`：**8 条**（BUG-0011、BUG-0013、BUG-0014、BUG-0015、**§1f 的 BUG-0017/0018/0019/0020**）
  - `已修复（外部，未取 commit 证据）`：BUG-0009、BUG-0010（2026-09-20 观察到，E-449）
  - `修复已生效但验收未通过`：**0 条**（原 BUG-0012 已于 2026-09-25 通过真实验收）
  - `通过真实验收（待观察一周）`：BUG-0012（方向①；115 轮 0 次，E-452）
  - `已修（有判别力测试），待真机复测`：**BUG-0016**（2026-09-26，E-513~E-518；应用尚未重启）
  - `当前可复现（2026-09-25 新发现）`：BUG-0014、BUG-0015
  - `有修复代码`：0 条（原 7 条已全部升级）
  - `声称修复（无代码核对）`：0 条
  - `保留未修`：BUG-0008 + §2 的 8 项
- 时间分布集中：§1 的 7 条中有 6 条发生在 **2026-09-11 ~ 09-13**，即最末三天。
- **重要观察（V-2）**：§1 的 7 条**全部带有匹配的回归测试**，且测试断言精确到根因（例：`kb-progress-sse-smoke-test.js:178` "a trailing question mark alone never increments the check counter"）。
  → 说明这支分支的**修复质量与测试纪律是好的**，问题不在"修得差"，而在**组织（无源码、无版本控制、矩阵漏覆盖）**。
  → 也意味着：**§1 可从"待验证风险"降级为"已验证的历史修复"**；真正要盯的是 §1b 与 §2。

---

## §5 证据
E-280 `AUTO_ADVANCE_WINDOW_REPAIR_CHANGELOG.md` §一/§二/§三/§七
E-281 `LLM_THINKING_FIX_CHANGELOG.md` §一（含白名单代码与对照表）
E-282 `POST_CLASS_SAVE_FIX_2026-09-13.md` §问题证据/§实现细节
E-283 `outputs/deepseek-classroom-20260913-diagnosis.md` §已确认的主要原因 + 行号
E-284 `outputs/backend-security-audit-20260901.md` §已修复 / §尚未修复 / §其它未修
E-285 `TTS_OPTIMIZATION_CHANGELOG.md` §2026-09-12 两条
E-286 `outputs/uncommitted-changes-fix-plan-2026-09-01.md` §一 优先级
E-287 `outputs/math-speech-remediation/`（REMEDIATION_REPORT、known-limitations、failures-before/after）

## §6 待确认
- Q-038：BUG-0004（KB 队列劫持习题）的修复是否已落地。
- Q-039：`uncommitted-changes-fix-plan` 的 5 项是否已执行。
- Q-040：§3 各条的实际根因（需逐条 `git show`）。
- Q-041：是否存在**跨会话/跨文档重复修复**的同一 BUG（如进度漂移在 06 月与 09 月各修一次）——需比对后合并编号而非叠加。
