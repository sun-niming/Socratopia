# 自动推进（auto-advance v2）窗口修复改动清单

日期：2026-09-11
范围：C1（快照定位头）、C2（空窗口重载）、C4（跳页窗口落库 + prefetch 预算 + EPERM 重试）、C3 阶段一（页级进度降级，见第七节）
保留未修：C5（结构化进度开关屏蔽阈值推进）——仅保留现象日志与原因/背景/危害说明

---

## 一、背景：2026-09-11 KUym 第 13 章跳读事件

学习者问「跳跃这么快吗，不从 13.1 开始讲是有什么理由吗」。复盘结论（实机状态 + 日志）：

- 窗口权威副本（163–192，30,845 字符）**每一轮 prompt 都在**，12.6/12.7/13.1–13.4 的页标记 p175–189 无缺口 → **不是截断**；
- 模型却从 p174（12.5）直接跳到 p190（13.5），跳过 p175–189；
- 机械成因三条：① KUym 没有 `knowledge_base/` → 所有进度标记被 `empty_queue` 拒绝 → `lastTaughtPage` 永远为空 → 投影反复把「当前学习页码」报成窗口起点 163；② 历史 `structuredTeachingProgress=true` 关掉了唯一的兜底换窗触发器（delta ≥ 12）；③ 30k 字符无框 OCR 正文既无「你在这里」也无章节骨架。

本清单修的是 ①③ 中可安全修复的部分（定位框架、空窗口、跳页落库），②（C3/C5）按要求**保留不修、只留日志**。

## 二、现象与根因

| 现象 | 根因 |
|---|---|
| 会话 `xTl_QQfSq3RSON8sIKJh5`（33 轮）、`y1QoNR9Qf4M7_1USWLp0Q` 的权威窗口只有 38 字符（`<!-- startPage: N endPage: M -->`） | `conversationSeed` 在 `current_reading.md` 为空/缺失时用 `wrapRange("")` 播种，产生「有范围、无正文」的空窗口；`recover` 只比对一致性，永远修不到它 |
| 模型 `read_textbook_pages` 拉取的 171–183 页（14,727 字符）在 10:20:14 写入后被 10:20:34 的 `recover(reason:"external_legacy_mutation")` 隔离回滚 | 聊天路由**从不调用 `commitRange`**（route.js 0 命中）；工具仍按 v1 习惯写投影文件，v2 把它当外部篡改 |
| prompt 只给模型 `[AUTHORITATIVE READING SNAPSHOT v2]` + 原始窗口，没有任何位置/边界说明 | 快照头只有一行英文标签；`lastTaughtPage` 未暴露到 `publicSnapshot` |
| 每轮 `background prefetch failed: ocr_request_deadline` | 预取预算 30s，PDF 下一窗口 OCR 常态超时 |
| `[kb-progress] post-response progress save failed: EPERM … rename` | `kb-progress.atomicWrite` 单次 `renameSync`，与 auto-advance 对同一 `progress_state.json` 的写入在 Windows 上互相占锁 |

## 三、改动（逐文件，含回滚锚点）

### 1. `resources/server/lib/reading/auto-advance.js`（手写文件）

**(C4) 新助手**（`wrapRange` 之后）：

```js
function rangeBody(content) { ... }                    // 去掉首行范围注释后的正文
function adoptableExternalReading(content) { ... }     // 合法范围头 + 非空正文才可采纳
```

**(C4) recover 不再直接丢弃外部窗口**（`markProjectionClean` 与 `recover` 之间新增）：

```js
function stashExternalReading(paths, state, conversationId, ownerPaths) { ... }
function readPendingExternalReading(paths, conversation) { ... }
```

`recover` 中原 `readingChanged || progressChanged || indexChanged` 分支改为：

```js
if (readingChanged || progressChanged || indexChanged) {
  if (readingChanged) stashExternalReading(paths, state, conversationId, ownerPaths);
  return repairProjectionState(ownerPaths, state, conversationId, "external_legacy_mutation").state;
}
```

外部写入的窗口被存成 blob（`kind="external"`）并记入 `conversation.pendingExternalReading`；投影文件照旧被权威副本修复（保留 quarantine 备份与审计），窗口本身**不丢**。

