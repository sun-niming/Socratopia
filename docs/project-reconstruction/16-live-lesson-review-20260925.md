# 最新一节完整课堂的日志复盘（2026-09-25）

> 证据 E-450 ~ E-465。**方法：只读运行日志 + 盘上代码，未启动/未杀进程。**
> 课堂：world `KUyw`，conversation `64KCdn4ZqCUX29tk2G4Hq`，图 74 条消息，`08:20Z–10:42Z`（本地 16:20–18:42）。
> 同一日志窗口内还有更早一段 `05:34Z–07:59Z`（conversation `08-LAhcx2TqyRZC3rFx-6`），`08:06Z` 应用重启。

## 0. 结论速览

| 判定 | 项 |
|---|---|
| ✅ **修复有效** | **全课 0 次 EPERM**；修复后累计 **115 轮 / 0 次**（修复前 255 轮 / 25 次 = 9.8%，泊松 p≈1e-5） |
| 🔴 **新 BUG-0014（高）** | **思考（thinking/reasoning）注入对当前模型全线失效**，且**护栏全部落空** |
| 🟠 新 BUG-0015（中） | `lesson-summary` 连接超时 3 次 + 中断 1 次，对用户无声 |
| 🟠 新 BUG-0016（中） | 进度标记连续 6 轮被拒 → 叠加 C3 页级降级 → 窗口无法推进（C5 现象的原生成因） |
| 🟡 观察 4 条 | 上下文长期超预算 / 窗口恒定截断 / 前端 4 分钟轮询 / KB 提炼 238 秒 |

---

## 1. ✅ BUG-0012 验收：通过（这是本节课最重要的正面结论）

- 本节课全程 **`post-response progress save failed` 出现 0 次**。
- 全窗口统计（方向①于 `2026-09-20` 落地，应用其后多次重启，本节运行的是修复后代码，E-441 已核对三处改动仍在盘）：

| 窗口 | 课堂轮次 | EPERM | 失败率 |
|---|---|---|---|
| 修复前 | 255 | **25** | 9.8% |
| 修复后 | 115 | **0** | 0.0% |

  按 9.8% 期望应出 ~11 次，实测 0 → **泊松 p ≈ 1.2e-5**。且唯一失败项 `textbook_index.json` 全课未被拒绝过一次。
- **仍未完全定案**：样本虽强，但只有 4 天。**建议再观察一周**，并把"失败时延不再聚在 1255ms"作为二重确认。
- 附带：`[auto-advance] read snapshot failed: EPERM`（09-14 出现过 3 次）本节也 **0 次**。

> 归因保留：同时段还有别的不确定变化（模型/端点换成 gpt-5.6、`set.json` 调整），
> 但那些都在 09-23 才发生，而修复前后的分界是 09-20，方向上不冲突。**"已证实修复有效"证据充分。**

---

## 2. 🔴 BUG-0014 思考注入对当前模型全线失效，且防"烧 token"护栏一起落空

### 2.1 现象（日志）
```
[chat] thinking=enabled applied=false model=gpt-5.6-terra     ← 每一轮都这样
[callLLM] thinking=disabled applied=false model=gpt-5.6-sol
```
按日统计 `applied`：

| 日期 | applied=true | applied=false | 模型 |
|---|---|---|---|
| … ~ 09-22 | 全部 | 0 | deepseek* |
| 09-23 | 9 | **27** | 混杂（切换当天） |
| 09-25 | **0** | **52** | 全 gpt-5.6-terra |

### 2.2 根因（已定位到表达式）
`resources/server/.next/server/app/api/chat/route.js`：
```js
...l?.thinking!==void 0 && (console.log("...applied="+/^deepseek/i.test(String(b||""))+" model="+b),
   /^deepseek/i.test(String(b||"")))
   ? { thinking: { type: l.thinking ? "enabled" : "disabled" } } : {}
```
**`applied` 就是字面量 `/^deepseek/i.test(model)`；不匹配时整个 `thinking` 字段被省略。**
模型于 09-23 换成 `gpt-5.6-terra` → 判据恒 false → **`thinking` 再没被发过**。

### 2.3 第二层：`/responses` 协议根本不吃 `thinking`
本次所有 chat 都被改写走 Codex `/responses`（`[responses-compat] Codex model routed directly to /responses`）。
而 `lib/responses-api-compat.js` 里 **没有任何 `thinking` 处理**，只认：
```js
if (body.reasoning !== undefined) result.reasoning = body.reasoning;
else if (body.reasoning_effort !== undefined) result.reasoning = { effort: body.reasoning_effort };
```
→ 即使把判据放开，**发 `thinking` 也不会到达 `/responses`**，必须发 `reasoning` / `reasoning_effort`。

### 2.4 真正的危害：护栏一起失效（比"少思考"更严重）
盘上有 3 处**手写**护栏，注释写得明明白白是防"reasoning 吃光 max_tokens → content 空串"：
- `lib/llm-gateway.js`：`if (/^deepseek/i.test(route.model)) payload.thinking = { type: "disabled" }`
- `lib/kb-builder-coordinator.js`：同上（"按最终 model 兜一层"）
- `lib/kb-builder.mjs`：同上（"与 callLLM 的处理保持一致显式关闭"）

