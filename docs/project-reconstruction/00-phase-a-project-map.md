# 阶段 A：项目地图

日期：2026-09-14
状态：**完成**
证据引用见 `EVIDENCE.md`；未决问题见 `OPEN-QUESTIONS.md`。

---

## A.1 当前目录是什么

`E:\huanjing\sogeladi\Socratopia`（WSL `/mnt/e/huanjing/sogeladi/Socratopia`）。

- **已证实**：这是 Electron + Next.js 桌面应用的 **Windows 打包产物**，用 electron-builder 产出（根目录有 `Socratopia.exe` 213MB、`Uninstall Socratopia.exe`、`resources.pak`、`v8_context_snapshot.bin`、`locales/`、`*_percent.pak` 等标准 Electron 运行时文件，`resources/app.asar` 存在）。E-040~E-053。
- **已证实**：**无构建流水线**。无 `src/`、无 `tsconfig`、无 `webpack.config`。所有应用逻辑都在编译输出里。
- **已证实**：仓库根 `package.json` 只声明 `acorn`（用于语法检查），运行时依赖在 `resources/server/package.json`。

### 工作区状态（E-004）
git 分支 `codex/push`，**存在大量未提交修改**：`main.js`、`preload.js`、`resources/server/**`（含 34 个 route、多个 lib、多个 smoke）、`win-unpacked/**`、以及删除 `fix-asar-integrity.js`、`probe.err/out`。
→ **本轮一律不动**，避免覆盖用户进行中的修改。

## A.2 材料分布与可访问性

| 类别 | 位置 | 可访问性 | 对哪些问题有用 |
|---|---|---|---|
| Git 历史 | `.git/` | 可访问，但仅 2026-06-17 起 19 提交 | 历史原因（近期）、BUG 台账 |
| 指令文件 | `AGENTS.md`、`CLAUDE.md` | 可访问，互相冲突 | 架构、约束、命令 |
| 中文方案/报告 | `方案.md`(99KB)、`ADAPTIVE_TEACHING_MODE_TECHNICAL_REPORT.md`、`PRACTICE_FEATURE_TECHNICAL_PLAN_*.md` | 可访问，未读 | 产品愿景、模块设计 |
| 专题档案 | `PROJECT_MATH_SPEECH_DOSSIER/`(8md) | 可访问，未读 | 产品背景、技术风险 |
| 变更/修复记录 | `TTS_OPTIMIZATION_CHANGELOG.md`、`AUTO_ADVANCE_WINDOW_REPAIR_CHANGELOG.md`、`LLM_THINKING_FIX_CHANGELOG.md`、`POST_CLASS_SAVE_FIX_2026-09-13.md`、`DEEPSEEK_V4_*.md` | 可访问，未读 | BUG 台账、历史原因 |
| 研究/验收产物 | `outputs/`（含 8 版 OCR 方案、安全审计、用量 csv、多轮验收目录） | 可访问，未读 | 实验史、技术债 |
| 服务端手写代码 | `resources/server/lib/`、`resources/server/server.js` | 可访问 | 当前实现 |
| 服务端编译代码 | `.next/server/app/api/**/route.js`(34)、`.next/server/chunks/`(27) | 可访问 | 当前实现 |
| 前端编译代码 | `.next/static/chunks/`、`.../app/` | 可访问 | 当前实现、UI 流程 |
| 维护脚本 | `tools/`(24) | 可访问 | 历史修复手段、验证方式 |
| 被删历史文档 | git 对象内 `RENAME.md`、`改动日志.md` | **可从 git 取回** | **早期历史** |
| 外部副本 | `/e/huanjing/AAA/`、`win-unpacked/`、`release/win-unpacked/` | 可访问 | 版本对比 |
| 源码仓库 | `socralab-app/v2` | **不存在本机副本（用户 2026-09-14 确认）** | 重构可行性 |
| 兄弟副本 | `Socratopia_2.0/Socratopia` | **不存在** | — |

## A.3 本目录与外部副本的关系

- **`win-unpacked/`**（E-049）：仓库内的第二份打包产物（目录 2026-08-26，内含 `resources/app.asar` 1389384B）。被 git 跟踪（`a86f4ca` 提交过其 `bundled-content`）。
- **`release/win-unpacked/`**（E-049）：第三份（2026-08-29）。
- **`/e/huanjing/AAA/`**（E-071）：**仓库外的独立部署**，`Socratopia Reproduction.exe`（2026-07-23）+ `Start-Socratopia.cmd` 用 `SOCRATOPIA_DESKTOP_DATA_DIR` 指向自带 `project-data/`。命名含 "Reproduction"，疑似"可复现演示包"。
- **`resources/`**：当前主运行目录，`app.asar` 为 2026-09-01（最新）。
- **`socralab-app/v2`**：macOS 源码仓库，**本机不可见**（Q-002）。

> 待确认（Q-006）：`./Socratopia.exe` 启动时实际加载哪一份 app.asar。这直接决定"改哪里才生效"。

## A.4 技术目录与运行入口地图