**(C4) beginTurn 采纳**：`transition` 的优先级改为

```js
var pendingExternal = readPendingExternalReading(paths, conversation);
var transition = intent;
if (!transition && pendingExternal) transition = { type: "page", page: pendingExternal.startPage, reason: "external_window_adopted" };
if (!transition && (shouldCommitPending || shouldForce)) transition = { type: "next", reason: ... };
```

装载分支优先复用暂存正文（**不重新 OCR / 不重新抽取**）：

```js
if (transition.reason === "external_window_adopted" && pendingExternal && pendingExternal.startPage === targetStart) {
  loaded = { content: pendingExternal.content, startPage: pendingExternal.startPage, endPage: pendingExternal.endPage };
} else if (conversation.candidate && ...) { ... } else { loaded = await input.loadRange(...) }
```

采纳在 `beginTurn` 内、**信封版本校验之后**发生，因此不会让客户端撞 `STALE_TURN`；`readingVersion` 正常 +1，快照随响应回传。`markTextbookComplete` 与 `if (loaded)` 分支会清空 `pendingExternalReading`（避免教材完结后被暂存窗口复活）。

**(C2) 空窗口重载**：`conversationWindowEmpty()` + `canFinalizeTextbook` 之后：

```js
if (!transition && typeof input.loadRange === "function" && conversationWindowEmpty(paths, conversation)) {
  var emptyStartPage = Number(conversation.loadedRange && conversation.loadedRange.startPage) || 1;
  transition = { type: "page", page: emptyStartPage, reason: "empty_window_reload" };
  console.warn("[auto-advance] authoritative window is empty; reloading the current range", {...});
}
```

空窗口用 `loadedRange.startPage`（实机即 104 / 176，不是 1）经正规 `loadRange` 重载；blob 损坏时也走这条路自愈。

**(C1) 暴露已讲位置**：`publicSnapshot().readingRange` 新增 `lastTaughtPage`，取值口径与 `projectConversation()` 一致——`lastTaughtPage || taughtCursor.startPage`，且**只在该页码落在当前窗口内（或窗口为 loadedOnly 跳页窗口）时上报**，否则为 `null`。这样陈旧的历史页码不会冒充「当前窗口内的位置」，定位头会如实说「尚未记录」。

**(C5，仅日志)** `warnStructuredTeachingStall(conversation, delta)`：当 `structuredTeachingProgress === true && delta >= 12 && !hold && !intent` 且 `shouldForce` 被屏蔽时打一条
`[auto-advance][C5-未修复] 阈值自动推进被结构化进度开关屏蔽（仅记录，本次不修复）`，带 `cause / background / harm / workaround` 字段；每个窗口只打一次（`structuredStallWarned`，换窗时清零）。**行为未改**。

`conversationSeed` 新增默认字段 `pendingExternalReading: null`、`structuredStallWarned: false`。

### 2. `resources/server/.next/server/app/api/chat/route.js`（编译产物）

**(C1)** 新增模块级函数 `_readingSnapshotPreamble(_turn,_lang)`（插入在 `Close Reading 不改变普通课堂教学进度。";` 之后、`let adaptiveCore=...` 之前），按 `chinese / chinese-traditional / english` 输出四行定位头：

```
[本课教材窗口 v2 · 权威且不可变]
窗口：第 163–192 页（共 30 页，教材共 412 页）。
窗口之外没有任何教材内容——更早的页和更晚的页都不在你眼前。
本节尚未记录已讲到的页码（进度标记未生效）。不要假设自己停在窗口开头，请依据最近对话和页内页码标记判断当前位置。
如需查看窗口外的页，请调用 read_textbook_pages（若本轮工具列表中没有它，请明说需要先加载对应页）；不要凭印象讲你看不到的内容。
```

有 `lastTaughtPage` 时第三行换成「本节已确认讲到：第 N 页。」。`_turn` 缺失时回落到原英文标签，行为与旧版一致。

拼接点（原样 → 新样）：

