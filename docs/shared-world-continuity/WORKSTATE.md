# Shared World Continuity — WORKSTATE

> 本文件是该功能开发的唯一持续注意力锚点。每个开发回合开始必须完整读取；每个可验证切片前后必须更新。它记录当前事实，不替代用户最新要求、`AGENTS.md` 或 `CLAUDE.md`。

## 快速恢复区

最后更新：2026-09-30。  
当前 checkpoint：`SWC-004-D1`（检索已接进 chat；未在真机跑过）。  
当前阶段：阶段 D 前置已接入 chat；阶段 C（动态状态）与阶段 D 主体（统一 compiler、groupchat）都未开始。  
当前分支：`codex/push`。  
设计前备份：`codex/stage-backup-20260915-world-lore-plan`，提交 `b8d171de0ab207e422d37a7d2b7e7b2123a8bf15`。  
当前唯一目标：让接入在真机可验收——重启 app、建一个名为「翁法罗斯」或「提瓦特」的世界，与伙伴对话看 `[world-lore] injected` 日志与角色是否引用原著。  
唯一下一步：**重启 app 实测**（服务端改动需重启；`__WORLD_LORE__` 失败只影响 lore 段，不会弄坏 chat）。验收看：控制台出现 `[world-lore] injected canon=… cards=…`，且伙伴的回答里出现只有卡片才有的细节（如「永恒圣城」）。实测后决定进 `SWC-003`（阶段 C）还是先把 groupchat 也接上。  
待使用者回话：无阻塞。

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
- [x] `SWC-001` 阶段 A：内容契约和最小样本。**已关闭（2026-09-30 复核，两道审计全绿）。**
  - [x] `SWC-001-B0` 素材缺口收口（2026-09-27）：142 条剧情正文重核升级＋`06` 重生（253 来源／223 已核验）；翁法罗斯地点／组织／泰坦 33 条（S219–S251）；提瓦特历法 2 条（S252–S253）＋汇编 `索引/提瓦特历法与时间表达.md`；`08` V1–V7 回填（D015–D017）。证据见日志 2026-09-27 四条。
  - [x] `SWC-001-P` 前置：证据入库（`资料/`、`bundled-content/` 纳入追踪）、两世界 cut-off 表达梳理、版本比较原语。已提交，见 `8aa7d8e`／`1373e3e`。
  - [x] `SWC-001-A` 两世界 canon cutoff 与各四名试点角色选定。
    - [x] 翁法罗斯 cutoff = `3.7`；提瓦特 cutoff 轴 = 章·幕为主 + 版本下界；试点角色策略 = 证据优先（使用者 2026-09-20 下达）。
    - [x] `chapter-act` 轴已实现并测试，`canonCutoff` 契约改为带轴对象。
    - [x] 8 名试点角色名单与证据缺口：见 `07-pilot-roster.md`（翁法罗斯 白厄／阿格莱雅／那刻夏／万敌，提瓦特 钟离／纳西妲／芙宁娜／雷电将军）。
    - [x] 缺 A 级证据的 5 人已补抓 10 页 + 复核 3 页语音，8 人现全部具 A 级证据，`07` §3 缺口关闭。
    - [x] 提瓦特 `canonCutoff.value`=`第七章·第二幕`、`versionFloor`=`7.0`（2026-09-27 回填，D015）。
  - [x] `SWC-001-B` 世界核心 ×2、角色模板 ×8、知识卡 30–50 张／世界。
    - [x] 两世界核心 `story.md` ×2 与角色模板 `npc_*.md` ×8 初稿（2026-09-28，`B1`）。落点 `resources/bundled-content/zh/world-lore/<canon>/`。
    - [x] 知识卡 37／34 张 + `lore/manifest.json`（含 `pilotSlots`）+ `lore/aliases.json`（2026-09-29 `B2`；2026-09-30 补一对真实冲突卡）。
    - [x] 阶段 A 关闭复核（2026-09-30）：`tools/audit-lore-cards.py` 与 `tools/audit-lore-package.py` 全绿，完成定义①②达成（②为静态逼近，检索器属阶段 B）。
- [x] `SWC-002` 阶段 B：本地世界知识检索。`retriever.js` ＋ T1（50 断言）＋ `conflict-order.js` 已交付，阶段门达成。
- [ ] `SWC-003` 阶段 C：动态世界状态和事件提交。
- [~] `SWC-004` 阶段 D：chat／groupchat 统一上下文。**chat 已接入**（`SWC-004-D1`）；groupchat 复用同一模块与统一 compiler 未做。
- [ ] `SWC-005` 阶段 E：场景 NPC 和有限生活演化。

## 本回合执行契约（`SWC-001-B0`，已完成）

checkpoint ID：`SWC-001-B0`。日期：2026-09-27。

背景：另一会话（写模板的那一边）盘点后报告 4 项缺口：①`下载清单.json` 218 条中 142 条剧情任务正文标着「已从目录页发现链接，正文待核验」，但正文实测已落盘（中位 15 KB），核验口径失真，`06` 还写着"54 个来源 30 条未核验"；②翁法罗斯没有与提瓦特并列的地点／组织／泰坦（信仰）条目页；③提瓦特没有对应 `S020_翁法罗斯的历法` 的历法／时间来源；④`08` 的 V1（提瓦特冻结幕）、V5（两世界最新版本确认）、V6（`worldTime` 是否保留）未答。

唯一目标：把上述 4 项逐条关掉，使 `SWC-001-B` 写卡片时不再有资料侧阻塞。

分四个切片：切片 1＝逐条重核 142 条剧情任务正文（程序化实质检查＋抽读），升级核验状态并重生 `06`；切片 2＝经 MediaWiki API 定位翁法罗斯地点／组织／泰坦页，入 `精选来源.json` 并抓取核验；切片 3＝提瓦特历法：先探 BWIKI 是否有独立条目页，若无则从已下载证据汇编一页并注明出处；切片 4＝按证据回答 V1／V5／V6 并更新 `08`、`05` §6。

明确不做：不写 `story.md`／`npc_*.md`／知识卡（另一会话进行中）；不改运行时代码；不碰工作树里其它会话的未提交改动（`resources/`、`main.js` 等）；不改 `资料/` 既有文件的正文内容（仅核验行随工具重跑更新）；不为切片 2、3 之外的任何新页面扩充抓取。

预计修改的文件：

- `资料/索引/精选来源.json`（核验升级＋新增翁法罗斯条目）
- `资料/索引/下载清单.json`、`总索引.md`、`世界模板索引.md`、`人物模板索引.md`、`来源索引-BWIKI.md`（工具重建）
- `资料/可用文本/**`、`资料/来源原文/**`（切片 2 新增若干组；切片 1 的 142 个文件仅 frontmatter 核验行变化）
- `资料/索引/提瓦特历法与时间表达.md`（切片 3 若需汇编则新建）
- `docs/shared-world-continuity/06-unverified-sources.md`（`tmp/gen-unverified.py` 重生）
- `docs/shared-world-continuity/08-supplement-checklist.md`、`05-canon-cutoff-schemes.md`、`WORKSTATE.md`
- `tmp/` 下新增脚本

必须保持的三个关键不变量：

1. `资料/` 一切写出文件保持 LF；既有来源的正文内容不rewrite（核验行除外，与切片 3 既有先例一致）。
2. 核验升级必须基于真实读过的正文：全部 142 条过程序化实质检查，最小文件与抽样人工读；不合格者保持未核验。
3. `06` 始终可由 `下载清单.json` 派生重现；切片 2 新页面必须先经 API 确认存在再入清单。

最小验证：

```bash
python tmp/check-disk-hashes.py        # 期望 ok=全部 bad=0（重跑工具后清单哈希同步更新）
python 资料/工具/下载并整理.py          # 期望 exit 0，新页面 OK、其余走缓存
python tmp/check-doc-links.py          # 期望 0 断链
```

完成判据：142 条中实质合格者核验状态升为「已读取页面」且 `06` 重生成；翁法罗斯地点／组织／泰坦来源落盘并核验；提瓦特历法来源以 BWIKI 页或汇编页形式落地；V1／V5／V6 在 `08` 中标注取值、理由与证据；三条最小验证命令退出码为 0。

> 注：`资料/工具/下载并整理.py` 需要 `lxml`；本机 managed Python（`python`）已装 6.1.0，直接可用。

## 本回合执行契约（`SWC-001-B1`，已完成）

checkpoint ID：`SWC-001-B1`。日期：2026-09-28。

背景：`SWC-001-B0` 收口后，另一会话对补充结果做了独立复核（253 来源／506 哈希全对、142 条核验真实、frontmatter 与清单 253/253 一致），报出 4 项，其中 A／B 由使用者当场裁定：**保留版本轴**（D018）、**两轴冲突由版本轴裁决**（D019）。C（30 条未核验）由使用者另派助手处理。

唯一目标：写两世界核心 `story.md` ×2 与角色模板 `npc_*.md` ×8 初稿。

范围：

1. 落定 D018／D019 并同步 `05` §5.2／§6、`02` §2、`08`；（已完成）
2. 修 `version-order-smoke-test.js` 的 `死魂灵的夜曲` 幕次夹具（S134 实为第七章·**第二幕**）；（已完成）
3. 写 `resources/bundled-content/zh/world-lore/amphoreus/{story.md,npc_a..d.md}`；
4. 写 `resources/bundled-content/zh/world-lore/teyvat/{story.md,npc_a..d.md}`。

