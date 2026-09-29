# 最小充分验证方案

## 1. 原则

本项目是打包产物，测试成本高且重复 smoke test 很容易只验证实现细节。本方案保留少量能拦住真实灾难的契约测试，不为每个小函数、getter、字段映射或格式化 helper 单独建测试。

每次修改仍遵守 `AGENTS.md`：

- 每个编辑过的 JavaScript 文件运行 `node --check`；
- 每个编辑过的 `.next` JavaScript 额外用 acorn 解析；
- 运行与本次变化直接相关的 co-located smoke test；
- `.next/` 内测试手工运行，因为总矩阵会跳过它们。

完整 smoke matrix 只在最终集成门运行一次，或在新的失败证据表明影响范围超出当前模块时运行。不在每个小提交重复全矩阵。

## 2. 只新增四个行为测试

### T1：世界知识检索边界

建议文件：`resources/server/lib/world-lore/world-lore-smoke-test.js`

一个测试文件覆盖：

- 同 world 公共卡可以命中；
- 另一个 world 或账户的卡不可命中；
- 超过 canon cutoff 的卡不可命中；
- 私密卡只对 allow 角色可见；
- 低相关查询返回空，不凑满条数；
- 结果不超过卡片数和字符预算；
- 相同输入结果稳定。

这里使用少量真实结构 fixture，不测试每一个评分分支。

### T2：事件提交与记忆传播

建议文件：`resources/server/lib/world-state/world-state-smoke-test.js`

一个测试文件覆盖：

- 一次事件原子更新 world revision、角色状态、关系和事件日志；
- 相同 idempotency key 重放不重复生效；
- 参与者、见证者、听闻者和未知者获得不同记忆权限；
- stale revision 返回 409；
- session epoch 失效时不写任何目标；
- 中断事务能恢复或回滚到一致状态。

复用现有 transaction 测试设施，不重复测试原子写内部实现。

### T3：统一提示上下文

建议文件：`resources/server/lib/world-context/shared-world-context-smoke-test.js`

一个测试文件覆盖：

- chat 与 groupchat 调用同一 compiler；
- 世界、人物、动态状态、相关知识和记忆按固定顺序进入上下文；
- 私密或未来知识不出现在无权限角色上下文；
- lore 数据中的伪指令仍处于数据边界；
- 世界上下文和教材上下文没有互相覆盖；
- 总字符预算与各段预算生效。

测试编译后的结构和关键不变量，不对完整提示词逐字快照。

### T4：四人共享世界验收场景

建议文件：`resources/server/lib/shared-world-scenario-smoke-test.js`

用一个端到端但无真实网络、无真实 LLM 的场景覆盖：

1. A 与 B 和玩家共同经历事件；
2. C 只听闻事件；
3. D 完全不在场；
4. 模拟进程重启；
5. 一对一上下文中 A 记为亲历、C 记为听闻、D 不知道；
6. 群聊上下文与一对一上下文对时间、地点和关系一致；
7. 第二次提交相同事件不重复改变关系。

该测试是最终核心验收，不做大量同义场景变体。

## 3. 复用的现有测试

只在对应集成阶段运行：

- `resources/server/lib/companion-continuity/resolver-smoke-test.js`
- `resources/server/lib/companion-continuity/end-class-commit-smoke-test.js`
- `resources/server/lib/companion-continuity/transaction-smoke-test.js`
- chat／groupchat 对应的现有 smoke test

如果改动没有触及某条路径，不机械运行与它无关的测试。

## 4. 阶段门

| 阶段 | 必跑 | 不在该阶段运行 |
|---|---|---|
| A 内容契约 | `python3 tools/audit-lore-cards.py`；`python3 tools/audit-lore-package.py` | 全矩阵、路由测试、UI 测试 |
| B 检索 | T1；编辑文件 `node --check` | 事务、前端、Electron 测试 |
| C 状态 | T2；现有 transaction test | 知识源全套测试、UI 测试 |
| D 路由集成 | T3；相关 chat/groupchat test；acorn | OCR、TTS、数学朗读等无关测试 |
| 最终验收 | T1–T4；上述受影响现有测试；一次 smoke matrix | 重复多轮全矩阵 |

若全矩阵已有与本功能无关的环境漂移失败，记录原始命令、退出码和失败项，不用修改共享世界代码去迎合无关失败。

## 5. 人工验收只做一个脚本化场景

在临时测试 world 中创建四个虚构测试角色，不使用真实账户资料：

- 玩家与 A、B 在地点 L 发生事件 E；
- C 通过 B 的群聊得知 E；
- D 离线且不在场；
- 关闭并重新启动测试服务；
- 分别询问 A、C、D；
- 打开群聊，检查 A 与 B 能互相接话，C 使用“听说”视角，D 不引用 E；
- 删除临时 world。

只记录结构性结果，不把某一句自然语言措辞当成通过条件。真实模型措辞具有随机性，验收应关注身份、知识权限、事件因果和持久化。

## 6. 失败处理

- 先复现并记录最小输入、实际输出和文件状态；
- 找到根因后只改一个变量；
- 修复后运行导致失败的测试和直接相关测试；
- 连续三次失败转为架构审查，不继续堆补丁；
- 不通过降低账户隔离、知识权限、原子提交或来源要求来“修好”测试。

所有验证命令、时间、退出码和结论写入 `WORKSTATE.md`，不要只在聊天中口头报告。