```js
// 改前
_readingSnapshot&&(b+="\n\n---\n\n[AUTHORITATIVE READING SNAPSHOT v2 — use this exact immutable window]\n"+_readingSnapshot)
// 改后
_readingSnapshot&&(b+="\n\n---\n\n"+_readingSnapshotPreamble(_advanceTurn,X)+"\n"+_readingSnapshot)
```

传给 `Ex(...)` 的 `_readingSnapshot` 仍是**原始窗口**，`_dupReading`（文件 === 窗口）判等逻辑不变，中段不会重复注入。

**(C4)** 预取预算 30s → 90s，并把失败日志改为可读文案：

```js
// 改前
prefetchCandidate({...,timeoutMs:3e4}).catch(_error=>console.warn("[auto-advance] background prefetch failed:",...))
// 改后
prefetchCandidate({...,timeoutMs:9e4}).catch(_error=>console.warn("[auto-advance] background prefetch failed (candidate window unavailable; the next advance loads it in the foreground):",...))
```

### 3. `resources/server/lib/progress/kb-progress.js`（手写文件）

**(C4)** `atomicWrite` 增加有界重试（EPERM/EACCES/EBUSY，10 次，20–200ms 退避，用 `Atomics.wait` 同步等待）；其它错误码立即抛出。

**(C3，仅日志)** 新增模块级 `emptyQueueWarnings` 与 `warnEmptyQueue(textbookId, conversationId)`，`validateProgressMarker` 的 `if (!queue.length)` 改为先告警再 `reject("empty_queue")`：

```
[kb-progress][C3-未修复] 进度标记被拒：教材没有可用的概念卡队列（empty_queue，仅记录现象，本次不修复）
  cause: validateProgressMarker 在 queue.length === 0 时直接 reject；队列来自 textbooks/<id>/knowledge_base/index.json 与 cards/*.json
  background: 该教材未构建知识库（或构建/蒸馏失败，DeepSeek 思考预算耗尽是已知诱因之一），因此队列为空
  harm: lastTaughtPage / windowComplete 永远无法提交 → 教材定位缺失；PDF 的 pendingAdvance 永远无法通过验证（KUym 第 13 章事件的成因之一）
```

每个（教材, 会话）只打一次，**行为未改**。

### 4. 新增测试

`resources/server/lib/reading/auto-advance-window-recovery-smoke-test.js`（3 场景）：

1. 空窗口 → 恰好一次 `empty_window_reload`，从 `loadedRange.startPage` 加载并把正文写进投影；
2. 外部写窗口 → `readSnapshot` 不立刻改窗口（先暂存），下一次 `beginTurn` 采纳且**不调用** `loadRange`；`pendingExternalReading` 恰好消费一次；
3. 无范围头的损坏文件 → 仍走 quarantine + 从权威 blob 恢复，不进入暂存。

## 四、保留未修（C5；C3 于同日追加修复，见第七节）

| 编号 | 现象 | 为什么不修（本次） | 日志落点 |
|---|---|---|---|
| C3 | 无 `knowledge_base/` 的教材，所有 `kbProgress` 标记被 `empty_queue` 拒绝 → 无 `lastTaughtPage`、无 `windowComplete`、PDF 无 `pendingAdvance` | **阶段一已修复**（页级进度降级，见第八节）；阶段二（页级 `windowComplete`）默认关闭，待观测 | `[kb-progress][C3] 教材没有可用的概念卡队列，已切换为页级进度模式…`（每教材/会话一次，含 cause/effect/stage2） |
| C5 | `structuredTeachingProgress === true` 永久屏蔽 `delta >= 12` 的兜底换窗；30 页/30k 字符窗口超出可靠注意力 | 直接放开阈值会改变所有会话的推进节奏，且改不好会重演第 13 章式跳读；需要先观察 C1/C2/C4 生效后的实际表现 | `[auto-advance][C5-未修复]`（每个停滞窗口一次，含 cause/background/harm/workaround） |

C5 的判定代码分支未改动，只有日志新增；C3 的判定分支已按第八节改造。

## 五、验证

已通过（2026-09-11）：