明确不做：不写知识卡；不改运行时代码（仅夹具）；不挂 `global.*`；不新增抓取；不改 `资料/`；不碰其它会话的未提交改动。

预计修改的文件：

- `resources/bundled-content/zh/world-lore/{amphoreus,teyvat}/{story.md,npc_a.md,npc_b.md,npc_c.md,npc_d.md}`（10 个新文件）
- `docs/shared-world-continuity/{05,02,08,WORKSTATE}.md`
- `resources/server/lib/world-lore/version-order-smoke-test.js`

必须保持的三个关键不变量：（同下方"关键不变量"，即三层职责分离、cutoff 与说话人过滤、只有已持久化事件更新状态）。

最小验证：

```bash
node --check resources/server/lib/world-lore/version-order-smoke-test.js
node resources/server/lib/world-lore/version-order-smoke-test.js      # 期望 PASS (117, 0)
python3 tmp/check-doc-links.py                                        # 期望 0 断链
# 每个模板文件内必须出现 S-id 或显式"推断"标注
grep -L 'S0[0-9][0-9]\|S1[0-9][0-9]\|S2[0-9][0-9]' resources/bundled-content/zh/world-lore/*/*.md
```

完成判据：10 个文件落盘；`story.md` 正文 ≤4000 字符、`npc_*.md` 正文 ≤1800 字符（`02` 的注入预算）；每个事实带出处或标推断；两世界内容不互相串用；四条验证命令通过并写入日志。

## 本回合执行契约（`SWC-001-B2`，已完成）

checkpoint ID：`SWC-001-B2`。日期：2026-09-29。

背景：`B1` 的 10 份模板已完成。本切片是阶段 A 的最后一项内容产出——知识卡。阶段门（`04` §4）只要求 **schema/data audit ＋ 来源完整性**，不要求 T1–T4 行为测试。

唯一目标：两世界各 30–50 张知识卡与 `lore/manifest.json`，并通过审计。

范围：

1. 卡契约补齐两个未命名处：提瓦特卡片的版本过滤字段命名为 `versionRange`（与 `timeRange` 对称）；`type` 值域固定为 `world/location/faction/history/person/relation/secret/culture/document`；
2. 写 `resources/bundled-content/zh/world-lore/<canon>/lore/{manifest.json,cards.jsonl,aliases.json}`；
3. 新增 `tools/audit-lore-cards.py`：JSONL 可解析、必填字段与值域、`cardId` 唯一且前缀=canon、来源可追溯到 `资料/索引/下载清单.json`（sourceId 存在、url 相符、来源 world 与 canon 相符）、`spoilerLevel ≤ cutoff`（**复用 `version-order.js` 做轴比较**）、类别覆盖下限。

明确不做：不写 `retriever.js`（T1 属阶段 B）；不挂 `global.*`；不改 chat／groupchat；不改 `go:template` 三个模板文件；不新增依赖。

预计修改的文件：

- `resources/bundled-content/zh/world-lore/{amphoreus,teyvat}/lore/{manifest.json,cards.jsonl,aliases.json}`（6 个新文件）
- `tools/audit-lore-cards.py`
- `docs/shared-world-continuity/{02,WORKSTATE}.md`

必须保持的三个关键不变量：同"关键不变量"，重点是**世界知识必须经过 cutoff 过滤**与**私密知识默认拒绝**，二者要在卡字段上可表达。

最小验证：

```bash
python3 tools/audit-lore-cards.py            # 期望 exit 0，fail=0
node --check resources/server/lib/world-lore/version-order.js
python3 tmp/check-doc-links.py
```

完成判据：两世界各 ≥30 卡；类别覆盖达下限（每世界 world≥1、location≥4、history≥2、relation≥2、secret≥2、culture≥1、faction≥1、person≥1）；审计 0 fail；每卡可追溯到 `资料/` 的真实来源 ID 与 URL。

## 本回合执行契约（`SWC-002-P`，已完成）

checkpoint ID：`SWC-002-P`（阶段 B 前置：冲突卡呈现策略）。日期：2026-09-30。

背景：`SWC-001` 关闭时留了一项明确未定——"冲突卡的呈现策略：数据与对称链接已就绪，何时两条都给、何时只给一条未定"。使用者裁定**先定策略再开 T1**，理由是策略会决定检索器输出的形状，倒过来做会返工。

使用者 2026-09-30 裁定：默认**主卡 + 一行「另说」附注**；主副用**机械顺序 + 当事人优先**（在机械顺序之上，若说话人恰是冲突一侧的当事角色则该侧为主）。

唯一目标：把该策略落成可执行的确定性规则并加测试，使 T1 直接调用而不是重新实现。

范围：

1. `resources/server/lib/world-lore/conflict-order.js`：来源层级判定、四级排序、`rankGroup`、固定「另说」格式；
2. 配 co-located smoke test，夹具用真实那一对冲突卡；
3. `tools/audit-lore-cards.py` 增检：冲突对必须同 `type`、必须可被 `conflict-order.js` 排出严格顺序（复用同一实现）；
4. `02` §6 增「冲突组的呈现」小节；`03` §2 增一条"冲突必须显式标注、不得合并"。

明确不做：不写 `retriever.js`（T1 下一切片）；不挂 `global.*`；不改路由；不改卡片内容（除非审计暴露数据缺陷）；不新增依赖。

预计修改的文件：

- `resources/server/lib/world-lore/{conflict-order.js,conflict-order-smoke-test.js}`（新增）
- `tools/audit-lore-cards.py`
- `docs/shared-world-continuity/{02,03,WORKSTATE}.md`

必须保持的三个关键不变量：三条同"关键不变量"；本切片重点是**冲突不得被静默合并**（既是数据要求，也是呈现要求）。

最小验证：

```bash
node --check resources/server/lib/world-lore/conflict-order.js
node resources/server/lib/world-lore/conflict-order-smoke-test.js       # 期望 PASS
python3 tools/audit-lore-cards.py                                      # 期望 PASS
python3 tools/audit-lore-package.py
python3 tmp/check-doc-links.py
```

完成判据：五条命令退出码 0；`conflict-order` 的当事人并列、层级并列、全并列三条回退路径各有断言；审计对现存唯一冲突对报出主副归属且顺序与输入顺序无关。

## 本回合执行契约（`SWC-002`，已完成）

checkpoint ID：`SWC-002`（阶段 B：本地确定性检索 / T1）。日期：2026-09-30。

背景：`02` §6 已给出检索契约（输入字段、过滤先于排名七步、私密不泄漏存在性），`04` §2 的 T1 给出验收清单。冲突排序与版本轴比较分别已有 `conflict-order.js`／`version-order.js`，检索器**复用**而不重写。

唯一目标：交付 `retriever.js` 与 `world-lore-smoke-test.js`，使 T1 七条全过。

范围：

1. 纯模块 `resources/server/lib/world-lore/retriever.js`：索引构建、过滤（作用域→cutoff→说话人权限→见证范围→类型/地点）、确定性评分排名、去重与字符预算、冲突副卡按已定策略附带；另给一个薄 `loadIndexFromDir`（手写 lib 可用 `require("fs")`）。
2. co-located `world-lore-smoke-test.js` 覆盖 T1 七条 ＋ 私密不泄漏存在性 ＋ 确定性。
3. 检索器不改路由、不挂 `global.*`。

明确不做：不写 `world-state`／compiler（阶段 C／D）；不改卡片内容；不引入向量库或外部服务；不碰 64092 或 `.next`。

预计修改的文件：

- `resources/server/lib/world-lore/{retriever.js,world-lore-smoke-test.js}`（新增）
- `docs/shared-world-continuity/{01,WORKSTATE}.md`（把 01 的实现顺序与 WORKSTATE 同步）

必须保持的三个关键不变量：三条同"关键不变量"；本切片重点是**过滤先于排名**与**修订后的知识权限**。

最小验证：

```bash
node --check resources/server/lib/world-lore/retriever.js
node resources/server/lib/world-lore/world-lore-smoke-test.js      # 期望 PASS
node resources/server/lib/world-lore/conflict-order-smoke-test.js
node resources/server/lib/world-lore/version-order-smoke-test.js
python3 tools/audit-lore-cards.py && python3 tools/audit-lore-package.py
```

完成判据：命令全绿；T1 七条各有断言；低相关确有返回空的用例；同一输入 200 次结果一致；被过滤的私密卡不出现在任何返回字段里。

## 本回合执行契约（`SWC-004-D1`，当前）

checkpoint ID：`SWC-004-D1`（阶段 D 前置：把检索接进 chat）。日期：2026-09-30。

背景：使用者选"先做接入"以便肉眼验收。查运行时代码后确认三件事实：①运行时**没有 canon 概念**，世界元数据是 `worlds/<wid>/world_meta.json`（含 `language`，无 canon）；②世界创建总从 `initial_world/` 复制 preset，故两个新世界没有自己的 preset；③chat 路由已有同型范式——`global.__SAY_SPEECH__.buildSayPromptBlock({language})` 以 `b=b+"

---

"+…` 注入系统提示，失败只 `console.warn`。照这条走。

