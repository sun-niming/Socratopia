# 自动推进页级模式死锁修复方案（BUG-0017）

日期：2026-09-26
状态：**阶段一（M1–M5）+ 阶段二（M6）已实施，回归与判别力对照全绿；待真机复测**（见第十节）
编号说明：本方案内文沿用写作时的编号 BUG-0017；`docs/project-reconstruction/04-bug-ledger.md` 里的 BUG-0017 是另一条（thinking→reasoning 链路），**本条在台账中归属 BUG-0016**
范围：`resources/server/lib/reading/auto-advance.js`、`resources/server/lib/progress/kb-progress.js`、三个手写 smoke 测试
明确不动：`.next/` 下一切编译产物（含 `chat/route.js`，只改了其中手写 smoke 测试的断言）、`win-unpacked/` 快照、ASAR

---

## 一、背景与实机证据

2026-09-26 课堂（会话 `l8CSY0K4pq761mzn_LSNy`，教材 KUyw《编译原理 第二版》，648 页，**无 knowledge_base**），窗口 70–75 讲完后无法自动推进。第 851 代权威状态：

| 字段 | 值 | 解读 |
|---|---|---|
| `serverTurnOrdinal` / `lastAdvanceServerOrdinal` | 28 / 19 | delta = 9，正向阈值 12 爬升 |
| `structuredTeachingProgress` | `true` | C5 屏蔽条件成立 |
| `pageOnlyTeachingProgress` | `true` | 页级模式（C3 降级） |
| `windowComplete` / `pendingAdvance` | `false` / `null` | 正常推进通道无票 |
| `lastTaughtPage` | 75 | 已讲到窗口末页（07:49Z 提交） |
| `candidate` | 76–91 已预取 | 下一窗就绪，等不到装载指令 |

日志佐证（`logs/socralab_debug.log`，UTC）：

- 07:49 `页级进度已讲到窗口末页（阶段二未启用，仅观测）` —— 模型已申报讲完，被阶段二开关拦下；
- 07:24 / 07:59 两次 `marker rejected: taught_page_outside_loaded_range { reportedPage: 76, loadedRange: '70-75' }` —— 模型申报下一页被整单拒收；
- 09-25 11:47 同一会话已命中一次 `[C5-未修复]`（delta=12），09-23~25 另有 3 个会话命中同款告警 —— **这是循环复发的结构性疾病，不是偶发**。

## 二、根因链（三个断点 + 一个被测试固化的错误语义）

自动推进只有三条触发路径（`beginTurn`，auto-advance.js:1230-1238），对无 KB 教材**全部堵死**：

**断点 1（核心）：`completeTurn` 无条件置位架空 C3 设计。**
C3 阶段一的设计意图是页级模式**不置** `structuredTeachingProgress`，给 C5 阈值兜底留活路（auto-advance.js:717-721 注释明写 "deliberately left as-is"）。但 auto-advance.js:1419：

```js
if (input.requiresTeachingProgress === true) conversation.structuredTeachingProgress = true;
```

chat 路由对**每个 PDF 课堂回合**都传 `requiresTeachingProgress: !_advanceIsMarkdownLike`（route.js:917，PDF 恒为 true）。于是页级模式第一轮就把 C5 屏蔽开关置上，`shouldForce`（auto-advance.js:1233，要求 `structuredTeachingProgress !== true && delta >= 12`）永远不成立。该值还会投影进 `progress_state.json`（:558）并在播种时读回（:479、:626），一旦置位终身免疫。

**断点 2：阶段二开关关闭正常推进通道（刻意保留，非新漏洞）。**
`PAGE_LEVEL_WINDOW_COMPLETE_ENABLED = false`（kb-progress.js:25）→ 页级 `windowComplete` 恒为 false（kb-progress.js:601-602）→ `commitTeachingProgress` 永不创建已验证 `pendingAdvance`（auto-advance.js:1450）。

