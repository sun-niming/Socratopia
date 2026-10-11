# Socratopia 数学公式语义化核心独立验收规范

> 验收模型：GPT-5.6-terra<br>
> 推理强度：Max<br>
> 仓库：`E:\huanjing\sogeladi\Socratopia`<br>
> 被验收对象：数学公式语义化核心<br>
> 开发规范：`MATH_SPEECH_CORE_DEVELOPMENT_SPEC.md`<br>
> 验收角色：独立审计者，不是修复者<br>
> 前端准入状态：**关闭（CLOSED）**<br>
> 文档日期：2026-09-02

---

## 0. 给 GPT-5.6-terra Max 的执行指令

你是本任务的独立验收者。你的职责是收集证据、复现结果、审查设计、独立构造反例，并对数学公式语义化核心作出严格裁决。

你不是本轮开发者。默认不得修改实现、测试期望、黄金语料、前端、运行包或产品配置。发现问题时必须记录证据并给出整改要求，不得顺手修复后再宣称通过。

开始验收前必须完整阅读：

1. 根目录 `AGENTS.md`；
2. `MATH_SPEECH_CORE_DEVELOPMENT_SPEC.md`；
3. 本验收规范；
4. 开发者完成报告、测试报告和性能报告；
5. 全部实现、测试和黄金语料；
6. 当前 Git 状态及开发开始前的基线证据。

最终裁决只能是：

```text
PASS
FAIL
BLOCKED
```

禁止使用：

```text
基本通过
大致可用
有条件通过
应该通过
建议通过
```

- `PASS`：所有硬门槛都有本次验收新鲜、可复现的证据。
- `FAIL`：已有充分证据证明至少一个硬门槛不满足。
- `BLOCKED`：缺少不可替代基线或环境完全无法执行，导致不能形成可靠裁决。真实缺陷不能用 `BLOCKED` 代替 `FAIL`。

无论裁决为何，验收完成后必须停止。不得接入前端、修改 TTS、修改缓存、实现重新生成语音、打开前端准入门或代替用户授权下一阶段。

---

## 1. 验收目标

验收必须回答：

1. 实现是否严格符合开发规范，而非只让自带测试通过；
2. 是否确实采用 `LaTeX → KaTeX → MathML → AST → 规则渲染`；
3. 是否由结构、符号角色、数字角色和显式上下文产生中文读法；
4. 无法确认的语义是否安全结构化，而非猜测；
5. 已冻结结果是否不可被未来上下文回写；
6. malformed、超长、超深和未知命令是否局部失败；
7. 是否彻底消除核心主动生成的占位语和原始 LaTeX 泄漏；
8. 测试能否真实发现实现缺陷；
9. 性能、安全、确定性、离线性是否达标；
10. 是否触碰禁止的前端、Electron、ASAR 或敏感文件；
11. 是否具备“申请前端接入评审”的资格。

通过本验收不等于前端已获准修改。

---

## 2. 权威来源与冲突处理

优先级：

1. 用户明确要求；
2. `AGENTS.md`；
3. `MATH_SPEECH_CORE_DEVELOPMENT_SPEC.md`；
4. 本验收规范；
5. 开发者技术决策记录；
6. 开发完成报告；
7. 代码注释。

发生冲突时：

- 更高优先级生效；
- 更严格且不扩大权限的约束优先；
- 禁止范围优先于便利性；
- 无法判断时 `BLOCKED`，不得自行放宽。

开发规范写“总语料不少于 200”，但分类下限总和为：

```text
50 + 30 + 30 + 25 + 20 + 20 + 25 + 30 = 230
```

因此硬门槛为：总数不少于 230，且各分类分别达到下限。

---

## 3. 验收者权限边界

### 3.1 允许

- 阅读文件、Git 状态和差异；
- 运行语法、烟测、语料、性能及只读诊断；
- 在 `outputs/math-speech-acceptance/` 写验收报告；
- 在系统临时目录创建独立测试和故障注入副本；
- 构造额外黑盒输入；
- 统计覆盖、模式、性能和重复率；
- 读取依赖许可证和元数据。

### 3.2 禁止

