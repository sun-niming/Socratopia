# 课后笔记 v2 真机运行报告（2026-09-25）

> 批次 V-8。证据 E-466 ~ E-478。**只读日志与盘上代码，未修改任何业务代码。**
> 编写目的：作为决策输入。全文只陈述观测事实、代码事实与二者之间的可验证连接；不给出优先级判断。
> 全文不含"建议/应当"。
> 同一节课其他功能面的记录见 `16-live-lesson-review-20260925.md`（批次 V-7）；本报告只覆盖课后笔记 v2。

---

## 0. 范围、数据源与方法

**被观测对象**：`/api/concept-summary` 的 v2 实现（`resources/server/lib/post-class-notes/**` + 编译 route + 5 个前端 bundle），运行于 2026-09-25 的一节完整课堂。

**数据源（全部为盘上实物）**

| 类别 | 路径 |
|---|---|
| 运行日志 | `%APPDATA%/socratopia/logs/socralab_debug.log`（1,109,664 B，最后写入 2026-09-25T10:42:55Z） |
| 任务台账（trace / 状态 / 分片证据 / 质量） | `%APPDATA%/socratopia/project-data/accounts/local/profiles/uolmzgq8/worlds/KU/concept-summaries/.jobs/**` |
| 产物笔记 | 同目录下 `<conversationId>.json` |
| 代码 | 仓库内 `resources/server/**` |

**方法**：读日志时间戳；读 `.jobs/**` 的 `job.json` / `trace.jsonl` / `chunks/*.json` / `quality.json`；读产物笔记；代码侧读实现并记录行号。所有时间戳为 UTC（日志原生格式），文件 mtime 为本地时区。

**观测窗口内 job 总数**：4 个（2026-09-21 ~ 2026-09-25）。

---

## 1. 运行事实

### F-01 四个 job 的终态均为 `degraded`，`ready` 数量为 0

| 创建时间 (UTC) | jobId | 会话 | 终态 | degradedReason | 完成/总分片 | 源消息 | 估算 token | trace 行数 | 失败分片 |
|---|---|---|---|---|---|---|---|---|---|
| 2026-09-21T09:18:50Z | `pn_mub19hyneea1325ce058` | `EJCMdZUMLRh0uIgZkHKXm` | degraded | `schema_invalid` | 8/8 | 81 | 24,482 | 79 | 1 片曾失败、后经检查点补齐（见 F-01b） |
| 2026-09-23T11:04:36Z | `pn_mudzx7vv1a1a73eb64ea` | `UnIAcXhoe9v790OuvhEmF` | degraded | `chunk_failures` | 3/8 | 91 | 26,725 | 45 | 001:timeout, 004:network, 006:timeout, 007:timeout, 008:network |
| 2026-09-25T07:55:39Z | `pn_mugo1xde348272667679` | `08-LAhcx2TqyRZC3rFx-6` | degraded | `chunk_failures` | 1/3 | 51 | 9,584 | 23 | 001:network, 002:network |
| 2026-09-25T10:38:34Z | `pn_mugtvfaz01ee98d8950e` | `64KCdn4ZqCUX29tk2G4Hq` | degraded | `chunk_failures` | 3/4 | 73 | 13,349 | 27 | 003:timeout |

失败码取值域：`upstream_timeout`、`upstream_network`（`errors.js` 中的稳定码）。**09-23、09-25T07:55、09-25T10:38 三个 job** 的失败均发生在 `map` 阶段；**09-21 那个**走的是另一条路径（8/8 分片最终齐备，失败出现在 validate → repair 环节），见 F-01b。

### F-01b 09-21 job（`pn_mub19hyneea1325ce058`）的事件剖面（F-01 表格中该行的展开）

源：该 job 的 `trace.jsonl`（79 行）。事件计数如下（全部为实测计数）：

| 事件 | 次数 | 时刻 |
|---|---|---|
| `job_created` | 1 | 2026-09-21T09:18:50.932Z |
| `job_resumed` | 2 | 09-21T09:19:04.564Z、09-22T01:38:58.368Z |
| `job_interrupted` | 1 | —（`failIfStale` 判定） |
| `job_retry_requested` | 1 | 09-22T01:38:58.365Z |
| `partition_completed` | 3 | 每次 resume 重新分片 |
| `chunk_started` / `chunk_completed` / `chunk_restored` / `chunk_failed` | 13 / 8 / 1 / 1 | — |
| `provider_request` / `provider_response` | 18 / 14 | — |
| `output_truncated` | **5** | — |
| `reduce_started` / `reduce_completed` | 1 / 1 | 09-22T01:39:39.202Z |
| `schema_rejected` / `repair_started` | 1 / 1 | 09-22T01:40:07.711Z |
| `repair_failed`（outcome=`output_truncated`） | 1 | 09-22T01:40:33.854Z |
| `schema_unrecoverable` | 1 | 09-22T01:40:33.855Z |
| `quality_decision`(degraded) → `persist_completed` | 1 / 1 | 09-22T01:40:34.0Z |

