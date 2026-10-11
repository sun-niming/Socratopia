# 图像资产层（教材插图 / SVG 工作图 / 截图 / 索引）开发方案

## 1. 文档目的

本方案为 Socratopia 增加「课堂与笔记中的插图能力」。这里的「图片」有明确所指：

- **教材插图**：教科书中带图号的工作图（时序图、几何图形、函数图像、流程图等，典型样例：「图 12-10 双向异步消息通信模式」）。讲到哪一页，对应插图能在课堂中被亮出，笔记中点一下即可回看；
- **SVG 工作图**：LLM 现场生成的示意图——几何、函数、流程、时序类图用 SVG 代码精确表达，零调用成本、可编辑、天然是文本可索引；
- **截图**：对**整个屏幕**的冻结帧框选——PDF 阅读器、浏览器、任何窗口里的图都能截（应用自身先隐藏再抓帧）。不是应用窗口内截图；
- **raster 生图**（次要）：仅当 SVG 无法表达时（写实插画等）才走生图 API。

「索引」是**超链接语义**：图片在消息和笔记中是一个锚点，渲染为缩略图、点击放大查看——类似 HTML 的 `<a>`，而不是一个重型搜索系统。全文搜索是附加能力，优先级最低。

实施者：DeepSeek。本文档是约束性方案，改动范围以 §8 的文件级清单为准，执行编排以 §10 的任务波次为准。

## 2. 使用环境

适用环境：

- Windows packaged Electron + Next.js 应用（本仓库根目录即运行时）；
- 课堂请求入口为 `/api/chat`，会话持久化入口为 `/api/conversations`；
- 课后笔记由 `lib/post-class-notes/orchestrator.js` 生成；
- 数据根目录为 `PROJECT_ROOT/accounts/<accountId>/profiles/<profileId>/worlds/<worldId>/`（legacy 账户为 `PROJECT_ROOT/profiles/...`），解析逻辑参考 `server.js:993-994`；
- 教材 PDF 管线已存在（kb-builder / close-reading / `lib/ocr/`），前端已有 pdfjs（`lib/pdfjs-paths.js`）可渲染教材页面；
- 课堂模型具备多模态视觉能力；`set.json` 中已有独立的 `vision` 模型配置块（`server.js:18` 加载逻辑）；
- 本地 OCR（RapidOCR / Windows OCR）与云端视觉预算门已存在于 `resources/server/lib/ocr/`；
- `sharp` 已存在于 `resources/server/node_modules/`。

不适用环境：

- kb-builder / close-reading 内部的 PDF 页图像管线——本方案只在其**之上**建立插图引用，不改其内部；
- 云端图床 / 跨设备同步（全部为本地文件与本地引用）；
- 图片编辑、标注画笔。

## 3. 问题定义

当前课堂与笔记是纯文本链路：

1. 教材里的插图（如「图 12-10」）无法进入对话：老师角色讲到图时学生要自己去翻书，学生想问图只能文字转述，双方对不上号；
2. 苏格拉底讲解几何、函数、流程类概念时只能堆文字，没有随手画示意图的能力；
3. 课后笔记是纯 markdown，复习时缺少视觉锚点，「这张图」无法被带回笔记；
4. 图片一旦出现，需要统一的锚点语法让消息、笔记、前端渲染三方指向同一张图。

核心约束：本仓库是**已打包构建产物**，所有改动是对编译后文件的手术式补丁（见 AGENTS.md），「改动面最小」是一等原则。

## 4. 目标

### 4.1 主要目标

- 课堂中可引用教材插图：按「教材 + 页码 + 图区域」建立锚点，消息与笔记中点击即看；
- LLM 可在回复中输出 SVG 工作图，前端直接渲染，并可一键存入索引；
- 课堂中可截图（应用窗口内选区），截图随会话持久化、点击可看；
- 所有图片统一进资产层，消息与笔记中一律以 `asset://<id>` 锚点引用；
- 发给 LLM 的上下文采用**置信度策略**：有可靠文本（用户说明 / 高置信 OCR / 已有视觉描述）就摊平为文本；识别不可靠且当前模型支持视觉时，直接以多模态格式把原图发给模型；
- 旧数据完全兼容：历史纯文本消息原样保留，不迁移、不改写。

