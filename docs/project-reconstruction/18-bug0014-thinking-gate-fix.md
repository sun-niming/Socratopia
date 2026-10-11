# BUG-0014 修复：把"要不要发 thinking"的判据从模型名改成能力

> 2026-09-26。证据 E-505 ~ E-512。对应 BUG-0014 / R-24 / Q-056。
> **第四轮改业务代码。用户确认 gpt-5.6 默认开启 reasoning 后授权。**

---

## 1. 修的是什么

判据原本是**字面量模型名**：

```js
/^deepseek/i.test(model)          // 旧
/^(?:deepseek|gpt-5\.6)/i.test(model)   // 新
```

模型于 2026-09-23 换成 `gpt-5.6-terra` 后判据恒 false → `thinking` 字段**完全不再发送**
（09-25 全 52 轮 `applied=false`）→ 三处"防 reasoning 吃光 max_tokens / content 空串"的护栏一起失效。
而 gpt-5.6 **默认开启推理**（Q-056，用户口述）→ 属于正在发生的浪费。

---

## 2. 分工：一半已由并行会话完成（FIX-0017）

`lib/responses-api-compat.js` 的 `chatRequestToResponses()` 里**已经有** `thinking` → `reasoning`
的映射（含注释与 4 条断言，`responses-api-compat-smoke-test.js:263-303`，mtime 2026-09-25 19:40）。

**它解决的是"字段发出来之后没人认"**：
`/responses` 协议不认 `thinking`，只认 `reasoning` / `reasoning_effort`。
本条（BUG-0014）解决的是**"字段压根没发出来"**——两者必须同时具备才有意义。

> 并行会话的 BUG-0017（课后笔记 4/4 job 全降级）是同一根因的另一条腿：它经手写 `provider.js`
> 发出了 `thinking:{type:"disabled"}`，但被兼容层吃掉且**连 `applied=false` 这种日志都没有**。
> 它的修复与本节互补，不冲突。

---

## 3. 本轮改了什么

### 3.1 加宽判据：10 个文件 / 17 处（全部替换，无遗漏）

| 类别 | 文件 | 处数 |
|---|---|---|
| 模块 64092 定义文件（编译产物） | `.next/server/app/api/{chat,concept-summary,flashcard,companion/reconcile-persona,custom-companions/merge-persona}/route.js`、`.next/server/chunks/{1576,4092}.js` | 7 × 2 |
| 手写 lib 发送方 | `lib/llm-gateway.js`、`lib/kb-builder-coordinator.js`、`lib/kb-builder.mjs` | 3 × 1 |

**为什么必须全覆盖**：`^deepseek` 判据在这 7 个 64092 定义文件里重复存在，只改一部分就会
"按路由分叉"——正是 CLAUDE.md 记的那条老坑。新回归测试专门钉这一点。

判据语义（已求值验证）：`deepseek-flash` ✓、`DeepSeek-V4.1-Flash` ✓、`gpt-5.6-terra` ✓、`gpt-5.6-sol` ✓、
`gpt-4o-mini` ✗、`qwen3` ✗ ——**只加宽到会走 `/responses` 的那一族，不波及无关模型**。

### 3.2 安全网：让"删掉不被支持的可选字段再重试"认得 `reasoning`

`lib/responses-api-compat.js` 的 `unsupportedOptionalField()` 字段表加入 `"reasoning"`。
若某网关不认 `reasoning`，退化为"去掉它重试"而不是整条请求失败。

### 3.3 新增回归测试

`lib/thinking-gate-smoke-test.js`（4 条断言）：
1. **10 个 payload 构造者全部**使用能力判据、且都不再残留 `/^deepseek/i`；
2. `thinking:{type:"disabled"}` 能活着穿过 `/responses` 改写成 `reasoning`（跨模块联调，防"判据对了但下游没人认"）；
3. 判据覆盖 deepseek + gpt-5.6；
4. 不误伤无关模型。

### 3.4 注释同步
三处 lib 护栏的注释改为"deepseek 与 gpt-5.6"，并写明"发了 `thinking` 兼容层才有东西可映射"。

---

## 4. 验证