- `node --check` + acorn：route.js、auto-advance.js、kb-progress.js
- `auto-advance-window-recovery-smoke-test`（新增）、`auto-advance-smoke-test`、`auto-advance-race-smoke-test`、`auto-advance-teaching-state-machine-smoke`（13 场景，含新增页级进度 SSE 全链路场景）、`auto-advance-protocol-bundle-smoke-test`
- `kb-progress-smoke-test`（含新增页级降级用例）、`kb-progress-sse-smoke-test`、`progress-guard-smoke-test`
- `chat-reading-window-truncation-smoke-test`、`jump-page-ocr-route-smoke-test`

## 六、生效与回滚

- **生效**：服务端原地加载，重启 `Socratopia.exe` 即可（无需重打包 ASAR）。
- **回滚**：三个文件本会话之前就带有未提交改动（思考开关、截断修复），**不建议直接 `git checkout`**，否则会一起丢。请按上面的锚点逐处撤销：
  - route.js：删除 `_readingSnapshotPreamble` 函数体并还原拼接片段；`timeoutMs:9e4` 还原为 `3e4`；日志文案还原。
  - auto-advance.js：删除 `rangeBody`/`adoptableExternalReading`/`stashExternalReading`/`readPendingExternalReading`/`conversationWindowEmpty`/`warnStructuredTeachingStall`；`recover` 分支去掉 `if (readingChanged) ...`；`beginTurn` 还原 `var transition = intent || (...)` 单行形式并删除空窗口分支与采纳分支；`publicSnapshot` 去掉 `lastTaughtPage`；`conversationSeed` 去掉两个新字段。
  - kb-progress.js：`atomicWrite` 还原为单次 `renameSync`；C3 相关的新增日志与分支见第七节回滚锚点。
- 回滚后重启应用即恢复旧行为；已产生的 `pendingExternalReading` 字段只是 JSON 里的多余键，旧代码会忽略。
- C3 阶段一/阶段二（2026-09-11 追加）的回滚锚点见第七节末尾。

## 七、C3 阶段一修复（2026-09-11 追加）：无知识库教材的页级进度降级

### 背景

第 13 章事件的直接成因之一：KUym 教材没有 `knowledge_base/`，`validateProgressMarker` 在 `queue.length === 0` 时直接 `reject("empty_queue")`，导致 `lastTaughtPage` 永远无法提交、`windowComplete` 永远为 false、PDF 的 `pendingAdvance` 永远无法通过验证。原判定把「从未建过 KB」和「KB 数据损坏」压成同一种情况，且伴随的提示词要求模型填写空的 `activeConceptId`——模型无论照做还是编造都会被拒。

### 设计

把「概念级进度」与「页级进度」拆开：概念卡队列是掌握度的尺子，无 KB 时只信任**位置**，不伪装成概念。

`loadQueue` 现在返回 `mode`：

| mode | 判定条件 | 处理 |
|---|---|---|
| `kb` | `build_status` 允许且队列非空 | 原有概念校验，零改动 |
| `page_only` | 无 `knowledge_base/`，或 `build_status.state !== "done"` / `activationEligible === false` | 走 `validatePageMarker` 页级校验 |
| `kb_broken` | `build_status` 标 done 但 `index.json`/`teaching_map.json` 缺失，或卡片全部对不上 | 维持拒签（`empty_queue`），避免掩盖真实故障 |

页级校验规则（`validatePageMarker`）：沿用头部检查（marker/textbookId/sourceConversationId/loadedRange）；`lastTaughtPage` 必须落在窗口内；同一课内不得回退（窗口整体前移时解除）；**忽略一切概念字段**；`windowComplete = 模型声称讲完 && lastTaughtPage >= 窗口末页`，且默认被阶段二开关屏蔽。

### 改动点

**`resources/server/lib/progress/kb-progress.js`**

