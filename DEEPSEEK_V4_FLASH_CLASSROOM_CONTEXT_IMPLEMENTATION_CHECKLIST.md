# DeepSeek v4 Flash 课堂上下文治理 — 实施清单

对应方案：`DEEPSEEK_V4_FLASH_CLASSROOM_CONTEXT_PLAN.md`
状态：**批次 A + B2 + C 已实施**（2026-09-12 批次 A；2026-09-13 修两处诊断缺陷见 §7；2026-09-14 §5.4 稳定前缀 / §6 标记 / 分区预算见 §8；2026-09-17/18 复核 + §5.3 视窗去重见 §9、前缀断点消除见 §10）。C 批次已实测生效（冷启动 49%→0%）。**下一次检查按 §10.4 的顺序做**
索引口径：下文 `idx=` 为 Node 以 UTF-8 读入后 **JS 字符串下标**（`indexOf` 口径），不是字节偏移（中文占 3 字节，字节偏移更大）。实施时以**锚点字符串**为准，`idx` 只作定位参考。

---

## 0. 已查证事实（2026-09-12 实测）

端点 `https://api.deepseek.com/v1`，模型 `deepseek-flash`（当前 `settings.json` 实配值），每次请求 `max_tokens=1`：

| 探测 | 结果 | 结论 |
|---|---|---|
| 裸请求（不传 `thinking`） | 200，`reasoning_content` 86 字，`reasoning_tokens: 25` | thinking **默认开启** |
| `prompt_cache_key`（字符串） | 200，usage 无变化 | 静默接受 |
| `prompt_cache_key` + `prompt_cache_retention:"24h"` | 200 | 静默接受 |
| `prompt_cache_key: 12345`（number）+ `retention:"bogus"` | **200，无任何报错** | 参数被**完全忽略**：既不解析也不校验 |
| assistant 消息带 `reasoning_content` 回传 | 200 | 回传被接受，非协议必需 |

usage 同时返回 OpenAI 风格 `prompt_tokens_details.cached_tokens` 与 DeepSeek 原生 `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`。

### 0.1 对方案 §9 的结论

- **不要向 DeepSeek 发送 `prompt_cache_key` / `prompt_cache_retention`**。发了没有任何作用，只会在日志和代码里制造"我们在控制缓存"的错觉。§9.1 的 cache key 方案对 DeepSeek **不适用**（它是供应商自动前缀缓存，无 key 概念）。
- 对 DeepSeek 唯一有效的缓存手段是 §5.4 的"稳定前缀 + 动态后缀"，即 prompt 结构本身。
- `cached_tokens` 可直接读；DeepSeek 原生 hit/miss 字段能区分命中与未命中，信息量更大，建议一并记录。
- §9.2 的判断被证实：GPT 系列与 DeepSeek 的缓存契约确实不同。

### 0.2 方案前提与实配的偏差（需你确认）

- 方案 §2 假设模型名是 `deepseek-v4-flash` / `deepseek-v4*`；实际 `settings.json` 与 `set.json` 全部指向 **`deepseek-flash`**。
- `route.js` 中决定 reasoning 是否回传历史的 `q`：

  ```js
  q="deepseek-reasoner"===b||("deepseek-chat"===b||b.startsWith("deepseek-v4"))&&l?.thinkingObserved===!0
  ```

  对 `deepseek-flash` **恒为 false**。
- 即：**当前实现根本没有把 reasoning 写回历史**。§5.2/§8.1 在这里不是"收紧已有行为"，而是"新增一条受限摘要"——这是新增行为，方案把它描述成了收敛行为。

---

## 1. 现状基线

| 方案条款 | 现状 | 位置 |
|---|---|---|
| §5.1 当前状态优先 | 部分：裁剪从最旧消息开始删，但**当前学生消息也会被截断**（见 A0） | `idx=106028` trim 块 |
| §5.2 reasoning 隔离 | 已达成（对 `deepseek-flash` 是"完全不回传"，比方案要求更严） | `q` 判定 |
| §5.3 工具结果最小化 | 未达成：无去重、无上限 | 工具循环 `idx=126522..127416` |
| §5.4 稳定前缀 | 部分：动态内容已在尾部 `_late`，但 `## Session outline` / `## Earlier conversation summary` 仍在 prompt 中部 | 模块 7788 |
| §6 分区标记 | 无 `<CLASSROOM_*>` 标记，无版本号；现有分隔是 `\r\n\r\n---\r\n\r\n`（23 处） | 模块 7788 |
| §7 历史保留 | 有裁剪但只跑一次 | `idx=106028` |
| §8.2 工具循环 | 循环上限 10，但循环内无预算重算 | `wT=10`（chunks/9654.js `idx=764`） |
| §9 缓存 | 只对 gpt-5.6 发 key；统计已记录但无解释 | `idx=125028` / `125593` |
| §10 分区预算 | 无。只有单一总量 `_MAX_HIST_CHARS=12000` | `idx=106061` |
| §11 可观测性 | 有 `[ctx-trim]` / `[direct-llm-cache]`，但 `sysPLen` 打印的是历史消息条数（bug） | `idx=106736` |

已完成且与方案一致：`reasoning_content` 截断到 200 字符；动态内容（学习进度、教材正文）已排在尾部 `_late`；usage 统计链路已通。

---

## 2. 改动清单

### 批次 A — 低风险：不动模型可见的文本结构

#### A0. 当前学生消息不得被截断（§5.1 / §10）

- **位置**：`idx=106028` trim 块，`_MAX_MSG_CHARS=1500` 的截断循环 `for(let _i=f.length-1;_i>=0;_i--)`
- **问题**：循环覆盖所有下标，包括最后一条用户消息。学生粘贴一段长文本时，**当前输入会被静默砍到 1500 字符**，正是 §10 明令禁止的行为。
- **改法**：截断循环跳过最后一条 `role==="user"` 的消息（以及 handoff 之外的当前轮消息）；对超长当前输入，改为在 system prompt 尾部追加一条提示（"学生本轮输入过长，已完整保留，请分段处理"），或按 §10 走"单独报错/要求分段"。
- **风险**：低。注意不要把 handoff 注入的 `ae` 误判为当前输入。
- **验证**：构造 5000 字符的学生消息，断言 payload 中该消息完整。

#### A1. 工具循环内重算预算（§8.2 / §10）