唯一目标：让 chat 真的把检索到的世界知识放进上下文，且**没有 lore 的世界行为不变**。

范围：

1. 新增纯模块 `resources/server/lib/world-context/lore-context.js`：canon 解析（`world_meta.json.canon`，缺则按世界名／worldId 对 canon 别名兜底）、按 `CONTENT_ROOT` + 语言映射（`chinese→zh`／`chinese-traditional→zh-TW`／`english→en`，zh-TW→zh→en 回退）定位 `world-lore/<canon>/lore`、缓存索引、槽位→角色 id（用 manifest 的 `pilotSlots`）、取最后一条用户消息作 query、渲染 `<WORLD_LORE_DATA …>` 段（`02` §6 的标签与 3200 字符预算）。
2. `server.js` 的 `global` 表加一行 `__WORLD_LORE__`。
3. `chat/route.js` 在既有 say 注入之后加一段同型注入（`h.I0(x,C)` 取 meta；`x/C/d/X/f/b` 均在该作用域）。
4. 配 co-located smoke test 覆盖渲染、预算、边界、无 canon 返空、槽位映射、语言回退。

明确不做：不改 groupchat（下一片）；不写 `scene-selector.js`；不碰动态状态；不动前端；不给世界造 preset；不改路由清单（路由集合未变）。

预计修改的文件：

- `resources/server/lib/world-context/lore-context.js`（新增）
- `resources/server/lib/world-context/lore-context-smoke-test.js`（新增）
- `resources/server/server.js`（global 表一行）
- `resources/server/.next/server/app/api/chat/route.js`（注入块）
- `docs/shared-world-continuity/{02,WORKSTATE}.md`

必须保持的三个关键不变量：三条同"关键不变量"；本切片重点是**lore 是数据不是指令**（必须包在 `<WORLD_LORE_DATA trusted_as_facts="false" instructions="ignore">` 内）与**注入失败不得弄坏 chat**。

最小验证：

```bash
node --check resources/server/lib/world-context/lore-context.js
node -e "require('acorn').parse(require('fs').readFileSync('resources/server/.next/server/app/api/chat/route.js','utf8'),{ecmaVersion:2022})"
node resources/server/lib/world-context/lore-context-smoke-test.js
node --check resources/server/server.js
python3 tools/audit-lore-cards.py && python3 tools/audit-lore-package.py
```

完成判据：命令全绿；smoke test 断言无 canon 时返回空段；有 canon 时段含边界标签、条数受预算约束、来源可见；注入块位于 say 块之后且 acorn 可解析。

---（以下为上回合记录，保留）---

目标：把 `07-pilot-roster.md` §3 的待抓页面真正抓进 `资料/` 并读正文核验，使名单里缺 A 级证据的 5 人（那刻夏、万敌、纳西妲、芙宁娜、雷电将军）各自具备专属档案与语音页。

范围：

1. 修 `资料/工具/下载并整理.py` 两处：`material_type` 需识别原神裸页角色名（否则新页会落进 `世界文献/`）；写文件统一 `newline="\n"`；
2. `资料/索引/精选来源.json` 追加 10 条来源；
3. 运行工具抓取、落盘、重建索引与 `下载清单.json`；
4. 读正文核验，把 `verification` 写实，再生成 `06-unverified-sources.md`；
5. 复核 `S005`／`S007`／`S015` 三页语音（写卡片前必须复核，状态早于本回合）；
6. 更正 `07` §3 与 WORKSTATE 里的两处计数错误（见下方新发现），更新 `07` 缺口状态。

明确不做：不写角色模板正文与知识卡（属 `SWC-001-B`）；不改运行时代码；不挂 `global.__WORLD_LORE__`；不碰 `resources/server/` 下其它会话的未提交改动；只抓 `07` §3 列出的页面。

本回合新增或修改文件：

- `资料/工具/下载并整理.py`
- `资料/索引/精选来源.json`
- `资料/可用文本/**`、`资料/来源原文/**`（新增 10 组）
- `资料/索引/下载清单.json`、`总索引.md`、`人物模板索引.md`、`来源索引-BWIKI.md`（工具重建）
- `docs/shared-world-continuity/06-unverified-sources.md`
- `docs/shared-world-continuity/07-pilot-roster.md`
- `docs/shared-world-continuity/WORKSTATE.md`

必须保持的三个关键不变量：（同下方"关键不变量"）。本切片另加一条硬约束：**`资料/` 既有的 88 个 SHA-256 必须保持有效**——重跑工具不得改写已存在的 `可用文本/` 与 `来源原文/` 文件。

最小验证：

```bash
python 资料/工具/下载并整理.py                                   # 期望 exit 0，10 条新增 OK
git status --porcelain -- 资料/可用文本 资料/来源原文              # 期望只有 10 组新增，既有文件 0 个 ' M'
python tmp/check-disk-hashes.py                                  # 期望 ok=98 bad=0
```

完成判据：三条命令退出码为 0；新增 10 条 `downloaded:true` 且正文非导航噪声；`06` 与 `07` 状态同步；证据写入下方日志。

> 注：`资料/工具/下载并整理.py` 用 `lxml`，本机只有 conda 解释器装了它，用 `python`（非 `python3`）运行。

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
| D015 | 提瓦特 `canonCutoff.value`=`第七章·第二幕`、`versionFloor`=`7.0` | 资料覆盖到的最新一幕（`S133`/`S134` 已核验，所属版本 7.0）；7.1「往冥府的安魂歌」2026-09-23 才发布、资料未覆盖 | 2026-09-27 按证据回填，使用者可推翻；卡片过滤解锁 |
| D016 | cutoff 取"资料覆盖的最新"，不取字面"已发布最新" | 翁法罗斯 3.7 是翁法罗斯篇终章（故事边界），星铁实际已发布约 4.5；提瓦特 7.1 已发布但未入档 | 两世界 cutoff 口径统一；补抓新版本正文后才前移 cutoff |
| D017 | `worldTime` 保留为展示注释字段，不进过滤与比较 | `05` §4.4 建议落地；翁法罗斯有光历绝对纪年、提瓦特只有相对纪元，格式不可统一但各自有证据 | 卡片契约可加 `worldTime`；规范见 `资料/索引/提瓦特历法与时间表达.md` |
| D018 | 保留版本轴：提瓦特 `versionFloor` 必填，卡片过滤走版本轴，章·幕只作对外表达 | 使用者 2026-09-28 追认——2026-09-25 曾判"V3 不必要"，因对照表已被另一会话实测整理好而撤回 | 撤回 `05` §5.2 早先"版本关系导不出"的自述；`versionFloor` 成为必填字段 |
| D019 | 两轴冲突时版本轴裁决，不改 `D013` 锚、不手改卡片 | 使用者 2026-09-28：「都选版本轴了」——过滤既然走版本轴，章·幕轴的 K=4 推断错序不再需要人工校正 | `D013` 仅在纯章·幕比较时生效；`间章第四幕`（5.6）冲突由版本轴兜住 |

## 已知风险与未决项

- [x] ~~提瓦特的 `canonCutoff.value` 与 `versionFloor` 未给出~~ → 2026-09-27 回填：D015／D016，`08` V1–V3 已答（含实测幕→版本对照表）。
- [x] ~~两世界缺地点／组织／信仰页~~ → 2026-09-27 关闭：提瓦特前轮已补；翁法罗斯侧星铁 BWIKI 无条目页（探测证据），以 `S219` 互动文本聚合页＋逐城阅读物 `S220`–`S232`、组织 `S233`–`S238`、泰坦 `S239`–`S251` 补齐，归 `世界文献`。
- [x] ~~翁法罗斯的储备书目索引没有「体裁」列~~ → 2026-09-29 由另一会话补列、本会话复核并补「依据」列（`08` 第二部分 C 关闭）。规则沿用 2026-09-25 决定：体裁不作卡片分级依据。
- [!] 体裁列的两侧性质不同：提瓦特是 wiki 原字段，翁法罗斯是整理方判定。`reliability`／`claimType` 不要拿它当同等可信度依据；写卡引用 `依据=题名` 的 89 条需先读正文。
- [!] 下载资料是证据档案，自动提取文本仍含部分导航噪声，不能直接发布成知识卡。253 个来源中 4 条未核验（`S009`/`S019` NPC 图鉴、`S016` 传说任务入口、`S018` 世界任务——均为目录/入口页，无"正文"可读，阶段 E 再处理），清单见 `06-unverified-sources.md`。
- [!] 语音页有已知提取噪声：每条语音按「标题 + 中/日/英/韩四语正文」展开，随后同名标题会随语言切换标签重复一次；`S053` 的「官方贺图」段混入其他角色贺词。写语气基线时以原始 HTML 为准，不要统计标题重复数。
- [!] 背景角色采用临时场景 NPC 时，身份和记忆隔离的最终接口尚待阶段 E 设计。
- [x] ~~`间章第K幕` 的章节锚在 K=4 处是推断而非直接证据~~ → 由 D019 处置：冲突以版本轴裁决，`D013` 锚不再需要人工校正。
- [!] 提瓦特的秘密卡**没有用 `deny`**（amphoreus 用了 5 张）。teyvat 的五张 secret 卡只靠 `allow` 表达"谁知道"，没有"谁被逐出"。机制上够用（私密默认拒绝），但两世界口径不一致，阶段 B 写检索前应统一或明确接受差异。
- [!] 空月之歌各幕的版本名是「月之N」，版本轴解析不了。teyvat 落在该区间的卡片 `versionRange` 统一取 `5.8`（V3 表里该区间唯一的数字版本）作为上界——它是**保守下界**而非真实版本，故该区间内的版本轴排序会失真；章·幕轴不受影响。见 `05` §6。
- [!] 部分卡片的 `locator` 是「网页正文（自动提取）」这类泛值，复核时定位不到具体段落；其余多数已写到章节／卷名级别。
- [!] `D013` 的 K=4 锚仍是推断（实测版本 5.6 显示真实位置在第五章后段），仅在**纯章·幕比较**且无版本字段时才暴露错序。
- [ ] 是否允许玩家主动进入 AU 分支及其 UI 表达尚未决定；首版按显式标记处理。
- [x] ~~`资料/` 未受版本控制~~ → 已由 D008 处置。
- [x] ~~知识卡发布包没有落地位置~~ → 已由 D008／D009 处置。
- [x] ~~翁法罗斯与提瓦特的 canon cutoff 未选定~~ → 2026-09-20 使用者给出：翁法罗斯 `3.7`；提瓦特章·幕轴；取值待补。
- [x] ~~8 名试点角色有 6 人缺 A 级证据~~ → 2026-09-21 补抓 10 页 + 复核 3 页，8 人全部 A 级；计数原为 5 人，见下方更正。

