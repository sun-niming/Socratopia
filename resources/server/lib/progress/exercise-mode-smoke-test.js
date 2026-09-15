"use strict";

// Regression test for the 2026-09-13 chapter-end exercise drift
// (outputs/deepseek-classroom-20260913-diagnosis.md).
//
// Confirmed cause: the learner asked for chapter-end exercises, but nothing
// recorded the task. The old KB concept queue kept choosing the teaching
// direction, and two trailing question marks were enough to force the next
// unrelated card. This test drives the real modules (no model, no network):
//   * classroom-task.js  - the persistent task/queue/constraint record
//   * kb-progress.js     - directive injection and post-response commits
//
// Acceptance scenarios covered: R26 -> R27 without a byte-stream detour; the
// "继续看题，不要跑偏" constraint staying in force; P7 hints never landing on the
// "服务器返回大写句子" card; reload/resume keeping the queue; short answers
// ("继续" / "不会") never switching the mode; lecture mode still advancing.

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var P = require("./kb-progress.js");
var T = require("./classroom-task.js");
var R = require("../resume/progress-resume.js");

var root = fs.mkdtempSync(path.join(os.tmpdir(), "exercise-mode-"));
var world = path.join(root, "accounts", "test", "profiles", "p", "worlds", "w");
var textbook = path.join(world, "textbooks", "KUqg");
var kb = path.join(textbook, "knowledge_base");
var conversationId = "H_CUtB_3Dt0vQR7wLaGnV";
fs.mkdirSync(path.join(kb, "cards"), { recursive: true });

var cards = [
  { concept_id: "328_tcp", title: "服务器返回大写句子", source_pages: [125, 126], definition: "把客户端发来的小写句子转成大写后返回。" },
  { concept_id: "329_welcome", title: "欢迎套接字持续服务后续客户", source_pages: [126, 127], definition: "监听套接字循环接受新连接。" },
  { concept_id: "330_http_latency", title: "HTTP 时延公式", source_pages: [131, 132], definition: "总时延 = 各阶段时延之和。" },
];
fs.writeFileSync(path.join(kb, "index.json"), JSON.stringify({ cards: cards }));
cards.forEach(function (card) {
  fs.writeFileSync(path.join(kb, "cards", card.concept_id + ".json"), JSON.stringify(card));
});
fs.writeFileSync(path.join(kb, "teaching_map.json"), JSON.stringify({
  segments: [{ sequence: [{ card_ids: cards.map(function (c) { return c.concept_id; }) }] }],
}));
fs.writeFileSync(path.join(kb, "build_status.json"), JSON.stringify({ state: "done", activationEligible: true }));
fs.writeFileSync(path.join(world, "textbooks", "textbook_index.json"), JSON.stringify({ textbooks: [{ id: "KUqg", currentPage: 131 }] }));

var reading = [
  "<!-- startPage: 125 endPage: 136 -->",
  "## 2.7 套接字编程",
  "监听套接字接受连接，服务器把客户端发来的句子转成大写返回。",
  "",
  "## 章末习题",
  "R26 说明 TCP 服务器与客户端的分工。",
  "R27 写出创建客户端套接字的步骤。",
  "R11 解释字节流服务的含义。",
  "P7 某 HTTP 服务的请求时延由哪几段组成？",
  "P8 计算一次往返的总时延。",
].join("\n");
var readingDir = path.join(world, "conversations", conversationId);
fs.mkdirSync(readingDir, { recursive: true });
fs.writeFileSync(path.join(readingDir, "current_reading.md"), reading);

var paths = {
  worldDir: world,
  textbookDir: textbook,
  textbookId: "KUqg",
  conversationId: conversationId,
  textbookIndex: path.join(world, "textbooks", "textbook_index.json"),
  worldConfig: path.join(world, "world.json"),
};

R.writeState(textbook, {
  textbookId: "KUqg",
  sourceConversationId: conversationId,
  activeConceptId: "328_tcp",
  lastTaughtPage: 130,
  currentPage: 130,
  loadedCursor: { startPage: 125, endPage: 136 },
});

