# BUG 修复验证（V-2 逐条对应验证）

> 2026-09-14。**目的：把 BUG 台账 §1 的 7 条从"有修复代码"升级或降级到"通过针对性验证"。**
> 方法：**只跑修复文档自己声明的验证方式**，不发明新标准。
> 证据 E-390 ~ E-402。

---

## 0. 执行条件

| 项 | 值 |
|---|---|
| Node | v25.9.0（Windows） |
| 应用状态 | 未启动（BUG-0002 的运行时验证因此未做，见 §3） |
| 本地 TTS 服务 | **在运行**：`http://127.0.0.1:8000` 返回 HTTP 200 → 可跑 `-live-` 测试 |
| 真实外部 API | 未调用 |
| 用户数据 | 未写入 |

---

## 1. 结果总表

| BUG | 声明的验证方式 | 执行情况 | **新状态** |
|---|---|---|---|
| BUG-0001 自动推进跳读 | 3 个文件 `node --check`+acorn；10 个指定 smoke | **全部通过**（10/10 smoke + 3/3 语法） | **通过针对性验证** |
| BUG-0002 思考开关白名单 | 7 文件修复到位；`end-class-llm-smoke-test`；重启后看日志 | 7 文件修复**全部到位**；回归测试**通过**；运行时未做 | **通过针对性验证（单元级）** |
| BUG-0003 课后保存失败 | 6 份日志证据 + 11 文件 `node --check` + 解析器 20 项 + 集成 6 场景 | 6 份日志**均在且 PASS**；解析器测试 20 项**通过**；集成测试**通过** | **通过针对性验证** |
| BUG-0004 KB 队列劫持习题 | 诊断文档给优先级；**未见声明测试** | **修复已落地**；找到 2 个精确回归测试并**通过** | **通过针对性验证** |
| BUG-0005 流式静默丢音 | `voice-*` 前端 smoke + `tts-classic-stream-frontend` | **全部通过**；另 4 个 live 测试**通过** | **通过针对性验证** |
| BUG-0006 TTS 零帧成功 | `tts-classic-stream-zero-audio-live` | **通过**（对真实本地 TTS 服务） | **通过针对性验证** |
| BUG-0007 TTS 会话/并发/本地 API 防护 | session-safety / local-api-security / player-task-isolation | **全部通过** | **通过针对性验证** |

**结果：7 条全部升级为"通过针对性验证"**（BUG-0002 为单元级，运行时层面另记）。

---

## 2. 逐条明细（可复查）

### BUG-0001（E-390）
文档 §五声明的清单，全部复现：
```
PASS auto-advance-window-recovery-smoke-test.js        （修复时新增的测试）
PASS auto-advance-smoke-test.js
PASS auto-advance-race-smoke-test.js
PASS auto-advance-teaching-state-machine-smoke-test.js （文档称 13 场景，含新增页级 SSE 全链路）
PASS auto-advance-protocol-bundle-smoke-test.js
PASS kb-progress-smoke-test.js
PASS kb-progress-sse-smoke-test.js
PASS progress-guard-smoke-test.js
PASS .next/.../chat/chat-reading-window-truncation-smoke-test.js
PASS jump-page-ocr-route-smoke-test.js
```
语法：`node --check` + `acorn.parse(ecmaVersion:2022)` 对 `chat/route.js`、`auto-advance.js`、`kb-progress.js` **全部 OK**。
→ 文档声明的验证**完整复现**；测试含修复时新增的那个，属针对性验证。

### BUG-0002（E-391）
- **修复到位核对**：`/^deepseek/i` 家族判断在 **7 个文件各 1 处**全部存在（`concept-summary`、`flashcard`、`chat`、`reconcile-persona`、`merge-persona`、`chunks/1576.js`、`chunks/4092.js`）。
- **chat/route.js 残留的 1 处旧白名单**已核对：正是文档 §四声明"有意未改"的 `q` 行（`q="deepseek-reasoner"===b||("deepseek-chat"===b||b.startsWith("deepseek-v4"))&&l?.thinkingObserved===!0`，用于决定是否回灌 `reasoning_content`）。**变量名与上下文完全吻合，非漏改。**
- **回归测试**：`lib/end-class-llm-smoke-test.js` 用模型名 `deepseek-test`（**不匹配旧白名单 `deepseek-chat`/`deepseek-v4`，匹配新正则**），断言 `endOptions.thinking === false` → 若回退到旧逻辑该断言会失败。**通过**。
- **未做**：文档 §五要求的"重启后生成一次课后笔记，日志出现 `[callLLM] thinking=disabled applied=true`" —— 需启动应用 + 真实模型。
- 附带发现：文档提到的 `tmp/llm-thinking-probe.js`、`tmp/llm-budget-probe.js` **已不在 `tmp/` 中**（Q-049）。