- **位置**：循环体内 `idx=124894`（`for(let a=0;a<(j?f.wT:1);a++)`）、工具结果入列 `idx=127078`（`role:"tool",tool_call_id`）、assistant+tool_calls 追加 `idx=127203`。
- **问题**：trim 只在首轮调用前跑一次。循环内每次追加 tool 结果/AI 中间消息都不再受任何约束，最多可能累积 10 轮无界内容——这是单次请求内输入膨胀的主因（§3.5）。
- **改法**：把 trim 抽成一个可复用的内联函数（本文件是压缩产物，建议就地定义 `_trimCtx(_msgs,_budget)`），在**每轮循环开始前**对 `r` 重新执行：先删 reasoning/中间 assistant 草稿 → 再删重复 tool 结果 → 再压缩旧轮对话 → 最后才动教材窗口。保护项：`r[0]`（system）、最新一条 user、当前轮尚未消费的 tool 结果。
- **风险**：中低。裁剪顺序写错会切断 `tool_call_id` 配对，导致 DeepSeek 报 400。**必须保持 `assistant(tool_calls)` 与其 `tool` 结果成对出现**，删一个就一起删。
- **验证**：mock 一个触发 3 次工具调用的会话，断言第 3 轮 payload 长度低于阈值且 tool 配对完整；smoke test 里跑。

#### A2. 工具结果去重与限长（§5.3 / §8.2）

- **位置**：工具结果入列处 `idx=127078`；执行器在 `resources/server/.next/server/chunks/9654.js` 模块 73358（`o8:()=>v` @`idx=755`）。
- **问题**：
  - `read_file` 走 `(0,h.Dp)(c,f,b.path)`，**整文件原样返回，无任何上限**——`story.md`、`learner_profile.md`、`toc.json` 都可能整份进上下文；
  - `read_textbook_pages` 有上限（`Math.min(2e4,Math.max(1e3,targetTokens||1e4))`，PDF 分支 `Math.min(4e4,4*r)`），但同一资源重复读取不合并；
  - 循环内对同一 `path` 的重复 `read_file` 会各留一份全文。
- **改法**：
  1. 复用该模块**已有的预算工具**：`bP:()=>p`（按 CJK=1 / 拉丁=0.25 计单位）、`Ui:()=>q`（按预算截断），不要新写估算器；
  2. 在入列处维护 `_toolSeen = Map<name+规范化参数, 首次结果>`：命中则替换为一行 `"[同一读取已在上文给出，见 tool_call_id=...]"`；
  3. 单条 tool 结果设单位上限（建议 `read_file` 默认 8000 单位，超限截断并附 `...[truncated, N units omitted]`；`read_textbook_pages` 保持现状）；
  4. 工具结果为空/报错时**不得重试追加**（§8.2），直接回一行状态让模型改策略。
- **风险**：中。改了工具返回内容会改变模型行为；上限设太小会让模型反复重读同一文件（反而放大循环）。建议上限先设宽松（8000 单位）观察。
- **验证**：`lint` 一次调用两个相同 `read_file`；断言第二次是占位行而非全文。补 smoke test 覆盖空结果/超限分支。

#### A3. 分区诊断日志 + 修 `sysPLen` bug（§11）

- **位置**：`idx=106736`（`[ctx-trim]`）、`idx=125593`（`[direct-llm-cache]`）、`idx=127416`（`type:"usage"`）。
- **问题**：`[ctx-trim]` 的 `sysPLen=${c.length}` 打印的是**未裁剪的前端历史消息条数**（`c` 是 `{messages:c}` 解构出来的历史数组），不是 system prompt 长度；且没有分区长度、没有裁剪原因，回答不了方案 §11 要求的"输入暴涨来自哪个区域"。
- **改法**：
  - `sysPLen` 改为 `b.length`。实参绑定已核对：`zf` 即模块 20375 的 `async function j(a,b,c,d,g,i,j,k,l)`（`idx=122545`），其 body 用 `c` 作 system 消息、`d` 作 messages；dispatch 行传入的第 3 个实参 `b` 因此就是 system prompt（`idx≈106750`）。同一作用域内 `b` 在 dispatch 前未被重新赋值（否则 App 早就把错误内容当 system prompt 发出去了）；
  - 输出 `[ctx-region]` 单行结构化日志：`sys=, resource=, live=, memory=, tool=, reason=, user=, total=, trimmed=, trimReason=`；
  - 记录 DeepSeek 原生 `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`，与 `cached_tokens` 并列；
  - 不记录 API key、完整学生隐私数据、完整 reasoning（§11 明文要求）。
- **风险**：低。日志改动不影响行为。
- **验证**：日志字段逐项对照 §11 的 12 项清单。

### 批次 B — 中风险：改上下文内容，不改结构标记

#### B1. reasoning 受限摘要（§5.2 / §8.1）— **需先定方向**

- **现状**：`deepseek-flash` 下 reasoning 完全不回传（`q=false`），比方案要求更严格。
- **两条路，需你选**：
  - **(i) 维持现状**：什么都不做，只在文档里记录"reasoning 不入历史"已达成。零风险。
  - **(ii) 按方案 §5.2 新增**：把上一轮的 reasoning 压成 ≤200 字符的结构化摘要（当前教学目标 / 工具调用目的 / 未完成步骤），作为独立字段或附加在 assistant 消息里；同时把 `q` 的模型判定从 `deepseek-v4*` 改成 `/^deepseek/i`，否则对实配模型永远不生效。
- **风险（选 ii）**：中。会改变模型每轮看到的输入；且 DeepSeek 对 `reasoning_content` 回传的语义未文档化（实测只验证了"不报错"，没验证"有帮助"）。
- **验证（选 ii）**：对比开启前后的重复提问率，不能只看通不通。

#### B2. 分区预算（§10）

- **位置**：`idx=106028` trim 块；system prompt 侧在模块 7788。
- **改法**：把单一 `_MAX_HIST_CHARS=12000` 换成按 §10 的区域预算表（稳定规则固定预算+版本号 / 资源摘要按教材规模 / 实时状态固定小预算 / 近期记忆固定轮数+字符 / 工具结果按焦点裁剪 / reasoning 极小预算 / 当前输入完整保留）。触顶时按 §10 的 5 步降级顺序执行，**且必须先删 reasoning、再删重复工具结果，绝不能先删当前学生消息**。
- **风险**：中。预算值定得太紧会引发模型反复重读教材（放大工具循环），建议先只**观测**（A3 日志）跑几节课，拿到真实分布再定阈值。
- **验证**：日志中各区长度分布稳定，总输入不随课堂推进单调增长。

