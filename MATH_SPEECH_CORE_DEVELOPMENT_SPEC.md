# Socratopia 数学公式语义化核心开发规范

> 执行模型：GPT-5.6-luna<br>
> 项目：Socratopia Windows 打包产物<br>
> 仓库：`E:\huanjing\sogeladi\Socratopia`<br>
> 当前阶段：数学公式语义化核心<br>
> 前端准入状态：**关闭（CLOSED）**<br>
> 文档日期：2026-09-02

---

## 0. 执行者指令

你是本任务的实现者。你必须严格按照本规范完成“数学公式语义化核心”，不得自行扩大范围。

本规范中的关键词具有强制含义：

- **必须（MUST）**：不可省略。
- **禁止（MUST NOT）**：不可执行。
- **应当（SHOULD）**：除非有书面、可验证的技术理由，否则必须执行。
- **可以（MAY）**：可选实现，不得影响核心验收。

开始工作前必须：

1. 完整阅读仓库根目录的 `AGENTS.md`。
2. 运行只读检查，确认工作目录、Git 状态、现有改动和相关文件。
3. 对照兄弟工作副本：

   ```text
   E:\huanjing\sogeladi\Socratopia_2.0\Socratopia
   ```

4. 保存当前基线验证结果。
5. 不覆盖、不格式化、不回滚任何与本任务无关的用户改动。

本任务完成时必须提交：

- 可独立运行的数学语义核心；
- 完整测试语料；
- 自动化烟测；
- 性能与覆盖率报告；
- 已知限制清单；
- 变更文件清单；
- 所有验收命令及其真实输出摘要；
- 明确声明“前端准入门仍为关闭”，不得顺手进行前端接入。

---

## 1. 任务目标

将 LaTeX/MathML 数学表达式确定性地转换为适合中文课堂 TTS 的纯文本，同时满足：

1. 不再使用“这个公式”或“来看这个公式”作为正常降级结果。
2. 支持结构化解析，而不是依赖整条公式映射或巨型正则替换。
3. 对简单、明确的公式生成自然中文数学口语。
4. 对存在歧义但结构明确的公式生成不会被未来上下文推翻的结构化读法。
5. 对解析失败、未知宏、异常复杂度等情况安全跳过公式。
6. 数字读法由上下文角色决定，不对普通正文进行全局数字替换。
7. 所有输出确定、可测试、可审计、可冻结。
8. 当前阶段完全独立于 React、播放器、IndexedDB、消息 UI 和前端缓存。

目标管线：

```text
LaTeX
  ↓
KaTeX（复用现有依赖）
  ↓
MathML
  ↓
规范化数学 AST
  ↓
符号词典 + 结构规则 + 上下文消歧 + 数字规范化
  ↓
自然朗读 / 结构朗读 / 安全跳过
  ↓
冻结的中文数学语音文本与诊断信息
```

---

## 2. 当前阶段的严格范围

### 2.1 允许范围

当前阶段允许：

- 新增独立数学语义模块；
- 新增服务端/共享纯逻辑文件；
- 新增测试、语料、基准脚本和开发文档；
- 使用仓库已有的 KaTeX 依赖；
- 在必要时新增一个小型、明确、服务端专用的 XML/MathML 解析依赖，但必须遵守第 8 节的依赖约束；
- 更新与新增服务端运行文件直接相关的 runtime manifest；
- 为核心模块建立 CLI 或烟测入口；
- 输出 JSON 诊断报告。

推荐新增目录：

```text
resources/server/lib/math-speech/
├── index.js
├── contracts.js
├── latex-to-mathml.js
├── mathml-to-ast.js
├── normalize-ast.js
├── resolve-intent.js
├── symbol-scope.js
├── numbers-zh.js
├── lexicon-zh.js
├── render-zh.js
├── seal-policy.js
├── diagnostics.js
├── corpus/
│   ├── algebra.json
│   ├── fractions-roots-powers.json
│   ├── calculus.json
│   ├── sets-logic.json
│   ├── probability-statistics.json
│   ├── linear-algebra.json
│   ├── numbers.json
│   └── ambiguity-errors.json
├── math-speech-smoke-test.js
├── math-speech-corpus-test.js
├── math-speech-ambiguity-test.js
├── math-speech-number-test.js
├── math-speech-malformed-test.js
├── math-speech-determinism-test.js
└── math-speech-benchmark.js
```

实际文件可以适度合并，但职责边界必须保留，禁止将所有逻辑堆进一个超大函数。

### 2.2 禁止范围

当前阶段禁止修改任何前端内容，包括但不限于：

