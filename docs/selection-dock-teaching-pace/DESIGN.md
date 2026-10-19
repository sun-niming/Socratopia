# 选段朗读 / 原文弹窗 / 教学节奏 — 设计方案（待拍板）

> 状态：只为阅览的方案稿，未动代码。
> 参考：用户提供的两张截图（选中浮条、原文弹窗、教学节奏三选项）是**目标形态**，本仓库当前构建里这些 UI 全都不存在，所以方案写的是"加在哪"，不是"改哪里"。

---

## 0. 现状核查（先说清楚地基）

| 目标能力 | 本仓库现状 |
|---|---|
| 选段浮条 dock | **不存在**。全仓搜 `getSelection` / `朗读所选` / `问伙伴`，除 React 内部外零命中。消息正文也没开 `user-select` 控制，默认可选中。 |
| 朗读引擎 | **已完整具备且可复用**。`lib/math-speech/` + 客户端 chunk `4137-…js` 提供 `prepareForSpeech`（剥 markdown/公式）、`chunkText`、`speak(text, voiceKey, trackId, speed, emotion)`、`voicePlayer`（可取消、可中断、跨 chunk 使用 3s hold）。 |
| 音色 | `public/voice-catalog.json` + `lib/voice-catalog*`；当前会话音色由页面在 `el.DEFAULT_VOICE_KEY,eW=eL?.candidateId?tb({...}):el.DEFAULT_VOICE_KEY` 处解析。 |
| 计费 | 文案里的"按当前音色计费"目前**没有真实数字**：`estimateCost` 返回 `{tokens:0,cost:0,estimatedTokens:0}`，`TTS_TOKEN_RATIO` 也是 `0`。 |
| 原文弹窗 | **不存在**。但素材齐：`GET /api/textbook?page-image=1&page=N&maxWidth=…&textbookId=…&profileId=…&worldId=…` 能把某页 PDF 渲成 PNG；`lib/close-reading/excerpt-reader-coordinator.js` 能拿到逐页真实文字（服务端）；`public/asset-capture.js` 的 `openFigureDialog()` 是现成的遮罩+面板配方。 |
| 页码引用 | 截图里 `☰ p.6` 这种行内页码 chip **当前构建不渲染**（搜 `☰`/`page-cite`/`citation` 全零），只有纯文本。 |
| 教学节奏 | **不存在**。设置只在 `localStorage.socralab_settings_<profileId>`，没有任何节奏字段；速率参数硬编码在 `chat/route.js` 里。 |
| 注入通道 | **有两条现成先例**：`index.html` 里 `<script src="/asset-capture.js?v=…" defer>`，或页面 bundle 开头那段自注入 IIFE（`public/close-reading-skill-menu.js` 走的就是它）。 |

结论：**加得住**，因为注入通道、语音引擎、页面渲染、遮罩组件四块都已有可抄的先例；但要动的地方分散在 `public/`、`index.html`、5 个页面 bundle、`rules/*`、`chat/route.js`、i18n 三语，属于"跨面较小改动"而不是一处补丁。

---

## 1. 功能一：选中即朗读

### 交互

1. `mouseup` / `selectionchange`（250ms 去抖）取 `window.getSelection()`。
2. 判废：折叠、`< 2` 字、落在 `[data-testid="chat-input-textarea"]` 内、落在弹窗自身内、落在侧栏。
3. `range.getBoundingClientRect()` → 浮条贴选区下方 8px；左右夹到视口内；空间不足翻到上方。
4. 点「朗读」→ 剥公式 → `prepareForSpeech` → `speak(text, voiceKey, "sel-" + Date.now(), speed)`。再点一次或按 `Esc` 调 `voicePlayer.stop()`。
5. 滚动、点击空白、选区消失 → 收起。

浮条本身：`position:fixed; z-index:2147483300`（与 `asset-capture.js` 同层，避开 `close-reading-skill-menu.js` 的输入框菜单区）、`role="toolbar"`、`pointerdown` 时 `preventDefault()` 保住选区。

### 关键细节

- **公式**：选区常含 KaTeX DOM，`selection.toString()` 会把公式拍成乱码。取值时先在 range 内找 `annotation[encoding="application/x-tex"]`，命中就替换成 `$tex$`，再交 `prepareForSpeech`。这条不做，含公式的段落朗读基本不能用。
- **音色**：dock 拿不到组件闭包里的 `eU`，所以要发布一个指针（见 §4 改动清单第 3 条），dock 读 `window.__SOCRATOPIA_SPEECH_VOICE__`，回落 `el.DEFAULT_VOICE_KEY`。
- **计费文案**：要么修 `TTS_TOKEN_RATIO` 让 `estimateCost` 出真数，要么把 tooltip 改成「朗读所选文字」不带计费承诺。建议本期先按截图保留文案、同时把 `estimateCost` 接上真实比例（改动很小，一处常量 + 一处函数）。