- 修改核心实现；
- 修改测试或期望；
- 修改黄金语料；
- 删除或跳过失败用例；
- 降低门槛；
- 修改前端、Electron、ASAR 或 TTS 服务；
- 修改 `resources/settings.json`、`resources/set.json`；
- 调用 LLM 生成运行时读法；
- 提交 Git commit；
- 回滚或清理用户工作区；
- 修复后在同一轮宣称独立通过。

### 3.3 发现失败后的行为

发现硬失败后仍应完成其余安全验收，集中收集缺陷；最终判定 `FAIL`，给出最小复现和整改条件，不改代码。

---

## 4. 被验收物清单

验收者必须从文件系统和 Git 差异自行建立清单，不能只复制开发者报告。至少包括：

```text
resources/server/lib/math-speech/**
resources/server/package.json（如有改动）
resources/server/release-runtime-manifest.json（如有改动）
技术决策记录
开发完成报告
全部测试
全部 corpus/fixtures
性能与覆盖报告
```

目录结构可以不同，但职责必须隔离。若核心被直接塞入前端 bundle 或大型既有 bundle，直接 `FAIL`。

---

## 5. 脏工作区与基线审计

必须区分：

```text
开发开始前已有改动
本次数学语义核心新增改动
验收者新增报告
```

归因证据优先级：

1. 开发前文件哈希；
2. 开发前 `git status --short`；
3. 开发线程明确记录；
4. 可验证内容差异；
5. 时间戳仅作辅助。

“前端零改动”指相对开发前基线，本次开发没有新增前端改动。不能因前端原本已脏直接失败，也不能因此默认本次未继续修改。

若无可信基线：完成功能验收，但范围审计标记为无法证明，最终 `BLOCKED`，不得 `PASS`。

---

## 6. 硬门槛总表

| 门槛 | 通过条件 | 不满足 |
|---|---|---|
| 范围 | 仅核心、测试、语料、报告和必要依赖 | FAIL |
| 前端 | 相对基线新增修改为 0 | FAIL/BLOCKED |
| 敏感文件 | 本次修改为 0 | FAIL |
| 架构 | KaTeX → MathML → AST → 规则 | FAIL |
| 运行时 LLM/网络 | 0 次依赖 | FAIL |
| API | 合同和不变量全部满足 | FAIL |
| 基础公式 | 规定用例 100% 精确通过 | FAIL |
| 数字 | 规定用例 100% 精确通过 | FAIL |
| 歧义 | 武断误读 0 个 | FAIL |
| 冻结 | 历史结果回写 0 个 | FAIL |
| malformed | 未处理异常 0 个 | FAIL |
| 占位语 | 核心生成 0 次 | FAIL |
| LaTeX 泄漏 | 0 次 | FAIL |
| 确定性 | 同输入差异 0 次 | FAIL |
| 语料 | 总数 ≥230 且分类达标 | FAIL |
| 性能 | 达到规范或有用户批准豁免 | FAIL |
| 安全 | 全部边界生效 | FAIL |
| 测试可信度 | 故障注入时能失败 | FAIL |
| 文档 | 报告和证据完整 | FAIL |

任何硬门槛失败，最终不能 `PASS`。

---

## 7. 静态范围审计

### 7.1 禁止路径

相对开发前基线，以下不得出现本任务新增修改：

```text
resources/server/.next/static/chunks/**
resources/server/.next/server/app/page.js
resources/server/.next/server/app/index*
resources/server/.next/server/app/index.segments/**
win-unpacked/resources/server/.next/static/chunks/**
main.js
preload.js
resources/app.asar
_asar_extracted/**
```

### 7.2 敏感路径

```text
resources/settings.json
resources/set.json
win-unpacked/resources/settings.json
win-unpacked/resources/set.json
```

### 7.3 危险行为搜索

在新增核心中搜索并人工审查：

```text
fetch(
http://
https://
OpenAI
DeepSeek
Qwen
chat/completions
eval(
new Function
child_process
exec(
spawn(
Date.now
Math.random
process.env
global.
```

命中不一定自动失败，但核心中的网络、随机性、任意执行或未声明全局依赖属于失败。

### 7.4 架构反模式

以下任一出现即 `FAIL`：

- 大正则解析任意嵌套 LaTeX；
- 巨型完整公式映射表；
- 删除反斜杠和花括号后直接朗读；
- 所有 `|x|` 默认绝对值；
- 所有 `-` 默认减号；
- 普通正文全局数字替换；
- 未知结构仍 `ok:true`；
- 只有模糊分数而无硬阻断；
- 失败回退到“这个公式”；
- 运行时调用 LLM；
- 吞掉未知节点后声称完整覆盖。