```text
resources/server/.next/static/chunks/**
resources/server/.next/server/app/page.js
resources/server/.next/server/app/index.html
resources/server/.next/server/app/index.rsc
resources/server/.next/server/app/index.segments/**
win-unpacked/resources/server/.next/static/chunks/**
```

当前阶段还禁止：

- 修改 `4137-131d0676e3b5bef7.js`；
- 修改五套课堂页面 bundle；
- 修改 React 组件；
- 修改 TTS 播放队列；
- 修改流式句子拆分；
- 修改语音按钮；
- 修改重播逻辑；
- 修改 IndexedDB 音频缓存；
- 新增“重新生成语音”按钮；
- 自动覆盖已经生成的语音；
- 设计或实现前端音频版本切换；
- 将核心模块偷偷接入当前 `prepareForSpeech`；
- 修改 Electron `main.js`、`preload.js` 或 ASAR；
- 修改 `resources/app.asar`；
- 启动新的产品功能开发。

### 2.3 绝对禁止提交的文件

遵守 `AGENTS.md`：

```text
resources/settings.json
resources/set.json
resources/app.asar
```

禁止在任何文件、测试快照、日志或报告中写入真实 API Key、用户数据或本机隐私数据。

---

## 3. 非目标

本阶段不以以下事项为目标：

- 完整实现 W3C MathSpeak；
- 完整实现 ClearSpeak；
- 覆盖所有 TeX 宏包；
- 解析任意用户自定义宏；
- 使用 LLM 实时解释公式；
- 支持语音导航数学子表达式；
- 支持盲文；
- 替换现有 KaTeX；
- 引入完整 MathJax；
- 在浏览器中实时运行核心；
- 在 TTS 中实际播放语音；
- 处理前端流式回滚；
- 重新生成历史音频。

这些事项可以记录为后续建议，但禁止在当前实现中展开。

---

## 4. 设计原则

### 4.1 结构优先

必须基于数学结构处理公式：

```text
LaTeX → MathML → AST → 语义 → 朗读
```

禁止将以下方式作为核心实现：

- 使用一个正则表达式处理嵌套 LaTeX；
- 为每条完整公式建立映射；
- 简单移除 `\`、`{}` 后直接交给 TTS；
- 按字符顺序机械朗读全部公式；
- 对所有未知公式返回同一个占位语。

### 4.2 确定性

同一输入、同一上下文、同一规则版本必须产生完全相同的输出。

禁止核心逻辑依赖：

- LLM；
- 网络；
- 当前时间；
- 随机数；
- 用户界面状态；
- 未声明的全局变量；
- TTS 模型内部的数字规范化。

### 4.3 正确性优先于自然度

优先级必须是：

```text
正确且自然
  >
正确但结构化
  >
静默跳过
  >
