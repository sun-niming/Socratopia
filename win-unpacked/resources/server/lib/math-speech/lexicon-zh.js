"use strict";

var GREEK = Object.freeze({
  "α": "阿尔法", "β": "贝塔", "γ": "伽马", "δ": "德尔塔", "ε": "艾普西龙", "ϵ": "艾普西龙",
  "ζ": "泽塔", "η": "伊塔", "θ": "西塔", "ϑ": "西塔", "ι": "约塔", "κ": "卡帕",
  "λ": "兰姆达", "μ": "缪", "ν": "纽", "ξ": "克西", "ο": "欧米克戎", "π": "派",
  "ϖ": "派", "ρ": "柔", "ϱ": "柔", "σ": "西格马", "ς": "西格马", "τ": "陶",
  "υ": "宇普西龙", "φ": "披", "ϕ": "披", "χ": "凯", "ψ": "普赛", "ω": "欧米伽",
  "Α": "阿尔法", "Β": "贝塔", "Γ": "伽马", "Δ": "德尔塔", "Ε": "艾普西龙", "Ζ": "泽塔",
  "Η": "伊塔", "Θ": "西塔", "Ι": "约塔", "Κ": "卡帕", "Λ": "兰姆达", "Μ": "缪",
  "Ν": "纽", "Ξ": "克西", "Ο": "欧米克戎", "Π": "派", "Ρ": "柔", "Σ": "西格马",
  "Τ": "陶", "Υ": "宇普西龙", "Φ": "披", "Χ": "凯", "Ψ": "普赛", "Ω": "欧米伽",
});

var OPERATORS = Object.freeze({
  "+": { binary: "加", unary: "正" },
  "−": { binary: "减", unary: "负", setDifference: "集合差" },
  "-": { binary: "减", unary: "负", setDifference: "集合差" },
  "×": { binary: "乘以" },
  "*": { binary: "乘以" },
  "⋅": { binary: "点乘" },
  "·": { binary: "点乘" },
  "∙": { binary: "点乘" },
  "÷": { binary: "除以" },
  "/": { binary: "除以" },
  "%": { percentage: "百分号" },
  "!": { postfix: "阶乘" },
  "=": { relation: "等于" },
  "≠": { relation: "不等于" },
  "<": { relation: "小于" },
  ">": { relation: "大于" },
  "≤": { relation: "小于等于" },
  "≥": { relation: "大于等于" },
  "≈": { relation: "约等于" },
  "≡": { relation: "恒等于" },
  "∝": { relation: "正比于" },
  "∼": { relation: "相似于" },
  "≅": { relation: "全等于" },
  "±": { binary: "正负" },
  "∓": { binary: "负正" },
  "∞": { constant: "无穷大" },
  "√": { constant: "根号" },
  "∑": { large: "summation" },
  "∏": { large: "product" },
  "∫": { large: "integral" },
  "∮": { large: "integral" },
  "∬": { large: "integral", order: 2 },
  "∭": { large: "integral", order: 3 },
  "∯": { large: "integral", order: 2 },
  "∰": { large: "integral", order: 4 },
  "∂": { constant: "偏导" },
  "∇": { constant: "梯度" },
  "∈": { relation: "属于" },
  "∉": { relation: "不属于" },
  "⊂": { relation: "真包含于" },
  "⊆": { relation: "包含于" },
  "⊃": { relation: "真包含" },
  "⊇": { relation: "包含" },
  "∪": { binary: "并集" },
  "∩": { binary: "交集" },
  "∅": { constant: "空集" },
  "∖": { setDifference: "集合差" },
  "\\": { setDifference: "集合差" },
  "∀": { prefix: "任意" },
  "∃": { prefix: "存在" },
  "¬": { prefix: "非" },
  "∧": { binary: "且" },
  "∨": { binary: "或" },
  "⇒": { relation: "推出" },
  "⇔": { relation: "当且仅当" },
  "⊢": { relation: "推出" },
  "⊨": { relation: "满足" },
  "→": { relation: "趋近于" },
  "←": { relation: "左向" },
  "↔": { relation: "双向对应" },
  "↦": { relation: "映射到" },
  "∘": { binary: "复合" },
  "⋯": { separator: "省略号" },
  "…": { separator: "省略号" },
  "∣": { delimiter: "竖线", conditional: "在……条件下", divides: "整除" },
  "|": { delimiter: "竖线", conditional: "在……条件下", divides: "整除" },
  "‖": { delimiter: "双竖线" },
  "∥": { delimiter: "双竖线" },
  "ˉ": { accent: "横线" },
  ",": { separator: "逗号" },
  ";": { separator: "分号" },
  ":": { separator: "冒号" },
  "⁡": { applyFunction: true },
  "⃗": { accent: "向量" },
  "^": { accent: "帽" },
  "‾": { accent: "横线" },
  "⏟": { accent: "下方括号" },
  "⏞": { accent: "上方括号" },
  "̄": { accent: "横线" },
  "˙": { accent: "点" },
  "¨": { accent: "双点" },
  "̃": { accent: "波浪线" },
  "~": { accent: "波浪线" },
});