---

## 8. 依赖与供应链审计

### 8.1 KaTeX

确认：

- 使用已有直接依赖；
- 版本与 package 一致；
- `trust:false`；
- 严格解析失败；
- `maxExpand` 有界；
- 用户宏不能无限展开；
- 使用稳定 MathML 输出；
- 服务端离线可运行。

### 8.2 新增依赖

若新增 XML/MathML 解析器，确认：

- 是直接依赖；
- 许可证可接受；
- 无运行时网络；
- 无未说明平台绑定；
- 未打入前端；
- runtime manifest 已更新；
- clean-release/runtime smoke 通过；
- 有选择理由。

未经用户批准引入 MathJax、Speech Rule Engine、MathCAT 或大型浏览器栈，直接 `FAIL`。

---

## 9. 测试可信度审计

### 9.1 伪测试检查

禁止：

- 从实现映射表生成期望；
- 实现和测试共享同一 oracle；
- 只检查非空或不崩溃；
- 快照未经人工审阅；
- 用例被 skip/todo；
- 捕获断言后仍退出 0；
- 基准无阈值；
- 分类只靠文件名。

### 9.2 故障注入

必须在临时副本或 monkey patch 中证明测试能发现：

1. 删除关系符号映射；
2. 未知命令被错误标记成功；
3. 取消深冻结；
4. `|A|` 默认绝对值；
5. 输出残留 `\frac`；
6. 返回“来看这个公式”。

故障注入不得修改工作区产品文件。任一故障未被测试发现，测试可信度失败。

### 9.3 退出码

每个测试成功退出 0，断言失败或异常必须非 0。不能仅从日志文本判断成功。

---

## 10. API 合同验收

验收主入口，例如：

```js
prepareMathSpeech(input)
```

### 10.1 输入边界

覆盖：缺少/非字符串/空 `latex`、非法 locale/style、缺少 context、恶意原型对象、非法 limits 和额外可执行字段。

### 10.2 成功合同

```text
ok === true
version 为稳定字符串
source 存在
ast 存在
decision.mode ∈ semantic/structural/detailed
decision.sealed === true
speech 为非空字符串
diagnostics.parseOk === true
```

### 10.3 跳过合同

```text
ok === false
decision.mode === "skip"
decision.sealed === true
speech === ""
diagnostics.reason 为稳定代码
```

### 10.4 不可变性

证明：修改输入、原始 `symbolFacts` 或返回对象不会污染既有结果、缓存或其他调用；不同调用不共享可变 AST。

---

## 11. AST 结构验收

### 11.1 必须支持

```text
number identifier text operator row unary binary relation
fraction root power subscript superscript subsup function-call
fenced summation product integral limit accent vector matrix
piecewise unknown
```

### 11.2 MathML 覆盖

```text
math mrow mn mi mo mtext mfrac msqrt mroot msup msub
msubsup mover munder munderover mfenced mtable mtr mtd
semantics annotation annotation-xml
```

### 11.3 人工 AST 抽检

至少 30 个：基础代数、分根幂、微积分、集合逻辑、矩阵分段、歧义异常各 5 个。必须确认不是错误 AST 碰巧得到正确文本。

未知节点必须保留诊断、影响覆盖率并触发安全降级，不能静默删除。

---

## 12. 数字模块验收

### 12.1 强制精确用例

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

### 12.2 独立边界

至少新增 30 条，包含 100、110、1000、1010、100000001、超大整数、0.001、-0.5、0000、0007、0%、100%、1e9、6.02e23。

### 12.3 普通正文隔离

不得改写：

```text
HTTP/1.1
GPT-5.6
v4
2026 年
第 12 页
模型 64092
IPv4
Windows 11
```

超出安全整数范围必须用字符串或 `BigInt`。精度丢失直接 `FAIL`。

---

## 13. 基础数学朗读验收

最低集合：