错误猜测语义（禁止）
```

### 4.4 单调语义

已冻结的结构化朗读必须满足：未来上下文可以让其含义更具体，但不能证明它当时是错误的。

例如未知语义的：

```latex
|A|
```

安全结构读法：

```text
左竖线 A 右竖线
```

禁止无证据地读成：

```text
A 的绝对值
```

### 4.5 失败必须局部化

一个公式失败时，只跳过该公式，不能：

- 让整句失败；
- 让整段失败；
- 抛出未处理异常；
- 阻塞后续公式；
- 返回原始危险/无意义 LaTeX；
- 返回“来看这个公式”。

---

## 5. 公共 API 合同

### 5.1 主入口

建议导出：

```js
prepareMathSpeech(input)
```

输入结构：

```js
{
  latex: "\\sum_{i=1}^{n} a_i",
  locale: "zh-Hans",
  style: "concise",

  context: {
    precedingText: "",
    currentSentence: "",
    domainHints: [],
    symbolFacts: {}
  },

  limits: {
    maxInputChars: 4096,
    maxAstDepth: 64,
    maxOutputChars: 1200
  }
}
```

### 5.2 成功输出

```js
{
  ok: true,
  version: "math-speech-zh-v1",
  locale: "zh-Hans",
  source: {
    latex: "\\sum_{i=1}^{n} a_i",
    normalizedLatex: "\\sum_{i=1}^{n} a_i"
  },
  ast: {
    type: "summation",
    index: { type: "identifier", name: "i" },
    lower: { type: "number", value: "1" },
    upper: { type: "identifier", name: "n" },
    body: {
      type: "subscript",
      base: { type: "identifier", name: "a" },
      index: { type: "identifier", name: "i" }
    }
  },
  decision: {
    mode: "semantic",
    verbosity: "concise",
    intent: "summation",
    sealed: true,
    unresolvedAmbiguities: [],
    hardBlockers: []
  },
  speech: "从 i 等于一到 n，对 a 下标 i 求和",
  diagnostics: {
    parseOk: true,
    supportedNodes: 7,
    totalNodes: 7,
    nodeCoverage: 1,
    symbolCoverage: 1,
    maxDepth: 3,
    containsRawLatex: false,
    warnings: []
  }
}
```

### 5.3 安全跳过输出

```js
{
  ok: false,
  version: "math-speech-zh-v1",
  decision: {
    mode: "skip",
    verbosity: null,
    intent: null,
    sealed: true,
    unresolvedAmbiguities: [],
    hardBlockers: ["parse-failed"]
  },
  speech: "",
  diagnostics: {
    parseOk: false,
    reason: "parse-failed",
    warnings: []
  }
}
```

### 5.4 输出不变量

所有输出必须满足：

- `speech` 永远是字符串；
- `decision.sealed` 在返回前必须为 `true`；
- `speech` 不得为 `null` 或 `undefined`；
- `skip` 模式必须返回空 `speech`；
- `semantic` 和 `structural` 模式必须返回非空 `speech`；
- 返回对象不得包含可变的外部引用；
- 调用方后续修改 `context.symbolFacts` 不得改变既有结果；
- 推荐对返回对象深冻结，或通过深拷贝保证不可变性。

---

## 6. AST 规范

### 6.1 基础节点

至少支持：

```text
number
identifier
text
operator
row
unary
binary
relation
fraction
root
power
subscript
superscript
subsup
function-call
fenced
summation
product
integral
limit
accent
vector
matrix
piecewise
unknown
```

### 6.2 MathML 映射

至少识别：

```text
math
mrow
mn
mi
mo
mtext
mfrac
msqrt
mroot
msup
msub
msubsup
mover
munder
munderover
mfenced
mtable
mtr
mtd
semantics
annotation
annotation-xml
```

### 6.3 规范化要求

规范化阶段必须：

1. 合并被 MathML 拆开的同一数字，例如 `1,234`。
2. 区分一元负号与二元减号。
3. 识别常用函数调用，例如 `sin(x)`、`log(x)`。
4. 识别隐式乘法，但无证据时不得强行将所有相邻标识符视为乘法。
5. 识别大运算符上下界。
6. 保留原始节点来源，用于诊断。
7. 对未知节点生成 `unknown`，不得静默丢失后仍声称完整覆盖。
8. 计算 AST 深度、节点数、未知节点数。

### 6.4 禁止使用不稳定私有 API

禁止将 KaTeX 未承诺稳定的私有 AST（例如仅供内部使用的解析接口）作为唯一核心合同，除非：

1. 有隔离适配器；
2. 有版本锁定；
3. 有完整快照测试；
4. 有 MathML 回退路径；
5. 在技术决策记录中说明风险。

首选稳定路径：

```js
katex.renderToString(latex, {
  output: "mathml",
  throwOnError: true,
  trust: false,
  strict: "warn",
  maxExpand: 1000
});
```

---

## 7. 符号词典约束

### 7.1 词典职责

词典只负责叶子符号及其角色，不负责完整表达式结构。

建议分类：

```text
greek
relations
arithmetic
sets
logic
calculus
functions
constants
geometry
probability
statistics
accents
delimiters
```

### 7.2 角色化映射

同一符号可能有多个角色，必须以结构上下文决定：

```js
{
  "-": {
    unary: "负",
    binary: "减",
    setDifference: "差"
  },
  "|": {
    delimiter: "竖线",
    conditional: "在……条件下",
    divides: "整除"
  }
}
```

禁止：

```js
{"-": "减", "|": "绝对值"}
```

### 7.3 第一阶段必须覆盖的符号

至少覆盖：

```text
+ − × ÷ · / = ≠ < > ≤ ≥ ≈ ≡ ∝
∞ ± ∓ √ ∑ ∏ ∫ ∂ ∇
∈ ∉ ⊂ ⊆ ⊃ ⊇ ∪ ∩ ∅
∀ ∃ ¬ ∧ ∨ ⇒ ⇔ ⊢ ⊨
→ ← ↔ ↦
α β γ δ ε ζ η θ ι κ λ μ ν ξ ο π ρ σ τ υ φ χ ψ ω
Α Β Γ Δ Ε Ζ Η Θ Ι Κ Λ Μ Ν Ξ Ο Π Ρ Σ Τ Υ Φ Χ Ψ Ω
```

词典必须有单元测试，禁止只靠人工检查。

---

## 8. 依赖管理约束

### 8.1 优先复用现有依赖

仓库已经包含：

```json
"katex": "^0.16.37"
```

必须优先复用，禁止引入 MathJax、Speech Rule Engine、MathCAT 或其他大型数学渲染栈作为当前阶段依赖。

### 8.2 XML/MathML 解析器决策

实现前必须检查现有直接依赖是否提供稳定 XML DOM 解析能力。

禁止依赖某个未声明的传递依赖。

如果确实需要新增解析器，必须：

1. 选择体积小、维护活跃、无网络运行时依赖的库；
2. 将其加入 `resources/server/package.json` 的直接依赖；
3. 说明许可证；
4. 说明为什么不能使用现有依赖；
5. 更新 release runtime manifest；
6. 运行 clean-release/runtime manifest 相关烟测；
7. 不把该依赖打入前端；
8. 不修改前端 bundle。

禁止为了避免新增依赖而手写一个不完整的通用 XML 解析器。

### 8.3 禁止运行时外部服务

核心模块必须离线运行，禁止调用：

- OpenAI；
- DeepSeek；
- Qwen；
- 浏览器服务；
- 远程公式转换服务；
- TTS 服务；
- 任意 HTTP API。

---

## 9. 中文数字规范化

### 9.1 独立模块

数字规范化必须是独立纯函数模块，不得混在公式渲染器的大量分支中。

建议 API：

```js
speakNumber(value, {
  locale: "zh-Hans",
  role: "cardinal"
});
```

支持角色：

```text
cardinal
digits
decimal
negative
percentage
exponent
subscript
ordinal
scientific
```

### 9.2 必须支持的输出

```text
0       → 零
10      → 十
11      → 十一
20      → 二十
101     → 一百零一
1001    → 一千零一
10000   → 一万
10001   → 一万零一
2026    → 二千零二十六
3.14    → 三点一四
-2      → 负二
0012    → 零零一二
25%     → 百分之二十五
10^8    → 十的八次方
10^-3   → 十的负三次方
1.2e-3 → 一点二乘以十的负三次方
```

### 9.3 精度约束

- 大整数必须使用字符串或 `BigInt` 处理；
- 禁止先转为 `Number` 导致精度丢失；
- 小数部分逐位读；
- 前导零序列逐位读；
- 极长数字按安全策略逐位读或跳过，不得产生指数级运算；
- 数字输出必须有长度限制。

### 9.4 普通正文隔离

数字模块只处理 AST 中的数学数字节点。

必须证明不会修改：

```text
HTTP/1.1
GPT-5.6
v4
2026 年
第 12 页
模型 64092
```

---

## 10. 中文结构渲染规则

### 10.1 朗读模式

支持：

```text
semantic + concise
semantic + detailed
structural
skip
```

### 10.2 基础规则示例

```latex
x^2+y^2=z^2
```

```text
x 的平方加 y 的平方，等于 z 的平方
```

```latex
\frac{1}{2}
```

```text
二分之一
```

```latex
\sqrt{x+1}
```

```text
x 加一的平方根
```

```latex
\sqrt[3]{x}
```

```text
x 的立方根
```

```latex
\sum_{i=1}^{n} a_i
```

```text
从 i 等于一到 n，对 a 下标 i 求和
```

```latex
\int_0^1 x^2\,dx
```

```text
从零到一，x 的平方关于 x 的积分
```

```latex
\lim_{x\to 0}\frac{\sin x}{x}=1
```

```text
当 x 趨近于零时，正弦 x 除以 x 的极限等于一
```

### 10.3 详细模式

当分子分母、根式或嵌套结构存在听觉边界风险时，必须切换到详细模式。

例如：

```latex
\frac{\sqrt{x^2+1}}{a-b}
```

推荐：

```text
一个分数，分子是 x 的平方加一的平方根，分母是 a 减 b，分数结束
```

禁止为了追求简短而产生无法判断边界的朗读。

### 10.4 矩阵策略

- 2×2、3×3 矩阵可以逐行读；
- 超过 3×3 默认只读维度和类型；
- 分段函数按“第一个条件、第二个条件”读；
- 超大表格或未知对齐环境应安全跳过；
- 不得一次生成超长 TTS 文本。

---

## 11. 语义歧义处理

### 11.1 证据优先级

从高到低：

1. 明确的 MathML `intent`；
2. 明确、无歧义的 LaTeX 命令，例如 `\det(A)`；
3. 当前句子中的显式定义；
4. 当前作用域中有来源的符号事实；
5. 公式自身的结构约束；
6. 教材领域提示；
7. 猜测（禁止用于最终自然语义）。

### 11.2 符号事实合同

```js
{
  A: {
    type: "set",
    evidence: "explicit",
    sourceText: "设 A 为有限集合",
    sourceMessageId: "msg-17",
    scopeId: "lesson-section-2",
    supersedes: null
  }
}
```

只有明确陈述可以产生 `explicit` 事实。

领域提示只能产生 `hint`，不能单独消除关键歧义。

### 11.3 必测歧义

```text
|A|       绝对值 / 基数 / 行列式
f^{-1}    逆函数 / 倒数 / 负一次幂
(a,b)     有序对 / 开区间
[a,b]     闭区间 / 矩阵行 / 交换子
AB        隐式乘法 / 线段名 / 矩阵乘积
dx        普通变量 / 微分项
P(A|B)    条件概率 / 普通竖线结构
-x        一元负号
a-b       二元减法
A-B       可能的集合差
```

### 11.4 无法消歧时的稳定结构读法

```text
|A|       → 左竖线 A 右竖线
f^{-1}    → f 上标负一
(a,b)     → 左圆括号 a 逗号 b 右圆括号
[a,b]     → 左方括号 a 逗号 b 右方括号
AB        → A B
dx        → d x
```

结构化读法是最终安全结果，不是临时错误。

---

## 12. 语义冻结

### 12.1 冻结原则

核心函数返回前必须冻结决定。

```js
{
  decision: {
    sealed: true,
    mode: "structural"
  },
  speech: "左竖线 A 右竖线，等于五"
}
```

之后即使调用方更新符号事实，也不得改变返回结果。

### 12.2 必测时序

第一次：

```js
const first = prepareMathSpeech({
  latex: "|A|=5",
  context: { symbolFacts: {} }
});
```

必须得到：

```text
左竖线 A 右竖线，等于五
```

更新未来上下文：

```js
symbolFacts.A = {
  type: "set",
  evidence: "explicit"
};
```

必须满足：

```js
first.speech === "左竖线 A 右竖线，等于五"
```

未来新公式：

```latex
|A|+1
```

可以得到：

```text
集合 A 的基数加一
```

### 12.3 禁止的副作用

核心模块禁止：

- 保存或覆盖音频；
- 请求重新播放；
- 修改历史消息；
- 修改前端缓存键；
- 自动生成“修正版”；
- 返回 UI 指令。

---

## 13. 安全降级

### 13.1 硬性阻断条件

以下情况直接 `skip`：

- KaTeX 解析失败；
- 未闭合结构；
- 未知宏可能改变语义；
- 存在未消费的原始 LaTeX 控制命令；
- AST 深度超过限制；
- 输入长度超过限制；
- 输出长度超过限制且无法安全压缩；
- 节点数量异常；
- 矩阵/表格规模超限；
- 解析结果为空；
- 解析结果与输入的关键操作数数量明显不一致。

### 13.2 禁止占位语

所有测试必须禁止：

```text
这个公式
来看这个公式
请看公式
公式如下
```

注意：普通正文中由作者自然写出的“公式如下”不属于核心生成结果；测试针对核心自己添加的占位语。

### 13.3 禁止原始控制符泄漏

成功输出不得包含：

```text
\frac
\sqrt
\sum
\int
\unknowncommand
$$
裸花括号
未处理的反斜杠命令
```

---

## 14. 复杂度与性能保护

默认限制建议：

```text
最大输入长度：4096 字符
最大 AST 深度：64
最大 AST 节点：2000
最大矩阵逐项朗读：3×3
最大输出长度：1200 字符
KaTeX maxExpand：1000
```

必须防止：

- 指数级递归；
- 循环引用；
- 恶意宏扩展；
- 超长错误信息进入输出；
- 大矩阵生成数千字朗读；
- 深层嵌套导致栈溢出。

性能目标（开发机、进程已启动、单公式）：

```text
P50 ≤ 10 ms
P95 ≤ 30 ms
普通公式不得超过 200 ms
```

如硬件或 KaTeX 基线无法达到，必须提交真实基线和原因，不得篡改测试或隐瞒结果。

---

## 15. 测试驱动开发流程

### 阶段 0：基线与调查

1. 读取 `AGENTS.md`。
2. 记录 `git status --short`。
3. 检查现有 `4137` 公式处理逻辑，只读，不修改。
4. 检查兄弟工作副本中的相关实现。
5. 确认 KaTeX 版本和运行位置。
6. 运行相关现有 TTS 烟测，记录基线。
7. 输出简短技术决策记录。

### 阶段 1：合同和失败测试

先编写：

- API 合同测试；
- 数字失败测试；
- 基础公式失败测试；
- 歧义失败测试；
- 冻结失败测试；
- malformed 输入失败测试；
- 禁止占位语测试。

必须先看到测试因功能缺失而失败，再实现代码。

### 阶段 2：LaTeX → MathML

1. 封装 KaTeX；
2. 限制输入和宏扩展；
3. 关闭 `trust`；
4. 对解析错误返回结构化诊断；
5. 不抛出未处理异常。

### 阶段 3：MathML → AST

1. 实现节点转换；
2. 保留源节点信息；
3. 生成未知节点诊断；
4. 计算覆盖率和深度；
5. 添加每类节点的单元测试。

### 阶段 4：数字模块

1. 实现字符串/BigInt 整数；
2. 实现小数；
3. 实现前导零；
4. 实现百分数；
5. 实现科学记数法；
6. 添加极端长度限制；
7. 验证普通正文隔离。

### 阶段 5：词典和基础渲染

1. 希腊字母；
2. 关系符号；
3. 四则运算；
4. 集合与逻辑；
5. 常用函数；
6. 上下标；
7. 分数、根号、幂。

### 阶段 6：高阶结构

1. 极限；
2. 求和；
3. 求积；
4. 积分；
5. 矩阵；
6. 分段函数；
7. 向量与重音符号。

### 阶段 7：歧义与符号作用域

1. 实现证据优先级；
2. 实现显式符号事实；
3. 实现作用域覆盖；
4. 实现冲突时回退结构读法；
5. 禁止领域提示单独消歧；
6. 完成歧义黄金测试。

### 阶段 8：冻结与不可变性

1. 返回结果冻结；
2. 测试调用方修改上下文不会改写旧结果；
3. 测试未来公式使用新事实；
4. 禁止历史结果回写。

### 阶段 9：语料、性能与异常

1. 完成至少 200 条黄金语料；
2. 执行全量精确比较；
3. 执行 malformed/fuzz 边界测试；
4. 执行确定性测试；
5. 执行性能基准；
6. 输出覆盖率报告。

### 阶段 10：最终审计

1. 检查所有变更文件；
2. 检查无前端文件被修改；
3. 检查无敏感文件被修改；
4. 运行完整验收矩阵；
5. 阅读全部输出；
6. 生成最终报告；
7. 停止，不进入前端阶段。

---

## 16. 黄金语料最低要求

总数不得少于 200，推荐 230–260。

| 类别 | 最低数量 |
|---|---:|
| 基础代数 | 50 |
| 分数、根号、幂 | 30 |
| 微积分 | 30 |
| 集合与逻辑 | 25 |
| 概率统计 | 20 |
| 线性代数 | 20 |
| 数字与科学记数法 | 25 |
| 歧义、错误与极端输入 | 30 |

每条语料建议结构：

```json
{
  "id": "calculus-sum-001",
  "latex": "\\sum_{i=1}^{n} a_i",
  "locale": "zh-Hans",
  "style": "concise",
  "context": {
    "precedingText": "",
    "currentSentence": "",
    "symbolFacts": {}
  },
  "expected": {
    "ok": true,
    "mode": "semantic",
    "speech": "从 i 等于一到 n，对 a 下标 i 求和",
    "unresolvedAmbiguities": []
  }
}
```

错误语料必须指定：

```json
{
  "id": "malformed-frac-001",
  "latex": "\\frac{",
  "expected": {
    "ok": false,
    "mode": "skip",
    "speech": "",
    "reason": "parse-failed"
  }
}
```

---

## 17. 验收指标

### 17.1 必须全部通过

- 核心基础公式：100% 精确通过；
- 数字模块：100% 精确通过；
- 歧义保护：100% 不武断消歧；
- 冻结测试：100% 通过；
- malformed 输入：100% 无未处理异常；
- 安全跳过：100% 返回空语音；
- 禁止占位语：0 次；
- 原始 LaTeX 泄漏：0 次；
- 同输入非确定输出：0 次；
- 前端文件修改：0 个；
- 敏感文件修改：0 个。

### 17.2 质量指标

最重要指标：

```text
错误语义朗读数量 = 0
```

其次：

```text
自然语义覆盖率
结构化降级率
安全跳过率
未知节点分布
平均/P95 耗时
```

禁止通过降低测试要求、删除失败用例或修改期望值来“提高通过率”。

---

## 18. 必须运行的验证命令

根据最终文件名调整，但必须包含以下类型：

```bash
node resources/server/lib/math-speech/math-speech-smoke-test.js
node resources/server/lib/math-speech/math-speech-corpus-test.js
node resources/server/lib/math-speech/math-speech-number-test.js
node resources/server/lib/math-speech/math-speech-ambiguity-test.js
node resources/server/lib/math-speech/math-speech-malformed-test.js
node resources/server/lib/math-speech/math-speech-determinism-test.js
node resources/server/lib/math-speech/math-speech-benchmark.js
```

对每个新增/编辑的 `.js` 文件运行：

```bash
node --check <file>
```

对关键文件运行 acorn：

```bash
node -e "const a=require('acorn');a.parse(require('fs').readFileSync('<file>','utf8'),{ecmaVersion:2022})"
```

如果新增服务端依赖或 runtime 文件，还必须运行：

```bash
node resources/server/lib/release-runtime-manifest-smoke-test.js
node tools/generate-release-runtime-manifest.js --check
```

如仓库命令参数与实际脚本不同，先读取脚本说明，不得猜测参数。

最后运行：

```bash
git diff --check
git status --short
```

必须阅读完整输出并报告真实失败，不能只报告退出码。

---

## 19. 前端准入门

当前状态：

```text
CLOSED
```

只有同时满足以下条件，才可以向用户申请进入前端阶段：

1. 核心 API 稳定；
2. 所有必测类别完成；
3. 黄金语料达到最低数量；
4. 基础、数字、歧义、冻结、异常测试全部通过；
5. 错误语义朗读为零；
6. 输出无占位语、无原始 LaTeX；
7. 性能报告完成；
8. 已知限制完成；
9. 用户审阅并明确同意；
10. 另行制定前端接入方案。

即使全部通过，执行模型也不得自动进入前端开发，必须停止并等待用户授权。

---

## 20. 后续任务（当前禁止实现）

以下仅记录，不属于当前任务：

### 后续 A：只接入语义核心

- 将核心结果接入 `prepareForSpeech`；
- 保持普通文本与旁白过滤不回归；
- 维持 TTS 串行播放；
- 处理完整句语义提交点；
- 验证零音频片段；
- 同步所有运行 bundle。

### 后续 B：语音版本模型

- 为已冻结公式读法建立版本键；
- 区分实时语音与历史缓存；
- 定义规则版本迁移；
- 禁止静默覆盖。

### 后续 C：重新生成语音

- 用户显式触发；
- 不自动反悔已播放内容；
- 新旧版本可追踪；
- 明确 UI 状态；
- 失败不破坏旧缓存。

### 后续 D：前端交互

- 按钮；
- 提示；
- 进度；
- 取消；
- 重试；
- 无障碍文本。

这些任务必须在新的用户授权和新的开发规范下执行。

---

## 21. Git 与工作区约束

1. 工作区很可能已有大量用户改动，必须保留。
2. 禁止使用：

   ```text
   git reset --hard
   git checkout -- <file>
   git clean -fd
   ```

3. 禁止删除未知文件。
4. 只修改本任务明确范围内的文件。
5. 如果目标文件已有用户改动，必须先检查差异并围绕其工作。
6. 不得因为格式化工具重写整个大型文件。
7. 临时文件放入 `tmp/` 或 `outputs/`。
8. 不得提交，除非用户明确要求。
9. 若用户要求提交，提交主题必须简洁、祈使式并只描述数学语义核心。

---

## 22. 编码约束

- CommonJS，匹配仓库服务端风格；
- 两空格缩进；
- camelCase；
- 模型/类使用 PascalCase；
- 纯函数优先；
- 公共合同使用 JSDoc；
- 不使用 `eval` 或 `new Function`；
- 不执行公式中的任意代码；
- KaTeX `trust:false`；
- 不允许任意用户宏无限展开；
- 错误对象必须有稳定 `code`；
- 诊断中不得包含超长原文；
- 日志不得打印用户整段对话；
- 不使用环境相关绝对路径；
- 测试不得依赖正在运行的 Socratopia；
- 测试不得依赖网络；
- 测试不得依赖本地 TTS 服务。

---

## 23. 错误代码建议

稳定代码至少包括：

```text
invalid_input
input_too_long
katex_parse_failed
mathml_parse_failed
empty_ast
unsupported_node
unknown_semantic_macro
ast_too_deep
ast_too_large
matrix_too_large
output_too_long
raw_latex_remaining
unresolved_critical_ambiguity
internal_invariant_failed
```

错误代码用于测试和诊断，面向用户的文本由未来接入层决定。

---

## 24. 完成报告模板

最终回复必须按以下结构报告：

```markdown
# 数学公式语义化核心完成报告