var failures = [];
function check(name, fn) {
  try { fn(); console.log("  ok  " + name); }
  catch (error) { failures.push(name + ": " + (error && error.message)); console.log("  FAIL " + name + " - " + (error && error.message)); }
}
async function checkAsync(name, fn) {
  try { await fn(); console.log("  ok  " + name); }
  catch (error) { failures.push(name + ": " + (error && error.message)); console.log("  FAIL " + name + " - " + (error && error.message)); }
}
function bodyWith(messages, extra) {
  return Object.assign({ textbookId: "KUqg", conversationId: conversationId, profileId: "p", worldId: "w", messages: messages }, extra || {});
}
function event(obj) { return "data: " + JSON.stringify(obj) + "\n\n"; }
function reply(text, marker) { return event({ type: "text", text: text + "<!-- kbProgress:" + JSON.stringify(marker) + " -->" }) + event({ type: "done" }); }
function sse(markerText) { return new Response(markerText, { headers: { "Content-Type": "text/event-stream" } }); }
function state() { return R.readState(textbook); }
function runTurn(responseText, body, prepared) {
  return P.transformSseResponse(sse(responseText), {
    body: body,
    paths: paths,
    endClass: false,
    trackProgress: true,
    conversationMeta: { textbookId: "KUqg" },
    progressContext: prepared,
    exerciseMode: true,
    classroomTask: { task: T.readTask(paths) },
  }).text();
}

// ===================== task entry, queue, and constraints =====================
var planBody = bodyWith([
  { role: "user", content: "开始上课吧" },
  { role: "assistant", content: "我们先看 2.7。学到章末可以做 R26、R27、R11、P7 这几道。" },
  { role: "user", content: "我们来做章末题，按题逐个练习。" },
]);
var resolved = T.resolveForRequest({ paths: paths, body: planBody });
check("explicit exercise request enters exercise mode", function () {
  assert.strictEqual(resolved.task.mode, "exercise");
  assert.strictEqual(resolved.changed, true, "the switch is persisted, not just computed");
});
check("queue comes from the actual problem selection, not a hardcoded list", function () {
  var queue = resolved.task.exerciseQueue;
  ["R26", "R27", "R11", "P7"].forEach(function (id) {
    assert.ok(queue.indexOf(id) >= 0, id + " must be in the agreed queue, got " + queue.join(","));
  });
  assert.ok(queue.indexOf("P8") >= 0, "a queued id present in the exercise window is picked up too");
  assert.strictEqual(queue[0], "R26", "the learner/companion order is preserved ahead of document order");
  assert.ok(queue.indexOf("R26") < queue.indexOf("P7"), "document order is not allowed to reorder the agreed plan");
  assert.strictEqual(resolved.task.currentExerciseId, "R26", "the session starts on the first agreed exercise");
  assert.strictEqual(resolved.task.phase, "awaiting_answer");
});
check("task state lives outside the lesson summary and is reloadable", function () {
  var file = path.join(readingDir, "classroom-task.json");
  assert.ok(fs.existsSync(file), "task file is written beside the conversation, not into a summary");
  var reloaded = T.readTask(paths);
  assert.deepStrictEqual(reloaded.exerciseQueue, resolved.task.exerciseQueue, "queue survives a reload");
  assert.strictEqual(reloaded.currentExerciseId, "R26");
});