## 偏移／新发现

- **BWIKI 任务页自带「所属版本」字段，幕→版本映射可直接导出。** 前轮结论"章·幕与版本之间没有可从资料导出的映射"只对目录页 `S017` 成立；2026-09-27 从 67 个提瓦特任务正文页的该字段实测生成完整对照表（`08` V3）。原神早期任务页「任务描述」字段留空是常态，不能当核验判据。
- **「死魂灵的夜曲」实为第七章·第二幕，不是第一幕。** `S134` 页幕次行实测为「第七章 第二幕」（第一幕是 `S133` 无神怜爱的雪国）。`version-order-smoke-test.js` 里的夹具串 `第七章 第一幕死魂灵的夜曲` 幕次写错；解析器丢弃幕名后缀，行为不受影响，但夹具名建议下次改动时顺手更正。
- **「月之 N」版本名 `genshin-version` 轴解析不了。** 空月之歌各幕的所属版本是「月之一」至「月之七」（非 `\d+\.\d+`）；这些卡片的版本下界要么扩展解析器、要么只走章·幕轴。已记入 `05` §6 与 `08` V3 注意 1。
- **间章第四幕「悖理」实测版本 5.6，与 D013 的 K=4→章 4 锚定冲突。** 5.6 晚于第五章·第五幕（5.3）、早于第六幕（5.7），真实剧情位置在第五章后段而非第四章之后。cutoff 在第七章不受影响；落在 5.3–5.7 区间的卡片 `timeRange` 需人工校正。已记入 `05` §6 与 `08` V3 注意 2。
- **两世界"已发布最高版本"均高于资料覆盖（V5 实测）。** 提瓦特 7.1「往冥府的安魂歌」2026-09-23 发布（资料至 7.0）；星铁约 4.5、剧情已进入二相乐园篇（资料至 3.7）。因此 D016 把 cutoff 口径定为"资料覆盖的最新"。
- **两个会话并发提交会吞掉在途改动。** 本回合对 `02` 的修正（撤回"待使用者选定"、补"版本轴裁决"）被另一会话的 `4c9e512` 顺带提交，`02` 因此不再出现在本回合的 `git status` 里。内容无丢失，但核对"我这个回合改了什么"时不能只看工作树——要用 `git log -p -- <file>` 追。`05`／`WORKSTATE` 的改动叠加在 `4c9e512` 之上，属本回合。
- **BWIKI 会对高频抓取限流（HTTP 567）。** 每分钟约放行 4–5 个请求；`tmp/slow-fetch.py`（15 s 间隔＋45/90/135 s 退避）可稳定绕过，`资料/工具/下载并整理.py` 的 4 线程默认会触发。大批量补抓时用慢速脚本先落 raw，再跑工具提取。
- **星铁 BWIKI 没有地点／组织／泰坦条目页。** 直探 20 个标题全 MISSING；这些层的事实只能由游戏内阅读物与 `互动文本/翁法罗斯` 聚合页承担（切片 2 处置）。

- **抓取工具会把整个归档改写成 CRLF，一次重跑就废掉全部哈希。** `资料/工具/下载并整理.py` 里 6 处 `Path.write_text(...)` 都没传 `newline`，默认跟随 `os.linesep`（Windows = `\r\n`），而磁盘上 54 个来源的 108 个文件全是 LF、且 `下载清单.json` 的 SHA-256 按 LF 计算。已给 6 处全部加 `newline="\n"`。修前重跑会改写 54 个已记录哈希的文件；修后重跑实测既有文件 0 改动。已写进工具内注释。
- **原神裸页角色名会被归错目录。** `material_type()` 原本只有 `title == "钟离"` 这一个人名特判，纳西妲／芙宁娜／雷电将军的裸页会落到兜底的 `世界文献/`。已改为 `BARE_CHARACTER_PAGES` 集合并注明两站路径约定相反。
- **`07` 的两处计数错误已更正。** ①"8 人有 6 人缺 A 级证据"实为 5 人（白厄／阿格莱雅／钟离本就有专属页）；② WORKSTATE 原写"12 个页面"，`07` §3 表实列 10 页（5 人 × 档案+语音）。两处都不是判断错误，是计数笔误。
- **`07` 对纳西妲的定性有误并已改。** 原文写"非神明（纳西妲）"，但 `S049` 字段显示其本名布耶尔、种族「草木化身（世界树最纯净的一枝）」且持有草元素神之心——她是草神。已改为按"与神性/身份的关系"描述四人差异。
- **五名新取证角色全都有"公开名 ≠ 本名"的裂口**（那刻夏/阿那克萨戈拉斯、万敌/迈德漠斯、纳西妲/布耶尔、芙宁娜·德·枫丹、雷电将军/巴尔·巴尔泽布），四个星铁试点之间还有现成的方向互异单方评价（`S005`／`S007`／`S046` 里的「关于X」）。这是 `D004` 知识边界现成的样本层，写模板时必须分列公开称谓与真实身份。
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

### 2026-09-27｜SWC-001-B0 切片 1（142 条剧情任务正文重核 + 06 重生）

- 范围：截图缺口 ①——核验口径失真。`下载清单.json` 218 条中 142 条剧情任务正文（提瓦特 67／翁法罗斯 75）标「已从目录页发现链接，正文待核验」，但正文已落盘。
- 命令与退出码：

  | # | 命令 | 退出码 | 期望 |
  |---|---|---|---|
  | 1 | `python tmp/verify-story-texts.py`（体量／CJK／噪声分布） | `0` | 中位 14.3 KB、最小 2.2 KB |
  | 2 | `python tmp/verify-story-struct.py`（结构核验：所属版本＋任务流程／对话＋元数据） | `0` | 142/142 具备版本字段与流程或成段正文 |
  | 3 | 人工抽读 `S073`／`S099`／`S116`／`S119`／`S189`／`S205` | — | 均为真实任务页（元数据＋流程／对话），无导航噪声页 |
  | 4 | `python tmp/upgrade-story-verification.py` | `0` | `upgraded: 142` |
  | 5 | `python 资料/工具/下载并整理.py`（全缓存） | `0` | `Archived 218 sources` |
  | 6 | `python tmp/check-disk-hashes.py` | `0` | `entries=218 ok=436 bad=0` |
  | 7 | `python tmp/gen-unverified.py` | `0` | `unverified: 30 verified: 188` |

- 结果：
  - 142 条全部升级「已读取页面」，frontmatter 核验行由工具重跑同步；`06-unverified-sources.md` 重生成，口径由"54 个来源 30 条未核验"更正为"218 个来源 30 条未核验、188 条已核验"。剩余 30 条（`S006`/`S009`/`S016`/`S018`/`S019`/`S020`–`S044`）确为目录级或未读，保持未核验。
  - 提瓦 act 页 49 个在首轮脚本因「任务描述」为空被误标 fail——BWIKI 原神早期任务页该字段本就留空；改以「所属版本＋任务流程≥3 步或 CJK≥1500」判定后全部通过。
  - 副产品：从 142 页「所属版本」字段提取出完整幕→版本映射（见切片 4，直接支撑 V1／V3）。
### 2026-09-27｜SWC-001-B0 切片 2（翁法罗斯地点／组织／泰坦来源补齐）

