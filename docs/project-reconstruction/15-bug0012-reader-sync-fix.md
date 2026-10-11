# BUG-0012 方向①落地：让读者不留跨 `await` 句柄（2026-09-20）

> 证据 E-441 ~ E-449。承接 `14-bug0012-fix.md` 附录（V-5 判定重试加宽无效）。
> **本轮第二次改业务代码**，按用户选定的方向①执行。

---

## 1. 改了什么（3 处，全部是"异步读 → 同步读"）

原理：`renameSync` 只在**目标被打开句柄**时 EPERM；而同步重试阻塞事件循环，使同进程异步 fd 的
`close()` 永远排不上队（`14-bug0012-fix.md` §11）。**那么只要读者不留跨 `await` 的 fd，自锁窗口就归零。**

| # | 文件 | 改动 | 覆盖测试 |
|---|---|---|---|
| 1 | `resources/server/lib/companion-continuity/transaction.js` `readTextOrNull()` | `await fsp.readFile` → `fs.readFileSync` | `transaction-smoke-test.js`（13 例） |
| 2 | `resources/server/lib/companion-continuity/end-class-commit.js` `readText()` | `await fs.promises.readFile` → `fs.readFileSync` | `end-class-commit-smoke-test.js` |
| 3 | `resources/server/.next/server/chunks/2751.js` `y()` | `JSON.parse(await (0,d.readFile)(c,"utf-8"))` → `JSON.parse((0,g.readFileSync)(c,"utf-8"))` | `chat-reading-window-truncation-smoke-test.js` |

三处**都是读 `textbook_index.json` 的路径**：
- #1 在事务提交时校验每个 target（`readTextOrNull(checked.target)`）；
- #2 在课后收尾时读改写 `textbooks/textbook_index.json`；
- #3 是 `y()`——被 `chat`/`reading-context`/`textbook`/`jump-page`/`groupchat` **五条路由**共用。

`chunks/2751.js` 内 `g` 已是 `require("fs")`（`g.existsSync` 在用），所以 #3 不需要新增 import，
不触碰"chunk 里不能 `require("fs")`"的约束。

**没改什么**：两个写入器（`auto-advance.js` / `kb-progress.js`）、`atomicWrite` 的语义、重试预算数值。
**预算不再动**——这正是 V-5 的结论。

### 枚举依据（为什么是这三处）
- `lib/` 全量扫 `await fs.promises.readFile|await fsp.readFile` → 只有 `end-class-commit.js:54`、`transaction.js:69`、`resolver.js:102/213`、`kb-builder-coordinator.js:373`、`ocr/*` 命中；前两者直接读目标文件。
- `source-adapter.js` 早已全同步（`fs.readFileSync`/`existsSync`），无需改。
- `chunks/2751.js` 内 `await d.readFile` 只有 2 处，其中一处（教材导入读 md）不涉及目标文件。

---

## 2. 新增回归测试（判别力已证明）

`auto-advance-atomic-write-retry-smoke-test.js` 增加**场景 3**：
用一个同进程异步 `fsp.open` 句柄顶住目标文件，再跑 `runtime.bootstrap()`，断言**抛 EPERM**。

```
PASS survives a 6-deep EPERM burst (6 EPERM renames survived in 8 rename calls)
PASS still fails loudly beyond the budget (14 EPERM renames -> surfaced EPERM after 10 attempts)
PASS a same-process open handle burns the whole budget (open handle -> EPERM after the full budget)
```

场景 3 是把 R-23 钉死的断言：**只要有同进程打开的句柄，整条预算必被烧光**，
并因此告诉后人"再加预算没用"。

⚠️ 注意边界：场景 3 用的是"测试自己持有的句柄"，所以它**验证的是机制**，
**不能证明**生产里三处改动已消灭全部持有者。

---

## 3. 验证（零回归）

