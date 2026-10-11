"use strict";

// Regenerates the anonymous fixtures used by the post-class-notes smoke suite.
// Deterministic (seeded LCG) so a fixture diff always means an intended change:
//
//   node resources/server/lib/post-class-notes/fixtures/generate-fixtures.js
//
// Not named `*-smoke-test.js` on purpose — the smoke matrix only runs those.
//
// Plan: POST_CLASS_NOTES_QUALITY_RELIABILITY_DEVELOPMENT_PLAN.md §10 阶段 B.

var fs = require("fs");
var path = require("path");

var OUT_DIR = __dirname;

var TOPICS = [
  { name: "词法单元、模式与词素", facts: ["词法单元是词法分析器输出的语法类别", "模式是描述词素形式的规则", "词素是源程序中实际匹配到的字符序列"], example: "关键字 if、标识符 position、比较运算符 <= 分别对应三类词法单元" },
  { name: "正则表达式与语言描述", facts: ["正则表达式可以精确描述词法单元的模式", "连接、选择、闭包是三个基本运算", "正则定义用来给复杂模式命名"], example: "\\(letter(letter|digit)^{*}\\) 描述标识符" },
  { name: "非确定有限自动机", facts: ["NFA 允许同一状态对同一输入有多个转移", "含 \\(\\epsilon\\) 转移使状态可无输入迁移", "NFA 与正则表达式等价"], example: "Thompson 构造把 \\(a|b\\) 转成两条并行分支" },
  { name: "确定有限自动机与子集构造", facts: ["DFA 每个状态对每个输入最多一条转移", "子集构造把 NFA 的状态子集变成 DFA 状态", "子集构造最坏情况下状态数指数增长"], example: "\\(\\epsilon\\text{-closure}(s)\\) 用于计算合并后的状态集" },
  { name: "DFA 最小化", facts: ["最小化合并不可区分的等价状态", "划分细化算法按可区分性迭代分组", "最小 DFA 在状态数意义下唯一"], example: "先按接受/非接受划分，再按转移目标细化" },
  { name: "词法分析器构造与缓冲", facts: ["双缓冲区用哨兵字符减少边界判断", "前瞻把已读字符送回输入流", "缓冲与回退是词法分析器的核心工程约束"], example: "读到 \\(<=\\) 时需前瞻一位判断是否为 \\(<\\) 或 \\(<=\\)" },
  { name: "词法错误恢复", facts: ["词法错误需要给出可继续的恢复策略", "删除一个字符或插入缺失字符是常见策略", "恐慌模式恢复依赖同步字符集"], example: "遇到 1x 时删除数字并继续扫描标识符" }
];

var LEARNER_KINDS = ["question", "misconception", "confusion", "correct", "shift"];

