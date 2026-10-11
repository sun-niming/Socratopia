# 项目整理总入口 (README)

> 目标：让**没有参与过开发的人**能凭本目录材料回答"这产品最初想干什么、后来变成什么、现在有什么、怎么实现的、历史上发生了什么、哪些是残留、该按什么顺序重构"。
> 本目录是**整理工作**的产物，不是产品文档的替代品；产品事实一律带证据编号。

## 阅读顺序

1. `README.md`（本文件）— 全局
2. `00-phase-a-project-map.md` — 项目地图、材料分布、可访问性（**先读这个**）
3. `WORKSTATE.md` — 当前进度、下一步
4. `RESUME.md` — 新会话交接（≤1000 字）
5. `EVIDENCE.md` — 证据索引（引用 `E-nnn`）
6. 专题文档（见下）

## 工作控制文件

| 文件 | 作用 |
|---|---|
| `README.md` | 总入口、阅读顺序、进度总览 |
| `WORKSTATE.md` | 当前阶段、已完成批次、阻塞、下一步 |
| `RESUME.md` | 新会话交接说明（短） |
| `INVENTORY.md` | 资料/模块清单与状态 |
| `EVIDENCE.md` | 证据来源索引（`E-nnn`） |
| `OPEN-QUESTIONS.md` | 未决问题（`Q-nnn`） |
| `DECISIONS.md` | 整理工作自身的决策（`D-nnn`） |

## 专题文档

| 文档 | 覆盖阶段 | 状态 |
|---|---|---|
| `00-phase-a-project-map.md` | 阶段 A 项目地图 | 已建立 |
| `01-product-vision-and-evolution.md` | 阶段 B 愿景与演变 | **初稿**（批次 B-2） |
| `03-timeline.md` | 阶段 D 开发时间线 | **初稿**（批次 B-1） |
| `04-bug-ledger.md` | 阶段 D BUG 台账（7 条历史 + 3 条当前可复现 + 8 项未修） | **已完成**（D-1 / V-1 / V-2） |
| `05-tech-debt-and-risks.md` | 阶段 E 技术债与风险（R-01~R-22） | **已完成**（E-1 / V-3） |
| `06-refactor-roadmap.md` | 阶段 E 重构路线（P0~P5 六批） | **已完成**（E-3） |
| `07-legacy-docs-assessment.md` | 阶段 E 旧文档判断与新旧映射 | **已完成**（E-2） |
| `08-information-disorder-root-causes.md` | 混乱的根因分析（M1~M6 + A1~A3） | **已完成**（B-4） |
| `09-original-vs-branch-boundary.md` | **本体 vs 分支能力边界（定量）** | **已完成**（C-3a） |
| `10-verification-baseline.md` | **实跑验证基线**（最新：157 例 / 155 通过 / 2 失败，见 §4c） | **已完成**（V-1，§4c 更新） |
| `11-completion-report.md` | **完成报告**（实际覆盖 / 未覆盖 / 执行过的验证） | **已完成** |
| `12-bug-verification-round.md` | **BUG 逐条验证（V-2）**：7 条历史修复全部升级为"通过针对性验证" | **已完成** |
| `13-live-e2e-smoke.md` | **端到端实况取证（V-3）**：应用运行日志 + 探活；发现 BUG-0012 | **已完成** |
| `14-bug0012-fix.md` | **BUG-0012 修复记录 + 验收附录**（首次改业务代码） | **验收未通过**（V-4 修，V-5 判无效） |
| `15-bug0012-reader-sync-fix.md` | **BUG-0012 方向①落地**：3 处异步读改同步读（V-6） | **✅ 已通过真实验收** |
| `18-bug0014-thinking-gate-fix.md` | **BUG-0014 修复**：判据改为能力（V-10） | **已落地，待 gpt-5.6 实测** |
| `16-live-lesson-review-20260925.md` | **最新一节完整课堂复盘（V-7）**：BUG-0012 验收通过；新发现 BUG-0014/0015/0016 | **已完成** |
| `02-module-dossiers/` | 7 份模块档案 | **已完成**（C-1~C-6） |
| `recovered/` | **从 git 取回的已删史料**（非控制文件，是证据本体） | 已导出 6 份 |

> 不预建空文件；某个专题开始时才创建。

## 跨目录的相关文档（不在本目录）