| 项 | 结果 |
|---|---|
| `node --check` × 10 改动文件 + 新测试 | 全通过 |
| `thinking-gate-smoke-test.js`（新） | **4/4 PASS** |
| `responses-api-compat` / `-abort` / `responses-first-contract` / `end-class-llm` | 全 PASS |
| `.next` 手工补跑（覆盖改过的 route） | **30 例 / 29 通过 / 1 失败**（失败为既有 BUG-0011） |
| 全量矩阵 | 133 例 / 132 通过 / **1 失败** |

**唯一失败 `pdf-ocr-priority-smoke-test.js` 与本轮无关**（已证实）：
- 它只 `require("./pdf-ocr-coordinator.js")`，不碰 thinking / compat；
- 独立复跑 **8 次失败 2 次（~25%）**，是既有的**优先级队列时序 flake**
  （`await delay(30) // let both jobs enqueue` 这种时序假设，
  失败信息 `got order: start:2,end:2,start:1,end:1,...`）。

> 记录：本项目已知 flake 增至 **3 个**（另见 E-504、E-511 与并行会话的 E-486）。属测试自身的时序脆弱，非产品缺陷。

---

## 5. 生效状态（重要）

- 改动全在 server 原地加载的文件（`lib/**` 与 `.next/server/**`，**均不受 `release-runtime-manifest.json` 哈希约束**），
  **重启即生效**，不涉及 ASAR / manifest 重生成。
- 改动 mtime（14:49~14:58 本地）**早于**当前实例启动（15:04:47 本地）→ **运行中的实例已带此修复**。
- ⚠️ **但当前验证不到**：09-26 起模型已切回 `DeepSeek-V4.1-Flash`，老判据本来就命中，
  所以日志里 `applied=true` **不能区分修复前后**。
  → **要等下次切到 `gpt-5.6-*` 时才能看到**：`[chat] thinking=enabled applied=true model=gpt-5.6-terra`
  （修复前是 `applied=false`）。这是本修复的**验收判据**。

---

## 6. 回滚
10 个文件各自把 `/^(?:deepseek|gpt-5\.6)/i` 改回 `/^deepseek/i`；`unsupportedOptionalField` 去掉 `"reasoning"`；
新测试可保留（回滚后会红，正好作为证据）。

## 7. 仍未完成
- **未在 gpt-5.6 上实测**（见 §5）。护栏"重新生效"目前是**逻辑推断 + 单元级证据**，不是实机证据。
- `post-class-notes/orchestrator.js:329` 的 `thinking:false` 走 `provider.js`（无条件发字段）→ 已由 FIX-0017 覆盖，本轮未动。
- `thinking.enabled` 被映射为 `reasoning:{effort:"medium"}`、"disabled" 映射为 `effort:"none"`；
  **`"none"` 是否为网关接受的有效 effort 值，未实测**（若被拒，§3.2 的安全网会兜住）。

## 8. 证据
E-505 判据加宽：10 文件 / 17 处替换清单（7 个 64092 定义文件 + 3 个 lib）
E-506 判据求值验证：deepseek-flash / DeepSeek-V4.1-Flash / gpt-5.6-terra / gpt-5.6-sol=true；gpt-4o-mini / qwen3=false
E-507 `responses-api-compat.js` 的 `thinking`→`reasoning` 映射（含注释与测试）由并行会话于 2026-09-25 19:40 落地（FIX-0017）
E-508 `unsupportedOptionalField()` 字段表加入 `"reasoning"`
E-509 新测试 `lib/thinking-gate-smoke-test.js` 输出 4/4 PASS
E-510 `.next` 30/29/1（失败=BUG-0011）；矩阵 133/132/1
E-511 `pdf-ocr-priority-smoke-test.js` 与本轮无关的证据：只 require `pdf-ocr-coordinator.js`；独立 8 次 2 次失败（~25%）
E-512 生效核对：改动 mtime 14:49~14:58 本地早于应用启动 15:04:47 本地，运行实例已带修复；但 09-26 模型已切回 DeepSeek-V4.1-Flash，老判据本就命中，须等切回 gpt-5.6 才可验收
