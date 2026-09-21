# Shared World Continuity — WORKSTATE

> 本文件是该功能开发的唯一持续注意力锚点。每个开发回合开始必须完整读取；每个可验证切片前后必须更新。它记录当前事实，不替代用户最新要求、`AGENTS.md` 或 `CLAUDE.md`。

## 快速恢复区

最后更新：2026-09-20。  
当前 checkpoint：`SWC-001-A`。  
当前阶段：阶段 A——内容契约与最小样本（cutoff 轴已落地，世界核心与角色模板未产出）。  
当前分支：`codex/push`。  
设计前备份：`codex/stage-backup-20260915-world-lore-plan`，提交 `b8d171de0ab207e422d37a7d2b7e7b2123a8bf15`。  
当前唯一目标：产出两世界核心 ×2、角色模板 ×8、知识卡 30–50 张／世界。  
唯一下一步：补抓 `07-pilot-roster.md` 第 3 节的 12 个页面并核验 3 页语音，然后写世界核心与模板。提瓦特的 `canonCutoff.value` 与 `versionFloor` 仍需使用者给出。

## 关键不变量

1. 世界知识必须经过账户、world、剧情截止点和说话角色权限过滤。
2. 只有已真实发生且成功持久化的事件才能更新世界状态、关系和记忆。
3. `story.md`／`npc_*.md`、世界知识库、动态状态和教材知识保持职责分离。

## 当前状态

- [x] `SWC-000-A` 创建设计前阶段备份。
  - 分支：`codex/stage-backup-20260915-world-lore-plan`
  - commit：`b8d171de0ab207e422d37a7d2b7e7b2123a8bf15`
  - tree：`14fd71881a7bf70d7bd7f3adde5cae95ba748607`
- [x] `SWC-000-B` 整理模板、世界知识库和动态状态的三层架构。
- [x] `SWC-000-C` 定义账户隔离、原著边界、知识权限、提示注入和事务约束。
- [x] `SWC-000-D` 将新增测试限制为四个行为测试，并定义阶段门。
- [x] `SWC-000-E` 建立开发模型持续读写协议。
- [~] `SWC-001` 阶段 A：内容契约和最小样本。
  - [x] `SWC-001-P` 前置：证据入库（`资料/`、`bundled-content/` 纳入追踪）、两世界 cut-off 表达梳理、版本比较原语。已提交，见 `8aa7d8e`／`1373e3e`。
  - [~] `SWC-001-A` 两世界 canon cutoff 与各四名试点角色选定。
    - [x] 翁法罗斯 cutoff = `3.7`；提瓦特 cutoff 轴 = 章·幕为主 + 版本下界；试点角色策略 = 证据优先（使用者 2026-09-20 下达）。
    - [x] `chapter-act` 轴已实现并测试，`canonCutoff` 契约改为带轴对象。
    - [x] 8 名试点角色名单与证据缺口：见 `07-pilot-roster.md`（翁法罗斯 白厄／阿格莱雅／那刻夏／万敌，提瓦特 钟离／纳西妲／芙宁娜／雷电将军）。
    - [ ] 提瓦特 `canonCutoff.value` 与 `versionFloor` 取值。
    - [ ] 6 名缺 A 级证据的角色待补抓（12 页），另有 3 页语音待核验。
  - [ ] `SWC-001-B` 世界核心 ×2、角色模板 ×8、知识卡 30–50 张／世界。
- [ ] `SWC-002` 阶段 B：本地世界知识检索。
- [ ] `SWC-003` 阶段 C：动态世界状态和事件提交。
- [ ] `SWC-004` 阶段 D：chat／groupchat 统一上下文。
- [ ] `SWC-005` 阶段 E：场景 NPC 和有限生活演化。

## 本回合执行契约

checkpoint ID：`SWC-001-A`。分两个切片，切片 1（提交 + chapter-act 轴）已完成，切片 2（角色选定）进行中。

目标：让阶段 A 的选型落成可执行契约——把使用者三项决定写入契约与实现，并确定 8 名试点角色。

范围：

