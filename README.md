# Socratopia（苏格拉底）

Socratopia 是一款 Windows 桌面端「苏格拉底式教学」应用（Electron + Next.js）：一本教材、一个 NPC 教师、一堂可被追问的课。本仓库同时保存**可运行的打包运行时**、**全部产品与研究文档**、**世界设定与角色素材的取证档案**。

> 公开仓库，记录一次「没有源码、没有构建链路」的系统上做的工程实践：打包产物的外科式补丁、LLM 调用的成本与缓存优化、Windows 文件锁死循环的根因定位，以及一套可直接投喂被测 agent 的评测任务包。运行所需的 `resources/settings.json` / `set.json` 不入库（见「配置与密钥」）。

## 从简历点进来的话

| 想看的 | 去哪儿 |
|---|---|
| 项目全貌与时间线 | [`docs/project-reconstruction/00-phase-a-project-map.md`](docs/project-reconstruction/00-phase-a-project-map.md)、[`03-timeline.md`](docs/project-reconstruction/03-timeline.md) |
| BUG 台账（22 个，含证据与复现） | [`docs/project-reconstruction/04-bug-ledger.md`](docs/project-reconstruction/04-bug-ledger.md) |
| 技术债与风险清单 | [`docs/project-reconstruction/05-tech-debt-and-risks.md`](docs/project-reconstruction/05-tech-debt-and-risks.md) |
| 哪些是本分支做的（量化边界） | [`docs/project-reconstruction/09-original-vs-branch-boundary.md`](docs/project-reconstruction/09-original-vs-branch-boundary.md) |
| 账单反解与缓存命中率优化 | [`docs/llm-cost-and-cache-optimization.md`](docs/llm-cost-and-cache-optimization.md) |
| 教材插图两级缓存 | [`IMAGE_ASSET_LAYER_T13_COMPLETION_REPORT.md`](IMAGE_ASSET_LAYER_T13_COMPLETION_REPORT.md) |
| 数学公式朗读引擎 | [`MATH_SPEECH_CORE_COMPLETION_REPORT.md`](MATH_SPEECH_CORE_COMPLETION_REPORT.md) |
| Agent 评测任务包 | [`agent-task-datasets/`](agent-task-datasets/)（三套；含评分方锚点答案） |
| 验证基线（356 个冒烟测试怎么跑） | [`docs/project-reconstruction/10-verification-baseline.md`](docs/project-reconstruction/10-verification-baseline.md) |

> 全部数字都在对应文档里有取证路径；`09-original-vs-branch-boundary.md` 明确区分了「本体自带」与「本分支新增」，引用时请以它为准。

## 这是什么形态的仓库

**这是打包产物的仓库，不是可编译的源码树。** 没有构建流水线会从源码重新生成 bundle，所有改动都是对编译产物（webpack/esbuild 输出）的外科式补丁，靠 `node --check` / acorn 加就地冒烟测试验证。唯一手写、可当普通源码编辑的是 `resources/server/server.js` 与 `resources/server/lib/` 下的模块。

- 上游源码仓库（macOS）：`socralab-app/v2`
- 架构、全局注入契约、鉴权模型、LLM 层的完整说明在 [`CLAUDE.md`](CLAUDE.md)，[`AGENTS.md`](AGENTS.md) 是给其它 agent 的压缩版

## 三层结构

1. **Electron 主进程** — `main.js` / `preload.js`（运行时位于 `resources/app.asar` 的 `dist-electron/main.js`），负责拉起 Next、持有原生能力，以 `window.electronAPI` 暴露给渲染层
2. **Next.js 服务** — `resources/server/server.js`，以子进程方式在 `127.0.0.1:<动态端口>` 运行，端口写入 `<userData>/.server-port`
3. **React 前端** — `resources/server/.next/static/chunks/` 里的编译产物，在 BrowserWindow 内渲染

`server.js` 在 Next 启动前把配置和 `global.*` 模块句柄装上（表在 `server.js:881-900`），编译产物无法 `require()` 的模块只能从那里取。

## 目录导览

| 路径 | 内容 |
|---|---|
| `main.js`、`preload.js`、`resources/` | 运行时。`resources/server/lib/` 是手写子系统（教学自适应、练习、知识源、插图资产等） |
| `docs/` | 产品与研究文档。[`docs/project-reconstruction/`](docs/project-reconstruction/README.md) 是项目全貌入口（项目地图、时间线、BUG 台账、技术债、重构路线） |
| `agent-task-datasets/` | General Agent 评测任务包（T1 教学档案健康度审计 / T3 时间表述一致性审计 / T4 角色人设相容性审计）+ 评分方锚点答案 |
| `资料/` | 世界设定取证档案：BWIKI 原文 HTML、抽取文本、索引与 SHA-256 清单（[说明](资料/README.md)） |
| `角色/` | 32 个角色的设定、人设模板、立绘素材（[说明](角色/README.md)） |
| `PROJECT_MATH_SPEECH_DOSSIER/` | 数学公式语义化项目档案（[说明](PROJECT_MATH_SPEECH_DOSSIER/README.md)） |
| `win-unpacked/` | 一份干净发布版的提交快照，不是自动同步的 |
| `tools/` | 冒烟测试矩阵、ASAR 完整性补丁、发布暂存等运维脚本 |

根目录还有一批成体系的技术报告：自适应教学模式、插图资产层、TTS 优化、课堂上下文、课后笔记可靠性。它们描述的是已交付行为，改代码前值得先读。

## 运行

```powershell
./Socratopia.exe                      # 启动应用
node --check <改过的文件>              # 语法检查
node <模块旁的 *-smoke-test.js>        # 就地冒烟测试
node tools/run-smoke-matrix.js        # 全量冒烟测试
```

改动分层与重启范围：

| 改动 | 编辑 | 之后 |
|---|---|---|
| API 路由 | `resources/server/.next/server/app/api/*/route.js` | `node --check`，重启应用 |
| 共享服务逻辑 | `resources/server/lib/*.js`（手写）或 `.next/server/chunks/*.js` | 同上；chunk 内不能 `require("fs")` |
| 前端 | `resources/server/.next/static/chunks/**/*.js` | `node --check`，重启应用 |
| Electron 主进程 | 根 `main.js` / `preload.js` | 重打包 `app.asar` 并重嵌 `ELECTRONASAR` 完整性哈希 |

ASAR 与完整性哈希的坑（EXE 被占用时会静默产出不匹配的一对）都用 `node tools/finish-asar-repack.js` 处理。

## 配置与密钥

`resources/settings.json`（端点、API key）与 `resources/set.json`（各角色模型）**不入库**，需自备；仓库里只有冒烟测试用的 `mock-key` 样例。历史上没有提交过真实 key。

## 大文件

`agent-task-datasets/**/chats/*.json` 走 **Git LFS**（T1 里有两个 99 MB / 121 MB 的对话档，超过 GitHub 单文件 100 MB 上限）。克隆前先装好 `git lfs`，否则拿到的是指针文件。

## 约定

- 临时产物放 `tmp/` 或 `outputs/`，都已忽略
- 新冒烟测试命名为 `<模块>-smoke-test.js`，与被测模块同目录
- 提交信息用简洁祈使句，描述交付的行为
- `资料/来源原文/**`、`资料/可用文本/**` 在 `.gitattributes` 里关掉了换行转换，因为清单是按 LF 字节算 SHA-256 的，不要「修」行尾