- 范围：截图缺口 ②——翁法罗斯没有与提瓦特并列的地点／组织／泰坦（信仰）条目页。
- 关键事实（探测证据）：星铁 BWIKI **主命名空间没有**这些条目页——`tmp/probe-amphoreus-pages.py` 直探 奥赫玛／悬锋城／雅努萨波利斯／神悟树庭／斯缇科西亚／晨昏之眼／哀丽秘榭／黄金裔／元老院／七贤／公民大会／泰坦／刻法勒 等 20 个标题全部 MISSING，搜索仅命中 `Data:SrMap` 地图数据与阅读物。地点层事实在星铁侧只能由**游戏内阅读物与互动文本聚合页**承担。
- 处置：从 `储备书目/翁法罗斯阅读物索引.json` 选 33 条（S219–S251）入 `精选来源.json`：
  - 地点层 14 条：`S219` 互动文本／翁法罗斯（214 KB 聚合页，含「永恒圣城」奥赫玛／「纷争荒墟」悬锋城／「浴血战端」悬锋城／「命运重渊」雅努萨波利斯／「呓语密林」神悟树庭／「神谕圣地」雅努萨波利斯分节）＋逐城阅读物（奥赫玛 2、悬锋 2、雅努萨波利斯 2、神悟树庭 2、斯缇科西亚 2、晨昏之眼 2、哀丽秘榭 1）；
  - 组织层 6 条：公民大会谈话记录、清洗者 ×2、树庭三学派（曳石／绳结／赤陶）；
  - 泰坦体系 13 条：「神性的回响」12 卷（每卷一位泰坦的颂诗，如岁月＝欧洛尼斯）＋阿提卡斯的刻法勒谕言集。
  - 类别归属决定：这些页面是**游戏内文献**而非社区汇总条目，因此不入 `地点条目／组织条目／信仰神系` 目录（那会误标 `source_nature`），统一归 `世界文献`，用途写在 `note`。
- 限流处置：BWIKI 对高频请求返回 HTTP 567；改为 `tmp/slow-fetch.py` 逐条退避抓取（请求间隔 15 s、567 退避 45/90/135 s），分 7 批完成，无失败遗留。
- 命令与退出码：

  | # | 命令 | 退出码 | 期望 |
  |---|---|---|---|
  | 1 | `python tmp/probe-amphoreus-pages.py` / `probe-amphoreus-pages2.py` | `0` | 条目页全 MISSING（决定改走阅读物） |
  | 2 | `python tmp/append-amphoreus-sources.py` | `0` | `added: 33, total: 251` |
  | 3 | `python 资料/工具/下载并整理.py` + `tmp/slow-fetch.py` 分批 | `0` | 33 条全部落盘 |
  | 4 | `python tmp/verify-amphoreus-new.py`（归属关键词＋体量） | `0` | 33 条归属全中；12 卷神性的回响为单卷短颂诗（~240 字），抽读 S239 确认完整 |
  | 5 | 人工抽读 `S219`／`S230`／`S239` | — | 区域分节／获取方式／颂诗正文均为真实内容 |
  | 6 | 升级 33 条核验 + 重跑工具 + `check-disk-hashes.py` + `gen-unverified.py` | `0` | `entries=251 ok=502 bad=0`；`unverified: 30 verified: 221` |

### 2026-09-27｜SWC-001-B0 切片 3（提瓦特历法／时间来源）

- 范围：截图缺口 ③——提瓦特缺对应 `S020_翁法罗斯的历法` 的历法／时间来源。
- 探测证据：`tmp/probe-teyvat-calendar.py` 直探 `历法／提瓦特历法／纪年／月份／时间／季节` 全部 MISSING；搜索命中三个可用页：`提瓦特编年史（公元纪）`、`日月前事`、`提瓦特时间管理`。
- 处置：
  - 新增 `S252` 提瓦特编年史（公元纪）（历史编年，核心）：以鸽子衔枝之年为公元 1 年的绝对纪年重排，是纪年表达的直接证据；
  - 新增 `S253` 日月前事（世界文献，补充）：道具卡仅 192 字，书籍全文在 `S035` 白夜国馆藏#日月前事，note 已注明；
  - `S254` 提瓦特时间管理抓取后判定为服务器刷新工具页、与 lore 时间表达无关，**已移除出清单并删除文件**（不进归档）。
  - 新建汇编 `资料/索引/提瓦特历法与时间表达.md`：纪年层（S012 相对纪元／S252 公元纪／S061 北境历法 7 年 1 纪／S035 日月纪年与海祇纪年）＋岁时层（链到节庆岁时表）＋昼夜层（无来源）＋两世界对照与写作规则；可信度分档沿用岁时表三档。
- 命令与退出码：`probe-teyvat-calendar.py` `0`；追加 3 条后 `slow-fetch.py 0 3` 全 OK；移除 S254 后重跑工具 `Archived 253 sources`；`check-disk-hashes.py` → `entries=253 ok=506 bad=0`；`gen-unverified.py` → `unverified: 30 verified: 223`。
### 2026-09-27｜SWC-001-B0 切片 4（V1–V7 回填 + 08／05 更新）

- 范围：截图缺口 ④（V1／V5／V6），连带 V2／V3／V4／V7 一并按证据关闭。
- 关键命令与退出码：

  | # | 命令 | 退出码 | 期望 |
  |---|---|---|---|
  | 1 | `python tmp/extract-act-version-map.py`（67 页幕次＋所属版本） | `0` | 全表见 `08` V3 |
  | 2 | 读 `S130`–`S134` 幕次行 | — | S130=空月之歌第九幕、S131=第十幕、S133=第七章第一幕、S134=第七章第二幕 |
  | 3 | Web 查证两世界已发布版本 | — | 原神 7.0（8-12）／7.1「往冥府的安魂歌」（9-23，官网更新说明）；星铁 3.7（2025-11-05，终章）→ 4.x 二相乐园篇（2026 路线图） |

- 结果：V1=`第七章·第二幕`、V2=`7.0`、V3=实测全表、V4=不需要幕轴（版本与幕 1:1）、V5=已发布更高但 cutoff 取"资料覆盖的最新"（D016）、V6=保留 `worldTime` 为展示注释字段（D017）、V7=数字巧合已确认。`08` 第一部分改为已答表，`05` §6 同步，新增 D015–D017。
- 影响下一步：`SWC-001-B0` 四切片全部完成。写知识卡前的资料侧阻塞清零（剩 30 条目录级未核验来源与体裁列确认，均不阻塞）。
- 入库（2026-09-27，使用者指示）：`814c9c0` 资料证据（253 来源，402 新增＋8 修改，暂存 blob 506/506 哈希通过）、`e83bd5b` 文档决策（06/08/05/WORKSTATE）。`tmp/` 脚本按仓库惯例不入库；`docs/project-reconstruction/` 未跟踪内容非本回合范围，未动。

### 2026-09-28｜SWC-001-B0 切片 5（剩余世界文献核验升级——建议 C）

- 范围：另一会话建议 C——剩余 30 条未核验中的 25 篇世界文献（`S020`–`S034`、`S035`–`S044`）正文早已落盘，标签滞后，写卡片前该升级。`S006` 阿格莱雅／资料同属滞后标签，一并核验。
- 命令与退出码：

  | # | 命令 | 退出码 | 期望 |
  |---|---|---|---|
  | 1 | `python tmp/verify-world-docs.py`（体量＋主题词命中） | `0` | 26 页正文 424–7872 CJK，关键词全中 |
  | 2 | 人工抽读 `S020`／`S023`／`S044`／`S006` | — | 均为完整书卷／档案正文（历法两卷含月份篇·生活篇；通鉴述歌耳戈建城；夜叉录含体裁=人物传记；阿格莱雅资料 672 行全结构） |
  | 3 | 升级 26 条 + 重跑工具 | `0` | `Archived 253 sources` |
  | 4 | `python tmp/check-disk-hashes.py` | `0` | `entries=253 ok=506 bad=0` |
  | 5 | `python tmp/gen-unverified.py` | `0` | `unverified: 4 verified: 249` |

- 结果：未核验从 30 降到 4，剩 `S009`／`S016`／`S018`／`S019` 四个目录/入口页（无"正文"可读，阶段 E 处理 NPC／支线条目时再升级）。附带发现：提瓦特书籍页自带「体裁」字段（如 `S044`=人物传记），可作为 `08` 第二部分 C 体裁规则的现成数据面。
- 影响下一步：`06` 对写卡片完全清障；体裁列确认仍开放。
- 入库（2026-09-28）：`e0f45e2` 资料核验升级（32 文件，暂存 blob 506/506 哈希通过）、`4c9e512` 文档决策（06/05/WORKSTATE，含并行会话在 `02` 的一行 canonCutoff 契约更新——版本轴裁决冲突，取值即 D015/D016）。

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

### 2026-09-21｜SWC-001-A 切片 3（补抓 A 级证据 + 复核语音页）

- 范围：`07` §3 的 10 个待抓页面 + 3 页待核验语音；修抓取工具两处缺陷。
- 命令与退出码：

  | # | 命令 | 退出码 | 期望 |
  |---|---|---|---|
  | 1 | `python -m py_compile 资料/工具/下载并整理.py` | `0` | 0 |
  | 2 | `python tmp/check-disk-hashes.py`（改工具前，44 条） | `0` | `ok=88 bad=0` |
  | 3 | `python 资料/工具/下载并整理.py` | `0` | 0，54 条全 OK |
  | 4 | `python tmp/check-disk-hashes.py`（抓取后） | `0` | `entries=54 ok=108 bad=0` |
  | 5 | `git status --porcelain -- 资料/可用文本 资料/来源原文 \| grep -c '^ M'` | `0` | `0`（既有文件零改动，证明 `newline` 修复生效） |
  | 6 | `python tmp/set-verification.py` + 重跑工具 | `0` | 13 条升级，重跑后既有文件仅 3 个 ` M`（每处 2 行） |
  | 7 | `python tmp/check-disk-hashes.py`（最终） | `0` | `ok=108 bad=0` |

