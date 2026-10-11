# 旧文档判断与新旧映射

> 阶段 E（批次 E-2，2026-09-14）。证据 E-350 ~ E-362。
> **本轮只判断，不搬迁、不删除**（DECISIONS D-002）。搬迁留待用户确认后进行。
> 判断档位：`有效` / `部分过时` / `重复` / `历史资料` / `待确认`。

---

## 0. 判断标准

| 档位 | 含义 | 处置建议 |
|---|---|---|
| **有效** | 内容与当前代码一致，可作一手依据 | 保留，纳入正式索引 |
| **部分过时** | 主体有效，但含已失效的数字/路径/结论 | 保留 + 就地标注过时点（**不要删**） |
| **重复** | 与其他文档覆盖同一主题，信息子集 | 保留，索引里指向权威那份 |
| **历史资料** | 记录的是当时状态，本身不再更新，但有史料价值 | 保留，标日期与语境 |
| **待确认** | 无法判断是否仍成立 | 保留 + 列核实点 |

**核心原则**：本仓库经历过两次"删历史"（E-080/E-081/E-082、Q-008），**所以默认倾向保留，不倾向删**。

---

## 1. 根目录文档逐份判断

| # | 文档 | 大小/日期 | 跟踪 | 判断 | 依据与说明 |
|---|---|---|---|---|---|
| 1 | `AGENTS.md` | 5,116 B / 已更新 | TRACKED | **部分过时** | 引用的 `Socratopia_2.0` 兄弟副本**不存在**；"28 routes"≈ 基线 27（E-178）；"server 复制到用户目录"错（E-100）。疑似**上游沿用**（Q-023）。用户近日已更新，但第 12 行仍留失效引用 |
| 2 | `CLAUDE.md` | 12,970 B / 已更新 | **untracked** | **有效**（当前最准） | 用户已修正 `__SOCRATOPIA_ROUTE_AUTH__` 命名、补 `server.js:881-900` 注入表位置、动态端口、`win-unpacked/` 快照性质、`release-runtime-manifest.json` 双重哈希。**但仍含失效的 `Socratopia_2.0` 引用**。**未跟踪是最大问题** |
| 3 | `方案.md` | 99,817 B / 自述 2026-08-19 | TRACKED | **有效（计划）** | 《自适应教学闭环实现方案》。**是计划不是现状**——须与 E-200/E-204 对照读：Stage B 疑似未做、stage-d 未接线。mtime 8-31 ≠ 文档日期 8-19（E-162） |
| 4 | `ADAPTIVE_TEACHING_MODE_TECHNICAL_REPORT.md` | 31,491 B / 2026-06-24 | TRACKED | **历史资料** | 最早的自适应规划（E-115）。明说"只做产品和技术分析，不要求立即修改代码"。已被 `方案.md` 取代为新版；**但保留了"为什么独立于普通聊天教学逻辑"的动机，仍有价值** |
| 5 | `PRACTICE_FEATURE_TECHNICAL_PLAN_AND_CLAUDE_PROMPTS.md` | 23,662 B / 2026-06-24 | TRACKED | **历史资料 + 部分有效** | 练习功能方案（E-116）。其"如果只能在打包产物上热修…**不建议作为第一选择**"在被证伪后仍有史料价值；功能定位句"不是搜答案，而是把题讲到你会"仍准确 |
| 6 | `VOICE_MODEL_MAPPING_REPORT.md` | 12,068 B / **2026-06-05** | TRACKED | **历史资料** | **仓库内最早文档**（早于 git 起点 12 天）。语音链路分布调查，含 `4137`/`3461` 双副本事实（E-017/E-160）。模型名与 key 可能已过时，需核对 |
| 7 | `TTS_OPTIMIZATION_CHANGELOG.md` | 14,028 B / 持续追加 | TRACKED | **有效** | 最新的条目到 2026-09-12；是 TTS 主题的权威变更记录。含模型服务端（仓库外 `D:\model_tts\...`）改动 |
| 8 | `AUTO_ADVANCE_WINDOW_REPAIR_CHANGELOG.md` | 18,633 B / 2026-09-11 | **untracked** | **有效** | BUG-0001 的完整修复记录，含回滚锚点（E-280）。**未跟踪** |
| 9 | `LLM_THINKING_FIX_CHANGELOG.md` | 4,943 B / 2026-09-11 | **untracked** | **有效** | BUG-0002 根因 + 对照实验（E-281）。**未跟踪** |
| 10 | `POST_CLASS_SAVE_FIX_2026-09-13.md` | 10,113 B / 2026-09-13 | **untracked** | **有效** | BUG-0003 修复记录（E-282）。**未跟踪** |
| 11 | `DEEPSEEK_V4_FLASH_CLASSROOM_CONTEXT_PLAN.md` | 12,034 B | **untracked** | **待确认** | 课堂上下文方案。需核对与 `*_IMPLEMENTATION_CHECKLIST.md` 的**先后与完成度**（谁在谁之后、清单是否已勾完） |
| 12 | `DEEPSEEK_V4_FLASH_CLASSROOM_CONTEXT_IMPLEMENTATION_CHECKLIST.md` | 21,654 B | **untracked** | **待确认** | 同上，实施清单。**需核实实际落地比例** |
| 13 | `DEEPSEEK_V4_FLASH_CLASSROOM_ACCEPTANCE.md` | 7,093 B | **untracked** | **待确认** | 同上，验收。三份构成一组，建议**合并为一份带时间线的专题** |
| 14 | `MATH_SPEECH_CORE_DEVELOPMENT_SPEC.md` | 32,542 B / 2026-09-02 | **untracked** | **有效** | 数学语音开发规格。该模块文档/测试最完整（E-226） |
| 15 | `MATH_SPEECH_CORE_ACCEPTANCE_SPEC.md` | 27,686 B / 2026-09-02 | **untracked** | **有效** | 对应验收规格 |
| 16 | `MATH_SPEECH_CORE_COMPLETION_REPORT.md` | 9,196 B / 2026-09-04 | **untracked** | **有效** | 完成报告。**但注意**：该模块前端仅 2 处引用（E-220）→ "完成"指核心完成，非端到端上线 |
| 17 | `上下文.md` | 8,575 B | TRACKED | **待确认（疑似误放）** | 内容讲的是 `C:\Users\ASUS\webserver` 的 C 语言 HTTP 服务器作业，**与 Socratopia 无关**（E-013/Q-005）。与 Socratopia 同日期（8-31）→ 不排除有意保留作对照 |