### 4.2 非目标

- ~~不做全屏 / 跨窗口截图~~（已推翻：截图就是全屏冻结帧框选，应用窗口内截图无意义）；
- 不引入 SQLite / 向量库，资产清单用 JSONL；
- 不把全文搜索索引页当作核心交付（超链接锚点才是），搜索页放到 P2；
- 不从 PDF 里「自动识别并抠出」插图区域——图区域由用户框选或教学流程显式指定，不做版面分析；
- 不改动 `release-runtime-manifest.json` 钉住的任何部件（`.next/node_modules`、`deps.zip`、`lib/ocr/rapidocr-v5`）。

## 5. 核心原则

### 5.1 一个资产层，多个入口

教材插图、SVG、截图、raster 生图都是资产层的写入入口；课堂消息和笔记中的 `asset://` 锚点是读取出口。禁止为某类图单独搞一套存储或引用语法。

### 5.2 消息只存锚点，不存二进制

消息中的图片一律是 `{ "type": "image", "assetId }` 块。禁止 base64 进会话 JSON、进前端状态、进持久化文件。（唯一例外见 §5.4：发送给 LLM 的请求体内临时内联，不落盘。）

### 5.3 教材插图引用（2026-10-09 修订：服务端出图）

> **本节原「前端 pdfjs 零拷贝」设计已作废**——真机侦察确认前端 static chunks 无 pdfjs、阅读视图为纯文本窗口，无从渲染页图。修订后：textbook-figure 在**创建时由服务端渲染出图**（既有 pdfjs + @napi-rs/canvas + sharp 栈），落盘成普通 raster 资产，读取与截图同构；`ref`（textbookId/page/rect）仍记索引保留出处。完整方案见 [IMAGE_ASSET_LAYER_T13_PLAN.md](IMAGE_ASSET_LAYER_T13_PLAN.md)。

### 5.4 LLM 输入的置信度策略

chat 路由把图片块序列化进 LLM 请求时，按以下优先级：

1. 图片块附带可靠文本（用户手写说明 / 视觉描述 / OCR 置信度 ≥ 阈值）→ 摊平为 `[图片: <文本>]` 纯文本，省 token、对旧模型零要求；
2. 无可靠文本**且**当前课堂模型声明支持视觉（settings 中配置开关）→ 输出 OpenAI 兼容多模态 content part（`{ "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } }`），单张 ≤ 网关限制、每轮最多 N 张（阈值与上限放 settings，不写死）；
3. 以上都不满足 → 占位文本 `[图片: 未识别]`。

SVG 资产永远走文本通道：SVG 源码本身就是文本，直接把语义描述（或源码的摘要）摊平进上下文，不需要视觉模型。

### 5.5 SVG 优先于 raster 生图

教学示意图默认走 LLM 生成 SVG：便宜、精确、可编辑、可被文本索引。只有明确需要写实风格时才走 raster 生图 API，且必须过预算门。

### 5.6 路径安全照搬既有模式

资产读写沿用 `local-ocr-runner.mjs` 的 `contained()` 路径包含检查与 `lstat` 反符号链接校验；资产读取路由必须过 `lib/route-auth.js` 的本地请求鉴权。

## 6. 数据格式

### 6.1 资产目录布局

```
<worldDir>/assets/
  <assetId>.png            # 截图（统一 PNG）
  <assetId>.svg            # SVG 工作图（源码即文件）
  <assetId>.thumb.jpg      # 256px 缩略图（sharp 生成；SVG 与教材插图可无）
  index.jsonl              # 每行一条资产记录，append-only
```

`assetId` 格式：`ast_` + 16 位小写十六进制（crypto.randomBytes(8)）。教材插图（`textbook-figure`）**没有任何文件**，只有 index.jsonl 里的一行记录。

### 6.2 index.jsonl 记录