1. 提交 `SWC-001-P` 批次；
2. 使用者决定的记录：cutoff 取值、cutoff 轴、角色选取策略；
3. `version-order.js` 增补 `chapter-act` 轴与 `axisOfValue` 路由，并扩测试；
4. `05`、`02` 同步契约（`canonCutoff` 由裸字符串改为带轴对象）；
5. WORKSTATE 从 `SWC-001-P` 推进到 `SWC-001-A`。

明确不做：不实现检索（`retriever.js`）；不挂 `global.__WORLD_LORE__`；不改 chat／groupchat 路由；不生成卡片正文；不新增外部依赖；不抓取新网页（切片 2 只标记缺口）。

本回合新增或修改文件：

- `resources/server/lib/world-lore/version-order.js`
- `resources/server/lib/world-lore/version-order-smoke-test.js`
- `docs/shared-world-continuity/02-data-and-prompt-contracts.md`
- `docs/shared-world-continuity/05-canon-cutoff-schemes.md`
- `docs/shared-world-continuity/07-pilot-roster.md`（新增）
- `docs/shared-world-continuity/README.md`（导航加一行）
- `docs/shared-world-continuity/WORKSTATE.md`

必须保持的三个关键不变量：（同下方"关键不变量"）。

最小验证：

```bash
node --check resources/server/lib/world-lore/version-order.js
node resources/server/lib/world-lore/version-order-smoke-test.js   # 期望 PASS (116 passed, 0 failed)
git status --porcelain -- docs resources/server/lib/world-lore
```

完成判据：命令退出码为 0；两轴各有多于一条真实取值用例；`canonCutoff` 新形状在 02 与 05 一致；证据写入下方日志。

## 已确认设计决定

| ID | 决定 | 原因 | 影响 |
|---|---|---|---|
| D001 | 使用模板＋独立世界知识库＋动态世界状态 | 任一单层都不能产生稳定且可演化的角色联动 | 三层分别存储并由统一 compiler 组合 |
| D002 | 首版保持四个固定伙伴槽位 | 当前 resolver 固定 `npc_a` 至 `npc_d`；直接扩槽会扩大上下文和迁移风险 | 大角色规模延后，用场景 NPC 解决 |
| D003 | 首版使用本地确定性检索 | 当前 local-kb 不搜索资料，外部 RAG 需要端点 | 先用标签、别名和关键词，无新增服务 |
| D004 | 角色知识权限在排名之前过滤 | 防止秘密、未来剧情和他人私密经历泄漏 | 检索输入必须绑定 speaker instance |
| D005 | 复用现有 continuity transaction | 已具备 world lock、原子写、恢复和账户检查 | 新状态不另建事务系统 |
| D006 | 只新增四个行为测试 | 减少重复测试，同时守住真实高风险边界 | 最终用一个四人场景做综合验收 |
| D007 | WORKSTATE 是唯一注意力锚点 | 防止多份进度文档互相漂移 | 每个切片强制读写并保留证据 |
| D008 | `资料/` 与 `resources/bundled-content/` 纳入 Git 追踪 | `资料/` 是阶段 A 完成定义的唯一依据却只存在于备份分支；`bundled-content/` 的 win-unpacked 副本早已被追踪，根路径反而是漏网的例外 | 派生的知识卡有可评审、可版本化的发布落点；风险从"误删即丢"降为常规 Git 历史 |
| D009 | 基础知识卡发布落点位 `resources/bundled-content/<lang>/world-lore/<canon>/` | 复用编译产物已有的 `getContentDir(name, language)` 语言级解析与 `en/` 回退，不新增解析路径 | 卡片包随应用分发；`资料/` 与 `docs/` 不进 release 树 |
| D010 | `.gitattributes` 对 `资料/来源原文/**`、`资料/可用文本/**` 关闭行尾转换 | `下载清单.json` 的 88 个 SHA-256 按 LF 字节计算，而本仓库 `core.autocrlf=true`，检出改写会让全部哈希失效 | 证据完整性可跨机器复核；这两棵树不得"顺手修"行尾 |
| D011 | ~~版本比较只实现 `game-version` 一条轴，其余轴显式抛错~~ → 见 D012 | 两世界的进度轴不同（翁法罗斯版本号／提瓦特章·幕），且文本里的 `\d+.\d+` 大量是目录编号 | 比较不会静默降级成字符串比较；`3.10 > 3.4` 被钉住 |
| D012 | 在 D011 基础上补 `genshin-chapter-act` 轴，提瓦特对外用章·幕、机器比较用版本下界 | 使用者 2026-09-20 选定；玩家记得的是剧情进度而非版本号 | 同 canon 内出现两条轴，跨轴不自动比较，由 `axisOfValue` 判定或调用方显式给轴名 |
| D013 | 间章第 K 幕编码为"第 K 章全部正幕之后"（幕=100） | `S017` 解锁链显示间章第一至三幕分别锚在第一、二、三章末幕之后；K=4 前置是间章第三幕，章 4 是唯一不与之同槽的取值 | 不需要为每幕维护放置表；K=4 是已标注的推断而非证据 |
| D014 | `canonCutoff` 由裸字符串改为 `{axis, value, versionFloor?}` | 裸字符串无法区分提瓦特的两条轴，也无法表达"对外章·幕＋版本下界" | `02`、`05` 的契约同步；提瓦特 `value`／`versionFloor` 待使用者给出 |

