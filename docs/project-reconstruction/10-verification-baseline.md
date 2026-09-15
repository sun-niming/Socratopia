# 验证基线（第一次实跑）

> 阶段 V 批次 V-1（2026-09-14）。证据 E-300 ~ E-312。
> **本文件把此前所有"静态调查"结论升级为"有实测支撑"，也是阶段 E 的回归基线。**
> 执行前已按 Q-032 定性：确认无真实 API 调用、无用户数据写入、不改运行环境。

---

## 0. 执行条件（可复现）

| 项 | 值 |
|---|---|
| 目录 | `E:\huanjing\sogeladi\Socratopia` |
| 运行时 | Node.js **v25.9.0**（注意：高于仓库声明的依赖环境） |
| 平台 | Windows 11 |
| 应用状态 | **未启动**（无 Electron、无独立 server 进程） |
| 真实外部 API | **未调用** |
| 用户数据 | **未写入**（测试自建临时目录） |
| 环境变量 | 未设置任何 `SOCRATOPIA_*` |

### 执行命令
```bash
# 1) 项目自带矩阵（跳过 .next，120s/例上限，exit 2 归一为 skip）
node tools/run-smoke-matrix.js --json outputs/smoke-baseline-20260914.json

# 2) 矩阵遗漏的 .next 下 25 个测试（逐个跑，90s 上限）
find resources/server/.next -name "*smoke-test*.js" | while read f; do node "$f"; done
```

---

## 1. 结果总览

| 来源 | 总数 | PASS | FAIL | SKIP |
|---|---|---|---|---|
| `run-smoke-matrix.js` | 120 | 116 | **2** | 2 |
| `.next` 手工补跑 | 25 | 24 | **1** | 0 |
| **合计** | **145** | **140** | **3** | **2** |

另有 **3 个 TTS live 测试自跳过**（退出码 0，输出 `SKIP`，需 `SOCRATOPIA_RUN_TTS_LIVE=1`）：
`tts-classic-stream-live-`、`tts-classic-stream-frontend-live-`、`tts-classic-stream-frontend-cancel-live-`。

**2 个 SKIP 为矩阵设计内的**：`pdf-cmap-real-`、`pdf-render-real-`（缺 fixtures，exit 2）。

**通过率 140/145 = 96.6%。**

---

## 2. 三个失败（全部可定位，全部是真实缺陷）

### FAIL-1 `lib/staged-ws-runtime-smoke-test.js` —— 发布暂存缺文件
```
Error: Cannot find module './lib/knowledge/daimon-bridge.js'
Require stack: E:\huanjing\sogeladi\Socratopia\release\win-unpacked\resources\server\[eval]
```
- **判定（已证实）**：`release/win-unpacked/` 这份发布暂存树的 server 里**缺 `lib/knowledge/daimon-bridge.js`**，导致该树**启动即崩**。
- **含义**：这是第三份打包产物（E-049 / Q-006）**确认不可用**的直接证据。此前只能"合理推断"多份产物并存危险，现在是实测。
- **关联**：`tools/stage-clean-win-release.js` 是生成它的工具，其 allowlist 可能漏了 `lib/knowledge/`。
- **新编号**：BUG-0009。

### FAIL-2 `electron-adaptive-capability-smoke-test.js` —— 根 main.js 与 ASAR 副本已漂移
```
AssertionError: root and ASAR runtime must share the same adaptive protocol block
+ actual - expected
  'var ADAPTIVE_AUTH_ACCOUNT_ID = "local";\r\n' ...
+ 'function issueAdaptiveCapability(event, args) {\r\n' +   ← 实际多出
- 'function issueAdaptiveCapability(event, args) {\n'       ← 期望
+ 'var ADAPTIVE_IMAGE_PATHS = /* @__PURE__ */ new Set([...'  ← 实际多出
```
- **判定（已证实）**：根 `main.js`（1,388,110 B）与 ASAR 内 `dist-electron/main.js`（1,388,065 B）**差 45 字节且内容不同**；两侧 CRLF 数相同（35964），故**不是行尾问题，是真实内容分叉**。
- **含义**：这是"Electron 层双份人工维护"（D-005/E-106 曾标为"未证实但高度可疑"）的**直接证据**。且失败断言正是"必须共享同一段协议块"——说明**有人已经预料到会漂移并写了护栏，护栏现在红了**。
- **风险**：改哪一份都不会自动同步；`issueAdaptiveCapability` 与 `ADAPTIVE_IMAGE_PATHS` 只存在于根副本 → **ASAR 运行时可能缺少这段能力签发逻辑**。
- **新编号**：BUG-0010。

### FAIL-3 `.next/.../flashcard/flashcard-adaptive-evidence-smoke-test.js` —— 能力令牌降级路径回归
```
Error: stage_c_request_uncertain
  at Object.l [as signed] (evalmachine.<anonymous>:1:1701)
  at async frontendChecks (...flashcard-adaptive-evidence-smoke-test.js:202:3)
```
- **失败位置**：测试第 **202** 行，即"**legacy fallback**"场景——`window.electronAPI` **没有** `getAdaptiveCapability` 时，应退回旧的 raw-account 模式（断言保留 `X-Account-Id: raw-account`、剥除调用方 `Authorization`），并且**只发一次请求**。
- **实际**：没有降级，而是抛出 `stage_c_request_uncertain`。
- **根因线索**：前端能力助手在 bundle 中的实现为
  ```js
  async function l(e,t){try{return await n(e,t)}catch(e){if(e?.name==="AbortError")throw e;throw Error("stage_c_request_uncertain")}}
  ```
  即**把任何非 Abort 错误一律归一为 `stage_c_request_uncertain`**（意图是"不泄漏含 token 的原始错误"——测试也断言了这点）。降级分支因此被吞掉。