```json
{
  "id": "ast_9f3c...",
  "kind": "textbook-figure | svg | screenshot | generated",
  "createdAt": 1760000000000,
  "conversationId": "conv_xxx 或 null",
  "messageId": "msg_xxx 或 null",
  "noteId": "笔记ID 或 null",
  "ref": { "bookId": "教材ID", "page": 123, "rect": [0.1, 0.2, 0.9, 0.45] },
  "svgTitle": "SVG 的语义标题，非 SVG 为 null",
  "caption": "用户说明或视觉描述，无则 null",
  "ocrText": "本地 OCR 全文，无则 null",
  "ocrConfidence": 0.0,
  "prompt": "raster 生图 prompt，非生图为 null",
  "tags": ["图12-10", "时序图"],
  "width": 1280,
  "height": 720,
  "bytes": 345678
}
```

- `ref` 仅 `textbook-figure` 使用，其余 kind 为 null；
- 索引写入即 append 一行；启动时全量读入内存（单世界图片量级千级，无需数据库）；
- 删除资产 = 追加一行 `{ "id": "...", "deleted": true }`，按最后一条生效；
- 损坏行逐行 try/catch 跳过并 warn，不阻断启动。

### 6.3 消息块格式

会话消息的 `content` 由纯字符串扩展为「字符串 或 blocks 数组」：

```json
{ "role": "user", "content": [ { "type": "text", "text": "这张图里第二步的响应为什么也是异步的？" }, { "type": "image", "assetId": "ast_9f3c..." } ] }
```

- 读取方必须同时接受字符串与数组；**历史数据原样保留，不做任何迁移或改写**；
- 发给 LLM 前由 chat 路由按 §5.4 序列化；
- 前端渲染 blocks：请求 `GET /api/assets/<id>/meta` 拿 kind 与 ref，按 kind 分派渲染（见 §6.4）。

### 6.4 asset:// 锚点与前端分派渲染

笔记与消息中的 `![caption](asset://ast_9f3c...)` 由渲染层解析为可点击缩略图，点击放大：

| kind | 渲染方式 |
|---|---|
| `textbook-figure` | 前端用 pdfjs 打开 `ref.bookId` 对应教材的第 `ref.page` 页，按 `ref.rect` 裁剪显示；点击放大到整页并高亮该区域 |
| `svg` | 直接内联渲染 SVG 源码（需消毒：strip `<script>`/事件属性） |
| `screenshot` / `generated` | `GET /api/assets/<id>?thumb=1` 缩略图，点击看原图 |

渲染层遇到非法 assetId 或缺失记录时降级为纯文本，不报错。

## 7. API 设计

| 路由 | 方法 | 说明 |
|---|---|---|
| `/api/assets` | POST | 写入资产：`{ kind, pngBase64? , svgSource?, ref?, conversationId?, caption? }`，按 kind 校验必填字段，落盘（textbook-figure 不落盘）+ 缩略图 + 追加索引，返回 `{ assetId }`。PNG 单张 ≤ 12 MB，SVG 源码 ≤ 512 KB |
| `/api/assets/<id>` | GET | 读原文件（png/svg）；`?thumb=1` 读缩略图。textbook-figure 无文件，返回 404，前端走 meta + pdfjs |
| `/api/assets/<id>/meta` | GET | 返回该资产的 index 记录（kind、ref、caption 等），供渲染分派 |
| `/api/assets` | GET | 列表：`?conversationId=` / `?noteId=` / `?kind=` 过滤，按 createdAt 倒序 |
| `/api/assets/<id>/ocr` | POST | （P2）对 png 资产跑本地 RapidOCR，回填 ocrText 与 ocrConfidence |
| `/api/assets/search` | GET | （P2）`?q=` 对 ocrText + caption + svgTitle + tags 内存检索 |
| `/api/image-gen` | POST | （P2）raster 生图：过预算门，产物入资产层 |

路由文件均为手写新增（可以 `require("fs")`），不走 chunks。新建路由需同步维护 route manifest 并配 smoke test。

## 8. 文件级改动清单

### 8.1 新增（手写文件，安全区）