### 批次 C — 高风险：改变模型可见的输入结构

#### C1. `<CLASSROOM_*>` 分区标记 + 协议版本号（§6）

- **位置**：模块 7788 的 system prompt 组装（`idx≈265` 起，分隔符 `\r\n\r\n---\r\n\r\n`，23 处）+ 尾部 `_late`（`## Study progress` / `## Current textbook content`）；注意还有 nuwa 模式的第二套 builder `n._`（模块 35684）——**两套必须同时改，否则按模式分裂**。
- **改法**：按 §6 五段包裹（STABLE_RULES / RESOURCE_CONTEXT / LIVE_STATE / RECENT_MEMORY / CURRENT_TURN），加 `version="..."`；§6 说标记只用于注意力分层，不要求模型复述。
- **风险**：**高**。这是模型每轮实际读到的文本，会直接影响教学行为。方案 §12 明确禁止顺带修改规则语义——只允许改呈现方式。
- **验证**：必须实机跑几节课对比，不能只靠 smoke test。

#### C2. 稳定前缀重排（§5.4）

- **现状**：动态内容大多已在尾部（好），但 `## Session outline`、`## Earlier conversation summary` 位于 prompt 中部。
- **改法**：把这两节（以及任何每节课变一次的字段）移到 `_late`，确保前缀只由"身份+规则+工具协议+低频资源"构成。
- **风险**：中（同 C1，改的是可见文本）。但这是让 DeepSeek 自动前缀缓存真正生效的**唯一**手段（见 §0.1）。
- **验证**：两节课之间 `prompt_cache_hit_tokens` 显著上升。

### 批次 D — 缓存与测试

#### D1. 缓存契约（§9）——按 §0.1 结论落地

- **改法**：DeepSeek 分支**不新增**任何缓存参数（现状已如此，保持）；把 `prompt_cache_key` 的 gpt-5.6 分支注释/文档化，避免后人以为它是通用参数；日志侧补齐 hit/miss。
- **验证**：断言发送给 DeepSeek 的 body 中不含 `prompt_cache_key` / `prompt_cache_retention`。

#### D2. 测试

- 新建 `resources/server/lib/reasoning/classroom-context-smoke-test.js`（或贴合实际落点的位置），覆盖：A0 长学生消息完整保留、A1 循环内裁剪与 tool 配对完整性、A2 重复/超限/空结果、A3 日志字段齐全、D1 请求体不含 GPT 缓存参数。
- 每次改动后按仓库约定跑：`node --check <file>` + 该模块 smoke test，最后 `node tools/run-smoke-matrix.js`。

---

## 3. 明确不做（§12 边界）

知识源 evidence cache、TTS 音频缓存、学习者长期数据事实内容、教学规则文本语义、Electron 主进程 / ASAR、输出结果复用逻辑 —— 一律不动。本清单全部改动落在 `route.js` 的课堂链路与 `chunks/9654.js` 的工具结果处理上。

---

## 4. 需要你决策的开放问题

1. **B1 方向**：维持"reasoning 完全不入历史"（现状，零风险），还是按方案新增受限摘要？
2. **C1/C2 是否现在做**：这两项会改变模型每轮读到的文本，必须实机验证；如果近期要上课，建议先只做 A 批次。
3. **预算阈值**：B2 的数值我倾向"先观测后定"，可否先只上 A3 日志跑几节课？

---

## 5. 建议实施顺序

```
A3（日志+bug） → A0（保当前输入） → A1（循环内裁剪） → A2（工具结果治理）
   ↑ 全程无行为风险，且 A3 为后续提供数据
然后观测一轮，用真实分布决定 B2 阈值
最后再议 B1 / C1 / C2
```

---

## 6. 实施记录（2026-09-12）

改动文件：`resources/server/.next/server/app/api/chat/route.js`（两处，均在原有 API 逻辑内）
新增测试：`resources/server/.next/server/app/api/chat/chat-classroom-context-governance-smoke-test.js`（17 项断言，全部通过）

| 条目 | 状态 | 落点 | 说明 |
|---|---|---|---|
| A0 保当前输入 | ✅ | 模块 9716 历史裁剪块 | 新增 `_lastUser` 定位：`_MAX_MSG_CHARS=1500` 截断跳过最后一条 user 消息；历史预算裁剪的上界改为 `_lastUser`，不得切进当前输入；当前输入 > 6000 字符时向 system prompt 追加一条"已完整保留、请分段处理"指令（zh / zh-TW / en 三语），不再静默砍短 |
| A3 分区日志 | ✅ | 同上 + 模块 20375 | 修掉 `sysPLen=${c.length}`（那是历史数组长度）→ 改为 `b.length`；新增 `outline=/memory=/live=/resource=` 四个区域的实测长度（按已知小节标题定位，到下一个 `---` 或 `##` 为止）；新增 `reason=` 裁剪原因；工具循环日志 `[ctx-trim-loop]`；缓存日志补 `cacheHitTokens` / `cacheMissTokens` |
| A1 循环内重裁剪 | ✅ | 模块 20375 `zf` 循环尾部 | 每轮工具调用后重算预算（复用 `_MAX_MSGS=24` / `_MAX_HIST_CHARS=12000` 语义，未新造阈值）；只从最旧处整组丢弃；**永不丢** system、当前 user 消息、最新一组 tool 结果；按 `role!=="tool"` 识别组边界，保证 `assistant(tool_calls)` 与 `tool` 结果成对 |
| A2 工具结果治理 | ✅ | 模块 20375 工具结果入列处 | 只读工具（`read_file` / `read_textbook_pages` / `get_textbook_toc`）按 `name+arguments` 去重，重复读取替换为指向首次 `tool_call_id` 的短占位；`read_file` 单条上限 8000 单位，其余工具 30000 单位兜底（`read_textbook_pages` 仍用执行器自己的 20000 单位预算）；预算换算复用 chunks/9654.js 模块 73358 导出的 `bP` / `Ui`，未新写估算器；写类工具不去重 |
| D1 缓存契约 | ✅（日志侧） | 模块 20375 | 未向 DeepSeek 新增任何缓存参数（现状已正确）；补记 DeepSeek 原生 hit/miss |
| D2 测试 | ✅ | 新 smoke test | 断言全部为**行为断言**：从 route.js 抽取片段在隔离沙箱内执行，预算函数从 chunks/9654.js 抽取（不是复制），因此测的是真实调用路径 |
| B2 分区预算 | ⏸ 未做 | — | 等 A3 日志跑几节课拿到真实分布后再定阈值 |
| B1 reasoning 摘要 | ⏸ 按方案 §8.1 不做 | — | 方案已将"reasoning 完全不入历史"定为现状约束 |
| C1 / C2 分区标记 / 前缀重排 | ⏸ 未做 | — | 会改变模型每轮读到的文本，需实机验证后再动 |