### 验收

选中中文段落正常出声；选中含 `$…$` 的公式段能读出"的平方/平方根"；播放中点别处会停；`Esc` 能停；选区在输入框里不弹条。

---

## 2. 功能二：指定原文弹窗

### 形态（照截图）

浮条上的「原文」按钮 → 遮罩 + 居中面板：标题取教材名 + 「第 N 页」，正文是**该页的页面图**（`/api/textbook?page-image=1&page=N&maxWidth=960&…`）+ 上方引用块显示选中文字，底部 `‹ 2/3 ›` 翻页、`×` 关闭。

复用 `openFigureDialog()` 的结构：`position:fixed; inset:0` 遮罩（点击遮罩关闭）、`--surface-raised` 面板、`--border` 描边、`data-socratopia-*` 测试钩子，关闭还原焦点。

### 页面从哪来（本方案唯一的硬缺口）

当前构建**不渲染行内页码 chip**，所以"这段出自第 6 页"这个信息拿不到精确值。三档处理，按推荐排序：

1. **本期方案**：以 `/api/reading-context` 的 `readingRange`（含 `taughtPage`）作为起点页码，弹窗内可前后翻页并显示 `x/总数`。用户自己确认页。`readingRange` 通过 `window.__SOCRATOPIA_ASSET_SCOPE__` 已解析好的 profile/world/textbook 直接取。
2. **加一步提示词**：`chat/route.js` 的窗口块里已带页内页码标记，让模型在引用处输出 `☰ p.N`，同时前端加一个把 `☰ p.N` 渲染成 chip 的 markdown 行内规则。有了 chip，弹窗就能精确锚定页码，也顺带补上截图里那个 chip 的缺失。中成本。
3. **精确到框**：需要选区坐标回写到 PDF 空间（`book://… #x0,y0,x1,y1` 那套已有），成本最高。

### 「翻译」

截图有 「翻译」，但本仓库**没有翻译路由**（只有客户端 CSS 类 `-translate-x-1/2`）。两条路：把选中文字连同"翻成中文/英文，只出译文"塞给 `/api/chat`（零后端改动，但吃对话配额、也污染会话）；或新增 `/api/translate`（要同步 3 份 route manifest）。建议本期走前者配独立 `conversationId` 复用，或直接放到下一期。

---

## 3. 功能三：教学节奏（三档）

### 设置项

`settings` 弹窗的 `advanced` 页已有「外观 / 更新检查 / 回车发送」等控件，加一段「教学节奏」三选一：`慢工细活` / `正常进度`（默认）/ `主线速通`，存 `localStorage.socralab_settings_<profileId>` 的 `teachingPace`。纯客户端持久化，不新增接口 —— 与 `uiFontScale`、`sendShortcut` 完全同构。

### 生效链路（关键在服务端那三个数）

节奏不是一句提示词，它必须改**硬阈值**。`chat/route.js` 现在写死：

- `advanceThreshold = isMarkdownLike ? 10 : 12`
- `windowEndAdvance = … turnsSinceAdvance >= 6`
- `intentAdvance = … turnsSinceAdvance >= 1 && userPageAdvanceIntent`

方案：`lib/adaptive/policy-engine.js`（已是纯函数、带 `RULES_VERSION`）新增 `paceProfile(pace)` 返回 `{advanceThreshold, windowEndTurns, intentAdvanceMinTurns, maxRetriesPerPoint, extraHintText}`，`route.js` 改成读这个 profile；请求体加一个字段 `teachingPace`（照 `emotionMode` 的现有写法：客户端 `page-*.js` 的请求体对象加一行、`route.js` 的解构加一行并做白名单校验，非法值回落 `normal`）。

三档参数（可调）：

| | 慢工细活 | 正常进度 | 主线速通 |
|---|---|---|---|
| `advanceThreshold` | 16 | 10 / 12 | 6 |
| `windowEndTurns` | 10 | 6 | 3 |
| `intentAdvanceMinTurns` | 3 | 1 | 1 |
| 同一知识点纠错上限 | 2 | 1 | 1 |
| 提示词加行 | "宁可少走一页也要讲透" | — | "只讲主线，例子从简" |