**断点 3：页级校验器拒收"窗口末页+1"申报，模型无任何合法方式表达"讲完了"。**
`validatePageMarker` 要求 `lastTaughtPage ∈ [loadedStart, loadedEnd]`（kb-progress.js:591-592）。模型讲完后自然申报 76，整单拒收（marker 里的 windowComplete 声明一并丢弃）。报 75 被阶段二忽略，报 76 被拒 —— 死锁。

**被测试固化的错误语义**：`chat-teaching-progress-format-smoke-test.js:116` + :167 断言 PDF 回合后 `structuredTeachingProgress === true`，把断点 1 的行为当成了协议正确性（"persist the expected requiresTeachingProgress protocol value"）。**协议标志与 C5 门闩是两种语义，被压在了同一个布尔上**：

- 协议语义："本会话走教学进度协议" —— 应按回合记录，已有 `turn.requiresTeachingProgress`（:1399）承担；
- 门闩语义："本会话有已验证的概念级进度，阈值换窗危险" —— 应只在概念 marker 验证通过后置位。

## 三、设计原则

1. **最小爆炸半径**：只改两个手写库文件 + 手写测试；编译产物零改动 → 无需 64092 多定义同步、无需 ASAR 重打包、无需 manifest 哈希更新，重启 `Socratopia.exe` 即生效。
2. **禁止硬编码**：不引入任何教材/会话特判；新偏移量用命名常量；复用既有阈值与字面量约定（`"page_only"` 等已散见各处的字面量保持原样，不趁机重构）。
3. **语义归位**：`structuredTeachingProgress` 只表达"已验证概念进度存在"，协议归属由 `turn.requiresTeachingProgress` 表达。
4. **存量自愈**：已中毒状态（flag=true + page_only）在下一次正常流程中自动修复，不写一次性迁移脚本、不手改用户数据。
5. **纵深防御**：门闩判定与状态疗愈双管齐下，任一层失效另一层仍兜底。
6. **可回滚**：每个改动点给出精确撤销锚点；阶段三由既有开关控制，默认仍关。

## 四、修改方案（分阶段）

### 阶段一：语义拆分与存量自愈（核心，必须）

**M1 — 删除无条件置位**（auto-advance.js:1419）

删除 `if (input.requiresTeachingProgress === true) conversation.structuredTeachingProgress = true;` 整行。
概念进度的置位由 `applyTeachingProgress` 概念分支既有语句承担（:740 `conversation.structuredTeachingProgress = true;`），语义归位为"首个已验证概念 marker 落库时才关门"。

影响面分析：
- **KB 教材、marker 正常**：首个概念 marker 提交时置位，C5 行为与现状完全一致；
- **KB 教材、marker 持续验证失败**：flag 保持 false，delta≥12 时 `shouldForce` 放行阈值换窗 —— 这是**有意的行为变更**：与"无限期停窗重演 KUym 跳读"相比，阈值兜底是设计内逃生口；`hold` / 显式意图 / `advanceBlocked`（:1400）仍然优先拦截；
- **markdown/qbook**：路由本就传 false，该行从未触发，零差异；
- **页级教材**：C5 兜底复活，断点 1 修复。

**M2 — 页级分支显式清除（状态自愈）**（auto-advance.js:717-721）

`applyTeachingProgress` 的 `page_only` 分支改注释并加一行：

```js
if (progress.progressMode === "page_only") {
  // Positioning only: no concept ids, no completed-concept bookkeeping.
  // Page-level progress can never produce a validated concept marker, so the
  // C5 gate must stay open: clear any legacy/poisoned structured flag here
  // (heals states written before BUG-0017, including pre-fix projections).
  conversation.structuredTeachingProgress = false;
  conversation.pageOnlyTeachingProgress = true;
  ...
```

下一个页级 marker 提交时，中毒会话的 flag 被清除，投影（:558）随即将 `progress_state.json` 回写为 false —— 存量自愈，无需迁移脚本。该行与 :740 的置位互为幂等逆操作，模式翻转（page_only ↔ kb）时最后提交的 marker 决定终态，无中间撕裂（同在 `commitTeachingProgress` 的 `withLock` 临界区内）。