- 首末事件间隔：**16 小时 21 分**（09-21T09:18:50Z → 09-22T01:40:34Z）。
- 末段路径：reduce 成功 → `schema_rejected` → 一次 repair → **repair 自身返回 `output_truncated`** → `repair_failed` → `schema_unrecoverable` → degraded。
- 该 job 全程 `output_truncated` 出现 5 次。

### F-02 本次 job（`pn_mugtvfaz01ee98d8950e`）完整时间线

源：该 job 的 `trace.jsonl`（27 行）+ 同时段日志。

| 时刻 (UTC) | 事件 | 数值 |
|---|---|---|
| 10:38:34.049 | `job_created` | mode=chunked，73 条有效消息，13,349 估算 token |
| 10:38:34.058 | `partition_completed` | 4 片 |
| 10:38:34.065 | `chunk_started` ×2 | 分片 1、2（`maxConcurrentChunks = 2`） |
| 10:39:54.692 | `provider_response` | 分片 1 成功，**80,621 ms**，prompt 4,311 / completion 3,255，6,719 字符，finish=stop |
| 10:39:54.710 | `chunk_started` | 分片 3 |
| 10:39:59.858 | `provider_response` | 分片 2 成功，**85,789 ms**，prompt 4,328 / completion 3,076 |
| 10:39:59.871 | `chunk_started` | 分片 4 |
| 10:41:24.729 | `provider_error` | 分片 3 首次 **90,018 ms** → `upstream_timeout` |
| 10:41:25.750 | `provider_request` | 分片 3 重试（间隔 1,021 ms） |
| 10:41:29.876 | `provider_error` | 分片 4 首次 **90,004 ms** → `upstream_timeout` |
| 10:41:30.976 | `provider_request` | 分片 4 重试（间隔 1,100 ms） |
| 10:42:50.567 | `provider_response` | 分片 4 重试成功，**79,590 ms** |
| 10:42:55.766 | `provider_error` | 分片 3 重试 **90,016 ms** → 记为 `chunk_failed` |
| 10:42:55.771 | `chunk_failures_settled` | 可用分片 3 |
| 10:42:55.808 | `quality_decision` | decision=degraded |
| 10:42:55.821 | `persist_completed` / `job_degraded` | — |

- 任务总时长：**261 秒**。
- 单次超时配置：`orchestrator.js:44` `mapTimeoutMs: 90000`。
- 三个成功分片耗时（80.6 s / 85.8 s / 79.6 s）距 90,000 ms 的余量分别为 9,379 / 4,211 / 10,410 ms。
- 分片 3 的两次尝试分别为 90,018 ms 与 90,016 ms，差 2 ms。

### F-03 前端轮询

源：日志中该会话的 `POST action=status` 行，共 33 次。

- 第 1→2 次、第 2→3 次间隔均为 1.5 s；此后 26 次为 9.0 s、2 次为 8.0 s、1 次为 8.7 s。
- 前端实现（`tools/patch-post-class-notes-ui.js` 注入）：`delay = Date.now()-started > 30000 ? 3000 : 1500`；`document.hidden` 为真时 `delay = 8000`。
- 32 个间隔中 29 个 ≥ 8 s，与 `document.hidden === true` 分支一致。

### F-04 模型与端点

- `resources/set.json`：`strong.model = "gpt-5.6-sol"`、`strong.group = "gpt"`；`resources/settings.json`：`endpoint = "https://api.nwafu-ai.cn/v1"`。
- 该 job 请求前的 route 日志：`[concept-summary] auth: hosted=true hasKey=true model=gpt-5.6-sol`（10:38:34.043Z）。
- 该 job 期间日志另有 7 行 `[responses-compat] Codex model routed directly to /responses { model: 'gpt-5.6-sol', stream: false }`。

---

## 2. 代码事实

### F-05 请求改写为 `/responses` 的判据

`lib/responses-api-compat.js:37-40`：

