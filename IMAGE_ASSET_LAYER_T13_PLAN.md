# T13 教材插图（服务端出图）开发方案

> **状态（2026-10-10）**：T13a–T13e 已全部落地并通过验收，记录见 [IMAGE_ASSET_LAYER_T13_COMPLETION_REPORT.md](IMAGE_ASSET_LAYER_T13_COMPLETION_REPORT.md)（含三处与本文的偏差说明）。
> 本文是《IMAGE_ASSET_LAYER_PLAN.md》T13 任务卡的**修订版与完整展开**，替代原 §5.3「教材插图零拷贝引用」设计。主计划其余部分不变。
> 前置：P0 资产层已完成并验收（见 IMAGE_ASSET_LAYER_P0_ACCEPTANCE_REVIEW.md），含 `lib/assets/`（store/index/serialize/http/route-module）、`/api/assets` 路由、前端 `public/asset-capture.js`（blob 水合 + `pickRegionOnImage` 框选 + lightbox）。

## 1. 为什么修订：原设计的前提不成立

原设计（§5.3）：textbook-figure 不落盘，前端用 pdfjs 打开教材页按 rect 裁剪渲染。

真机侦察结论（2026-10-09）：

1. **前端没有 pdfjs**。`.next/static/chunks/**` 全文检索 `pdfjs` / `getDocument` 零命中；唯一的 `/api/pdf-assets` 调用只是取 KaTeX CSS（笔记导出 PDF 用）。
2. **阅读视图是纯文本窗口**。教材内容经 close-reading/kb 管线抽成文本，前端通过 `GET /api/reading-context` 拿 `readingRange`（顶栏「163-182/446」即它），没有页图像可供框选。
3. **服务端渲染栈是现成的**：`lib/kb-builder.mjs:480-540` 已用 `pdfjs-dist@5.5.207`（`.next/node_modules`，runtime manifest 已含）+ `@napi-rs/canvas`（`kb-builder.mjs:224` 动态 import）+ `sharp` 做「PDF 页 → PNG」。`lib/pdfjs-paths.js` 提供 cMap/standard_fonts/wasm 路径规范化。

因此裁定：**textbook-figure 改为创建时服务端渲染出图、落盘成普通 raster 资产**。读取路径与截图完全同构（`/api/assets/<id>` + `?thumb=1`），前端零 pdfjs 依赖、消息渲染层**无需按 kind 分派**——比原设计更简单。`ref`（textbookId/page/rect）仍记入 index.jsonl，保留出处。

## 2. 目标与非目标

目标：教材某一页的某块区域（插图），用户框选一次即成为资产，课堂消息与笔记中 `asset://` 锚点点击即看、刷新仍在、可放大。

非目标（维持主计划 §6）：

- 不做版面分析、不自动抠图；图区域一律用户框选；
- 不改 kb-builder / close-reading 内部管线；
- LLM 主动「讲到图就亮图」放 P2（需要图号→assetId 映射进课堂上下文，另立项）；
- 不引数据库；不动 `release-runtime-manifest.json`（pdfjs/napi-rs-canvas/sharp 均已在 manifest 内，零新增依赖）。

## 3. 数据与坐标约定

- `rect`：**归一化坐标** `[x0, y0, x1, y1]`，相对页面原始宽高的比例（0–1）。预览 UI 按显示尺寸换算，服务端按渲染后像素换算——与 DPI 无关，两端天然一致。**禁止**传像素坐标跨端。
- 资产记录：`{ id, kind: "textbook-figure", createdAt, conversationId?, ref: { textbookId, page, rect }, caption? }`，**有实体文件** `<assetId>.png` + `<assetId>.thumb.jpg`。
- 教材 PDF 路径解析：`<world>/textbooks/<textbookId>/` 顶层唯一 `*.pdf`（只扫顶层，忽略 `backup-*` / `handoff` / `knowledge_base` 子目录；多个 pdf 取 `textbook_index.json` 记录的源文件名，取不到才报错 `textbook_source_ambiguous`）。
- 兼容性：P0 期间理论上有「无文件 textbook-figure」记录形态（smoke 里造过），真机数据中不存在；如有，GET 仍 404，前端既有降级（纯文本链接）兜底，**不做迁移**。

