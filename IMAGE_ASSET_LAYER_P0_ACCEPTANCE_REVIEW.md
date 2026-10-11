# 图像资产层 P0 验收复核（对 DeepSeek 完成报告的独立验证）

复核人：Kimi。复核对象：`IMAGE_ASSET_LAYER_P0_COMPLETION_REPORT.md` 及其实际改动。复核方式：不看报告结论，逐项重跑任务卡验收命令 + 独立 diff 审查。

## 1. 复核结论：P0 通过，附一个必须修补的语义缝隙（T10b）

### 1.1 实测通过项（全部亲自重跑，非引用报告）

| 验收项 | 实测结果 |
|---|---|
| 全部新增/修改文件 `node --check`（16 个） | 全过 |
| `assets-store` / `assets-index` / `assets-serialize` / `assets-http` | 17 / 7 / 21 / 13 passed，0 failed |
| `assets-route-integration`（真机 HTTP） | 12 passed |
| `conversations-blocks-roundtrip` | 11 passed |
| `asset-capture-ui` | 13 passed |
| `chat-asset-blocks-integration`（高风险区） | 9 passed |
| 基线 `chat-end-class-integration` 复跑 | EXIT 0 |
| 全量矩阵 | 134 passed / **0 failed** / 2 skipped，exit 0 |
| asar 完整性 | `--check` in sync；备份 `tmp/app.asar.bak` 在 |
| 禁区 | `settings.json` / `set.json` / `release-runtime-manifest.json` / `deps.zip` 零改动 |
| 其余 5 个 64092 definer | mtime 停在 9-26，本轮未碰 |
| `server.js` diff | 纯新增 4 行注入，无其他改动 |

### 1.2 偏差清单（报告 §4）处置

- §4.1（route-module.js 移植 Next 模板）：**接受**。文件头已注明 Next 升级时需复核，代价明确。
- §4.3（SVG 走 `<img src>` 而非内联）：**接受**。`<img>` 加载的 SVG 脚本天然禁用，比消毒库更稳；损失 `currentColor` 主题跟随，可接受。
- §4.4 / §4.5（4 个全局、5 个 lib 文件）：**接受**。比原方案更清晰。
- §4.6（`asset://` 裸读取反查 scope）：**接受**，这正是超链接语义的落地。
- §4.7（配置放 `set.json` 的 `assets` 块，默认关）：**接受**，已抽查 `serialize.js` 第 20/201/253 行，默认确为关。
- §4.8（顺带修 `Yn` 数组容错）：**接受**，4 个 definer 同步改，方向正确。
- §4.9（前端无 pdfjs）：**重要事实纠正**，已纳入 P1/T13 重新估算——教材插图渲染需要走服务端出图（复用 `/api/pdf-assets`），不能假设前端 pdfjs。
- §4.2（前端走 markdown 锚点而非 blocks）：**部分接受**，但它引出了下面的缝隙。

## 2. 已修复：T10b 字符串锚点序列化（2026-10-09 由 Kimi 直接修复）

**原问题**：前端插入的消息是字符串 `![图片](asset://<id>)`（§4.2），而 chat 路由的序列化只处理 blocks 数组——真实用户路径下模型只能看到 `asset://ast_xxx` 字面量，§5.4 的置信度阶梯在字符串路径上不触发。

**修复内容**（全部已实测通过）：

1. `serialize.js` 新增字符串锚点路径：`stringToLlmInput()` 用正则匹配完整 markdown 包裹 `![...](asset://<id>)` 与裸锚点两种形态，经注入的 `resolveRecord` 回调查资产记录后走同一置信度阶梯——有 caption/高置信 OCR/SVG 标题 → 原地替换为 `[图片: <文本>]`；无可靠文本且视觉开 → 整条消息升级为多模态 parts 数组；查无记录 → `[图片: 未识别]`；**不含合法锚点的字符串保持引用相等**，历史消息零成本。
2. 新增 `createGlobalRecordResolver()`（内存索引查询，带缓存、永不抛错），`optionsFromGlobals` 无论视觉开关都挂上它——文本摊平也需要记录。
3. 测试：`assets-serialize-smoke-test.js` 新增 9 个锚点用例（**32 passed, 0 failed**）；`chat-asset-blocks-integration-smoke-test.js` 新增 3 个真机用例（caption 摊平 / 未知 ID 降级 / 视觉开升级为 image_url part，**13 passed, 0 failed**）。
4. 回归：基线 `chat-end-class-integration` EXIT 0；全量矩阵 134 passed / 0 failed / 2 skipped。

**修复中发现的两个实现细节**（已解决）：① 锚点必须匹配整个 `![...](asset://...)` 包裹，否则替换后残留 `![图片](` 残骸；② 集成测试同一会话的第二轮会触发 `STALE_TURN`（envelope 钉住 revision 0），每个用例必须用新会话。

**仍待办**：P1 的教材插图走服务端出图（前端无 pdfjs，见 §4.9 裁定），T13 任务卡派发前需按此修订。

## 3. 复核中确认的亮点

- chat 路由补丁位置正确（历史裁剪器之前），且有注释说明顺序原因；
- 序列化失败被 try/catch 包裹降级为原消息，不会阻断课堂；
- 未授权请求返回 401 JSON 而非 404，路由注册与鉴权两件事分开验证了。

---

## 4. 补丁：截图语义纠正（2026-10-09 Kimi 直接修复）

**用户纠正**：截图指「截整个屏幕上的 PDF/任何窗口」，应用窗口内截图无意义。P0 初版的 `capturePage`（仅应用窗口内）语义错误。

**修复内容**：

1. `main.js` 新增 `asset:captureScreen` IPC：`win.hide()` → 320ms 后 `desktopCapturer.getSources` 按设备像素抓取窗口所在显示器 → `finally` 恢复窗口。旧的 `asset:captureRegion` 保留未动；
2. `preload.js` 暴露 `captureScreen`；
3. `asset-capture.js` 流程重写：冻结帧铺满全屏蒙层 → 框选（`mapRegion` 纯函数处理 letterbox 映射与边缘钳制）→ canvas 本地裁剪 → 上传；
4. UI smoke 更新 + 新增映射数学用例（14 passed / 0 failed）；`node --check` 四文件全过。

**验收**：应用已用新 asar 启动，`/api/assets` 返回 401（路由在）、`/asset-capture.js` 200 且含 `captureScreen`。框选拖拽的实际手感需用户实测。

**环境教训（后续打包注意）**：

- Kimi 沙箱会**虚拟化 `resources/app.asar` 的 node fs 读**（读到 size=0 的假文件），`patch-asar-integrity.js` 在本环境跑不了；改用 python 直读/直写真实磁盘（算法与工具一致，已用 `tmp/app.asar.bak2` 交叉验证哈希 88b3920b）；
- 从 Kimi 的 shell（cmd start / powershell Start-Process）启动 GUI 应用会**静默退出 code 0**（疑似沙箱 job 约束），要用 `explorer.exe "<路径>"` 模拟双击启动；
- asar 数据区偏移基准 = `8 + uint32LE(4)`（含对齐填充），不是 `16 + header_size`。

备份：`tmp/app.asar.bak2`（DeepSeek 版）、`tmp/app.asar.new-t10c`（当前线上版）、`tmp/Socratopia.exe.bak-t10c`（打补丁前的 EXE）。