**M3 — 播种路径页级优先（加载自愈）**（auto-advance.js:626）

```js
// 改前
if (progress.structuredTeachingProgress === true) conversation.structuredTeachingProgress = true;
// 改后：page_only 投影里的 structuredTeachingProgress 是 BUG-0017 的遗留
// 矛盾态，播种时不予采纳（页级模式不可能存在已验证概念进度）
if (progress.structuredTeachingProgress === true && progress.progressMode !== "page_only") conversation.structuredTeachingProgress = true;
```

幂等：`loadOrMigrate` / `recover` / `repairProjectionState` 重复执行不累积副作用。

**M4 — 门闩判定加页级豁免（纵深防御第二层）**（auto-advance.js:1233-1234）

```js
// 改前
var shouldForce = !hold && !intent && conversation.structuredTeachingProgress !== true && delta >= 12;
if (!shouldForce && !hold && !intent && conversation.structuredTeachingProgress === true && delta >= 12) warnStructuredTeachingStall(conversation, delta);
// 改后
var structuredGateArmed = conversation.structuredTeachingProgress === true && conversation.pageOnlyTeachingProgress !== true;
var shouldForce = !hold && !intent && !structuredGateArmed && delta >= 12;
if (!shouldForce && !hold && !intent && structuredGateArmed && delta >= 12) warnStructuredTeachingStall(conversation, delta);
```

即使 M2/M3 的自愈尚未发生（例如模型停发 marker、flag 残留），门闩仍对页级会话放行 —— 当前中毒的 KUyw 会话**无需等待任何 marker，下一轮 delta 到 12 即可恢复阈值换窗**。C5 告警条件同步收窄，不会对已放行的会话误报。

**M5 — 更新固化错误语义的测试**（`chat-teaching-progress-format-smoke-test.js`）

- :116 的 PDF 用例期望由 `true` 改为 `false`（无 marker 的 PDF 回合不再武装 C5 门闩），断言文案同步改为"conversation 级门闩不因协议回合置位"；
- 新增一条断言：同回合 `turn.requiresTeachingProgress === true`（协议语义仍在回合级持久化）；
- markdown/qbook 用例（期望 false）不变；`auto-advance-teaching-state-machine-smoke-test.js:712` 的既有断言（"page-only progress does not arm the C5 gate by itself"）保持为真并扩展覆盖 completeTurn 路径（见第六节 S1）。

### 阶段二：页级 marker 的"窗口末页+1"接纳（信号通道，建议）

**M6 — `validatePageMarker` 新增钳制分支**（kb-progress.js:591 之前）

模块级命名常量（禁硬编码）：

```js
// A page report exactly one past the window end, paired with an explicit
// windowComplete claim, is the model's only way to say "this window is done"
// in page_only mode (BUG-0017). Anything further out remains a rejection.
var WINDOW_END_SIGNAL_PAGE_OFFSET = 1;
```

在 :591 的越界拒签前插入归一化：

```js
var normalizedFromPage = null;
if (lastPage === loadedEnd + WINDOW_END_SIGNAL_PAGE_OFFSET && marker.windowComplete === true) {
  normalizedFromPage = lastPage;
  lastPage = loadedEnd; // 钳制进窗口，后续 reachedWindowEnd / 回退守卫走既有逻辑
}
if (!lastPage || lastPage < loadedStart || lastPage > loadedEnd) {
  return reject("taught_page_outside_loaded_range", pageDetail); // 原有行为不变
}
```

`pageDetail` 增加 `normalizedFromPage: normalizedFromPage`（沿用 BUG-0016 的"拒签可诊断"约定）；接受时在返回 decision 中带 `normalizedFromPage`，`commitAssistantProgress` 打一条 one-shot 观测日志（复用 `warnOnce` 桶），便于核对模型申报习惯。

