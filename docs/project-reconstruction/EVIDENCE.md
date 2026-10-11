# 证据来源索引 (EVIDENCE)

> 每条证据给一个稳定编号 `E-nnn`，供专题文档引用。引用格式：`见 E-012`。
> 记录规则见 `DECISIONS.md` D-003 / D-007。

## 说明
- **路径**均为相对仓库根 `E:\huanjing\sogeladi\Socratopia`。
- **锚点**：压缩 bundle 不能只写"第 1 行"，要写可搜索字符串 / 模块 id / 函数名。
- 无 Git 的副本要注明来源目录，必要时记文件哈希。

---

## A. Git 仓库基线

| 编号 | 类型 | 内容 | 用途 |
|---|---|---|---|
| E-001 | git | 仓库根 `E:\huanjing\sogeladi\Socratopia`，分支 `codex/push`（另有 `master`、`codex/test`、`feature/adaptive-teaching-spike`），无 tag，无 stash | 确认 git 可用、历史极短 |
| E-002 | git | 根提交 `b7ad6eb` 2026-06-17 `Initialize lightweight patch repository`；共 19 个提交，最新 `4f1f907` 2026-08-30 | **git 历史只覆盖 2026-06-17 起**，项目更早历史不在 git 中 |
| E-003 | git | 全部提交作者均为 `逆铭`，日期跨度 2026-06-17 ~ 2026-08-30 | 历史细化梳理范围 |
| E-004 | git status | 工作区存在大量未提交修改（`main.js`、`preload.js`、`resources/server/**`、`win-unpacked/**`、删除 `fix-asar-integrity.js` 等）| 用户现有修改，本轮只读保护 |

### 完整提交列表（E-002 展开）
```
4f1f907 2026-08-30 Improve Socratopia packaged application behavior
a86f4ca 2026-08-28 Preserve reading projections across conversation transitions
06c0256 2026-08-26 Remove outdated project history and harden auth smoke coverage
6a91a0b 2026-08-25 Update packaged Socratopia application bundles
2c09aca 2026-08-23 Add secure adaptive auth capability handshake
7b5f473 2026-08-19 Extend adaptive concept graph prompt cache retention to 24 hours
ca07d17 2026-08-14 Update packaged application bundles
ef5e1dc 2026-07-21 Repair textbook extraction and teaching progress
f253e3a 2026-06-27 Tighten chat teaching rules
adc66db 2026-06-26 Refine chat auto-advance handling for markdown progress
ccebfe0 2026-06-26 Add preview launch configuration for Socratopia
1d25b3b 2026-06-26 Add progress-guard module + end-class anchor normalization
732fac0 2026-06-25 Anchor packaged teaching progress
42ce3de 2026-06-25 Restore Markdown raw-window teaching path
e53d153 2026-06-24 Finalize packaged teaching feature updates
c926129 2026-06-18 Add adaptive teaching data layer (Prompt 2)
9f72251 2026-06-18 Add route generator script + fix manifest formatting
6a3db1e 2026-06-18 Spike: verify new API route registration for adaptive teaching mode
b7ad6eb 2026-06-17 Initialize lightweight patch repository
```
> 注意："Update packaged ... bundles" 类提交（`6a91a0b` `ca07d17`）内容很可能覆盖大量前端改动，需要单独展开看 `--stat`。

---

## B. 根目录文档（产品/技术材料）

| 编号 | 类型 | 路径 | 大小/日期 | 初步判断 |
|---|---|---|---|---|
| E-010 | 文档 | `AGENTS.md` | 4031B / 2026-08-31 | 指令文件，**部分过时**（见 Q-001~Q-004） |
| E-011 | 文档 | `CLAUDE.md` | 8171B / 2026-09-11 | 指令文件，比 AGENTS.md 新，两者冲突 |
| E-012 | 文档 | `方案.md` | 99817B / mtime 2026-08-31，**文档内自述编写日期 2026-08-19** | 《Socratopia 自适应教学闭环实现方案》。**注意用文档内日期，不用 mtime** |
| E-013 | 文档 | `上下文.md` | 8575B / 2026-08-31 | **与 Socratopia 无关**：内容是 `C:\Users\ASUS\webserver` 的 C 语言 Web 服务器作业（见 Q-005） |
| E-014 | 文档 | `ADAPTIVE_TEACHING_MODE_TECHNICAL_REPORT.md` | 31491B / 2026-06-24 | 自适应教学模式技术报告 |
| E-015 | 文档 | `PRACTICE_FEATURE_TECHNICAL_PLAN_AND_CLAUDE_PROMPTS.md` | 23662B / 2026-06-24 | 练习功能技术方案 |
| E-016 | 文档 | `MATH_SPEECH_CORE_DEVELOPMENT_SPEC.md` | 32542B / 2026-09-02 | 数学语音核心开发规格 |
| E-017 | 文档 | `MATH_SPEECH_CORE_ACCEPTANCE_SPEC.md` | 27686B / 2026-09-02 | 对应验收规格 |
| E-018 | 文档 | `MATH_SPEECH_CORE_COMPLETION_REPORT.md` | 9196B / 2026-09-04 | 对应完成报告 |
| E-019 | 文档 | `TTS_OPTIMIZATION_CHANGELOG.md` | 14028B / 2026-09-12（已修改） | TTS 优化变更记录 |
| E-020 | 文档 | `AUTO_ADVANCE_WINDOW_REPAIR_CHANGELOG.md` | 18633B / 2026-09-11 | 自动推进窗口修复记录 |
| E-021 | 文档 | `LLM_THINKING_FIX_CHANGELOG.md` | 4943B / 2026-09-11 | LLM thinking 修复 |
| E-022 | 文档 | `POST_CLASS_SAVE_FIX_2026-09-13.md` | 10113B / 2026-09-13 | 课后保存修复 |
| E-023 | 文档 | `DEEPSEEK_V4_FLASH_CLASSROOM_CONTEXT_PLAN.md` | 12034B / 2026-09-12 | 课堂上下文方案 |
| E-024 | 文档 | `DEEPSEEK_V4_FLASH_CLASSROOM_CONTEXT_IMPLEMENTATION_CHECKLIST.md` | 21654B / 2026-09-13 | 对应实施清单 |
| E-025 | 文档 | `DEEPSEEK_V4_FLASH_CLASSROOM_ACCEPTANCE.md` | 7093B / 2026-09-12 | 对应验收 |
| E-026 | 文档 | `VOICE_MODEL_MAPPING_REPORT.md` | 12068B / 2026-06-05 | 语音模型映射，**日期早于 git 起点**，是早期材料 |
| E-027 | 文档 | `PROJECT_MATH_SPEECH_DOSSIER/`（8 个 md） | 2026-09-08 目录 | 数学语音专题档案，含 `01-project-background-and-prospects.md`（可能含产品背景） |
| E-028 | SQL/CSV | `outputs/deepseek-classroom-20260913-usage.csv` | 2026-09-13 | DeepSeek 用量数据 |
| E-029 | 文档 | `outputs/backend-security-audit-20260901.md` | 2026-09-01 | 后端安全审计 |
| E-030 | 文档 | `outputs/OCR_TRANSCRIPTION_PLAN*.md`（8 个版本） | — | OCR 方案多轮迭代，含大量重复版本 |
| E-031 | 文档 | `outputs/deepseek-classroom-20260913-diagnosis.md` | 2026-09-13 | 课堂诊断 |
| E-032 | 文档 | `outputs/prompt-cache-token-optimization-plan.md` | — | 提示缓存优化 |
| E-033 | 文档 | `outputs/companion-continuity-terra-implementation-plan.md` | — | 同伴连续性实施计划 |
| E-034 | 文档 | `resources/server/lib/math-speech/README.md` | — | 模块内 README |

> 完整清单见 `INVENTORY.md`。上表只列已定位者。

---

## C. 代码与运行入口

| 编号 | 类型 | 路径 | 用途 |
|---|---|---|---|
| E-040 | 代码 | `main.js`（根，1.39MB，esbuild 产物） | Electron 主进程产物；**运行时真实来源是 `resources/app.asar` 内同名文件** |
| E-041 | 代码 | `preload.js`（根，2547B） | IPC 桥；同样以 ASAR 内为准 |
| E-042 | 目录 | `_asar_extracted/` | 已解包的 ASAR 工作副本（gitignore） |
| E-043 | 代码 | `resources/server/server.js`（92KB） | Next.js 服务入口，加载 `global.*` 注入契约 |
| E-044 | 目录 | `resources/server/lib/` | 手写服务端模块（18 个子系统目录 + 大量 `*-smoke-test.js`） |
| E-045 | 目录 | `resources/server/.next/server/app/api/**/route.js` | 34 个 route.js（AGENTS.md 说 28，**已过时**） |
| E-046 | 目录 | `resources/server/.next/server/chunks/` | 27 个 webpack 服务端 chunk；`1576.js`/`4092.js` 含模块 64092 |
| E-047 | 目录 | `resources/server/.next/static/chunks/` | 前端 bundle（24 个顶层 + `app/` 子目录） |
| E-048 | 目录 | `resources/server/.next/static/chunks/app/` | 前端页面 chunk，含 `page-practice-ui-20260625-jyfix.js` 等**带日期/修复人名后缀的补丁产物** |
| E-049 | 目录 | `win-unpacked/` | 另一份打包产物副本，与 `resources/` 存在重复（见 Q-006） |
| E-050 | 目录 | `tools/` | 24 个维护脚本（补丁器、迁移器、smoke 矩阵） |
| E-051 | 目录 | `角色/` | 角色卡素材（`001-八重神子` … 编号命名） |
| E-052 | 配置 | `resources/settings.json` / `resources/set.json`（未提交） | 端点/密钥、role→model 映射 |
| E-053 | 文档 | `resources/server/release-runtime-manifest.json`（494KB） | 运行时文件清单 |
| E-054 | 目录 | `resources/server/.system/`、`resources/server/public/` | 待查 |

---

## D. 测试资产

| 编号 | 类型 | 内容 | 用途 |
|---|---|---|---|
| E-060 | 计数 | `find resources/server -name '*-smoke-test*'` 数量待精确统计（CLAUDE.md 称 118 个，AGENTS.md 称 20+） | 验证基线规模 |
| E-061 | 工具 | `tools/run-smoke-matrix.js` | 全量 smoke 执行器，单测 120s 上限，exit 2 归一为 PASS |
| E-062 | 工具 | `resources/server/smoke-test-utils.js` | 共享 HTTP + MockLLM 辅助 |
| E-063 | 前端测试 | `resources/server/.next/static/chunks/app/*-smoke-test.js`（8 个） | 前端逻辑测试，混在 chunk 目录里 |

---

## E. 兄弟副本

| 编号 | 类型 | 内容 |
|---|---|---|
| E-070 | 事实 | **`E:\huanjing\sogeladi\Socratopia_2.0\Socratopia` 不存在**。`/e/huanjing/sogeladi/` 下只有 `Socratopia/` 一个目录 |
| E-071 | 待查 | `/e/huanjing/AAA/Socratopia Reproduction.exe`（2026-07-23, 213MB）、`Start-Socratopia.cmd`（`SOCRATOPIA_DESKTOP_DATA_DIR` → 自带 `project-data/`）。仓库外独立部署 |
| E-072 | 事实 | 源码仓库 `socralab-app/v2` 在本机可见路径下**未找到**（待确认是否在别处） |

---

## F. 从 git 取回的被删材料（批次 B-1，2026-09-14）

> 这些文件在仓库工作区**已不存在**，但仍在 git 对象里。已导出为工作副本，方便无 git 阅读。
> 导出方式：`git show <父提交>:<路径> > docs/project-reconstruction/recovered/<名>`

| 编号 | 类型 | 原始路径 | 删除提交 | 导出副本 | 用途 |
|---|---|---|---|---|---|
| E-080 | **一等史料** | `RENAME.md`（201 行，自述《Socratopia 魔改历程》） | `06c0256` 2026-08-26 | `recovered/RENAME.md` | **项目自述开发史**：时间线、方向变化、工程规矩、放弃的方案。`03-timeline.md` 的骨架来源 |
| E-081 | **一等史料** | `改动日志.md`（193 行） | `06c0256` 2026-08-26 | `recovered/改动日志.md` | 知识源 Phase1/2、`/Close_Reading` P1 的**逐条改动+验证记录**（含核收指标编号） |
| E-082 | 文档 | `CLAUDE.md`（400 行） | `ca07d17` 2026-08-14 / `feb5ca9` | `recovered/CLAUDE-400line-2026-08.md` | 8 月版指令文件，比当前盘上版长得多，可能含更多架构细节 |
| E-083 | 文档 | `docs/knowledge-source-provider/计划书.md`（435 行） | `feb5ca9` / `ca07d17` | `recovered/knowledge-source-provider/计划书.md` | 多知识源 provider 分阶段计划 |
| E-084 | 文档 | `docs/knowledge-source-provider/核收指标.md`（180 行） | 同上 | 同名导出 | R1/R4/C4/R5/A6 等验收指标定义 |
| E-085 | 文档 | `docs/knowledge-source-provider/此对话上下文.md`（164 行） | 同上 | 同名导出 | 该专题的会话上下文 |
| E-086 | 文档 | `resources/server/lib/ocr/rapidocr-v5/README.md`、`THIRD_PARTY_NOTICES.md` | `06c0256` | 未导出 | 第三方 OCR 组件说明 |

