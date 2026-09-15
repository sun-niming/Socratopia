# 端到端实况验证（V-3）

> 2026-09-14。**这是本项目第一次对"运行中的应用"取证。**
> 证据 E-403 ~ E-418。方法：应用**已在运行**，直接读其运行日志与探活，未启动也未杀进程。

---

## 0. 执行方式与有效性前提

| 项 | 值 |
|---|---|
| 应用状态 | **已在运行**（5 个 `Socratopia.exe` 进程，主进程 PID 39712） |
| server 启动时刻 | `2026-09-14T10:32:21.302Z`（本地 18:32） |
| 代码最新改动 | `resources/server/lib/**` 最新 14:37（本地）；**17:00 后无文件改动** |
| → 结论 | **运行实例加载的是当前代码**，取证有效 |
| 运行日志 | `%APPDATA%/socratopia/logs/socralab_debug.log`（672 KB，覆盖 2026-09-01 ~ 09-14） |
| 监听的端口 | **13713**（动态，非 3000） |
| 探活方式 | `curl` 打本机端口 + 读日志；未带令牌 |
| 副作用 | 无（未启动、未杀进程、未写文件） |

---

## 1. 已验证为真的（正面结论）

### 1.1 启动与模块加载 **全部正常**
`[Next]` 前缀日志显示以下模块在启动阶段全部成功加载（无一条失败）：
`[long-reasoning] Long-context helper loaded`、`[model-router] loaded`、`[knowledge] Auto-registered provider: kimi-desktop / local-kb / search / rag / database`、`[knowledge] Source router loaded`、`[close-reading] Isolated PDF close-reading skill loaded`、`[voice] Emotion voice catalog loaded, voices: 23`、`[voice] Emotion segment protocol loaded`、`[continuity] Runtime loaded, enabled=true`，随后 `[adaptive-auth] verifier synchronized` → `Next.js 16.1.6 ✓ Ready in 72ms`。

→ **本体与分支模块共存且都能加载**，没有"新增模块把服务搞崩"的情况。

### 1.2 动态端口与绑定地址（**与 `AGENTS.md` 矛盾，`CLAUDE.md` 正确**）
实际 `- Local: http://127.0.0.1:13713`。`AGENTS.md` 说 "port 3000" 是错的；`CLAUDE.md` 的"dynamic port / 绑定 127.0.0.1"正确。

### 1.3 鉴权门禁在真实请求上生效（fail-closed 实证）
```
POST http://127.0.0.1:13713/api/chat   （不带 Authorization）
→ HTTP 401
{"error":{"code":"auth_missing","message":"A local request capability is required",
          "status":401,"traceId":"route_mu14bzf3_3n"},"code":"auth_missing",...}
```
- 错误体与 `route-auth.errorResponse` 的构造**逐字段吻合**（含 `traceId`、`Cache-Control: private, no-store`）。
- 公开路径 `/api/account/init` 用 GET 打返回 405（该路由只收 POST），说明它确实**绕过了令牌校验**。
→ `02-module-dossiers/account-auth-and-request-context.md` 的设计描述**在运行中被证实**。

### 1.4 【Q-026 结案】劫持式挂载在真实运行中**生效**
日志中 `[kb-progress]` 前缀出现 **198 次**（含 `[kb-progress][C3]` 9 次）。
→ `kb-progress.js` 对 `Module._load` 的补丁**确实在打包运行环境中挂上了**，并持续包裹 chat 的 POST。此前"可能静默失效"的担心（R-06）在本次实例上**未发生**。

### 1.5 【BUG-0002 补全为运行时验证】思考开关门控真的在起作用
日志统计：
```
37  [callLLM] thinking=disabled applied=true model=...
145 [chat]     thinking=enabled  applied=true model=...
```
- **`applied=true` 出现 190 次，`applied=false` 出现 0 次。**
- 观察到的模型名含 `DeepSeek-V4.1-Flash`（**大写 D/S**）与 `deepseek-v4-flash`。
  → **旧白名单 `"deepseek-chat"===d||d.startsWith("deepseek-v4")` 因大小写区分，对 `DeepSeek-V4.1-Flash` 会判 false** —— 即修复不是"锦上添花"，而是**必须**，且实测已生效。
- 这恰好满足 `LLM_THINKING_FIX_CHANGELOG.md` §五自己写的验证要求："日志应出现 `[callLLM] thinking=disabled applied=true`"。
→ **BUG-0002 由此升级为"通过针对性验证（含运行时）"。**