| LaTeX | 模式 | 核心读法 |
|---|---|---|
| `x+1` | semantic | x 加一 |
| `a-b` | semantic | a 减 b |
| `-x` | semantic | 负 x |
| `x=2` | semantic | x 等于二 |
| `x\ne0` | semantic | x 不等于零 |
| `x\le y` | semantic | x 小于等于 y |
| `x^2` | semantic | x 的平方 |
| `x^3` | semantic | x 的立方 |
| `x^n` | semantic | x 的 n 次方 |
| `a_i` | semantic | a 下标 i |
| `\frac{1}{2}` | semantic | 二分之一 |
| `\sqrt{x}` | semantic | x 的平方根 |
| `\sqrt[3]{x}` | semantic | x 的立方根 |
| `\sin x` | semantic | 正弦 x |
| `\log_2x` | semantic | 以二为底 x 的对数 |
| `x^2+y^2=z^2` | semantic | x 的平方加 y 的平方，等于 z 的平方 |

标点可以由合同统一规定，但不能同时接受互相矛盾的结果。

---

## 14. 高阶结构验收

### 14.1 求和

```latex
\sum_{i=1}^{n}a_i
```

期望：“从 i 等于一到 n，对 a 下标 i 求和”。

### 14.2 积分

```latex
\int_0^1x^2\,dx
```

期望：“从零到一，x 的平方关于 x 的积分”。

### 14.3 极限

```latex
\lim_{x\to0}\frac{\sin x}{x}=1
```

必须表达 x 趋近零、正弦 x 除以 x、极限等于一。

### 14.4 复杂分数

```latex
\frac{\sqrt{x^2+1}}{a-b}
```

必须用边界明确的 detailed 模式，不能产生歧义短句。

### 14.5 矩阵和分段函数

- 2×2、3×3 可逐行读；
- 大于 3×3 默认只读类型和维度；
- 超大矩阵不得生成超长文本；
- 分段函数必须表达分支与条件；
- 行列式不得仅凭竖线外观判断。

---

## 15. 语义歧义验收

任何武断误读直接 `FAIL`。

### 15.1 `|A|`

- 无上下文：`左竖线 A 右竖线`；
- 明确 A 是有限集合：`集合 A 的基数`；
- 明确 A 是矩阵：`矩阵 A 的行列式`；
- 明确 x 是实数：`x 的绝对值`。

无上下文禁止猜任何自然语义。

### 15.2 其他必测

```text
f^{-1}  → 无上下文只能 f 上标负一
(a,b)   → 无上下文不能默认有序对或开区间
[a,b]   → 无上下文不能默认闭区间
P(A|B)  → 仅有概率证据才读条件概率
AB      → 无证据不能插入“乘以”
dx      → 仅积分结构中识别微分项
```

“矩阵章节”等领域提示不能单独消除关键歧义。

### 15.3 独立歧义集

开发语料之外至少 40 条，覆盖缺少/显式/冲突上下文、旧作用域、新作用域、仅领域提示、大小写变量和同名重定义。

---

## 16. 符号事实与作用域验收

只有“设 A 为有限集合”“令 M 是矩阵”“假设 x 是实数”等明确陈述可产生高置信事实。不得因大写变量猜集合或矩阵。

至少验证当前公式、句子、回复、知识点和课堂五类作用域；近作用域显式定义优先。

重定义场景必须满足：新公式用新语义，旧公式不变，事实保留来源与覆盖关系，不全局污染。

同作用域冲突事实必须结构化或 skip，不得随机选择。

---

## 17. 语义冻结验收

执行：

```js
const symbolFacts = {};
const first = prepareMathSpeech({
  latex: "|A|=5",
  locale: "zh-Hans",
  context: { symbolFacts }
});
symbolFacts.A = { type: "set", evidence: "explicit" };
```

必须满足：

```js
first.decision.sealed === true
first.speech === "左竖线 A 右竖线，等于五"
```

未来新调用可以读“集合 A 的基数加一”。

必须测试修改 `speech`、AST、decision、ambiguities 和 diagnostics 不会污染内部缓存或其他调用。

若有缓存，键必须区分 LaTeX、locale、style、相关符号事实、作用域/intent、规则版本和影响结果的 limits。上下文串用直接 `FAIL`。

---

## 18. 安全降级与错误代码验收

### 18.1 malformed

至少：

```latex
\frac{
\sqrt{
x^{
\unknowncommand{x}
\begin{matrix}1&2
$$
{
}
```

### 18.2 资源攻击

超长输入、深层分数、深层上下标、巨大矩阵、宏扩展、大量未知命令、Unicode 组合字符、NUL、双向控制符和原型污染键。

