# 图像资产层 P0 完成报告

对应方案：`IMAGE_ASSET_LAYER_PLAN.md`。本报告只覆盖 **P0（Wave 1–3）**：T01–T12。T13–T19 未开工。

执行者：DeepSeek。全部改动均为对已打包产物的手术式补丁 + 新增手写源文件，无构建管线参与。

---

## 1. 结论

P0 全部任务完成，验收命令全部通过，全量 smoke 矩阵 **0 失败**，应用已用新 `app.asar` 实际启动并验证路由与静态脚本生效。

| 验收项（§11） | 结果 | 证据 |
|---|---|---|
| 资产目录 + index.jsonl 落地 | ✅ | `assets-store-smoke-test.js` 17 passed |
| 教材插图零拷贝（目录无新文件） | ✅ | 同上，用例 1 断言 `readdir == ["index.jsonl"]` |
| 路径安全（穿越 / 符号链接） | ✅ | store 用例 4/5/5b/5c；`contained()` 直接单测 |
| 未授权请求拒绝 | ✅ | http 用例 + 真机 `401 auth_missing`（非 404） |
| `/api/assets` 四接口 | ✅ | 真机 HTTP 集成 12 passed |
| chat 带图消息发出去 | ✅ | `chat-asset-blocks-integration-smoke-test.js` 9 passed |
| 视觉开关开/关两态 | ✅ | 同上，开=多模态 part，关=`[图片: 未识别]` |
| 历史纯文本会话零迁移 | ✅ | serialize 恒等用例 + conversations 往返用例 |
| 前端截图入口 + 图片渲染 | ✅ | `asset-capture-ui-smoke-test.js` 13 passed |
| 全量矩阵无新增失败 | ✅ | `outputs/matrix-after-all.json`：136 / 134 passed / **0 failed** / 2 skipped |
| 应用可启动（asar 完整性） | ✅ | 关闭应用→重打→`patch-asar-integrity.js` 写入→`--check` in sync→实机启动成功 |

---

## 2. 交付物

### 2.1 新增手写源（可当普通源码编辑）

| 文件 | 作用 |
|---|---|
| `resources/server/lib/assets/store.js` | 落盘：PNG/SVG 文件 + append-only `index.jsonl`；`contained()` + `lstat` 反符号链接；`findAssetScope()` 按 id 反查世界 |
| `resources/server/lib/assets/index.js` | 内存清单：按 id/kind/conversationId/noteId/tags 过滤、deleted last-wins、mtime+size 签名失效；1000 条冷载 3ms |
| `resources/server/lib/assets/serialize.js` | §5.4 置信度阶梯；SVG 恒走文本；`optionsFromGlobals()` / `createGlobalImageResolver()` |
| `resources/server/lib/assets/http.js` | 四个接口的处理器（与 webpack 解耦，可脱离 Next 单测） |
| `resources/server/lib/assets/route-module.js` | 手写版 app-route 运行时（见 §4.1） |
| `resources/server/public/asset-capture.js` | 前端截图入口：悬浮按钮、框选遮罩、IPC 调用、POST 建资产、插入 `asset://` 锚点、灯箱 |
| `resources/server/server.js` | 注入表新增 4 行（纯新增，见 diff） |
| `resources/server/smoke-test-utils.js` | 新增可选 `set` / `settings` 合并项，让测试能在重启前后带自定义配置启动 |
| `main.js` / `preload.js` | `asset:captureRegion` IPC + `captureRegion` 桥接 |

### 2.2 新增路由（手写，非 webpack bundle）

- `resources/server/.next/server/app/api/assets/route.js`
- `resources/server/.next/server/app/api/assets/[id]/route.js`
- `resources/server/.next/server/app/api/assets/[id]/meta/route.js`

三个清单已同步：`app-path-routes-manifest.json`、`server/app-paths-manifest.json`、`routes-manifest.json`（后者含两条 `dynamicRoutes`，regex 由 Next 自己的 `getRouteRegex` 生成）。

### 2.3 新增测试（8 个，全部通过）