---

## G. Git 仓库结构性发现（批次 B-1）

| 编号 | 类型 | 内容 | 影响 |
|---|---|---|---|
| E-090 | git | 除当前分支外还有：`master`（领先一条 `cb74cdd Scope practice data and tutoring sessions by account`，**未合入 codex/push**）、`codex/test`、`feature/adaptive-teaching-spike` | master 上有一条孤立提交 |
| E-091 | git | 4 个游离提交 `d986417` `8bfa3af` `5a0c495` `feb5ca9`（均 2026-08-12 `Codex worktree snapshot: archive-cleanup`），父提交分别是 `c926129`/`1d25b3b`/`1d25b3b`/`ef5e1dc`，**均不在任何分支 tip 上** | Codex 智能体的归档分支，未合回；`feb5ca9` 是 CLAUDE.md 与知识源文档的删除者 |
| E-092 | git | `fix-asar-integrity.js` 被 `4f1f907`(08-30) 删除；工作区仍显示未提交的删除 | 与文档仍引用该命令矛盾 |
| E-093 | **风险** | 只有 `AGENTS.md`、`方案.md`、`上下文.md`、`ADAPTIVE_TEACHING_MODE_TECHNICAL_REPORT.md`、`PRACTICE_FEATURE_TECHNICAL_PLAN_AND_CLAUDE_PROMPTS.md`、`TTS_OPTIMIZATION_CHANGELOG.md`、`VOICE_MODEL_MAPPING_REPORT.md`、`main.js`、`preload.js`、`package*.json`、`opencode.json`、`.gitignore`、`probe.err/out` 被 git 跟踪。**`CLAUDE.md`、所有 `*_CHANGELOG.md`/`*_FIX_*.md`/`DEEPSEEK_V4_*`/`MATH_SPEECH_CORE_*`、`PROJECT_MATH_SPEECH_DOSSIER/`、`角色/`、`tools/`、`outputs/` 全部未被跟踪** | 2026-08-31 之后的工作**几乎没有版本历史保护**；一次误删即永久丢失 |
| E-094 | git | `git fsck` 存在大量 dangling tree | 可能有更多可取回内容，尚未系统性翻查 |

---

## H. Electron 运行时（批次 C-1，2026-09-14）

> 探针文件：根 `main.js`（1388101 B）。ASAR 内副本 `_asar_extracted/dist-electron/main.js`（1388056 B）内容基本一致，**长度差 45 字节**，即二者不同步。

| 编号 | 类型 | 锚点（可直接搜索） | 内容 |
|---|---|---|---|
| E-100 | **实证** | `async function prepareServerDir()` / `function getBundledServerDir()` / `async function startServerOnce(port)` | **Q-004 判决**：server 原地运行 —— `prepareServerDir()` 返回 `path.join(process.resourcesPath,"server")`；`fork(path.join(serverDir,"server.js"))`，`cwd: serverDir` |
| E-101 | 实证 | `%APPDATA%/socratopia/server/.version`；`resources/server/.next/node_modules/` | 版本标记文件实测存在（5 B）；node_modules 目录实测存在于安装目录内 |
| E-102 | 实证 | `v109.md §主题 3`；`var serverPort = 3e3`；`HOSTNAME:"127.0.0.1"`；`requestSingleInstanceLock` | 启动参数与一份**不在仓库的版本化文档引用** `v109.md` |
| E-103 | 实证 | `function getUserDataPath()` / `function getBundledContentPath()` / `async function initUserData()` | `project-data` 在 userData 下、`bundled-content` 在 resourcesPath 下，两棵根分离 |
| E-104 | 实证 | `async function ensureNodeModules()` / `function wipeRuntimeServerDir()` / `function nodeModulesIntact()` | 自愈机制会 rm/替换 `resources/server/.next/node_modules`；app 会写自己的安装目录 |
| E-105 | 实证 | `SOCRATOPIA_ADAPTIVE_AUTH_ISSUER` / `audience:"adaptive-teaching"` / `prepareAdaptiveAuthSession` | 能力令牌签发侧（对应 `2c09aca`） |
| E-106 | 实证 | `count=0` 搜索 `SOCRATOPIA_DESKTOP_DATA_DIR`、`app.asar`、`spawn(` | `main.js` 不含这些字符串（→ Q-020） |
| E-107 | 实证 | `app.getPath("userData")` + `"project-data"` + `"tts-cache"` in `before-quit` | 退出时清理 tts-cache |

---

## I. 产品愿景一手材料（批次 B-2，2026-09-14）

| 编号 | 类型 | 路径 / 锚点 | 内容 |
|---|---|---|---|
| E-110 | **一手愿景** | `resources/bundled-content/zh/initial_world/world_preset.md`（68 行）；`en/`、`zh-TW/` 有对应副本 | **唯一完整的原始产品叙事**：《天性教育法之问》、`伙伴 + 苏格拉底 = 3X · 3A`、苏格拉底实验室、九人筛选、氛围指南。"十亿美元问题"、"评审委员会…至今还没有找到公认的答案" |
| E-111 | 实证 | `resources/bundled-content/*/initial_world/candidates/`（9 个 md）+ `world_preset_blank.md` | alice/holmes/huo_yunlai/lu_yumeng/meng_xu/qiu_lingni/sun_wukong/tao_li/wen_ying —— **与叙事中"九个人通过了考试"一致** |
| E-112 | 实证 | `PROJECT_MATH_SPEECH_DOSSIER/01-project-background-and-prospects.md` L5 | 产品定位一句话："Socratopia 是一个 Electron + Next.js 的学习陪伴软件。软件中的伙伴会通过 LLM 生成教学内容，再由 TTS 播放给学习者。" |
| E-113 | 实证 | `方案.md` L1-L6、L15-L16 | 《自适应教学闭环实现方案》，**日期 2026-08-19**，"待审批方案，尚未执行代码改造"，目标版本=当前打包产物。**L2 愿景的正式表述** |
| E-114 | 实证 | `方案.md` §2.2/§2.3 | 明示本体已有能力（课堂/群聊/日记/闪卡/论坛/世界/角色）与分支新增能力的**分界线索**：adaptive 系列、practice、概念图、诊断属新增；`/api/chat` 承载"人设、教材、工具、SSE、TTS、进度、精读和结课写入" |
| E-115 | 实证 | `ADAPTIVE_TEACHING_MODE_TECHNICAL_REPORT.md` L1-L10（2026-06-24） | 最早的自适应教学规划文档，明确"独立于当前普通聊天教学逻辑"、"本文件只做产品和技术分析" |
| E-116 | 实证 | `PRACTICE_FEATURE_TECHNICAL_PLAN_AND_CLAUDE_PROMPTS.md` L1-L15（2026-06-24） | 练习功能定位一句话："不是搜答案，而是把题讲到你会"；并明示本目录"不是完整源代码仓库"、源仓库 `socralab-app/v2`、**"如果只能在当前打包产物上热修…风险更高，不建议作为第一选择"** |
| E-117 | 实证 | `VOICE_MODEL_MAPPING_REPORT.md`（2026-06-05） | 最早的仓库内文档，语音链路分布调查（早于 git 起点） |
| E-118 | 实证 | `recovered/CLAUDE-400line-2026-08.md` | 8 月版指令文件（400 行），长于当前盘上版，待对比 |

---

## J. 应用本体身份与重建可能性（批次 B-3，2026-09-14）

| 编号 | 类型 | 锚点 | 内容 |
|---|---|---|---|
| E-120 | **实证** | `_asar_extracted/package.json`（ASAR 根） | 应用真实身份：`name: socratopia`、`version: "2.0.0"`、`description: "Socratopia — Socratic Roleplay Learning"`、`author: "Lemin"`、`main: "dist-electron/main.js"` |
| E-121 | **实证** | `_asar_extracted/package.json` dependencies（31 项） | **完整依赖清单**，Q-021 重建可行性的关键材料。含 `next 16.1.6`、`react 19.2.3`、`electron ^40.8.0`、`@anthropic-ai/sdk`、`openai ^6.27.0`、`@google/generative-ai`、`jose ^5.9.6`、`pdfjs-dist ^5.5.207`、`katex`、`electron-store`、`electron-updater`、`write-file-atomic`、`epub2`、`tailwindcss ^4.2.1` 等 |
| E-122 | 实证 | `resources/server/package.json` | 服务端侧依赖同样声明 `next 16.1.6` / `react 19.2.3` / `electron ^40.8.0` |
| E-123 | **实证** | `find resources/server -name "*.map"` → **0 个** | **完全无 sourcemap**。反推源码只能靠产物特征，不能靠 map |
| E-124 | 待确认 | `description: "Socratic Roleplay Learning"` | 本体方的产品定位措辞 —— 强调 **Roleplay（角色扮演）**，与 L1 的"伙伴/室友/实验室"叙事一致，与当前"教材轴课堂"偏离。可作 L1 第三条佐证（E-110/E-111 之外） |
| E-125 | 待确认 | `author: "Lemin"` vs git 作者 `逆铭`（E-003） | **是否同一人？** 若同人，则"原始 app 作者 = 本分支作者"，可解释为何分支能高效逆向自己的产物；若不同人，则是外部二次开发 |

---

## K. 用户口头答复（2026-09-14，无文件载体，须标注来源为"用户确认"）

> 这一类证据**无法从仓库材料自证**，引用时必须写明"用户确认"，不可与其他证据混同。

| 编号 | 主题 | 答复 | 影响 |
|---|---|---|---|
| E-130 | 源码仓库 | **无源码仓库**。本目录的编译产物就是唯一真源 | 确立硬前提 D-010；关闭 Q-002 |
| E-131 | 2026-03 ~ 06-17 | **"没有做什么"**；该区间是**功能注入的起始点**；"更多的不方便阐述" | 阶段 B/D 实质区间 = 2026-06-17 起；关闭 Q-003 主体；存在一类"外部背景"无法自证 |
| E-132 | `world_preset.md` 作者 | **原始团队** | E-110 正式确立为 L1 权威材料；关闭 Q-012 主体 |
| E-133 | 更早的需求文档/设计稿 | **无** | 阶段 B 不必再找更早愿景文档；E-110 是 L1 唯一权威来源 |

---

## L. 信息混乱的实证材料（批次 B-4，2026-09-14）

> 用于 `08-information-disorder-root-causes.md`。这些不是"感觉乱"，是**可清点的实物**。

