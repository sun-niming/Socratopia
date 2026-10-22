# Socratopia 调用额度优化方案（含代价）

> 证据窗口：`<userData>\logs\socralab_debug.log`
> 官方端点 `https://api.deepseek.com`，2026-09-17 → 2026-10-16，422 次调用。
> 账单锚点：控制台当月 10,287,807 tokens / ¥14.07；10-16 当日 1,070,983 tokens / ¥1.16。

---

## ✅ 已实施（2026-10-17）

| 项 | 文件 | 改动 | 验证 |
|---|---|---|---|
| **L1b** | `resources/server/.next/server/app/api/chat/route.js` | 主对话 `create()` 在 `thinking` 为真且模型匹配 `^(?:deepseek\|gpt-5\.6)` 时附加 `reasoning_effort`（默认 `low`，可用环境变量 `SOCRATOPIA_REASONING_EFFORT` 覆盖） | `node --check` 通过；acorn 通过；classroom-context + **thinking-gate smoke 均 PASS**；两站点实测 `thinking:enabled + effort=low` 均 HTTP 200；线上日志已见 `effort=low` 生效 |
| **L6** | 同上 | `F()` 增加第 7 个参数，把稳定的教材进度块 `m` 作为**首条 user 消息**单独发送；transcript 不再与 `m` 融在一条消息里 | 静态 6/6 校验通过；`node --check` 通过；smoke PASS；两站点 A/B 命中率 **14% → 63~69%**，未命中 −57% |
| **L6-同源** | `.../api/flashcard/route.js`、`.../api/companion/reconcile-persona/route.js` | 同一种"易变字节排在稳定字节之前"的布局缺陷。flashcard：稳定教材块提升为**首条消息**；reconcile-persona：把易变的目标字段块从消息**头部挪到尾部**（并同步修正"上方"→"下方"措辞） | `node --check` + acorn 通过；构造器实跑三种语言分支，稳定段确实前置于易变段；线上 A/B 命中率 **flashcard 29%→42%、reconcile 0%→55%**（离线对照 92% / 67%）；输出仍为合法 JSON / 合法 markdown（ratio 1.09 在允许区间内） |

**L6 实测 A/B（滑动窗口 10~22 轮，两站点各 13 次调用）：**

| 车道 | 旧布局命中 | 新布局命中 |
|---|---|---|
| 校园端点 `DeepSeek-V4.1-Flash` | 14.1% | **68.5%** |
| 官方端点 `deepseek-flash` | 13.7% | **63.3%** |

**同源缺陷 A/B（离线受控，同一稳定块 + 递增窗口）：**

| 车道 | 旧布局命中 | 新布局命中 |
|---|---|---|
| `flashcard`（一条消息 → 稳定块独立成首条） | 29.2% | **91.7%** |
| `reconcile-persona`（易变字段前置 → 后置） | 0.0% | **67.1%** |

> 应用已多次重启加载补丁（最后一次 16:49）。**新增日志字段**：`[chat] thinking=… effort=low model=…` —— 若看到 `effort=-` 说明该轮未走 deepseek 车道。
> 回滚：`git checkout -- resources/server/.next/server/app/api/chat/route.js resources/server/.next/server/app/api/flashcard/route.js resources/server/.next/server/app/api/companion/reconcile-persona/route.js`

### ⚠️ 本次修掉的一个自造回归

L1b 最初用 `/^deepseek/i` 作 effort 门控，但 `lib/thinking-gate-smoke-test.js` 明确禁止在这 10 个 payload builder 里出现"只看模型名"的旧谓词（BUG-0014 回归守卫）。所以 `thinking-gate-smoke-test.js` 一度 FAIL（`actual: 138698, expected: -1`），已把两处改用规范谓词 `/^(?:deepseek|gpt-5\.6)/i`，现 4/4 PASS。
**教训**：改 `chat/route.js` 后除了 classroom-context，**必须**一并跑 `node resources/server/lib/thinking-gate-smoke-test.js`。