## 4. 任务拆分（高并发短任务）

编排原则沿用主计划 §10：原子任务、互不依赖的并发派发。依赖关系：T13a 先行 → T13b ∥ T13c → T13d → T13e。

### T13a 服务端页渲染模块（先行，阻塞 b/c）

- **目标**：把 kb-builder 里验证过的 pdfjs 页渲染能力抽成 route 可用的共享模块。
- **改动**：新建 `resources/server/lib/pdf-page-render.js`（CommonJS，2 空格，match 周边风格）：
  - `async renderPageRegion(pdfPath, page, rect /* nullable */, opts) -> { png: Buffer, width, height }`；
  - pdfjs `getDocument` 参数照抄 `kb-builder.mjs:505-512`（cMapUrl/standardFontDataUrl/wasmUrl 走 `lib/pdfjs-paths.js` 的 `resourceDir`，`disableAutoFetch: true, disableStream: true, useSystemFonts: true`）；
  - doc 级 LRU 缓存：key = `pdfPath + mtimeMs`，上限 3 本，超出逐出并 `doc.destroy()`；
  - 渲染限幅常量沿用 builder（150/72 DPI、`MAX_CANVAS_SIDE`、`MAX_CANVAS_PIXELS`），`rect` 非空时用 sharp `extract` 裁剪（像素 = rect × 渲染宽高，四舍五入并 clamp 到 ≥1px）；
  - 编码错误：`figure_page_out_of_range` / `figure_rect_invalid` / `figure_render_failed`。
- **验收**：新建 `lib/pdf-page-render-smoke-test.js`：用 `lib/ocr/fixtures/` 现有测试 PDF（先确认其中有哪几个可用，选页数 ≥3 的）断言 ① 整页渲染 PNG 头字节正确、尺寸在限幅内；② rect 裁剪后尺寸 ≈ 比例换算值；③ 同一文件二次调用命中缓存（可导出一个内部计数器或计时断言放宽）；④ 非法页码/越界 rect 抛对应编码错误。
- **约束**：这是 `lib/` 手写层，可以 `require("fs")`；但**不得** import kb-builder.mjs 本体（它是子进程 worker，带进程级全局状态）。

### T13b assets 路由支持 textbook-figure 落盘（依赖 a；与 c 并行）

- **目标**：`POST /api/assets` 接受 `{ kind: "textbook-figure", ref: { textbookId, page, rect }, caption?, scope }`，服务端渲染 + 裁剪 + 落盘 + 记索引。
- **改动**：
  - `lib/assets/store.js`：`createAsset` 放开「textbook-figure 不写文件」的 P0 限制，允许调用方传入已生成的 png buffer 走与 screenshot 相同的落盘 + sharp thumb 路径；`ref` 校验加 textbook-figure 分支（textbookId 非空字符串、page ≥1 整数、rect 为 4 个 0–1 数且 x0<x1、y0<y1）；
  - `lib/assets/route-module.js`（或 POST 所在处）：textbook-figure 分支 → 解析教材 PDF 路径（§3 规则，scope 校验复用 `contained()` 防穿越）→ 调 `pdf-page-render.renderPageRegion` → `createAsset`；
  - GET 分支**不动**（有文件后自然走 raster 路径）。
- **验收**：更新 `lib/assets/assets-store-smoke-test.js` 与 `assets-http-smoke-test.js` 中原「textbook-figure must not create a binary / returns 404」两条断言为「有文件、GET 200、meta 保留 ref」；新增用例：缺 textbookId、rect 越界、路径穿越（`textbookId: "../.."`）分别返回对应编码错误。
- **约束**：route 文件可以 `require("fs")`；渲染全程异步，不得阻塞事件循环做同步读大文件。

### T13c 页图预览接口（依赖 a；与 b 并行）