| 编号 | 类型 | 锚点 | 内容 |
|---|---|---|---|
| E-150 | 实证 | `ls resources/settings*.json` | **一份配置四个文件**：`settings.json`、`settings - 副本.json`、`settings - 副本 (2).json`、`settings__.json`（另有 `set.json`）。全部未被 git 跟踪 |
| E-151 | 实证 | `ls outputs/ \| grep OCR_TRANSCRIPTION` | 同一方案 **9 个版本**：`_PLAN.md`、`_PLAN_REVIEWED.md`、`_PLAN_APPROVED.md`、`_APPROVED_V2..V6.md`、`_PLAN_FINAL.md` |
| E-152 | 实证 | `ls .next/static/chunks/app/ \| grep page-` | 前端页面 chunk 存在**人工命名覆盖层**：`page-practice-ui-20260622.js`、`page-practice-ui-20260625-jyfix.js`、`page-practice-ui-20260626-postclass-notes.js`，与 webpack 哈希名 `page-3a1fef7566e26c43.js` 并存 |
| E-153 | 实证 | `ls tmp/*.py` | 唯一副本脚本藏在"临时目录"：`import-character-library.py`、`optimize-character-templates.py`、`crop-import-avatars.py` 等，**全部未跟踪** |
| E-154 | 实证 | `ls outputs/ \| grep 2026`、`ls -d tmp/*2026*` | 以日期命名的工作快照目录：`character-import-20260913/`、`post-class-save-fix-20260913/`、`tts-zh-install-20260913/`、`tmp/character-templates-before-20260913/`、`tmp/legacy-personas-review-20260913/` 等 |
| E-155 | 实证 | `outputs/session-rubric-evaluation-*.md`(3)、`outputs/uncommitted-changes-fix-plan-2026-09-01.md` | 同主题多份并列评估；后者文件名直接叫"未提交改动修复计划" |
| E-156 | 实证 | 对比 E-011 与 E-010 | `AGENTS.md` 声称 `CLAUDE.md` 缺失（实际存在）；两者对 server 部署路径直接矛盾（E-100）；两者都引用不存在的兄弟副本（E-070） |
| E-157 | 实证 | `git ls-files`（E-093） | 根目录仅 16 个文件被跟踪；近半月全部文档、`tools/`、`outputs/`、`tmp/`、`角色/`、`PROJECT_MATH_SPEECH_DOSSIER/` 未跟踪 |
| E-158 | 实证 | `git log --all --not codex/push`（E-090/E-091） | 1 条 `master` 孤立提交 + 4 个游离 Codex 快照提交，**全部未合入** |
| E-159 | 实证 | E-092 | `fix-asar-integrity.js` 已删除，但 `AGENTS.md`/`CLAUDE.md` 仍教该命令；工作区仍是"未提交的删除" |
| E-160 | 实证 | E-017（`VOICE_MODEL_MAPPING_REPORT.md`） | 语音库在 `4137` 前端 chunk 与 `3461` 服务端 chunk **内容基本重复**，靠人工同步 |
| E-161 | 实证 | E-141 | `route-auth.js` 注释自述存在 **5 份内联 account-helper 副本**——两份指令文件均未记载 |
| E-162 | 实证 | E-012 | `方案.md` mtime 2026-08-31，文档内自述编写日期 **2026-08-19** → 文件名/时间戳不可信，只能读文档内日期 |

---

## M. 本体/分支能力边界（批次 C-3 前置，2026-09-14）

> 方法：以 git 根提交 `b7ad6eb`（分支起点）为基线做差集。偏差声明见 `09-original-vs-branch-boundary.md` §0。
> 检索式：`git ls-tree -r --name-only b7ad6eb` / `find` / `comm` / `git diff --name-only b7ad6eb HEAD`

| 编号 | 类型 | 内容 |
|---|---|---|
| E-170 | **实证** | 基线 `b7ad6eb` 共 339 文件；`resources/server/lib/` **仅 1 个**（`pdf-worker.mjs`）。基线含 `main.js`、`preload.js`、`resources/server/server.js`、`.next/` 全套 |
| E-171 | **实证** | 基线 API 路由 **27 个**：`account/init` `chat` `companion/avatar` `companion/reconcile-persona` `concept-summary` `conversations` `custom-companions`(+avatar,merge-persona) `diary` `flashcard` `forum` `groupchat` `jump-page` `lesson-summary` `pdf-assets` `profile`(+avatar,reset) `reading-context` `search` `stats` `system` `test-key` `textbook` `tts-audio` `world` |
| E-172 | **实证** | 盘上路由 34 vs 基线 27 → **新增 7、删除 0**。新增：`adaptive-concept-graph` `adaptive-diagnosis` `adaptive-teaching` `knowledge-source` `long-reasoning-demo` `math-speech` `practice` |
| E-173 | **实证** | `git diff --name-only b7ad6eb HEAD -- 'resources/server/.next/server/app/api'` → **22 个基线路由被分支就地改写** |
| E-174 | 实证 | `git diff --numstat b7ad6eb HEAD -- resources/server/server.js` → **+1038 / −141 行**（未含 9 月未提交部分） |
| E-175 | 实证 | `find resources/server/lib -type f` → **238** 个文件（基线 1 → 净增 237） |
| E-176 | 实证 | `git diff --name-only b7ad6eb HEAD -- 'resources/server/.next/static'` → 10 个前端 chunk 被改（另加 9 月未跟踪改动） |
| E-177 | 推论依据 | E-124 `description:"Socratic Roleplay Learning"` 与 §2 本体能力归类一致 → L1 愿景体现在**本体**里 |
| E-178 | **推论** | `AGENTS.md` 的"28 routes"≈ 基线 27 → 该文档主体疑似**上游沿用**，从未随分支更新（→ Q-023） |

### 边界结论（一句话）
**本体提供"世界/角色/课堂/群聊/日记/闪卡/论坛/统计"的产品骨架（27 路由）；分支做的是「在 22 个本体件上就地改写 + 新增 7 路由 + 从零建 237 个服务端模块」。** 详见 `09-original-vs-branch-boundary.md`。

---

## N. 课堂主链路（批次 C-3b，2026-09-14）

| 编号 | 类型 | 锚点 | 内容 |
|---|---|---|---|
| E-180 | 实证 | `chat/route.js` 中 `global.__RULES_DIR__` 附近的 `m()`/`o()`/`p()` | 规则加载：优先 `rules_<lang>_classroom_compact.md`（noEnd）否则 `rules_<lang>.md`；校验"长度≥100 且 trimStart 以 # 开头"；失败回退 HTTP `${SOCRATOPIA_PROXY_URL}/rules?lang=`；成功缓存 1h、失败负缓存 30s。语言映射 `english→en`/`chinese-traditional→zh-TW`/其余→`zh` |
| E-181 | 实证 | `resources/server/server.js:870` | `global.__RULES_DIR__=path.join(__dirname,"..","rules")`；同段落有启动时"种子复制"逻辑（由 `CONTENT_ROOT/../rules` 复制，目标不存在才复制） |
| E-182 | **实证** | `resources/rules/` | `rules_zh.md` 830 行（**未跟踪**）、`rules_zh_classroom_compact.md` 130 行（**唯一被跟踪**）、`rules_en_classroom_compact.md` **140 字节，正文 "# Test classroom rules"（测试桩）** |
| E-183 | 实证 | `git -c core.quotePath=false ls-files resources/rules/` | 仅 `resources/rules/rules_zh_classroom_compact.md`。`.gitignore` 的 `resources/rules/*` 导致主规则文本无版本历史 |
| E-184 | **实证** | `lib/progress/kb-progress.js` `installRouteRequireHook()` / `__KB_PROGRESS_ROUTE_HOOK__` | **劫持式挂载**：猴补丁 `Module._load`，一次性拦截 `chat/route.js` 的 require 并包裹其 `POST`。由 `server.js:901-903` 触发。→ 读 chat 路由源码看不到主逻辑 |
| E-185 | 实证 | `lib/progress/progress-guard.js`（235 行） | 导出 `computeTeachingRange` / `allowedNextStart` / `evaluateCommit` / `endClassAnchor` |
| E-186 | 实证 | `lib/markdown/progress-cursor.js`（251 行） | `STATE_FILE="progress_state.json"`、`SCHEMA_VERSION=2`、`chunkIdForPage`、`writeJsonAtomic`、`mirrorLegacyPageFields` |
| E-187 | 实证 | `lib/progress/classroom-task.js`（518 行） | `classroom-task.json`、`MAX_QUEUE=40`、`MODE_LECTURE="lecture"`/`MODE_EXERCISE="exercise"`、`LECTURE_INTENT_RE`/`EXERCISE_INTENT_RE`/`EXERCISE_ID_RE`/`EXERCISE_SECTION_RE` |
| E-188 | 实证 | `lib/reading/auto-advance.js`（1743 行） | `createAutoAdvance`、`pendingAdvanceVerified`、`hasAdvanceHoldIntent`、`adoptableExternalReading`；被 `chat`、`jump-page`、`reading-context` 三路由消费 |
| E-189 | 实证 | `chat/route.js`（184 KB）锚点计数 | `PROGRESS_MD` 20、`__MD_CURSOR__` 15、`read_textbook` 13、`__PROGRESS_GUARD__` 9、`__AUTO_ADVANCE__` 6、`__CLOSE_READING__` 6、`__CLASSROOM_TASK__` 1、`__ADAPTIVE_TEACHING_RUNTIME__` 1；`__KB_PROGRESS__` **0** |
| E-190 | 实证 | `lib/progress/kb-progress.js` 1557 行 | 进度标记 `<!-- kbProgress:{} -->` + `createStreamStripper()` 流式剥除；`prepareProgressContext`/`validateProgressMarker`/`commitAssistantProgress`/`commitExerciseProgress` 等 |

### 课堂链路结论（一句话）
**分支用"劫持 require 包裹 POST"的方式给本体 chat 路由挂上整条守卫链（精读分流 → 进度守卫 → 课前准备 → 执行 → 课后提交）。课堂上真正的中文教学行为由一份 830 行、未被 git 跟踪的 `rules_zh.md` 决定。** 详见 `02-module-dossiers/classroom-main-chain.md`。

---

## O. 自适应教学（批次 C-4a，2026-09-14）

| 编号 | 类型 | 锚点 | 内容 |
|---|---|---|---|
| E-200 | **实证** | `server.js` 中 `SOCRATOPIA_ADAPTIVE_ENABLED` / `SOCRATOPIA_ADAPTIVE_PROFILE_ALLOWLIST`；`server.js:957` | **默认关闭 + profile 白名单**；错误文案 "Adaptive teaching is not enabled for this profile" |
| E-201 | 实证 | `server.js` require 段 + `createOrchestrator({...})` | 只 require 6 个 adaptive 模块（orchestrator / chat-service / concept-graph-builder / diagnostician / data-layer / external-evidence-service）；注入 `builderCallLLM: createPromptCaller({task:"concept_graph",role:"strong"})`、`diagnosisCallLLM: ({task:"diagnosis",role:"weak"})` |
| E-202 | **实证** | `grep -rl "api/<route>" .next/static/chunks/` 计数 | 前端引用：`practice` **5**、`math-speech` 2、`adaptive-teaching` **1**、`adaptive-concept-graph` **0**、`adaptive-diagnosis` **0**、`knowledge-source` **0**、`long-reasoning-demo` **0** |
| E-203 | 实证 | `wc -l lib/adaptive/*.js` | 30 文件 / **10,057 行**；最大者 `diagnostician.js` 1062、`orchestrator.js` 1022、`concept-graph-builder.js` 932 |
| E-204 | **实证** | `grep -c "stage-d" resources/server/server.js` → **0** | `stage-d-*` 6 文件（约 727 行）**未被 server.js 引用** = 未接线实验 |
| E-205 | 实证 | `lib/adaptive/orchestrator.js` 导出 | 仅 `createOrchestrator` / `OrchestratorError`；实例含 `readiness()` |
| E-206 | **实证** | `page-3a1fef7566e26c43.js`，锚点 `adaptiveFetch` / `getAdaptiveCapability` / `adaptive_auth_unavailable` | 前端唯一 adaptive 业务接入点是通用适配器：取 Electron 能力令牌 → 带 `Authorization: Socratopia <cap>` POST |
| E-207 | 实证 | E-113 `方案.md` §2.3 第 1 条 | 原话："前端没有调用任何 adaptive API，自适应能力没有进入真实课堂数据流"（本批实测基本成立，E-202） |

---

## P. 分支其余功能模块（批次 C-4b，2026-09-14）

> 方法：`grep -rl "api/<route>" resources/server/.next/static/chunks/ | wc -l` 量化"前端接入度"。**基线值 5** = 仓库有 5 个主前端页面 chunk。