| 文档 | 内容 | 状态 |
|---|---|---|
| `AUTO_ADVANCE_PAGE_ONLY_STALL_FIX_PLAN.md`（仓库根） | 页级模式死锁修复方案 + 实施记录（内文编号「BUG-0017」，**台账归属 BUG-0016**，文档第 5 行有对照）；§十一 为另一会话追加的阶段三前置数据 | 阶段一/二已实施；阶段三/四待定 |
| `LLM_THINKING_FIX_CHANGELOG.md`、`TTS_OPTIMIZATION_CHANGELOG.md` 等（仓库根） | 各功能线的历史变更记录 | 见 `07-legacy-docs-assessment.md` |

## 进度总览

- 阶段 A：**已完成**｜阶段 B：**已完成**（B-1~B-4）｜阶段 C：**已完成**
- 阶段 D：**D-1 完成**（D-2 未做）｜阶段 E：**已完成**
- 阶段 V：**V-1 ~ V-10 完成**（实跑基线、逐条验证、端到端实况、BUG-0012 修复/判定/落地/**验收通过**、最新课堂复盘）
- 执行：动过 1 条业务缺陷（BUG-0012）：V-4 修（判无效）→ V-6 方向①落地 → **V-7 验收通过**；P0 其余项待授权
- **本轮收口**：见 `11-completion-report.md`（含未覆盖清单与"结论保质期"）

> ⚠️ **业务代码改动共 2 轮**：① `auto-advance.js` 重试预算 1 行（V-4）；② 3 处异步读改同步读（V-6，见 `15-bug0012-reader-sync-fix.md`）。其余均为 `docs/project-reconstruction/**` 与 `outputs/`。

## 新读者路径（按目的选）

| 你的目的 | 读这些 |
|---|---|
| 快速搞懂这是什么产品、原本想做啥 | `01-product-vision-and-evolution.md` §0/§1 → `09-original-vs-branch-boundary.md` |
| 搞懂为什么这么乱 | `08-information-disorder-root-causes.md` |
| 上手改代码 | `README.md` 本页"六条结论" → `02-module-dossiers/` 对应档案 → `10-verification-baseline.md` |
| 知道现在坏在哪 | `10-verification-baseline.md` §2 三个可复现缺陷 → `04-bug-ledger.md` |
| 决定下一步做什么 | `05-tech-debt-and-risks.md` → `06-refactor-roadmap.md` |
| 判断某份旧文档可不可信 | `07-legacy-docs-assessment.md` |
| 看历史发生了什么 | `03-timeline.md` → `recovered/` |

## 当前待办缺陷（V-1 / V-3 / V-7 发现；已修的划掉）

| BUG | 现象 | 复现 |
|---|---|---|
| ~~BUG-0009~~ | ✅ **已修复（外部，2026-09-20 观察到）**：`release/win-unpacked/` 缺 `lib/knowledge/daimon-bridge.js` → 该树启动即崩 | `node resources/server/lib/staged-ws-runtime-smoke-test.js` |
| ~~BUG-0010~~ | ✅ **已修复（外部，2026-09-20 观察到）**：根 `main.js` 与 ASAR 副本内容分叉 45 B | `node resources/server/electron-adaptive-capability-smoke-test.js` |
| ~~**BUG-0014**~~ | ✅ **已修（2026-09-26）**：`thinking` 注入判据由模型名改为能力（10 文件 17 处全覆盖）+ 新回归测试。**待切回 gpt-5.6 实测验收**（现模型为 deepseek，老判据本就命中） | `node resources/server/lib/thinking-gate-smoke-test.js`；详见 `18-bug0014-thinking-gate-fix.md` |
| BUG-0015 | `lesson-summary` 连接超时（10s 打在慢主机 `api.nwafu-ai.cn`），对用户无声 | 见 `16-…md` §3 |
| BUG-0016 | 连续 `marker rejected` → 页级降级 → 窗口无法推进（C5 现场）。**已加拒绝详情日志（V-9）** | 见 `16-…md` §4 |
| BUG-0011 | 前端能力助手吞掉 legacy 降级路径 | `node resources/server/.next/server/app/api/flashcard/flashcard-adaptive-evidence-smoke-test.js` |
| ~~**BUG-0012**~~ | ✅ **已通过真实验收（2026-09-25）**：115 轮 0 次（修复前 9.8%）。旧判读：修复已生效但验收未通过（2026-09-18）：真实课堂反复丢进度（EPERM）。旧根因（预算不一致）被推翻 → 真凶是**同步重试阻塞事件循环、饿死同进程异步持有者（自锁）**，**加宽预算结构上无效**。见 R-23 / Q-054 | `node resources/server/lib/reading/auto-advance-atomic-write-retry-smoke-test.js`；复现 `node outputs/bug0012-livelock/repro.js`；详见 `14-bug0012-fix.md` 附录 |

**回归基线（已更新）**：`node tools/run-smoke-matrix.js`（跳过 `.next`）+ `.next` 下 25 个测试补跑；合计 **146 例 / 141 通过 / 3 失败 / 2 跳过**。后续改动验收不得低于 141 通过、失败数不得增加。

## V-3 实况取证（2026-09-14）——应用运行中

**正面**：模块全载；**鉴权 fail-closed 生效**（无令牌 POST `/api/chat` → 401 `auth_missing` + traceId）；**劫持挂载生效**（`[kb-progress]` 日志 198 次，Q-026 结案）；**BUG-0002 运行时验证通过**（`applied=true` ×190、`applied=false` ×0，且模型名 `DeepSeek-V4.1-Flash` 旧白名单因大小写本会判 false）。
**新缺陷**：**BUG-0012** —— 16 次 EPERM 丢失课后进度保存（09-11~09-14，每天 3~5 次，未改善），根因是 `auto-advance.js` 重试仅 5 次/≈375ms（`kb-progress.js` 为 10 次/≈1.1s），异常冒泡后整轮进度作废，且 `PROGRESS_SAVE_FAILED` 静默。
详见 `13-live-e2e-smoke.md`。

## 已闭环的部分（V-2，2026-09-14）

**BUG 台账 §1 的 7 条历史修复已全部升级为"通过针对性验证"**（逐条复现修复文档自己声明的验证方式；BUG-0002 限单元级）。
番外收获：**BUG-0004 实际已修**（诊断文档当时自称"仅诊断"），且带 4 条精确到根因的回归断言。
→ 说明这支分支**修复质量与测试纪律良好**，问题在组织（无源码／无版本控制／矩阵漏覆盖），不在能力。详见 `12-bug-verification-round.md`。

## 六条最重要的早期结论（先记住）

0. **"为什么这么乱"有专门文档**：`08-information-disorder-root-causes.md`。一句话结论——混乱主因**不是"没有源码"，而是"在没有源码时没建立最低限度的记录纪律"**。无源码意味着改动不可逆、不可重建，本应更依赖文档与版本保护，实际却相反。

1. **git 只覆盖 2026-06-17 之后**（19 提交，E-002）。~2026-03 起的更早历史基本无据（Q-003）。
2. **存在两层愿景，绝不可混**（`01-product-vision-and-evolution.md` §0）：L1 产品本体愿景（原始 Socratopia 团队，来源 `bundled-content/zh/initial_world/world_preset.md` —— "天性教育法之问"、"伙伴 + 苏格拉底 = 3X · 3A"，E-110）；L2 本仓库补丁分支的目标（E-080）。**别把 L2 功能清单当愿景答。**
3. **这是一条"魔改"分支**（E-080）：应用本体是既有的成品包，本团队的工作是在编译产物上注入新能力。**不要把"本体原有功能"记成本团队成果。**
4. **`AGENTS.md` 已部分过时且与 `CLAUDE.md` 冲突**，含一处足以让修改"看起来没生效"的关键矛盾：server 是"复制到用户目录"还是"原地运行"（Q-004）。
4. **2026-08-31 之后的工作几乎没有 git 保护**（E-093）：近半月全部文档、`tools/`、`outputs/`、`角色/` 均为未跟踪文件。
5. **无源码仓库**（Q-002，用户 2026-09-14 确认）：本目录的编译产物**就是**唯一真源，不存在"改源码后重新构建"。所有修改只能落在手写文件、编译产物、Electron 产物三类位置。约束见 `DECISIONS.md` **D-010**。

## 强制性约定

- 四档证据用语（已证实 / 合理推断 / 待确认 / 重构建议），见 `DECISIONS.md` D-003。
- 不提交 `resources/settings.json`、`resources/set.json`、`resources/app.asar`。
- 临时产物进 `tmp/`、`outputs/`。
- 本轮只读业务代码；不改、不删、不重打包。
