# `<say>` 内联朗读标注协议：落地记录与失败根因清单

日期：2026-09-24
结论：代码已全部落地、回归全绿；但**在 app 里始终没生效**，根因是 Electron 的 Chromium 磁盘缓存把前端冻在了改动之前（§4）。
修复缓存后需要重启 app 实测一次，才算真正验收。

> 代码注释里保留的 `§x.y` 是原设计稿 `docs/say-inline-speech-protocol.md`（已删）的章节号：
> §2 现状管线、§3 协议语法与约束、§4 改动点、§5 并发与时序、§7 测试计划、§8 决策记录。
> 本文件按时间与根因重新组织，内容已覆盖上述各节。

---

## 一、要解决的问题

数学内容的 TTS 朗读生硬：条件概率、集合运算、多义符号（`|A|`、`f'(x)`、`P(A|B)`）经确定性转换器读出来不自然。

方案：让模型**只为这类公式**额外给一句自然读法，紧跟公式闭合符、写在句末标点之前：

```
$P(A|B)$<say>p 条件下 a 的概率</say>。
```

- 命中 → 用模型给的文字朗读，并**跳过 `/api/math-speech` 请求**
- 未命中 / 违规 → 走原有确定性管线，逐字节不变
- 标注剥离后**不进显示文本**（用户看到的 HTML 一行不动）
- 曾经评估过的「双输出（阴阳文本）」方案被否决：内容输出两遍、token ≈ 2×、破坏流式首句

## 二、落到哪些文件

| 文件 | 改动 |
|---|---|
| `resources/server/lib/say-speech-protocol.js` | 新增：`buildSayPromptBlock`（zh / zh-TW / en）、`SaySpeechParser`、`createSayHintTracker`、校验与常量 |
| `resources/server/lib/voice-emotion-protocol.js` | say 状态机（`sayProtocol` 默认关闭）、`hints` 输出、tracker 透传 `speech_hint`；扫描游标重构（§5） |
| `resources/server/server.js` | 注入表加 `__SAY_SPEECH__` 一行；**文件末尾加静态资源缓存改写（§4）** |
| `.../app/api/chat/route.js` | `createSegmentTracker({…,sayProtocol:!0})` + 提示词块注入（同一个 try 块） |
| `.next/static/chunks/math-speech-adapter.js` + `4137-….js` 内嵌副本 | `options.hints`：命中即用、跳过请求；两副本逐字节同步 |
| 5 × `.next/static/chunks/app/page-*.js` | 各 6 处同构补丁，把 `speech_hint` 接进同一条 SSE 有序处理器（§6） |
| 新增 3 个 smoke | `lib/say-speech-protocol-smoke-test.js`(22)、`chat-say-protocol-integration-smoke-test.js`(10)、`chunks/app/say-hint-adapter-smoke-test.js` |

未触碰：`.next/server/chunks/*.js`、module 64092 的 6 处 definer、`groupchat/route.js`、`app.asar`、三份 route manifest、`release-runtime-manifest.json`。

## 三、设计稿的四处错误前提（动手后才暴露）

1. **前端 SSE 事件处理不在 4137 chunk，在 5 个 page bundle 里。** 4137 只有内嵌 adapter 和一个「设置变更」事件总线（`a.A.subscribe`），与 SSE 无关。所以「不改 page bundle」不成立。
2. **提示词块不能挂在 voice 提示词注入处**：那里被包在 `if(_voiceCtx && "auto"===_voiceCtx.mode)` 内，非 auto 模式永不注入。改挂 tracker 创建处，两件事写进同一个 `try`，「有解析器必有提示词、有提示词必有解析器」，构造上不可能不同步。
3. **chat 路由里 lib 模块零直接 require**（22 个 `global.__X__` 全走注入表），所以在 `server.js` 表里加一行，而不是开动态 require 的孤例。
4. **提示词三语言**：voice 块其实是中文单语，`tool_use` label 才是三分支；say 块按后者做了三份。

## 四、失败根因：前端补丁从未进入运行中的 app（真正的坑）

现象就是「根本没用，白烧钱」——**服务端每轮都在注入提示词、烧 token；前端一句都没生效**。显示正常（剥离是服务端做的），所以看不出哪里不对。