### 已核对为"既有失败"的测试

- `chat-figure-catalogue-smoke-test.js`：5 项失败，`git stash` 对照确认原文件同样失败。
- `flashcard-adaptive-evidence-smoke-test.js`：`stage_c_request_uncertain`，同样 `git stash` 对照确认既有失败。

### 与方案的偏差（诚实记录）

- **L6 的真实收益比方案里写的 ¥0.96 小**。原方案假设是"并发 14 路"。实测**根本没有并发**（81 次侧车道调用落在 81 个不同秒，每秒最多 1 次）—— 之前看到的"同一秒 14 条"是日志续行没有时间戳造成的错觉。真正的原因不同：summary 车道把 `m` 和 transcript 融在一条 user 消息里，且只截取最后 10 条、每条 250 字，导致消息头部每次都变，**跨调用缓存恒为 0**。所以 L6 实际做的是"修 summary 车道布局"，实测收益约 **¥0.31/月（该车道未命中 −58%）**，另外 `effort=low` 也把 summary 车道的输出一起降下来。
- **不是所有"融合消息"都有病，实测推翻了我原先的假设。** 我先按"拆成两条消息"去改 `lesson-summary` 和 `groupchat`，结果命中率几乎不变（55.8% → 55.8%）。原因是它们的 transcript 本身就是**纯追加**（每轮在尾部加内容），单条消息也能命中。真正的判据是 **"易变字节是否排在了稳定字节之前"**：
  - `flashcard` 把依赖消息条数的指令 `请生成最多 N 道选择题` 放在最前、稳定教材块在后 → 每次条数一变，整个前缀失效。
  - `reconcile-persona` 把易变的目标字段块放在最前、稳定的人设 markdown 在后 → **命中率恒为 0%**。
  - `concept-summary` 的头部是稳定的（教材名/伙伴名/篇幅），所以本来就是 62.9%，改与不改一样。
  - 所以最终只动 `flashcard` 和 `reconcile-persona` 两个，`lesson-summary`/`groupchat`/`concept-summary` 保持原样（实测无收益就不改，减少回归面）。
- `concept-summary` 走的是手写 `lib/post-class-notes/provider.js`（不是编译版 `callLLM`），其 `buildRequestBody` 把 `userContent` 固定放在第二条消息——要再优化得改它的 `prompts.js` 拼装顺序，收益有限，本次未动。

---

## 0. 先看清钱花在哪：59% 是输出，39% 是未命中输入

由账单 + 日志反解出的单价（按平台自己的 0.0333×命中 / 3×输出 倍率标定）：

| 品类 | tokens | 占比 | 花费 | 占账单 |
|---|---|---|---|---|
| 输出（含思维链） | 2,047,000 | 19.9% | ¥8.37 | **59%** |
| 未命中输入 | 4,045,004 | 39.3% | ¥5.51 | **39%** |
| 命中输入 | 4,195,840 | 40.8% | ¥0.19 | 0.4% |

反解单价：未命中 ¥1.36/1M · 命中 ¥0.045/1M · 输出 ¥4.09/1M。
（命中价只有未命中的 1/30，所以**重发上下文几乎不要钱，真正贵的是输出和冷前缀**。）

**平均一次调用 ¥0.033，其中输出占 59%、未命中占 39%。**

### 三个真实成因（都在代码里，可复现）

1. **主对话没有 `max_tokens`，且思维链永远开着。**
   `route.js` 的 `chat.completions.create` 只传 `messages / stream / tools / thinking`，不含 `max_tokens`；模型卡默认 `effort=high`。实测"写长一点"能一次吐 12,455 tokens。
2. **系统提示词的抖动带排在消息历史**前面**。**
   实测 band 顺序 `stable(27.5k字符, 抖动11%) → resource/教材窗口(19.8k字符, 抖动45%) → live(抖动50%) → memory(抖动21%) → 历史`。
   前缀缓存命中遇到第一个不同字节就断，于是**教材窗口一抖，后面的历史全部作废**（历史 5.8k–9.5k 字符随每轮增长）。