## 结果
- 当前阶段是否完成：
- 前端准入门：CLOSED
- 错误语义朗读数量：

## 变更文件
- ...

## 支持范围
- ...

## 测试结果
- 基础公式：x/x
- 数字：x/x
- 歧义：x/x
- 冻结：x/x
- malformed：x/x
- 总语料：x

## 性能
- P50：
- P95：
- 最大值：

## 降级统计
- semantic：
- structural：
- detailed：
- skip：

## 已知限制
- ...

## 验证命令
- command → result

## 前端审计
- 前端文件修改数：0
- 是否实现重新生成语音：否

## 后续建议
- 仅建议，不执行
```

禁止使用“应该通过”“理论上没问题”等措辞代替真实验证。

---

## 25. 停止条件

遇到以下情况必须停止扩展实现并报告：

1. 完成任务必须修改前端文件；
2. 完成任务必须修改 Electron 主进程或 ASAR；
3. 需要新增大型依赖；
4. 需要联网运行时服务；
5. 需要 LLM 才能达到基本正确性；
6. 现有用户改动与目标文件直接冲突，且无法安全合并；
7. 同一根因已经连续三次修复失败；
8. 测试表明当前架构无法保证零武断误读；
9. 发现可能泄露敏感数据；
10. 用户要求改变范围。

停止时必须提供：

- 已完成部分；
- 阻塞证据；
- 受影响文件；
- 可选方案；
- 推荐方案；
- 需要用户决定的具体问题。

---

## 26. 最终执行清单

### 开始前

- [ ] 已完整阅读 `AGENTS.md`
- [ ] 已检查 Git 状态
- [ ] 已检查兄弟工作副本
- [ ] 已记录基线测试
- [ ] 已确认未触碰前端

### 合同

- [ ] 主 API 已定义
- [ ] 成功/失败结果已定义
- [ ] 错误代码已定义
- [ ] 不变量已定义
- [ ] 冻结语义已定义

### 实现

- [ ] KaTeX 适配器
- [ ] MathML 解析
- [ ] AST 规范化
- [ ] 符号词典
- [ ] 数字规范化
- [ ] 中文结构渲染
- [ ] 歧义消除
- [ ] 符号作用域
- [ ] 安全降级
- [ ] 诊断信息
- [ ] 深冻结/不可变性

### 测试

- [ ] 基础公式测试
- [ ] 数字测试
- [ ] 歧义测试
- [ ] 冻结测试
- [ ] malformed 测试
- [ ] 确定性测试
- [ ] 输出不变量测试
- [ ] 性能测试
- [ ] 至少 200 条黄金语料

### 审计

- [ ] `node --check` 全部通过
- [ ] acorn 全部通过
- [ ] 相关烟测全部通过
- [ ] runtime manifest 验证通过（如适用）
- [ ] `git diff --check` 通过
- [ ] 前端文件修改数为 0
- [ ] 敏感文件修改数为 0
- [ ] 未实现重新生成语音
- [ ] 未自动进入后续任务

---

## 27. 交给 GPT-5.6-luna 的最终任务描述

请在 `E:\huanjing\sogeladi\Socratopia` 中严格按照本文档实现数学公式语义化核心。

你必须先阅读 `AGENTS.md`，检查当前脏工作区并保护所有无关用户改动。你只能实现独立的服务端/共享数学语义核心、测试、语料、基准和文档。禁止修改任何前端 bundle、React 页面、TTS 播放逻辑、音频缓存、重播按钮、重新生成语音功能、Electron 主进程或 ASAR。

你的核心目标是：使用现有 KaTeX 将 LaTeX 转为 MathML，再转换为规范化 AST，通过中文符号词典、结构规则、上下文消歧、数字规范化和语义冻结，产生确定、可审计的中文数学朗读文本。无法安全消歧时必须使用单调安全的结构读法；解析失败或存在硬性风险时必须返回空语音并安全跳过。禁止生成“这个公式”“来看这个公式”，禁止使用 LLM 或网络完成运行时转换。

你必须采用测试驱动流程，建立不少于 200 条黄金语料，覆盖基础代数、分数根号幂、微积分、集合逻辑、概率统计、线性代数、数字、歧义和异常输入。错误语义朗读数量必须为零。完成后运行所有语法、烟测、语料、歧义、冻结、异常、确定性和性能验证，报告真实输出，并确认前端准入门仍为 `CLOSED`。完成当前阶段后停止工作，等待用户明确授权，禁止自动进入前端接入或重新生成语音阶段。