- **目标**：`GET /api/textbook/page-image?profileId&worldId&textbookId&page&maxWidth` 返回整页 PNG，供前端框选预览。
- **改动**：在现有 `api/textbook/route.js` 加 `page-image` 子动作（或按现有 route 组织方式定）；内部调 T13a 模块整页渲染（`rect=null`），sharp 缩放到 `maxWidth`（默认 960，上限 1600）；内存 LRU 缓存（key = 路径+mtime+page+maxWidth，上限 24 页）。
- **验收**：新建 smoke：合法参数 200 + PNG 头；缺参数/非法页码 400；scope 不合规 403/400（对齐既有路由的鉴权与 scope 约定，先看 assets 路由怎么做的就怎么做）。
- **约束**：该路由与 assets 一样按「读」语义放行（参照 P0 对 asset 读取的 scope 裁定）；响应头 `Cache-Control: private, max-age=3600`。

### T13d 前端「引用本页插图」入口（依赖 c）

- **目标**：课堂/阅读视图可框选教材页区域并插入锚点。
- **改动**（全部在 `resources/server/public/asset-capture.js` 与挂载它的页面上下文，不改打包 chunk 逻辑之外的文件）：
  - 入口按钮放在课堂顶栏教材名附近（对齐现有截图按钮的注入方式）；仅当当前会话有 `textbookId` 时显示；
  - 点击 → 弹层：页码输入框（默认当前 `readingRange` 首页，从 `/api/reading-context` 拿，前端已有此调用）+ 调用 T13c 显示页图；
  - 页图上框选：**复用 `pickRegionOnImage(img)`**（asset-capture.js:261，冻结帧框选，已验收）→ 得归一化 rect；
  - `POST /api/assets`（kind=textbook-figure）→ 插入 `![图 p.N](asset://<id>)` 锚点进输入框（复用 P0 截图的插入路径）。
- **验收**：更新 `asset-capture-ui-smoke-test.js`：stub fetch 模拟 page-image 与 POST，断言流程状态机与锚点插入；`node --check` 必跑；版本号 query 继续递增（`?v=20261009-3` → 新值）。
- **约束**：保持单文件注入架构，不引入新的构建步骤；所有新 UI 文案走既有 toast/样式约定。

### T13e 联通验收（最后，串行）

- 真机端到端：教材页框选 → 对话出图（blob 水合）→ 刷新仍在 → 点击放大 → 下课生成笔记可引用；
- `node --check` 全部改动文件；新增/更新 smoke 全绿；`.next/` 下相关旧 smoke 手动跑；`node tools/run-smoke-matrix.js` 无新增失败（已知 6 个环境性失败：kb-builder×2 / rapidocr / reasoning×3，因 Kimi shell node shim 无法按名 spawn 子进程，与本任务无关，不要顺手「修」它们）。

## 5. 风险与回退

| 风险 | 缓解 |
| --- | --- |
| pdfjs 在 Next server 进程渲染大 PDF 的内存/耗时 | doc LRU 上限 3 + 限幅常量沿用 builder；渲染失败返回编码错误不崩路由 |
| 教材目录多 pdf / 无 pdf | §3 解析规则 + `textbook_source_ambiguous` / `textbook_source_missing` 编码错误 |
| 页图预览与裁剪几何不一致 | 统一归一化 rect，两端各自换算，无跨端像素 |
| P0 无文件 textbook-figure 记录 | GET 404 → 前端既有纯文本降级；不迁移 |

回退：全部改动为新增文件 + store/route 的增量分支，revert 即回退；无 schema 迁移、无 manifest 变动。

## 6. 审核锚点（给仓库主人）

提交前请重点审：

1. `lib/pdf-page-render.js` 的 doc LRU 逐出是否真的 `destroy()`；
2. `store.js` 放开 textbook-figure 落盘时，P0 既有 screenshot/svg 路径的断言是否全部保持绿色；
3. T13c 的 scope/鉴权是否与 `/api/assets` 读取口径一致；
4. 前端入口是否只在有 `textbookId` 时出现，无教材会话零干扰。
