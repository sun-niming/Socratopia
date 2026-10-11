"use strict";

var assert = require("assert");
var core = require("./index");

var groups = {
  "basic-structure": [
    { id: "basic-rem-01", latex: "(a-b)^2", mode: "semantic", speech: "（a 减 b）的平方" },
    { id: "basic-rem-02", latex: String.raw`\sin(x-y)`, mode: "semantic", speech: "正弦（x 减 y）" },
    { id: "basic-rem-03", latex: String.raw`\frac{a+b}{c-d}`, mode: "detailed", includes: ["分子是a 加 b", "分母是c 减 d", "分数结束"] },
    { id: "basic-rem-04", latex: String.raw`\sqrt[5]{u+v}`, mode: "semantic", includes: ["五次方根"] },
    { id: "basic-rem-05", latex: String.raw`\alpha_2+\Omega`, mode: "semantic", includes: ["阿尔法 下标二", "欧米伽"] },
    { id: "basic-rem-06", latex: String.raw`\log_3(x^2+1)`, mode: "semantic", includes: ["以三为底", "x 的平方加一"] },
    { id: "basic-rem-07", latex: String.raw`\binom{m+2}{r-1}`, mode: "semantic", includes: ["m 加二", "选", "r 减一"] },
    { id: "basic-rem-08", latex: String.raw`\vec{p}\times\vec{q}`, mode: "semantic", includes: ["向量 p", "乘以", "向量 q"] },
    { id: "basic-rem-09", latex: String.raw`\overline{a+b}`, mode: "semantic", speech: "a 加 b 上横线" },
    { id: "basic-rem-10", latex: String.raw`\frac{\sqrt[3]{x}}{y+1}`, mode: "detailed", includes: ["分子是", "立方根", "分母是", "分数结束"] },
    { id: "basic-rem-11", latex: String.raw`\mathbb{C}^2`, mode: "semantic", includes: ["复数集"] },
    { id: "basic-rem-12", latex: String.raw`x_{1e6}`, mode: "semantic", includes: ["一乘以十的六次方"] },
    { id: "basic-rem-13", latex: String.raw`\mathrm{d}t`, mode: "structural", speech: "d t" },
    { id: "basic-rem-14", latex: String.raw`x\pm y=z`, mode: "semantic", includes: ["正负", "等于"] },
    { id: "basic-rem-15", latex: String.raw`\left\langle a,b\right\rangle`, mode: "semantic", includes: ["左尖括号", "a，b", "右尖括号"] },
  ],
  "number-boundary": [
    { id: "number-rem-01", latex: "100", mode: "semantic", speech: "一百" },
    { id: "number-rem-02", latex: "110", mode: "semantic", speech: "一百一十" },
    { id: "number-rem-03", latex: "1000", mode: "semantic", speech: "一千" },
    { id: "number-rem-04", latex: "1010", mode: "semantic", speech: "一千零一十" },
    { id: "number-rem-05", latex: "100000001", mode: "semantic", speech: "一亿零一" },
    { id: "number-rem-06", latex: "0.001", mode: "semantic", speech: "零点零零一" },
    { id: "number-rem-07", latex: "-0.5", mode: "semantic", speech: "负零点五" },
    { id: "number-rem-08", latex: "0000", mode: "semantic", speech: "零零零零" },
    { id: "number-rem-09", latex: "0007", mode: "semantic", speech: "零零零七" },
    { id: "number-rem-10", latex: String.raw`0\%`, mode: "semantic", speech: "百分之零" },
    { id: "number-rem-11", latex: String.raw`100\%`, mode: "semantic", speech: "百分之一百" },
    { id: "number-rem-12", latex: "1e9", mode: "semantic", speech: "一乘以十的九次方" },
    { id: "number-rem-13", latex: "6.02e23", mode: "semantic", speech: "六点零二乘以十的二十三次方" },
    { id: "number-rem-14", latex: "1.2e-3", mode: "semantic", speech: "一点二乘以十的负三次方" },
    { id: "number-rem-15", latex: "1E+6", mode: "semantic", speech: "一乘以十的六次方" },
    { id: "number-rem-16", latex: "-2.5e-4", mode: "semantic", speech: "负二点五乘以十的负四次方" },
    { id: "number-rem-17", latex: "0e0", mode: "semantic", speech: "零乘以十的零次方" },
    { id: "number-rem-18", latex: "1,234", mode: "semantic", speech: "一千二百三十四" },
    { id: "number-rem-19", latex: "1,234.56", mode: "semantic", speech: "一千二百三十四点五六" },
    { id: "number-rem-20", latex: "-1,234", mode: "semantic", speech: "负一千二百三十四" },
  ],
  calculus: [
    { id: "calculus-rem-01", latex: String.raw`\sum_{r=1}^{m}(r^2+1)`, mode: "semantic", includes: ["从 r 等于一到 m", "求和"] },
    { id: "calculus-rem-02", latex: String.raw`\prod_{k=2}^{n}(k+1)`, mode: "semantic", includes: ["从 k 等于二到 n", "求积"] },
    { id: "calculus-rem-03", latex: String.raw`\int_{-2}^{2}(x^3-x)\,dx`, mode: "semantic", includes: ["从负二到二", "关于 x 的积分"] },
    { id: "calculus-rem-04", latex: String.raw`\int_0^1 t^2`, mode: "structural", excludes: ["关于 x 的积分", "关于 t 的积分"] },
    { id: "calculus-rem-05", latex: String.raw`\int_0^1 t^2\,dt`, mode: "semantic", includes: ["关于 t 的积分"] },
    { id: "calculus-rem-06", latex: String.raw`\int_0^1 t^2\,d\theta`, mode: "semantic", includes: ["关于 西塔 的积分"] },
    { id: "calculus-rem-07", latex: String.raw`\iint_0^1 (x+y)\,dx\,dy`, mode: "semantic", includes: ["关于 x 和 y 的二重积分"] },
    { id: "calculus-rem-08", latex: String.raw`\lim_{h\to0}\frac{(x+h)^2-x^2}{h}`, mode: "detailed", includes: ["当 h 趋近于零时", "分子是", "分数结束", "极限"] },
    { id: "calculus-rem-09", latex: String.raw`\frac{d}{dx}\sin x`, mode: "structural", includes: ["正弦 x", "分数结束"] },
    { id: "calculus-rem-10", latex: String.raw`\partial_x f`, mode: "semantic", includes: ["关于 x 的偏导"] },
  ],
  "sets-logic": [
    { id: "set-rem-01", latex: String.raw`\{x\in\mathbb{R}\mid x^2<2\}`, mode: "semantic", includes: ["集合构造式", "实数集", "竖线", "小于二"] },
    { id: "set-rem-02", latex: String.raw`\neg(P\land Q)`, mode: "semantic", speech: "非（P 且 Q）" },
    { id: "set-rem-03", latex: String.raw`\neg(P\lor Q)`, mode: "semantic", speech: "非（P 或 Q）" },
    { id: "set-rem-04", latex: String.raw`\neg\neg P`, mode: "semantic", speech: "非（非 P）" },
    { id: "set-rem-05", latex: String.raw`\neg\forall x\,P(x)`, mode: "semantic", includes: ["非（", "任意 x", "P 左圆括号 x 右圆括号"] },
    { id: "set-rem-06", latex: String.raw`\forall x\in A`, mode: "semantic", speech: "任意 x 属于 A" },
    { id: "set-rem-07", latex: String.raw`A\cap(B\cup C)`, mode: "semantic", includes: ["交集", "并集"] },
    { id: "set-rem-08", latex: String.raw`A\setminus B`, mode: "semantic", includes: ["集合差"] },
    { id: "set-rem-09", latex: "|A|", context: { symbolFacts: { A: { type: "set", evidence: "explicit" } } }, mode: "semantic", speech: "集合 A 的基数" },
    { id: "set-rem-10", latex: "|C|", context: { symbolFacts: { C: [{ type: "set", evidence: "explicit" }, { type: "matrix", evidence: "explicit" }] } }, mode: "structural", speech: "左竖线 C 右竖线" },
  ],
  "matrix-piecewise": [
    { id: "matrix-rem-01", latex: String.raw`\begin{pmatrix}2&0\\0&2\end{pmatrix}`, mode: "semantic", includes: ["二行二列矩阵", "第一行", "第二行"] },
    { id: "matrix-rem-02", latex: String.raw`\begin{bmatrix}1&2&3\\4&5&6\\7&8&9\end{bmatrix}`, mode: "semantic", includes: ["三行三列矩阵", "第三行"] },
    { id: "matrix-rem-03", latex: String.raw`\begin{pmatrix}1&2&3&4\\5&6&7&8\\9&10&11&12\\13&14&15&16\end{pmatrix}`, mode: "semantic", speech: "四行四列矩阵" },
    { id: "matrix-rem-04", latex: String.raw`\begin{cases}x^2&x>0\\-x&x\le0\end{cases}`, mode: "semantic", includes: ["分段函数", "第一种情况", "第二种情况", "大于零"] },
    { id: "matrix-rem-05", latex: String.raw`\det(\begin{pmatrix}a&b\\c&d\end{pmatrix})`, mode: "semantic", includes: ["矩阵", "行列式"] },
    { id: "matrix-rem-06", latex: String.raw`\vec{u}+\vec{v}`, mode: "semantic", speech: "向量 u 加向量 v" },
    { id: "matrix-rem-07", latex: String.raw`\begin{pmatrix}1e9&2\\3&4\end{pmatrix}`, mode: "semantic", includes: ["一乘以十的九次方"] },
    { id: "matrix-rem-08", latex: String.raw`\begin{pmatrix}x^2&y^2\\z^2&w^2\end{pmatrix}`, mode: "semantic", includes: ["第一行", "平方"] },
    { id: "matrix-rem-09", latex: String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}^{-1}`, mode: "semantic", includes: ["矩阵", "负一"] },
    { id: "matrix-rem-10", latex: String.raw`\begin{pmatrix}1&2&3&4&5\\6&7&8&9&10\\11&12&13&14&15\\16&17&18&19&20\\21&22&23&24&25\end{pmatrix}`, mode: "semantic", speech: "五行五列矩阵" },
  ],
  "ambiguity-scope": [
    { id: "ambiguity-rem-01", latex: String.raw`P(A\mid B)`, mode: "structural", excludes: ["条件下的概率"] },
    { id: "ambiguity-rem-02", latex: String.raw`P(A\mid B)`, context: { domainHints: ["probability"] }, mode: "structural", excludes: ["条件下的概率"] },
    { id: "ambiguity-rem-03", latex: String.raw`P(A\mid B)`, context: { symbolFacts: { P: { type: "probability", evidence: "explicit" } } }, mode: "semantic", speech: "A 在 B 条件下的概率" },
    { id: "ambiguity-rem-04", latex: "|A|", mode: "structural", speech: "左竖线 A 右竖线" },
    { id: "ambiguity-rem-05", latex: "|M|", context: { symbolFacts: { M: { type: "matrix", evidence: "explicit" } } }, mode: "semantic", speech: "矩阵 M 的行列式" },
    { id: "ambiguity-rem-06", latex: "|x|", context: { symbolFacts: { x: { type: "scalar", evidence: "explicit" } } }, mode: "semantic", speech: "x 的绝对值" },
    { id: "ambiguity-rem-07", latex: "f^{-1}", mode: "structural", speech: "f 上标负一" },
    { id: "ambiguity-rem-08", latex: "f^{-1}", context: { symbolFacts: { f: { type: "function", evidence: "explicit" } } }, mode: "semantic", speech: "f 的逆函数" },
    { id: "ambiguity-rem-09", latex: "AB", mode: "structural", speech: "A B", excludes: ["乘以"] },
    { id: "ambiguity-rem-10", latex: "A-B", mode: "structural", excludes: ["集合差"] },
    { id: "ambiguity-rem-11", latex: "a\\mid b", mode: "semantic", excludes: ["条件下的概率"] },
    { id: "ambiguity-rem-12", latex: "(a,b)", mode: "structural", speech: "左圆括号 a 逗号 b 右圆括号" },
    { id: "ambiguity-rem-13", latex: "[a,b]", mode: "structural", speech: "左方括号 a 逗号 b 右方括号" },
    { id: "ambiguity-rem-14", latex: "|A|", context: { currentSentence: "设 A 为有限集合。", symbolFacts: { A: { type: "matrix", evidence: "explicit", scopeId: "classroom" } } }, mode: "semantic", speech: "集合 A 的基数" },
    { id: "ambiguity-rem-15", latex: "|M|", context: { scopes: [{ kind: "classroom", symbolFacts: { M: { type: "set", evidence: "explicit" } } }, { kind: "currentReply", symbolFacts: { M: { type: "matrix", evidence: "explicit" } } }] }, mode: "semantic", speech: "矩阵 M 的行列式" },
  ],
  "malformed-attack": [
    { id: "malformed-rem-01", latex: String.raw`\frac{`, mode: "skip", ok: false },
    { id: "malformed-rem-02", latex: String.raw`\sqrt{`, mode: "skip", ok: false },
    { id: "malformed-rem-03", latex: String.raw`x^{`, mode: "skip", ok: false },
    { id: "malformed-rem-04", latex: String.raw`\unknowncommand{x}`, mode: "skip", ok: false },
    { id: "malformed-rem-05", latex: "$$", mode: "skip", ok: false },
    { id: "malformed-rem-06", mathml: "<math><mrow><mi>x</mi></math>", mode: "skip", ok: false },
    { id: "malformed-rem-07", mathml: "<math><mtext>A\u0000B</mtext></math>", mode: "skip", ok: false },
    { id: "malformed-rem-08", mathml: "<math><mtext>A\u202eB</mtext></math>", mode: "skip", ok: false },
    { id: "malformed-rem-09", latex: "x".repeat(5000), limits: { maxInputChars: 4096 }, mode: "skip", ok: false },
    { id: "malformed-rem-10", latex: "x+1", mathml: "<math><mi>x</mi></math>", mode: "skip", ok: false },
  ],
};

function runCase(item) {
  var input = {};
  ["latex", "mathml", "locale", "style", "context", "limits", "intent"].forEach(function (key) {
    if (Object.prototype.hasOwnProperty.call(item, key)) input[key] = item[key];
  });
  var result;
  assert.doesNotThrow(function () { result = core.prepareMathSpeech(input); }, item.id + " threw");
  assert.strictEqual(result.ok, item.ok !== false, item.id + " ok");
  var mode = result.ok ? result.decision.mode : "skip";
  assert.strictEqual(mode, item.mode, item.id + " mode");
  assert.strictEqual(result.decision.sealed, true, item.id + " sealed");
  assert.strictEqual(typeof result.speech, "string", item.id + " speech type");
  if (!result.ok) assert.strictEqual(result.speech, "", item.id + " skip speech");
  if (item.speech) assert.strictEqual(result.speech, item.speech, item.id + " speech");
  (item.includes || []).forEach(function (part) { assert(result.speech.indexOf(part) !== -1, item.id + " missing " + part); });
  (item.excludes || []).forEach(function (part) { assert(result.speech.indexOf(part) === -1, item.id + " contains " + part); });
  assert(!/[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/u.test(result.speech), item.id + " control output");
  assert(!/\\[A-Za-z]+|\$\$?|[{}]|<\/?[A-Za-z][^>]*>/.test(result.speech), item.id + " raw syntax output");
  return { id: item.id, ok: result.ok, mode: mode, speech: result.speech, reason: result.diagnostics.reason || null };
}

var results = [];
var counts = {};
Object.keys(groups).forEach(function (group) {
  counts[group] = groups[group].length;
  groups[group].forEach(function (item) { results.push({ group: group, result: runCase(item) }); });
});
assert.strictEqual(results.length, 90);
console.log(JSON.stringify({ runner: "math-speech-independent-remediation-v1", total: results.length, passed: results.length, categoryCounts: counts, results: results }, null, 2));