### 实测行为（来自新 smoke test 的日志输出）

```
[ctx-trim]      msgs=8 histChars=11200 trimmed=13 reason=history-budget sysPLen=3 ... user=1400
[ctx-trim]      long current user input kept intact chars=7000
[ctx-trim-loop] iter=3 msgs=6 chars=8170 cut=5 keptUserAndToolTail=true
```

### 遗留 / 已知取舍

- A1 采用**最旧优先**丢弃，不区分"旧对话文本"与"已完成的工具组"。方案 §10 的降级阶梯里"删除重复工具结果"在"压缩旧对话"之前，但 A2 的去重已覆盖重复读取这一主要来源，故未再细分；若后续日志显示工具组是主要膨胀源，可再调。
- `_MAX_HIST_CHARS=12000` / `_MAX_MSG_CHARS=1500` 沿用原值，未按 §10 拆成区域预算（那是 B2）。

---

## 7. 首轮日志复核（2026-09-13）

对 `%APPDATA%/socratopia/logs/socralab_debug.log` 里 40 次带新字段的请求做统计，**发现两处诊断缺陷并修掉**（均为 A3/A1 自身的问题，非方案条款）：

| 问题 | 现象 | 根因 | 处置 |
|---|---|---|---|
| 分区表失真 | `outline` / `resource` 恒为 0，`live` 却 20–27k，且恒有 `memory > live` | `_sec()` 只按 CRLF 找边界（`\r\n\r\n---\r\n\r\n`），而真实 system prompt 是 `o.join("\n\n---\n\n")` + 尾部拼接，**全为 LF**。找不到边界 → 每个区域都量到串尾；于是 `live` 实际是"从进度标题到串尾"，`memory` 同理，两者恒满足 `memory = live + 前序摘要节长度(≈1.4k)` | `_sec()` 改为按序尝试 `\n\n---\n\n## ` / `\r\n\r\n---\r\n\r\n## ` / `\n\n---\n\n` / `\r\n\r\n---\r\n\r\n` 取最早边界；CRLF 与 LF 两种形态都由 smoke test 覆盖 |
| 循环预算记账错误 | `[ctx-trim-loop]` 每次都触发，`cut` 中位数 22（几乎清空历史），裁剪后 `chars` 仍 30–38k | `r` 的**第 0 位就是 system prompt**（`r=[{role:"system",content:c},...]`）。原实现把 37k 的 system prompt 计进 `_TMC=12000` 的会话预算 → 恒超预算 → 每次都被压到下限，历史被无条件丢掉。日志里的 `chars` 也因此是"含 system"的数 | 预算改为从下标 1 起算（`for(let _i=1;...)`），只量会话部分；日志同时输出 `convChars`（会话）与 `sysChars`（系统提示），字段含义不再含混 |

### 真实 prompt 结构（据本轮核对，修正此前误解）

`b = await Ex(...)`（模块 7788，即 route.js 内的 `u`）→ 随后 handler 再追加：

```
[rules_zh_classroom_compact.md]          ~8.3k   ← o[0]，恒定
[...角色/关系/世界/学习者/教材库 等节...]  ~2k
## 学习进度（当前教材）+ progress.md      ← live
## 当前教材内容（本节课已读取）           ← 通常**被去重跳过**（_dupReading）
## 前序对话摘要 + lesson_summaries/*.md   ← memory
...规则尾节（页码/旁白/LaTeX/下课硬规则）...
[builder 返回后再追加] \n\n---\n\n
[本课教材窗口 v2 · 权威且不可变] + 视窗正文 ← 新增 snapshot 区域
```

要点：
- `resource` 恒为 0 **不是**缺陷——`_dupReading` 命中时该节主动跳过，正文改由尾部"权威教材窗口"承载（§8.1 的预加载路径）。故新增 `snapshot=` 区域单独计量。
- `live` 在修正前 ≈ 进度节 + 窗口节；修正后只量进度节。
- `outline` 恒为 0 属真实情况：该世界无 `session_plan.md`。

### 首轮分布（40 次请求，修正 `_sec` 前的旧口径）

```
sys 30122–37852 (p50 37402)   histChars 945–11836 (p50 8432)
memory 0 或 ~28.1–28.5k(旧口径)   live ~20–27.5k(旧口径)   outline/resource 恒 0
trimmed>0 11/40（全为 per-message，history-budget 一次未触发）   longUser 0
```
- **历史预算 12000 从未触顶**（`reason=history-budget` 0 次），说明当前 `_MAX_HIST_CHARS=12000` 对本课堂偏宽松，历史膨胀不是当下的主要矛盾。
- 主膨胀源是**尾部教材窗口**（旧口径 `live` 20–27.5k，且随翻页浮动），以及恒定的规则前缀 8.3k。
- DeepSeek 输入缓存命中良好：`deepseek-flash/chat-stream` n=112，`promptTokens` p50 22599、p90 31388，命中率 p90 94.5%（冷启动首轮为 0，故均值被拉低）。

> ⚠️ 上表为 **`_sec` 修正前**的数据，`live` / `memory` / `resource` 三列不可直接用于定预算。修正后的 `convChars` / `snapshot=` 需重启应用、再上一节课才有数据。

---

## 8. 批次 B2 + C（2026-09-14）

改动文件：`resources/server/.next/server/app/api/chat/route.js`（§5.4 排序 + §6 标记 + 分区预算）
新增测试：同 §6 的 smoke test，断言 20 → 36 项，全部通过；chat 目录 7 个测试与全量矩阵 117 项均通过（矩阵 2 项失败为 `main.js` / `preload.js` 层既有问题，与 route.js 无关）

### 8.1 先做的测量：缓存前缀被打断（这是本批次的主要依据）

对 148 条 `deepseek-flash/chat-stream` 缓存记录做直方图：

```
hit==0（全冷）      72 / 148  (49%)
1-25%              30
75-90%             13
90-100%            28
```