证据链：

1. 本地 server 对 `/_next/static/**` 回 `Cache-Control: public, max-age=31536000, immutable`（`next/dist/server/lib/router-server.js:380` 硬编码）。而 bundle 文件名里的哈希是**原始构建**生成的——本项目一直**原地手改**这些 bundle 而不改名，于是「名字 ≠ 内容」，`immutable` 就成了谎话。
2. 端口自 2026-09-15 起持久化为 `13713`（`<userData>/.server-port`），origin 稳定 → 缓存键稳定。
3. `%APPDATA%/socratopia/Cache` 里页面包那批响应头写着 `Date: Mon, 21 Sep 2026 09:50:32 GMT`，此后每次启动都不回源。
4. 决定性证据：该 profile 的 V8 code cache（app 真正编译执行过的字节码）含 `__socratopiaSpeakMessage`、`__socratopiaVoiceIdForSlot`（9 月 21 日之前在的改动），**不含 `__socratopiaHintLookup` / `hintSpeechFor`** —— 说明 app 跑的前端是补丁之前的版本。

**修法（已实装）**：`server.js` 末尾拦一层 `http.ServerResponse.prototype.setHeader`，只把 `/_next/static/` 的那个字面量改写成 `public, max-age=0, must-revalidate`。Next 只在「header 尚未设置」时才写它（`router-server.js:378` 的 `!res.getHeader('cache-control')` 守卫），所以从 server.js 拦即可，**不必碰被 hash 钉死的 `node_modules`**，也就不需要重算 release manifest。localhost 上回源就是一次 304，代价可忽略，而手改 bundle 下次加载即生效。

已验证：未改 → `If-None-Match` 得 304；改一个字节 → 200 新内容；再条件请求 → 304。

**一次性清缓存**：已删除 `<userData>/Cache/Cache_Data` 与 `Code Cache`（旧条目已带 `immutable` 语义，不会自行回源）。app 需重启一次。

> 附带结论：**9 月 21 日之后任何对这些 bundle 的手改，在 app 里都可能从未生效过**。缓存修好后，这个陷阱消失。

## 五、顺带修掉的既有缺陷

`_updateProtection` 与新的 math 扫描都是「按 emit 分片扫描」，而分片边界是任意的：

- **`$$` 被切在两个 emit 之间**（`"1$"` 后接 `"$\n"`）时闭合符识别失败 → `mathDelim` 永久卡住 → 其后所有控制标签被当字面文本吞掉。这是本次之前就存在的 bug。
- 修法：保护与 math 两个状态机共用一条 append-only 扫描缓冲与游标，每个字符只扫一次，未 settle 时留 1–2 字符 lookahead；游标只在「后一位是 `<`」或流结束时 settle。
- 保护区内不再一次性 dump 整个 buffer（那会把保护区闭合之后才出现的标签一起吞掉），改为在每个 `<` 处重新判定。
- 回归守卫：`groupchat-emotion-smoke-test.js` 在一次中间版本上确实红过，是它抓出了 flush 位置错误。

## 六、前端补丁清单（5 个 bundle 各 6 处，逐字节一致）

1. `,_voiceSegments=[];` → `,_voiceSegments=[],_voiceHints=[];`
2. helper 块里插入 `__socratopiaHintLookup`（该块在每个 bundle 内**重复 3 份**，3 份都要插）
3. `else if("reasoning_content"…)` 前插入 `speech_hint` 分支：入 `_voiceHints` 并发布 `globalThis.__SocratopiaLiveSpeechHints__`
4. `eY` 签名加第 5 个参数 `__socratopiaSpeechOffset`
5. `eY` 调 adapter 处补 `hints:__socratopiaHintLookup(__socratopiaSpeechOffset,a.trackId)`
6. 两个句段释放点（流式 + 收尾 flush）各自多传一次 `__socratopiaFragmentOffset(...)`

adapter 副本同步（改完 `math-speech-adapter.js` 后跑，保持 4137 前缀逐字节相同）：