1. `warnEmptyQueue` 拆成三个 one-shot 日志：`warnPageOnlyMode`（C3 降级说明）、`warnKbUnavailable`（kb_broken 拒签说明）、`notePageWindowCompleteCandidate`（阶段二观测：已讲到窗口末页但开关未启用）。
2. 新增阶段二开关（默认关闭，见下方回滚锚点）：`var PAGE_LEVEL_WINDOW_COMPLETE_ENABLED = false;`
3. `loadQueue` 返回值新增 `mode`（见上表）。
4. 新增 `validatePageMarker(marker, opts)`；`validateProgressMarker` 在 `queue.length === 0` 时按 `opts.mode` 分派：`page_only` → 页级校验，否则告警 + `empty_queue`。
5. `commitAssistantProgress`：把 `mode`/`allowWindowComplete` 传入校验；`decision.progressMode === "page_only"` 时只写 `progressMode:"page_only"`、`lessonStartPage`、`lastTaughtPage`、`currentPage`、`windowComplete`、页级 `taughtCursor`（`chunkId:"page-N"`, `reason:"validated_page_marker"`）与 `loadedCursor`，**不写**任何概念字段、不写 `textbookComplete`；概念分支补写 `progressMode:"kb"`。
6. `prepareProgressContext` 返回 `progressMode`；`markerDirective` 新增页级提示词分支（要求 `lastTaughtPage` + `windowComplete`，不再提 `activeConceptId`）；`requestWithProgressDirective` 传递模式并触发降级日志。
7. `transformSseResponse` 的权威交棒 payload 新增 `progressMode: committed.progressMode || "kb"`。

**`resources/server/lib/reading/auto-advance.js`**

1. `normalizeTeachingProgress`：`progressMode === "page_only"` 时不要求 `activeConceptId`，清空概念字段，`textbookComplete` 仍由 `windowComplete && atKnownEnd` 决定。
2. `applyTeachingProgress`：`page_only` 分支只写 `lastTaughtPage` / `windowComplete` / `lessonStartPage` / 页级 `taughtCursor` / `pageOnlyTeachingProgress: true`，**不置 `structuredTeachingProgress`**（C5 语义保持原样），不触碰概念 id。
3. `conversationSeed` 与 `mergeLegacyTeachingProgress` 识别 `progressMode:"page_only"`；`projectConversation` 将 `pageOnlyTeachingProgress` 投影回 `progress_state.json`（旧的 `progressMode` 不主动伪造）。

### 阶段二（默认关闭）

`PAGE_LEVEL_WINDOW_COMPLETE_ENABLED = false`。开启后，页级标记在 `lastTaughtPage >= 窗口末页` 时报告 `windowComplete: true`，无 KB 教材的 `pendingAdvance` 才能通过验证。开启前请依据 `[kb-progress][C3] 页级进度已讲到窗口末页（阶段二未启用，仅观测）` 日志判断模型上报的页码是否可信。

### 回滚锚点

- **阶段一**：`kb-progress.js` 中 `loadQueue` 还原为单一返回（删除 `mode` 字段与 `kb_broken` 分支）；删除 `validatePageMarker`、`warnPageOnlyMode`、`warnKbUnavailable`、`notePageWindowCompleteCandidate`；恢复 `warnEmptyQueue`；`validateProgressMarker` 的 `!queue.length` 分支还原为「告警 + `reject("empty_queue")`」；`commitAssistantProgress` 删除 `page_only` 写分支与 `progressMode` 字段；`prepareProgressContext`/`markerDirective`/`requestWithProgressDirective`/`transformSseResponse` 删除各自的新增字段与分支。`auto-advance.js` 的 `normalizeTeachingProgress`/`applyTeachingProgress`/`conversationSeed`/`mergeLegacyTeachingProgress`/`projectConversation` 删除 `page_only` 相关分支即可（未知字段对旧代码无副作用）。
- **阶段二**：只需把 `PAGE_LEVEL_WINDOW_COMPLETE_ENABLED` 改回 `false`（保留阶段一），或连同阶段一一起回滚。
- 已写入 `progress_state.json` 的 `progressMode:"page_only"`、页级 `taughtCursor` 与 `lastTaughtPage` 都是合法字段，旧代码会当作普通进度读取，无需清理。

## 八、备注

- 本次改动会让「写入 `current_reading.md` 的合法窗口」在**下一轮**被采纳为权威窗口（原来是被静默回滚）。这是有意的行为变更，用于修复「学习者跳页被系统撤销」。
- 未提交：本仓库当前所有改动仍在工作区，未做任何 commit。