function lcg(seed) {
  var state = seed >>> 0;
  return function () {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function pick(rand, list) {
  return list[Math.floor(rand() * list.length) % list.length];
}

var LEARNER_BY_KIND = {
  question: [
    "老师，{topic}这一段我没跟上，能不能从最小例子讲一遍？",
    "如果输入里同时出现两个都能匹配的前缀，分析器怎么决定用哪个？",
    "{topic}是不是只在处理复杂模式时才用得着？"
  ],
  misconception: [
    "我理解{topic}就是把它直接翻译成程序里的 if-else 吧？",
    "既然两者等价，那{N}和{topic}应该可以直接互相替换，不用中间步骤。",
    "我觉得{topic}只要一次扫描就能搞定，不需要回退。"
  ],
  confusion: [
    "到这里有点乱：{topic}的中间结果到底要不要保留下来？",
    "{topic}和{other}我分不清，看起来都在描述同一件事。",
    "为什么这里要前瞻一位？不是已经读到了吗？"
  ],
  correct: [
    "所以关键在于把非确定的多个选择合并成一个确定的状态集合。",
    "{topic}的本质是给模式一个可机械执行的表示，而不是让它更短。",
    "恢复策略要保证扫描继续前进，否则会死循环。"
  ],
  shift: [
    "原来我以为{N}和{topic}是同一层的东西，现在看它们是不同抽象层级。",
    "刚才我把它想成字符串替换了，其实它是在状态集合上做运算。",
    "我原先把{topic}当成优化技巧，现在明白它是正确性前提。"
  ]
};

var COMPANION_BY_KIND = {
  question: [
    "好，我们从最小例子走。{fact}。注意这里的定义边界，超出这个边界的说法都不成立。\n\n再看一个具体情形：{example}。你能说说它为什么落在这个定义里吗？",
    "先明确前提：我们只在词法层面讨论，不牵涉语法分析。{fact}。\n\n试着把刚才那个串代进来算一次，{example}。"
  ],
  misconception: [
    "接近但差一层。{fact}。你说的做法只对最简单的那类模式成立。\n\n反例：{example}。如果按你的写法，这里会走不下去。",
    "这个类比有用，但要加限制。{fact}。\n\n用 {example} 走一遍就能看到问题在哪。"
  ],
  confusion: [
    "区分点在这里：{fact}。{other} 说的是另一件事。\n\n对照 {example}，两者的输入输出对象并不一样。",
    "乱是正常的，这一步信息量最大。抓住一句：{fact}。\n\n把 {example} 当成锚点，后面都从这里推。"
  ],
  correct: [
    "对，就是这个。{fact}。\n\n再补一句边界：{example} 之外的情况需要额外判断。",
    "总结得准确。{fact}。把它记成一句话，下一节会反复用到。"
  ],
  shift: [
    "这个转变很关键。{fact}。\n\n用 {example} 再确认一遍，确保新理解能顶住反例。",
    "对，层级分清了。{fact}。继续用刚才那个角度往下推。"
  ]
};

var CODE_SNIPPET = [
  "```c",
  "while (peek != EOF) {",
  "  if (isdigit(peek)) {",
  "    while (isdigit(peek)) advance();",
  "    return NUM;",
  "  }",
  "  advance();",
  "}",
  "```"
].join("\n");

function learnerText(rand, topic, other) {
  var kind = pick(rand, LEARNER_KINDS);
  if (kind === "question" && rand() < 0.25) return { kind: kind, content: "老师，" + CODE_SNIPPET + "\n这段双缓冲的写法里，哨兵字符是在哪一步起作用的？" };
  var template = pick(rand, LEARNER_BY_KIND[kind]);
  return {
    kind: kind,
    content: template.replace(/\{topic\}/g, topic.name).replace(/\{other\}/g, other.name).replace(/\{N\}/g, "正则表达式")
  };
}

// Production scale is ~250 chars per message (20,003 chars / 80 messages).
// The trailing paragraph keeps the fixtures at that density so the partition
// thresholds are exercised at a realistic size.
var COMPANION_TAIL = [
  "顺便落实一个细节：这一步的中间结果最好写下来，后面最小化时会用到，凭记忆容易丢。",
  "再强调一次边界：这里讨论的是词法层，不涉及语法分析，所以不需要回溯整条产生式。",
  "如果你觉得抽象，先把状态集合写成表，再一格一格填，机械执行比直觉可靠。",
  "这里有一个常见的坑：把等价和相等混为一谈。等价是可区分的反面，不等同于形式相同。",
  "把刚才那一步重写成代码只需要几行，但先确认表填对了，否则代码会掩盖理解错误。"
];

function companionText(rand, topic, learnerKind) {
  var pool = COMPANION_BY_KIND[learnerKind] || COMPANION_BY_KIND.question;
  var template = pick(rand, pool);
  var fact = pick(rand, topic.facts);
  return template
    .replace(/\{topic\}/g, topic.name)
    .replace(/\{fact\}/g, fact)
    .replace(/\{example\}/g, topic.example)
    + "\n\n" + pick(rand, COMPANION_TAIL)
    + " " + pick(rand, COMPANION_TAIL);
}

function buildDialogue(count, seed, options) {
  var opts = options || {};
  var rand = lcg(seed);
  var messages = [];
  var topicIndex = 0;
  while (messages.length < count) {
    var topic = TOPICS[topicIndex % TOPICS.length];
    var other = TOPICS[(topicIndex + 1) % TOPICS.length];
    var learner = learnerText(rand, topic, other);
    messages.push({ role: "user", content: learner.content });
    if (messages.length >= count) break;
    messages.push({ role: "assistant", content: companionText(rand, topic, learner.kind) });
    if (opts.codeEvery && messages.length % opts.codeEvery === 0 && messages.length < count) {
      messages.push({ role: "assistant", content: "把刚才的规则落成代码就是：\n\n" + CODE_SNIPPET + "\n\n注意 advance() 里也要处理缓冲边界。" });
    }
    topicIndex += 1;
  }
  return messages.slice(0, count);
}

function writeFixture(name, payload) {
  var file = path.join(OUT_DIR, name + ".json");
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return file;
}

function main() {
  var written = [];

  written.push(writeFixture("short-20", {
    name: "short-20",
    note: "20 条中文短课，落在短课单次路径内",
    language: "chinese",
    messages: buildDialogue(20, 11, {})
  }));

  written.push(writeFixture("long-80", {
    name: "long-80",
    note: "80 条中文长课，复刻生产故障规模（msgCount=80 / 40 条学习发言）",
    language: "chinese",
    messages: buildDialogue(80, 20260915, {})
  }));

  written.push(writeFixture("stress-160", {
    name: "stress-160",
    note: "160 条压力课堂，用于验证多片段与合并预算",
    language: "chinese",
    messages: buildDialogue(160, 424242, {})
  }));

  written.push(writeFixture("code-and-math", {
    name: "code-and-math",
    note: "含代码块与 LaTeX 数学的课堂，验证转义与公式归一化",
    language: "chinese",
    messages: buildDialogue(30, 7, { codeEvery: 4 })
  }));

  written.push(writeFixture("multilingual", {
    name: "multilingual",
    note: "英文与繁体中文混排，验证语言分支",
    language: "english",
    messages: [
      { role: "user", content: "I keep mixing up patterns and lexemes. Isn't a pattern just the string we matched?" },
      { role: "assistant", content: "Close but one level off. A lexeme is the concrete string; a pattern is the rule describing the set of lexemes, e.g. \\(letter(letter|digit)^{*}\\)." },
      { role: "user", content: "Ok so the pattern is the description and the lexeme is the instance." },
      { role: "assistant", content: "Exactly. And the token is the syntactic category those lexemes belong to." },
      { role: "user", content: "那 \\(\\epsilon\\) 轉移在這裡算不算一個字元？" },
      { role: "assistant", content: "不算，\\(\\epsilon\\) 是空串，因此 \\(\\epsilon\\)-closure 可以在不消耗輸入的情況下擴張狀態集合。" },
      { role: "user", content: "所以子集構造是把「可能同時在的多個狀態」變成一個 DFA 狀態。" },
      { role: "assistant", content: "對，這正是它保證確定性的原因；代價是最壞情況下的狀態爆炸。" },
      { role: "user", content: "Why does minimization matter if the DFA already works?" },
      { role: "assistant", content: "It shrinks the table and makes the machine unique, which helps table-driven scanners and verification." },
      { role: "user", content: "Got it — it's about cost and canonical form, not correctness." },
      { role: "assistant", content: "Right. Correctness came from the subset construction; minimization is a separate optimization." }
    ]
  }));

  written.push(writeFixture("edge-messages", {
    name: "edge-messages",
    note: "空消息、纯空白、下课标记、重复助手消息、超长单条消息",
    language: "chinese",
    messages: [
      { role: "user", content: "先看双缓冲区。" },
      { role: "assistant", content: "" },
      { role: "assistant", content: "   \n  " },
      { role: "user", content: "[下课]" },
      { role: "assistant", content: "哨兵字符的作用是省掉每次读取的边界判断，代价是缓冲区末尾要留一个合法字符。\n\n" + "补充说明：".repeat(1) + "" },
      { role: "user", content: "那回退怎么做？" },
      { role: "assistant", content: "超前读一位，如果不是期望的字符就把它推回，游标回退一位再继续。" },
      { role: "assistant", content: "超前读一位，如果不是期望的字符就把它推回，游标回退一位再继续。" },
      { role: "user", content: "  " },
      { role: "user", content: "重复的那段是冗余吗？" },
      { role: "assistant", content: "是冗余，但合并 DFA 状态时可以借它观察最小化前的形态。\n\n" + ("这一段用来把单条消息拉长，便于检查分片不会切开同一轮问答。" + "反复的内容 ").repeat(40) },
      { role: "user", content: "[End Class]" },
      { role: "system", content: "这条 system 消息应当被忽略" }
    ]
  }));

  written.forEach(function (file) { console.log("wrote " + path.relative(path.resolve(__dirname, "../../.."), file)); });
}

main();