3. **侧车道自成一套缓存命名空间，而且会并发炸开。**
   实测同一秒内 14 连发（1×`end-class` + 13×`kb-distill`），命中率 0–1.3%；`summary` 命中率 8.7%、`end-class` 31%。

---

## 1. 优化清单（每项附实测收益 + 代价）

收益均为**当月 ¥14.07 账单**上的实测/外推值。

| # | 方案 | 月省 | 实施代价 | 你要付的代价（风险/损失） |
|---|---|---|---|---|
| **L1** | 思维链**按需开启**（普通轮关，难题/证明/算法轮开） | **¥4.02 (−29%)** | 中：需判定"这一轮算不算难题" | 难题轮若误判为普通轮，推理深度下降；首字延迟反而变短（42s→17s），但**关闭的轮看不到思维链**（UI 本来也只在部分场景展示） |
| **L1b** | 全轮改用 `reasoning_effort=low`（仍然开思维链） | **¥3.66 (−26%)** | **极低：一处加字段** | 输出 6749→3799 tokens；实测 8/8 仍带提问、8/8 仍带公式，**可见答案变短**（676→473 字符） |

> **L1 的强度依赖话题**：数学推导话题关闭思维链后输出降 69%，化学平衡话题降 **85–88%**（9183/7717 → 1170/946，两次独立复现）。
> 即"普通教学轮"越多，L1 的收益越大；上表取偏保守的 −29%。
| **L2** | 抖动带移到**本轮消息尾部**，历史保持纯追加 | **¥1.66 (−12%)** | 中高：要改系统提示词装配 + 防回归 | 实测未命中 −39.6%。但要同步改 3 处下游：教材窗口嗅探 `r[0]`、`_dupSnap` 去重、`say` 尾部提醒；改错会让教材窗口识别失效 |
| **L3** | 侧车道复用主前缀 + 合并 `kb-distill` 突发 | **¥0.79 (−6%)** | 中：要给侧车道传主对话前缀 | `kb-distill` 每张卡内容不同，无法全部共用，只能合并成一次批处理；侧车道耗时略升 |
| **L4** | deepseek 也发 `prompt_cache_key` / `retention=24h` | ¥0.11 (−1%) | **无：去掉 `/^gpt-5\.6/i` 前置判断** | 现在几乎不省（官方端点本来就按前缀命中），但换到中转站/多模型路由后能防串扰 |
| **L5** | 放宽 `_MAX_HIST_CHARS=12000` 前段裁切 | ¥0.37 (−3%) | 低：改一个常量 | 单次请求 prompt 变大；换来的是历史前缀不再从中间被砍（实测裁切后命中掉到 43.6%） |
| **L6** | summary 车道布局：稳定块独立成首条消息 | ¥0.31（实测） | 低：两处 | 无 UI 影响（侧车道不产出可见回复） |

### 组合效果

**L1 + L2 + L3 → ¥14.07 降到约 ¥7.6（−46%）。**
若把 L1 换成 L1b（代价最小），组合约 −43%。

---

## 2. 建议的执行顺序（按"省得多/风险小"排）

1. **L1b（先做，1 行）** —— 立刻看到 −26%，零架构风险。验证 2–3 天后决定是否上 L1。
2. **L6 + L5（各 1 处改动）** —— 各自独立、可回滚，合计再 −10%。
3. **L3（侧车道复用前缀）** —— 侧车道本来就不参与教学轮，改它对主体验无感。
4. **L2（band 重排）** —— 收益最大但最需要测试，放在前三步跑稳之后。跑 `node resources/server/.next/server/app/api/chat/chat-classroom-context-governance-smoke-test.js` 兜底。
5. **L1（真正的按需思维链）** —— 收益最高，但需要"难题判定"，建议最后做。
6. **L4** —— 顺手清掉即可。

---

## 3. 一句话总结