```js
const fs=require("fs"),d="resources/server/.next/static/chunks/";
const a=fs.readFileSync(d+"math-speech-adapter.js","utf8");
const p=d+"4137-131d0676e3b5bef7.js",c=fs.readFileSync(p,"utf8");
const m="root.SocratopiaMathSpeechAdapter=adapter;\n})();",end=c.indexOf(m)+m.length;
fs.writeFileSync(p,a+c.slice(end+1),"utf8");
```

一致性由 `voice-runtime-invariants` / `voice-emotion-client` / `voice-early-stream` / `say-hint-adapter` 四个 smoke 守住（前两个用 `eY` 签名字面量当区域起点，改签名要同步改字面量）。

## 七、验证结果

```
say-speech-protocol-smoke-test.js                                22/22 PASS
voice-emotion-protocol-smoke-test.js                             22/22 PASS
groupchat-emotion-smoke-test.js                                  19/19 PASS
chat-say-protocol-integration-smoke-test.js                      10/10 PASS   (手动，矩阵跳过 .next/)
chat-voice-emotion-protocol-integration-smoke-test.js             8/8  PASS   (手动)
say-hint-adapter-smoke-test.js / chunks 下 13 个前端 smoke         PASS
node tools/run-smoke-matrix.js                                   132 项，0 失败，2 项按设计跳过
```

另外用真模型（`gpt-5.6-terra`，走 settings.json 的 endpoint）实测提示词合规率：66 个公式里标了 10 条，**0 泄漏、0 畸形**，标的正是 `P(A|B)`、`A∩B`、`A∪B`、`|A|`、`f'(x)` 这些该标的。提示词块 323 字符（约 150–200 token/轮）。

已知无关漂移：`pdf-ocr-priority-smoke-test.js` 会间歇性红（单独连跑 5 次挂 2 次），断言的是 OCR 队列顺序，与本次无交集。

## 八、还没做的

- **重启 app 实测**：走一节含条件概率的数学课，确认 hint 真的被用上、听感确实变好。缓存修好后的这一次才算数。
- 若实测仍无价值，再决定是否回退；回退面就是第二节那张表。
- 提示词块目前每轮无条件注入（约 150–200 token）。若嫌贵，可后续按「当轮是否含数学」收紧。
- 历史消息回放无 hint（流 ephemeral），走确定性管线；持久化到消息元数据留给 v2。

---

## 九、2026-09-25 课后审计

缓存修好后的第一节课（`64KCdn4ZqCUX29tk2G4Hq`，16:00–18:37，74 条消息 / 37 条助手回复；上一节 `08-LAhcx2TqyRZC3rFx-6` 26 条助手回复）已完成。审计结论分三类。

### 9.1 已确证

- **零泄漏**：两节课 63 条助手回复、共 73 处 `$` 公式，归档文本里 **没有任何 `<say>` / `</say>` / `<voice>`**。说明服务端剥离干净，且模型（若有标注）没有写在会被当成字面量的位置。
- **前端确实换上了新代码**：我第一次清缓存的时间（15:5x）早于本次启动（16:06），缓存目录是那时新建的，服务端当时已在发补丁后的字节 —— 即缓存不再是空转变量。
- **管线活着**：`[math-speech] n=1 [...]` 说明前端适配器与 `/api/math-speech` 链路正常，归档里 36/37 条消息带 `speechSegments`（`voiceId: keqing`），说明服务端 tracker 与情绪通道也在跑。
- **模型遵守协议**（对当前线上模型 `DeepSeek-V4.1-Flash` 实测 2 次调用）：加块 → 12 条合法标注 / 0 泄漏 / 0 畸形；不加块 → 0 条。标注正是 `P(A|B)`、`P(B|A)`、`A∪B`、`A∩B` 这类。
- **成本**：块 243 字符 = **+163 prompt token**（供应商 usage 实测），对 21.5k token 的中位课堂 prompt 仅 **+0.76%**；有 prompt cache 命中时更低。输出侧标注本身约 +200–300 token。

### 9.2 本次无法确证（并已补齐）

这节课跑在我加日志**之前**（注入日志 19:27 才落盘），所以 `[say] hint` 全库为零条 —— 既可能是模型没标注，也可能只是没记录。为此补了三行日志（都进了集成 smoke 的断言）：