安全边界（逐条都是硬约束，不是启发式）：
- 只接纳 `loadedEnd + 1`，`+2` 及以上维持拒签 —— 防静默跳页；
- 必须同时显式声明 `windowComplete: true` —— 09-26 07:24 那种"窗口中段误报 76"（recordedPage 71）不会被放大成跳窗，因为该申报不带完成声明；即便带了声明，后果也仅是"窗口提前判完"，pendingAdvance 链路还有信封/版本/回合四重校验（auto-advance.js:107-116）；
- 回退守卫（:597-599）对钳制后的值照常生效；
- 概念分支（:515-521）与练习模式分支（:724-727）**不动** —— 概念链路有队列可校验，不存在"无法表达讲完"的困境。

### 阶段三：开放页级 windowComplete（可选，开关控制，默认仍关）

**M7 — 翻转 `PAGE_LEVEL_WINDOW_COMPLETE_ENABLED` 为 `true`**（kb-progress.js:25）

仅在阶段一+二上线、且观测日志满足下列条件后执行：
- `页级进度已讲到窗口末页` 观测条目中的 reportedPage 分布集中在窗口末页 ±1；
- `taught_page_regressed` 拒签频率不高于当前基线（09-23~26 约每日数次）；
- M6 的归一化观测日志显示 end+1 申报均伴随真实窗口尾部教学。

开启后链路：marker(75 或 76+windowComplete) → `decision.windowComplete = true`（:601-602）→ `commitTeachingProgress` 创建已验证 `pendingAdvance`（auto-advance.js:1450-1472）→ 下一轮 `beginTurn` 走 `pending_pre_turn` 正常换窗 —— 不再依赖 12 轮阈值兜底，推进节奏与 KB 教材对齐。回滚只需把开关改回 `false`。

### 阶段四：完成信号词表加固（可选，启发式，不作正确性依赖）

`completionSignal`（auto-advance.js:1367-1372）的正则不覆盖模型实际措辞"这一屏到这儿就讲完了"（要求"部分/窗口/小节"等名词）。可补充 `这一屏|讲到这儿|就讲完了` 等词表项。注意：该信号只影响 completeTurn 时刻的**乐观** pendingAdvance（未验证，:1415），阶段三开启后真正起决定作用的是 `commitTeachingProgress` 的验证路径 —— 词表是体验加固，不是正确性依赖，本阶段可不做。

## 五、并发与一致性检查（四遍独立过检）

**第一遍：锁覆盖。**
全部改动点（M1: completeTurn 临界区、M2: commitTeachingProgress 临界区、M3: loadOrMigrate/播种、M4: beginTurn 临界区、M6: commitAssistantProgress 纯函数校验）均位于既有 `withLock(scope, …)` 或调用方持锁的路径内；**不新增任何锁外状态写、不新增文件写**。M6 是纯函数内计算，无共享可变状态。

**第二遍：原子性与幂等。**
- M2 的清除与 marker 应用同处一次 `commitManifest`，要么全落要么全不落，无半态；
- `commitTeachingProgress` 的 `teachingProgressHash` 幂等（:1438-1441）：同一 marker 重复提交直接返回快照，M2 清除不会重复执行，也不会与首次应用产生不同终态；
- 回放路径（:1385 `turnState === "COMPLETED"` 直接返回）不经过 M1 删除点，重放不产生新副作用；
- M3 播种疗愈幂等，recover/repair 反复执行结果收敛。

**第三遍：共享状态隔离。**
- 单 manifest 多会话（KUyw 当前 7 个会话）：所有改动均为 per-conversation 字段，不触碰 `state.scope` / `state.owner`；`commitManifest` 整体原子写，会话间无字段级串扰；
- `progress_state.json` 是多会话共享投影且带 `sourceConversationId` 属主标记：M2 只在页级会话投影时回写 false；概念会话（若有）投影路径未经 page_only 分支，互不影响；投影与 kb-progress 写同一文件的 EPERM 竞争已由 `atomicWrite` 有界重试覆盖（BUG-0012 方案），本方案不新增写点；
- 模式翻转竞态（KB 构建完成使 page_only → kb）：两个分支幂等互逆，同一锁内最后提交者胜出，无撕裂。