判据同样是 deepseek-only → **换模型后这三道护栏全部不生效**，即
**"默认思考的模型 + JSON 任务 + 不给 thinking"** 这个已知致命组合重新变成了裸奔状态。

> 讽刺的是：同一个对象字面量里**紧邻**就有一段 `^gpt-5\.6` 特判（给 gpt-5.6 加 `prompt_cache_key`/`prompt_cache_retention`）——作者已经知道要为新模型特判，**只漏了 thinking 这一支**。

### 2.5 影响面（改动要动 7 个文件）
`/^deepseek/i` 出现在 **7 个模块 64092 的定义文件**（`chunks/1576.js`、`chunks/4092.js`、5 条 route：`chat`/`concept-summary`/`flashcard`/`companion/reconcile-persona`/`custom-companions/merge-persona`，每个 2 次）＋ 上述 3 个 lib。
→ 这正是 CLAUDE.md 记的"LLM 核心有多处重复定义，改一处必漏"的老问题，**必须 7 处全覆盖**。
建议改法：把判据从"模型名"改成"模型能力"（例如 `set.json` 里加 tier→是否支持 reasoning 的声明，或改成"目标是 deepseek 或 responses 协议时改用 reasoning 字段"），别再写死模型名。

### 2.6 症状尚不显著？——需要查
截至本节，`concept-summary` 的 `LLM response length: 0` / `parse failed` 在本窗口**未出现**（历史上 09-11/09-15 出现过）。
合理推断：`gpt-5.6-terra` 走 `/responses` 时网关默认可能并不开 reasoning，所以暂时没炸；**但护栏本来就是为"模型默认开思考"准备的，属于定时炸弹**。待确认（Q-056）。

---

## 3. 🟠 BUG-0015 `lesson-summary` 连接超时，对用户无声

本窗口 4 次失败，全部集中在第一段（05:38 / 05:42 / 05:46 / 06:33）：
```
[lesson-summary] Error: [TypeError: fetch failed]
  [cause]: Error [ConnectTimeoutError]: Connect Timeout Error
    (attempted address: api.nwafu-ai.cn:443, timeout: 10000ms)
  code: 'UND_ERR_CONNECT_TIMEOUT'
```
- **10 秒连接超时**打在 `api.nwafu-ai.cn` 上；同一日志里这条链路还有一次 **238 秒**的 KB 提炼（`elapsed=238327ms`）→ 该主机建连慢/抖动，10s 明显偏紧。
- 第 3 次是 `AbortError`（`chunks/1576.js:25:5389` 的 `Timeout._onTimeout`），即客户端主动超时。
- **没有任何用户可见提示**（只落在 `[Next:err]`）。
- 历史同形错误可追到 09-07 / 09-08。
- 待办：连接超时与总超时分开调（建连给 30s），失败要冒泡给前端。

---

## 4. 🟠 BUG-0016 进度标记连续被拒 → 降级页级 → 窗口无法推进

### 4.1 现象
第一段课堂 **连续 6 轮**（05:34 → 05:49，每轮一次）：
```
[kb-progress] marker rejected: taught_page_regressed
```
第二段在 08:51 出现一次 `marker rejected: taught_page_outside_loaded_range`。
历史变体还有 `completed_card_still_active`、`non_contiguous_completion`、`two-check cap reached`。

### 4.2 降解链（本节完整走通了一遍）
```
marker rejected（进度标记被否）
      ↓
[kb-progress][C3] 教材没有可用的概念卡队列，已切换为页级进度模式
   cause: 'loadQueue 找不到可用的 knowledge_base（未构建，或 build_status.state !== done）'
   effect: 'lastTaughtPage / currentPage 现在可以提交，窗口定位头会显示真实页码；windowComplete 仍为 false'
      ↓
[auto-advance] authoritative window is empty; reloading the current range
   note: 'conversationSeed seeded a header-only window from an empty current_reading.md projection'
      ↓
[auto-advance][C5-未修复] 阈值自动推进被结构化进度开关屏蔽   ← 该 tag 已于 2026-09-26 修复时改为 `[C5]`
```
**即：C5"窗口可无限期停在同一段"不是抽象风险，本节就是它的现场。** 且 `[kb-progress][C3] 页级进度已讲到窗口末页` 明明已到达窗口末页（`loadedRange: 40-54`），**却因为阶段二默认关闭而无法提交 `windowComplete`**。

### 4.3 判读
- `taught_page_regressed` 的语义是"模型报的页比已记录的小"。连拒 6 轮说明**模型报页与记录位长期不一致**——可能是窗口定位头缺失导致模型自行跳读（正是 C5 注释里写的 `2026-09-11 KUym 第 13 章跳读` 同源），也可能判据过严。
- 这是**功能性**缺陷（不是崩溃）：用户感觉不到，但换窗/进度推进靠它。
- 待办：把 `taught_page_regressed` 的**双方页码**打出来（现在只有一行光秃秃的 rejected，无法定案）——这是当务之急，成本极低。