关键在 **1-25% 那 30 条**：`cacheHitTokens` 稳定钉在 **4864–5888 token**（对应约 8.3k 字符，正好是 `rules_*_classroom_compact.md`），而 `promptTokens` 是 20–26k。也就是说**只有稳定规则进入缓存，其后全部重算**——按 §5.4 的说法，高频字段插在了稳定规则之后、巨型教材视窗之前，把前缀打断了。§13 明确要求"稳定前缀不会被高频课堂状态打断"。

结论：**当时的真正矛盾不是"总量超标"（总 prompt 约 35k 字符 ≈ 22k token，离上下文上限很远），而是前缀被高频小节切断**。所以 B2 的"预算"更多是护栏，收益主要来自 C2 排序。

### 8.2 实施内容

| 条目 | 落点 | 说明 |
|---|---|---|
| C2 §5.4 稳定前缀 | 模块 7788 `u` 收尾（新增 IIFE） | 在 join 前对 `o`/`_late` 按**分带 rank** 稳定排序：`0`=稳定规则/身份/世界/学习者/教材/教材库/提纲/指令尾节，`1`=资源（教材视窗），`2`=高频实时（关系/相处片段/群消息/上次日期/当前状态/精力/进度/当前练习题），`3`=前序对话摘要。未识别的小节默认 rank 0（宁可留在稳定带） |
| C1 §6 注意力分层标记 | 同上 + handler 拼接处 | 每带包裹 `<CLASSROOM_STABLE_RULES version="ctxt-v1">` / `<CLASSROOM_RESOURCE_CONTEXT version="ctxt-v1">` / `<CLASSROOM_LIVE_STATE>` / `<CLASSROOM_RECENT_MEMORY>`。`CURRENT_TURN` 属消息层，本批次未包 |
| 教材视窗进稳定前缀 | `u` 产出哨兵 `<!--CTX_RESOURCE_BOUNDARY-->`；handler 在其位置替换 | 视窗原本在 `Ex()` 返回后才追加到串尾，故永远落在缓存前缀之外。现在改为在"资源带"内拼接：`_pk[0] + 预览头+视窗 + _pk[1]`；无视窗时折叠掉多余分隔符；nuwa 路径（`n._`，无哨兵）回退为原追加行为 |
| B2 分区预算（护栏） | 模块 9716 分区日志处 | 显式阈值：`stableContent=12000`、`resource=28000`、`live=2000`、`memory=2000`、`history=12000`；超限输出 `[ctx-budget] over budget: ...`。**仅告警不裁剪**——实测离上下文上限很远，先观察再决定是否降级 |
| §11 指标补齐 | 同上 + 循环日志 | 新增 `stable=`（§5.4 稳定前缀长度，可缓存前缀的直接度量）；循环日志补 `toolChars=` / `reasonChars=`。原缺口：稳定规则长度、工具结果长度、reasoning 长度均无度量 |

分带后的实测顺序（`route.js` 内 `Ex` 隔离运行，夹具注入）：

```
[rules] [当前教材] [指令尾节…]                      ← STABLE 带（rank 0）
[教材视窗]                                          ← RESOURCE 带（rank 1）
[关系] [相处片段] [群] [进度] [当前状态] [精力]      ← LIVE 带（rank 2）
[前序对话摘要]                                      ← RECENT_MEMORY 带（rank 3）
```

### 8.3 过程中踩到的坑（重要，勿重犯）

- **`u` 的收尾是一整个逗号表达式**：`return o.push(尾节A),x&&o.push(尾节B),o.join(SEP)`。`return` 作用于整个逗号表达式，返回最后一个值。我第一次改动在中间插了 `;`，**直接截断了 `return`**，`u` 改为返回 `o.push(...)` 的返回值（一个数字），表现为上层 `prompt.indexOf is not a function`。修法：新逻辑必须留在逗号表达式内 —— 用 `(function(){…})()` 立即执行，`o` 通过闭包被改写。
- 若把排序写成裸块 `{…}`，`}` 与后面的 `,` 也会冲突（"块语句后不能跟逗号"）。
- 修改后必须**实跑一次 `Ex()` 并断言返回 string**，只做 `node --check` 无法发现这类"能跑但返回错类型"的问题。`tmp/debug-ex-call.js` 就是为此写的。
- `_sec` 式区域表在分带后仍可用（带内小节仍以 `\n\n---\n\n` 分隔），但 `stable=` 会把资源带算进前缀，故预算检查用 `stableContent = stable − snapshot`，否则视窗会被重复计费。
- 新分区测试的**测试夹具本身也踩过两个坑**：忘记插入哨兵（走了回退分支）、把 `stable` 期望值算错。断言失败时先核对夹具。

### 8.4 首条线上样本（2026-09-14T11:20Z，重启后）

```
[ctx-budget] over budget: stable=21357>14000 sysPLen=27985        ← 当时 stable 阈值还没改
[ctx-trim] msgs=20 histChars=5980 trimmed=0 reason=- sysPLen=27985 stable=21357 memory=585 live=28 resource=0 snapshot=13425 user=23
```

- `stable=21357` 且 `snapshot=13425`：说明**线上确实把资源带排在了 LIVE 之前**（否则 `stable` 只会等于规则那 8k），C2 生效。
- 该样本 `stableContent = 21357 − 13425 = 7932`，在 12000 阈值内；`snapshot` 占全 prompt 48%。
- 样本只有 1 条；阈值待更多数据后再定。

### 8.5 残留 / 待验证

- **必须实机验证**：C1/C2 改变了模型每轮读到的文本顺序与标记。验证口径：重启后看 `[direct-llm-cache]` 的 `cacheHitTokens` 是否从 ~5k 抬升到接近 `stable=`（预期 ≈ 21k+），同时确认教学表现无回归。
- `## 当前教材（本次教学对象）` 内含 `**当前学习页码**`（页码属 §5.4 第 5 类"高频"），但仍留在稳定带。若线上 `cacheHitTokens` 明显低于 `stable=`，应把该节或页码字段下沉到 LIVE 带。
- `CURRENT_TURN`（当前学生输入）未加标记，属消息层，需改消息而非 system prompt。
- 预算目前**只告警不裁剪**；是否按 §10 阶梯（删 reasoning → 删重复工具结果 → 压缩旧对话 → 缩窗口）真正执行，待观察数据后定。
- 工具结果 `toolChars=` 为累计值（跨循环轮次），非单轮值。
- 既有的 `_energyTail` 逻辑（当精力文案含"你已经陪学习者学了不少了"时，把该节从原位置摘出并追加到串尾）在分带后会让该节**落在所有标记之外**。这是既有行为，未改；若要求带标记严格自洽，应将精力节并入 LIVE 带尾。

