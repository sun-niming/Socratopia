# DeepSeek v4 Flash 课堂上下文治理 — 实施清单

对应方案：`DEEPSEEK_V4_FLASH_CLASSROOM_CONTEXT_PLAN.md`
状态：**批次 A + B2 + C 已实施**（2026-09-12 批次 A；2026-09-13 修两处诊断缺陷见 §7；2026-09-14 §5.4 稳定前缀 / §6 标记 / 分区预算见 §8）。C 批次改变模型读到的文本，**待实机验证**
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