### 结论
- **有效**：`CLAUDE.md`、`方案.md`、`TTS_OPTIMIZATION_CHANGELOG.md`、`AUTO_ADVANCE_*`、`LLM_THINKING_*`、`POST_CLASS_SAVE_*`、`MATH_SPEECH_CORE_*`(3) 共 9 份
- **部分过时**：`AGENTS.md` 1 份
- **历史资料**：`ADAPTIVE_TEACHING_MODE_TECHNICAL_REPORT.md`、`PRACTICE_FEATURE_*`、`VOICE_MODEL_MAPPING_REPORT.md` 3 份
- **待确认**：`DEEPSEEK_V4_*`(3)、`上下文.md` 共 4 份
- **重复**：0 份（根目录尚无完全重复；重复集中在 `outputs/`）

---

## 2. 目录级材料判断

| 材料 | 判断 | 说明 |
|---|---|---|
| `PROJECT_MATH_SPEECH_DOSSIER/`（8 文档） | **有效，但与根目录 3 份数学语音文档部分重复** | 该专题实际上有 **11 份文档 + 4 轮验收目录**（`outputs/math-speech-acceptance-round{2,3,4}`、`math-speech-remediation`）→ **需合并索引，不必删** |
| `outputs/OCR_TRANSCRIPTION_PLAN*.md`（**9 版**） | **重复**（严重） | 同一方案 9 个文件名递进（E-151）。建议按时间排序后只把最后 1~2 份标为权威 |
| `outputs/session-rubric-evaluation-*.md`（3 版） | **重复** | 同日三份（lenient/moderate/常规） |
| `outputs/math-speech-remediation/` | **有效** | 含 `known-limitations.md`、故障注入、哈希审计——**独立性强，是整改证据** |
| `outputs/backend-security-audit-20260901.md` | **有效（重要）** | 唯一一份系统审计，含未修 8 项（E-284） |
| `outputs/uncommitted-changes-fix-plan-2026-09-01.md` | **待确认** | 5 项修复计划，**落地状态未核实**（Q-039） |
| `outputs/acceptance/20260829-*/`（2 轮） | **历史资料** | 验收记录 |
| `outputs/character-import-20260913/`、`tts-zh-install-20260913/`、`post-class-save-fix-20260913/` | **历史资料** | 日期化工作快照 |
| `tmp/*.py`（角色导入、模板优化） | **有效但易丢** | **唯一副本脚本躺在"临时"目录**（E-153） |
| `tmp/*-smoke-test.js`、`tmp/embedded-check/` | **待确认** | 与 `resources/server/lib/` 下同名测试的关系不明 |

---

## 3. 已有的"整理尝试"（避免重复造轮子）