| 编号 | 类型 | 内容 |
|---|---|---|
| E-220 | **实证** | 全部 34 路由前端引用计数 | 命中 **5** 的 26 个（**全部本体路由** + `practice`）；命中 2：`math-speech`；命中 1：`adaptive-teaching`、`tts-audio`；命中 **0**：`adaptive-concept-graph`、`adaptive-diagnosis`、`knowledge-source`、`long-reasoning-demo`、`test-key`。→ **本体路由普遍=5，说明"5=已完整接入"** |
| E-221 | 实证 | `kb-progress.js:1099-1101` | 精读无独立路由，靠 `global.__CLOSE_READING__.isCommand(last.content)` 在 chat 文本层拦截 |
| E-222 | 实证 | `server.js` 的 `process.env.*` / `SOCRATOPIA_*` 全清单 | 模块开关：`SOCRATOPIA_ADAPTIVE_ENABLED`、`SOCRATOPIA_ADAPTIVE_PROFILE_ALLOWLIST`、`SOCRATOPIA_COMPANION_CONTINUITY_V1`、`SOCRATOPIA_KB_DISTILL_TIMEOUT_MS`、`SOCRATOPIA_KB_DISTILL_FOREGROUND_WAIT_MS`、`SOCRATOPIA_KB_PREBUILT_MAX_PAGES`、`SOCRATOPIA_LOCAL_OCR`、`SOCRATOPIA_OPENAI_API_KEY`。**无 `SOCRATOPIA_CLOSE_READING`** |
| E-223 | 实证 | `grep -rln "__LONG_REASONING__"` | 仅 `long-reasoning-demo/route.js` 与 `server.js` |
| E-224 | 实证 | `wc -l` 各目录生产文件（排除 smoke） | `practice` 4 файл/2003 行、`ocr` 6/1126、`knowledge` 7/2126、`reasoning` 8/2251、`close-reading` 9/1003、`companion-continuity` 3/1097、`resume` 1/632、`progress` 4/2739、`reading` 1/1743、`markdown` 1/251、`math-speech` **24/4251**、`adaptive` 17/6720 |
| E-225 | 实证 | `lib/knowledge/providers/` | 6 个 provider：`local-kb`、`rag`、`search`、`database`、`kimi-client`、`kimi-desktop` |
| E-226 | 实证 | `lib/math-speech/` | 24 生产文件 / 4251 行 + 16 个 `math-speech-*-test.js` + `corpus/`；对应 3 份根目录规格/验收/完成文档与 `PROJECT_MATH_SPEECH_DOSSIER/`(8 文档) 与 4 轮验收目录 |

### 完成度汇总（一句话）
**分支新增 7 路由 / 237 个服务端模块 / 约 2.4 万行生产代码，但只有 `practice`（前端引用 5，3 个专用 UI chunk）与语音真正端到端接进用户界面；其余多为"服务端完备、无 UI 入口"。** 详见 `02-module-dossiers/branch-feature-modules.md` §9。

---

## Q. 前端产物与"五包同步"（批次 C-5，2026-09-14）

| 编号 | 类型 | 锚点 | 内容 |
|---|---|---|---|
| E-240 | **实证** | `grep -rl "<chunk>" resources/server/.next/ \| grep -v smoke-test`；`route_client-reference-manifest.js` | **5 个页面 bundle 中只有 `page-87daa6ca210ab9dc.js` 被引用**（非 smoke 引用 33 次，且是唯一出现在 client-reference-manifest 的页面 chunk）。`page-3a1fef7566e26c43.js` 与 3 个 `page-practice-ui-*.js` 非 smoke 引用均为 **0** |
| E-241 | **实证** | `tools/remediate-tutoring-ui-bundles.js` | 硬编码 `pages` 数组含全部 5 个 bundle，`pages.forEach` 对每个执行同一 `replaceOnce`；`replaceOnce` 带幂等短路 + "恰好命中一次"校验（命中 ≠1 且非已打补丁则 throw） |
| E-242 | 实证 | 8 个前端 smoke test 的 `bundles` 数组 | 一致性靠 `assert(source.includes(...))` 对 5 个文件逐个断言，而非构建 |
| E-243 | 实证 | `ls -la .next/static/chunks/app/*.js` | 5 个页面 bundle 分别 769607 / 770124 / 761858 / 761510 / 761510 字节；另有本体原件 `layout-2ee9395c59630c5a.js`(7751 B, 2026-06-02 未改) |
| E-244 | 实证 | 同上目录 | 8 个前端 smoke test **直接躺在 chunk 目录里**，与产物混杂；`tools/run-smoke-matrix.js` 已知跳过 `.next/` → 改前端后必须手动跑 |
| E-245 | 实证 | 同类工具 | `remediate-continuity-bundles.js`、`synchronize-account-helper-bundles.js`、`synchronize-frontend-capability-helper.js`、`harden-frontend-stale-retry.js`、`repair-kuvt.js`、`patch-close-reading.js` 同样是多目标批处理 |

### 前端结论（一句话）
**补丁面 5×，运行面 1×。** 5 个约 760 KB 的 bundle 里只有 `page-87daa6ca210ab9dc.js` 真正送达浏览器；其余 4 个靠批量补丁脚本 + 字符串断言 smoke 保持同步。**改前端默认要改 5 个文件。** 详见 `02-module-dossiers/frontend-bundles.md`。

---

## R. 支撑基础设施（批次 C-6，2026-09-14）

| 编号 | 类型 | 锚点 | 内容 |
|---|---|---|---|
| E-260 | 实证 | `lib/model-router.js`（326 行） | `ALWAYS_MINI`、`MINI_THEN_ESCALATE = { kb_build, kb_distill, diagnosis }`、`DEFAULT_HIGH = { concept_graph }`、`TASK_POLICY`、`_toRoute(block,tier,reason,canEscalate)` |
| E-261 | 实证 | `lib/llm-gateway.js`（180 行） | `createGateway`、`createPromptCaller`、`routerFor`、`baseConfigFor`、`parseJson`、`GatewayError`。**`thinking` 字样未命中**（→ Q-035） |
| E-262 | 实证 | `lib/responses-api-compat.js`（787 行） | `CHAT_COMPLETIONS_SUFFIX`/`RESPONSES_SUFFIX`/`INSTALL_MARK="__SOCRATOPIA_RESPONSES_FALLBACK_INSTALLED__"`/`isChatCompletionsUrl`/`responsesUrl`/`isResponsesOnlyError`/`prefersResponses` |
| E-263 | 实证 | `lib/voice-catalog.js`（287 行） | `MODES = {"default","fixed","auto"}`、`FORBIDDEN_TAGS`、`EMOTION_LABELS`、`validateCatalog`、`resolveVoiceRequest` |
| E-264 | 实证 | `lib/voice-emotion-protocol.js`（387 行） | `TAG_NAME="voice"`、`FORBIDDEN_TAG_TEXT`("厌恶、disgust、disgusted、angry、生气")、`buildPromptBlock`、`pendingPrefixLength` |
| E-265 | 实证 | `lib/kb-publisher.js`（76 行） | 原子发布三段式 `knowledge_base.__building__` → `knowledge_base` → 旧版入 `knowledge_base.__previous__`；`insideTextbook()` 路径护栏 |
| E-266 | 实证 | `lib/kb-quality.js`(209)/`kb-builder-coordinator.js`(665) | 卡片排序校验、作业协调、`createBoundedFrameReader` |
| E-267 | 实证 | `lib/pdf-ocr-coordinator.js`（816 行） | `PDF_COMMANDS={"meta","extract","extract_adaptive","scan","render","toc"}`、`OCR_SCHEMA="local-ocr-v2"`、`RAPID_OCR_FINGERPRINT` |
| E-268 | 实证 | 跨模块 | 统一的 `codedError` 家族：`AuthError`/`GatewayError`/`OrchestratorError`/`PortConflictError`；错误码正则 `^[a-z0-9_]{1,64}$`；HTTP 归一由 `route-auth.errorResponse` 完成 |
| E-269 | 实证 | `progress-cursor.js` / `classroom-task.js` | `SCHEMA_VERSION = 2` / `= 1`；`mirrorLegacyPageFields()` 兼容旧字段 |
| E-270 | 实证 | 全库 | **无统一缓存抽象**：规则缓存/概念图谱24h/OCR v1+v2/证据缓存/tts-cache/前端 bundle，语义互不一致 |

### 支撑设施结论（一句话）
**错误处理模式统一（好事），但缓存与迁移无统一抽象；"必须同步多处"的清单已汇总为 6 类（64092 ×8、account-helper ×5、前端 bundle ×5、语音库 ×2、manifest ×3、自适应数据层 ×2），是重构清单第一手材料。** 详见 `02-module-dossiers/support-infrastructure.md` §10。

---

## S. BUG 与修复史料（批次 D-1，2026-09-14）

> 全部为**项目自产的事故/修复文档**，含日志时间戳、行号、对照实验——是本仓库质量最高的史料。

| 编号 | 类型 | 路径 / 锚点 | 内容 |
|---|---|---|---|
| E-280 | **一等** | `AUTO_ADVANCE_WINDOW_REPAIR_CHANGELOG.md`（18,633 B，2026-09-11） | BUG-0001「KUym 第 13 章跳读事件」。§一起因与复盘、§二现象/根因表、§三逐文件回滚锚点、§五验证、§七 C3 阶段一。明确 C5 **保留未修** |
| E-281 | **一等** | `LLM_THINKING_FIX_CHANGELOG.md`（4,943 B，2026-09-11） | BUG-0002「思考开关被模型名白名单静默丢弃」。含白名单代码、生产日志特征、**4 变体对照实验表**（仅禁思考可解析，仅加预算不可解析） |
| E-282 | **一等** | `POST_CLASS_SAVE_FIX_2026-09-13.md`（10,113 B） | BUG-0003「课后保存失败」。含两条日志时间戳证据、7 类标记兼容方案、截断检测、模块 64092 六处同步 |
| E-283 | **一等** | `outputs/deepseek-classroom-20260913-diagnosis.md` | BUG-0004「KB 概念队列劫持习题课堂」。含 `kb-progress.js:353/404/676/714/728/733/1193` 行号证据链；明确排除 TAE 与"模型自由联想" |
| E-284 | **一等** | `outputs/backend-security-audit-20260901.md` | 已修 4 项（TTS 零帧/会话并发/本地 API 防护/Electron 日志轮转）+ **未修 8 项（P1×2 / P2×4 / P3×2）** |
| E-285 | 实证 | `TTS_OPTIMIZATION_CHANGELOG.md` | 6 条带日期条目，含 2026-09-12 两条修复（静默丢音、旁白混入语音队列） |
| E-286 | 实证 | `outputs/uncommitted-changes-fix-plan-2026-09-01.md` | 5 项修复计划（下课锚点、事务 account/sessionEpoch 栅栏、伙伴实例 ID、真实 textbook_index、Tutoring 唯一 done），**落地状态待核实** |
| E-287 | 实证 | `outputs/math-speech-remediation/` | `REMEDIATION_REPORT.md`、`known-limitations.md`、`failures-before.json`/`failures-after.json`、`fault-injection.json`、`scope-audit.json`、`*-hashes-*.json` |
| E-288 | 实证 | `outputs/acceptance/20260829-212419/`、`20260829-221503/` | 两轮验收记录 |

### BUG 台账结论（一句话）
**已细化 7 条 + 明确未修 8 项（含 2 个 P1）；6/7 条集中于 2026-09-11~09-13 三天。全部只到"有修复代码"层级——本批未跑任何 smoke，无一条达到"通过针对性验证"。** 详见 `04-bug-ledger.md`。

---

## T. 实跑验证基线（批次 V-1，2026-09-14）

> **本轮唯一一次实跑**。执行条件见 `10-verification-baseline.md` §0：Node v25.9.0 / Windows / 应用未启动 / 无真实 API / 未写用户数据 / 未设任何 `SOCRATOPIA_*`。

| 编号 | 类型 | 内容 |
|---|---|---|
| E-300 | 实证 | 执行命令：`node tools/run-smoke-matrix.js --json outputs/smoke-baseline-20260914.json` + `.next` 下 25 个测试逐个跑 |
| E-301 | 实证 | 结果：矩阵 120 例（PASS 116 / FAIL 2 / SKIP 2）+ `.next` 25 例（PASS 24 / FAIL 1）= **合计 145 例，140 通过，3 失败，2 跳过**；另 3 个 TTS live 自跳过 |
| E-302 | **实证** | FAIL-1 `lib/staged-ws-runtime-smoke-test.js`：`Cannot find module './lib/knowledge/daimon-bridge.js'`，requireStack 指向 `release/win-unpacked/resources/server/[eval]` → **BUG-0009** |
| E-303 | **实证** | FAIL-2 `electron-adaptive-capability-smoke-test.js`：断言 `root and ASAR runtime must share the same adaptive protocol block` 失败；diff 显示 `issueAdaptiveCapability`、`ADAPTIVE_IMAGE_PATHS` 仅存在于根副本 → **BUG-0010** |
| E-304 | **实证** | FAIL-3 `.next/.../flashcard-adaptive-evidence-smoke-test.js:202`（legacy fallback 场景）抛 `stage_c_request_uncertain` → **BUG-0011** |
| E-305 | 实证 | `wc -c`：根 `main.js` 1,388,110 B vs `_asar_extracted/dist-electron/main.js` 1,388,065 B（差 45 B；CRLF 数同为 35964，故非行尾差异） |
| E-306 | 实证 | 3 个 TTS live 测试自跳过（`set SOCRATOPIA_RUN_TTS_LIVE=1`） |
| E-307 | 实证 | 2 个 SKIP 为矩阵设计内（`pdf-(cmap\|render)-real`，exit 2） |
| E-308 | 实证 | `.next` 下 7 个 chat 相关测试**全部 PASS**（含 `chat-end-class-integration`、`adaptive-chat-dispatcher`、`chat-classroom-context-governance`） |
| E-309 | 实证 | `.next` 下 8 个前端测试 PASS，唯 FAIL-3 例外 |
| E-310 | **升级** | 由本轮把下列"推断"升级为"已证实"：① 多份打包产物并存且危险（FAIL-1）② Electron 双副本会漂移（FAIL-2）③ 矩阵跳过 `.next` 导致改动缺保护（FAIL-3 正落在被跳过区）④ 测试自包含、不触网、不写用户数据（145 例在无 app 无 env 下跑通） |
| E-311 | 未证实 | 本轮**未启动应用** → 无端到端验证；BUG 台账 §1 的 7 条未逐条验证；劫持挂载是否生效（Q-026）未确认 |
| E-312 | 基线值 | **回归基线 = 145 例 / 140 通过 / 3 失败 / 2 跳过**，供阶段 E 验收比对 |