账单里**没有一笔是"被浪费的重发"**（命中价只有未命中的 1/30，¥0.19 可以忽略）。
钱全部花在**输出（59%）**和**因为系统提示词顺序不对而反复作废的冷前缀（39%）**上。
所以优化只有两件事：**让思维链别每轮全开**（−26% ~ −29%，惰性话题可达 −85%），**让抖动的内容排到历史后面**（−12%）。

---

## 4. 每条方案具体改哪个文件

| # | 文件 | 锚点 |
|---|---|---|
| L1 / L1b | `resources/server/.next/server/app/api/chat/route.js` | 约 @138688 `...?{thinking:{type:l.thinking?"enabled":"disabled"}}:{}})` —— 同一处 `create({...})` 里加 `max_tokens` 或 `reasoning_effort` |
| L2 | 同上 | @16125 `<!--CTX_RESOURCE_BOUNDARY-->` 起的 band 排序 IIFE（`_rank` / `_all.sort` / `_tag`） |
| L3 / L6 | 同上 + `lib/kb-distill*` | 侧车道 `callLLM` 调用点（`purpose:'kb-distill'`）；**L6 已改的是 `F()`（@54213 起）与其调用点** |
| L4 | route.js + `chunks/1576.js` + `chunks/4092.js`（module 64092 的 6 个定义处） | `/^gpt-5\.6/i.test(...)?{prompt_cache_key...` 共 16 处 |
| L5 | route.js | `_MAX_HIST_CHARS=12000` |

> ⚠️ 改 `route.js` 后必须跑：`node resources/server/.next/server/app/api/chat/chat-classroom-context-governance-smoke-test.js`
> （该测试从 route.js 里原样切出 band builder 与 `[ctx-trim]`/`bh=` emitter 来断言，L2 一定会打到它）
> 以及 `node --check` 每个改动文件。
>
> 📌 `chat-figure-catalogue-smoke-test.js` 有 **5 项失败是既有问题**（与本次改动无关，已用 `git stash` 验证过）：
> `the block sits in the prompt assembly, after the reading snapshot` / `the block passes the conversation and scope through` /
> `running the block appends the catalogue to the prompt` / `an empty catalogue leaves the prompt byte-identical` /
> `no serializer global, a missing conversation, and a throwing serializer all degrade`。
>
> 📌 其余 chat 集成测试报 `spawn EPERM` 是环境问题（沙箱下 `child_process.fork` 管道受限），非代码问题。

### 仍未修的同源 bug（可选后续）

同一"稳定块与变动内容融在一条消息里"的形态还出现在：
- `resources/server/.next/server/app/api/flashcard/route.js`（`h.slice(-60)`，每条 1500 字）
- `resources/server/.next/server/app/api/lesson-summary/route.js`（`slice(-900)`，单条 user 消息）
- `resources/server/.next/server/app/api/concept-summary/route.js`、`groupchat/route.js`、`companion/reconcile-persona/route.js`

修法与 L6 完全一致：把稳定段拆成独立的前置 user 消息。

---

---

## 附：复现脚本（均在本地 `tmp/`，未入库）

| 脚本 | 作用 |
|---|---|
| `soc-session-ab.mjs` | 8 轮真实教学会话，thinking on/off/effort-low 对比（输出 6749 / 2110 / 3799） |
| `soc-session-ab2.mjs` | 换到化学平衡话题独立复现：thinking on 9183/7717 vs off 1170/946（−85%） |
| `soc-ab-ride.mjs` | 带状布局实测：抖动带移到尾部，未命中 −39.6% |
| `soc-ab-struct.mjs` `soc-ab-real.mjs` | 布局方案横向对比（尾部注入 vs 重排序） |
| `soc-bh2.mjs` | 从 `[ctx-trim]` 反解各 band 抖动率与长度 |
| `soc-plan-final.mjs` `soc-day-money.mjs` | 账单标定与逐项收益 |
| `soc-probe-effort.mjs` `soc-probe-var.mjs` | 思维链 / effort 档位的实弹测量 |