### 18.3 预期

```text
不崩溃、不挂起、不联网、不执行代码
稳定错误代码
decision.mode === skip
decision.sealed === true
speech === ""
```

核对规范错误代码：`invalid_input`、`input_too_long`、`katex_parse_failed`、`mathml_parse_failed`、`empty_ast`、`unsupported_node`、`unknown_semantic_macro`、`ast_too_deep`、`ast_too_large`、`matrix_too_large`、`output_too_long`、`raw_latex_remaining`、`unresolved_critical_ambiguity`、`internal_invariant_failed`。

---

## 19. 输出不变量验收

对全部 `ok:true` 批量检查。

### 19.1 占位语必须为 0

```text
这个公式
来看这个公式
请看公式
公式如下
```

### 19.2 原始 LaTeX 泄漏必须为 0

```text
\frac
\sqrt
\sum
\int
\unknowncommand
$$
未消费控制序列
裸结构花括号
```

### 19.3 其他质量不变量

不得出现成功空字符串、`undefined/null/NaN`、异常重复、无边界复杂结构、控制字符、HTML/XML 标签或超限输出。

---

## 20. 确定性验收

1. 至少 100 条输入，每条重复 100 次；
2. 三个独立 Node 进程重复；
3. 用例顺序随机重排五次；
4. 并发运行集合 A 与矩阵 A 等不同上下文；
5. 改变无关时区、时间和环境变量。

稳定字段包括 `ok`、`version`、AST、decision、speech 和错误代码。任何差异直接 `FAIL`。

---

## 21. 黄金语料审计

### 21.1 分类下限

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

总数至少 230。

### 21.2 去重

不能靠改 ID、空格、无意义变量名、跨文件重复或复制错误用例虚增数量。统计原始总数、规范化 LaTeX 唯一数、语义结构唯一数、分类唯一数和重复率。

### 21.3 人工审阅

每类至少 20%，且所有歧义、冻结、detailed、skip 和 known limitations 均审阅；总数不少于 60。

语料不得包含真实用户对话、API Key、个人路径或隐私。

---

## 22. 独立黑盒验收集

Terra 必须在开发语料之外临时建立至少 80 条：

| 类别 | 数量 |
|---|---:|
| 基础结构组合 | 15 |
| 数字边界 | 10 |
| 微积分组合 | 10 |
| 集合与逻辑 | 10 |
| 矩阵与分段 | 10 |
| 歧义与作用域 | 15 |
| malformed/攻击 | 10 |

不能简单复制开发语料，要组合结构、覆盖边界、同形不同义、大小写希腊字母、中文 `\text{}`、前导零、超大整数和矩阵阈值。

任何错误数学语义均为硬失败。

---

## 23. 中文语言质量审计

检查运算顺序、括号、分子分母、根号、上下标、积分变量、求和上下界、极限方向、矩阵行列、条件概率和量词作用域。

人工等级：

```text
A：正确、自然、边界清楚
B：正确但略机械
C：可理解但有明显边界风险
D：含义错误或不可理解
```

通过要求：C=0、D=0、A+B=100%；人工样本中 A 建议不少于 85%。C/D 是硬失败。

---

## 24. 性能验收

### 24.1 环境记录

记录 OS、Node、CPU、内存、KaTeX、样本数、重复数、冷/热启动和是否含模块加载。

### 24.2 指标

```text
P50 ≤ 10 ms
P95 ≤ 30 ms
普通公式最大值 ≤ 200 ms
```

独立计算 min、P50、P90、P95、P99、max、mean、标准差。不得只报告最好一次。

冷启动单独报告；热运行预热后统计。10,000 次短公式后检查内存趋势，恶意输入必须有限时间结束。

不达标默认 `FAIL`；验收者不能自行批准豁免。

---

## 25. 安全和离线性验收

1. 拦截网络后运行全量核心测试；
2. 验证 `\href{javascript:...}`、`\htmlClass`、`\includegraphics`、宏、HTML `\text{}` 不执行代码；
3. 使用 `__proto__`、`constructor`、`prototype`、`toString` 测原型污染；
4. 公式内容不得触发文件或环境读取；
5. 日志和诊断必须限制原始输入长度；
6. 不得把敏感或控制字符完整回显。

---

## 26. 现有系统回归

