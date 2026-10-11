# 数学公式语义化核心完成报告

## 结果

- 当前阶段：数学公式语义化核心已完成 Terra 第一轮 FAIL 的 11 项根因整改，并完成本地核心复核。
- 前端准入门：`CLOSED`。
- 运行时接入：未接入 React、`prepareForSpeech`、TTS 播放队列、音频缓存、IndexedDB、Electron 或 ASAR。
- 错误语义朗读数量：0（以 276 条冻结黄金语料、本轮回归和异常用例结果为依据）。
- 完整 Electron/产品验收：按用户要求未执行；本报告只记录核心整改证据，交给后续模型进行独立验收。

## 变更文件

本轮整改的产品代码、测试和黄金语料均位于 `resources/server/lib/math-speech/`；整改证据位于 `outputs/math-speech-remediation/`。本报告为允许更新的核心文档。

- `contracts.js`：公共合同、默认限制、输入复制和冻结工具。
- `index.js`：`prepareMathSpeech` 离线主入口与安全流水线。
- `latex-to-mathml.js`：KaTeX MathML 适配器，`trust:false`、`throwOnError:true`、`maxExpand:1000`。
- `mathml-to-ast.js`：严格、受限的 MathML 树解析和 AST 映射。
- `normalize-ast.js`：数字片段、分隔符、脚本、函数、大运算符、微分、矩阵和分段结构规范化。
- `resolve-intent.js`、`symbol-scope.js`：证据优先的作用域消歧与结构化回退。
- `numbers-zh.js`、`lexicon-zh.js`、`render-zh.js`：字符串精度数字读法、角色化符号词典和中文结构渲染。
- `diagnostics.js`、`seal-policy.js`：覆盖率/复杂度诊断、安全降级和深冻结返回值。
- `corpus/*.json`：8 类、276 条黄金语料，规范化表达式唯一数 276，重复数 0。
- `math-speech-smoke-test.js`、`math-speech-corpus-test.js`、`math-speech-corpus-audit.js`、`math-speech-number-test.js`、`math-speech-ambiguity-test.js`、`math-speech-malformed-test.js`、`math-speech-determinism-test.js`、`math-speech-lexicon-test.js`、`math-speech-ast-test.js`、`math-speech-remediation-test.js`、`math-speech-independent-remediation-test.js`、`math-speech-manual-audit.js`、`math-speech-benchmark.js`：自动化验证、独立交叉回归、人工审阅和基准。
- `README.md`：技术决策、边界和运行说明。

没有新增依赖，因此没有修改 `resources/server/package.json`、依赖锁定文件或 release runtime manifest。

## 支持范围

- 固定管线：LaTeX → KaTeX MathML → 规范化 AST → 作用域消歧 → 中文语音文本/安全跳过。
- AST 节点：数字、标识符、文本、运算符、行、一元/二元运算、关系、分数、根式、幂、上下标、函数调用、围栏、求和、求积、积分、极限、重音、向量、矩阵、分段函数、未知节点诊断。
- 结构：基础代数、分数/根式/幂、微积分大运算符、集合逻辑、概率统计、线性代数、百分数和科学记数法。
- 安全策略：解析失败、未知控制宏、未闭合结构、未知 MathML 节点、未支持符号、复杂度超限和输出超限均返回空语音的 `skip` 结果。
- 歧义策略：没有证据时对竖线、区间/有序对、隐式乘法、逆幂、集合差和微分使用稳定结构读法；只有 `evidence: "explicit"` 的符号事实可以消除关键歧义。
- 返回结果深复制并深冻结；调用方后续修改 `context.symbolFacts` 不会改写既有结果。

## 测试结果

- `node math-speech-smoke-test.js` → `PASS examples=14`
- `node math-speech-corpus-test.js` → `total=276, passed=276`。
  - 基础代数：50
  - 分数、根号、幂：30
  - 微积分：30
  - 集合与逻辑：31
  - 概率统计：24
  - 线性代数：21
  - 数字：44
  - 歧义、错误与极端输入：42
  - 模式统计：semantic 217、structural 35、detailed 10、skip 14
  - 平均 AST 节点覆盖率：1
- `node math-speech-number-test.js` → `PASS cases=54`
- `node math-speech-ambiguity-test.js` → `PASS cases=20`
- `node math-speech-malformed-test.js` → `PASS cases=54`
- `node math-speech-determinism-test.js` → `PASS iterations=50`
- `node math-speech-lexicon-test.js` → `PASS operators=46 greek=48`
- `node math-speech-ast-test.js` → `PASS mappings=21`
- `node math-speech-independent-remediation-test.js` → `PASS total=90, passed=90`
- `node math-speech-manual-audit.js` → `PASS totalReviewed=64, A=57, B=7, C=0, D=0`

## 性能

命令：`node resources/server/lib/math-speech/math-speech-benchmark.js`