---

## U. 阶段 E（技术债 / 旧文档判断 / 重构路线）（批次 E-1~E-3，2026-09-14）

| 编号 | 类型 | 内容 |
|---|---|---|
| E-320~E-332 | 汇总 | 风险登记表 R-01~R-20 的证据映射（见 `05-tech-debt-and-risks.md` §8） |
| E-350 | 实证 | 根目录 18 份 `.md` 的逐份大小 + 跟踪状态：**仅 6 份被跟踪**（`AGENTS.md`、`ADAPTIVE_TEACHING_MODE_TECHNICAL_REPORT.md`、`PRACTICE_FEATURE_*.md`、`TTS_OPTIMIZATION_CHANGELOG.md`、`VOICE_MODEL_MAPPING_REPORT.md`、`上下文.md`、`方案.md`），**12 份未跟踪** |
| E-351 | 实证 | 用户已于 2026-09-14 更新两个指令文件：`AGENTS.md` 4,031→**5,116 B**、`CLAUDE.md` 8,171→**12,970 B**。`CLAUDE.md` 仍含失效的 `Socratopia_2.0` 引用 |
| E-352 | 实证 | `git -c core.quotePath=false ls-files`：根目录被跟踪的 md 仅 6 份 |
| E-353 | 实证 | `resources/server/.system/ocr-cache-v1/`（OCR v1 缓存目录）、`resources/server/public/voice-catalog.json`(48,439 B, 2026-09-13)、`public/close-reading-skill-menu.js`(8,684 B)、`public/avatars/`、`public/library/` |
| E-354 | 实证 | `resources/bundled-content/{en,zh,zh-TW}/initial_world/` + 顶层 `initial_world/` |
| E-370~E-385 | 汇总 | 重构路线各类别的证据映射（见 `06-refactor-roadmap.md` §证据） |

### 阶段 E 结论（一句话）
**风险登记表 20 条（R-01~R-20），最高优先级是"无版本保护"与"验证覆盖缺口"而非架构问题；重构路线分 P0~P5 六批，P0 三件事（纳入版本控制 / 固化基线 / 矩阵覆盖 `.next`）零到极低风险，其中"让矩阵覆盖 `.next`"约一行改动即可把最高风险的 25 个测试纳入保护。** 详见 `05-tech-debt-and-risks.md`、`06-refactor-roadmap.md`、`07-legacy-docs-assessment.md`。

---

## V. 编号补齐（批次 E-4，2026-09-14）

> 校验方法：`comm -23 <各文档引用的 E-nnn> <EVIDENCE.md 中出现的 E-nnn>` 找出悬空引用。
> 本节补齐全部 38 个此前被引用但未独立定义的编号，**使所有引用可回溯**。
> V-1 校验结果：引用 218 个不同编号，补齐后 **0 悬空**。

### 前批遗留（模块档案引用）
| 编号 | 对应内容 |
|---|---|
| E-058 | 多份打包产物观察：`resources/app.asar`(2026-09-01, 1,392,521 B)、`win-unpacked/resources/app.asar`(1,389,384 B)、`release/win-unpacked/resources/app.asar`(2026-08-29) —— 至少 4 个不同版本并存 |
| E-140 | `lib/route-auth.js` 全文要点：`PUBLIC_BOOTSTRAP_PATHS`、`SCOPE_KEYS`、`extractScope` 的 profile 特例映射、`dispatch` 对非 HTTP 请求放行、`errorResponse` 错误体 |
| E-142 | `lib/local-request-auth.js` 函数清单：`createVerifier`/`authenticateRequest`/`assertTrustedAccount`/`scopeAllows`/`assertScopeValue`/`AuthError` |
| E-143 | 实测：`global.__ROUTE_AUTH__` 命中 0 次；facade 被 12 个 `.next/server/app` 文件 + 1 个 chunk 引用 |
| E-144 | `lib/account-request-context.js` 44 行，AsyncLocalStorage，导出 `createAccountRequestContext` |
| E-148 | `route-auth.js` L2-4 注释："prevents the five inlined account-helper copies from drifting semantically" |
| E-165 | `resources/server/lib/ocr/rapidocr-v5/README.md`、`THIRD_PARTY_NOTICES.md` 被 `06c0256` 删除（E-086 同源） |
| E-196 | 课堂档案的补充锚点：`chat/route.js` 内 `__CLASSROOM_TASK__`(1)、`__ADAPTIVE_TEACHING_RUNTIME__`(1) 命中计数 |
| E-214 | 自适应档案的补充：`lib/adaptive/` 生产文件 17 个 / 6720 行（E-224 同源） |
| E-252 | 前端档案的补充：8 个前端 smoke test 文件名清单（`device-status-binding`、`llm-generation-lifecycle`、`voice-*` 6 个） |
| E-278 | 支撑设施补充：`lib/pdfjs-paths.js` 16 行；`lib/practice/windows-ocr.ps1` |
| E-299 | BUG 台账补充：`outputs/acceptance/20260829-212419/`、`20260829-221503/` 两轮验收目录 |

### 阶段 E 风险表证据映射（R-01~R-20，`05-tech-debt-and-risks.md` §8）
| 编号 | 对应风险 |
|---|---|
| E-321 | R-03 前端 5 包（E-240/E-241/E-242） |
| E-322 | R-04 Electron 双副本（E-303/E-305/E-092） |
| E-323 | R-05 矩阵跳过 `.next`（E-304/E-308 + `run-smoke-matrix.js` 的 skip 行） |
| E-324 | R-06 劫持挂载（E-184） |
| E-325 | R-07 发布暂存残缺（E-302） |
| E-326 | R-08 审计未修 8 项（E-284） |
| E-327 | R-09/R-10 同步型债（`CLAUDE.md`、E-141、E-281、E-282） |
| E-328 | R-11/R-14 规则文本未跟踪 + 英文桩（E-182/E-183、Q-025） |
| E-329 | R-13/R-20 无 UI 入口（E-200/E-202/E-204/E-220） |
| E-330 | R-17/R-18 无统一缓存 / 迁移不在验证路径（E-270、E-269） |
| E-331 | R-19 `v109.md` 缺失（E-102） |
| E-345 | R-01/R-02 依据汇总（E-130、E-093、E-157） |

### 阶段 E 旧文档评估证据（`07-legacy-docs-assessment.md`）
| 编号 | 对应内容 |
|---|---|
| E-355 | `outputs/backend-security-audit-20260901.md`、`outputs/math-speech-remediation/known-limitations.md` |
| E-356 | `PROJECT_MATH_SPEECH_DOSSIER/` 8 文档（含 `06-iteration-log.md`） |
| E-362 | `git ls-files` 跟踪状态实测（与 E-352 同源，用于 §1 表的"跟踪"列） |

### 阶段 E 重构路线证据映射（`06-refactor-roadmap.md` §证据）
| 编号 | 对应建议 |
|---|---|
| E-371 | P0/A1（R-02） |
| E-372 | P1/C2 三个 BUG（E-302~E-305） |
| E-373 | P2/C4 挂载自检（E-184、Q-026） |
| E-374 | P3/C3 多副本同步自动化（E-141、E-240/E-241、E-281/E-282） |
| E-375 | P3/B1 接线审计（E-200/E-202/E-204/E-220） |
| E-376 | P4/C6 前端机制简化（E-240、Q-033/Q-034） |
| E-377 | P4/C5 巨石拆分（E-185~E-188） |
| E-378 | P5/E1 重建可行性（E-123、E-121/E-122、Q-021） |
| E-379 | D1 固化基线（E-312、`10-verification-baseline.md`） |
| E-380 | D2/D3 逐条验证 + 端到端（V-1 §4、E-311） |
| E-381 | D4 发布流程（E-302、E-049、Q-044/Q-006） |

---

## W. BUG 修复逐条验证（批次 V-2，2026-09-14）

> 方法：**只复现各修复文档自己声明的验证方式**。执行条件：Node v25.9.0 / Windows / 应用未启动 / 未调真实外部 API / **本地 TTS 服务在运行**（`127.0.0.1:8000` → HTTP 200）。
> 结论：**§1 的 7 条全部升级为 `通过针对性验证`**。详见 `12-bug-verification-round.md`。

