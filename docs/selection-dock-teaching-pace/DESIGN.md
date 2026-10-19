# 选段朗读 / 原文弹窗 / 教学节奏 — 设计方案

> 状态：**已实施**（用户 m00883 拍板后动工，m01965 追加要求「解释 / 问伙伴 / 原文改独立窗口，问伙伴可指定角色」也已实施）。§0–§7 保留拍板时的原貌以便对照，**实际落地与本文有出入的地方见 §8**（尤其：弹窗不是居中 modal 而是右侧抽屉、解释/问伙伴不再塞进输入框）。
> 参考：用户提供的两张截图（选中浮条、原文弹窗、教学节奏三选项）是**目标形态**，本仓库当时这些 UI 全都不存在，所以方案写的是"加在哪"，不是"改哪里"。

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

---

## 8. 实施记录（as-built）

拍板结论（m00883）：页码走 **档 2**（模型吐 `☰ p.N` → 前端渲染成 chip），翻译**不做**，计费**不做**（tooltip 仍留「按当前音色计费」字样），浮条首批**四个按钮一起上**；笔记、预约、高亮配色延后。之后 m01965 追加：解释 / 问伙伴 / 原文都要**独立窗口**，且问伙伴必须能**指定伙伴角色**。

### 与原方案的偏离

| 原方案 | 实际 |
|---|---|
| 「解释 / 问伙伴」= 把选区塞进聊天输入框 | 改成**右侧独立面板**，各自问答，不再污染主线会话 |
| 原文是居中 modal | 同样改成**独立面板**，与解释/问伙伴同一套骨架 |
| 面板 / 原文是固定宽抽屉 | 再改为**可拖分栏 + 页签**（见「容器化布局」），宽度可调且落盘 |
| 弹窗页码靠人翻、明示不精确 | 模型引用处输出 `[☰ p.N](socratopia:page#N)`，前端渲成可点 chip，点 chip 直接开该页 |
| `policy-engine.js` 加 `paceProfile()` | 独立模块 `lib/adaptive/teaching-pace.js`（纯函数，`resolve/thresholdFor/guidanceFor`），不动 policy-engine 的 `RULES_VERSION` 语义 |
| `localStorage.socralab_settings_<profileId>` 存 `teachingPace` | 既写该 settings 对象，也写独立键 `socratopia_teaching_pace`；读取端以 settings 对象优先、独立键兜底 |

### 独立面板要点

- 面板挂 `data-socratopia-selection-panel`，组件：`-panel-close` 关闭、`-panel-quote` 引文、`-panel-companions` 伙伴选择器（`-panel-companion=<slotId>`）、`-panel-chosen` 已选角色名、`-panel-input` 输入框、`-panel-answer` 答案区、`-panel-speak` / `-panel-insert`。
- 多轮问答**不走主会话**：`POST /api/chat` 不带 `conversationId`，body 只有 `messages / character / teachingLanguage / profileId / worldId / accessMode:"hosted" / sessionToken:"local-session" / clientTotalTokens`（companion 模式再加 `companionInstanceId`、`candidateId`）。因此不触发 auto-advance、不写 chats 文件。
- 伙伴名单来自 `GET /api/world?profileId=` 的 `companions` 四槽，头像 `/api/companion/avatar?profileId&worldId&slotId`；音色走 `socralab_settings_<accountId>.companionVoices[<candidateId>]`，回落 `voice.defaultVoiceFor(gender,"zh")`。
- 答案区渲染复用运行时 webpack 的 unified + remark-math + rehype-katex 管线（`webpackRequire()` 偷 `window.webpackChunk_N_E.push`），失败回落纯文本；`socratopia:page#` 链接统一渲成 `.socratopia-page-chip`。
- 「插到聊天框」在 composer 不在 DOM 时退化为写剪贴板并 toast，不再静默失败。

### 容器化布局（m03774 / m03928，最终形态）

先是改成可拖动浮窗，但两张窗一起开就互相压；用户随后指明要 leetcode 那种布局，于是最终做成**编辑器式左右分栏 + 页签**：