| 文件 | 内容 |
|---|---|
| `resources/server/lib/assets/store.js` | 资产落盘（png/svg）、textbook-figure 纯记录、目录布局、`contained()` 检查、index.jsonl append/加载 |
| `resources/server/lib/assets/index.js` | 内存清单：按 id/kind/conversationId 过滤、deleted 语义 |
| `resources/server/lib/assets/serialize.js` | blocks ↔ LLM 输入的序列化（§5.4 三级策略）；字符串输入恒等返回 |
| `resources/server/.next/server/app/api/assets/route.js` | §7 前四行 |
| `resources/server/lib/image-gen/` 整目录 | （P2）raster 生图 + 预算门（仿 vision-budget） |
| 各模块同名 `*-smoke-test.js` | 每个新 lib 模块、每条新路由各一个 |

### 8.2 修改（手术区，逐条核对）

| 文件 | 改动 | 风险 |
|---|---|---|
| `resources/server/server.js` 注入表（881-902 行区块） | 加两行：`__ASSETS__` → `./lib/assets/store.js`，`__SHARP__` → `require("sharp")`（`__loadOptionalGlobal__` 模式，失败降级无缩略图） | 低 |
| `resources/server/.next/server/app/api/chat/route.js` | ① 接受并透传 blocks 消息；② 调 `__ASSETS__.serialize` 按 §5.4 生成 LLM 输入（含多模态 content part 输出） | **高**：64092 definer 之一 |
| `resources/server/.next/server/app/api/conversations/route.js` | 会话保存/读取兼容 blocks（当前按对象透传，预计改动很小，需验证） | 中 |
| `main.js` + `preload.js`（根目录工作副本） | 新增 IPC `asset:captureRegion(rect)` → `webContents.capturePage` → PNG Buffer | 改完必须重打 asar + `node tools/patch-asar-integrity.js` |
| 前端静态 chunks | ① 聊天输入框：截图按钮 + 选区蒙层；② 「引用本页插图」入口（教材阅读视图中框选图区域）；③ 消息渲染 image 块（按 kind 分派，含 pdfjs rect 裁剪与 SVG 消毒渲染）；④ 笔记渲染 `asset://` | 先定位 chunk 再动手，`node --check` 必跑 |
| `resources/server/lib/post-class-notes/orchestrator.js` + `prompts.js` | （P1）生成笔记时把本会话图片清单（assetId + caption/页码图号）注入 prompt，指示模型按需引用 `asset://` | 中 |
| `resources/server/lib/ocr/vision-budget.js` | （P2）`allowedPurposes` 加 `"asset-caption"` | 低 |
| `set.json` / `settings.json` 的**读取代码** | 新增配置项读取：课堂模型是否支持视觉、每轮图片上限、OCR 置信度阈值 | 低（配置文件本身不入库） |

### 8.3 明确不动

- 64092 的其余 5 个 definer（concept-summary、flashcard、两个 persona 路由、chunks/4092.js）：不消费用户原始图片消息，**但提交前必须逐一确认**输入路径上没有 blocks 流入；若有，统一调 `serialize.js` 摊平为文本（不输出多模态 part）；
- `release-runtime-manifest.json` 及其 sha256 常量（main.js:35347）；
- `.next/node_modules`、`deps.zip`、`lib/ocr/rapidocr-v5`；
- kb-builder / close-reading 的内部页图像管线；
- `resources/settings.json`、`resources/set.json` 文件本身。

## 9. 分阶段实施与验收

### P0：资产层 + 截图 + 多模态序列化 + 看图（1–2 天）

范围：§8.1 的 store/index/serialize + assets 路由（不含 ocr/search）+ server.js 注入 + chat/conversations 兼容 + Electron 截图 IPC + 前端截图按钮与图片块渲染。

验收：

1. 课堂中框选窗口区域 → 图片出现在对话里 → 刷新后仍在、点击可放大；
2. 带图消息发出去：模型支持视觉时服务端日志可见多模态 content part；配置关掉视觉后同一条消息降级为占位文本；
3. 历史纯文本会话正常打开，零迁移、零报错；
4. `node --check` 覆盖全部改动文件；新增 smoke test 全绿；`.next/` 下相关旧 smoke test 手动跑过；`node tools/run-smoke-matrix.js` 无新增失败。