---

## 9. C 批次上线后的日志复核 + §5.3 工具结果（2026-09-17/18）

### 9.1 C 批次确实生效

按 §8.5 约定的口径核对（pre-fix 148 条 vs post-fix 21 条 `deepseek-flash/chat-stream`）：

| 指标 | pre-fix | post-fix |
|---|---|---|
| 完全冷启动（`cacheHitTokens==0`） | 72 (49%) | **0 (0%)** |
| `cacheHit/prompt` p50 / p75 | 12.6% / 77.0% | **27.0% / 94.7%** |
| `cacheHit/prompt` p90 | 96.4% | 95.6% |

- 有请求的 `cacheHitTokens` 达到 `stable=` 的 **105–137%**，即**整段稳定前缀（含 22k 教材视窗）连同历史一起命中**——改动前上限只有 ~5k token（规则一节）。
- `stable` 实测 p50 22605 / p90 29012 字符，占 system prompt p90 的 79.9%，说明资源带确实排进了前缀。

### 9.2 但前缀仍在被切断，断点在身份/世界节

低命中请求的 `cacheHitTokens` 稳定停在 **2048 / 3584 token**（÷0.77 tok/char ≈ 2.7k / 4.6k 字符）——正是 **`rules_*_classroom_compact.md` 结束之后一到两节**的位置。也就是说断点落在 `## 你的角色设定`（`npc_*.md`）/ `## 世界背景`（`story.md`）附近；这两个文件在课上会被伙伴改写，而按 §5.4 它们属"稳定身份"，被我放在了稳定带最前面。

盘面：断一次 → 下一请求即恢复高命中（前缀被重新缓存），所以是"每个变更点损失一次"。**结论：把`npc_*.md` / `story.md` 这类"课上会被改写的身份/世界文件"降级到 LIVE 带或紧邻资源带之后，是下一轮最直接的收益点。** 但这会改变模型读到的顺序，需再验证一次。

### 9.3 新的主要矛盾：工具结果吃掉整个会话

`[ctx-trim-loop]` 新增的 `toolChars=` 立刻暴露了问题（3 条样本）：

```
convChars=15774  toolChars=14927   cut=21
convChars=19216  toolChars=18250   cut=23
convChars=40758  toolChars=38191   cut=23
```

工具结果占会话 **94%**，`convChars` 到 40.8k，而循环预算 `_TMC=12000` 因为"当前轮 tool 结果不可丢"而永远达不到，于是每轮都把历史砍到下限（`cut=23`）。同时 `reasonChars` 只有 22–24 字符（reasoning 确实几乎不入历史，符合 §8.1）。

根因符合 §5.3 第 4 条：**"已经在稳定课堂状态中出现的内容不得再次原样复制"** —— 教材视窗已在稳定带里，模型却又调 `read_textbook_pages` 把同一批页读回来（该工具默认 10000、上限 20000 token，中文约 1 字/token）。

### 9.4 实施：视窗重复的 tool 结果改为短占位（§5.3）

落点：模块 20375 工具结果入列处，在"同参去重"之后、长度上限之前。

- 每轮开始时从 `r[0].content` 取出视窗正文（按 `[本课教材窗口 v2` / `[本課教材視窗 v2` / `[Authoritative reading window v2` / `[AUTHORITATIVE READING SNAPSHOT v2` 之首定位），存 `_snapT`。
- `_dupSnap(text)`：剥掉开头的 `<!-- … -->`（视窗正文以 `<!-- startPage: N endPage: M -->` 开头，否则前缀探测永不命中），然后在 **10% / 45% / 末尾** 三处各取 200 字符探测，**三处全部命中**才算重复（要求全命中是为了避免"只重叠一半"的结果被截掉尾巴）。结果 < 600 字符不探测。
- 命中则替换为 `[read_textbook_pages: … already present verbatim in the reading window …not re-sent. Original N chars.]`，保留来源指向；计入 `_toolChars` 的是占位长度。

用 4 个真实 `current_reading.md` 做离线核验（`tmp/check-dup-snap-real.js`）：整份重读 → 全部 STUB；窗口内 1/3 处起读 → 全部 STUB；窗口头 + 800 新字符 → 保持全文（保守，正确）；不相干章节 → 保持。

新增 5 项断言（重复即占位、窗外保持、半重叠保持、短结果不误判、无视窗不误判），治理测试 36 → 42 项。

### 9.5 顺手修掉一个线上 breakage（非本方案引入）

矩阵在 09-17 后新出现 `sensitive-api-auth-contract-smoke-test` 失败：`ReferenceError: Q is not defined` @ `app/api/concept-summary/route.js`。

- 该文件是 `"use strict"`，而模块作用域的处理器链 `Q=(0,y.pW)(…),respondPostClass=…,R=(0,y.pW)(…),S=new e.AppRouteRouteModule({…}),{workAsyncStorage:T,…}=S` 是**一整条 `let` 声明列表**，`let ` 关键字被某次编辑丢掉了 → 严格模式下裸赋值 `Q=` 抛错，整个 `/api/concept-summary` 模块加载失败。
- 修法：恢复 `let Q=`。修后 24 条路由全部可加载，矩阵 126/126 全绿（exit 0）。
- 教训：改这类压缩文件的长声明链时，别把链首的 `let`/`var` 删掉；`node --check` 查不出（语法合法），要靠**真的 require 一次**。

### 9.6 待验证 / 残留

- **先重启再上一节课**，核对 `toolChars=` 是否从 15–38k 掉到千级、`convChars` 是否回到 12000 以内。这是 §9.4 的成功判据。
- 若 `toolChars` 仍高，说明命中的是"半重叠"分支；下一步应做**保留尾巴**的局部替换（而不是整条保留）。
- §9.2 的身份/世界节降带（预期能把 `cacheHit/prompt` p50 从 27% 抬到 80%+）。
- 循环预算 `_TMC=12000` 目前对"当前轮 tool 结果"无约束；§10 阶梯第 4 步（缩窗口）仍未实施。

---

## 10. 定位并消除稳定前缀的断点（2026-09-18）