- **两种可能（待判）**：
  - (a) `tools/synchronize-frontend-capability-helper.js` 的补丁**改坏了降级分支**；
  - (b) 补丁是对的，**测试是旧的**（helper 语义有意变更）。
- **为什么一直没人发现**：**该测试在 `.next/` 下，而 `run-smoke-matrix.js` 明确跳过 `.next`** → 这条失败可能已存在多时。
- **新编号**：BUG-0011。

---

## 3. 这次实跑"证实"了什么（把推断升级为事实）

| 此前结论 | 此前强度 | 现在 |
|---|---|---|
| 多份打包产物并存且危险（E-049/Q-006） | 合理推断 | **已证实**（FAIL-1） |
| Electron 层双副本会漂移（E-106） | 未证实 | **已证实**（FAIL-2） |
| smoke 矩阵跳过 `.next`，chat/前端改动缺保护 | 记忆条目 + 静态阅读 | **已证实**（FAIL-3 正是在被跳过区） |
| 145 个测试基本可用、多数自包含 | 假设 | **已证实**（140 通过，无需网络/应用） |
| 测试不写用户数据、不调真实 API | 假设 | **已证实**（本轮环境无 `SOCRATOPIA_*`，全部跑通） |

## 4. 这次实跑"未证实"什么

- **BUG 台账 §1 的 7 条修复**：本轮只跑了它们的测试，**没有逐条对应验证**。要升级到"通过针对性验证"，需针对每条跑指定测试并核对修复点（见 §6）。
- **运行时行为**：全部未启动应用 → 无端到端验证。**"应用能正常启动并上课"仍未经本轮检验。**
- **触网路径**：3 个 TTS live 自跳过 → 语音链路对真实 TPU/TTS 服务的依赖未验证。
- **劫持式挂载是否生效**（Q-026）：本轮未启动应用，无法确认。

---

## 4b. 基线更新（2026-09-14 V-4 后）

BUG-0012 修复（`auto-advance.js` 重试加宽）**新增 1 个回归测试**，全量复跑结果：

| 来源 | 总数 | PASS | FAIL | SKIP |
|---|---|---|---|---|
| `run-smoke-matrix.js` | 121 | 117 | 2 | 2 |
| `.next` 手工补跑 | 25 | 24 | 1 | 0 |
| **合计** | **146** | **141** | **3** | **2** |

**失败项与修复前完全相同**（BUG-0009 / BUG-0010 / BUG-0011）→ **零回归**。
**新基线值 = 146 例 / 141 通过 / 3 失败 / 2 跳过**；后续验收通过数不得低于 141，失败数不得增加。

## 5. 交给阶段 E 的基线值

- **回归基线（更新版）**：**146 例 / 141 通过 / 3 失败 / 2 跳过**（V-4 后）。原 145/140/3/2 为 V-1 基线。**阶段 E 任何改动后的验收必须 ≥这个数，且 3 个失败要么修好要么有明确豁免理由。**
- **3 个失败即 3 个待修项**，优先级建议：FAIL-2（ASAR 漂移，影响 Electron 运行时正确性）> FAIL-1（发布暂存不可用）> FAIL-3（降级路径）。三者都**成本低、可验证、可回滚**。
- **复现命令已固化**（§0），任何人可重跑。

---

## 6. 建议的下一步验证（尚未执行）

1. 针对 BUG-0001 ~ BUG-0007 各跑其对应 smoke，并在台账中把状态从"有修复代码"升级或降级。
2. 启动一次应用（`./Socratopia.exe`）做冒烟：确认 server 起得来、劫持挂载生效（查 `[kb-progress]` 日志）、课堂能发一轮。
3. 若需验证语音：设 `SOCRATOPIA_RUN_TTS_LIVE=1` 并确保本地 TTS 服务在 `127.0.0.1:8000`。
4. 用 `tools/verify-clean-win-release.js <target>` 复核 FAIL-1。

---

## 7. 证据
E-300 执行命令与环境（§0）
E-301 `outputs/smoke-baseline-20260914.json`（矩阵完整 JSON 报告，含每个用例的 exitCode/耗时/stderr）
E-302 FAIL-1 完整 stderr（`MODULE_NOT_FOUND: ./lib/knowledge/daimon-bridge.js`，requireStack 指向 `release/win-unpacked/.../[eval]`）
E-303 FAIL-2 完整断言 diff（`issueAdaptiveCapability`、`ADAPTIVE_IMAGE_PATHS` 仅存在于根副本）
E-304 FAIL-3 完整堆栈（测试 :202 legacy fallback 场景）
E-305 `wc -c main.js` = 1388110 / `_asar_extracted/dist-electron/main.js` = 1388065
E-306 3 个 TTS live 自跳过输出（`set SOCRATOPIA_RUN_TTS_LIVE=1`）
E-307 2 个 SKIP 为矩阵设计内（`pdf-(cmap|render)-real`，exit 2）
E-308 `chat/route.js` 相关 7 个 `.next` 测试全部 PASS（含 `chat-end-class-integration`、`adaptive-chat-dispatcher`）
E-309 8 个前端 `.next` 测试 PASS，唯 FAIL-3 例外
E-310~E-312 见 `EVIDENCE.md` T 节