| 测试 | 位置 | 结果 |
|---|---|---|
| `assets-store-smoke-test.js` | `lib/assets/` | 17 passed |
| `assets-index-smoke-test.js` | `lib/assets/` | 7 passed |
| `assets-serialize-smoke-test.js` | `lib/assets/` | 21 passed |
| `assets-http-smoke-test.js` | `lib/assets/` | 13 passed |
| `assets-route-integration-smoke-test.js` | `.next/.../api/assets/` | 12 passed（真机 HTTP） |
| `chat-asset-blocks-integration-smoke-test.js` | `.next/.../api/chat/` | 9 passed（真机 HTTP + MockLLM） |
| `conversations-blocks-roundtrip-smoke-test.js` | `.next/.../api/conversations/` | 11 passed（真机 HTTP） |
| `asset-capture-ui-smoke-test.js` | `.next/static/chunks/app/` | 13 passed（含 DOM stub 执行） |

### 2.4 打补丁的编译产物

- `.next/server/app/api/chat/route.js` — 3 处：body 归一化后接入序列化；`ab`（命令文本）与下课的 `H`（学习者发言提取）改为数组容错。
- `.next/static/chunks/app/page-87daa6ca210ab9dc.js` — 3 处：markdown `img:` 覆写、`a:` 增加 `asset://` 分支、消息气泡把 blocks 数组压成 markdown。
- `.next/server/app/api/{conversations,search,stats}/route.js` + `.next/server/chunks/9654.js` — `Yn`（下课交接历史）`content.trim()` 数组容错，4 个 definer 同步。
- `.next/server/app/index.html` — 一行 `<script src="/asset-capture.js?v=20260809-1">`。
- `resources/app.asar` 重打（gitignore）+ `Socratopia.exe` 的 `ELECTRONASAR` 重写。备份在 `tmp/app.asar.bak`。

---

## 3. 真机验证记录

```
# 关闭应用后
node tools/patch-asar-integrity.js         -> patched: resources\app.asar 88b3920b…c3dd15
node tools/patch-asar-integrity.js --check -> in sync: resources\app.asar 88b3920b…c3dd15

# 启动应用（新 asar，完整性通过，5 个进程）
.\.Socratopia.exe ; <userData>/.server-port -> {"port":13713}

# 无 token 探测（命中路由则 401 JSON，未命中会是 Next 404 页面）
GET /api/assets                        -> 401 {"code":"auth_missing",…}  路由已注册
GET /api/assets/<id>                   -> 401 同上（动态段匹配成功）
GET /api/assets/<id>/meta              -> 401 同上（双层动态段匹配成功）
GET /asset-capture.js                  -> 200 application/javascript 14678 B，含 __SOCRATOPIA_ASSET_CAPTURE__
```

`release-runtime-manifest.json` 的 sha256 仍等于 `main.js:35347` 的常量（`d01275c8…3d2b`），证明没有碰到被钉住的部件，无需重新生成。

---

## 4. 与方案不一致之处（需确认）

### 4.1 手写路由的落地机制（重要）

方案 §8.1 说路由「手写新增」。实测 Next 16 的 app-route 需要模块导出 `handler`，仅导出 `routeModule` 会 500（`ComponentMod.handler is not a function`）。因此 `lib/assets/route-module.js` 是 **`next/dist/build/templates/app-route.js` 的 1:1 移植**，把构建期的 `VAR_*` 占位符换成工厂参数；每个 `route.js` 只有一行 `module.exports = require(...).create(page, pathname, bundlePath)`。

代价：升级 Next 时需要对照该模板复核 `route-module.js`。已在文件头注明。

### 4.2 前端走 markdown 锚点，而不是自建 blocks

方案 §6.3 给了 blocks 结构，T08/T12 隐含前端产出 blocks。实际做法是：截图插入的文本是 `![图片](asset://<id>)`，**消息仍是字符串**。

理由：编译后的 React composer 没有便宜的接缝（按钮在 `tq` 的 JSX 里，需要新增 prop）；改 DOM 文本框 + 原生 setter 派发 `input` 更小更稳。

blocks 并未落空：服务端 chat/conversations 完整支持并被测试覆盖，前端气泡也会把数组内容压成同样的锚点 markdown。也就是说，字符串与 blocks 两条路都通、且收敛到同一个 `asset://` 引用语法。

### 4.3 SVG 走 `<img src>` 而非内联

方案 T12 写「svg 消毒内联」。实现用 `<img src="/api/assets/<id>?thumb=1">`。

理由：以图片文档加载的 SVG **脚本天然禁用**，`<script>`/`onclick`/`onload` 都不会执行，因此不需要消毒库——这正好满足 T12 的「SVG 消毒用例」必含检查，并已有对应 smoke 断言（`asset-capture-ui-smoke-test.js`）。代价是 SVG 内部无法用 `currentColor` 跟随主题。