| 尝试 | 位置 | 现状 |
|---|---|---|
| `RENAME.md`（2026-08-23） | 已被删除，本工作取回（E-080） | 实质是**一份完整的项目史**——与本次工作重叠度最高 |
| `改动日志.md`（2026-08-14） | 已被删除，本工作取回（E-081） | 专题改动记录 |
| `docs/knowledge-source-provider/`（3 份） | 已被删除，本工作取回（E-083~E-085） | 该专题的完整规划+验收——**目前无替代** |
| `PROJECT_MATH_SPEECH_DOSSIER/06-iteration-log.md` | 现存 | 数学语音的迭代日志——**同一思路的局部示范** |

> **判断**：`RENAME.md` 与本次 `docs/project-reconstruction/` 是**同一件事的两次尝试**。区别：`RENAME.md` 是叙述式单文件，本次是**带证据编号、可核查、分工可扩展**的结构。→ **不冲突，`RENAME.md` 保留为史料，本次作为工作索引。**

---

## 4. 新旧映射（关键结论 → 权威来源）

| 主题 | 旧文档 | 本次对应文档 |
|---|---|---|
| 项目史 / 魔改历程 | `RENAME.md`（已删，E-080） | `03-timeline.md`、`08-information-disorder-root-causes.md` |
| 专题改动记录 | `改动日志.md`（已删，E-081） | 各模块档案 §历史、`04-bug-ledger.md` |
| 架构与约束 | `AGENTS.md`（部分过时） | `CLAUDE.md`（较准）+ `00-phase-a-project-map.md`、各档案 |
| 自适应教学设计 | `方案.md`、`ADAPTIVE_TEACHING_MODE_TECHNICAL_REPORT.md` | `02-module-dossiers/adaptive-teaching.md` |
| 练习功能 | `PRACTICE_FEATURE_*.md` | `02-module-dossiers/branch-feature-modules.md` §1 |
| 语音 | `VOICE_MODEL_MAPPING_REPORT.md`、`TTS_OPTIMIZATION_CHANGELOG.md` | `branch-feature-modules.md` §8、`support-infrastructure.md` §4 |
| 安全 | `outputs/backend-security-audit-20260901.md` | `05-tech-debt-and-risks.md` §4（**原文仍是权威**） |
| 产品愿景 | `resources/bundled-content/zh/initial_world/world_preset.md` | `01-product-vision-and-evolution.md`（**原文才是权威**） |

> **原则**：本次整理文档是**索引与导航**，不能替代原文。凡"原文仍有效"（审计、愿景、规格、验收）→ **引用原文，不复制粘贴**。

---

## 5. 建议的处置动作（待用户确认后执行）

1. **零风险**（纯新增）：把 `CLAUDE.md`、各 `*_FIX_*`/`*_CHANGELOG.md`、`MATH_SPEECH_CORE_*`、`DEEPSEEK_V4_*`、`PROJECT_MATH_SPEECH_DOSSIER/`、`tools/` 纳入 git（R-02）。
2. **低风险**：在 `AGENTS.md` 顶部加一行"部分内容已过时，以 `CLAUDE.md` 为准"；修正其中失效路径。
3. **低风险**：`outputs/OCR_TRANSCRIPTION_PLAN*.md` 9 版 → 建一份 `outputs/OCR_TRANSCRIPTION_PLAN.md` 顶部的"版本导航"，不删旧版。
4. **中风险（需确认）**：`上下文.md` 移到 `docs/external/` 或加一行说明。
5. **中风险**：`tmp/*.py` 提升到 `tools/`。
6. **保留不动**：`RENAME.md`（若重新落盘）、`recovered/`。

---

## 6. 证据
E-350 根目录 18 份 `.md` 的逐份大小与 git 跟踪状态（§1 表）
E-351 `AGENTS.md` 现 5,116 B / `CLAUDE.md` 现 12,970 B（用户已于 2026-09-14 更新，前值为 4,031 / 8,171）
E-352 `git -c core.quotePath=false ls-files` 结果：根目录仅 6 份 md 被跟踪，12 份未跟踪
E-353 E-151（OCR 9 版）、E-153（tmp 脚本）、E-155（同日三份评估）
E-354 E-080/E-081/E-083~E-085（三批被删文档及其取回）
E-355 `outputs/backend-security-audit-20260901.md`、`outputs/math-speech-remediation/known-limitations.md`
E-356 `PROJECT_MATH_SPEECH_DOSSIER/` 8 文档 + `06-iteration-log.md`

## 7. 待确认
- Q-045：`DEEPSEEK_V4_FLASH_CLASSROOM_*` 三份的先后关系与实际落地比例。
- Q-046：`上下文.md` 是有意保留的对照材料还是误放。
- Q-047：`tmp/` 下测试与 `resources/server/lib/` 下同名测试的关系（哪份是权威）。
