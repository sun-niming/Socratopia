# Socratopia 数学公式语义化项目档案

本目录汇总数学公式语义化核心项目的背景、技术资料、验收历史、风险边界和 GPT-6 接入前收尾任务书。

## 当前结论

- 数学语义核心：第四轮独立验收 `PASS`。
- 当前最新验收报告：[outputs/math-speech-acceptance-round4/ACCEPTANCE_REPORT.md](../outputs/math-speech-acceptance-round4/ACCEPTANCE_REPORT.md)
- 核心状态：已通过已定义合同、黄金语料、独立黑盒、故障注入、性能、安全和确定性验收。
- 前端准入门：`CLOSED`。
- 前端接入：尚未授权。
- 重新生成语音：尚未实现、尚未授权。
- 当前目录只做资料整理和接入前收尾规划，不修改产品前端。

## 文档导航

1. [项目背景与前景展望](01-project-background-and-prospects.md)
2. [资料与证据索引](02-materials-and-evidence-index.md)
3. [技术状态、风险与接入前决策](03-technical-state-risk-and-gates.md)
4. [GPT-6 接入前收尾任务书](04-gpt6-pre-frontend-closure-prompt.md)
5. [验收轮次时间线](05-acceptance-timeline.md)

## 使用建议

- 将 `04-gpt6-pre-frontend-closure-prompt.md` 直接交给 GPT-6。
- 同时提供 `01`、`02`、`03` 和项目根目录 `AGENTS.md`。
- GPT-6 完成后只能输出收尾报告和前端准入建议，不得自行打开 `CLOSED` 门槛。
- 如果 GPT-6 发现必须修改前端，必须停止并提出最小范围的授权请求。