| 编号 | 类型 | 内容 |
|---|---|---|
| E-390 | 实证 | BUG-0001：文档 §五声明的 10 个 smoke **全部复现通过**（含其修复时新增的 `auto-advance-window-recovery-smoke-test.js`）；`chat/route.js`、`auto-advance.js`、`kb-progress.js` 的 `node --check` 与 `acorn.parse(ecmaVersion:2022)` 全部 OK |
| E-391 | **实证** | BUG-0002：`/^deepseek/i` 家族判断在 **7 个文件各 1 处**全部到位；`chat/route.js` 残留的 1 处旧白名单经上下文核对确认是文档 §四声明"有意未改"的 `q` 行；`lib/end-class-llm-smoke-test.js:39-47` 用模型 `deepseek-test`（**不匹配旧白名单**）断言 `thinking === false` → **PASS**（可捕获该回归） |
| E-392 | **实证** | BUG-0003：`outputs/post-class-save-fix-20260913/verification.json` 的 6 项检查对应日志**全部存在且 PASS**；`parser-test.log` 20 项含事故特征用例（`three-line markers`、`mixed markers seen in incident`）；`.next` 的 `end-class-parser` / `chat-end-class-integration` 测试复现 PASS；回滚材料完整（`changes.patch` + `before/` 原字节备份） |
| E-393 | **实证** | BUG-0004：**修复已落地**（诊断文档原称"仅诊断"）——`kb-progress.js` 新增 `checkEvidence()`，注释直接引用 2026-09-13 事件；判定改为 `conceptBound && studentAnswered`，另有 `finalQuestionTail()` 防概念名夹带。4 条精确回归断言（`kb-progress-sse-smoke-test.js:178/182/211`、`exercise-mode-smoke-test.js:206`）**全部 PASS**。`TWO_CHECK_LIMIT_REACHED` 上限仍保留 |
| E-394 | **实证** | BUG-0005/0006/0007：4 个 `-live-` 测试对运行中的本地 TTS 服务**全部 PASS**（`tts-classic-stream-live`、`-frontend-live`、`-frontend-cancel-live`、`-zero-audio-live`）；另有 V-1 中 10 个相关测试 PASS |
| E-395 | 实证 | `outputs/smoke-baseline-20260914.json`（全部结果的原始 JSON，可复核） |
| E-396 | 实证 | `tmp/llm-thinking-probe.js`、`tmp/llm-budget-probe.js` **已不在 tmp/**（`LLM_THINKING_FIX_CHANGELOG.md` §六 仍引用它们）→ 印证临时目录不可靠（R-02/Q-050） |
| E-397 | 实证 | `git show 4f1f907^:fix-asar-integrity.js` 可完整取回（95 行 / 2,937 B）→ 删除的工具并未丢失 |
| E-398 | **实证** | `tmp/patch-asar-integrity.js`（31 行 / 1,478 B）是**重写加强版**而非副本：改用 `asar.readUInt32LE(12)` 正确算法（旧版手写大括号计数扫 JSON）、幂等 `in sync` 短路、只在 `ELECTRONASAR` 标记后定位 `"value":"`、参数化 `<exe> <asar>`、注明运行中 exe 会 EBUSY。**→ Q-049 结案，Q-043/BUG-0010 解除阻塞** |
| E-399 | 实证 | BUG-0001 语法定点：`node --check` + `acorn.parse(ecmaVersion:2022)` 对 `chat/route.js` / `auto-advance.js` / `kb-progress.js` 三文件全部 OK |
| E-400 | 实证 | BUG-0004 相关：`kb-progress.js` 中 `TWO_CHECK_LIMIT_REACHED` 仍在 `:429`（`checkCount >= 2`）与 `:766`（生成指令）→ 修的是"什么算一次检查"，**上限机制保留**，与诊断建议一致 |
| E-401 | 实证 | `outputs/post-class-save-fix-20260913/` 目录完整（`verification.json`、6 份 `.log`、`changes.jsonl`、`changes.patch`、`before/`、`baseline.json`、`patch-manifest.json`、`manifests/`）→ 该修复**回滚材料齐备** |
| E-402 | 实证 | 四文件在 `tmp/` 中确认为唯一副本且未跟踪：`patch-asar-integrity.js`、`import-character-library.py`、`optimize-character-templates.py`、`crop-import-avatars.py` |

---

## X. 端到端实况取证（批次 V-3，2026-09-14）

> 应用**已在运行**（未启动/未杀进程），直接读运行日志与探活。执行条件与有效性前提见 `13-live-e2e-smoke.md` §0。

| 编号 | 类型 | 内容 |
|---|---|---|
| E-403 | 实证 | 5 个 `Socratopia.exe` 进程；`.server-pid` = `{"pid":39712,"exePath":"…Socratopia.exe","startedAt":"2026-09-14T10:32:21.302Z"}` |
| E-404 | **实证** | 启动日志：全部模块加载成功（long-reasoning / model-router / knowledge×5 providers / close-reading / voice 23 情绪音色 / continuity enabled=true / adaptive-auth verifier synchronized），`Next.js 16.1.6 ✓ Ready in 72ms`，`Local: http://127.0.0.1:13713`。**端口 13713 为动态 → 再次证实 `AGENTS.md` 的"3000"错误** |
| E-405 | **实证** | 鉴权探活：`POST /api/chat` 无令牌 → **401 `auth_missing`** + `traceId` + 完整错误体；`GET /api/account/init`（公开路径）→ 405（只收 POST）。**fail-closed 设计在运行中被证实** |
| E-406 | **实证** | `[kb-progress]` 前缀日志 **198 次**、`[kb-progress][C3]` **9 次** → **Q-026 结案：劫持式挂载在真实运行中生效** |
| E-407 | **实证** | `[callLLM] thinking=disabled applied=true` ×**37**、`[chat] thinking=enabled applied=true` ×**145**、**`applied=false` ×0** → BUG-0002 的运行时验证完成 |
| E-408 | **实证** | 观察到模型名含 **`DeepSeek-V4.1-Flash`（大写 D/S）**；旧白名单 `d.startsWith("deepseek-v4")` 大小写敏感 → 对其判 false。→ 修复是**必要前提**，不是锦上添花 |
| E-409 | 实证 | `[kb-progress][C3]` 完整诊断字段（`textbookId:'KUyw'`、`mode:'page_only'`、cause/effect/stage2）→ BUG-0001 的 C3 修复在真实教材上触发 |
| E-410 | **实证** | **BUG-0012**：16 次 `post-response progress save failed: EPERM`，日期分布 09-11×5 / 09-12×3 / 09-13×3 / 09-14×5；全部指向同一文件 `textbook_index.json.<数字>` |
| E-411 | **实证** | 根因定位：`getTmpname()` = `filename + '.' + sha1(...).readUInt32BE(0)`；全仓库**仅 `auto-advance.js:15/144`** 用 `write-file-atomic`；该库 v7 **不做 rename 重试** |
| E-412 | **实证** | 重试预算对比：`auto-advance.js:142-156` **5 次 ≈375ms** vs `kb-progress.js:1105` **10 次 ≈1.1s**（3 倍差距） |
| E-413 | 实证 | `kb-progress.js:1401-1409` 外层 catch 打该日志并尝试发 `PROGRESS_SAVE_FAILED`；但日志中该事件计数 **= 0** → 用户基本无声 |
| E-414 | 实证 | 14 天内出现 **5 个不同 LLM 端点**；另有 1 次 URL 拼接异常 `…nwafu.edu.cn/?model=DeepSeek-V4.1-Flash/v1/chat/completions` |
| E-415 | 实证 | `.server-port` 的 `writtenAt` 停在 2026-05-23（端口值正确但未随启动重写）；`socralab_debug.log.1` 达 **162 MB** |
| E-416 | 实证 | `[direct-llm-cache]` `cachedTokens:4864 / cacheHitTokens:4864` → DeepSeek 自动前缀缓存生效 |
| E-417 | 实证 | 代码时效性：17:00 后无文件改动，而 server 于 18:32 启动 → **运行实例加载的是当前代码** |
| E-418 | 实证 | 使用强度：日志覆盖 2026-09-01~09-14，单日 237~594 行 |

### V-3 结论（一句话）
**运行实例健康：模块全载、鉴权 fail-closed 生效、劫持挂载生效（Q-026 结案）、BUG-0002 运行时验证通过。但发现一条真实使用中每天发生 3~5 次的新缺陷 BUG-0012（EPERM 丢失课后进度保存，且对用户无声），根因定位到 `auto-advance.js` 重试预算过短。**

---

### V-2 结论（一句话）
**7 条历史 BUG 全部达到"通过针对性验证"，且每条都带有精确到根因的回归测试 → 这支分支的修复质量与测试纪律良好，问题不在"修得差"，而在组织（无源码/无版本控制/矩阵漏覆盖）。**

---

## Y. BUG-0012 根因定位与修复（批次 V-4，2026-09-14）

> 本轮**首次修改业务代码**。详见 `14-bug0012-fix.md`。

| 编号 | 类型 | 内容 |
|---|---|---|
| E-419 | 实证 | 现象规模：16 次 EPERM，日期分布 09-11×5/09-12×3/09-13×3/09-14×5，全部同一目标文件 `textbook_index.json` |
| E-420 | **实证** | **竞争者**：`chat/route.js:917` 的 `prefetchCandidate({...}).catch(...)` —— **未 await**，后台并发 |
| E-421 | 实证 | 两个写入者：`auto-advance.js:519-532 updateIndexCurrentPage`（经 `projectConversation`）与 `kb-progress.js:1126-1141 syncTextbookCurrentPage` |
| E-422 | **实证** | `withLock` 是进程内 per-lockKey promise 链，覆盖 auto-advance 的 **11 个入口**，**不含 kb-progress** → 锁不构成跨模块互斥 |
| E-423 | 实证 | 预算对比：`auto-advance.js:140-158` 5 次/≈375ms vs `kb-progress.js:1105` 10 次/≈1.1s |
| E-424 | 实证 | 新测试失败栈与生产同形：`atomicWrite(auto-advance.js:144)` ← `backupLegacy:405` ← `migrate:492` ← `bootstrap` |
| E-425 | 实证 | 修复 diff：`attempt >= 4` → `attempt >= 9`（+ 说明注释） |
| E-426 | 实证 | 新回归测试 `resources/server/lib/reading/auto-advance-atomic-write-retry-smoke-test.js`（2 场景：6 连失须存活 / 14 连失须响亮失败） |
| E-427 | **实证** | 修复前运行 → FAIL（`writer must have retried past the burst`）→ **判别力确证** |
| E-428 | **实证** | 修复后运行 → **PASS 2/2**（6 连失在 8 次 rename 内存活；14 连失在第 10 次尝试后抛 EPERM） |
| E-429 | 实证 | 全量矩阵 `outputs/smoke-after-bug0012-fix.json`：121 例/117 通过/2 失败/2 跳过（基线 120/116/2/2，**失败项完全相同**） |
| E-430 | 实证 | `.next` 25 例复跑 24/1，与基线一致 → **零回归**；合计 146/141/3/2 |

### V-4 结论（一句话）
**BUG-0012 根因闭合（后台预取与前台收尾并发写同一文件，且两侧重试预算不一致，短者先崩），已修并配可判别回归测试，全量零回归；但真实课堂验收须在应用重启后才能做。**

---

## Z. 课后笔记质量与可靠性 v2 基线（批次 PN-V2-A，2026-09-15）

> 方案：`POST_CLASS_NOTES_QUALITY_RELIABILITY_DEVELOPMENT_PLAN.md`。基线产物：`outputs/post-class-notes-v2/baseline-20260915T031249Z/`。
> 证据来源为 `%APPDATA%/socratopia/logs/socralab_debug.log` 的逐条时间戳与 `git diff`，非推断。

| 编号 | 类型 | 内容 |
|---|---|---|
| E-PN-001 | **实证** | `02:05:19.816Z` 发起 → `02:08:19.823Z` `FATAL ERROR: This operation was aborted`，**180.007 秒**，精确命中 `timeoutMs:180000` |
| E-PN-002 | **实证** | 请求规模：`msgCount=80`、`substantive user msgs: 40`；网关计量 `promptTokens: 14078`、`cachedTokens: 13824` |
| E-PN-003 | **实证** | `status:200` 但 `choices[0].message.content = null`，而 `message.reasoning` 完整 → HTTP 200 ≠ 可用结果 |
| E-PN-004 | **实证** | 自动重试第二轮 `LLM response length: 5836`、`parse failed on attempt 2/2`、`JSON parse failed after 2 attempts` → 数组中途截断 |
| E-PN-005 | 对照 | 同输入 `max_tokens=2048` ≈16.5s 返回 |
| E-PN-006 | 对照 | 同输入 `max_tokens=4096 + json_object + ≤1800 字符` ≈64.5s 返回完整 JSON、`finish_reason=stop` |
| E-PN-007 | 实证 | 上游故障时返回 HTTP 403 `text/html` 拦截页，被内嵌 `response.json()` 误报为 JSON 语法错误 |
| E-PN-008 | 实证 | 同一上游次日恢复 HTTP 200 → 网关异常具有间歇性 |
| E-PN-009 | 实证 | 目标文件基线哈希见 `before.sha256`；未提交 patch 见 `changes.patch`（route.js 等 248 行） |
| E-PN-010 | 实证 | 阶段 A 门禁 5/5 PASS（route/server `node --check` + 3 个 concept-summary smoke），见 `results.json` |

### PN-V2-A 结论（一句话）
**课后笔记四症状（HTML 误解析 / 180s 超时 / 空 content / JSON 截断）全部有日志级证据且互为同一条链路的失效模式；基线哈希、before 副本、未提交 patch 与门禁结果已固化，回滚只需还原目标文件，不需 `git reset --hard`。**

### 阶段 B/C 追加证据（2026-09-15，PN-001/002/003/004/005/006/013/014）

| 编号 | 类型 | 内容 |
|---|---|---|
| E-PN-011 | 实证 | token 估算校准：fixture `long-80` 7,444 tokens / 2 片，`stress-160` 14,277 tokens / 4 片，与生产 20,003 字符→14,078 tokens 同量级 |
| E-PN-012 | **实证** | 阶段 B 门禁 12/12 PASS（`outputs/post-class-notes-v2/stageB-20260915T055000Z/results.json`） |
| E-PN-013 | **实证** | 阶段 C 门禁 23/23 PASS（`outputs/post-class-notes-v2/stageC-20260915T145000Z/results.json`） |
| E-PN-014 | **实证** | 上游 HTML 拦截页在 4 个真实形态下均被正确分类：403+text/html、200+text/html、非 JSON 的 200、缺 choices 的 envelope（provider-smoke-test） |
| E-PN-015 | **实证** | 原子写预算：6 连 rename 失败后第 7 次成功；99 连失败在第 10 次尝试后以 `persist_failed` 上抛，且不留 `.tmp-` 残留（checkpoint-store-smoke-test） |
| E-PN-016 | **实证** | 持久化失败不毁旧笔记：注入 `writeFinal` 连续失败后，磁盘上仍是上一版笔记内容 |
| E-PN-017 | **实证** | 单项请求最多 2 次上游调用（DNS 后 429 即放弃），与方案 §6.2 末句一致 |
| E-PN-018 | **实证** | `Retry-After: 12s` 被真实尊重：orchestrator 注入 sleep 记录到 ≥12000ms |
| E-PN-019 | **实证** | 终态竞态修复前为间歇性失败（`PCN_DEBUG=1` 改变时序后症状消失）；修复后 orchestrator smoke **连续 6 次 PASS** |
| E-PN-020 | **实证** | trace 洁净性：用 `long-80` fixture 原文片段反查，trace 与 `job.json` 均不含课堂正文、reasoning 或 API key |

---

## Z 节｜BUG-0012 真实验收与自锁根因（2026-09-18）

> 对应 `14-bug0012-fix.md` 附录 §9~§13、`04-bug-ledger.md` BUG-0012、`OPEN-QUESTIONS.md` Q-054。

| 编号 | 类型 | 内容 |
|---|---|---|
| E-431 | 实证 | `stat resources/server/lib/reading/auto-advance.js` = `2026-09-14 19:09:24 +0800`（= `2026-09-14T11:09:24Z`），即修复落盘时刻 |
| E-432 | 实证 | 日志中该时刻之后的首次 server 启动为 `2026-09-14T15:33:54Z`；至 2026-09-18 共 9 次启动（`[Next] ▲ Next.js 16.1.6` 行计数 81 → 末次 `2026-09-18T07:58:06Z`），`.server-pid` 同步为 `startedAt: 2026-09-18T07:58:06.316Z` |
| E-433 | **实证** | 前后对照（同一 marker `[chat] thinking=`）：生效前 chat=152 / EPERM=17 = 11.2%；生效后 chat=85 / EPERM=6 = 7.1%。n=85 下卡方≈1.0，**不显著** |
| E-434 | 实证 | 生效后逐日：09-15 28/1、09-16 15/3、09-17 7/0、09-18 35/2 |
| E-435 | **实证（决定性）** | 每次失败量取"距上一条带时间戳日志行"的 ms：生效前 18 次为 328/333/334/335/340/390/423/427/428/432/432/435/439/455/457/499/610；生效后 6 次为 **1250/1253/1255/1257/1265/1270**（极差 20ms）。与"旧退避 250ms → 新退避 1125ms"差值吻合 |
| E-436 | 实证 | 两侧写入器均纯同步且各自 `Atomics.wait` 退避：`auto-advance.js:140-158`（`writeFileAtomic.sync`）、`kb-progress.js:1105-1122`（`writeFileSync`+`renameSync`，tmp 为 `.tmp` 后缀）。tmpname 特征 `.<digits>` 唯属 write-file-atomic → 抛出者确定为 auto-advance |
| E-437 | **实证** | `outputs/bug0012-livelock/repro.js` 双事实复现：A 无持有者→attempt 1 成功（1ms）；B 同进程异步持有者→40 次全耗尽（2496ms）、`holderOpened=true holderClosed=false` |
| E-438 | 合理推断 | 持有者候选：`resources/server/.next/server/chunks/2751.js` 的 `async function y()` 用 `await readFile(<worldDir>/textbooks/textbook_index.json)`；该 chunk 被 `chat`/`reading-context`/`textbook`/`jump-page`/`groupchat` 五条 route 引用，route 层普遍 import `fs/promises`。**未在运行时抓到实际持有者** |
| E-439 | 实证 | 另一条未纳入此前分析的 EPERM：`[Next:err] [auto-advance] read snapshot failed: EPERM` ×3，**全部紧跟服务器启动**（15:18:44.969 Ready → 15:18:50.977 与 15:18:53.285；15:30:40.404 Ready → 15:30:48.589）。读操作也 EPERM，与"目标正被 rename"的表现一致；已登记 Q-054 ③ |
| E-440 | 实证 | 09-14 当天 server 启动 16 次（05:10~15:37），`read snapshot failed` 只出现在其中 2 次启动后数秒内 → 启动期是 EPERM 的另一个高发窗口，与课后收尾期（E-435）不同 |

### Z 节续｜方向①落地（2026-09-20，`15-bug0012-reader-sync-fix.md`）

| 编号 | 类型 | 内容 |
|---|---|---|
| E-441 | 实证 | 改动点 1：`lib/companion-continuity/transaction.js` 的 `readTextOrNull()` 由 `await fsp.readFile` 改为 `fs.readFileSync`（该函数在提交时校验每个 target，含 `textbook_index.json`） |
| E-442 | 实证 | 改动点 2：`lib/companion-continuity/end-class-commit.js` 的 `readText()` 同上 |
| E-443 | 实证 | 改动点 3：`.next/server/chunks/2751.js` 的 `y()` 改为 `(0,g.readFileSync)(c,"utf-8")`；同 chunk 内 `g = require("fs")` 已存在，无需新增 import |
| E-444 | 实证 | 枚举依据：`lib/` 内 `await fs.promises.readFile`/`await fsp.readFile` 全部命中点；`practice/source-adapter.js` 早已全同步；chunk 2751 仅 2 处 `await d.readFile`（另一处读教材 md，不涉目标文件） |
| E-445 | 实证 | 新回归场景 3（同进程打开句柄 → 整条预算烧光）输出 3/3 PASS |
| E-446 | 实证 | 全量矩阵 `outputs/smoke-after-bug0012-v5.json`：**129 例 / 128 通过 / 1 失败** |
| E-447 | 实证 | 该唯一失败为 `tts-classic-stream-zero-audio-live-smoke-test.js`，`TypeError: fetch failed`；`curl http://127.0.0.1:8000/` 无响应 → 本地 TTS 服务未运行（环境） |
| E-448 | 实证 | `.next` 手工补跑 **28 例 / 27 通过 / 1 失败**，失败为既有 BUG-0011（`flashcard-adaptive-evidence`） |
| E-449 | 实证 | **BUG-0009/0010 已由外部修复**：`release/win-unpacked/resources/server/lib/knowledge/daimon-bridge.js` 已存在（24351 B）；`wc -c main.js` 与 `_asar_extracted/dist-electron/main.js` 均为 1388110 B。两条 smoke 现 rawExitCode=0 |

### 阶段 D/E 追加证据（2026-09-18，PN-007/008/009）

| 编号 | 类型 | 内容 |
|---|---|---|
| E-PN-021 | **实证** | `[post-class-notes] Orchestrator loaded, pipeline: post-class-v2` 出现在 forked server 启动日志（integration smoke 与手动跑均可见） |
| E-PN-022 | **实证** | 异步契约成立：POST start 返回 `jobId/traceId/status`，轮询 status 至 `ready` 后带 `summary`；同一 sourceHash 二次 start 返回 `reused:true` 且 `mockLLM.requests` 计数不变 |
| E-PN-023 | **实证** | HTML 403 经真实 HTTP 走完全链路后，job 以 `code=upstream_html_response` 失败，**响应中不再出现 `Unexpected token`**（BUG-0013 症状 1 闭环） |
| E-PN-024 | **实证** | 重进页面：`status` 不带 jobId 返回该会话最新 job（running 优先），无 job 时 404 `not_found` |
| E-PN-025 | **实证** | 5 个 page chunk 打补丁后语法全通过；`.next` 下 11 个既有前端 smoke 全部 PASS（零回归） |
| E-PN-026 | **实证** | 补丁脚本幂等：第二次运行报 `already patched`，5 个 bundle 字节不变 |
| E-PN-027 | **实证** | 服务端重启残留：非终态且无 runtime 的 job 首次被看见即降级 `failed/resumable` + `job_interrupted` trace（orchestrator-smoke 新场景） |
| E-PN-028 | **实证** | `ready` 但笔记读不回来 → 降级 `failed/persist_failed/resumable`，`status` 不带 summary（前端不再在 `summary.sections` 上崩） |
| E-PN-029 | **实证** | 阶段 D 门禁 16/16 PASS、阶段 E 门禁 22/22 PASS |

---

## AA 节｜最新一节完整课堂复盘（2026-09-25）

> ⚠️ 编号注意：本节的 E-450~E-465 与 **E-500~E-504** 为本轮（课堂复盘）新增；E-466~E-490 属**并行会话**（课后笔记线），两段同时期追加，编号区间交错。
>
> 对应 `16-live-lesson-review-20260925.md`。课堂 world `KUyw` / conversation `64KCdn4ZqCUX29tk2G4Hq`。

| 编号 | 类型 | 内容 |
|---|---|---|
| E-450 | 实证 | 日志末条 `2026-09-25T10:42:55Z`；课堂窗口 `08:06:36Z`（应用重启）→ `10:42:55Z`，共 312 行 |
| E-451 | **实证** | 该窗口内 `post-response progress save failed` = **0 次**；最近一次为 `2026-09-18T08:44:49Z` |
| E-452 | **实证** | 前后对照：修复前 255 轮 / 25 次（9.8%），修复后 115 轮 / **0 次**；按 9.8% 期望 ~11 次，泊松 p≈1.2e-5 |
| E-453 | 实证 | 方向①三处改动仍在盘（`grep` 复核通过）；应用 `startedAt 2026-09-25T08:06:35Z`，晚于全部改动 |
| E-454 | **实证** | `[chat] thinking=… applied=` 按日统计：09-22 及以前 applied=true 100%；09-23 出现 27 次 false；09-25 为 **52/52 全 false**（模型 gpt-5.6-terra） |
| E-455 | **实证** | `app/api/chat/route.js` 原文：`…&&(console.log("…applied="+/^deepseek/i.test(String(b||""))+" model="+b),/^deepseek/i.test(String(b||"")))?{thinking:{type:…}}:{}` |
| E-456 | **实证** | `lib/responses-api-compat.js` 只做 `body.reasoning`→`result.reasoning` / `reasoning_effort`→`{effort}` 映射，**全无 `thinking` 处理** |
| E-457 | **实证** | 三处手写护栏同为 deepseek-only：`llm-gateway.js`、`kb-builder-coordinator.js`、`kb-builder.mjs`，注释均写明"deepseek 默认开启思考，会把 max_tokens 烧在 reasoning 上、content 空串" |
| E-458 | 实证 | `/^deepseek/i` 命中 **7 个模块 64092 定义文件**（chunks/1576、chunks/4092、chat、concept-summary、flashcard、companion/reconcile-persona、custom-companions/merge-persona，各 2 次）+ 上述 3 个 lib |
| E-459 | 实证 | `[lesson-summary] Error` 4 次：3× `ConnectTimeoutError (api.nwafu-ai.cn:443, timeout: 10000ms)` @05:38:18/05:42:22/06:33:11，1× `AbortError @chunks/1576.js:25:5389` @05:46:12 |
| E-460 | 实证 | `marker rejected: taught_page_regressed` ×6（05:34:21 / 05:36:14 / 05:38:07 / 05:42:10 / 05:45:42 / 05:49:04）+ `taught_page_outside_loaded_range` ×1（08:51:28） |
| E-461 | 实证 | `[kb-progress][C3] 教材没有可用的概念卡队列，已切换为页级进度模式` ×2（07:59:43、08:20:50），JSON 含 `mode:'page_only'`、`cause:'loadQueue 找不到可用的 knowledge_base（未构建，或 build_status.state !== done）'`、`effect:'…windowComplete 仍为 false'` |
| E-462 | 实证 | `[auto-advance] authoritative window is empty; reloading the current range` 带 `note:'conversationSeed seeded a header-only window from an empty current_reading.md projection'`；另有 `[kb-progress][C3] 页级进度已讲到窗口末页（阶段二未启用）` 于 08:21:18，`loadedRange:'40-54'` |
| E-463 | 实证 | `[ctx-budget] over budget: snapshot=42060>28000 sysPLen=57621` 每轮出现（第一段）；第二段 `sysPLen=36141/snapshot=20758` |
| E-464 | 实证 | `[pdf-ocr] contiguous window capped at targetChars { targetChars: 20000, contiguousChars: 20280~21047 }` 每轮出现 |
| E-465 | 实证 | `[concept-summary] POST action=status` 于 07:55:39–07:58:45 每 ~9s 一次（≥26 次）；两次 `post-class-notes stage=degraded score=0.8575 / 0.909` |

---

## AA. 课后笔记 v2 首次真机复盘（批次 V-8，2026-09-25）

> 同一节课的其他功能面见 §Z'/`16-live-lesson-review-20260925.md`（V-7）；本文只覆盖课后笔记 v2。
> 数据源：`socralab_debug.log` + `project-data/.../concept-summaries/.jobs/**` 的真实 trace / job.json / 产物。

| 编号 | 类型 | 内容 |
|---|---|---|
| E-466 | **实证** | 本次 job `pn_mugtvfaz01ee98d8950e`：73 条有效消息 / 4 片；成功片耗时 80.6s、85.8s、79.6s，全部紧贴 90s 单次超时（余量约 10%） |
| E-467 | **实证** | chunk-003 两次尝试都精确撞 90.000s；重试发送的是**同一请求**（同 prompt、同 4096 max_tokens）→ §6.2 的 `shortenTarget` 未覆盖超时行 |
| E-468 | **实证** | 改写对象确认：`[responses-compat] Codex model routed directly to /responses` 于 10:41:25.751Z，我们的 `provider_request` 于 10:41:25.750Z —— 相差 1ms |
| E-469 | **实证** | `responses-api-compat.js:170-171` 只映射 `reasoning`/`reasoning_effort`；`:39` 的 `prefersResponses` 命中 `^gpt-5\.6` → `provider.js` 的 `thinking:{type:"disabled"}` 被静默丢弃 |
| E-470 | **实证** | `job.json` 记 `"modelCalls": null`（NaN 序列化）；三个新 job 皆然，唯一写对的是走 retry 分支的 09-21 job（`calls=12`）→ 调用预算从未生效 |
| E-471 | **实证** | 全仓库 `.cleanup(` 只有 `orchestrator.js:1045` 定义处一行，无调用点 → §5.4 清理策略全部未执行 |
| E-472 | **实证** | 4 个真实 job 全部 `degraded`、`ready` = 0；失败码 `upstream_timeout` / `upstream_network` |
| E-473 | **实证** | 降级笔记 6,736 可见字符 vs 73 条消息的 3,000~4,000 目标带 → `lengthFitness = 0.269`；18 个概念 |
| E-474 | **实证** | 降级笔记 `quality.warnings = []`、`generationMeta.warnings = []`；`degradedReason=chunk_failures` 只在 job.json |
| E-475 | **实证** | 质量分对缺片不敏感：`score=0.909`、`topicCoverage=1`、`evidenceTopicCount=19` —— 只统计幸存的 3 片证据 |
| E-476 | **正面** | trace 洁净：8,272 字节内不含 API key / `Bearer` / `Authorization` / 课堂正文 / 助手名 |
| E-477 | **正面** | 检查点有效：chunk-003 永久失败后其余 3 片证据完整保留，retry 只需补跑该片 |
| E-478 | **正面** | 前端按设计：33 次轮询中首两次 1.5s、其后 8~9s（`document.hidden` 分支）；阶段文案与错误码路径均可见 |

### V-8 结论（一句话）
**v2 的机械部分全部按设计工作（异步 job / 分片 / 检查点 / 错误分类 / 降级 / trace 洁净 / 前端轮询），但换模型后"关闭思考"断在兼容层，导致单片耗时贴死超时上限、长课 100% 降级；另有三条实现级缺陷（调用预算失效、清理器未接线、降级超长且无信号）。**
| E-500 | **实证** | BUG-0016 可观测性修复：`kb-progress.js` 的 `reject(reason, detail)` 两处 helper 均改为携带 `detail`；`validatePageMarker` 的 `taught_page_regressed` 与 `taught_page_outside_loaded_range`、以及 `validateKbMarker` 的同名拒绝，均打出 `{ reportedPage, recordedPage, loadedRange }` |
| E-501 | 实证 | 调用点 `kb-progress.js` 的 `console.warn("[kb-progress] marker rejected:", reason, detail)` 一并打印；实测输出 `marker rejected: taught_page_regressed { reportedPage: 10, recordedPage: 12, loadedRange: '10-14' }` |
| E-502 | 实证 | 回归断言 5 条加入 `kb-progress-smoke-test.js`（`reportedPage`/`recordedPage`/`loadedRange`）；`kb-progress`、`kb-progress-sse`、`progress-guard`、`exercise-mode` 四个测试全 PASS |
| E-503 | 用户口述 | **Q-056 结案：`gpt-5.6-*` 默认开启 reasoning**（来源：用户 2026-09-25 口述）→ BUG-0014 由"定时炸弹"升级为"正在发生的浪费" |
| E-504 | 实证 | 全量矩阵（V-9 后）首跑 132/131/1，唯一失败 `resources/server/kb-inflight-contract-smoke-test.js`（Phase 3 "ordered version-3 fallback segment is preserved"）；**独立复跑 3/3 PASS，全量矩阵复跑 132/132/0 全绿** → 确认为 flake（该测试内含 `Waiting 6s for background job`，负载敏感；与本次改动模块无交集）。`outputs/smoke-after-bug0016-logging-rerun.json` |

### FIX-0017 ~ FIX-0020 实施证据（2026-09-25）

> 产物 `outputs/post-class-notes-v2/fix-20260925T120000Z/`。方案见 `17-…md` §8，口径决策：缺片计入 score。

| 编号 | 类型 | 内容 |
|---|---|---|
| E-479 | **实证** | FIX-0017 红：`thinking:{type:'disabled'}` 过 `chatRequestToResponses()` 后 `result.reasoning === undefined` |
| E-480 | **实证** | FIX-0018 红：`maxCallsPerJob=1` 场景实测 4 次上游调用、错误码 `upstream_timeout`（预算未生效）；绿后 1 次且 `budget_exceeded` |
| E-481 | **实证** | FIX-0019 红：job 达终态后 `store.cleanup` 调用计数为 0 |
| E-482 | **实证** | FIX-0020.3 红：`metrics.chunkCompleteness` 不存在，且 partial.score === whole.score |
| E-483 | **实证** | 实施中发现并修掉：`assembleDegraded` 的 `atFullDetail` 被循环覆盖 → 压缩发生却报 full detail |
| E-484 | **实证** | 门禁：相关模块 9/9、语法 6/6、`.next` 手工 9/9、全量矩阵 132/130/0/2 |
| E-485 | **实证** | 矩阵单独重跑与改动前基线（2026-09-25T19:28，132/130/0）一致 → 零回归 |
| E-486 | **实证** | 假失败定位：首次矩阵的 2 个失败（chat-auth-contract / close-reading-integration）由与 `.next` 测试并行争用造成；单独重跑各 3/3 通过 |

### FIX 批次结论（一句话）
**四条全部落地且带可判别的回归测试（先红后绿），全量矩阵与基线一致零回归；FIX-0017 的实际收益（分片耗时是否降到 90s 以下）与 FIX-0020 的真实规模产物长度仍需重启应用后跑一节长课验证。**
| E-505 | **实证** | BUG-0014 判据加宽：10 文件 / 17 处 `/^deepseek/i` 改为 `/^(?:deepseek|gpt-5\.6)/i`（7 个模块 64092 定义文件各 2 处 + `llm-gateway.js` / `kb-builder-coordinator.js` / `kb-builder.mjs` 各 1 处） |
| E-506 | 实证 | 判据求值：`deepseek-flash` / `DeepSeek-V4.1-Flash` / `gpt-5.6-terra` / `gpt-5.6-sol` = true；`gpt-4o-mini` / `qwen3` = false |
| E-507 | 实证 | `responses-api-compat.js` 的 `thinking` 到 `reasoning` 映射由**并行会话**于 2026-09-25 19:40 落地（FIX-0017，带 4 条断言 `responses-api-compat-smoke-test.js:263-303`）；本轮不改它 |
| E-508 | 实证 | `unsupportedOptionalField()` 字段表加入 `"reasoning"`：网关不认该字段时退化为去掉它重试，而非整条请求失败 |
| E-509 | **实证** | 新回归测试 `lib/thinking-gate-smoke-test.js`：10 个 payload 构造者全覆盖、跨模块 thinking 到 reasoning 联调、判据边界，4/4 PASS |
| E-510 | 实证 | 验证：10 个改动文件 `node --check` 通过；compat 系 4 个测试全 PASS；`.next` 手工 30/29/1（失败=BUG-0011）；矩阵首跑与复跑 133/132/1 |
| E-511 | **实证** | 矩阵唯一失败 `pdf-ocr-priority-smoke-test.js` 与本轮无关：只 require `pdf-ocr-coordinator.js`；独立 8 次失败 2 次（约 25%，`await delay(30)` 时序假设）；**第三次全量矩阵 133/133/0 全绿** |
| E-512 | 实证 | 生效核对：改动 mtime 14:49~14:58 本地**早于**应用启动 15:04:47 本地，运行实例已带修复；但 09-26 模型已切回 `DeepSeek-V4.1-Flash`（老判据本命中），日志 `applied=true` 无法区分修复前后，须等切回 gpt-5.6 才可验收 |
| E-513 | **实证** | 实机现场：会话 `l8CSY0K4pq761mzn_LSNy`（KUyw《编译原理 第二版》648 页，无 knowledge_base）第 851 代权威状态 `serverTurnOrdinal/lastAdvanceServerOrdinal = 28/19`（delta 9）、`structuredTeachingProgress=true`、`pageOnlyTeachingProgress=true`、`lastTaughtPage=75`、candidate 76–91 已预取；日志 `页级进度已讲到窗口末页（阶段二未启用，仅观测）`（07:49Z）、`marker rejected: taught_page_outside_loaded_range { reportedPage: 76, loadedRange: '70-75' }`（07:24Z / 07:59Z）、`[C5-未修复]`（09-25 11:47） |
| E-514 | **实证** | 根因定案（三条自动推进路径全堵死）：①`auto-advance.js:1419 completeTurn` 无条件用协议标志武装 C5 门闩，页级教材无法解锁；②`kb-progress.js:25 PAGE_LEVEL_WINDOW_COMPLETE_ENABLED=false` → 页级 `windowComplete` 恒 false → 无已验证 `pendingAdvance`；③`kb-progress.js:591 validatePageMarker` 拒收"窗口末页+1"，模型讲完报 76 被整单拒收（完成声明一并丢失） |
| E-515 | **实证** | 判别力对照（临时回退单点 → 对应断言先红，非事后补测）：回退 M1 → `a protocol turn alone must not arm the C5 gate (turn 1)`；回退 M4 → `a poisoned flag must not block the threshold fallback (turn 12)`；回退 M2 → `a page-only marker clears the legacy structured flag`；回退 M3 → `the repair merge does not re-adopt a structured flag from a page-only projection`；回退 M6 → `a window-end+1 report with a completion claim is accepted` |
| E-516 | **实证** | 验证：3 个改动文件 `node --check` 通过；相关回归 15 项全 PASS（auto-advance ×6、kb-progress ×2、progress-guard、exercise ×2、jump-page-ocr-route，以及手跑的 chat-teaching-progress-format / chat-end-class-integration / chat-reading-window-truncation）；全量矩阵 **133 / 131 / 0 / 2**（与 V-10 基线一致，零回归） |
| E-517 | 实证 | M6 设计边界（硬约束，非启发式）：只接纳 `loadedEnd+1` 且必须显式 `windowComplete:true`；`end+2` 及以上、无 claim 的 end+1 一律维持原拒签，以防静默跳页；钳制后回退守卫照常生效；概念分支与练习模式分支零改动 |
| E-518 | 实证 | 未做：阶段三开关仍 `false`（待观测日志读数）；阶段四词表未动；**应用尚未重启**，真机复测待做 |
| E-519 | **实证** | 独立复验（非作者）：并行会话声明的回归集 15 项全部 PASS（含 `auto-advance-protocol-bundle`、`auto-advance-teaching-state-machine`、`kb-progress`、`chat-teaching-progress-format` 等） |
| E-520 | **实证** | 独立全量矩阵：133 例 / 132 通过 / 1 失败 / 0 跳过；唯一失败为既有 flake `pdf-ocr-priority`（E-511）→ **零回归**。`outputs/smoke-verify-stallfix.json` |
| E-521 | 实证 | 台账失效引用修复：BUG-0016 的"可观测性"证据原引 `E-479~E-481`（那是并行会话的号），实为 `E-500~E-502`（本队于 2026-09-26 整体改号所致） |
| E-522 | **实证** | 真机状态：应用 `startedAt 2026-09-26T09:44:08Z`（本地 17:44）**晚于**阵锁修复全部改动（16:56~17:19 本地）→ 修复已在运行实例里；重启后日志仅 69 行、一条 `[C3] 页级进度模式`、尚无 marker → **真机复测待回合积累** |
| E-523 | **实证** | 阶段三前置历史数据（只读全日志 09-01~09-26）：`[C5]` 告警 14 次命中 **11 个不同会话**；`[C3]` 页级降级 41 次命中 **17 个会话**；`页级进度已讲到窗口末页` 14 次；`taught_page_regressed` 15 次；`taught_page_outside_loaded_range` 9 次 |
| E-524 | **实证** | 9 次 outside_range 拒签中仅 2 次带 `detail`（09-25 才加），而这 2 次**全部是 end+1**（`reportedPage=76 / loadedRange=70-75`）→ 支持 M6 只钳制 end+1 的取舍，但样本仅 2 次且同会话同窗口 |
| E-525 | 实证 | `AUTO_ADVANCE_PAGE_ONLY_STALL_FIX_PLAN.md` 追加 §十一 附录（阶段三前置数据 + 谨慎判读 + 建议），作者标注为另一会话、只读不改码 |
