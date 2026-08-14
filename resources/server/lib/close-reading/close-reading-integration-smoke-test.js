"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var workspaceRoot = path.resolve(__dirname, "..", "..");
var TestEnvironment = require(path.join(workspaceRoot, "smoke-test-utils.js")).TestEnvironment;

function writeMinimalPdf(file, line) {
  var stream = "BT /F1 12 Tf 72 720 Td (" + String(line).replace(/([\\()])/g, "\\$1") + ") Tj ET";
  var objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    "<< /Length " + Buffer.byteLength(stream) + " >>\nstream\n" + stream + "\nendstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  var pdf = "%PDF-1.4\n";
  var offsets = [0];
  objects.forEach(function (object, index) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += (index + 1) + " 0 obj\n" + object + "\nendobj\n";
  });
  var xref = Buffer.byteLength(pdf);
  pdf += "xref\n0 " + (objects.length + 1) + "\n0000000000 65535 f \n";
  for (var i = 1; i < offsets.length; i++) pdf += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  pdf += "trailer\n<< /Size " + (objects.length + 1) + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n";
  fs.writeFileSync(file, pdf, "binary");
}

function response(content) {
  return { choices: [{ message: { content: content } }], usage: { prompt_tokens: 20, completion_tokens: 10 } };
}

async function main() {
  var env = new TestEnvironment();
  try {
    await env.setup();
    var accountId = "local";
    var profileId = "test";
    var worldId = "test";
    var textbookId = "math";
    var conversationId = "close-reading-integration";
    var worldDir = path.join(env.tmpDir, "accounts", accountId, "profiles", profileId, "worlds", worldId);
    var textbookDir = path.join(worldDir, "textbooks", textbookId);
    fs.mkdirSync(path.join(worldDir, "chats"), { recursive: true });
    fs.mkdirSync(textbookDir, { recursive: true });
    writeMinimalPdf(path.join(textbookDir, "fixture.pdf"), "void sort complete function comment alpha beta gamma delta epsilon zeta eta theta iota kappa lambda");
    fs.writeFileSync(path.join(worldDir, "textbooks", "textbook_index.json"), JSON.stringify({
      worldId: worldId,
      textbooks: [{ id: textbookId, title: "Algorithm", fileName: "fixture.pdf", currentPage: 1, numPages: 1, format: "pdf" }],
    }, null, 2), "utf-8");
    fs.writeFileSync(path.join(worldDir, "chats", conversationId + ".json"), JSON.stringify({ id: conversationId, worldId: worldId, textbookId: textbookId, messages: [] }, null, 2), "utf-8");
    var progressPath = path.join(textbookDir, "progress.md");
    var readingPath = path.join(textbookDir, "current_reading.md");
    fs.writeFileSync(progressPath, "# 当前页码：第 1 页\n\nbaseline progress", "utf-8");
    fs.writeFileSync(readingPath, "<!-- startPage: 1 endPage: 1 -->\nbaseline reading", "utf-8");

    env.mockLLM.setResponse(response("PDF 第 1 页：void sort 的注释说明。"));
    var body = {
      conversationId: conversationId, profileId: profileId, worldId: worldId, textbookId: textbookId,
      messages: [{ role: "user", content: "/Close_Reading 第1页 void sort，解释并记住这次精读" }],
      apiKey: "mock-key", provider: "openai", model: "mock-strong", teachingLanguage: "chinese", character: "npc_a",
    };
    var close = await env.postSSE("/api/chat", body, { "X-Account-Id": accountId });
    assert.strictEqual(close.status, 200);
    assert.ok(close.raw.includes('"name":"read_textbook_excerpt"'));
    assert.ok(close.text.includes("void sort"));
    assert.strictEqual(env.mockLLM.requests.length, 1);
    var closeRequest = env.mockLLM.requests[0];
    assert.ok(closeRequest.messages[0].content.includes("## /Close_Reading Skill"));
    assert.ok(closeRequest.messages[0].content.includes("source=text-layer 时，说明证据来自 PDF 内嵌文字层/可复制文本"));
    assert.ok(closeRequest.messages[0].content.includes("<PDF_EVIDENCE"));
    assert.ok(closeRequest.messages[0].content.includes("void sort"));
    assert.strictEqual(fs.readFileSync(progressPath, "utf-8"), "# 当前页码：第 1 页\n\nbaseline progress");
    assert.strictEqual(fs.readFileSync(readingPath, "utf-8"), "<!-- startPage: 1 endPage: 1 -->\nbaseline reading");
    assert.ok(fs.existsSync(path.join(worldDir, "conversations", conversationId, "close_reading_candidates.json")));

    var today = new Date();
    var date = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
    var endClass = "===FAREWELL===\n再见。\n===PAL_MOMENTS_MD===\n## " + date + " | 学习伙伴\n完成精读。\n===PROGRESS_MD===\n# 当前页码：第 1 页\n\n## " + date + " | 学习伙伴\np.1-1 | 原进度\n精读未改变进度。\n===DIARY_ENTRY===\n## " + date + "\n记住了 PDF 第 1 页 void sort 的精读结论。\n===RELATION_MD===\n\n===COMPANION_NOTE===\n下次继续。\n===END===";
    env.mockLLM.resetRequests();
    env.mockLLM.setResponse(response(endClass));
    var endBody = Object.assign({}, body, { messages: [{ role: "user", content: "[下课]" }] });
    var ended = await env.postSSE("/api/chat", endBody, { "X-Account-Id": accountId });
    assert.strictEqual(ended.status, 200);
    assert.ok(ended.raw.includes('"type":"done"'));
    assert.strictEqual(env.mockLLM.requests.length, 1);
    assert.ok(env.mockLLM.requests[0].messages.some(function (message) { return String(message.content || "").includes("课后笔记候选"); }));
    var month = date.slice(0, 7);
    var diary = fs.readFileSync(path.join(worldDir, "diary", month + ".md"), "utf-8");
    assert.ok(diary.includes("void sort"));
    assert.ok(fs.readFileSync(progressPath, "utf-8").includes("# 当前页码：第 1 页"));
    console.log("Close Reading route integration smoke: PASS");
  } finally {
    await env.teardown();
  }
}

main().catch(function (error) { console.error(error.stack || error); process.exit(1); });