- 结果：
  - 新增 `S045`–`S054` 共 10 页（20 个文件），落位正确：星铁 `/资料`→`人物档案/`、`/语音`→`人物语音/`，原神裸页→`人物档案/`、`<角色>语音`→`人物语音/`。
  - 10 页正文均为实质内容（179 KB–631 KB 原始 HTML；那刻夏档案含官方问答、万敌档案含 91 处本人名与悬锋史、雷电将军档案含「巴尔明面上是初代魔神…目前是第二代雷神」）。
  - `S005`／`S007`／`S015` 复核：各 25／25／72 条语音标题，且互相出现「关于白厄」「关于万敌」「关于阿格莱雅」。
  - 修缺陷 ①：6 处 `write_text` 未传 `newline`，Windows 下会把 54 个来源全部改写成 CRLF、一次重跑废掉 108 个哈希。修后重跑既有文件零改动。
  - 修缺陷 ②：`material_type()` 只特判 `钟离`，原神裸页会落进 `世界文献/`。改为 `BARE_CHARACTER_PAGES`。
  - `06` 由 33 条未核验降为 30 条（54 个来源中 24 条已核验）。
- 影响下一步：`SWC-001-A` 关闭，进入 `SWC-001-B` 写世界核心与 8 份角色模板；素材已齐。提瓦特 `canonCutoff.value`／`versionFloor` 仍待使用者，只阻塞卡片过滤。

### 2026-09-21｜SWC-001-A 切片 4（版本取值与取材面待补清单）

- 范围：使用者要求"差什么版本列出来、要补什么列清单"。产出 `08-supplement-checklist.md`。
- 命令与退出码：

  | # | 命令 | 退出码 | 期望 |
  |---|---|---|---|
  | 1 | 存活核对：`find 资料 -name "S045*"…"S054*" -not -name '*.html'` | `0` | 10/10 命中（切片 3 的成果确实在盘） |
  | 2 | `grep -oE '[0-9]\.[0-9]+版本' 资料/可用文本/原神/剧情任务/S017_魔神任务.md \| sort -u` | `0` | 仅 `3.5版本` → 章·幕↔版本导不出来 |
  | 3 | 两份储备书目「收录版本」分布统计 | `0` | 提瓦特 1.0–7.0（125 条）、翁法罗斯 3.0–3.7（151 条） |
  | 4 | `python3 tmp/check-doc-links.py` | `0` | 12 份文档、0 断链 |

- 结果：
  - V1–V7 七项待讲明值成表，其中 V3（章·幕→版本全表）被标为最要紧——只有 V2 一个点无法给每张卡定版本下界。
  - 取材面分三类：A 已下载只需读（`06` 剩余 30 条）、B 需去找（两世界都缺地点／组织／信仰页，提瓦特另缺经济与历法）、C 需确认体裁规则（翁法罗斯储备索引无体裁列）。
  - 明确列出"不需要找的"，避免重复劳动。
- 影响下一步：`SWC-001-B` 可先写模板（不依赖 V1–V7）；知识卡过滤要等 V1–V3。

### 2026-09-28｜SWC-001-B1（10 份模板初稿 + D018／D019 + 夹具修正）

- 范围：独立复核 `B0` 结果后按使用者裁定落定 A／B，写两世界核心与 8 份角色模板。
- 复核结论（复核者为本会话）：253 来源、506 哈希全对、0 缺失；142 条剧情正文核验为真；注册表与逐文件 frontmatter 的 `verification` 253/253 一致；`资料/` 无 CRLF；既有来源正文未被改写。报出 4 项，A／B 由使用者裁定，C 由使用者另派助手（切片 5 已关闭，未核验降至 4 条目录页），D 为本回合自修。
- 命令与退出码：

  | # | 命令 | 退出码 | 期望 |
  |---|---|---|---|
  | 1 | `node --check resources/server/lib/world-lore/version-order-smoke-test.js` | `0` | 0 |
  | 2 | `node resources/server/lib/world-lore/version-order-smoke-test.js` | `0` | 0（117 passed / 0 failed） |
  | 3 | 逐文件字符数统计 | `0` | `story.md` ≤4000、`npc_*.md` ≤1800 |
  | 4 | `grep -LE 'S[0-9]{3}' resources/bundled-content/zh/world-lore/*/*.md` | `1` | 无输出＝每份都带出处 |
  | 5 | 跨世界专名串用检查（两向） | `1` | 无命中＝无串用 |
  | 6 | `python3 tmp/check-doc-links.py` | `0` | 0 断链 |
  | 7 | 原话抽样核验：4 轮 `grep -F`，共 51 个短语 | `0` | 51/51 命中（首轮 2 处措辞不精确已改正） |

- 结果：
  - 10 个文件落盘于 `resources/bundled-content/zh/world-lore/{amphoreus,teyvat}/`；`story.md` 1418／1384 字符，`npc_*.md` 1086–1441 字符，全部在注入预算内。
  - 每份带 `出处` 行与行内 `S0xx`；无 S-id 文件为空集。
  - 夹具修正：`死魂灵的夜曲` 实为第七章·第二幕（原写第一幕），并补一条第七章·第一幕用例，断言数 116→117。
  - 引用精确性：`骗过天理` → 原文为"最终骗过了天理"，且 钟离 原句为"与「自我」签订下拯救国家的契约"；已按原文改正 `story.md`／`npc_a`／`npc_c` 三处。
  - 用户裁定落地：D018（保留版本轴）、D019（版本轴裁决）；`05` §5.2 的"版本关系导不出"自述撤回，`02` §2 的"待使用者选定"更正。
- 影响下一步：模板初稿完成，接知识卡 30–50 张／世界。写卡片前注意 `05` §6 两条未决：空月之歌的「月之N」版本名解析、`间章第四幕` 版本次序。

### 2026-09-29｜翁法罗斯阅读物体裁列（08 第二部分 C 关闭）

- 范围：使用者要求为 153 条翁法罗斯阅读物判定体裁，把"书名暗示文体"从隐含规则变成显式数据。
- 命令与退出码：

  | # | 命令 | 退出码 | 期望 |
  |---|---|---|---|
  | 1 | `python tmp/spot-fetch-genre.py`（17 篇题名不可判的歧义条目慢速抽查，15s 间隔） | `0` | 全部 HTTP 200 未触限流；抽查件仅落 `tmp/genre-spotcheck/`，不入库、不进清单 |
  | 2 | `python 资料/工具/apply-genre-column.py`（md＋json 同步加列，断言 153 行全映射无遗漏） | `0` | 分布：书信 28／诗歌 24／记录 24／论著 17／公文 16／工具书 13／史书 7／仪典宗教 5／铭文 5／故事传说 4／寓言童话 3／小说 3／人物传记 2／戏剧 1／聚合入口 1 |

- 关键事实：星铁 BWIKI 书架页**无**体裁字段（信息框仅卷数／所属／实装版本／相关角色／相关任务／获取方式，wiki 分类只有「书籍」），故体裁列是整理方判定、非 wiki 原数据；63 条正文确认（46 篇归档正文 S020–S034、S219–S251＋17 篇抽查）、90 条题名推断。
- 抽查修正的反直觉判定（只看书名会判错的）：`不死的弥卡斯王`=戏剧（带歌队的演出剧本）、`阳雷骑士真传`=人物传记（匿名考辨体）、`「富家翁」维奥提斯的生意经`=人物传记（语录体生平）、`海渊中的密语`=书信、焚风等四篇「箴言」=诗歌（韵文宣告）。
- 用法约束（已写入索引前言）：沿用 2026-09-25 决定，体裁不作卡片分级依据，本列非可信度标签；题名推断条目写卡引用前如需采信应先读正文复核。

### 2026-09-29｜体裁列复核 + 补「依据」列（复核者为本会话）

- 范围：复核上一条的体裁列，并修掉"依据不可逐行判定"与"计数为估算"两个缺口。
- 复核通过项：md 153 行 0 空值、值域无越界、分布与记录逐项一致、md↔json 153/153 一致、5 条抽查修正结论相符、抽查件 17 份与索引词条一一对应。
- 命令与退出码：

  | # | 命令 | 退出码 | 期望 |
  |---|---|---|---|
  | 1 | `python3 资料/工具/add-genre-basis.py` | `0` | rows 153／正文 64／题名 89；正文来源拆分 归档 47＋抽查 17 |
  | 2 | 独立校验：列数、值域、md↔json 三元组、json 补齐率 | `0` | 列数异常 0、依据域外空集、不一致 0、缺 `basis` 0 |
  | 3 | 再跑一次脚本（幂等） | `0` | 输出与首次一致 |
  | 4 | 行尾检查 | `0` | md/json 全 CRLF 不变（索引树不受 `-text` 约束，沿用 `write_text` 默认） |