## 已知风险与未决项

- [!] 提瓦特的 `canonCutoff.value`（具体哪一幕）与 `versionFloor` 仍未给出；轴与形状已定（D012／D014）。章·幕与版本之间没有可从资料直接导出的映射函数，`versionFloor` 必须由使用者指定。
- [!] 每个世界的四名试点角色已选定（`07`），但其中 6 人只有 B 级证据、缺 `人物档案`／`人物语音` 页，模板的语气与性格基线因此在补抓前是薄的一层。
- [!] 下载资料是证据档案，自动提取文本仍含部分导航噪声，不能直接发布成知识卡。44 个来源中 33 条未核验，清单见 `06-unverified-sources.md`。
- [!] 背景角色采用临时场景 NPC 时，身份和记忆隔离的最终接口尚待阶段 E 设计。
- [!] `间章第K幕` 的章节锚在 K=4 处是推断而非直接证据（见 D013），提瓦特 cut-off 若落在此附近需复核。
- [ ] 是否允许玩家主动进入 AU 分支及其 UI 表达尚未决定；首版按显式标记处理。
- [x] ~~`资料/` 未受版本控制~~ → 已由 D008 处置。
- [x] ~~知识卡发布包没有落地位置~~ → 已由 D008／D009 处置。
- [x] ~~翁法罗斯与提瓦特的 canon cutoff 未选定~~ → 2026-09-20 使用者给出：翁法罗斯 `3.7`；提瓦特章·幕轴；取值待补。

## 偏移／新发现

