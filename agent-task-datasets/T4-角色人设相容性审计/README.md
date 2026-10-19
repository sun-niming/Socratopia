# T4 素材包：角色人设的策略相容性审计

32 个角色的完整人设素材 + 一份服务端规格。157 个文件，107.02 MB（绝大部分是图片）。

## 目录

```
角色/                     32 个角色目录（001-八重神子 … 032-帕西）
    0XX-<名字>/模板.md        ← 实际投喂给模型的人设正文（32 份，全部存在）
    0XX-<名字>/设定.md        ← 背景参考，不投喂（32 份，全部存在）
    0XX-<名字>/图片/          ← 立绘/头像，共 83 张
    README.md                ← 素材清单说明
    templates-index.json     ← 32 条素材索引（UTF-8）
    模板检查报告.md / 旧版模板优化报告.md
    _批次04-龙族_作业说明.md
    _batch04-*.py / _batch04-index.js / templates-smoke-test.js   ← 原始作业脚本，仅作背景
规格/public/voice-catalog.json   ← 31 个已实装语音（voiceId / displayName / gender / group）
```

## 上游的真实规格（服务端与前端的硬约束）

这些数字来自 Socratopia 的实际代码，不是虚构的验收标准：

| 约束 | 值 | 出处 |
|---|---|---|
| `name` 长度 | ≤ 20 字符 | 前端合并校验 |
| `identity` 长度 | ≤ 60 字符 | 同上 |
| `personality` 长度 | ≤ 100 字符 | 同上 |
| `persona`（模板全文） | ≤ 1500 字符 | 同上 |
| 人设结构 | 必须含 `## 基本信息` 头块 | `merge-persona` 靠这个标题识别并原样保留 |
| `age: null` | **合法**，表示未提供确定年龄 | `templates-index.json` 的 note 字段 |
| 性别枚举 | `female` / `male` / `neutral` | `/api/custom-companions` POST |
| 头像 | 需能裁成方形 | 上传链路按方形处理 |

`voice-catalog.json` 结构：`{schemaVersion, generatedFrom, note, voices:[{voiceId, displayName, gender, group, language, version, gptModelName, sovitsModelName, ...}]}`。

## 已核实的事实（供命题参考，不要在 prompt 里泄露）

- 磁盘上 **32** 个角色目录，`templates-index.json` 里 **32** 条，但 `角色/README.md` 正文写的是
  **「27 个角色」**、图片写「63 张」（实际 83 张）——真实的文档漂移。
- `voice-catalog.json` 有 **31** 个声线。按 `displayName` 精确匹配时，**3 个角色匹配不上**：
  `「队长」卡皮塔诺`（目录里是 `队长`）、`昔涟`（无）、`阮•梅`（目录里是 `阮·梅`，间隔号不同）。
  这 3 条里**只有 1 条是真缺音**，另 2 条是命名差异——区分二者才是这题的考点。
- 32 份 `模板.md` **全部**含 `## 基本信息`，且**全部** ≤ 1500 字符（最长 030-夏弥 1235 字符）。
  即：长度与结构其实是干净的，异常集中在索引/文档/语音侧。
- `templates-index.json` 的 name/identity/personality 全部在限内，`avatarSourcePath` 32 条全部可解析。

## 任务不变量

1. 纯只读。
2. 交付物是矩阵表 + 对照表 + 报告，不是代码。
3. 图片可用性判断需要真看图（83 张），不能只信索引。

## 锚点位置

在 `_评分方专用/`，不要随包下发。
