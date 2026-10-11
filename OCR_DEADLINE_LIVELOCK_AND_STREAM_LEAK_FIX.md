# `ocr_request_deadline` 死循环 + 新对话流式输出串台：修复清单

日期：2026-10-11
台账编号：**BUG-0021**（OCR 超时死循环）、**BUG-0022**（前端全局流缓冲未按会话隔离）
范围：`lib/pdf-ocr-coordinator.js`（手写）、`app/api/chat/route.js`（编译产物）、`static/chunks/app/page-87daa6ca210ab9dc.js`（前端编译产物）+ 2 个测试

---

## 一、现场（实机取证）

用户报告两件事：

1. 日志里出现 `ocr_request_deadline`；
2. 「给一个新对话发消息、它正在思考时，会干扰一个**已经结束**的对话」。

复盘发现这**不是两件独立的事**，而是同一条链路的两个断面。

### 1.1 新对话永远发不出第一条消息（BUG-0021）

`chats/0f9ZkTS5I1WeySr7dIiVY.json`（教材 `KUyw`）第 1、2、3 轮的 assistant 消息**内容就是字面的错误码**：

```json
{"role":"assistant","content":"\n\n**ocr_request_deadline**","failed":true,"notAccepted":true}
```

时间线（`logs/socralab_debug.log`）：

| 时刻 | 事件 |
|---|---|
| 06:42:45.060 | `[conversations] DELETE id=AbC0ESqv…`（旧对话删除，读窗口文件被 unlink） |
| 06:42:52.636 | `[kb-progress][C3] …页级进度模式`（新对话第一轮开始） |
| 06:42:52.647 / .661 | 两次 generation 提交 —— **owner 切到新对话** |
| 06:42:52.669 | `[auto-advance] authoritative window is empty; reloading the current range`（startPage 150） |
| ⏳ 静默 **精确 120.0s** | ← `beginTurn` 在 `await input.loadRange(...)` 上撞 OCR 围栏 |
| 06:44:52.661 | 才走到 `[assets] figure catalogue`（这一轮已经被判死） |
| 06:45:52.608 | 第二轮：**同样的空窗口重载**，同样 120.0s，同样失败 |
| 06:47:52.627 | 第三轮：同上 |

`conversations/0f9Zk…/current_reading.md` 始终停在 **38 字节**（`<!-- startPage: 150 endPage: 179 -->` + 换行，只有范围头、没有正文），`.reading-state-v2` 里该会话 `turns:{}`。

### 1.2 为什么是「死循环」而不是「只是慢」

两处叠加：

1. **围栏只有 120s**：`app/api/chat/route.js` 的 `_captureOcrRequestFence(a,12e4)` 是整轮 OCR 请求的 deadline，`beginTurn` 拿它当 `deadlineAt`。冷缓存下 30 页窗口（`extract_adaptive`, maxPages 30, 每批 6 页）的 OCR 撞上它，抛 `ocr_request_deadline`，`beginTurn` 整体回滚。
2. **已完成批次被整单丢弃（关键）**：`lib/pdf-ocr-coordinator.js` 的 `execute()` 把每批 OCR 结果只推进 `pendingCacheWrites`，真正的 `cache.write` 在**批次循环之后**的 `withLifecycleMutation(...)` 里。围栏一到就整单抛出 → **这一轮跑完的批次的 OCR 结果一条都没落盘**。

于是：重试 = 仍然冷缓存 = 仍然在同一秒撞死 = 窗口永远提交不了 = 下一轮仍然 `empty_window_reload`。**不是慢，是每次从零重来。**

### 1.3 「干扰已结束的对话」的两个断面

- **屏幕断面（BUG-0022）**：前端把实时流缓冲（`e_`/`eF`/`eB`/`eW`）放在组件级全局，而消息数组绑定当前激活会话；`tj` 渲染时**无条件**用全局 `streamContent` 替换「当前会话最后一条 assistant 气泡」。所以新对话在 thinking 时，切回旧对话，旧对话最后一条回答被新对话的流式文本顶掉并显示 thinking 光标。
- **数据断面（服务端，本轮未改，已记录）**：auto-advance 是**按教材的单例**（`state.owner` 只有一个会话）。新对话的第一条消息在模型执行前就 `activateOwner()`，重写**共享**的 `textbooks/<id>/progress_state.json` 与 `textbook_index.json`；新对话又从这份共享文件播种，于是拿到的是别人（旧对话）的页码 + 38 字节空壳窗口。`recover()` 对非 owner **故意不重投影**，所以旧对话的共享投影在被重新打开前不会自愈。

