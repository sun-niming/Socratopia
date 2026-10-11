# 验收轮次时间线

## 2026-09-02：第一轮验收

报告：`outputs/math-speech-acceptance/ACCEPTANCE_REPORT.md`

结果：`FAIL`

发现 11 项 S1/S2：

- 无概率证据条件概率；
- 科学记数法 e；
- 缺失积分变量；
- MathML 控制字符；
- 逻辑否定作用域；
- 千位分隔数字；
- 作用域优先级；
- getter/双源限长；
- detailed 模式；
- 语料去重；
- benchmark 有效性。

## 2026-09-04：第二轮验收

报告：`outputs/math-speech-acceptance-round2/ACCEPTANCE_REPORT.md`

结果：`FAIL`

新增：

- P 被明确声明为普通函数时仍被读成概率；
- 6 个前端路径相对整改基线发生变化，形成范围连续性问题。

## 2026-09-05：第三轮验收

报告：`outputs/math-speech-acceptance-round3/ACCEPTANCE_REPORT.md`

结果：`FAIL`

新增：

- 中文当前句“令 Pr 是函数”无法覆盖多字符 `Pr`；
- 删除关键黄金语料后 corpus test 仍退出 0。

## 2026-09-05：第四轮验收

报告：`outputs/math-speech-acceptance-round4/ACCEPTANCE_REPORT.md`

结果：`PASS`

确认：

- 第三轮两个问题均修复；
- 40 条概率角色黑盒全部通过；
- 第二轮原始 85 条黑盒全部通过；
- 278 条黄金语料无重复；
- 8 项故障注入全部检出；
- 正常和 all-skip benchmark 均符合预期；
- 64 条人工抽检无 C/D；
- 禁止路径、敏感文件和核心哈希无漂移。

## 当前阶段判断

第四轮 PASS 说明数学核心在已定义合同范围内稳定，但还没有完成：

- 混合 Markdown 接入；
- 服务端批量 API；
- 发布存在性验证；
- 前端真实 E2E；
- 音频缓存版本模型。

因此下一步应交给 GPT-6 完成“接入前收尾审计”，而不是立即修改前端。