### 10.1 先算断点位置

对 §9.2 的低命中请求换算：`hitTokens=2048`，用 `promptTokens/sysChars` 实测的中文 token 比 ≈0.59 反推 → **≈3.5k 字符，正好等于 `rules_zh_classroom_compact.md` 的全长（3533 字符 / 8307 字节）**。另一档 3584 token ≈ 6.1k 字符，落在规则之后约 1.6k 字符处。

即：**断点就在规则节末尾——规则之后的第一节在变**。

### 10.2 改动

| 条目 | 落点 | 依据 |
|---|---|---|
| `## 世界背景`（`story.md`）降到 LIVE 带 | `_mk` 加 `["## 世界背景",2]` / `["## World background",2]` | `story.md` 在"下课硬规则"列出的可写文件里，课上会被伙伴改写 |
| `## 当前教材（本次教学对象）`降到 LIVE 带 | `_mk` 加同名两条 | 该节内嵌 `**当前学习页码**：N`，而 §5.4 第 5 类明确把"页码"归为高频 |
| **修正一个设计缺陷**：规则原本在稳定带**外面** | `_all` 由 `o.slice(1).concat(_late,_M)` 改为 `[o[0]].concat(o.slice(1),_late,_M)`；收尾 `o=_bd` | `o[0]` 是规则，原实现把它放在 `<CLASSROOM_STABLE_RULES>` **之前**。后果：一旦某轮没有任何 rank-0 小节，稳定带标记会整个消失；且语义上"稳定规则"本就该在带内 |
| 新增**分带哈希** `bh=` | `[ctx-trim]` 日志 | 4 段用 `.` 分隔，依次为「规则+稳定带 / 资源带 / LIVE 带 / 记忆带」的 djb2 前 5 位。**相邻两轮的哈希差在哪一段，就是哪一段在破坏前缀**——把"猜是哪节在抖"变成可观测 |

分带哈希用"下一个*存在*的边界"作上界，因此缺标记时只该段显示 `-`，不会串段。

### 10.3 测试

- 新增断言：`the rules are the first thing inside the stable band`（规则必须落在稳定带内）、`the region meter reports a hash per band`；并把原先拿 `## 世界背景` 当稳定小节的 5 处夹具改为 `## 学习者信息`，在 `§5.4 带宽` 测试里把 `世界背景`/`当前教材` 移入 live 列表。
- 治理测试 42 → 44 项，全过。
- 全量矩阵 125 PASS / 1 FAIL：失败项是 `lib/tts-classic-stream-zero-audio-live-smoke-test.js`，`fetch failed` —— 它打 `127.0.0.1:8000` 的本地 TTS 服务，当前该服务未启动（`curl` 返回 000）。**环境项，与本方案无关**；`concept-summary`（§9.5 的修复）经 `sensitive-api-auth-contract-smoke-test` 复核仍为 PASS（24 条路由可加载）。

### 10.4 下一次检查怎么看

重启后跑一节课，然后：

1. **先看 `toolChars=` / `convChars=`**（§9.4 的判据）。
2. 再看 `[direct-llm-cache]` 的 `cacheHitTokens` 是否抬到接近 `stable=`。
3. 若仍未抬，**对比相邻两条 `[ctx-trim]` 的 `bh=`**，第几段不同就是哪一段在抖：
   - 第 1 段不同 → 仍在"规则+稳定带"里，把 `## 你的角色设定` 也降到 LIVE（它当时按 §5.4 第 1 类"稳定身份"留在带内，尚无证据表明它会变）。
   - 第 2 段不同 → 教材视窗本身在换页，属正常换窗，只能靠减少非必要换窗。
   - 第 3 段不同 → 正常（LIVE 本就会变），说明改动到位。
- Hmm，注意第 3 段（LIVE）**本来就每轮都变**，它的哈希不同是预期的；关键是**前两段是否稳定**。

### 10.5 残留

- `## 当前教材（本次教学对象）`整节降到 LIVE 后，教材 ID/书名也跟着离开稳定带（§5.4 第 4 类本该在稳定带）。若要两全，应把 `**当前学习页码**` 从该节拆出单独成节而非整节降带。
- `## 你的角色设定` 仍在稳定带（依据：`npc_*.md` 不在可写文件清单里）；待 `bh=` 数据验证。

### 10.6 实测结果（2026-09-18 ~ 09-21，20 条带 `bh=` 的请求）

**降带成功，且效果可量。**

1. **`bh=` 第 1 段（规则+稳定带）在整个会话内恒定**：09-18 会话全为 `ivzvd`，09-20/21 会话全为 `1hhdx`。跨会话才变。即稳定带内容逐字未变。
2. **恒定前缀长度 = 6580–6601 字符，20 条请求全部相同**。
3. **提供商缓存现在稳定覆盖这整段前缀**：低命中请求的 `cacheHitTokens` 恒为 **3712**，而 3712 ÷ 前缀的 token 密度（ASCII 偏多，约 0.56 tok/字）≈ 6600 字符 = 前缀全长。即"不改窗时命中达到前缀上限"。
   - ⚠️ 换算口径提醒：用 prompt 平均比（0.62 tok/字）把 token 回折成字符会**低估**前缀的字符数（前缀 ASCII 多、密度低），所以按 0.62 算出来的"覆盖率"只有 65–80%，容易误判成"断点在前缀内部"。用前缀自身密度 0.56 才是 100%。
4. 窗口不变的请求命中直达 **12.8k–26.3k token**（整个 system prompt 连历史一起命中，`hit/prompt` 达 95%）。
5. **全冷请求 1/20**，且就是重启后第一条。pre-C 基线是 49%。
6. **§5.3 视窗去重效果确认**：`toolChars` 由 14927 / 18250 / 38191 降到 **50**；同轮 `convChars` 40858 → **6944**，`cut` 23 → 4。即该轮工具结果整体被判为视窗重复而替换为占位。
7. 修掉一个诊断撞名：预算行原本把 snapshot 标成 `resource=`，与日志里另一个含义不同的 `resource=`（`## 当前教材内容` 小节长度）混淆，改为 `snapshot=`。矩阵 127/127 全绿（exit 0）。

### 10.7 结论：下一个杠杆是教材窗口，不是带序

