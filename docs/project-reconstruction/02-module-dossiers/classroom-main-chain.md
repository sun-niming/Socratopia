# 模块档案：课堂主链路（`/api/chat` 及其守卫链）

> 阶段 C 档案 3/…（批次 C-3b，2026-09-14）。证据 E-180 ~ E-196。
> **本模块特点：本体件被分支改写最狠（`chat` 属 22 个被改写的原路由），且分支用"劫持式挂载"而不是直接改路由。**

---

## 1. 用途与所属流程

用户可见的**主课堂**：伙伴按教材推进授课、提问、翻页、下课保存。这是产品的核心流程，也是 L2 全部改造的落点。

**典型用户流程**：选世界/角色 → 打开教材 → 上课（流式回复 + 语音）→ 教材按进度游标翻页 → 下课并保存（进度锚定 + 记忆写入）。

## 2. 实现位置（两条腿：本体路由 + 分支外挂链）

| 层 | 路径 | 规模 | 归属 |
|---|---|---|---|
| 本体路由 | `.next/server/app/api/chat/route.js` | 184 KB | **本体**，分支就地改写 |
| 分支外挂 | `lib/progress/kb-progress.js` | 1557 行 | **分支新增** |
| 分支守卫 | `lib/progress/progress-guard.js` | 235 行 | 分支新增 |
| 分支任务态 | `lib/progress/classroom-task.js` | 518 行 | 分支新增 |
| 分支游标 | `lib/markdown/progress-cursor.js` | 251 行 | 分支新增 |
| 分支自动推进 | `lib/reading/auto-advance.js` | 1743 行 | 分支新增 |
| 分支精读分流 | `lib/close-reading/*`（在 `kb-progress` 外层拦截） | 15 文件 | 分支新增 |
| 课堂规则文本 | `resources/rules/rules_zh.md`（830 行）、`rules_zh_classroom_compact.md`（130 行）、`rules_en_classroom_compact.md`（140 B） | — | **本体（中文）** |

`chat` 路由内的分支锚点计数（实测）：`__PROGRESS_GUARD__` 9、`__MD_CURSOR__` 15、`PROGRESS_MD` 20、`read_textbook` 13、`__AUTO_ADVANCE__` 6、`__CLOSE_READING__` 6、`__CLASSROOM_TASK__` 1、`__ADAPTIVE_TEACHING_RUNTIME__` 1。`__KB_PROGRESS__` = **0**（见 §3）。

## 3. 最关键架构事实：劫持式挂载（已证实，E-184）

`kb-progress.js` **不改 chat 路由文件**，而是猴补丁 Node 模块加载器：

```js
function installRouteRequireHook() {
  if (global.__KB_PROGRESS_ROUTE_HOOK__) return;
  var Module = require("module");
  var originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    var exported = originalLoad.apply(this, arguments);
    if (/\/app\/api\/chat\/route\.js$/.test(normalized)) {
      Module._load = originalLoad;          // 一次性恢复，只包一次
      installRouteWrapper(exported);        // 包住 exported.POST
    }
    return exported;
  };
}
```

由 `server.js:901-903` 触发。效果：chat 的 POST 被**外层包裹** = 精读分流 → 进度守卫 → 课前上下文准备 → 执行 → 课后提交。

**这是"读 chat route 源码却看不到主逻辑"的原因**，也是本模块最重要的认知点：
- 想理解课堂实际行为，**必须读 `kb-progress.js`**，不能只读路由文件。
- 若哪天重打包改变了 chunk 布局或 `Module._load` 语义，这条挂载会**静默失效**（无测试会报"挂载没生效"，只会表现为进度不再受控）。

## 4. 规则文本的加载（E-180/E-181）

`chat/route.js` 内 `m()` 的加载顺序：
1. 若 `noEnd` 模式且 `__RULES_DIR__` 存在 → 读 `rules_<lang>_classroom_compact.md`
2. 否则读 `rules_<lang>.md`
3. 校验：长度 ≥ 100 且 `trimStart().startsWith("#")`，否则视为无效
4. 本地都无效 → 回退 HTTP `${SOCRATOPIA_PROXY_URL}/rules?lang=...`（10s 超时，transient 时再试一次 15s）
5. 成功缓存 **1 小时**；失败负缓存 30s

