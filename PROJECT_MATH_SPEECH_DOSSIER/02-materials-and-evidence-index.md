# 资料与证据索引

本索引区分“项目约束”“设计规范”“实现材料”“验收证据”和“外部参考资料”。路径均以本仓库根目录为相对基准。

## A. 项目约束

| 资料 | 路径 | 用途 |
|---|---|---|
| 仓库唯一规范 | `AGENTS.md` | 打包产物架构、编辑目标、ASAR、manifest、语法检查、禁止文件 |
| 根目录工作区 | `E:\huanjing\sogeladi\socratopia` | 当前主要工作副本 |
| 大小写兄弟副本 | `E:\huanjing\sogeladi\Socratopia` | 历史参考和差异核对 |
| 原始 TTS 日志 | `/mnt/c/Users/ASUS/.codex/attachments/1e2f3db2-5b3d-4bc0-96af-b029d95be39a/pasted-text.txt` | 第一轮 TTS 停止/播放故障的现场证据 |

说明：用户提供的临时截图路径多次不存在，未作为可靠证据使用。

## B. 设计与开发规范

| 资料 | 路径 | 用途 |
|---|---|---|
| 数学核心开发规范 | `MATH_SPEECH_CORE_DEVELOPMENT_SPEC.md` | 交给 GPT-5.6-luna 的开发流程、接口、测试和前端 CLOSED 边界 |
| 数学核心验收规范 | `MATH_SPEECH_CORE_ACCEPTANCE_SPEC.md` | 交给 GPT-5.6-terra Max 的独立验收标准 |
| Luna 整改提示词 | 本档案 `04-gpt6-pre-frontend-closure-prompt.md` 之前的对话记录 | 第三轮 FAIL 后的整改约束来源 |
| 核心 README | `resources/server/lib/math-speech/README.md` | 实际实现边界、离线性、API 和限制 |

## C. 核心实现材料

目录：

```text
resources/server/lib/math-speech/
```

关键文件：

| 文件 | 角色 |
|---|---|
| `index.js` | 主入口和安全总管线 |
| `contracts.js` | 输入、limits、错误代码和对象冻结合同 |
| `latex-to-mathml.js` | KaTeX LaTeX → MathML 适配 |
| `mathml-to-ast.js` | MathML → AST |
| `normalize-ast.js` | 数字、运算、函数、微分、矩阵等结构规范化 |
| `resolve-intent.js` | 语义证据、歧义和角色决策 |
| `symbol-scope.js` | 符号事实、文本声明和作用域 |
| `lexicon-zh.js` | 中文符号/函数词典 |
| `numbers-zh.js` | 中文数字、科学记数法和百分数 |
| `render-zh.js` | AST → 中文朗读文本 |
| `seal-policy.js` | 输出冻结和禁止文本 |
| `diagnostics.js` | 覆盖率、复杂度和诊断 |

## D. 测试与语料

目录：

```text
resources/server/lib/math-speech/corpus/
```

当前黄金语料分类：

```text
algebra.json
fractions-roots-powers.json
calculus.json
sets-logic.json
probability-statistics.json
linear-algebra.json
numbers.json
ambiguity-errors.json
```

关键测试：

```text
math-speech-smoke-test.js
math-speech-corpus-test.js
math-speech-number-test.js
math-speech-ambiguity-test.js
math-speech-malformed-test.js
math-speech-determinism-test.js
math-speech-lexicon-test.js
math-speech-ast-test.js
math-speech-remediation-test.js
math-speech-independent-remediation-test.js
math-speech-benchmark.js
```

## E. 多轮验收证据

| 轮次 | 报告 | 结论 | 主要内容 |
|---|---|---|---|
| 第一轮 | `outputs/math-speech-acceptance/ACCEPTANCE_REPORT.md` | FAIL | 11 项 S1/S2，覆盖概率、科学记数法、积分、控制字符、逻辑、作用域、getter、detailed、语料和 benchmark |
| 第二轮 | `outputs/math-speech-acceptance-round2/ACCEPTANCE_REPORT.md` | FAIL | `P` 普通函数语义和前端历史哈希连续性 |
| 第三轮 | `outputs/math-speech-acceptance-round3/ACCEPTANCE_REPORT.md` | FAIL | 多字符 `Pr` 当前句声明、关键语料删除测试可信度 |
| 第四轮 | `outputs/math-speech-acceptance-round4/ACCEPTANCE_REPORT.md` | PASS | 第三轮两项全部修复，核心、黑盒、故障注入和范围审计通过 |

失败逐条证据目录：

```text
outputs/math-speech-acceptance/failures/
outputs/math-speech-acceptance-round2/failures/
outputs/math-speech-acceptance-round3/failures/
```

## F. 修复基线

| 基线 | 路径 | 用途 |
|---|---|---|
| 第一轮整改基线 | `outputs/math-speech-remediation/baseline/` | Luna 整改开始前的前端/敏感/核心哈希 |
| 第二轮修复基线 | `outputs/math-speech-round2-fix/baseline/` | P/Pr 修复后下一轮验收起点 |
| 第三轮修复基线 | `outputs/math-speech-round3-fix/baseline/` | 多字符 Pr 和测试可信度修复后最新核心基线 |

## G. 交叉测试与临时证据

第三轮/第四轮验收使用过的临时脚本主要包括：

```text
tmp/math-speech-round2-independent.js
tmp/math-speech-round2-scope.js
tmp/math-speech-round3-probability.js
tmp/math-speech-round3-faults.js
tmp/math-speech-round3-scope.js
tmp/math-speech-round3-matrix.js
tmp/math-speech-round3-performance.js
```

这些脚本属于开发/验收过程证据，不应被当成产品 API。使用前应先阅读其输出目录和是否会写文件。

## H. 外部参考资料

以下资料用于设计调研，不代表项目运行时依赖：

| 资料 | URL | 借鉴点 |
|---|---|---|
| W3C MathML 4 `intent` | <https://www.w3.org/TR/mathml4/#mixing_intent> | 用显式 intent 表达数学语义，处理同形异义 |
| KaTeX 官方选项 | <https://katex.org/docs/options.html> | `output: mathml`、`throwOnError`、`trust`、`strict` |
| Speech Rule Engine | <https://github.com/Speech-Rule-Engine/speech-rule-engine> | MathSpeak/ClearSpeak、规则域、locale 和结构化语音 |
| MathCAT | <https://daisy.github.io/MathCAT/> | MathML 语义化、修复、语音和导航；中文覆盖边界 |
| Unicode CLDR RBNF | <https://unicode-org.github.io/cldr/ldml/tr35-numbers.html#Rule-Based_Number_Formatting> | 数字 spellout、年份/序数/计数语境 |
| OpenAI GPT-5.6 prompting | <https://developers.openai.com/api/docs/guides/model-guidance?model=gpt-5.6#prompting-best-practices> | 结果优先、成功标准、停止条件、证据和权限边界 |

## I. 资料使用边界

- 外部资料只用于方案设计和风险判断，不作为项目运行时网络依赖。
- 报告中的用户数据、API Key、真实 TTS 音频和截图临时文件不复制进本档案。
- 历史 FAIL 报告必须保留，不能被后续 PASS 报告覆盖。
- 第四轮 PASS 只证明已定义合同范围，不证明任意自然语言上下文开放世界安全。