- 迭代次数：1000
- P50：0.0659 ms
- P95：0.1553 ms
- P99：0.2522 ms
- 最大值：0.3631 ms
- 平均值：0.073438 ms
- 平均 AST 节点覆盖率：1
- 基准样本中的全部 1000 次调用均返回 `ok=true`。
- all-skip 故障注入：`valid=false`，退出码 `1`；失败门槛具体报告 successRatio、unexpectedSkips、meanNodeCoverage 及 semantic/structural/detailed 样本数。

该数字是当前开发机、当前已启动 Node 进程和当前 KaTeX 运行时的一次本地基准，不等同于 Electron 产品端到端验收结果。

## 降级统计

来自 276 条黄金语料的实际执行：

- semantic：217
- structural：35
- detailed：10
- skip：14

`skip` 条目覆盖 KaTeX malformed、未知语义宏、输入长度、输出长度、MathML 结构、未知节点和未知符号等异常路径。

## 已知限制

- 当前实现是受限的第一阶段 MathML/中文读法子集，不是完整 W3C MathSpeak 或 ClearSpeak。
- 不解析任意用户自定义 TeX 宏，不使用 LLM、网络、远程公式服务或 TTS 服务。
- 没有证据的数学歧义会保守地产生结构读法；这可能比具体语义读法更长，但不会把未来上下文证明为错误的含义读出来。
- 通用未知函数调用会使用结构模式；超出支持集合的 MathML 节点会安全跳过。
- 本阶段没有把核心结果接入现有文本准备、语音生成、播放器、重播、历史消息或缓存流程。
- 完整应用启动、Electron 打包、runtime manifest clean-release 以及前端回归验收未执行，留给后续模型。

## 验证命令

- `node --check resources/server/lib/math-speech/*.js` → `PASS files=25`
- Acorn 解析全部 25 个数学核心 JS 文件 → `PASS files=25`
- `node resources/server/lib/math-speech/math-speech-smoke-test.js` → `PASS examples=14`
- `node resources/server/lib/math-speech/math-speech-corpus-test.js` → `total=276, passed=276`
- `node resources/server/lib/math-speech/math-speech-number-test.js` → `PASS cases=54`
- `node resources/server/lib/math-speech/math-speech-ambiguity-test.js` → `PASS cases=20`
- `node resources/server/lib/math-speech/math-speech-malformed-test.js` → `PASS cases=54`
- `node resources/server/lib/math-speech/math-speech-determinism-test.js` → `PASS iterations=50`
- `node resources/server/lib/math-speech/math-speech-lexicon-test.js` → `PASS operators=46 greek=48`
- `node resources/server/lib/math-speech/math-speech-ast-test.js` → `PASS mappings=21`
- `node resources/server/lib/math-speech/math-speech-corpus-audit.js` → `raw=276, unique=276, shapes=159, duplicates=0, detailed=10`
- `node resources/server/lib/math-speech/math-speech-remediation-test.js` → `PASS`
- `node resources/server/lib/math-speech/math-speech-independent-remediation-test.js` → `PASS total=90`
- `node resources/server/lib/math-speech/math-speech-manual-audit.js` → `PASS totalReviewed=64, A=57, B=7, C=0, D=0`
- `node outputs/math-speech-remediation/fault-injection-test.js` → `PASS allDetected=true`
- `node resources/server/lib/math-speech/math-speech-benchmark.js` → `valid=true, semantic/structural/detailed thresholds enforced`
- `node resources/server/lib/math-speech/math-speech-benchmark.js --all-skip` → non-zero exit with explicit success/skip/coverage/mode threshold failures
- `node -e "const a=require('acorn'); ..."`（数学核心全部 25 个 JS）→ `PASS files=25`
- `node --check outputs/math-speech-remediation/fault-injection-test.js` 与 Acorn → `PASS files=1`
- `git diff --check` → `PASS`；Git 同时报告了初始脏工作区既有文件的 LF/CRLF 警告，没有产生 diff 检查错误。

未执行会覆盖 manifest 的生成脚本；`node resources/server/lib/release-runtime-manifest-smoke-test.js` 已只读执行并通过（`entries=2687`）。本任务没有新增服务端依赖，也没有修改 runtime manifest 所覆盖的特殊运行时树。

## 前端审计

- 本任务新增/修改前端文件数：0。
- 未修改 `resources/server/.next/static/chunks/**`、`win-unpacked/resources/server/.next/static/chunks/**`、React 页面、TTS 播放逻辑、Electron 主进程、preload 或 ASAR。
- 初始工作区已经存在多项与本任务无关的前端、Electron 和服务端用户改动；本任务保留它们，没有用回滚或格式化覆盖。
- 是否实现重新生成语音：否。
- 前端准入门仍为：`CLOSED`。

## 后续建议

- 由后续模型独立复核完整应用启动、发布产物路径、前端未改动审计以及产品级回归矩阵。
- 在用户明确授权且另行制定方案前，不执行前端接入、语音重新生成、历史音频覆盖或版本切换。