var DELIMITERS = Object.freeze({
  "(": { open: "左圆括号", close: "右圆括号" },
  ")": { open: "左圆括号", close: "右圆括号" },
  "[": { open: "左方括号", close: "右方括号" },
  "]": { open: "左方括号", close: "右方括号" },
  "{": { open: "左大括号", close: "右大括号" },
  "}": { open: "左大括号", close: "右大括号" },
  "⟨": { open: "左尖括号", close: "右尖括号" },
  "⟩": { open: "左尖括号", close: "右尖括号" },
  "|": { open: "左竖线", close: "右竖线" },
  "∣": { open: "左竖线", close: "右竖线" },
  "‖": { open: "左双竖线", close: "右双竖线" },
  "∥": { open: "左双竖线", close: "右双竖线" },
});

var FUNCTIONS = Object.freeze({
  sin: "正弦", cos: "余弦", tan: "正切", cot: "余切", sec: "正割", csc: "余割",
  sinh: "双曲正弦", cosh: "双曲余弦", tanh: "双曲正切", arcsin: "反正弦", arccos: "反余弦",
  arctan: "反正切", log: "对数", ln: "自然对数", lg: "常用对数", exp: "指数函数",
  det: "行列式", gcd: "最大公因数", lcm: "最小公倍数", max: "最大值", min: "最小值",
  sup: "上确界", inf: "下确界", rank: "秩", tr: "迹", Pr: "概率", P: "概率",
  E: "期望", Var: "方差", Cov: "协方差", SD: "标准差",
});

var CONSTANTS = Object.freeze({
  e: "自然常数 e", "ℝ": "实数集", "ℤ": "整数集",
  "ℚ": "有理数集", "ℕ": "自然数集", "ℂ": "复数集", "ℙ": "概率空间",
});

function identifierSpeech(name) {
  if (Object.prototype.hasOwnProperty.call(GREEK, name)) return GREEK[name];
  if (Object.prototype.hasOwnProperty.call(CONSTANTS, name)) return CONSTANTS[name];
  return name;
}

function operatorInfo(symbol) {
  return OPERATORS[symbol] || null;
}

function functionSpeech(name) {
  return FUNCTIONS[name] || null;
}

function isFunctionName(name) {
  return Object.prototype.hasOwnProperty.call(FUNCTIONS, name);
}

function delimiterInfo(symbol) {
  return DELIMITERS[symbol] || null;
}

module.exports = {
  GREEK: GREEK,
  OPERATORS: OPERATORS,
  FUNCTIONS: FUNCTIONS,
  CONSTANTS: CONSTANTS,
  identifierSpeech: identifierSpeech,
  operatorInfo: operatorInfo,
  functionSpeech: functionSpeech,
  isFunctionName: isFunctionName,
  delimiterInfo: delimiterInfo,
};
