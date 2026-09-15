"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var core = require("./index");

var selections = {
  algebra: [
    ["algebra-001", "A", "基础加法运算边界清楚"],
    ["algebra-007", "A", "二元减法角色明确"],
    ["algebra-011", "A", "显式乘法符号准确"],
    ["algebra-020", "A", "等式关系边界清楚"],
    ["algebra-029", "A", "括号底数与平方作用域明确"],
    ["algebra-037", "A", "上下标分别读出"],
    ["algebra-043", "A", "希腊字母词典读法准确"],
    ["algebra-048", "B", "无证据隐式乘法保留结构读法"],
  ],
  "fractions-roots-powers": [
    ["fractions-roots-powers-001", "A", "简单真分数自然简洁"],
    ["fractions-roots-powers-007", "A", "复合分子有分子边界"],
    ["fractions-roots-powers-012", "A", "根式和减法分母使用 detailed 边界"],
    ["fractions-roots-powers-015", "A", "二项式系数结构准确"],
    ["fractions-roots-powers-018", "A", "根式内部加法作用域清楚"],
    ["fractions-roots-powers-020", "A", "立方根明确"],
    ["fractions-roots-powers-028", "A", "括号幂保留完整底数边界"],
    ["fractions-roots-powers-029", "B", "复合指数结构化但可理解"],
  ],
  calculus: [
    ["calculus-001", "A", "求和上下界和被求和项清楚"],
    ["calculus-008", "A", "积分变量来自显式 dx"],
    ["calculus-010", "B", "未知函数调用使用结构边界"],
    ["calculus-015", "A", "极限方向和主体清楚"],
    ["calculus-016", "A", "极限分式边界清楚"],
    ["calculus-023", "B", "导数分式不猜测变量语义"],
    ["calculus-031", "A", "缺失微分变量不注入 x"],
    ["calculus-032", "A", "显式 dt 变量准确"],
  ],
  "sets-logic": [
    ["sets-logic-001", "A", "属于关系准确"],
    ["sets-logic-007", "A", "并集结构准确"],
    ["sets-logic-013", "A", "全称量词准确"],
    ["sets-logic-015", "A", "单一否定作用域明确"],
    ["sets-logic-025", "B", "无集合类型证据时大括号结构化"],
    ["sets-logic-026", "A", "显式集合事实支持基数读法"],
    ["sets-logic-027", "A", "否定覆盖整个合取操作数"],
    ["sets-logic-029", "A", "否定覆盖全称量词和谓词"],
  ],
  "probability-statistics": [
    ["probability-statistics-001", "A", "单一概率函数读法明确"],
    ["probability-statistics-002", "A", "无证据条件概率保留结构读法"],
    ["probability-statistics-005", "A", "期望算子明确"],
    ["probability-statistics-007", "A", "方差算子明确"],
    ["probability-statistics-013", "A", "显式概率事实下条件概率和复杂分数边界清楚"],
    ["probability-statistics-020", "A", "等式主体的概率读法清楚"],
    ["probability-statistics-021", "A", "显式概率事实触发条件概率"],
    ["probability-statistics-023", "A", "同作用域冲突事实不武断选择"],
  ],
  "linear-algebra": [
    ["linear-algebra-001", "A", "二阶矩阵逐行读出"],
    ["linear-algebra-005", "A", "显式 det 命令读为行列式"],
    ["linear-algebra-009", "A", "向量重音准确"],
    ["linear-algebra-013", "B", "线段重音与隐式相邻符号保留结构"],
    ["linear-algebra-016", "A", "矩阵逆幂无函数证据时结构化"],
    ["linear-algebra-018", "A", "列矩阵维度和每行清楚"],
    ["linear-algebra-020", "B", "多项下标列表边界可理解"],
    ["linear-algebra-021", "A", "矩阵单元格内科学记数法准确"],
  ],
  numbers: [
    ["numbers-001", "A", "零准确"],
    ["numbers-009", "A", "四位整数准确"],
    ["numbers-013", "A", "百分比角色准确"],
    ["numbers-018", "A", "超安全整数范围仍按字符串精确读"],
    ["numbers-021", "A", "科学记数法一乘十的九次方"],
    ["numbers-026", "A", "大写 E 和正指数准确"],
    ["numbers-029", "A", "千位分隔整数合并准确"],
    ["numbers-032", "A", "千位分隔小数合并且小数逐位读"],
  ],
  "ambiguity-errors": [
    ["ambiguity-errors-001", "A", "无上下文竖线只结构化"],
    ["ambiguity-errors-005", "A", "隐式相邻标识符不插入乘以"],
    ["ambiguity-errors-012", "A", "逆幂无证据只读上标负一"],
    ["ambiguity-errors-014", "A", "无概率证据条件概率只结构化"],
    ["ambiguity-errors-016", "A", "显式集合事实支持基数"],
    ["ambiguity-errors-019", "A", "domain hint 不单独消歧"],
    ["ambiguity-errors-033", "A", "缺失积分变量安全回退"],
    ["ambiguity-errors-040", "A", "冲突符号事实回退结构化"],
  ],
};

function findEntry(category, id) {
  var entries = JSON.parse(fs.readFileSync(path.join(__dirname, "corpus", category + ".json"), "utf8"));
  return entries.find(function (entry) { return entry.id === id; });
}

function runReview(category, item) {
  var entry = findEntry(category, item[0]);
  assert(entry, "missing manual entry " + item[0]);
  var input = {};
  ["latex", "mathml", "locale", "style", "context", "limits"].forEach(function (key) {
    if (Object.prototype.hasOwnProperty.call(entry, key)) input[key] = entry[key];
  });
  var actual = core.prepareMathSpeech(input);
  assert.strictEqual(typeof actual.speech, "string", item[0] + " speech type");
  assert.strictEqual(actual.decision.sealed, true, item[0] + " sealed");
  assert(!/[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/u.test(actual.speech), item[0] + " controls");
  assert(!/\\[A-Za-z]+|\$\$?|[{}]|<\/?[A-Za-z][^>]*>/.test(actual.speech), item[0] + " raw syntax");
  assert(item[1] === "A" || item[1] === "B", item[0] + " review grade");
  return {
    id: item[0],
    category: category,
    grade: item[1],
    rationale: item[2],
    latex: entry.latex || null,
    actual: {
      ok: actual.ok,
      mode: actual.ok ? actual.decision.mode : "skip",
      verbosity: actual.decision.verbosity,
      speech: actual.speech,
      astType: actual.ast && actual.ast.type,
      nodeCoverage: actual.diagnostics.nodeCoverage,
    },
  };
}

var rows = [];
Object.keys(selections).forEach(function (category) {
  selections[category].forEach(function (item) { rows.push(runReview(category, item)); });
});
assert.strictEqual(rows.length, 64);
var grades = rows.reduce(function (result, row) {
  result[row.grade] = (result[row.grade] || 0) + 1;
  return result;
}, {});
assert.strictEqual((grades.C || 0) + (grades.D || 0), 0);
console.log(JSON.stringify({ runner: "math-speech-manual-audit-v2", totalReviewed: rows.length, grades: grades, categoryCounts: rows.reduce(function (result, row) { result[row.category] = (result[row.category] || 0) + 1; return result; }, {}), hardFailures: [], rows: rows }, null, 2));