- **上届索引把 `S044` 记成"魈的专属证据"，实测不成立。** `S044_护法仙众夜叉录` 里"魈"出现 **0 次**，它叙述的是夜叉群体；魈因此只有 C 级证据、未入选试点。这说明"某文件提到某角色"必须实测，不能按标题推断。已记入 `07` 第 2.3 节。
- **提瓦特的人物级证据只有两篇。** `S011_北陆图书馆` 与 `S012_提瓦特编年史` 是提瓦特唯一对角色有实质叙述的来源，其余 15 篇全属世界／历史／任务层。任何提瓦特角色模板在补抓档案前都只能依赖这两篇。已记入 `07` 第 2.2 节。
- **两个 BWIKI 的角色页路径约定相反。** 星铁是 `/<角色>/资料` 与 `/<角色>/语音`，原神是裸页 `<角色>` 与 `<角色>语音`。补抓清单不能互相照抄。已记入 `07` 第 3 节。
- **提瓦特的章·幕编码里有一处是推断。** `间章第K幕` 锚到第 K 章对 K=1、2、3 都有直接解锁前置佐证，K=4 的前置写的是"间章第三幕"而不是第四章末幕；代码取章 4，理由是它是唯一既不与间章第三幕同槽又排在其后的取值。已记入 D013 与 `05` 5.1。
- **测试期望串曾排错一次（非代码错）。** 首轮新增断言把 `间章第四幕` 写在 `第五章第六幕` 之后，而章 4 锚必然让它排在第五章之前；失败记录保留。已修正期望并加注说明 K=4 的推断来源。
- ~~**`docs/` 整个目录仍未跟踪。**~~ → 已由提交 `3018a62` 一并入库。
- **chat 与 groupchat 的上下文预算已经不对等。** `chat/route.js` 有 `[ctx-budget]`，但只 `console.error` 报警、不裁剪；`groupchat/route.js` 连核算和资源边界标记都没有。阶段 D 的"统一 compiler"因此不是把两份逻辑合一，而是先把 groupchat 从零补齐。已记入 `02`。
- **教材段的既有实际上限是 28000 字符**（`resource` 检查），远大于方案原表里所有新增段之和（13000）。若按原表字面实现预算，会误缩教材。已在 `02` 增补既有段表和"教材不享有预算豁免"的规则。
- **资料来源里 `\d+\.\d+` 大面积是目录编号而非版本号。** 例如提瓦特文本能扫出 `9.4`、`8.2`、`1.7`；翁法罗斯编年史目录自带一节 `3.4 第二次逐火之旅`。任何基于正则的版本抽取都必须附带来源与轴。已记入 `05`。
- `version-order.js` 目前**仍没有任何调用方**，尚未挂进 `server.js` 的 `global.*` 表。挂载点应与 compiler／retriever 一起做。
- **本批次按用途切分提交，不再由单个大提交承载。** `e7520d1` 曾把证据入库、方案文档与模块实现并成一个提交；已 `git reset --soft 18b360e` 后重切为四个提交：①证据入库 `8aa7d8e`（`资料/`＋`bundled-content/`＋`.gitattributes`＋`.gitignore`）、②方案文档集 `3018a62`（`docs/shared-world-continuity/`）、③`version-order` 两轴实现 `1373e3e`（`resources/server/lib/world-lore/`）、④tools 清理与 agent 文档同步 `e92b04f`。回溯时注意"方案"与"实现"分属不同提交，`e7520d1` 仅存在于 reflog。

## 验证证据日志

### 2026-09-15｜SWC-000

- 命令：使用临时 Git 索引重新构造排除 `docs/shared-world-continuity/` 后的方案前工作树；核对备份 branch、commit、tree、当前 branch／HEAD、禁止路径；随后以 Python 检查八个设计文件、相对链接、WORKSTATE 读写节奏、四测试限制和防范章节。
- 退出码：`0`。
- 结果：
  - 备份分支、提交和树均可解析；重新构造的方案前工作树与备份树 `14fd71881a7bf70d7bd7f3adde5cae95ba748607` 完全一致；
  - 当前仍为 `codex/push`，HEAD 仍为 `18b360e580f68a7bdcd676478c8af8d1c4b5db2b`；
  - 禁止路径未进入备份；
  - 八个方案文件存在且内部相对链接全部解析；
  - WORKSTATE 强制读写节奏、四个行为测试上限及关键防范约束均存在。
- 影响下一步：`SWC-000` 有证据完成；等待用户决定是否启动 `SWC-001`。

一次更早的验证报告命令在所有断言通过后，因最后尝试在 Python 中打印 shell 变量而触发 `NameError`、退出码为 `1`。该报告脚本错误未改变文件或备份；已删除错误打印并由上述退出码 `0` 的完整验证取代。失败记录保留以符合证据不可删除原则。

### 2026-09-18｜SWC-001-P