### P1：教材插图锚点 + SVG 工作图 + 笔记引用（2–3 天）

范围：textbook-figure 记录 + 教材阅读视图「引用本页插图」框选入口 + 前端 pdfjs rect 渲染 + LLM 回复中 SVG 代码块的渲染与「存入索引」+ post-class-notes 引用注入。

验收：

1. 在教材第 N 页框选一张插图发给苏格拉底 → 对话里出现该图（pdfjs 渲染），资产记录 kind 为 `textbook-figure` 且**资产目录无新文件**；
2. 苏格拉底回复包含 ```svg 代码块时前端渲染为图，点击「存入索引」后出现资产记录；
3. 上完一节有图的课，笔记中含 `asset://` 引用且按 kind 正确渲染。

### P2：本地 OCR 回填 + raster 生图 + 搜索页（2–3 天）

范围：`/api/assets/<id>/ocr` + vision-budget 白名单 + `lib/image-gen/` + `/api/image-gen` + `/api/assets/search` + 索引页 UI。

验收：

1. 截图 OCR 后回填 ocrText/ocrConfidence；置信度达标的图在后续 LLM 请求中走文本摊平；
2. 生图超预算返回明确错误码，前端有可读提示；
3. 用图中的字能搜到这张图。

## 10. 任务切分与并发执行策略（DeepSeek 执行方式）

本节是执行编排，§9 的 P0/P1/P2 是验收里程碑。核心原则：**高并发、短任务优先**——把工程切成互不依赖的原子任务并发派发，避免单个长任务里上下文持续累积导致注意力漂移。

### 10.1 切分原则

- 原子任务 = 单一文件或单一关注点，正常 20–40 分钟内完成；预估超过即再拆；
- 每个任务一张任务卡，只含四要素：**输入文件 / 产出 / 验收命令 / 禁止事项**。执行任务时只读任务卡 + §6/§7 契约，不要求通读全文；
- 同一波次内的任务不得修改同一文件；有文件重叠的任务分到不同波次；
- 每完成一个原子任务**立即** `node --check` + 对应 smoke test，不攒批；每波结束跑 `node tools/run-smoke-matrix.js`；
- 高风险任务（chat 路由 blocks 化、asar 重打）独占波次或波末串行，不与其他改动并发。

### 10.2 P0 并发波次

**Wave 1（5 个任务全并行，互不共享文件）：**

| 任务 | 内容 | 验收命令 |
|---|---|---|
| T01 | 新增 `lib/assets/store.js` + smoke test（含 textbook-figure 纯记录无落盘用例） | `node --check` + `node <smoke>` |
| T02 | 新增 `lib/assets/index.js` + smoke test | 同上 |
| T03 | 新增 `lib/assets/serialize.js` + smoke test（必含：字符串恒等返回 / 有 caption 摊平文本 / 无 caption+视觉开=多模态 part / 视觉关=占位文本） | 同上 |
| T04 | `main.js` + `preload.js` 截图 IPC（本波只改文件，不打 asar） | `node --check main.js preload.js` |
| T05 | 前端侦察（**只读任务**）：定位消息渲染 chunk、输入框 chunk、教材阅读视图 chunk，产出定位笔记 | 笔记含 chunk 文件名 + 关键字符串证据 |

**Wave 2（并行，各自只依赖 Wave 1 的对应产物）：**

| 任务 | 内容 | 依赖 |
|---|---|---|
| T06 | `/api/assets/route.js`（POST/GET/meta/列表）+ smoke | T01 |
| T07 | `server.js` 注入表加 `__ASSETS__`、`__SHARP__` 两行 | T01、T03 |
| T08 | 前端截图按钮 + 选区蒙层 | T04、T05 |
| T09 | 波末串行：asar 重打 + `node tools/patch-asar-integrity.js` | T04 |

**Wave 3（高风险区，T10/T11 串行独占；T12 不共享文件可与 T10 并行）：**