- 结果：
  - 索引增「依据」列、json 增 `basis`，取值仅 `正文`／`题名`；体裁分布与补列前**逐项相同**（未改动任何体裁判定）。
  - 计数更正：原记"63 正文确认／90 题名推断"是估算，实测 **64／89**（归档相交实为 47 条，非 46）。
  - 前言列出 17 条抽查词条并写明两种依据的重建方式，使 64 条不依赖手填；`tmp/genre-spotcheck/` 被 gitignore 故清单必须落在文件里。
  - 已知残留：抽查证据件不入库，复核那 17 条需重新取页。
- **根因与修复（同回合内发现并修掉）**：两次试跑旧版 `apply-genre-column.py` 时，它按"3 列或 4 列"分支解析，遇到被污染的 **5 列**行静默走 `else`，把体裁写进了版本位（行变成 `| 体裁 | 依据 | 体裁 |`）。第一轮记录曾误判为"已恢复"，实测与 HEAD 逐行比对才发现 153 行全错位。修法三条：
  1. 解析改为与列数无关（版本＝末字段、体裁＝首字段），并加断言"末字段不得是体裁值"，错位当场炸而不是静默写出；
  2. `add-genre-basis.py` 改为**以 json 为唯一真源**重建 md 行，不再依赖 md 的输入状态；
  3. 前言改由 `add-genre-basis.py` 独占，`apply` 只在缺前言时补占位，两者遂各自幂等且与先后顺序无关。
  - 复核：两种顺序各跑一轮，`git diff` 全程 clean；153 行 4 列 0 异常；md↔json 三元组 0 不一致。
  - 两个脚本现已移入 `资料/工具/` 随资料入库（原先只在 gitignored 的 `tmp/`），生成方式同时写进索引前言。
- 影响下一步：`08` 第二部分 C 关闭；写卡时可用「依据」列一条命令筛出需先复核的 89 条。
- 影响下一步：`08` 第二部分 C 随之关闭（决定＋数据面均就绪）。

### 2026-09-29｜SWC-001-B2（知识卡 68 张 + 审计脚本）

- 范围：两世界各 34 张知识卡、`lore/manifest.json`、`lore/aliases.json`；新增 `tools/audit-lore-cards.py`。卡片由两个子代理按固定规格并行产出，本会话逐项复核并修正。
- 命令与退出码：

  | # | 命令 | 退出码 | 期望 |
  |---|---|---|---|
  | 1 | `python3 tools/audit-lore-cards.py` | `0` | PASS，3073 passed / 0 failed |
  | 2 | `python3 tmp/patch-card-evidence.py`（重跑） | `0` | 各世界 0 处编辑＝幂等 |
  | 3 | `node --check resources/server/lib/world-lore/version-order.js` | `0` | 0（审计经它做轴比较） |
  | 4 | cutoff 越界扫描（二相乐园／4.x；往冥府／7.x） | `0` | 0 命中 |

- 结果：
  - 覆盖达标：两世界各 world≥4、location≥7、history 3、relation≥3、secret 5、culture≥2、faction≥3、person 4、document 1；四名角色各自出现。
  - 卡契约补两处未命名处并写入 `02`：`evidence` 收严为**逐字引文**（只允许 `…` 省略，且必须能在被引来源里逐字查到）；提瓦特卡的版本过滤字段定名 `versionRange`。
  - 审计新增两条实质检查，都抓到真问题：①引文逐字在**被引来源**中（不是"在资料某处"）；②非 public 卡必须有非空 `allow`。
- **子代理产出的真实缺陷（复核才发现，子代理报"0 FAIL"因当时审计还没这两条）**：
  1. 20 条引文用概括冒充引文，其中 4 条是换词（`直至`/`直到`、`我曾`/`我还`、`我对`/`纳西妲对`、`神性已经消散`/`神性的部分已经消散`）；
  2. 16 条引文其实在被引来源**之外**（补来源即可，非错引）；
  3. teyvat 一张 secret 卡 `allow` 为空 → 谁都检索不到（死卡）；
  4. teyvat 一张卡的 `allow` 漏掉引用其原话的角色（钟离的话在证据里却不许钟离检索到）。
- 本会话自身也踩一坑：`patch-card-evidence.py` 的 `EDITS` 里**同名 key 写了两遍**，后者整个覆盖前者，导致 4 张卡的来源没被补上而表面"通过"。已修并在脚本内注明。
- 影响下一步：阶段 A 内容齐备，阶段门（`04` §4）要求的两项（schema/data audit、来源完整性）均达成。检索行为验证属阶段 B。

### 2026-09-30｜阶段 A 关闭复核

依据 `01` 阶段 A 的目标与完成定义、`04` §4 阶段门。逐条给命令与结果，未达成项单列在末尾。

| 阶段 A 要求 | 验证方式 | 结果 |
|---|---|---|
| 两世界各一个明确剧情截止点 | manifest `canonCutoff`（D015／D016） | ✅ `3.7`；`第七章·第二幕`＋`versionFloor 7.0` |
| 每世界一份世界核心 | 存在性＋预算＋**写明截止点** | ✅ 2 份，1418／1384 字符（≤4000） |
| 每世界四份角色模板 | 存在性＋预算＋H1 与 `pilotSlots` 绑定一致 | ✅ 8 份，1086–1441 字符（≤1800） |
| 每世界 30–50 张知识卡 | 卡数与 `manifest.cardCount` 一致 | ✅ 35／34 |
| 覆盖：公共常识·地点·两段历史·四人关系·≥2 秘密 | `COVERAGE_MIN` 下限 | ✅ 全部达标 |
| 校验来源 | sourceId 存在／url 相符／world 相符／已核验／有 locator | ✅ |
| 校验时间 | `spoilerLevel ≤ cutoff`，轴比较复用 `version-order.js` | ✅ |
| 校验知识范围 | level／allow／deny 值域、allow∩deny=∅、非 public 卡可达 | ✅ |
| 校验冲突字段 | `conflictsWith` 目标存在且**对称**（本回合新增检查） | ✅ 新增 1 对真实冲突 |
| 完成定义①：卡可追溯来源 ID 与 URL | 同"校验来源"，另加**引文逐字在被引来源内** | ✅ |
| 完成定义②：同一秘密不被无权限角色检索到 | 静态过滤模拟：每张非 public 卡至少一名角色取不到 | ✅ **静态**，见下 |

命令与退出码：

| # | 命令 | 退出码 | 结果 |
|---|---|---|---|
| 1 | `python3 tools/audit-lore-cards.py` | `0` | PASS（3124 passed / 0 failed） |
| 2 | `python3 tools/audit-lore-package.py` | `0` | PASS（495 passed / 0 failed） |
| 3 | `python3 tools/add-conflict-pair.py`（重跑） | `0` | 幂等，cardCount 不变 |
| 4 | `python3 tools/build-lore-aliases.py`（重跑） | `0` | 幂等 |
| 5 | `python3 tmp/check-doc-links.py` | `0` | 0 断链 |

本回合补的两处**结构**缺口（此前无人管）：

1. **模板整体无人审计**：`audit-lore-cards.py` 只管卡片。新增 `tools/audit-lore-package.py` 覆盖模板齐备、注入预算、H1 与绑定一致、模板内 S-id 可追溯且属本世界、story.md 真的写上截止点、跨世界专名零泄漏。
2. **槽位↔角色 id 绑定只写在散文里**：卡片用 `phainon`、模板叫 `npc_a.md`、正文写「白厄」，三者此前靠 `07` 的表格人为对齐。现已落入 manifest 的 `pilotSlots`，并由审计强制一致。

另外，`conflictsWith` 此前 0 使用，而阶段 A 明写要"校验冲突字段"。备齐一对**真实**分歧（不编造）：`S002` 编年史记刻律德菈「遇刺身亡（实为自杀）」，`S021` 残卷记她「从众人视野中彻底消失」——原先两种记载被合并在同一张卡里且摘要径称"她死"，按 `02` 拆为两卡并互链（新增 `amphoreus.history.kelvdeleijieju.001`，卡片数 34→35）。提瓦特侧的公元纪 vs 相对纪元**不构成冲突**，属可信度分层（见 `资料/索引/提瓦特历法与时间表达.md`），故未建冲突对。

**未在阶段 A 确立、明确留给后续**：

- **检索器本身**：过滤语义已按同一规则写进审计，但运行时 `retriever.js` 属阶段 B（T1）。
- [x] ~~冲突卡的呈现策略~~：2026-09-30 使用者裁定并落地（`conflict-order.js` ＋ `02` §6），卡片数改 36。
- **不变量②**（只有已持久化事件才更新状态）在阶段 A 无处体现——尚无 `world_state.json` 等文件，属阶段 C。
- 三条已记风险：teyvat 未用 `deny`；空月之歌 `versionRange` 取保守值 `5.8`；部分 `locator` 仍是「网页正文（自动提取）」这类泛值。

### 2026-09-30｜SWC-002-P（冲突卡呈现策略落地）