- 范围：用户本轮五项指令（`资料/` 入库、`bundled-content/` 解绑并入库、两世界 cutoff 体系梳理＋版本比较函数、教材预算统一管理、未核验清单）。
- 命令与退出码：

  | # | 命令 | 退出码 | 期望 |
  |---|---|---|---|
  | 1 | `node --check resources/server/lib/world-lore/version-order.js` | `0` | 0 |
  | 2 | `node --check resources/server/lib/world-lore/version-order-smoke-test.js` | `0` | 0 |
  | 3 | `node resources/server/lib/world-lore/version-order-smoke-test.js` | `0` | 0（60 passed / 0 failed） |
  | 4 | `git check-ignore -v resources/bundled-content/zh/initial_world/world_preset.md` | `1` | 1＝未被忽略 |
  | 5 | `git status --porcelain -- 资料` | `0` | 101 行 `A`，0 行 `??` |
  | 6 | `python3 tmp/check-staged-hashes.py` | `0` | `staged-blob ok 88 bad 0` |
  | 7 | `node tools/stage-clean-win-release-smoke-test.js` | `0` | PASS |
  | 8 | `python3 tmp/check-doc-links.py` | `0` | 10 份文档、0 断链 |

- 结果：
  - `资料/` 101 个文件全部进入索引，工作树无遗留未跟踪文件；`资料/来源原文/**` 与 `资料/可用文本/**` 的**暂存 blob 与 `下载清单.json` 中 88 个 SHA-256 逐一相符**，D010 的 `.gitattributes` 生效。
  - `resources/bundled-content/` 43 个文件（33 md + 10 png）进入索引，`check-ignore` 不再命中；`win-unpacked/` 下的同名副本状态不变。
  - `version-order-smoke-test.js` 覆盖：`3.10 > 3.4`（字符串比较会判反）、缺失分量补零、`v` 前缀、空值即无界、六类非数字轴抛 `VersionError`、canon 命名空间拒绝跨界比较、可见性边界、两世界真实版本线排序、`3.4` 目录编号巧合、200 次调用确定性。
  - `05-canon-cutoff-schemes.md` 记录两世界四条／三条进度轴及不可跨界的证据；`06-unverified-sources.md` 由 `下载清单.json` 派生，33 条未核验，再生命令已验证可复现 33 行。
  - `02-data-and-prompt-contracts.md` 增补既有段预算表（resource 28000／stableContent 12000／history 12000／live 2000／memory 2000／user 6000）与两条入口现状差异。
- 影响下一步：`SWC-001-P` 有证据完成。进入 `SWC-001-A` 需用户选定两世界 cutoff 与各四名试点角色；`version-order.js` 仍无调用方，挂载与检索留给 `SWC-002`。

### 2026-09-20｜SWC-001-A 切片 1（提交 + chapter-act 轴 + 契约同步）

- 范围：使用者三项决定落成契约与实现；`SWC-001-P` 批次入库。
- 前置核对（会话恢复时重跑 `SWC-001-P` 的最小验证，确认旧记录仍成立）：`node --check version-order.js` 退出码 `0`；`version-order-smoke-test.js` 退出码 `0`（当时 60 passed / 0 failed）；`git check-ignore` 退出码 `1`；`git status --porcelain -- 资料` 101 行 `A`、0 行 `??`。
- 提交：本切片与 `SWC-001-P` 的产出按用途切为四个提交，均已落地。
  - `8aa7d8e` Track 资料/ and bundled-content/, pin evidence line endings（146 文件）
  - `3018a62` Add the shared-world-continuity design set（10 文件，含本切片修改的 `02`／`05`／`WORKSTATE`）
  - `1373e3e` Add canon-scoped cut-off ordering for world-lore cards（`version-order.js` 至 355 行、smoke 240 行）
  - `e92b04f` Drop dead tool scripts and sync agent docs with tracked trees（7 文件）
  - 先前的单一大提交 `e7520d1` 已被 `git reset --soft 18b360e` 作废，只存在于 reflog。
- 本切片命令与退出码：

  | # | 命令 | 退出码 | 期望 |
  |---|---|---|---|
  | 1 | `node --check resources/server/lib/world-lore/version-order.js` | `0` | 0 |
  | 2 | `node --check resources/server/lib/world-lore/version-order-smoke-test.js` | `0` | 0 |
  | 3 | `node resources/server/lib/world-lore/version-order-smoke-test.js` | `0` | 0（116 passed / 0 failed） |
  | 4 | `git status --porcelain -- docs resources/server/lib/world-lore` | `0` | 提交后无输出 |
  | 5 | `git show HEAD~1:resources/server/lib/world-lore/version-order.js \| grep -c 'parseChapterAct\|genshin-chapter-act'` | `0` | `8`（证明 chapter-act 已进提交而非只在工作树） |