`bh=` 第 2 段（资源带＝教材视窗）在 20 条请求里出现 **14 个不同值**，是当前唯一的规律性失效源；第 3 段（LIVE）12 个不同值属预期。另：
- 3 条请求触发 `snapshot=31022>28000` 预算告警（`sysPLen=44106`）。
- 1 条请求 `snapshot=0` 但 `resource=1318`——窗口缺失而小节正文在，两种承载方式互相交替。

所以后续优化方向：① 教材窗口的换窗频率与尺寸（是否只在教学焦点真正移动时才换）；② §10.5 提到的"页码字段拆节"（把 `**当前学习页码**` 单独成节，教材 ID/书名回稳定带）。

其余待办见 §10.5、§9.6。

---

## 11. 完整课堂（2026-09-25 08:06–10:42）复核 + 缺陷清单

本节分析的是一节完整课堂（36 次模型调用、35 条 `[ctx-trim]`、约 2.5 小时）。**该节课的模型是 `gpt-5.6-terra`（走 `/v1/responses`），不是 deepseek-flash**——DeepSeek 专属字段（`prompt_cache_hit_tokens`）恒为 0，真正的命中数是 `prompt_tokens_details.cached_tokens`。分析脚本原先只读前者，已修。

### 11.1 前几轮改动确认生效

- `bh=` 第 1 段（规则+稳定带）**全节课 35 条请求恒定**（`13sag`），稳定前缀逐字未变。
- 该节课 **0 条 `[ctx-budget]` 告警**、`history-budget` 一次未触发、长输入指令一次未触发；`outline`/`resource` 恒 0 属预期。

### 11.2 剩余 33% 全冷请求的根因已确证

36 次调用按"该请求相对上一请求有无分带变化"交叉制表：

| | 冷（hit=0） | 热 |
|---|---|---|
| **有分带变化** | **12** | 3（均为仅 seg3 变化） |
| 无任何变化 | **0** | 21（含 1 条首请求） |

- 因果极干净：**只要分带没变就必命中（21/21），只要变了就大概率全冷（12/15）**。
- 12 条全冷里 **10 条由 seg1（教材窗口）变化引起**；全节课 35 条请求里 seg1 变了 10 次 → 10 次全冷 × 每次约 2.6 万 token 重算。
- seg2（LIVE）总与 seg1 同变，因为 LIVE 带含 `## 学习进度（当前教材）`（页码/进度随换窗更新），属预期联动。
- **结论：教材窗口换窗是唯一确定性失效源，也是最后一个可动杠杆。**

另记：08:50:57 有一次 `bodyKb=43`、`elapsedMs=238327`（近 4 分钟）、`responseBytes=2061381`（2MB）的模型调用，逼近 `timeoutMs=360000`。

### 11.3 查出的缺陷与处置

| # | 缺陷 | 证据 | 处置 |
|---|---|---|---|
| 1 | **`_MAX_MSGS=24` 静默丢消息**：裁剪不计入 `_trimCount`、`_trimReason` 也不写，日志里表现为 `trimmed=0 reason=-`，看不出历史被丢 | 全节课 `msgs` 多次顶到 24 | 改为 `reason=msgs-cap`、计入 `trimmed`、`trimmedWhat=msgs-cap:N`。**注意踩坑**：计数变量原在切片之后声明，把切片前移会让 `_lastUser` 索引失效（与 §7 同一类陷阱），已将 `_lastUser` 移到切片之后 |
| 2 | **`_MAX_MSG_CHARS=1500` 过度触发**：13/35 条请求触发 `reason=per-message`，而同期 `histChars` 最高仅 7550，**12000 的历史预算只用掉约 60%**。被截的是上一条助手回复的**头部**，丢掉尾部（通常是提问/下一步） | 上表 + histChars 分布 | 上限 1500 → 3000。历史仍由 12000 预算兜底，**总长上界不变**，无 prompt 膨胀风险；4000+ 字仍会截断并记录 `trimmedWhat=<role>:<原长>` |
| 3 | **§5.3 视窗去重的命中率不可观测**：日志里只有触发循环裁剪时才输出 `toolChars=`，无法区分"没有重复"与"探测没命中" | 08:51 `toolChars=18375` 无法判因 | 新增 `[ctx-dup]` 判定行：`stub` / `miss@10%\|45%\|tail "<探针前26字>"` / `nowindow` / `short`；stub 与 miss 都记，便于直接算命中率 |
| 4 | 顺带**证伪**了"OCR 两次输出不一致导致探测失败"的猜想：同书同页不同 pass 文本**逐字节相同**（14/14 对） | `tmp/check-dup-snap-real.js` 的扩展检查 | 探测失败的真实原因需靠 #3 的数据定位 |
| 5 | 分析脚本对大模型无感知：只读 DeepSeek 的 `cacheHitTokens`，`gpt-5.6-*` 全被读成 0 命中 | 本可早发现 | 改为 `cacheHitTokens \|\| cachedTokens`，并新增 `[ctx-dup]`、`trimmedWhat` 的解析段 |

### 11.4 本方案之外的既有问题（该节课日志）

1. **`[post-class-notes] stage=degraded event=job_degraded` 反复出现**：09-22、09-23、09-25 两次，score 0.857–0.933。课后笔记流水线**规律性降级**，值得单独排。
2. `[kb-progress] marker rejected: taught_page_outside_loaded_range` ×1：进度标记声称讲到的页落在已加载窗口之外。
3. `[auto-advance] legacy projection repaired` + `external reading window stashed for the next turn` 与工具读取同时发生：窗口在课中被修复/外部置入。
4. `[pdf-ocr] contiguous window capped at targetChars` ×24（`contiguousChars: 21047` vs `targetChars: 20000`）：每次读取都撞 OCR 上限。
5. 矩阵偶发单点失败：连续两次全量运行各挂了**一个不同的**无关 lib 测试（`pdf-ocr-priority` / `kb-inflight-contract`），单独跑均 PASS。两者都依赖真实时钟（如 `deadlineAt: Date.now()+3000`），判定为负载导致的脆弱测试，不是代码回归。**"矩阵全绿"因此不能当作无回归的证明。**

### 11.5 下一步

- **先重启再上一节课**，读两处新仪表：`[ctx-dup]` 的 stub/miss 比例（§5.3 是否真在省 token）、`trimmedWhat`（截断角色与原始长度）。
- 最后一个缓存杠杆：**让教材窗口在课内只追加**（或仅在超过尺寸阈值时才从头部截断并标注）。预期把 33% 全冷压到 10% 以下。属 auto-advance 侧改动，需单独评估。