### 1.6 【BUG-0001 的 C3 修复】页级降级在真实教材上触发
`[kb-progress][C3] 教材没有可用的概念卡队列，已切换为页级进度模式…` 出现 9 次，`textbookId: 'KUyw'`，`mode: 'page_only'`。
→ 这正是 BUG-0001 的 C3 阶段一修复要覆盖的"无知识库教材"场景，且 `cause/effect/stage2` 诊断字段齐全。

### 1.7 其它观测能力正常
- `[ctx-trim]` 历史裁剪诊断在跑（451 次），字段含 `msgs/histChars/trimmed/reason/sysPLen/outline/memory/...`
- DeepSeek **自动前缀缓存生效**：`[direct-llm-cache] promptTokens: 20249, cachedTokens: 4864, cacheHitTokens: 4864`
- `[chat-diag]` 931 次

---

## 2. **本批新发现的真实缺陷：BUG-0012**（EPERM 反复丢失进度保存）

### 2.1 现象
日志中 `[kb-progress] post-response progress save failed: EPERM` 共 **16 次**：

| 日期 | 次数 |
|---|---|
| 2026-09-11 | 5 |
| 2026-09-12 | 3 |
| 2026-09-13 | 3 |
| 2026-09-14（截至 10:10Z） | **5** |

全部指向**同一个文件**：
```
rename '…\accounts\local\profiles\uolmzgq8\worlds\KU\textbooks\textbook_index.json.<数字>' -> '…\textbook_index.json'
```
→ 发生率约 **每天 3~5 次**，且 09-14 是最高的一天（**未在改善**）。

### 2.2 根因（已定位到行）
1. 临时文件名带**数字后缀**，是 `write-file-atomic` 的 `getTmpname()` 特征（`filename + '.' + sha1(...).readUInt32BE(0)`）。
2. 全仓库**只有 `auto-advance.js` 使用该库**（L15 require，L144 `writeFileAtomic.sync(filePath, content, {encoding:"utf8", fsync:true})`）。
3. `auto-advance.js` 自己的 `atomicWrite`（L142-156）重试**仅 5 次、退避 25/50/75/100/125ms ≈ 375ms**，超限即 `throw`。
4. 而 `write-file-atomic` v7 **本身不做 rename 重试**（`EPERM` 只出现在 chown 判定里）。
5. 异常冒泡到 `kb-progress.js:1404` 的外层 catch → 打出该日志，**本轮课后进度保存整体作废**。

**对照**：`kb-progress.js` 自己的 `atomicWrite`（L1105）重试 **10 次、上限 200ms/次 ≈ 1.1s**，约为 auto-advance 的 **3 倍**。→ 同一仓库里两套重试预算不一致，短的这套不够。

### 2.3 影响
- 该轮**学习进度未落盘**（答案已送达，仅进度丢）。
- **对用户基本无声**：日志中 `PROGRESS_SAVE_FAILED` 警告事件计数 = **0**，即前端那条"回答已生成，但学习进度暂未同步"**没有出现**。
- 与 BUG-0001 的关系：09-11 前日志中**没有** EPERM，09-11 起才出现 → 与 09-11 的 auto-advance v2 重写**时间吻合**，属该次改造的**新引入或新暴露**。

### 2.4 为什么 BUG-0001 的测试没抓到
`auto-advance-window-recovery-smoke-test` 等 10 个测试**全部通过**，但它们验证的是逻辑分支，**没有模拟 Windows 上另一进程持有句柄导致的真实 EPERM 竞争**。
→ 佐证一条重要判断：**"通过针对性验证"≠"真实环境无残留"**；BUG-0001 应新增一条残余项。

### 2.5 修复方向（建议，低成本）
把 `auto-advance.js` 的重试预算对齐 `kb-progress.js`（≥10 次 / ≥1s），或统一抽一个带足够退避的共享写入器。**验收**：改后连续跑一批真实课堂轮次，`post-response progress save failed` 归零。

---

## 3. 其它实况观测（次要但值得记）