- `ensureSplit()` 把 body 里第一个宽 >200px 的 DIV（实测是 `div.h-screen.flex.overflow-hidden` 主列）包进 `[data-socratopia-split]`，中间插 `[data-socratopia-split-divider]`（`flex:0 0 6px;cursor:col-resize`），右侧是 `[data-socratopia-split-pane]`。
- 主列让出空间（`flex:1 1 auto;minWidth:0`），关掉最后一个页签由 `teardownSplit()` 把主列放回 body 并清空 inline style。
- 宽度存 `localStorage["socratopia.split.width"]`，默认 `min(560, 44vw)`，夹在 300 与 `innerWidth-380` 之间；拖动即改、`resize` 重夹。
- 解释 / 问伙伴 / 原文都是 pane 里的页签：`mountPane(node, head, label, onClose)` 返回释放函数，关页签先激活剩下的最后一个。两者可并存，不再互相顶掉。
- 页签取代了各窗自己的标题行（`head.style.display="none"`），改名走 `node.__socratopiaTabLabel(text)`——问伙伴选角色后页签变「问伙伴 · 风堇」，原文翻页后变「原文 · 第 N 页」。
- `Escape` 只关当前显示的那个页签（判 `panel.style.display !== "none"`），不连带关掉另一个。
- 实测：两页签共存且仅显示一个、点页签可切回、页签 × 逐个关、关完 `splitWrap` 消失且主列回到 body 直属；拖动 `522 → 682` 并落盘；切换会话后分栏与页签都保持。
- 页面自带的两个 `position:fixed;right:20px` 按钮（`asset-capture.js` 的截屏 / 引图）会被分栏压住，`offsetFloaters()` 在开栏、拖动、`resize` 时把它们左移 `宽度+20`，`teardownSplit()` 还原成 20px；引图按钮是换世界才挂上的，用 `MutationObserver` 补一次。

### 已实测（CDP 驱动真实 app）

选中 → 浮条四按钮；解释流式出答案并带公式排版；问伙伴切换角色后口吻随之改变；原文抽屉到指定页、页图 `naturalWidth=960`、可翻页；朗读 `voicePlayer` 状态 `loading→playing`、可停；插入让 composer 从 0 字到 1558 字；教学节奏三档切换写盘，`/api/chat` body 中 `"teachingPace":"brisk"`，模型明显加速。

### 页码 chip 的兜底

实测两轮，模型**基本不照 prompt 里的 markdown 链接写法来**——它要么写纯文本 `[p.182]`，要么干脆不写出处。只靠提示词不可靠，所以前端加了 `linkifyPages()`：渲染前把裸 `[p.N]` / `☰ p.N` / `见 p.12` 一律补成 `[☰ p.N](socratopia:page#N)`，已经是合法链接的先摘出去再回填，避免套两层。提示词里的约定保留（模型写对时更好），前端兜底保证 chip 至少能出现。`lib/selection-dock-smoke-test.js` 对这个函数做了正反四个用例的断言。

### 渲染兜底（实测暴露的三处）

1. **裸页码**（见上）→ `linkifyPages()`。
2. **公式被页码吃掉**：模型把 chip 紧贴在公式收尾后面（`$c/d/\$$[p.186]`）。先补链接会把 `$` 当链接文本的一部分，公式断掉。改为**先把公式整段抽走**（`SOCRBTPH<n>X` 占位），补完 chip 再回填。
3. **反义美元符**：`$\$$`（数学里表示终结符 `$`）会被当成两个定界符。`\$` 先用 `\u0001` 哨兵替掉，抽完公式再还原成 `\$` 交给 KaTeX。
4. **整行尖括号**：模型常把结尾追问包成 `<…？>`，markdown 当 HTML 标签原样转义、直接看不见。整行被尖括号包住的转成 `>` 引用块；真 HTML 标签（`div/span/p/img/a/table/…`）白名单跳过。

四条都补进了 `selection-dock-smoke-test.js`（含 `\$` 顺序、尖括号转换、HTML 白名单、页码区间取首页），并用 `window.__SOCRATOPIA_SELECTION_DOCK_RENDER__` 在实机单测：`<…？>` 行变成 `<blockquote>` 且里面 chip 正常，`<div>` 原样保留。