| 任务 | 内容 | 依赖 |
|---|---|---|
| T10 | chat 路由 blocks 兼容 + §5.4 序列化接入：先跑既有 chat smoke 留基线 → 改 → 复跑基线 + 新增多模态用例 | T03、T06 |
| T11 | conversations 路由兼容性验证（预期只读确认，微改需单独说明） | T10 |
| T12 | 前端消息图片块渲染（含 `asset://` 分派） | T05、T06 |

### 10.3 P1 / P2 波次（简表）

- **P1 Wave A（并行）**：教材阅读视图「引用插图」框选入口 + pdfjs rect 渲染 ∥ 前端 SVG 代码块渲染（含消毒）与「存入索引」按钮 ∥ post-class-notes 的 prompt 图片清单注入（orchestrator.js + prompts.js 属同一关注点，一个任务）；
- **P1 Wave B（串行）**：笔记渲染层 `asset://` 按 kind 分派 + 联通验收；
- **P2 Wave A（并行）**：`/api/assets/<id>/ocr` 子路由 + 置信度回填 ∥ `lib/image-gen/` + 预算门 ∥ vision-budget 白名单加一行（极短任务）∥ 搜索页 UI；
- **P2 Wave B（串行）**：`/api/image-gen` 路由 + `/api/assets/search` + 端到端验收。

### 10.4 防漂移纪律

- 任何任务发现契约（§6/§7）与实际代码不符：**停止该任务、回报差异**，禁止现场改契约或擅自扩大范围；
- 任务卡未列出的文件不许改；确需改，新开任务卡排入下一波；
- 长链路操作（asar 重打、完整性校验、矩阵测试）只出现在波末固定任务中，不嵌在开发任务里；
- 每个任务完成后输出三行小结：改了什么文件 / 验收命令结果 / 是否发现契约偏差。

## 11. 风险与回滚

| 风险 | 缓解 |
|---|---|
| chat 路由 blocks 化破坏现有会话 | serialize.js 对字符串输入恒等返回；先写双格式读取的 smoke test 再动手 |
| 多模态请求被网关拒绝或格式不符 | serialize.js 的视觉分支由 settings 开关控制，默认关；开启前先用一张小图做联通验证 |
| Electron asar 重打包失败 | 改 main.js 前先 `node tools/patch-asar-integrity.js --check` 确认当前状态可验 |
| sharp 在打包环境加载失败 | `__loadOptionalGlobal__` 模式天然降级（无缩略图，前端用原图 + CSS 限宽） |
| pdfjs 渲染教材页失败或 rect 越界 | 渲染层降级为「第 N 页」纯文本链接，不阻断消息显示 |
| LLM 生成非法 / 恶意 SVG | 渲染前消毒（strip script/事件属性/外部引用）；超 512 KB 拒绝入库 |
| 生图成本失控 | 预算门默认每日硬上限，配置放在 settings 而非代码里 |

回滚策略：P0 的所有新增文件可直接删除；chat/conversations 的兼容代码保留字符串路径，删掉 blocks 分支即回到现状；Electron 层用 git 还原 main.js/preload.js 后重打 asar。

## 12. 实施纪律（仓库硬性约束）

- chunks 里禁止 `require("fs")`，一律 `global.__FS__` / `global.__PATH__`；新增共享模块必须登记进 server.js 注入表；
- 压缩 bundle 内字符串转义：`'` → `\'`，`"` → `\"`，反引号与 `${` 同理；改完用 acorn 定位语法错误；
- 每个改动文件过 `node --check`；相关 smoke test 逐个手动跑（矩阵跳过 `.next/`）；
- 代码风格对齐周边：CommonJS、2 空格缩进、camelCase；不重排生成文件；
- 临时产物放 `tmp/` 或 `outputs/`；新 smoke test 命名 `<module>-smoke-test.js` 与模块同目录。

---

## 13. 附录：P0 任务卡（派发单）

每张任务卡独立派发，执行时只需读本卡 + §6/§7 契约。卡内「验收命令」逐条执行并回报结果。

### T01　资产存储模块

