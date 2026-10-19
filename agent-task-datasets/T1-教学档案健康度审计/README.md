# T1 素材包：教学档案健康度审计

这是从 Socratopia 真实运行实例里**原样拷出**的两个用户世界数据，用于做「课堂档案完整性审计」类任务。
只读素材，不是可运行工程。

## 目录

```
world_KU/   主样本（大而脏：90 段课堂，257MB 对话数据，15 个书目录但索引只登记 12 本）
world_HH/   对照样本（小而干净：20 段课堂，4 本数学教材，结构同构）
```

两个世界的目录结构完全同构，所以「KU 的病」可以拿 HH 当基线对照——这是设计好的对照组，
缺了它任务会退化成纯 `ls` 扫描。

## KU 的体量与构成（2026-11 实测）

| 子目录 | 内容 |
|---|---|
| `chats/` | **90** 个 json，**257.41 MB**；中位约 80KB，最大 `-2XQLVh8h2i2jLrYN_muT.json` = **121.24 MB**，第二 `OiAHH-VXyUf5_GIdndLOV.json` = 99.58 MB |
| `concept-summaries/` | 88 个 json，1.29 MB |
| `lesson_summaries/` | **33** 个 md（不是每节课都生成，属设计行为） |
| `conversations/` | **148** 个目录（多于 chat 数，属设计行为） |
| `flashcards/` | 13 个 json，0.46 MB |
| `companions/` | 4 个文件 |
| `continuity/` | 32 个文件 |
| `textbooks/` | 15 个书目目录 + `textbook_index.json`（**只登记 12 本**）；已剔除 PDF 本体，保留 24.32 MB 页面级 json / 知识库 |
| 其他 | `npc_a~d.md`、`relation_npc_a~d.md`、`story.md`、`world_records.md`、`learner_profile.md`、`pal_moments.md`、`world_meta.json` |

**已剔除**：`chats/` 以外的 `books/`、`assets/`、`textbooks/**/*.pdf`（原始教材 PDF 约 500MB，
对审计无必要；页面级 json 全部保留）。审计时不要指望能读到 PDF。

## HH 的体量（对照）

20 段课堂（2.3KB ~ 143KB，中位约 40KB）、4 本数学教材目录、diary / groupchat / flashcards 齐全。
HH 的问题是**小而规则**，正好用来验证「KU 里发现的异常是特例还是系统性问题」。

## 任务不变量（写进 prompt 的硬约束）

1. **纯只读**。素材是拷贝，改坏了不可复原。
2. 禁止整读大文件——121MB 的 `chats/-2XQLVh8h2i2jLrYN_muT.json` 内含 16,398 个 `retryText` 键，
   最深嵌套 14 层，单个值可达 4,356 万字符（约 41.5M 字符）。整读会直接撑爆上下文。
3. 交付物是**报告 + 表**，不是代码补丁；写脚本可以，但脚本只能是手段。

## 已知的「真答案」不在本目录

召回锚 / 误报锚 / 溯源锚在提交方的 `_评分方专用/` 里，**不要一起发给被测 agent**。