| 观测 | 说明 |
|---|---|
| **LLM 端点在 14 天内换过 5 个** | `api.deepseek.com`(179)、`api.nwafu-ai.cn`(200)、`api.starcommunity.asia:8012`(65)、`deepseek.nwafu.edu.cn`(27+1)。配置在会话中途被切换过 |
| **一处 URL 拼接错误** | `https://deepseek.nwafu.edu.cn/?model=DeepSeek-V4.1-Flash/v1/chat/completions` —— baseURL 带 query 后又追加路径，`?model=` 的值被污染为 `DeepSeek-V4.1-Flash/v1/chat/completions`（仅 1 次，应已被改回） |
| `.server-port` 的 `writtenAt` 停在 2026-05-23 | 端口值(13713)对，但该文件**未在每次启动时重写**；依赖它的外部脚本可能误判 |
| 日志轮转 | `socralab_debug.log.1` 已达 **162 MB** |
| 09-14 单日日志 520 行 | 与 09-11(594) 同量级，说明**最近三天都在高频真实使用** |

---

## 4. 本批对既有文档的修正

| 文档 | 修正 |
|---|---|
| `OPEN-QUESTIONS.md` Q-026 | **结案**：挂载在真实运行中生效（198 次日志） |
| `OPEN-QUESTIONS.md` Q-048 | **结案**：应用已在运行，V-3 无需另行授权启动 |
| `04-bug-ledger.md` BUG-0002 | 升级为**含运行时的**通过验证（`applied=true` ×190，模型名证明修复必要） |
| `04-bug-ledger.md` BUG-0001 | 追加**残余项**：C3/EPERM 相关在真实环境仍有 EPERM 发生（→ BUG-0012） |
| `05-tech-debt-and-risks.md` R-06 | 由"可能静默失效"改为"本次实例未失效"；同时新增 R-21（两套重试预算不一致） |
| `06-refactor-roadmap.md` | C2 增补 BUG-0012 |
| `AGENTS.md` 相关结论 | 再次证实"port 3000"错误 |

---

## 5. 仍未验证 / 边界

- **未做真实"发一轮课"的操作**（应用在跑但本轮没点发送）→ 上述结论均来自**应用中已有的真实使用记录**，非本批主动触发。
- 未验证：前端 UI 行为、视觉/听感、多账户切换、教材导入、练习工作台。
- 未验证：`adaptive-teaching` 是否真的被调用（日志中未见 adaptive 相关行，与"默认关闭"一致，**待确认**）。
- 未清理：应用仍**保持运行**，未重启也未关闭。

---

## 6. 证据
E-403 进程与 PID：5 个 `Socratopia.exe`；`.server-pid` = `{"pid":39712,"exePath":"…Socratopia.exe","startedAt":"2026-09-14T10:32:21.302Z"}`
E-404 启动日志：全部模块加载成功 + `Next.js 16.1.6 ... ✓ Ready in 72ms` + `Local: http://127.0.0.1:13713`
E-405 鉴权探活：`POST /api/chat` 无令牌 → 401 `auth_missing` + traceId；`GET /api/account/init` → 405
E-406 `[kb-progress]` 计数 198、`[kb-progress][C3]` 计数 9 → **Q-026 结案**
E-407 `[callLLM] thinking=disabled applied=true` ×37、`[chat] thinking=enabled applied=true` ×145、`applied=false` ×0
E-408 模型名 `DeepSeek-V4.1-Flash` 对旧白名单 `startsWith("deepseek-v4")` 大小写不匹配 → 修复必要性证据
E-409 `[kb-progress][C3]` 完整诊断字段（textbookId KUyw、mode page_only、cause/effect/stage2）
E-410 **BUG-0012**：16 次 EPERM 的日期分布与统一目标文件路径
E-411 `auto-advance.js:15/142-156`；`write-file-atomic/lib/index.js` 的 `getTmpname()` 与"无 rename 重试"
E-412 `kb-progress.js:1105-1122`（10 次/≈1.1s）对比 auto-advance（5 次/≈375ms）
E-413 `kb-progress.js:1401-1409` 的 catch 与 `PROGRESS_SAVE_FAILED` 事件；其计数为 0
E-414 LLM 端点分布（5 个）与异常 URL 样本
E-415 `.server-port` 内容与 stale `writtenAt`；`.log.1` = 162 MB
E-416 `[direct-llm-cache]` cachedTokens 4864 → 自动前缀缓存生效
E-417 代码时效性：17:00 后无文件改动 vs server 18:32 启动
E-418 使用强度：日志覆盖 2026-09-01~09-14，单日 237~594 行