```
Socratopia.exe (Electron, 213MB)
  └─ resources/app.asar
       ├─ package.json
       └─ dist-electron/{main.js, preload.js}
            ├─ 派生 Next.js 子进程，cwd = resources/server/，监听 127.0.0.1:<port>
            └─ BrowserWindow ← preload.js → window.electronAPI(IPC)
resources/server/
  ├─ server.js            手写入口，装 global.* 注入契约
  ├─ lib/                 手写子系统（18 目录 + 顶层模块 + 146 个 smoke 文件）
  ├─ .next/server/app/api/**/route.js   34 个 API handler
  ├─ .next/server/chunks/               27 个 webpack chunk（模块 64092 重复定义）
  ├─ .next/static/chunks/               前端 bundle（含人工命名补丁 chunk）
  ├─ release-runtime-manifest.json      494KB 运行时清单
  ├─ .system/  public/                  未检查
  └─ deps.zip 36MB
```

**三层编辑规则**（来自 AGENTS.md，需以 Q-004 实测修正）：
1. Electron 层 → 改 ASAR 内 `dist-electron/*`，重打包 + 修 integrity。
2. Next 服务端 → 改 `resources/server/`（生效路径待 Q-004 确认）。
3. React 前端 → 改 `.next/static/chunks/**`。

## A.5 全局注入契约（架构关键关系）

`server.js` 在 Next 启动前把配置与模块挂到 `global.*`，编译 chunk 无法 `require()` 时改读 global：

`__SOCRATOPIA_SETTINGS__`、`__SOCRATOPIA_SET__`、`__FS__`、`__ROUTE_AUTH__`、`__SOCRATOPIA_REQUEST_AUTH__`、`__MODEL_ROUTER__`、`__ADAPTIVE_TEACHING_RUNTIME__`、`__PRACTICE__`、`__RESUME__`、`__KB_PROGRESS__`、`__KB_DISTILL__`、`__KB_BUILDER_COORDINATOR__`、`__CLOSE_READING__`、`__AUTO_ADVANCE__`、`__COMPANION_CONTINUITY__`、`__PDF_OCR_COORDINATOR__`、`__OCR_VISION_BUDGET__`、`__RULES_DIR__`、`__PATH__`、`global.fetch`（被 `responses-api-compat.js` 猴补丁）。

> 本表来自 `CLAUDE.md`，**标记为"合理推断"直到在 `server.js` 中逐条核实**。

## A.6 产品模块初步清单（来自路由与 lib，待阶段 C 建档）

**用户能力向**：课堂对话/教学、自适应教学与诊断、练习、精读、课本导入与 OCR、知识库构建、长推理、语音 TTS、数学语音、日记/闪卡/概念摘要、同伴（companion）、群聊、论坛、世界与角色、账号与资料、统计。

**支撑能力**：模型路由、LLM 网关、提示缓存、鉴权与能力令牌、会话续接（resume）、进度保护、自动推进、数据存储与迁移、PDF 协调、窗口管理、发布清单。

## A.7 历史资料覆盖范围与缺口

- **覆盖**：2026-06-17 ~ 2026-08-30 的 19 个提交（含可直接取回的删除文档）。
- **覆盖（非 git）**：2026-06-02 ~ 2026-09-13 的根目录文档与 `outputs/` 产物，提供**功能维度的历史**，但缺"为什么"。
- **缺口**：
  - 约 2026-03 ~ 2026-06 的历史（用户称项目约半年）→ 若 `方案.md` 与 `改动日志.md` 未覆盖，则基本无据（Q-003、Q-012）。
  - 源码仓库与兄弟副本（Q-001、Q-002）。
  - 发布历史（无 tag、无 release notes）。

## A.8 后续调查批次（建议顺序）

| 批次 | 主题 | 产出 |
|---|---|---|
| B-1 | 取回被删文档 + 读 `方案.md`/DOSSIER/背景 | `03-timeline.md` 初稿、`01-product-vision-and-evolution.md` 初稿 |
| B-2 | 愿景与演变定稿 | `01-*.md` 定稿 |
| C-1 | 实测 Q-004（server 部署路径）+ Electron 层 + 启动/窗口/账号 | `02-module-dossiers/electron-runtime.md` |
| C-2..C-n | 逐模块建档（按用户流程分组，每批 1~3 个模块） | `02-module-dossiers/*.md` |
| D-1 | git 19 提交逐条展开 | `03-timeline.md` |
| D-2 | 从 CHANGELOG/FIX 文档与 outputs 建 BUG 台账 | `04-bug-ledger.md` |
| E-1 | 技术债与失效文档评估 | `05-*.md`、`07-*.md` |
| E-2 | 重构路线 | `06-refactor-roadmap.md` |

## A.9 本阶段实际执行的验证

- `ls` / `find` / `rg --files` 级别目录勘察：已执行。
- `git log/status/branch/tag/stash/show --name-status`：已执行（只读）。
- **未执行**任何 smoke test（本批未改代码）。
- 结论来源：**全部为静态调查 + 目录/版本控制元数据**，无运行时验证。