节奏文字的家在 `resources/rules/rules_zh_classroom_compact.md` §4（§4 已存在，是「教学节奏」的正确落点），`rules_en_classroom_compact.md` 是指针、`rules_zh.md` 另有 §4 段落，同样补一句就行。**不要**把策略写进 §9 不可破坏项。

### 注意

- 换档要**下一轮生效**，不能改写已注入的窗口；已经在讲的内容不回退。
- `慢工细活` 与已有 `adaptive` 的 `action=advance` 会打架：`taeWantsAdvance` 只在非 markdown 分支生效，markdown 教材下以阈值为主，正好避开。
- 存档不兼容：旧 settings 对象没有 `teachingPace`，读取处必须给默认值 `normal`。

---

## 4. 改动清单

| # | 文件 | 动作 | 备注 |
|---|---|---|---|
| 1 | `resources/server/public/selection-dock.js` | 新建 ~450 行 IIFE | 唯一大件；含选区、浮条、弹窗、朗读调用；`window.__SOCRATOPIA_SELECTION_DOCK__` 防重入 |
| 2 | `resources/server/.next/server/app/index.html` | 加 `<script src="/selection-dock.js?v=20261014-1" defer>` | 紧随 `asset-capture.js` 之后 |
| 3 | 5 个 `static/chunks/app/page-*.js` | 在 `…es=r(8817),el=r(4137);` 处追加发布：`window.__SOCRATOPIA_VOICE__=el;` 与 `globalThis.__SOCRATOPIA_SPEECH_VOICE__=eU;` | 都在三处被哈希的 region 之外，`voice-runtime-invariants-smoke-test.js` 仍应全绿；五个 bundle 必须同改 |
| 4 | `resources/server/lib/selection-dock-smoke-test.js` | 新建 | 照 `lib/close-reading/ui-smoke-test.js` 的写法：断言 `public/` 里的标记串、断言 5 个 bundle 都注入了脚本、断言没有 `new Audio(` |
| 5 | `resources/server/.next/server/app/api/chat/route.js` | 解构 `teachingPace` + 白名单 + 读 `paceProfile()` 替换三个硬编码 | `node --check` + 跑 `chat-end-class-integration-smoke-test.js` |
| 6 | `resources/server/lib/adaptive/policy-engine.js` | 加 `paceProfile()` | 纯函数，配 smoke test 分支 |
| 7 | `resources/rules/rules_zh_classroom_compact.md` §4、`rules_en_classroom_compact.md`、`rules_zh.md` | 各加节奏语 | `rules/*` 除 compact 外不入库 |
| 8 | i18n `6067` / `3055`(zh-TW) / `1476`(en) | `settings.teachingPace*`、`selection.*` 新 key | 三语齐全，缺一个就漏字 |

不改：`lib/math-speech/`、`lib/close-reading/`、3 份 route manifest（不新增路由）、`app.asar`（不碰 Electron 层）。

---

## 5. 风险

| 风险 | 处置 |
|---|---|
| `close-reading-skill-menu.js` 也挂浮层，可能互相抢 | 两者锚点不同（它在输入框下方，我们贴选区）；z-index 差一层，互相 `pointerdown` 隔离 |
| 5 个 bundle 手改漂移 | 以锚点串一次性替换，改完必跑 `voice-runtime-invariants-smoke-test.js` |
| 选中 KaTeX 乱码 | §1 的 annotation 取值，必做 |
| 弹窗页码不准 | §2 的档 1，弹窗内明示"当前页可翻"，不假装精确 |
| 计费忽真忽假 | 要么接真比例，要么改文案，二选一，别留空承诺 |
| `teachingPace` 被判非法 | 服务端白名单 + 默认 `normal`，前端也校验 |

---

## 6. 工作量

- 功能一 + 功能二（共用浮条与弹窗骨架）：大半天，主要在第 1 项那个文件。
- 功能三：两三个小时的分散改动（route 一行、policy 一函数、三份 rules、三语 i18n、设置 UI 一段）。
- 验证：两个 smoke test + `node --check` 全部改动文件 + 手点一遍三档节奏。

## 7. 需要你拍板

1. 弹窗页码走 §2 档 1（当页可翻、不保证精确）还是顺带做档 2（让模型吐 `☰ p.N` 并渲染 chip）？档 2 更接近截图，但要多碰提示词和 markdown 渲染。
2. 「翻译」本期做不做？
3. 计费：接真实比例，还是先把 tooltip 改成不带计费的措辞？
4. 浮条首批按钮：只上「朗读 / 原文」，还是把「解释 / 问伙伴」（等于把选区塞进输入框）一起上？笔记、预约、高亮配色可以下一期。