**第四遍：竞态窗口。**
- `beginTurn` 与 `completeTurn` 的先后交错由信封版本（baseReadingVersion / causalConversationRevision / parentAssistantMessageId，:1214-1223）与 executor 租约（:1386-1387）保护，本方案不触碰；
- `pendingAdvance` 四重校验（turnId / serverTurnOrdinal / baseReadingVersion / conversationId，:107-116）不变；M6 不改变 pendingAdvance 的创建时机，只改变 `progress.windowComplete` 的取值；
- prefetch candidate 的 `baseReadingVersion` 校验不变；阶段三开启后 pendingAdvance 驱动的换窗复用既有 candidate 装载分支，无新竞态；
- `structuredStallWarned` 每窗一次的语义不变（换窗清零），M4 收窄告警条件后不会出现"已放行仍告警"或"该告警不告警"的错位。

## 六、其他链路安全保护

| 链路 | 保护措施 |
|---|---|
| KB 概念课堂 | 概念校验分支零改动；:740 置位保留 → 有概念进度的会话 C5 门闩语义逐字节不变（S3 回归断言） |
| markdown / qbook | 路由传 `requiresTeachingProgress: false`，M1 删除的行从未为其触发；格式 smoke 测试期望不变 |
| PDF 精读（close-reading） | 隔离链路，不读写 teaching progress，零接触 |
| 课后/续聊（end-class-commit、companion-continuity、long-context） | 已全库 grep `structuredTeachingProgress`：消费方仅 auto-advance 自身与 2 个手写测试，无隐藏读者；`progress_state.json` schema 不变（字段保留，值可能为 false） |
| 前端 | `publicSnapshot` 字段不变；SSE 事件流不变 |
| win-unpacked 快照 | 按 AGENTS.md 约定不同步、不修改 |
| 编译产物 / ASAR / release-runtime-manifest | 零接触，无需重打包、无需哈希更新 |

## 七、验证计划

**静态**：`node --check` + acorn 解析三个改动文件（auto-advance.js、kb-progress.js、chat-teaching-progress-format-smoke-test.js）。

**新增/更新 smoke 场景**（落在 `auto-advance-teaching-state-machine-smoke-test.js` 与 kb-progress 既有测试，必要时新增 `auto-advance-page-only-gate-smoke-test.js`）：

- S1：页级会话连续 `completeTurn(requiresTeachingProgress=true)` 无 marker → flag 保持 false；delta 到 12 → 下一次 `beginTurn` 产出 `threshold_pre_turn` 换窗；
- S2：播种中毒态（`structuredTeachingProgress: true` + `progressMode: "page_only"`）→ 加载后门闩即放行（M4）；下一个页级 marker 提交后 flag 清除且投影回写 false（M2/M3）；
- S3：KB 会话概念 marker 提交 → flag 置 true → delta≥12 无阈值换窗且 C5 告警恰好一次（回归既有语义）；
- S4：end+1 + `windowComplete: true` → 接受并钳制到 loadedEnd，`normalizedFromPage` 落 detail；阶段二开关临时置 true 时 `decision.windowComplete === true` → pendingAdvance 已验证 → 下一轮 `pending_pre_turn`；
- S5：end+1 无 `windowComplete` 声明 → 维持 `taught_page_outside_loaded_range` 拒签；
- S6：end+2 及以上 → 维持拒签；
- S7：回退守卫（76→73 之类）维持拒签；
- S8：同一 marker 重复提交 → 幂等 no-op，flag 终态一致。

**既有测试矩阵**（全部必跑；`.next/` 下的按 AGENTS.md 手跑）：
`auto-advance-smoke-test`、`auto-advance-race-smoke-test`、`auto-advance-teaching-state-machine-smoke-test`、`auto-advance-window-recovery-smoke-test`、`auto-advance-protocol-bundle-smoke-test`、`auto-advance-atomic-write-retry-smoke-test`、`kb-progress-smoke-test`、`kb-progress-sse-smoke-test`、`progress-guard-smoke-test`、`chat-teaching-progress-format-smoke-test`（手跑）、`chat-end-class-integration-smoke-test`（手跑）、`chat-reading-window-truncation-smoke-test`（手跑）、`jump-page-ocr-route-smoke-test`（手跑）。