至少运行：

```bash
node resources/server/lib/tts-classic-stream-contract-smoke-test.js
node resources/server/lib/tts-classic-stream-session-safety-smoke-test.js
node resources/server/.next/static/chunks/app/voice-early-stream-smoke-test.js
node resources/server/.next/static/chunks/app/voice-stream-backpressure-smoke-test.js
node resources/server/.next/static/chunks/app/voice-stream-error-containment-smoke-test.js
node resources/server/.next/static/chunks/app/voice-replay-smoke-test.js
```

自包含烟测必须执行。Live smoke 无服务可标记 `NOT RUN`，不能伪装通过。运行回归不授权修改前端。

---

## 27. 语法与打包完整性

对所有新增/修改 JS：

```bash
node --check <file>
```

核心文件使用 Acorn：

```bash
node -e "const a=require('acorn');a.parse(require('fs').readFileSync('<file>','utf8'),{ecmaVersion:2022})"
```

若新增运行时文件或依赖，读取实际脚本说明后运行 manifest 检查，至少包括：

```bash
node resources/server/lib/release-runtime-manifest-smoke-test.js
```

最后检查：

```bash
git diff --check
git status --short
```

必须区分本次问题和历史问题。

---

## 28. 开发者测试矩阵

根据实际文件名找到并逐条运行等价测试：

```bash
node resources/server/lib/math-speech/math-speech-smoke-test.js
node resources/server/lib/math-speech/math-speech-corpus-test.js
node resources/server/lib/math-speech/math-speech-number-test.js
node resources/server/lib/math-speech/math-speech-ambiguity-test.js
node resources/server/lib/math-speech/math-speech-malformed-test.js
node resources/server/lib/math-speech/math-speech-determinism-test.js
node resources/server/lib/math-speech/math-speech-benchmark.js
```

记录命令、退出码、耗时、摘要、断言数量和 skip 数。失败必须非 0。只有 `PASS` 文本而无复现命令，直接 `FAIL`。

---

## 29. 证据目录与格式

建议：

```text
outputs/math-speech-acceptance/
├── ACCEPTANCE_REPORT.md
├── command-results.json
├── scope-audit.json
├── dependency-audit.json
├── corpus-audit.json
├── independent-cases.json
├── independent-results.json
├── invariants.json
├── performance.json
└── failures/
```

每条命令记录 command、startedAt、durationMs、exitCode、stdout/stderr 摘要和状态。

每个失败记录编号、严重度、门槛、输入、上下文、期望、实际、复现命令、影响、是否阻断和整改条件。

---

## 30. 缺陷严重度

### S0：验收完整性破坏

测试造假、修改期望掩盖失败、隐瞒前端修改、敏感信息入库、验收者修实现后宣称独立通过。裁决 `FAIL`。

### S1：数学或安全错误

公式读错、范围错误、无证据消歧、冻结回写、LaTeX 泄漏、任意执行、恶意输入挂起。裁决 `FAIL`。

### S2：合同或重要覆盖错误

错误代码缺失、分类不足、深冻结不完整、性能超标、manifest 漏项、结构边界不清。裁决 `FAIL`。

### S3：非阻断改进

仅限不影响数学含义、合同、性能、安全和硬门槛的建议。

---

## 31. 裁决算法

```text
缺少不可替代基线或环境？
  ├─ 是 → BLOCKED
  └─ 否
      ↓
任一硬门槛失败？
  ├─ 是 → FAIL
  └─ 否
      ↓
所有强制命令都有新鲜证据？
  ├─ 否 → BLOCKED 或 FAIL
  └─ 是
      ↓
独立黑盒、故障注入、人工审阅通过？
  ├─ 否 → FAIL
  └─ 是 → PASS
```

不能以总分抵消硬失败。即使 99% 通过，只要一条把集合基数读成绝对值，仍是 `FAIL`。

---

## 32. PASS 完整条件