---

## 5. 🟡 观察项（未必是 BUG，但值得记录）

| # | 现象 | 数据 | 说明 |
|---|---|---|---|
| O-1 | **上下文长期超预算** | 第一段每轮 `[ctx-budget] over budget: snapshot=42060>28000 sysPLen=57621`；单 `stable=50113` 就已超过 28000 | 超 50%。第二段 `sysPLen=36141 / snapshot=20758` 仍偏大 |
| O-2 | **窗口恒定被截断** | 每轮 `[pdf-ocr] contiguous window capped at targetChars { targetChars: 20000, contiguousChars: 20280~21047 }` | 连续窗口总是略超 2 万，恒定触发截断 |
| O-3 | **前端 4 分钟高频轮询** | `[concept-summary] POST action=status` 每 ~9s 一次，07:55:39→07:58:45 共 26+ 次 | 课后笔记生成期间；两次以 `stage=degraded score=0.8575/0.909` 收尾 |
| O-4 | **KB 提炼 238 秒** | `[kb] 收到响应 status=200 elapsed=238327ms`；`distill still running after 3500ms, foreground falls back to raw text (p.55-67)` | 前台先降级到原文兜底，最终后台提炼出 13 张卡。作者已有兜底，属设计内，但 238s 说明链路慢 |
| O-5 | `[Next:err]` 前缀滥用 | 本窗口 312 行里绝大多数是**信息级**日志却打 stderr | 复盘时极易误判"满屏错误" |

---

## 6. 本轮**没有**发现问题的方面（避免只报坏消息）

- **无 EPERM**（见 §1）。
- **无鉴权异常**：`[concept-summary] auth: hosted=true hasKey=true model=gpt-5.6-sol` 正常；无 401/`auth_missing`。
- **无空 content / JSON 截断**：本窗口未出现 `LLM response length: 0` 或 `parse failed`。
- **无路径越界/403 报错**，所有 `profileId/worldId/conversationId` 前后一致。
- **日志不泄漏 API key**（只有 `API key supplied`）。
- **无崩溃/未捕获异常**：整节课没有 `FATAL`。

---

## 7. 建议优先级

1. **BUG-0014**（高）：先查 `gpt-5.6-terra` 在 `/responses` 上的默认 reasoning 行为（Q-056），再决定是"补 `reasoning` 字段"还是"改判据为能力声明"。**注意 7 处重复定义要全覆盖。**
2. **BUG-0016 的可观测性**（低风险、高收益）：把 rejected 的双方页码打进日志，才能定案。
3. **BUG-0015**：连接超时 10s→30s；失败要传给前端。
4. **O-1**：`sysPLen` 57621 对 28000 预算持续超标，宜单独出一份上下文预算专题。
5. BUG-0012 再观察一周后收口。

## 8. 证据
E-450 log 末条 `2026-09-25T10:42:55Z`；课堂窗口 `08:06:36Z`（重启）→ `10:42:55Z`，共 312 行
E-451 全窗口 `post-response progress save failed` = **0**；最近一次为 `2026-09-18T08:44:49Z`
E-452 前后对照：修复前 255 轮/25 次(9.8%)，修复后 115 轮/0 次；泊松 p≈1.2e-5
E-453 三处方向①改动仍在盘（`grep` 复核）；应用 `startedAt 2026-09-25T08:06:35Z`
E-454 `applied` 按日统计表（09-22 前 true 100%；09-25 false 52/52）
E-455 `chat/route.js` 中 `applied=/^deepseek/i.test(model)` 原文表达式
E-456 `responses-api-compat` 只映射 `reasoning`/`reasoning_effort`，无 `thinking`
E-457 三处 lib 护栏原文（`llm-gateway.js`、`kb-builder-coordinator.js`、`kb-builder.mjs`）与其"防 reasoning 吃 token"注释
E-458 `^deepseek/i` 命中 7 个 64092 定义文件（各 2 次）+ 3 个 lib
E-459 `lesson-summary` 4 次失败原文（3× `ConnectTimeoutError ... api.nwafu-ai.cn:443 timeout: 10000ms`、1× AbortError@`chunks/1576.js:25:5389`）
E-460 6 次 `taught_page_regressed`（05:34:21/05:36:14/05:38:07/05:42:10/05:45:42/05:49:04）+ 1 次 `taught_page_outside_loaded_range`（08:51:28）
E-461 `[kb-progress][C3]` 完整 JSON（`cause` / `effect` / `stage2` 字段）
E-462 `[auto-advance] authoritative window is empty` 的 `note: conversationSeed seeded a header-only window from an empty current_reading.md projection`
E-463 `[ctx-budget] over budget` 与 `[ctx-trim]` 逐轮数据
E-464 `[pdf-ocr] contiguous window capped` 每轮命中及其数值
E-465 `[concept-summary] POST action=status` 轮询序列与两次 `post-class-notes stage=degraded score=0.8575/0.909`