---

## 二、改动

### 2.1 `resources/server/lib/pdf-ocr-coordinator.js`（手写，BUG-0021 主修）

`execute()` 的 OCR 批次循环内新增局部 `mergeRecognizedPages()`：

- 每批结束**立刻**把该批识别结果折进 `pages`（质量评估口径与原来逐字一致）并把可用页写进 OCR 缓存；
- 写入成功即从 `pendingCacheWrites` 摘除，尾部 `withLifecycleMutation` 只补写残项（不会重复写）；
- 抛出 `ocr_request_deadline` / `ocr_request_aborted` 之前先 `await mergeRecognizedPages()`，保证「已经跑完的批次」不随异常蒸发；
- 循环 `break`（`ocr_timeout`）与循环结束后各再调一次，并给仍未解析的页补 `windows_ocr_failed`，保持与旧实现「每个缺失页都有 error」的语义一致。

### 2.2 `resources/server/.next/server/app/api/chat/route.js`（编译产物）

```js
// 改前
let _ocrFence=_captureOcrRequestFence(a,12e4);
// 改后
let _ocrFence=_captureOcrRequestFence(a,18e4);
```

围栏 120s → 180s，使它从「主限」变成「兜底」：此时 `execute()` 内部的 120s OCR 预算会以 `ocr_timeout` **优雅降级**（返回部分页、状态 `processed_with_failures`）而不是整单抛错，`beginTurn` 因此能提交窗口，`empty_window_reload` 不再每轮重来。

### 2.3 `resources/server/.next/static/chunks/app/page-87daa6ca210ab9dc.js`（前端编译产物，BUG-0022）

1. 新增状态 `[_streamConvId,_setStreamConvId]=(0,n.useState)(null)`（挂在 `[e_,eM]` 之后）。
2. `r7`（主发送函数）在解析出目标会话 `r` 之后立刻 `_setStreamConvId(r);`。
3. 聊天面板 `tj` 的 props 按「流式会话 === 当前显示会话」限流：

```js
// 改前
isStreaming:e_&&!SocratopiaGenerationDone,streamContent:eF,streamToolUses:eB,streamMood:eW,…
isPreparingLesson:e_&&eB.some(…)
// 改后
isStreaming:e_&&!SocratopiaGenerationDone&&_streamConvId===q,
streamContent:_streamConvId===q?eF:void 0, streamToolUses:_streamConvId===q?eB:void 0,
streamMood:_streamConvId===q?eW:void 0, …
isPreparingLesson:e_&&_streamConvId===q&&eB.some(…)
```

4. `r7` 的 `finally` 不再无条件清空共享槽：

```js
// 改前
}finally{eY(),eM(!1),SocratopiaSetGenerationDone(!0),tT(!1),eO(""),eK.current="",
  eH.current=0,eU([]),eq("calm"),ro.current=null}}
// 改后
}finally{var _ownerStream=ro.current===l;
  if(_ownerStream){eY(),eM(!1),SocratopiaSetGenerationDone(!0),tT(!1),eO(""),
    eK.current="",eH.current=0,eU([]),eq("calm"),ro.current=null}
  _ownerStream&&_setStreamConvId(_prev=>_prev===r?null:_prev)}}
```

即：只有仍是「最新一次发送」才回收共享状态，避免先结束的那次掐掉仍在跑的另一次的 `onStop` / 流式显示。

> 组合框（composer）的 `disabled:e_` 与 `isStreaming` 保持全局语义不变：屏幕上有人正在生成时应继续禁用输入、并允许 Stop 打断正在跑的那一路。

**未改**：`an`（跳页）/`ai`（下课）/`as`（AI 代答）不过 `e_` 闸门的并发入口是**刻意保留**的——加 `if(e_)return;` 会吞掉跳页消息；本轮改为让"后完成的不破坏先完成的"。

---

## 三、验证

新增/更新测试：