```
[say] prompt injected lang=<lang>      // 每轮：块到底发出去了没有
[say] hint anchorEnd=<n> speech="…"    // 每条命中
[say] turn hints=<n> deltas=<n>        // 每轮收尾：0 是"没标注"还是"没运行"
[say] notice <code> <detail>           // 违规/丢弃可审计
[math-speech] n=<n> ["latex",…]        // 客户端有没有跳过请求 = 命中是否真的生效
```

判据：某轮里模型标注了公式 F（`[say] hint`），而该轮的 `[math-speech]` 请求里**没有** F 的 latex → 客户端确实用了 hint。

### 9.3 本次修掉的缺陷

| # | 缺陷 | 修法 |
|---|---|---|
| D1 | 命中的朗读文本绕过了 `cleanMarkdownText`，模型若写 `<say>**条件概率**</say>`，星号会被念出来（`validateSaySpeech` 也放行 `*`） | adapter 拼装时对 hint 文本同样 `cleanMarkdownText`；两副本同步；`say-hint-adapter-smoke-test` 加用例 |
| D2 | 功能两端都不可观测（renderer console 不进 app 日志，服务端也不记 hint） | 上表五行日志 + 集成 smoke 断言 |

### 9.4 本次发现、未修

| # | 现象 | 证据 |
|---|---|---|
| D3 | **音频缓存没在写**：`tts-cache` 29 个 wav 最新是 9/8，本节 37 条消息全部没有 `audioCachedAt` | 提交链在 renderer 里（`[audio-cache] commit failed` 只打到看不见的 console），建议先把 renderer console 接进 app 日志 |
| D4 | 上下文预算超限：今天 15 条 `[ctx-budget] over budget`，`sysPLen` 高到 5.8 万字符 | 属"课堂上下文治理"线，与 say 无关 |
| D5 | 课后笔记降级：`[post-class-notes] stage=degraded event=job_degraded score=0.8575–0.909`，其中一条正好在本节课结束时刻 | 与 say 无关 |
| D6 | 回放无 hint（流 ephemeral）：同一条消息，直播与回放听起来不一样 | 设计已知限制，若要一致需把 hint 落成消息元数据 |
| D7 | 模型给错读法时会被无条件采信（不做交叉校验） | 设计取舍；坏读法只会换一种错法，不会污染显示 |

### 9.5 复现审计的方法

合规率实测（2 次调用，不必上课）：拿 `buildSayPromptBlock` 拼系统提示，同一问题问两次（带块 / 不带块），用 `SaySpeechParser` 解析回复，比对 hints / leaks / `malformed_say` / prompt token 差。

---

## 十、2026-09-26 行为变更：stray `<say>` 从「原样显示」改为「整个吞掉」

### 10.1 起因

线上连续出现回复末尾挂 `<say>从内向外沿链查找</say>`、`<say>抽象语法树</say>` 这类标注——**标注的是普通文字，不是公式**，且位于句末标点之后，没有合法锚点。按原设计（§三「防注入」取舍）stray say 保持字面量显示，于是控制标记直接漏给用户。

先在提示词侧加了三条硬约束（`SAY_PROMPT_LINES` 三语言同改：锚点必须紧邻 `$`/`\)` 闭合的公式、禁止标注普通文字、位置不符会原样显示请自查），**实测无效，模型照犯**——证明这不是提示词能压住的行为，必须改解析器。

### 10.2 改动（`resources/server/lib/voice-emotion-protocol.js`）

| 情形 | 旧行为 | 新行为 |
|---|---|---|
| 无锚点的 `<say>…</say>`（完整、合法形态） | 原样显示，记 `stray_say` | **标签+内容一起吞掉**，记 `stray_say`，不发 hint |
| 孤立的 `</say>`（没开就闭） | 原样显示 | 吞掉，记 `stray_say_close` |
| 流末未闭合的 stray `<say>` | 原样显示 | 走 `unclosed_say` 路径，内容丢弃 |
| 带属性的 `<say emotion=…>` | 整体字面量 | 开标签与内容仍字面量；其后的 `</say>` 按孤立闭合吞掉 |
| 代码围栏 / 行内代码内的 `<say>` | 字面量 | 不变（保护区规则不动） |