- **输入**：本方案 §6.1、§6.2；路径安全参考 `resources/server/lib/ocr/local-ocr-runner.mjs` 的 `contained()` 与 `lstat` 模式
- **产出**：
  - `resources/server/lib/assets/store.js`：导出 `createAsset({kind, pngBuffer?|svgSource?|ref?, conversationId?, caption?})`、`getAssetRecord(id)`、`listAssets(filter)`、`appendRecord(record)`、`loadAll()`；资产根目录解析复用 `server.js:993-994` 的 worldDir 逻辑（`PROJECT_ROOT/accounts/<accountId>/profiles/<profileId>/worlds/<worldId>/assets/`，legacy 兼容）
  - `resources/server/lib/assets/assets-store-smoke-test.js`：自包含、不依赖运行中的应用
- **验收命令**：
  - `node --check resources/server/lib/assets/store.js`
  - `node resources/server/lib/assets/assets-store-smoke-test.js`
- **必含用例**：① textbook-figure 只写 index.jsonl、目录无新文件；② png 落盘 + 记录完整；③ svg 超 512 KB 拒绝；④ 路径穿越（`../`）拒绝；⑤ 符号链接拒绝；⑥ deleted 行语义
- **禁止**：改 `server.js`；改 `.next/` 下任何文件；引入新依赖

### T02　内存清单模块

- **输入**：本方案 §6.2
- **产出**：`resources/server/lib/assets/index.js`（按 id / kind / conversationId / noteId 过滤、按 createdAt 倒序、deleted 按最后一条生效）+ `assets-index-smoke-test.js`
- **验收命令**：`node --check` + `node <smoke>`
- **必含用例**：千条记录加载 < 200ms；损坏行跳过不中断
- **禁止**：引入 sqlite / 任何外部存储依赖

### T03　LLM 输入序列化模块

- **输入**：本方案 §5.4
- **产出**：`resources/server/lib/assets/serialize.js`：导出 `messagesToLlmInput(messages, {visionEnabled, maxImagesPerTurn, ocrThreshold})` + `assets-serialize-smoke-test.js`
- **验收命令**：`node --check` + `node <smoke>`
- **必含用例**：① 字符串 content 恒等返回（逐字节相等）；② 有 caption 的 image 块摊平为 `[图片: <caption>]`；③ 无 caption + visionEnabled=true → 输出 `{type:"image_url", image_url:{url:"data:image/png;base64,..."}}` part；④ 无 caption + visionEnabled=false → `[图片: 未识别]`；⑤ 每轮图片数超 maxImagesPerTurn 时超出的块降级为占位文本
- **禁止**：在本模块内做网络请求或文件 IO（图片 base64 由调用方注入）

### T04　Electron 截图 IPC

- **输入**：根目录 `main.js`、`preload.js`（工作副本）；`webContents.capturePage` API
- **产出**：IPC handler `asset:captureRegion(rect)` 返回 PNG Buffer；preload 暴露 `window.electronAPI.captureRegion(rect)`
- **验收命令**：`node --check main.js && node --check preload.js`
- **禁止**：本任务**不重打 asar**（T09 的事）；不改现有 IPC；不动 `main.js:35347` 的哈希常量

### T05　前端侦察（只读）

- **输入**：`resources/server/.next/static/chunks/` 全目录
- **产出**：`outputs/frontend-recon-notes.md`，含：① 聊天消息渲染所在 chunk 文件名 + 定位证据（关键字符串）；② 聊天输入框所在 chunk；③ 教材阅读视图（pdfjs 调用点）所在 chunk；④ markdown 图片渲染（`<img>` 生成处）所在 chunk
- **验收**：笔记中每条定位都有 chunk 文件名 + 可 grep 到的原文片段
- **禁止**：修改任何文件

### T06　资产 API 路由

- **输入**：本方案 §7 前四行；T01 产物；鉴权参考 `resources/server/lib/route-auth.js`
- **产出**：`resources/server/.next/server/app/api/assets/route.js`（POST / GET 列表 / GET `<id>` / GET `<id>/meta`）+ 对应 route manifest + `assets-route-smoke-test.js`
- **验收命令**：`node --check` + `node <smoke>`
- **必含用例**：未授权请求拒绝；`<id>` 参数路径穿越拒绝；textbook-figure 的 GET 原文件返回 404 而 meta 正常
- **禁止**：改 T01 的 store.js（发现缺陷就停止并回报）

