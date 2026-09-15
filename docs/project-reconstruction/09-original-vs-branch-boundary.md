# 本体 vs 分支：能力边界（定量）

> 批次 C-3 前置工作（2026-09-14）。证据 E-170 ~ E-178。
> **本文件回答一个问题：这半年到底"做"了什么，而不是"本来就有"什么。**

---

## 0. 方法与可信度

**基线选取**：git 根提交 `b7ad6eb Initialize lightweight patch repository`（2026-06-17，E-002）。
依据 `RENAME.md`（E-080）自述，该提交"将 Windows 打包产物纳入版本管理"——即**分支起点**。

**方法**：
```
git ls-tree -r --name-only b7ad6eb          # 基线清单
find <当前路径>                              # 盘上清单
comm -13 / comm -23                          # 差集
git diff --name-only b7ad6eb HEAD            # 被改过的基线文件
```

**两点必须声明的偏差**：
1. **基线 ≠ 纯净原版应用**。`b7ad6eb` 已含 2026-06-05 起的语音改造与 `VOICE_MODEL_MAPPING_REPORT.md`（E-017/E-117）。所以"基线有"的东西里，**语音部分可能已含少量分支前期成果**。
2. **盘上 ≠ git 已提交**。2026-08-31 之后的工作大量未跟踪（E-093/E-157），差集用的是**盘上文件**，覆盖到 2026-09-14。

→ 结论对"新增**路由**"高度可靠（路由名不会重名）；对"修改"只统计到**已提交**部分。

---

## 1. 硬数字

| 维度 | 基线 2026-06-17 | 当前盘上 2026-09-14 | 变化 |
|---|---|---|---|
| `resources/server/lib/` 文件数 | **1**（仅 `pdf-worker.mjs`） | **238** | **+237 文件，分支几乎从零建了整棵服务端源码树** |
| API 路由数 | **27** | **34** | **+7 新增，0 删除** |
| 被分支改动过的基线路由 | — | **22 / 27** | 81% 的原路由被就地打过补丁 |
| `resources/server/server.js` | 存在 | 存在 | 已提交改动 **+1038 / −141 行**（尚未含 9 月未提交部分） |
| 被提交改动的前端 chunk | — | 10 个（另加 9 月未跟踪改动） | |
| 基线纳入版本管理的文件总数 | 339 | — | 含 `win-unpacked/` 快照 |

---

## 2. 本体自带能力（基线 27 个路由）——**已证实**

`account/init`、`chat`、`companion/avatar`、`companion/reconcile-persona`、`concept-summary`、`conversations`、`custom-companions`(+`/avatar`、`/merge-persona`)、`diary`、`flashcard`、`forum`、`groupchat`、`jump-page`、`lesson-summary`、`pdf-assets`、`profile`(+`/avatar`、`/reset`)、`reading-context`、`search`、`stats`、`system`、`test-key`、`textbook`、`tts-audio`、`world`

**按用户能力归类**（本体）：
- 世界与角色扮演：`world`、`companion/*`、`custom-companions/*`
- 课堂：`chat`、`textbook`、`reading-context`、`jump-page`
- 社交陪伴：`groupchat`、`forum`
- 学习记录：`diary`、`flashcard`、`lesson-summary`、`concept-summary`
- 语音：`tts-audio`
- 账号：`account/init`、`profile/*`
- 其它：`conversations`、`search`、`stats`、`system`、`test-key`、`pdf-assets`

**重要结论（已证实）**：这套本体能力**与 L1 愿景高度吻合**（E-110：伙伴 + 苏格拉底、室友日常、九人实验室）。
"世界 / 角色 / 伙伴 / 群聊 / 论坛 / 日记"这一整套**不是本分支做的**，是原始团队的产品骨架。E-124 的 `description:"Socratic Roleplay Learning"` 与此一致。

---

## 3. 分支新增能力（7 个路由 + 237 个 lib 文件）——**已证实**

### 3.1 新增路由（全部为分支产物）