### 引文同步渲染（补）

引文块原先用 `textContent` 贴原文，气泡里的公式进了抽屉就变成 `$R\to L$` 源码。实测曝光后改成 `renderMarkdown(selection.text, quote)`；原文抽屉的引文同样处理并加 `data-socratopia-source-quote` 钩子。实测引文里 14 处公式正常排版、`.katex-error` 0。

### 教学语言（补）

面板请求原先硬编码 `teachingLanguage: "chinese"`，英文世界会被中文回。改为从 `GET /api/world` 取该世界的 `language`（`english` / `chinese-traditional` / `chinese`），取不到才退回界面语言；`loadWorldLanguage()` 缓存一次，`ask()` 里先 await 再发请求。

### 命名冲突（补）

`ask()` 内部把发送函数叫 `send`，遮住了同名的发送按钮变量 `send`，导致 `send.disabled = true` 抛 `TypeError: Cannot set properties of undefined (setting 'opacity')`，整页顶层报 unhandled rejection。改名 `post()` 后消除。

### 输入框预览（补）

「插入」把原文与答案原样写进 textarea，可 textarea 只认纯文本，`$I_6$`、表格、```svg 到那儿全退成源码，跟气泡里的样子对不上（用户 m04432 指出）。给输入框垫一层只读预览 `[data-socratopia-composer-preview]`，走**同一个** `renderMarkdown`（同样的 katex / svg / 页码 chip），插在 textarea 上一行（`field.parentElement.parentElement`）的 composer 列里，`input` 事件 140 ms 防抖刷新。纯散文不显示（`PREVIEW_MARKUP` 只认 `$` / 围栏 / 列表 / 链接 / 标签）。用 `display` 切换而非常驻空盒子。

同批修的定界符误判：教材正文拿裸 `$` 当符号（`$ 是有道理的`、`只能是 $。`），两个裸 `$` 会被配成 `$$…$$` 把中间整段吞成行间公式。改为**开定界符后不跟空白、收定界符前不带空白**才认作公式（`/\$(?![\s$])([^$\n]+?)(?<![\s$])\$/g`，块级同理），实测 `可以是 $。` / `$ 是有道理的。` 均 0 个 katex、`$I_6$ 沿 $d$ 走` 正常 2 个。末尾 `$` 落单时的 `[^$\n]+?` 仍可能把邻近正文配进去，属可接受的启发式。

### 校验

`selection-dock-smoke-test.js`（含预览一节 5 条新断言）、`voice-runtime-invariants-smoke-test.js`、`teaching-pace-smoke-test.js`、`lib/close-reading/ui-smoke-test.js`、`assets/assets-prefetch-smoke-test.js`（10 PASS）、`pdf-page-render-smoke-test.js`（14 PASS）全 PASS；`tools/run-smoke-matrix.js` 148 条 = FAIL 1（仅 `tts-classic-stream-zero-audio-live-smoke-test.js` 因 app 占端口 `fetch failed`，环境性的）/ SKIP 2（`pdf-cmap-real`、`pdf-render-real.mjs` 缺 fixture，退出码 2 被矩阵归一化为 PASS）；改动文件 `node --check` 全部通过。

最终一轮实机回归：`.katex-error` 0 个、公式正常排版、chip 5 个全部可点并打开对应页、无转义泄漏的尖括号行；问伙伴切到非默认角色（阿格莱雅 → 遐蝶）后回复口吻随之变化；原文抽屉 `192 / 648`、页图 `naturalWidth=960`、可翻页、Escape 关闭；面板朗读 `loading→playing`、按钮切「停止」、停止后回 `idle`；插入让 composer 从 0 字增长并 toast。

本轮回归（插入渲染同步）：插入后预览 `display:block` + 10 个 `.katex`；纯散文 `display:none`；清空输入框预览节点移除；表格 `tables:1` + 96 px 高；```svg 围栏出 `img.socratopia-svg-figure`（`naturalWidth=300`，无 `<pre>` 退化）；裸 `$` 两例 0 katex、`$I_6$ 沿 $d$ 走` 2 katex；发送后输入框清空、气泡正常增长。