- `resources/server/lib/pdf-ocr-batch-cache-flush-smoke-test.js`（新，3 场景，自洽、无 spawn）：
  1. 第二批以 `ocr_request_deadline` 失败时，第一批 6 页**必须已经在缓存里**；
  2. 紧接着重试：整窗 12 页一次收敛，且已缓存页不重复写；
  3. 全程成功的路径每页**恰好**写缓存一次（防「每批 flush + 尾部再写」重复写）。
- `resources/server/.next/static/chunks/app/llm-generation-lifecycle-smoke-test.js`：原断言 `isStreaming:e_&&!SocratopiaGenerationDone,streamContent:eF` 放行新形态，并新增两条（仅对含 `_streamConvId` 的产物）断言流缓冲已按会话限流、`finally` 有 `_ownerStream` 判定。

已通过（2026-10-11）：

- `node --check` + acorn：三个被改文件
- 新测试 + `pdf-ocr-coordinator(-hardening)`、`pdf-ocr-deadline-race`、`pdf-ocr-priority`（`pdf-ocr-lifecycle`/`pdf-ocr-roundtrip` 在本机沙箱下因 `spawn EPERM` 失败，属环境；非沙箱下见第四节）
- 前端 14 个 `static/chunks/app/*-smoke-test.js` 全绿
- `.next` 下 chat 路由 5 个集成测试（`chat-asset-blocks-integration`、`chat-end-class-integration`、`chat-say-protocol-integration`、`chat-teaching-progress-format`、`chat-voice-emotion-protocol-integration`）非沙箱全绿
- `tools/run-smoke-matrix.js` 全量（见 `outputs/smoke-matrix-after-ocrfix.json`）

> 注意：本机上 **DSH 沙箱会**让所有「用 `child_process` + 管道跑测试」的用例假失败（`spawn EPERM`，`run-smoke-matrix.js` 会把 `status=null` 渲染成 `FAIL null`）。矩阵必须在非沙箱下跑才有意义。

## 四、生效与回滚

- **生效**：server 层原地加载（重启 `Socratopia.exe` 即可）；前端产物需重启应用并刷新页面。均**无需重打包 ASAR**。
- **回滚锚点**：
  - `pdf-ocr-coordinator.js`：删除 `mergeRecognizedPages` 及其三处调用，把循环后的 `byPage` 映射段还原；`catch` 分支还原为 `assertRequestActive(request); if(deadline||aborted) throw error;` 的旧三行。
  - `chat/route.js`：`18e4` → `12e4`。
  - `page-87daa6ca210ab9dc.js`：删掉 `_streamConvId` 状态与 `_setStreamConvId(r);`；props 还原为 `isStreaming:e_&&!SocratopiaGenerationDone,streamContent:eF,streamToolUses:eB,streamMood:eW` 与 `isPreparingLesson:e_&&eB.some(…)`；`finally` 还原为单行无条件清理。
  - 两个测试文件可一并还原（回滚后 `llm-generation-lifecycle` 的原断言会重新生效）。
- 已产生的 OCR 缓存条目、`current_reading.md` 都是常规数据，回滚无需清理。

## 五、遗留（本轮明确未修）

| 编号 | 现象 | 位置 |
|---|---|---|
| BUG-0022-a | AI 代答 `as` 在预流结束时按**当时的** `q` 调 `r7`，期间切会话会写进错的会话（`es(q)`/`Z(q,e)` 也已记在错的会话上） | `page-87daa6ca210ab9dc.js` L820 |
| BUG-0022-b | `__SocratopiaLiveSpeechHints__` 消费者只比对 `messageId`、不比对 `conversationId`（`…Segments__` 是对的） | 同上 L11 消费者 / L803 生产者 |
| BUG-0022-c | `r7` 用闭包里的 `W` 快照（而非已存在的 `conversationRef.current`）做 persist；`addMessage` 的 1500ms 全量覆盖定时器无取消点 → 1.5s 内完成的流可能被陈旧快照写回磁盘 | 同上 L796 / L783 |
| BUG-0023(候选) | auto-advance 是按教材单例：新对话抢 owner 时重写共享 `progress_state.json` / `textbook_index.json`，旧对话的共享投影在重新打开前不自愈；`kb-progress` 对同一文件做无会话守卫的 last-writer-wins 合并；`DELETE /api/conversations` 不交接 owner | `lib/reading/auto-advance.js`、`lib/progress/kb-progress.js`、`app/api/conversations/route.js` |