### T07　server.js 注入表登记

- **输入**：T01、T03 产物；`server.js:881-902` 注入表区块
- **产出**：注入表加两行——`["__ASSETS__", "./lib/assets/store.js", "[assets] Store"]`、`["__SHARP__", "sharp", "[assets] sharp", ...]`（sharp 用 `__loadOptionalGlobal__` 同款 try/catch 模式，模块名直接 require）
- **验收命令**：`node --check resources/server/server.js`；diff 核对仅新增两行
- **禁止**：改动注入表以外的任何代码

### T08　前端截图入口

- **输入**：T04 的 IPC、T05 的定位笔记
- **产出**：聊天输入框加截图按钮 → 选区蒙层 → 调 `captureRegion` → POST `/api/assets` → 以 image 块插入当前消息草稿
- **验收命令**：`node --check <改动的 chunk 文件>`；acorn 解析通过
- **禁止**：改消息渲染逻辑（T12 的事）

### T09　asar 重打（波末串行）

- **输入**：T04 产物
- **产出**：重打 `resources/app.asar` + 重嵌完整性哈希
- **验收命令**：`npx asar pack _asar_extracted/ resources/app.asar`（或仓库既有流程）→ `node tools/patch-asar-integrity.js` → `node tools/patch-asar-integrity.js --check`
- **禁止**：T04 未通过 `node --check` 时执行本任务

### T10　chat 路由 blocks 化（高风险，独占）

- **输入**：T03、T06 产物；`resources/server/.next/server/app/api/chat/route.js`
- **产出**：① 改前先跑基线：`node resources/server/.next/server/app/api/chat/chat-end-class-integration-smoke-test.js` 并记录结果；② 接受 blocks 消息、透传持久化、调 `__ASSETS__.serialize`（即 T03 模块，经 server.js 注入）生成 LLM 输入；③ 视觉开关等参数从 `global.__SOCRATOPIA_SET__` 读取，缺省关闭
- **验收命令**：基线 smoke 复跑全绿 + 新增多模态序列化用例通过 + `node --check route.js`
- **禁止**：改其余 5 个 64092 definer（只检查、不改动）；开启视觉默认值

### T11　conversations 路由兼容验证

- **输入**：T10 产物；`resources/server/.next/server/app/api/conversations/route.js`
- **产出**：验证 blocks 消息保存/读取往返无损；若需微改，改动说明写入任务小结
- **验收命令**：相关 smoke 全绿 + 往返用例（写入含 image 块的消息 → 读回逐字节比对）
- **禁止**：任何数据迁移逻辑

### T12　前端图片块渲染

- **输入**：T05 定位笔记、T06 的 meta 接口契约
- **产出**：消息渲染 image 块：先 GET meta 按 kind 分派——textbook-figure 走 pdfjs rect 渲染、svg 消毒内联、png 走 `?thumb=1`；点击放大；`asset://` 在 markdown 渲染层同样分派；非法 ID 降级纯文本
- **验收命令**：`node --check <chunk>` + acorn 解析通过
- **必含检查**：SVG 消毒用例（含 `<script>` / `onclick` 的 SVG 渲染后无脚本）

### P1/P2 任务卡（派发前再展开为完整四要素）

- T13 教材插图（服务端出图）——**已展开为完整任务卡，见 [IMAGE_ASSET_LAYER_T13_PLAN.md](IMAGE_ASSET_LAYER_T13_PLAN.md)**（T13a 页渲染模块 → T13b 资产落盘 ∥ T13c 页图预览 → T13d 前端框选入口 → T13e 联通验收）
- T14 前端 SVG 代码块渲染 + 「存入索引」按钮（P1A）
- T15 post-class-notes prompt 图片清单注入（P1A）
- T16 笔记 `asset://` 分派渲染联通（P1B，串行）
- T17 `/api/assets/<id>/ocr` + 置信度回填（P2A）
- T18 `lib/image-gen/` + 预算门 + `/api/image-gen`（P2A→P2B）
- T19 vision-budget 白名单 + `/api/assets/search` + 搜索页（P2A，白名单为极短任务）