- [ ] 已阅读全部权威输入；
- [ ] 范围和基线可审计；
- [ ] 前端新增修改为 0；
- [ ] 敏感文件修改为 0；
- [ ] 架构符合规定；
- [ ] 运行时无 LLM、无网络；
- [ ] API 合同通过；
- [ ] 基础公式精确通过；
- [ ] 数字精确通过；
- [ ] 武断误读为 0；
- [ ] 冻结回写为 0；
- [ ] malformed 未处理异常为 0；
- [ ] 占位语为 0；
- [ ] LaTeX 泄漏为 0；
- [ ] 非确定输出为 0；
- [ ] 黄金语料 ≥230；
- [ ] 分类均达下限；
- [ ] 去重后仍具实质覆盖；
- [ ] 独立黑盒 ≥80 且全通过；
- [ ] 故障注入证明测试有效；
- [ ] 人工审阅 ≥60；
- [ ] 中文质量无 C/D；
- [ ] 性能达标；
- [ ] 安全和资源限制通过；
- [ ] manifest 正确；
- [ ] 语法检查通过；
- [ ] 自包含 TTS 回归通过；
- [ ] 完成报告和限制齐全；
- [ ] 未实现重新生成语音；
- [ ] 未进入前端阶段。

---

## 33. FAIL 后整改要求

不得直接写补丁。每项整改必须包含：

```text
问题
违反的门槛
最小复现
期望
实际
影响
整改条件
复验范围
```

复验不能只跑修复点，必须执行关联矩阵和全量核心测试。

---

## 34. 最终验收报告模板

```markdown
# Socratopia 数学公式语义化核心验收报告

## 最终裁决
PASS / FAIL / BLOCKED

## 裁决摘要
- 硬门槛通过：x/y
- S0/S1/S2/S3：
- 前端准入门：CLOSED

## 范围与基线
- 被验收文件：
- 基线来源：
- 前端新增修改：
- 敏感文件修改：

## 架构与依赖
- LaTeX → MathML：
- MathML → AST：
- AST → 中文：
- 运行时网络/LLM：

## 测试可信度
- 故障注入：
- 退出码行为：
- 共享 oracle 风险：

## 黄金语料
- 原始/唯一总数：
- 分类数量：
- 人工审阅：

## 独立黑盒
- 总数/通过/失败：
- 错误语义：

## 功能结果
- 基础/数字/高阶/歧义/作用域/冻结/malformed：
- 占位语/LaTeX 泄漏/非确定输出：

## 性能与安全
- 环境：
- P50/P95/P99/Max：
- 内存趋势：
- 安全结果：

## 缺陷
### FAILURE-001
- 严重度：
- 复现：
- 期望/实际：
- 整改条件：

## 下一阶段资格
- 具备申请前端评审资格：是/否
- 前端已经授权：否
- 重新生成语音已经授权：否

## 证据索引
- command-results.json
- corpus-audit.json
- independent-results.json
- performance.json
- scope-audit.json
```

---

## 35. 交给 GPT-5.6-terra Max 的最终提示词

请在 `E:\huanjing\sogeladi\Socratopia` 中，严格按照 `MATH_SPEECH_CORE_ACCEPTANCE_SPEC.md` 对数学公式语义化核心执行独立验收。

完整阅读 `AGENTS.md`、开发规范、验收规范、开发者报告、全部实现、测试和语料。你是验收者，不是修复者；禁止修改实现、测试期望、黄金语料、前端、TTS、缓存、Electron 或 ASAR。发现缺陷时记录最小复现和整改条件，不要顺手修复。

独立重跑所有测试，审查测试可信度，执行临时副本故障注入，核验至少 230 条且满足分类下限的黄金语料，人工审阅至少 60 条，并构造至少 80 条开发语料之外的黑盒用例。重点审查数学正确性、数字精度、无证据消歧、作用域、语义冻结、缓存隔离、malformed 输入、资源上限、LaTeX 泄漏、占位语、确定性、性能、离线性、依赖和前端零改动。

最终裁决只能是 `PASS`、`FAIL` 或 `BLOCKED`。任何硬门槛失败必须 `FAIL`；只有缺少不可替代基线或完全无法执行才可 `BLOCKED`。即使 `PASS`，也只代表核心具备申请前端评审的资格。前端准入门仍为 `CLOSED`，不得接入前端或实现重新生成语音。

将证据写入 `outputs/math-speech-acceptance/`，生成 `ACCEPTANCE_REPORT.md` 及机器可读的命令、语料、黑盒、性能、范围和失败记录。报告必须列出每条强制命令的实际退出码和摘要，并明确前端新增修改数、错误语义数、冻结回写数、占位语数、LaTeX 泄漏数、非确定输出数和最终裁决。