**实机验证**：备份 KUyw 第 851 代 manifest → 部署重启 → 继续该课程 → 预期 delta 到 12 时出现 `threshold_pre_turn` 换窗至 76–91（candidate 已预取）；观察不再出现 `taught_page_outside_loaded_range { reportedPage: 76 }` 整单拒收（阶段二生效后）。

## 八、回滚锚点

- M1：恢复 auto-advance.js:1419 整行；
- M2：删除 page_only 分支的 `conversation.structuredTeachingProgress = false;` 并还原注释；
- M3：:626 还原为不帯 `progressMode` 条件的原式；
- M4：:1233-1234 还原为原两行，删除 `structuredGateArmed` 局部变量；
- M5：测试期望还原 `true` 并删除 turn 级断言；
- M6：删除钳制分支与 `WINDOW_END_SIGNAL_PAGE_OFFSET` 常量、detail 新字段与观测日志；
- M7：`PAGE_LEVEL_WINDOW_COMPLETE_ENABLED` 改回 `false`。
全部回滚后重启应用即恢复旧行为；已写入状态的 `structuredTeachingProgress: false` 是合法值，旧代码按原语义读取（页级会话将回到 C5 屏蔽状态，即回到本方案修复前行为，无额外风险）。

## 九、上线顺序

1. 阶段一（M1–M5）+ 阶段二（M6）同批部署，开关保持 `false` → 立刻解除死锁（阈值兜底复活 + 信号通道打通）；
2. 观察 ≥ 3 个完整窗口的日志（观测指标见 M7 前置条件）；
3. 阶段三翻开关 → 推进节奏与 KB 教材对齐；
4. 阶段四按需要再做。

---

## 十、实施记录（2026-09-26）

**已实施：阶段一（M1–M5）+ 阶段二（M6），阶段三开关保持 `false`。** 未动任何编译产物、ASAR、manifest、`win-unpacked/`。

### 10.1 改动清单

| 编号 | 位置 | 改动 |
|---|---|---|
| M1 | `auto-advance.js` `completeTurn` | 删除 `if (input.requiresTeachingProgress === true) conversation.structuredTeachingProgress = true;`，替换为说明 BUG-0017 的注释块 |
| M2 | `auto-advance.js` `applyTeachingProgress` 的 `page_only` 分支 | 新增 `conversation.structuredTeachingProgress = false;`，注释改写为"页级窗口永不产生已验证概念 marker，门闩必须保持敞开" |
| M3 | `auto-advance.js` `mergeLegacyTeachingProgress` | 采纳条件加 `&& progress.progressMode !== "page_only"` |
| M4 | `auto-advance.js` `beginTurn` | 新增 `structuredGateArmed` 局部变量并用于 `shouldForce` 与 C5 告警条件；页级会话豁免门闩 |
| M4' | 同上 + `warnStructuredTeachingStall` | 日志 tag `[auto-advance][C5-未修复]` → `[auto-advance][C5]`；`cause`/`background` 文案改写到修复后的事实，detail 增加 `pageOnlyTeachingProgress` |
| M5 | `.next/.../chat-teaching-progress-format-smoke-test.js` | 拆成两条断言：`turn.requiresTeachingProgress` 用原期望（协议语义仍在回合级），新增"conversation 级门闩不得由协议标志武装" |
| M6 | `kb-progress.js` `validatePageMarker` | 新增模块常量 `WINDOW_END_SIGNAL_PAGE_OFFSET`、`windowEndSignalObservations` 桶；越界判定前归一化 `loadedEnd + 1` 且显式声明 `windowComplete` 的申报；`pageDetail`/decision 带 `normalizedFromPage`；提交时打一次观测日志 |