```js
function prefersResponses(body) {
  var model = String(body && body.model || "");
  return /^gpt-5\.6(?:-|$)/i.test(model) || /(?:^|[-_.])codex(?:[-_.]|$)/i.test(model);
}
```

`"gpt-5.6-sol"` 命中第一条正则。改写日志由 `postResponsesJson()` 打印（`responses-api-compat.js:589-590`）。

**时间戳对齐**：改写日志 `10:41:25.751Z` 与同刻 `provider_request` `10:41:25.750Z` 相差 1 ms；`10:41:30.976Z` 的改写日志与同类请求同为 `.976Z`。

### F-06 改写函数对 `thinking` 无映射

`responses-api-compat.js:170-171`（`chatRequestToResponses()` 内）：

```js
if (body.reasoning !== undefined) result.reasoning = body.reasoning;
else if (body.reasoning_effort !== undefined) result.reasoning = { effort: body.reasoning_effort };
```

该函数对请求体的处理范围：`model`、`input`、`stream`、`store`、`instructions`、`max_output_tokens`（由 `max_tokens` 兜底，`:159-162`）、`copy` 白名单（`temperature`、`top_p`、`parallel_tool_calls`、`metadata`、`truncation`、`service_tier`、`prompt_cache_key`、`prompt_cache_retention`、`safety_identifier`）、`reasoning`、`tools`、`tool_choice`、`text`。

**`thinking` 不在上述任何一项之内。**

### F-07 我们发出的字段

- `lib/post-class-notes/provider.js:56`：`if (typeof request.thinking === "boolean") body.thinking = { type: request.thinking ? "enabled" : "disabled" };`
- `orchestrator.js:320` 在构造调用请求时传 `thinking: false`。
- `provider.js` 发出的请求体**不含** `reasoning` / `reasoning_effort`。

### F-08 超时的重试策略不含"缩短"

- `errors.js:41`：`RETRY_POLICY[CODES.upstream_timeout] = { attempts: 1, delayMs: 1000, jitterMs: 1000 };`（无 `shortenTarget`）
- `errors.js:46-47`：仅 `upstream_empty_content`、`output_truncated` 带 `shortenTarget: true`。
- `errors.js:157` 将该标志透出；`requestJson()` 仅在 `plan.shortenTarget` 为真时把 `scale` 降为 `limits.tokenScaleOnShorten`（0.7）并追加缩短指令。
- 即：超时后的重试请求与首次在 prompt 与 `max_tokens` 上一致。

### F-09 单个 job 的调用预算判据

- `orchestrator.js:41`：`maxCallsPerJob: 40`。
- `orchestrator.js:273-277` `ensureBudget()`：`if (job.modelCalls >= limits.maxCallsPerJob) throw ...`。
- `orchestrator.js:325`：`job.modelCalls += 1`。
- `job.modelCalls = 0` 只出现在 `:811`（接管已存在 job 的分支）与 `:1021`（`retry()`）。
- **新建 job 的对象字面量位于 `orchestrator.js:817-840`，其中不含 `modelCalls`。**

### F-10 检查点清理器

- `orchestrator.js:1044-1046` 定义 `cleanup(options)`，转调 `store.cleanup(options)`。
- 全仓库检索 `.cleanup(` 仅命中该定义处一行，无调用点。
- `checkpoint-store.js` 中的保留常量：`SUCCESS_RETENTION_MS` = 7 天、`FAILURE_RETENTION_MS` = 14 天、`MAX_JOBS_PER_CONVERSATION` = 5。

### F-11 降级组装的长度处理

- `quality.js:334-335`：`topic.facts … .slice(0, 6)`、`topic.examples … .slice(0, 3)`。
- `assembleDegraded({ evidence, language })` 的入参**不含**目标长度；目标长度由调用方在 `orchestrator.js:404 / :496` 用 `partitioner.visibleTargetRange()` 单独计算，仅服务于 direct 与 reduce 两条路径。

### F-12 job.json 的字段写入

- 本次 job 的 `job.json` 含 `"modelCalls": null` 与 `"runToken": {}`。
- `NaN` 经 `JSON.stringify` 序列化为 `null`；`runToken` 是内存标记对象（`takeOwnership()`），无序列化形态。

---

## 3. 事实之间的连接

以下连接均基于时间戳或代码顺序，可独立复核。

**C-1（超时频次）**：F-02 显示三个成功分片耗时 79.6~85.8 s，配置上限 90 s。四个分片中两个首次撞线，一个重试撞线。F-01 中另两个 job 的失败码同样集中于 `upstream_timeout` 与 `upstream_network`。