### 4.4 注入 4 个全局而非 2 个

方案 §8.2 只写 `__ASSETS__` + `__SHARP__`，并让 chat 调 `__ASSETS__.serialize`。实际登记 `__ASSETS__`(store) / `__ASSETS_INDEX__` / `__ASSETS_SERIALIZE__` / `__SHARP__` 四行——比让 store 跨模块再导出 serialize 更清楚。

### 4.5 多出 2 个 lib 文件

方案 §8.1 列了 3 个文件，实际 5 个（+`http.js`、`route-module.js`）。理由：路由文件保持 3 行、处理器可脱离 Next 单测。

### 4.6 `asset://` 裸读取（增强）

`GET /api/assets/<id>` 与 `.../meta` **不要求** `profileId`/`worldId`：缺失时按 id 扫描该账户的 profiles/worlds 反查（带缓存）。这让锚点真正具备超链接语义，前端 `img src` 也不必拼 scope。POST/DELETE/列表仍要求 scope。

### 4.7 配置命名空间

视觉开关放 `set.json` 的 `assets` 块（`assets.visionEnabled` / `maxImagesPerTurn` / `maxImageBytes` / `ocrThreshold`），**默认关**。没有复用 `set.vision`——那已经是 vision 角色模型块，语义会撞。

### 4.8 顺带修的既有缺陷

`Yn`（下课交接历史，module 73909）用 `a.content.trim()`，遇到 blocks 数组会抛错，被 try/catch 吞掉后交接尾巴静默丢失。已在 4 个 definer 全部改为数组容错。

### 4.9 方案事实性纠正

方案 §2 称「前端已有 pdfjs 可渲染教材页面」。实测 `.next/static/**` 里 **0 个** pdfjs/`getDocument` 字符串——pdfjs 只在服务端（`lib/pdf-worker.mjs`、`lib/pdfjs-paths.js`）。因此 T13「教材视图框选 + pdfjs rect 渲染」需要一条服务端出图的路径（`/api/pdf-assets` 可能已可复用），T05 侦察笔记有记录。

---

## 5. 未完成（P1/P2）

T13 教材插图框选与渲染 · T14 前端 SVG 代码块 + 存入索引 · T15 笔记 prompt 图片清单 · T16 笔记 `asset://` 渲染联通 · T17 `/api/assets/<id>/ocr` · T18 `lib/image-gen/` + 预算门 · T19 vision 白名单 + 搜索页。

另：`/api/assets` 的列表接口目前要求 scope，T19 的搜索页需要先定「跨世界列表」语义。

---

## 6. 回滚

```powershell
# 代码层（新文件未被 git 跟踪，可直接删）
Remove-Item -Recurse resources\server\lib\assets
Remove-Item -Recurse resources\server\.next\server\app\api\assets
Remove-Item resources\server\public\asset-capture.js
git checkout -- resources/server/server.js main.js preload.js `
  resources/server/smoke-test-utils.js `
  resources/server/.next/app-path-routes-manifest.json `
  resources/server/.next/routes-manifest.json `
  resources/server/.next/server/app-paths-manifest.json `
  resources/server/.next/server/app/api/chat/route.js `
  resources/server/.next/server/app/api/conversations/route.js `
  resources/server/.next/server/app/api/search/route.js `
  resources/server/.next/server/app/api/stats/route.js `
  resources/server/.next/server/chunks/9654.js `
  resources/server/.next/static/chunks/app/page-87daa6ca210ab9dc.js `
  resources/server/.next/server/app/index.html

# Electron 层
Copy-Item tmp\app.asar.bak resources\app.asar -Force   # 需先关闭应用
node tools\patch-asar-integrity.js
```

`page-87daa6ca210ab9dc.js` 有 4 个同名兄弟副本（`page-3a1fef…`、`page-practice-ui-*`）被 11 个旧 smoke 测试硬编码引用，**不要重命名**。

---

## 7. 已知环境噪声（与本次改动无关）

- `pdf-ocr-priority-smoke-test.js` 偶发失败（3 次中 1 次），队列时序抖动；重跑即过。
- 本机受限令牌下 `fs.symlinkSync` 报 EPERM，测试自动退回 junction；junction 是否被 `lstat` 报成符号链接因 Node/Windows 版本而异，用例已做成自洽断言。
- `TestEnvironment` 需要在 `resources/server/` 下建临时目录；若在 DSH 沙箱内跑，`mkdir` 可能被拒，需放宽权限。