### 10.2 与原方案的偏差（均为等价或更保守）

1. **M5 的落法**：原打算把 PDF 用例的期望从 `true` 改成 `false`，实施时改为"两条断言拆开"——`runFormatCase` 的参数含义变成"该格式是否走教学进度协议"（pdf `true` / markdown `false` / qbook `false`），调用点一个没动，且同时锁住两种语义。
2. **M4 的日志文案**：原方案的 `[C5-未修复]` tag 在修复后自相矛盾，故改为 `[C5]`（`grep "\[C5"` 对历史日志仍连续）；文案里"由 requiresTeachingProgress 的回合置位"这句正是被 M1 删掉的行为，同步改写。
3. **M6 的观测点**：日志只放在真正写入的分支（`write !== false`），用于观测模型申报习惯；`validatedOnly` 路径不打。
4. **`markerDirective` 未动**：页级指令仍只说"页码须落在已加载窗口内"。是否要告诉模型"可以报窗口末页+1"留待观测日志读数后再决定。

### 10.3 新增测试与判别力（先红后绿，逐条实证）

`auto-advance-teaching-state-machine-smoke-test.js` 新增 4 个场景（13 → 18 个），`kb-progress-smoke-test.js` 新增 9 条断言。判别力用"临时回退单个改动点 → 对应断言先红"验证，不是事后补测：

| 场景 | 断言要点 | 回退哪一处会红 | 实测 |
|---|---|---|---|
| S1 `pageOnlyThresholdFallback` | 12 个协议回合全程 `structuredTeachingProgress === false`；第 12 轮以 `threshold_pre_turn` 换窗，`lastAdvanceServerOrdinal` 归 12 | M1 | 红：`a protocol turn alone must not arm the C5 gate (turn 1)` |
| S2a `poisonedPageOnlyKeepsThresholdFallback` | 播种 `structuredTeachingProgress: true` + `progressMode: "page_only"` 的中毒态，第 12 轮仍换窗 | M4 | 红：`a poisoned flag must not block the threshold fallback (turn 12)` |
| S2b `poisonedPageOnlyHealsOnMarker` | 页级 marker 提交后 flag 清除、`pageOnlyTeachingProgress` 保留、`progress_state.json` 回写 false | M2 | 红：`a page-only marker clears the legacy structured flag` |
| S2c `poisonedProjectionHealsOnRepair` | 只把投影重新下毒 → 外部写触发 repair merge → 不重新采纳 | M3 | 红：`the repair merge does not re-adopt a structured flag from a page-only projection` |
| S3 `conceptMarkerStillArmsTheGate` | 概念 marker 仍武装门闩，12 轮不换窗，C5 告警恰好一次 | M1 若误删 `:740` 置位 | 通过（回归） |
| kb 侧 9 条 | end+1+claim 接受并钳制、`normalizedFromPage` 落 detail、stage 2 下 `windowComplete` 为 true、无 claim / end+2 维持拒签、钳制后不越过已记录页、生产提交路径落盘 | M6 | 红：`a window-end+1 report with a completion claim is accepted` |

### 10.4 验证结果

- `node --check` 三个改动文件：通过。
- 相关回归（全 PASS）：`auto-advance-smoke`、`auto-advance-race`、`auto-advance-teaching-state-machine`、`auto-advance-window-recovery`、`auto-advance-protocol-bundle`、`auto-advance-atomic-write-retry`、`kb-progress-smoke`、`kb-progress-sse`、`progress-guard`、`exercise-mode`、`exercise-context`、`jump-page-ocr-route`，以及手跑的 `chat-teaching-progress-format`、`chat-end-class-integration`、`chat-reading-window-truncation`。
- 全矩阵：`node tools/run-smoke-matrix.js` → **total 133 / passed 131 / failed 0 / skipped 2**（与 V-10 基线一致，零回归；2 个 skip 为需要 fixture 的 pdf 测试）。

### 10.5 尚未做