**C-2（改写与字段）**：F-05 的判据对当前模型成立；F-06 显示改写函数不处理 `thinking`；F-07 显示我们只发 `thinking`。三者合并意味着：经 `/responses` 的请求体内不含 reasoning 相关字段。F-04 的 7 行改写日志与 F-02 的请求时刻一致，说明本次 job 的 map 请求确实走了该路径。

**C-3（重试形态）**：F-08 显示超时重试不改变请求形态；F-02 显示分片 3 两次尝试耗时 90,018 ms 与 90,016 ms，相差 2 ms。

**C-4（预算失效）**：F-09 显示新建 job 无 `modelCalls` 初值，而 `ensureBudget` 以 `job.modelCalls >= 40` 判定。F-12 的 `"modelCalls": null` 与之相符；F-01 表中三个新 job 均为 `null`，唯一非 `null` 的 job（09-21）走的是 `retry()` 分支。

**C-5（清理未执行）**：F-10 显示无调用点；观测到的 `.jobs/` 下 4 个 job 目录均未被删除。

**C-6（降级产物形态）**：F-11 显示降级组装不接收目标长度；本次降级产出 18 个概念、6,736 可见字符，而 `visibleTargetRange(73, "chinese")` 返回 3,000~4,000，实测 `lengthFitness = 0.269`。

---

## 4. 产物事实

- 笔记路径：`.../concept-summaries/64KCdn4ZqCUX29tk2G4Hq.json`，22,008 B，mtime 2026-09-25 18:42（本地时区）。
- `sections` 构成：`tldr`、`concepts(18)`、`notes`、`key-insight`、`open-question`、`review-questions(5)`；共 6 个 section，可见正文字符 6,736。
- `generationMeta`：`decision="degraded"`、`degradedReason="chunk_failures"`、`chunkCount=3`、`warnings=[]`、`evidenceIndex` 19 项。
- `quality.json`：`score=0.909`；`metrics` = `topicCoverage: 1`、`learnerEvidenceCoverage: 0.846`、`sourceIntegrity: 1`、`duplicationRatio: 0`、`unsupportedTopicRatio: 0`、`lengthFitness: 0.269`、`lengthChars: 6,923`、`evidenceTopicCount: 19`、`conceptCount: 18`。
- 对照基准：v1 止血期对同类长课的长度上限为 1,800 字符。

**检查点保留情况**：`chunks/` 下有 `chunk-001.json`（10,124 B）、`chunk-002.json`（10,832 B）、`chunk-004.json`（8,984 B）；失败的 `chunk-003` 无文件。每片含 7 个 topic、9 条 learnerEvidence。

---

## 5. trace 与接口的实测表现

| 项 | 观测 |
|---|---|
| trace 体积 | 8,272 B / 27 行（本次 job） |
| trace 内容洁净 | 不含 API key、`Bearer`、`Authorization`、课堂正文片段、助手名 |
| 鉴权 | 无令牌请求返回 HTTP 401 与 `code=auth_missing` |
| 错误分类 | 全部超时落 `upstream_timeout`，未出现 JSON 语法错误类症状 |
| 检查点复用 | 分片 3 永久失败后，其余 3 片证据文件保留 |
| 幂等 | 同一 `sourceHash` 二次 `start` 返回 `reused`（由阶段 D/E 门禁覆盖；本窗口内未观察到重复 start） |

---

## 6. 未验证项与边界

1. **无真机对照计时**：未测过"带 `reasoning` 字段"或"关思考生效"时的耗时。C-2 中"reasoning 常开"由代码与字段推断，非该模型下的 A/B 计时结论。
2. **并发未做对照**：成功分片耗时（80.6 s / 85.8 s）取自 `maxConcurrentChunks = 2`，未做并发 1 的对照，并发对耗时的贡献量未知。
3. **09-21 的 job 走的是另一条终态路径**：终态触发点是 `schema_unrecoverable`（reduce 成功但产物未过校验，且唯一一次 repair 自身又被截断），与 C-1/C-3 的"分片超时"链条不同；但它与 C-2 的关系（`output_truncated` 在该 job 出现 5 次是否为 reasoning 占用预算所致）未做对照，属推断。
4. **09-21 job 的其他机器事实**（F-01b）：`job_resumed` ×2、`job_interrupted` ×1、`job_retry_requested` ×1、`chunk_restored` ×1 均出现 → `failIfStale` + 检查点复位在全流程中被真实触发过一次；该 job 首末事件跨 16 小时 21 分，其中包含服务端重启。
5. **前端视觉未核对**：无浏览器截图；F-03 为服务器侧收到的轮询记录。
6. **09-25T07:55 与 09-23 两个 job 未展开时间线**，仅取终态与失败码。
7. 本报告未修改代码，故 F-09 / F-10 / F-11 的后果为静态推断 + 现有盘上状态，未经改动后实机复测。