| 路由 | 对应 L2 主题 |
|---|---|
| `/api/adaptive-teaching` | 自适应教学闭环 |
| `/api/adaptive-concept-graph` | 概念图谱抽取 |
| `/api/adaptive-diagnosis` | 学情诊断 |
| `/api/practice` | 出题/解题/讲题 |
| `/api/knowledge-source` | 多知识源检索 |
| `/api/long-reasoning-demo` | 长推理实验 |
| `/api/math-speech` | 数学公式中文朗读 |

### 3.2 新增 `lib/` 子树（238 文件中 237 个为分支新增）

`adaptive/`(22) `close-reading/`(15) `companion-continuity/`(6) `knowledge/`(10) `markdown/`(2) `math-speech/`(26) `ocr/`(16) `practice/`(11) `progress/`(9) `reading/`(5) `reasoning/`(16) `resume/`(2) + 顶层约 20 个模块（`route-auth`、`local-request-auth`、`account-request-context`、`model-router`、`llm-gateway`、`responses-api-compat`、`kb-publisher`、`kb-builder*`、`pdf-ocr-coordinator`、`voice-catalog`、`voice-emotion-protocol`、`release-runtime-manifest` 等）。

### 3.3 被就地打补丁的 22 个本体路由（**改动耦合点**）

`account/init`、`chat`、`companion/avatar`、`companion/reconcile-persona`、`concept-summary`、`custom-companions/merge-persona`、`flashcard`、`groupchat`、`jump-page`、`lesson-summary`、`pdf-assets`、`profile`、`profile/reset`、`reading-context`、`test-key`、`textbook`、`tts-audio`、`world`（+ 新路由本身的迭代记录）

→ 含义：分支不是"另起一套"，而是**深度改写本体**。`chat`（课堂主链路）改动最重。

---

## 4. 顺带解开的一个谜

`AGENTS.md` 写"API route handlers（**28 routes**）"（E-010），实测盘上 34（E-045）——看似文档过时。

**更准确的解释**：**28 ≈ 基线原版的 27 个路由**。`AGENTS.md` 的这句话是从**原始团队**那里继承来的（或照着打包产物写的），此后从未随分支更新。

**推论（合理推断）**：`AGENTS.md` 主体可能**原本就是原始团队/上游的文档**，被分支直接沿用；它引用不存在的兄弟副本 `Socratopia_2.0` 也符合"上游环境与本地不同"的特征。→ Q-023。

---

## 5. 对后续工作的用处

| 用途 | 说明 |
|---|---|
| 阶段 C 建档分组 | 本体模块与分支模块**分开建档**，避免把本体功能记成成果；本体侧只写"分支改了它什么" |
| 优先级判断 | 修改 `chat` / `server.js` / `progress` 等**被深度改写的本体件**风险最高 |
| 重构范围界定 | "235/237 个 lib 文件是新增"意味着这些**可以按普通源码重构**；真正的难点在 22 个被改写的编译产物与 7 个新路由的注入方式 |
| 阶段 E 选项 | 重建工程时，本体骨架（27 路由 + 前端）需要复刻；分支侧 237 个文件相对容易迁移 |

---

## 6. 证据

E-170 `git ls-tree -r --name-only b7ad6eb` → 339 文件；`resources/server/lib/` 仅 `pdf-worker.mjs`
E-171 基线路由清单（27 个，见 §2）
E-172 差集：新增 7 路由、删除 0
E-173 `git diff --name-only b7ad6eb HEAD -- 'resources/server/.next/server/app/api'` → 22 个原路由被改
E-174 `git diff --numstat b7ad6eb HEAD -- resources/server/server.js` → +1038 / −141
E-175 `find resources/server/lib -type f` → 238
E-176 基线含 `main.js`、`preload.js`、`resources/server/server.js`（均为本体文件）
E-177 E-124（`description:"Socratic Roleplay Learning"`）与 §2 归类一致
E-178 E-010 的"28 routes"≈ 基线 27

## 7. 待确认
- Q-023：`AGENTS.md` 是否上游文档沿用？
- 基线已含的语音改造量（§0 偏差 1）——需对比 2026-06-05 报告与基线 `tts-audio` 产物。