实现：`_tryControl` 新增无锚点分支（`pendingMathEnd === null` 时仍识别 `<say>` 开标签，返回 `straySayOpen`）与孤立闭合分支；`push` 循环复用 say 吞噬机（`sayOpen` + 新增 `straySay` 标志），闭合时 `straySay` 为真则丢弃内容、只记 notice；`_sayOverflow` 与 `end()` 同步重置 `straySay`。防注入性质不变——stray 内容**从不进入显示文本**，比原来更严格。

### 10.3 同步改动

- `resources/rules/rules_zh_classroom_compact.md` §7 加一条：数学变量/符号/上下标一律 `$...$`，禁止反引号包裹；反引号只用于真代码/命令/路径。起因是同一批截图里 `x`、`x₁` 被模型包成行内代码黑块（本该是 KaTeX）。排查确认：rules、lib、chat 路由里**没有**任何鼓励反引号的老 prompt，黑色渲染只是标准 inline-code 样式，不是遗漏链路。
- 顺带核查全链路落地状态：`__SAY_SPEECH__` 注入表 → tracker（`sayProtocol:!0`）→ `speech_hint` SSE → 线上 page chunk（`page-87daa6ca210ab9dc.js`）的 `__socratopiaHintLookup` → `SocratopiaMathSpeechAdapter`（4137 chunk 注册），链路完整无断点。`chunks/app/` 下 3 个旧 page bundle（`page-3a1fef…`、`page-practice-ui-20260622/0625/0626`）已不被当前构建引用，属无害残留。

### 10.4 测试（先红后绿）

- `say-speech-protocol-smoke-test.js`：新增 5 用例（无公式锚定、标点后、任意分块边界逐字节一致、流末未闭合、孤立闭合标签），更新带属性用例 → **25/25 PASS**
- `chat-say-protocol-integration-smoke-test.js`：旧断言「stray 保持字面量」翻转为「stray 被剥离」→ **12/12 PASS**
- 回归：voice-emotion 22/22、groupchat-emotion 19/19、math-speech 路由 PASS

### 10.5 根因分析与后续候选

模型屡犯的原因倾向**注意力稀释**：say 块追加在万字 system prompt 末尾，与生成点之间隔着整段对话历史；且块在 system 末尾的位置可能诱发位置模仿——模型把 `<say>` 当成「回复末尾的固定仪式」（两次泄漏都挂在回复最后，符合该模式）。候选改法，按性价比排序：

1. **提醒后置（已实装）**：say 块仍留在 system prompt（吃 prompt cache），另在裁剪后的消息数组末尾（最后一条 user 之后）压一条短 system 提醒 `buildSayTrailingReminder`，用 `f=[...f,…]` 重赋值避免改写 `f===c` 的别名、不进持久化历史。zh 75 字符（≈40 token/轮），en 235 字符；三语言齐全，单测锁了长度上限（zh/zh-TW ≤120、en ≤240 字符）。路由日志新增 `[say] trailing reminder injected lang=<lang>`。
2. **条件注入（未做）**：当轮教材/历史不含 `$...$` 公式时不注入 say 块——没靶子就不递枪，块本身的存在就是诱饵。
3. **负例 few-shot（已实装）**：`SAY_PROMPT_LINES` 三语言各加一行「对照——正确 / 错误」，错误示例就是线上真实泄漏的「沿链查找。<say>从内向外沿链查找</say>」；同时把「位置不符会原样显示」改为「会被系统直接删除」，与 §10.2 的新行为一致。zh 块 `<say>` 字面量从 1 处变 3 处，单测计数同步更新。
4. 解析器兜底已上线（§10.2），问题已从「用户可见」降级为「日志可观测」，可用 `[say] notice stray_say` 频率验证 1–3 的效果。

验证（2026-09-26）：say 单测 26/26、chat say 集成 13/13（新增「尾部提醒是发给模型的最后一条消息、紧贴最后一条 user」断言）、voice 集成 8/8、voice-emotion 22/22、teaching-progress 格式、end-class 集成全部 PASS。