| 项 | 结果 |
|---|---|
| `node --check` × 3 个改动文件 | 全通过 |
| `transaction-smoke-test.js` | **13/13 ALL PASS** |
| `end-class-commit-smoke-test.js` | PASS |
| `resolver-smoke-test.js` | PASS |
| `chat-reading-window-truncation-smoke-test.js`（覆盖 chunks/2751） | PASS |
| `auto-advance-atomic-write-retry-smoke-test.js` | **3/3 PASS**（原 2 例 + 新 1 例） |
| **全量矩阵** `outputs/smoke-after-bug0012-v5.json` | **129 例 / 128 通过 / 1 失败** |
| **`.next` 手工补跑**（矩阵盲区） | **28 例 / 27 通过 / 1 失败** |

**两个失败都不来自本轮改动**：
1. `tts-classic-stream-zero-audio-live-smoke-test.js` —— `TypeError: fetch failed`，**本地 TTS 服务
   `127.0.0.1:8000` 当前未运行**（`curl` 无响应，E-447）。环境原因，曾 PASS。
2. `.next/.../flashcard-adaptive-evidence-smoke-test.js` —— **BUG-0011**，早已存在且本轮未触碰。

---

## 4. 意外观察：BUG-0009 / BUG-0010 已由**外部**修复

全量矩阵里这两条现在 `rawExitCode = 0`、`skipped = false`（此前分别是 FAIL），且已直接核实：

| BUG | 此前 | 现在 | 核实方式 |
|---|---|---|---|
| BUG-0009 发布暂存缺 `daimon-bridge.js` | FAIL（MODULE_NOT_FOUND） | **PASS** | `release/win-unpacked/resources/server/lib/knowledge/daimon-bridge.js` 已存在（24351 B，E-448） |
| BUG-0010 根 `main.js` 与 ASAR 副本漂移 | FAIL（差 45 B） | **PASS** | 两侧均 `1388110` B（E-449） |

**非本轮所为**（本轮只动上述 3 个文件 + 1 个测试）。时间上落在 2026-09-15 ~ 09-18，
与 WORKSTATE 记录的"`win-unpacked/` 于 2026-09-15T04:26Z 被整体重写"以及工作区里
`M main.js` / `M preload.js` 吻合。**来源与具体做法未取 commit 证据 → 归为"观察到已修复"。**

---

## 5. 生效、回滚与验收

- **生效**：三处都是 server 原地加载的文件，**重启 `Socratopia.exe` 即生效**；`chunks/2751.js` 也在
  server 目录下，同样只需重启，不涉及 ASAR 重打包。
- **回滚**：三处各自把 `readFileSync` 改回原异步写法即可（单行级，互不依赖）。
- **验收（与 V-5 不同的标准）**：**看时延特征，不看失败率**——
  - 成功路径应恢复为**远小于 1125ms**；
  - 失败事件的时延**不再整齐地聚在 1255ms**；
  - 若仍整齐聚在 1255ms，说明还有别的异步持有者（→ 继续 Q-054，或改走方向②/③）。
- ⚠️ **当前尚未有生效后的真实课堂数据**——本轮结束时应用刚重启，样本为 0。**不要把本轮写成"已修好"。**

---

## 6. 证据
E-441 改动点 #1：`transaction.js` `readTextOrNull` 由 `await fsp.readFile` 改为 `fs.readFileSync`（含 R-23 注释）
E-442 改动点 #2：`end-class-commit.js` `readText` 同上
E-443 改动点 #3：`chunks/2751.js` `y()` 改为 `(0,g.readFileSync)`；同 chunk 内 `g` 即 `require("fs")`，无需新 import
E-444 枚举依据：`lib/` 异步读扫描结果；`source-adapter.js` 已全同步；chunk 2751 仅 2 处 `await d.readFile`（另一处不涉目标文件）
E-445 新回归场景 3 输出（3/3 PASS）
E-446 矩阵 JSON `outputs/smoke-after-bug0012-v5.json`：129/128/1
E-447 唯一矩阵失败 `tts-classic-stream-zero-audio-live`：`fetch failed`；`curl 127.0.0.1:8000` 无响应
E-448 `.next` 补跑 28/27/1，失败为 BUG-0011
E-449 BUG-0009/0010 已由外部修复的直接核实（staged 文件存在；`wc -c main.js` = `_asar_extracted/dist-electron/main.js` = 1388110）