// ===================== exercise turns must not be driven by the KB queue =====================
check("exercise mode does not force the next KB card", function () {
  var prepared = P.prepareProgressContext(paths, undefined, { exerciseMode: true });
  assert.strictEqual(prepared.exerciseMode, true);
  assert.strictEqual(prepared.forcedFrom, null, "no two-check cap in exercise mode");
  assert.strictEqual(prepared.activeConceptId, null, "the KB queue does not choose the teaching direction");
  assert.strictEqual(prepared.currentIndex, null, "no concept cursor is advanced");
});
check("exercise directive replaces the KB queue directive", async function () {
  var prepared = P.prepareProgressContext(paths, undefined, { exerciseMode: true });
  var body = bodyWith([{ role: "user", content: "R26 我写好了，你看看" }]);
  var request = P.requestWithProgressDirective(
    new Request("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    body, paths, prepared, T.readTask(paths));
  var injected = (await request.json()).messages[0].content;
  assert.ok(injected.indexOf("EXERCISE_TRAINING_MODE") >= 0, "exercise directive is injected");
  assert.strictEqual(injected.indexOf("newlyCompletedConceptIds"), -1, "no concept-completion instruction leaks into exercise mode");
  assert.strictEqual(injected.indexOf("TWO_CHECK_LIMIT_REACHED"), -1, "the forced-advance instruction is gone");
  assert.ok(injected.indexOf('"exerciseId":"R26"') >= 0, "the marker is bound to the current exercise");
  assert.ok(injected.length < 1500, "directive survives the route per-message limit, got " + injected.length);
});

// ===================== learner corrections persist =====================
check("a correction on one turn stays in force on later turns", function () {
  var turn = T.resolveForRequest({ paths: paths, body: bodyWith([{ role: "user", content: "继续看题，不要跑偏" }]) });
  assert.strictEqual(turn.task.mode, "exercise", "a correction never leaves the task");
  assert.strictEqual(turn.task.currentExerciseId, "R26", "and never jumps the queue");
  assert.ok(turn.task.constraints.some(function (c) { return c.key === "no-drift"; }), "the constraint is recorded");
  var later = T.resolveForRequest({ paths: paths, body: bodyWith([{ role: "user", content: "R26 的第二问我不确定" }]) });
  assert.ok(later.task.constraints.some(function (c) { return c.key === "no-drift"; }), "the constraint is still there two turns later");
  var directive = T.buildExerciseDirective(later.task, { textbookId: "KUqg", conversationId: conversationId });
  assert.ok(directive.indexOf("不要跑偏") >= 0, "and it is re-stated to the model every turn");
});
check("short answers never switch the mode or advance the queue", function () {
  ["继续", "不会", "不知道"].forEach(function (text) {
    var turn = T.resolveForRequest({ paths: paths, body: bodyWith([{ role: "user", content: text }]) });
    assert.strictEqual(turn.task.mode, "exercise", text + " must not switch the task");
    assert.strictEqual(turn.task.currentExerciseId, "R26", text + " must not advance the queue");
    assert.strictEqual(turn.changed, false, text + " must not rewrite the task");
  });
});

// ===================== P7 hints never land on the unrelated KB card =====================
(async function () {
  var p7Task = T.writeTask(paths, T.applyUserText(T.readTask(paths), { text: "现在做 P7" }).task);
  check("naming an exercise moves the current task immediately", function () {
    assert.strictEqual(p7Task.currentExerciseId, "P7");
    assert.strictEqual(p7Task.phase, "awaiting_answer");
  });
  check("the moved queue drops any conflicting previous position", function () {
    var directive = T.buildExerciseDirective(p7Task, { textbookId: "KUqg", conversationId: conversationId });
    assert.ok(directive.indexOf('"exerciseId":"P7"') >= 0, "directive follows the correction");
    assert.strictEqual(R.readState(textbook).activeConceptId, "328_tcp", "KB state is untouched by the move");
  });

  var before = state();
  var prepared = P.prepareProgressContext(paths, undefined, { exerciseMode: true });
  var hintOne = "P7 先只看请求从发出到收到响应的这一段，这段时间里包含哪几步？";
  var hintTwo = "那 服务器返回大写句子 这条链路里，网络往返算在哪一步？";
  var marker = { schemaVersion: 1, textbookId: "KUqg", sourceConversationId: conversationId, exerciseId: "P7", exerciseComplete: false, lastTaughtPage: 131 };
  await runTurn(reply(hintOne, marker), bodyWith([{ role: "user", content: "R26、R27 都做完了，现在看 P7。" }]), prepared);
  await runTurn(reply(hintTwo, marker), bodyWith([{ role: "user", content: "我觉得是先建连接再发请求，对吗？" }]), prepared);
  check("two P7 hints do not accumulate onto the unrelated card", function () {
    var after = state();
    assert.strictEqual(after.activeConceptId, "328_tcp", "the old active card is still active");
    assert.strictEqual(after.activeConceptCheckCount || 0, 0, "exercise turns never charge a concept check");
    assert.ok(!(after.completedConceptIds || []).includes("328_tcp"), "the unrelated card is not completed");
    assert.ok(!(after.completedConceptIds || []).includes("329_welcome"), "and the next card is not forced either");
    assert.strictEqual(after.lastTaughtPage, 131, "only the exercise page moves");
  });
  check("no KB card is completed by the exercise turn even when the reply names one", function () {
    var preparedAfter = P.prepareProgressContext(paths, undefined, { exerciseMode: true });
    assert.strictEqual(preparedAfter.forcedFrom, null, "the two-check cap cannot fire in exercise mode");
    assert.strictEqual(preparedAfter.activeConceptId, null);
    assert.strictEqual(before.activeConceptId, "328_tcp");
  });

  await checkAsync("completing P7 closes it and moves to the next queued exercise", async function () {
    var doneMarker = Object.assign({}, marker, { exerciseComplete: true });
    await runTurn(reply("P7 收束：总时延 = 发送 + 传播 + 排队 + 处理。下一题 P8。", doneMarker),
      bodyWith([{ role: "user", content: "明白了，P7 我算完了。" }]), prepared);
    var task = T.readTask(paths);
    assert.strictEqual(task.currentExerciseId, "P8", "the queue advances to the agreed next exercise");
    assert.ok(T.completedIds(task).indexOf("P7") >= 0, "P7 is recorded as finished");
    assert.strictEqual(task.exerciseResults.filter(function (r) { return r.id === "P7"; }).length, 1, "P7 is closed exactly once");
    var after = state();
    assert.ok(!(after.completedConceptIds || []).includes("328_tcp"), "finishing an exercise completes no KB card");
    assert.strictEqual(after.activeConceptId, "328_tcp", "KB cursor is unchanged");
  });
  await checkAsync("P7's completion does not leak into the next exercise", async function () {
    var task = T.readTask(paths);
    var directive = T.buildExerciseDirective(task, { textbookId: "KUqg", conversationId: conversationId });
    assert.ok(directive.indexOf('"exerciseId":"P8"') >= 0, "the directive follows the queue");
    assert.strictEqual(directive.indexOf("329_welcome"), -1, "no KB card id appears in the exercise directive");
    assert.ok(directive.indexOf("已经完成") === -1 && directive.indexOf("already finished") >= 0, "finished exercises stay as a compact result list");
  });

  // ===================== resume / refresh =====================
  await checkAsync("the queue and position survive a resumed conversation", async function () {
    var reloaded = T.readTask(paths);
    assert.strictEqual(reloaded.mode, "exercise");
    assert.strictEqual(reloaded.currentExerciseId, "P8");
    assert.deepStrictEqual(reloaded.exerciseQueue.slice(0, 5), ["R26", "R27", "R11", "P7", "P8"]);
    var resumed = T.resolveForRequest({ paths: paths, body: bodyWith([{ role: "user", content: "我们继续" }]) });
    assert.strictEqual(resumed.task.currentExerciseId, "P8", "a refreshed request resumes on the same exercise");
    assert.strictEqual(resumed.task.mode, "exercise", "and in the same mode");
  });

  // ===================== explicit switch back to lecture =====================
  await checkAsync("an explicit switch back restores normal lecture progress", async function () {
    var off = T.resolveForRequest({ paths: paths, body: bodyWith([{ role: "user", content: "不用做题了，继续讲课。" }]) });
    assert.strictEqual(off.task.mode, "lecture", "the learner's explicit switch is honoured");
    var prepared = P.prepareProgressContext(paths);
    assert.strictEqual(prepared.exerciseMode, false, "lecture mode plans from the KB queue again");
    var body = bodyWith([{ role: "user", content: "继续讲课" }]);
    var request = P.requestWithProgressDirective(
      new Request("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      body, paths, prepared, T.readTask(paths));
    var injected = (await request.json()).messages[0].content;
    assert.ok(injected.indexOf("activeConceptId") >= 0, "the KB directive is restored");
    assert.strictEqual(injected.indexOf("EXERCISE_TRAINING_MODE"), -1, "exercise directive is no longer injected");
  });

  // ===================== normal lecture progress is untouched =====================
  await checkAsync("lecture mode still advances the concept queue with real evidence", async function () {
    R.replaceState(textbook, {
      textbookId: "KUqg", sourceConversationId: conversationId, activeConceptId: "328_tcp",
      completedConceptIds: [], completedTitles: [], lastTaughtPage: 125, currentPage: 125,
      loadedCursor: { startPage: 125, endPage: 136 },
    });
    var prepared = P.prepareProgressContext(paths);
    assert.strictEqual(prepared.activeConceptId, "328_tcp");
    var userAnswer = bodyWith([{ role: "user", content: "服务器把客户端发来的句子转成大写再发回去，对吗？" }]);
    await P.transformSseResponse(sse(reply("对，服务器返回大写句子就是这个意思。那么「服务器返回大写句子」这一步，谁先发送数据？", {
      schemaVersion: 1, textbookId: "KUqg", sourceConversationId: conversationId,
      activeConceptId: "328_tcp", newlyCompletedConceptIds: [], lastTaughtPage: 125,
    })), {
      body: userAnswer, paths: paths, endClass: false, trackProgress: true,
      conversationMeta: { textbookId: "KUqg" }, progressContext: prepared,
    }).text();
    assert.strictEqual(state().activeConceptCheckCount, 1, "a real concept check still counts in lecture mode");
  });

  fs.rmSync(root, { recursive: true, force: true });
  if (failures.length) {
    console.error("\nexercise mode smoke test: FAIL (" + failures.length + ")\n" + failures.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("exercise mode smoke test: PASS");
  }
})().catch(function (error) {
  console.error(error && error.stack || error);
  process.exit(1);
});