- 范围：把使用者裁定的呈现策略落成可执行规则并加测试，供 T1 直接调用而不是重新实现。
- 命令与退出码：

  | # | 命令 | 退出码 | 期望 |
  |---|---|---|---|
  | 1 | `node --check resources/server/lib/world-lore/conflict-order.js` | `0` | 0 |
  | 2 | `node resources/server/lib/world-lore/conflict-order-smoke-test.js` | `0` | 0（39 passed / 0 failed） |
  | 3 | `python3 tools/audit-lore-cards.py` | `0` | PASS，含新增的冲突对检查 |
  | 4 | `python3 tools/audit-lore-package.py` | `0` | PASS |
  | 5 | `python3 tmp/check-doc-links.py` | `0` | 0 断链 |
  | 6 | `python3 tools/add-conflict-pair.py`（重跑） | `0` | 本次改动 0 处＝幂等 |

- 结果：
  - 新增 `conflict-order.js`：来源层级三档（`游戏内` / `社区` / `未定`）、四级排序、`rankGroup`、固定「另说」格式。决定性顺序与输入顺序无关，有 200 次重复断言。
  - 审计新增三条：冲突对必须同 `type`、必须对称、必须能由层级或 `reliability` 分出主副（**不许只靠 `cardId` 兜底**——那等于"哪一说更接近原著"没记下来）。审计直接 `require` 该模块，排序只有一份实现。
  - `02` §6 增「冲突组的呈现」五条；`03` §2 增一条守卫。
- **写模块时抓到两个真问题**：
  1. `sourceLayer` 先认「游戏内」，但「社区设定汇总（引用游戏**内容**）」里恰好含「游戏内」子串，社区来源被误判成原著 → 改为先认「社区」（更保守，且社区汇总本就两头都沾）。测试加了对该串的专门断言。
  2. 测试首版期望写错：拿两张层级相同的卡去验"当事人并列后落回层级"，实际落到 `cardId`。是夹具没有区分度而非实现错，已改为有区分度的夹具，并单列一条"全对称时以 cardId 定序"。
- **顺带修掉一处数据形状问题**：第一版把冲突挂在「第一次逐火之旅」整卡上，宽窄不对等——那一对里"另说"首句讲的是逐火之旅而非她的结局。改为同 slug 的 `kelvdeleijieju.001`（残卷，主）／`.002`（编年史，另说）两张窄卡成对；叙述卡退出冲突组并摘掉重复引文。卡片数 35→36。
- 影响下一步：T1 直接 `require` 该模块；呈现时机（何时附副卡）属 compiler，阶段 D 再落。

### 2026-09-30｜SWC-002（阶段 B：本地确定性检索 / T1）

- 范围：`retriever.js` ＋ T1 测试；过滤先于排名、私密不泄漏存在性、冲突只留主卡。
- 命令与退出码：

  | # | 命令 | 退出码 | 期望 |
  |---|---|---|---|
  | 1 | `node --check resources/server/lib/world-lore/retriever.js` | `0` | 0 |
  | 2 | `node resources/server/lib/world-lore/world-lore-smoke-test.js` | `0` | 0（50 passed / 0 failed） |
  | 3 | `node resources/server/lib/world-lore/conflict-order-smoke-test.js` | `0` | 0（39 passed） |
  | 4 | `node resources/server/lib/world-lore/version-order-smoke-test.js` | `0` | 0（117 passed） |
  | 5 | `python3 tools/audit-lore-cards.py` / `audit-lore-package.py` | `0` | 均 PASS |
  | 6 | 真发布包集成抽跑（两世界 7 个查询） | `0` | 全部命中预期、跨世界隔离为真、确定性为真 |

- 结果：T1 七条各有断言并全过；另外三条契约要点也测了——被过滤的私密卡在返回体里零痕迹、冲突组只留主卡且副卡以「另说」附出、入参不被改动。检索器**不重写**排序与轴比较：`require` `conflict-order.js` 与 `version-order.js`。
- **实现期定的一处阈值**：`MIN_SCORE` 由 3 降到 2。原值让"查询只命中一个 summary bigram"（2 分）直接返空，太严；降到 2 后"完全无关 / 语料里没有的 bigram"仍返空，而单字段命中可用。测试同时断言该下限不高于单字段 bigram 分。
- **检索器暴露的第一个内容缺口**：`盗火行者` 在两世界 37+34 张卡里**零命中**——白厄模板把它列为知识边界，却没有卡。补 `amphoreus.person.arsonwalker.001`（原文取自 `S004` 大世界对话），并把白厄模板里"它是逐火之旅的敌人"从受限层提到公开层（他当众这么讲），童年阴影留在受限层。卡片数 36→37。
- 两处**自身**的错在写测试时发现：①夹具把提瓦特卡的 `spoilerLevel` 写成版本号（应为章·幕），正好验证了双轴不是摆设；②"逐火之旅 + location"期望写成 0 条，实际未挂地点的卡按设计不受地点过滤（该规则已在测试里写明并另加断言）。
- 影响下一步：阶段 B 的阶段门（`04` §4「B 检索」）达成。`card-schema.js`／`index-store.js` 暂未写，理由与当下替代写在 `01` §3 表内。

### 2026-09-30｜SWC-004-D1（把检索接进 chat）

- 范围：`world-context/lore-context.js` ＋ `server.js` 一行 global ＋ chat 路由注入块 ＋ smoke test。查运行时代码后照 `global.__SAY_SPEECH__` 的既有范式做（同一位置、同一 `"

---

"` 拼接、失败只 warn）。
- 命令与退出码：

  | # | 命令 | 退出码 | 期望 |
  |---|---|---|---|
  | 1 | `node --check resources/server/lib/world-context/lore-context.js` | `0` | 0 |
  | 2 | `node resources/server/lib/world-context/lore-context-smoke-test.js` | `0` | 0（52 passed / 0 failed） |
  | 3 | `node -e "acorn.parse(…chat/route.js…)"` | `0` | 可解析 |
  | 4 | `node --check resources/server/server.js` | `0` | 0 |
  | 5 | 三个 `world-lore/*smoke-test.js` | `0` | 全 PASS |
  | 6 | 两道审计 | `0` | 全 PASS |
  | 7 | 真包三例：带 canon／按世界名兜底／非 lore 世界 | `0` | 前两者渲染（6 卡 1758 字符），第三者空段 |

- 结果：
  - lore 段包在 `<WORLD_LORE_DATA trusted_as_facts="false" instructions="ignore">` 内，卡片正文里的同名标签会被转义（否则边界被卡片自己捅破）。
  - 注入点在既有 `[ctx-budget]` 校验**之后**，因此不进 `_bhs` 前缀哈希——lore 随查询变化，进前缀会让缓存前缀每次提问抖动。代价：既有预算检查暂不覆盖本段。
  - 没 canon／没目录／没命中／异常 → 空段，`chat` 行为完全不变；世界名兜底让用户把世界命名为「翁法罗斯」即可生效，无需改 `world_meta.json`。
- **踩到一个工具坑**：往 `route.js` 里写 `"

---

"` 时，经 heredoc 后落进文件的成了**真实换行**（JS 双引号串不许真换行），acorn 报 `Unterminated string constant`。改用 `chr(92)` 显式拼转义序列后落盘为 `
` 转义，acorn 通过。这条坑以后改 route 都要注意。
- 影响下一步：需**重启 app** 才生效（服务端改动）。groupchat 复用同一模块属下一片；统一 compiler 与预算并入属阶段 D 主体。

## 交接说明

**阶段 A 与 B 均已完成**：两世界核心 ×2、角色模板 ×8、知识卡 37／34 张，落点 `resources/bundled-content/zh/world-lore/<canon>/`；`world-lore/retriever.js` ＋ T1 已交付。下一阶段是 `SWC-003`（动态世界状态），不要在阶段 D 上抢跑。

先完整阅读本文件和 `DEVELOPER_MODEL_PROTOCOL.md`，再读 `05-canon-cutoff-schemes.md`（第 5 节是已定契约，第 6 节是仍未决）、`02-data-and-prompt-contracts.md` §3（卡片契约）、`04-minimal-verification.md`（T1 就是阶段 B 的验收）。

改动发布包后**必须**跑这两条，它们是阶段 A 的守门，缺一条就等于没验：

```bash
python3 tools/audit-lore-cards.py      # 卡片 schema／来源／引文逐字／可达性／冲突对
python3 tools/audit-lore-package.py    # 模板／绑定／预算／跨世界／权限静态模拟
```

八处容易踩的坑：①`资料/` 的行尾不可改——用 `资料/工具/下载并整理.py` 重跑时它已显式 `newline="\n"`，别再写别的脚本去生成那两棵树；②`version-order.js` 目前**只在审计里**被调用，运行时仍无调用方；③groupchat 的上下文预算要从零补；④提瓦特是同 canon 双轴，**跨轴不会自动比较**；⑤卡片 `evidence` 是**逐字引文**不是概括，审计强制，改卡时先 grep 原文；⑥槽位↔角色 id 绑定在 manifest 的 `pilotSlots` 里，模板 H1 必须与之一致。⑦检索器的 `MIN_SCORE` 与字段权重一起决定"多像才算相关"，改一个要重跑 T1；⑧`resources/server/lib/world-lore/` 下新增的 `*-smoke-test.js` 会被 `tools/run-smoke-matrix.js` 自动收录。另记两条已知噪声：语音页标题会随语言标签重复、`S053` 贺图段串入他角贺词。