---

## 7. 编号索引

| 编号 | 标题 | 证据 |
|---|---|---|
| BUG-0017 | 换模型后 `thinking` 经 `/responses` 被丢弃 → 长课笔记降级 | E-466 ~ E-469、F-05 ~ F-07、C-2 |
| BUG-0018 | 新建 job 缺 `modelCalls` 初值 → 调用预算判据恒不成立 | E-470、F-09、F-12、C-4 |
| BUG-0019 | `cleanup()` 无调用点 → 保留策略未执行 | E-471、F-10、C-5 |
| BUG-0020 | 降级组装不接收目标长度；降级产物无 warnings；质量分不统计缺片 | E-473 ~ E-475、F-11、C-6 |

---

## 8. 修改方案（2026-09-25 追加）

> 本节为后续修复的施工图。每个方案遵循"先补测试 → 再改实现 → 真机复测"的顺序；所有行号引用以上文 F-05 ~ F-12 的代码事实为准。

### 8.0 实施结果（2026-09-25 晚，FIX-0017 ~ FIX-0020 全部落地）

> 产物：`outputs/post-class-notes-v2/fix-20260925T120000Z/`（`results.json` / `commands.txt` / `after.sha256`）。
> **口径决策**：FIX-0020 第 3 项选定"缺片计入 score（按比例折减）"。

| FIX | 状态 | 改动落点 | 新增测试 | 红证据 |
|---|---|---|---|---|
| FIX-0017 | 已实施 | `responses-api-compat.js` `chatRequestToResponses()` | compat smoke +7 断言 | 转换后 `result.reasoning === undefined` |
| FIX-0018 | 已实施 | `orchestrator.js` 新建 job 字面量 | 预算场景 + 计数器场景 | 预算场景 4 次调用、错误码 `upstream_timeout` |
| FIX-0019 | 已实施 | `orchestrator.js` 新增 `sweepCheckpoints()`，全部终态点 fire-and-forget | 终态触发 ×2 + 清理抛错容错 | 终态后 cleanup 调用计数 0 |
| FIX-0020.1 | 已实施 | `quality.js` 拆 `renderDegraded()`，`assembleDegraded()` 收 `targetRange` 并逐档压缩 | bulky fixture 带宽断言 | — |
| FIX-0020.2 | 已实施 | `quality.js` 返回 warnings；`orchestrator.js` 合并缺片信息入 `generationMeta.warnings` / `quality.json` | quality ×3 + orchestrator 断言 | 降级笔记 `warnings: []` |
| FIX-0020.3 | 已实施 | `quality.js` 新增 `metrics.chunkCompleteness` 并按比例折减 score；`completenessOf(job)` 传入三处 score 调用 | 折减比例 + 钳制 + 默认值 | 指标不存在、折减前后同分 |

**实施中另外发现并修掉 1 个缺陷**：`assembleDegraded` 的 `atFullDetail` 变量被循环覆盖，导致"压缩确实发生了却报 assembled at full detail"；已改为首次迭代单独记录。

**门禁**：相关模块 9/9 PASS、语法 6/6 OK、`.next` 手工补跑 9/9 PASS、全量矩阵 132/130/0/2 —— 与改动前最近基线（2026-09-25T19:28，132/130/0）**一致，零回归**。

**一次假失败**：首次矩阵报了 2 个失败（`chat-auth-contract`、`close-reading-integration`），原因是与 `.next` 手工测试**并行**执行造成争用；单独重跑各 3/3 通过，矩阵单独重跑回到 130/0。结论：矩阵不要与其它测试并行。

**仍未验证（需真机）**：FIX-0017 是否真把分片耗时压到 90 s 以下（这是把 C-2 从推断升级为结论的唯一对照）；FIX-0020 在真实 18 概念 / 缺 1 片规模下的产物长度。二者都要重启应用后跑一节长课。


### FIX-0017：`thinking` → `reasoning` 映射（对应 BUG-0017）

**改动点**：`resources/server/lib/responses-api-compat.js` 的 `chatRequestToResponses()`，在 `:170-171` 现有 `reasoning` 处理块附近追加：