### BUG-0003（E-392）
- `outputs/post-class-save-fix-20260913/verification.json` 记录的 6 项检查，对应日志**全部存在且 PASS**：`parser-test.log`（20 项）、`llm-test.log`、`integration-test.log`、`call-llm-fence-test.log`、`continuity-test.log`、`syntax-check.log`（11 文件）。
- 复现其对应测试：`end-class-parser-smoke-test.js`（.next）**PASS**、`chat-end-class-integration-smoke-test.js`（.next）**PASS**、`call-llm-fence-smoke-test.js` **PASS**。
- `parser-test.log` 明确含事故特征用例：`PASS three-line markers`、`PASS mixed markers seen in incident`。
- 该目录还留有 `changes.patch`、`before/` 原字节备份、`baseline.json` —— **回滚材料完整**。

### BUG-0004（E-393）—— 本次最大意外
- **修复已落地**（诊断文档当时声明"仅诊断，未改代码"）：`kb-progress.js` 新增 `checkEvidence()`，代码注释直接引用事件：
  > "A trailing question mark alone is NOT evidence — **on 2026-09-13** that inference capped a concept the exercise turn never touched and forced the model onto the next card mid-exercise."
  逻辑改为 `counted = conceptBound && studentAnswered`，并有 `finalQuestionTail()` 防止长解释把概念名"夹带"进判定。
- **回归测试存在且精确**：
  - `lib/progress/kb-progress-sse-smoke-test.js:178` —— "a trailing question mark alone never increments the check counter"
  - `:182` —— "a short ack is not a valid answer and cannot reach the two-check cap"
  - `:211` —— "a repeated old-card question is not charged to the newly active card"
  - `lib/progress/exercise-mode-smoke-test.js:206` —— "exercise turns never charge a concept check"（文件头注明回归自 `outputs/deepseek-classroom-20260913-diagnosis.md`）
- 以上测试在 V-1 中**全部 PASS**。
- 注意：`TWO_CHECK_LIMIT_REACHED` 硬上限机制**仍保留**（`kb-progress.js:429/766`）——修的是"什么算一次检查"，不是取消上限。与诊断建议一致。

### BUG-0005 / 0006 / 0007（TTS 三条，E-394）
本地 TTS 服务在运行，故 `-live-` 测试可跑：
```
PASS tts-classic-stream-live-smoke-test.js
PASS tts-classic-stream-frontend-live-smoke-test.js
PASS tts-classic-stream-frontend-cancel-live-smoke-test.js
PASS tts-classic-stream-zero-audio-live-smoke-test.js   ← BUG-0006 的目标测试
```
另有 V-1 已通过的：`voice-early-stream`、`voice-emotion-client`、`voice-replay`、`voice-runtime-invariants`、`voice-stream-backpressure`、`voice-stream-error-containment`、`tts-classic-stream-frontend`、`tts-classic-stream-session-safety`、`tts-local-api-security`、`tts-player-task-isolation`。

---

## 3. 仍未验证的部分（不夸大）

| 未验证项 | 原因 | 影响 |
|---|---|---|
| BUG-0002 的运行时表现 | 需启动应用 + 真实模型调用 | 单元级已证；**"重启后日志出现 applied=true"未实测** |
| 全部"应用端到端可用" | 未启动应用 | 见 V-3 |
| 劫持式挂载是否生效（Q-026） | 同上 | 同上 |
| BUG-0005 的"旁白不入语音队列"在真实播放中的效果 | live 测试覆盖协议层，非听感 | 低 |

---

## 4. 顺带产出的两个发现

1. **`tmp/patch-asar-integrity.js` 存在**（根目录 `fix-asar-integrity.js` 已删）→ 可能回答 Q-043"重打包后用什么修 integrity"。待核。
2. `tmp/` 已被清掉过一轮（`llm-thinking-probe.js`、`llm-budget-probe.js` 消失）→ 印证 A/`R-02` 的"临时目录不可靠"。

---

## 5. 结论

- **BUG 台账 §1 的 7 条：全部达到"通过针对性验证"**（BUG-0002 限于单元级）。
- 这是本项目的修复**普遍带有匹配的回归测试**的证据——与 `05-tech-debt-and-risks.md` §6"修复文档质量高于平均水准"的判断一致。
- **因此 §1 不再是"待验证风险"，可降级为"已验证的历史修复"。** 真正仍未闭合的是 §1b 的 3 条当前可复现缺陷与 §2 的 8 项未修。

---

## 6. 证据
E-390 BUG-0001：10 个 smoke 结果 + 3 文件 `node --check`/acorn 通过
E-391 BUG-0002：7 文件修复点计数；chat 残留处上下文；`end-class-llm-smoke-test.js:39-47`（`deepseek-test` + `thinking===false` 断言）
E-392 BUG-0003：`outputs/post-class-save-fix-20260913/verification.json` + 6 份日志 + `parser-test.log` 20 项 + `changes.patch`/`before/`
E-393 BUG-0004：`kb-progress.js` `checkEvidence`/`finalQuestionTail` 源码与注释；4 条回归断言及其 PASS 结果
E-394 BUG-0005~0007：4 个 live 测试 PASS（对 `127.0.0.1:8000`）+ V-1 的 10 个相关 PASS
E-395 `outputs/smoke-baseline-20260914.json`（全部结果的原始 JSON）
E-396 `tmp/patch-asar-integrity.js` 存在；`tmp/llm-*-probe.js` 缺失
E-397~E-402 见 `EVIDENCE.md` W 节