语言映射：`"english"→"en"`、`"chinese-traditional"→"zh-TW"`、其余 → `"zh"`。

**发现（E-182，重要）**：
- `rules_en_classroom_compact.md` 只有 140 字节，正文是 **`# Test classroom rules`** —— 是个**测试桩**。但由于它 ≥100 字符且以 `#` 开头，**会通过校验被英文课堂实际加载**。
- `resources/rules/` 下**只有 `rules_zh_classroom_compact.md` 被 git 跟踪**；**830 行的主规则 `rules_zh.md` 未被跟踪**（`.gitignore` 的 `resources/rules/*` 规则）。
- `server.js:870` 有一段"种子复制"逻辑：启动时把 `CONTENT_ROOT/../rules` 的文件复制进 `__RULES_DIR__`（仅当目标不存在）。

→ 结论：**中文课堂的实际行为由一份未进版本控制的 830 行文本决定**。改规则不会留下任何历史。

## 5. 进度体系（分支新增，设计最重的一块）

### 5.1 机制
- **进度标记**：助手输出中嵌入 HTML 注释 `<!-- kbProgress:{...} -->`（`MARKER_OPEN` / `MARKER_RE`），由 `createStreamStripper()` 在流式过程中剥除，不让用户看到。
- **游标持久化**：`lib/markdown/progress-cursor.js`，`progress_state.json`，`SCHEMA_VERSION = 2`，按 `chunkIdForPage(page)` 分块，`writeJsonAtomic` 原子写，另有 `mirrorLegacyPageFields()` 兼容旧字段。
- **守卫**：`lib/progress/progress-guard.js` — `computeTeachingRange()` / `allowedNextStart()` / `evaluateCommit()` / `endClassAnchor()`。
- **提交**：`commitAssistantProgress()`、`commitExerciseProgress()`、`validateProgressMarker()`、`validatePageMarker()`。
- **任务态**：`lib/progress/classroom-task.js` — `classroom-task.json`，`MAX_QUEUE=40`，两种模式 `lecture` / `exercise`，用正则识别模式切换意图（`LECTURE_INTENT_RE` / `EXERCISE_INTENT_RE`）与"章末习题"区段。

### 5.2 `progress-guard` 的四条出口
| 函数 | 作用 |
|---|---|
| `computeTeachingRange(state)` | 算出允许讲授的范围 |
| `allowedNextStart(current, nextStart, opts)` | 限制下一页起始点，防跳跃 |
| `evaluateCommit(current, loadedRange, signal)` | 判定一次提交是否合法 |
| `endClassAnchor(opts)` | 下课时归一化锚点 |

对应 `RENAME.md` 记载的四条原则（E-080）：模型可组织讲法但不能宣布讲完未覆盖内容；页/范围/阶段由服务端守卫约束；下课必须先绑定状态并归一化；恢复时优先读持久化锚点。

### 5.3 自动推进
`lib/reading/auto-advance.js`（1743 行）—— 被 `chat`、`jump-page`、`reading-context` 三个路由消费。含 `pendingAdvanceVerified()`、`hasAdvanceHoldIntent()`、`adoptableExternalReading()`、`readProjectionJson()` 等。
对应修复史：`732fac0`、`adc66db`、`a86f4ca`（"Preserve reading projections across conversation transitions"）与 `AUTO_ADVANCE_WINDOW_REPAIR_CHANGELOG.md`（E-020）。

## 6. 与其他模块的关系