- 结果：
  - `chapter-act` 轴覆盖：`S017` 真实标题解析（`第六章·第九幕`、`第七章 第一幕死魂灵的夜曲`、`空月之歌·第九幕身土坏空`、`第六章 空月之歌`、`空月之歌·序奏归途`、`序章·第三幕…`、`第三章第五幕`）、中文数字过十、间章四条锚定断言、完整章·幕线排序、空值即无界、六类非法输入抛错、`axisOfValue` 路由、同 canon 跨轴不可比、显式轴名、章·幕轴上的可见性。
  - 首轮新增断言有 1 条失败：期望串把 `间章第四幕` 排在 `第五章第六幕` 之后。根因是测试写错而非实现错——章 4 锚必然让它排在第五章之前。失败记录保留，已修正期望并注明 K=4 的推断来源。
  - `canonCutoff` 契约由裸字符串改为 `{axis, value, versionFloor?}`，`02` 三处示例与 `05` 5.2 一致；翁法罗斯取值更新为 `3.7`。
- 影响下一步：`SWC-001-A` 切片 2 = 8 名试点角色名单与证据缺口；提瓦特 `value`／`versionFloor` 仍需使用者。

### 2026-09-21｜SWC-001-A 切片 2（试点角色名单与证据缺口）

- 范围：按"证据优先"选定两世界各 4 名试点角色，产出 `07-pilot-roster.md` 与待抓清单。
- 判据：`人物档案`／`人物语音` = A 级；在一篇世界文献／编年／设定里被实质叙述 = B 级；仅被列名 = C 级。A 级决定名单。
- 命令与退出码：

  | # | 命令 | 退出码 | 期望 |
  |---|---|---|---|
  | 1 | 逐角色逐文件 `grep -o <name> <file> \| wc -l`（翁法罗斯 11 名、提瓦特 18 名候选） | `0` | 见下结果 |
  | 2 | `grep -c 魈 资料/可用文本/原神/世界文献/S044_护法仙众夜叉录.md` | `0` | `0`（推翻"魈有专属证据"） |
  | 3 | `python3 tmp/check-doc-links.py` | `0` | 11 份文档、0 断链 |
  | 4 | `git status --porcelain -- docs` | `0` | 仅本切片新增／修改 |

- 结果：
  - 翁法罗斯 4 人全部有 A／B 级证据：白厄（A，4 篇）、阿格莱雅（A，3 篇）、那刻夏（B）、万敌（B，`S029` 11 处）。`遐蝶` 命中 44 但全为 C 级，落选。
  - 提瓦特 4 人：钟离（A，`S014` 58 处＋`S015` 29 处）、纳西妲（`S012` 11 处）、芙宁娜（`S012` 10 处）、雷电将军（`S011` 11 处）。四人在 `S013` 目录可确认存在。
  - 缺口：6 人缺档案／语音共 12 页待抓；`S005`／`S007`／`S015` 三页语音待核验。
  - `raiden_shogun` 记录为知识边界专项样本：`S011` 明确雷神之名由巴尔、巴尔泽布、人偶三者共用。
- 影响下一步：`SWC-001-B` 之前需先补抓 12 页，否则模板的性格与语气基线偏薄。提瓦特 `canonCutoff.value`／`versionFloor` 仍待使用者。

## 交接说明

`SWC-001-A` 进行中：截止点与轴已定，8 名试点角色未选全。新开发模型不要从阶段 B 或运行时路由开始。

先完整阅读本文件和 `DEVELOPER_MODEL_PROTOCOL.md`，再读 `05-canon-cutoff-schemes.md`（第 5 节是已定契约，第 6 节是仍未决）与 `06-unverified-sources.md`。

三处容易踩的坑：`资料/` 的行尾不可改；`version-order.js` 目前没有调用方；groupchat 的上下文预算要从零补。再加两条：提瓦特是同 canon 双轴，**跨轴不会自动比较**；`间章第K幕` 的 K=4 锚是推断。
