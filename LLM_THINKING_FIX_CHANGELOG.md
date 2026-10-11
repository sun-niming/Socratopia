# LLM 思考开关门控修复改动清单

日期：2026-09-11
现象：课后笔记生成失败，前端报 `Failed to parse LLM JSON output`；教材导入、目录提取亦返回空内容。

---

## 一、根因

`set.json` 将 `strong` / `kb` / `weak` / `premium` 全部指向模型 `deepseek-flash`。该模型是混合推理模型，
其 `reasoning_content`（思维链）与 `content`（正式回答）**共享同一个 `max_tokens` 预算**
（实测 `completion_tokens = reasoning_tokens + content_tokens`）。

而 `callLLM` 中"关闭思考"的开关带有一份**写死的模型名白名单**：

```js
...void 0!==m&&("deepseek-chat"===d||d.startsWith("deepseek-v4"))
    ?{thinking:{type:m?"enabled":"disabled"}}:{}
```

`deepseek-flash` 两个条件都不满足，于是各路由显式传入的 `thinking: false`
被**静默丢弃**，模型继续自由推理，把输出预算耗尽：

- 生产日志：`content:""` 而 `reasoning_content` 内容完整；4 次尝试（2 轮 × 2 次重试）各耗时 37–41s 后失败
- 唯一吐字的一次：1212 字符在 JSON 第 989 字节处被截断，即 `finish_reason: "length"` 特征
- 对照复现（同端点同模型，提示词比照 `concept-summary` 真实形态）：

| 变体 | `finish_reason` | content | 推理 token | 可解析 | 耗时 |
|---|---|---|---|---|---|
| 生产现状（8192，不禁思考） | `length` | 1980，截断 | 7188 / 8192 | 否 | 45.4s |
| 仅加 `response_format` | `length` | 7345，截断 | 4099 | 否 | 49.1s |
| **仅禁思考（本次修复）** | `stop` | 5667 | 0 | **是** | 16.8s |
| 仅把 `max_tokens` 提到 32768 | `stop` | 10809 | 5708 | 否 | 53.4s |

结论：单纯加大预算是无效的（模型照旧膨胀推理）；**只有让 `thinking` 开关真正生效才能修复**。

## 二、改动

门控由**写死的模型名**改为**模型家族判断**，并加入一条可观测日志：

```js
// 改前
...void 0!==m&&("deepseek-chat"===d||d.startsWith("deepseek-v4"))?{thinking:{type:m?"enabled":"disabled"}}:{}

// 改后
...void 0!==m&&(console.log("[callLLM] thinking="+(m?"enabled":"disabled")+" applied="
    +/^deepseek/i.test(String(d||""))+" model="+d),/^deepseek/i.test(String(d||"")))
    ?{thinking:{type:m?"enabled":"disabled"}}:{}
```

- **不再硬编码模型名**：`/^deepseek/i` 覆盖 deepseek 全家族，后续换 `deepseek-*` 型号无需再改代码。
- **留痕**：每次调用只要路由传了 `thinking`，运行日志即输出
  `[callLLM] thinking=disabled applied=true model=deepseek-flash`；
  `applied=false` 可直接暴露"路由想控制思考但模型不支持"的场景。
  chat 路由使用同一形态，标签为 `[chat]`。

## 三、改动文件（7 个文件 / 8 处；`chat/route.js` 另有 1 处 `q` 行未动，见第四节）

| 文件 | 说明 |
|------|------|
| `resources/server/.next/server/app/api/concept-summary/route.js` | 课后笔记（本次报错来源） |
| `resources/server/.next/server/app/api/flashcard/route.js` | 闪卡生成 |
| `resources/server/.next/server/app/api/chat/route.js` | 对话流式（`[chat]` 标签） |
| `resources/server/.next/server/app/api/companion/reconcile-persona/route.js` | 人设重写 |
| `resources/server/.next/server/app/api/custom-companions/merge-persona/route.js` | 人设合并 |
| `resources/server/.next/server/chunks/1576.js` | 共享 chunk（模块 64092 副本） |
| `resources/server/.next/server/chunks/4092.js` | 共享 chunk（模块 64092 副本） |

后 5 个与 `concept-summary` 共用同一份 `callLLM` 副本（webpack 未能完全去重），
故必须同步修改，否则按路由不同而行为分叉。

## 四、有意未改动

`chat/route.js` 中的 `q` 变量：

```js
q="deepseek-reasoner"===b||("deepseek-chat"===b||b.startsWith("deepseek-v4"))&&l?.thinkingObserved===!0
```

它决定的是**是否把 `reasoning_content` 回灌进 assistant 历史**，与"是否发送 thinking 参数"是两回事。
本次不动它以免改变多轮对话的历史结构；若后续需要让 deepseek 全家族回灌推理，再单独评估。

## 五、生效与回滚

- **生效**：服务端代码从 `resources/server/` 原地加载，重启 `Socratopia.exe` 即可，无需重打包 ASAR。
- **验证**：重启后生成一次课后笔记，日志应出现
  `[callLLM] thinking=disabled applied=true model=deepseek-flash`，且不再出现
  `PARSE all attempts failed` / `Failed to parse LLM JSON output`。
- **回滚**：本仓库这些文件均受 git 跟踪，直接 `git checkout -- <文件>` 即可；
  或按上表逐文件恢复改前字符串。

## 六、备注

- 复现脚本留在 `tmp/llm-thinking-probe.js` 与 `tmp/llm-budget-probe.js`（`tmp/` 已被 gitignore）。
  两者运行时从 `resources/settings.json` 读取端点与密钥，脚本内不含任何密钥。
- 本次改动未执行测试与语法校验，需以重启后的运行日志为准。