```
chat POST
 └─[kb-progress require-hook 包裹]
     ├─ close-reading 分流（命中则短路，不进课堂链）
     ├─ 进度守卫 / 游标 / 任务态
     ├─ adaptive 决策（__ADAPTIVE_TEACHING_RUNTIME__）
     ├─ 原 chat 主体（本体）：Prompt 组���、工具调用、SSE、TTS
     └─ 课后提交：进度锚点 + companion-continuity（下课记忆）+ resume
```
上游：`route-auth`（门禁）、`account-request-context`（账号）、`model-router`/`llm-gateway`（模型）、`__RULES_DIR__`（规则文本）。
下游：`progress-cursor` → `progress_state.json`；`classroom-task` → `classroom-task.json`；`auto-advance` → 投影文件。

## 7. 实现与验证状态

- **实现**：活跃，2026-06-25 ~ 09-13 持续有提交与修复记录。
- **测试资产**：`progress-guard-smoke-test.js`、`kb-progress-smoke-test.js`、`kb-progress-sse-smoke-test.js`、`auto-advance-smoke-test.js`、`auto-advance-race-smoke-test.js`、`auto-advance-window-recovery-smoke-test.js`、`auto-advance-teaching-state-machine-smoke-test.js`、`progress-cursor-smoke-test.js`、`exercise-mode-smoke-test.js`、`classroom-task` 相关、`.next/.../chat/chat-end-class-integration-smoke-test.js`。
- **⚠️ 已知陷阱（记忆条目佐证）**：`tools/run-smoke-matrix.js` **不覆盖 `.next/` 下的测试**，因此 chat route 的 smoke test **从不在矩阵里跑**；改 `chat/route.js` 后必须手动跑。
- **本批未执行任何 smoke**。

## 8. 重复、耦合、遗留与重构建议

| 项 | 说明 |
|---|---|
| **劫持式挂载不可见** | `Module._load` 补丁是最大认知陷阱与最脆弱点。**建议**：至少加一个"挂载生效"自检（启动时校验 `POST` 已被包裹并打日志） |
| **主规则文本未跟踪** | 830 行 `rules_zh.md` 不在 git 里。**建议**：调 `.gitignore` 白名单纳入 |
| **英文规则是测试桩** | `rules_en_classroom_compact.md` = "# Test classroom rules"。**建议**：确认为有意还是遗漏（Q-025） |
| **单文件巨石** | `kb-progress.js` 1557 行 + `auto-advance.js` 1743 行，职责混合（读盘、解析、流处理、提交）。**建议**：按"解析 / 决策 / IO"拆分 |
| **隐式契约多** | 进度标记语法、`classroom-task.json`、投影文件、`progress_state.json` 版本字段之间靠约定，失败静默 |
| **本体/分支交错** | `chat/route.js` 同时含本体逻辑与分支锚点，改一处易碰另一处 |

## 9. 证据
E-180 规则加载函数 `m()`/`o()`/`p()`（`chat/route.js`，锚点 `rules_` + `__RULES_DIR__`）
E-181 `server.js:870` 规则种子复制 + `__RULES_DIR__` 定义
E-182 `resources/rules/` 三文件大小/行数与 git 跟踪状态；`rules_en_classroom_compact.md` 内容为 `# Test classroom rules`
E-183 `git ls-files resources/rules/` → 仅 `rules_zh_classroom_compact.md`
E-184 `kb-progress.js` `installRouteRequireHook()` + `installRouteWrapper`（锚点 `__KB_PROGRESS_ROUTE_HOOK__`）
E-185 `progress-guard.js` 导出四函数
E-186 `progress-cursor.js` `STATE_FILE`/`SCHEMA_VERSION`/`chunkIdForPage`/`writeJsonAtomic`
E-187 `classroom-task.js` `MODE_LECTURE`/`MODE_EXERCISE`/意图正则/`TASK_FILE`
E-188 `auto-advance.js` `createAutoAdvance` 及消费方三路由
E-189 chat route 锚点计数（§2 表）

## 10. 待确认
- Q-025：英文规则桩是有意还是遗漏？谁在什么条件下会走 compact 分支（`noEnd` 的真实来源）？
- 劫持挂载在重打包后是否仍生效（需实跑）。
- `rules_zh_classroom_compact.md`（130 行，被跟踪的那份）与 `rules_zh.md`（830 行）的实际使用比例。