- **阶段三（M7）**：开关仍 `false`。前置条件（观测日志读数、`taught_page_regressed` 频率、归一化申报是否伴随真实窗口尾部教学）需实机积累。
- **阶段四词表**：未动。
- **真机复测**：KUyw 第 851 代 manifest 备份 → 部署重启 → 继续该课程，预期 delta 到 12 出现 `threshold_pre_turn` 换窗至 76–91（candidate 已预取），且不再出现 `taught_page_outside_loaded_range { reportedPage: 76 }` 整单拒收。**本轮只做到"代码 + 测试"，应用尚未重启。**

---

## 十一、附录：阶段三（M7）前置条件的历史数据（2026-09-26 追加）

> 作者：另一个会话，**只读日志**，未改代码。数据源 `%APPDATA%/socratopia/logs/socralab_debug.log`（2026-09-01 ~ 2026-09-26，只取带时间戳的行）。
> §10.5 把阶段三的开启条件定为"观测日志读数、`taught_page_regressed` 频率、归一化申报是否伴随真实窗口尾部教学"。本附录能从历史日志里量到的部分先给出，**不能替代重启后的真机复测**。

### 11.1 计数

| 现象 | 次数 | 命中会话数 |
|---|---|---|
| `[auto-advance][C5]` 阈值推进被屏蔽告警 | 14 | **11 个不同会话** |
| `[kb-progress][C3]` 教材没有可用的概念卡队列（页级降级） | 41 | **17 个不同会话** |
| `页级进度已讲到窗口末页（阶段二未启用，仅观测）` | 14 | — |
| `marker rejected: taught_page_regressed` | 15 | — |
| `marker rejected: taught_page_outside_loaded_range` | 9 | — |

**判读**：命中面覆盖 11 / 17 个会话，**不是边缘路径**——"结构性复发、不是偶发"（§一）成立。

### 11.2 关于 M6（末页+1 接纳）的直接证据

`reportedPage` / `loadedRange` 只在 2026-09-25 加入 `detail` 之后才有。**9 次里只有 2 次带 detail，而这 2 次全部是 end+1**：

```
2026-09-26  reportedPage=76  loadedRange=70-75
2026-09-26  reportedPage=76  loadedRange=70-75
```

即：在可观测的样本里，`taught_page_outside_loaded_range` 的**唯一成因就是 end+1**，没有出现"模型乱跳很远"。这与 M6 的设计取舍（只钳制 `end+1`、`end+2` 仍拒签以保住"静默跳页可见"）一致——钳制面不会过宽。

**但样本只有 2 次**，且都来自同一会话同一窗口。**不能据此宣布"outside_range 全是 end+1"**。

### 11.3 对阶段三的判读（谨慎版）

- 阶段三要把 `windowComplete` 交回给"模型显式声明"，前置是**该声明可信**。
- 现有数据能支持的是：`end+1 + 显式 windowComplete` 这个形态确实出现，且不伴随乱跳。
- 现有数据**不能**支持的：这些声明是否总是伴随真实窗口尾部教学（需要 M6 的 `windowEndSignalObservations` 日志读数，该日志 2026-09-26 17:44 之后才存在，且尚无样本）。
- 另需注意：阶段三开启前，`pageOnly` 窗口实际靠**阶段一的阈值兜底**换窗（delta≥12），M6 只提供观测；开启后两者并存，需确认不会同时触发导致连跳。
- `taught_page_regressed` 15 次 / `outside_range` 9 次的比例说明：**"往回报"比"往前报过头"更常见**，阶段三对 regressed 无影响（钳制后仍走回归守卫）。

### 11.4 建议

1. 先按 M6 的观测日志攒够样本（目标：≥10 条 end+1+claim），再判阶段三。
2. 攒样本期间正好覆盖"阶段一/二上线后的真机复测"（delta 到 12 应出现 `threshold_pre_turn` 换窗、不再出现 `reportedPage: 76` 整单拒收）。
3. 阶段四词表可留到阶段三决策之后。