```js
else if (body.thinking !== undefined) {
  var t = body.thinking;
  var enabled = (typeof t === "boolean") ? t : (t && t.type === "enabled");
  result.reasoning = { effort: enabled ? "medium" : "none" };
}
```

要点：

- 优先级放在 `body.reasoning` / `body.reasoning_effort` 之后（显式 reasoning 字段优先，`thinking` 仅作兜底）。
- `thinking: { type: "disabled" }`（`provider.js:56` 的实际形态）与裸布尔两种入参都要兼容。
- `"none"` 取值需先确认上游 `api.nwafu-ai.cn` 的 `/responses` 是否接受；若不接受则退化为 `"low"` 或直接省略 `reasoning` 字段——**这一项是方案中唯一需要真机试探的点**。

**测试**：

1. 新增单元 smoke test（co-located `responses-api-compat-smoke-test.js` 或就近新增）：构造 `{ model: "gpt-5.6-sol", thinking: { type: "disabled" } }` 与 `thinking: false` 两种请求体过 `chatRequestToResponses()`，断言输出含 `reasoning` 且 `effort` 为关思考取值；再断言 `thinking: true` / 显式 `reasoning` 的优先级顺序。
2. 真机复测：修复后跑一节长课，对照 F-02 的分片耗时（当前 80~86 s 贴线），验证 map 阶段单次请求是否显著低于 90 s。**这是把 §6.1 的"推断"升级为"结论"的必要对照。**

### FIX-0018：新建 job 补 `modelCalls` 初值（对应 BUG-0018）

**改动点**：`orchestrator.js:817-840` 的新建 job 对象字面量，追加 `modelCalls: 0,`，与 `:811`、`:1021` 两个既有分支对齐。

**测试**：smoke test 走 `start()` 新建 job 后读 `job.json`，断言 `modelCalls === 0`（而非 `null`）；再构造 `modelCalls = 40` 的 job 调 `ensureBudget()` 断言抛错。

### FIX-0019：挂接 `cleanup()`（对应 BUG-0019）

**改动点**：在 job 终态落盘点（`persist_completed` / `job_degraded` / `job_failed` 附近）或服务启动时调用一次 `cleanup()`，使用 `checkpoint-store.js` 既有常量（成功 7 天 / 失败 14 天 / 每会话 5 个）。

要点：优先选"终态落盘后触发"，避免启动时阻塞；调用需 fire-and-forget 并 catch，清理失败不得影响主流程。

**测试**：smoke test 构造 6 个超龄/超量 job 目录，调用后断言保留数量符合 `MAX_JOBS_PER_CONVERSATION = 5` 与保留期规则。

### FIX-0020：降级产物的长度、警告与评分口径（对应 BUG-0020）

**改动点**（三处，建议拆成三个提交）：

1. `quality.js` 的 `assembleDegraded({ evidence, language })` 增加 `targetRange` 入参，由 `orchestrator.js:404 / :496` 已有的 `partitioner.visibleTargetRange()` 传入，组装时按目标长度截断/压缩（现有 `slice(0,6)` / `slice(0,3)` 的硬编码上限保留作兜底）。
2. 降级产物写入 `warnings`：至少包含缺片信息（`chunk X/Y failed: upstream_timeout`）与"长度为降级默认值"提示，让前端有东西可展示。
3. 质量评分口径：缺片纳入 `score` 计算（如按缺片比例折减 `topicCoverage` 或新增 `chunkCompleteness` 指标），避免"缺 1/4 片仍 0.909"。**此项涉及评分语义变更，动手前需先定产品口径：缺片是扣分还是仅标注。**

**测试**：构造缺 1/4 片的 evidence 走 `assembleDegraded`，断言产物长度落入 `visibleTargetRange`、`warnings` 非空、评分低于完整片对照组。

### 实施顺序与验证

| 序 | 项 | 理由 |
|---|---|---|
| 1 | FIX-0017 | 主因，单行级改动，收益最大；修后真机复测即验证 C-1/C-2 |
| 2 | FIX-0018 | 一行补丁，恢复预算熔断 |
| 3 | FIX-0019 | 一行挂接 + 防御性 catch |
| 4 | FIX-0020 | 涉及评分口径决策，放最后 |

全部修完后跑 `node tools/run-smoke-matrix.js` + `.next/` 下相关测试（手工），并以一节真机长课复测：预期终态 `ready`、分片耗时明显低于 90 s、`modelCalls` 有数值、降级路径（若仍触发）产物带 warnings 且长度达标。
