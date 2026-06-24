/**
 * Smoke test for tutoring-session.js
 * Run: node resources/server/lib/practice/tutoring-session-smoke-test.js
 */

var path = require("path");
var fs = require("fs");
var os = require("os");

// Setup temp PROJECT_ROOT
var tmpDir = path.join(os.tmpdir(), "tutor-smoke-" + Date.now());
fs.mkdirSync(tmpDir, { recursive: true });
process.env.PROJECT_ROOT = tmpDir;

// Load module
var tutor = require("./tutoring-session.js");

var passed = 0;
var failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error("FAIL: " + msg); }
}

function assertThrows(fn, msg) {
  try { fn(); failed++; console.error("FAIL (no throw): " + msg); }
  catch (e) { passed++; }
}

// --- safeSegment ---
assert(tutor.safeSegment("hello", "x") === "hello", "safeSegment valid");
assertThrows(function () { tutor.safeSegment("", "x"); }, "safeSegment empty");
assertThrows(function () { tutor.safeSegment("a/b", "x"); }, "safeSegment slash");
assertThrows(function () { tutor.safeSegment("a\\b", "x"); }, "safeSegment backslash");
assertThrows(function () { tutor.safeSegment("a..b", "x"); }, "safeSegment dotdot");
assertThrows(function () { tutor.safeSegment(null, "x"); }, "safeSegment null");

// --- defaultSession ---
var ds = tutor.defaultSession("ps_test");
assert(ds.problemSetId === "ps_test", "defaultSession id");
assert(Array.isArray(ds.messages), "defaultSession messages array");
assert(ds.companionId === null, "defaultSession companionId null");
assert(ds.context === null, "defaultSession context null");

// --- read non-existent ---
var r = tutor.readTutoringSession("prof1", "world1", "noexist");
assert(r === null, "read non-existent returns null");

// --- write + read ---
var sess = tutor.defaultSession("ps_001");
sess.companionId = "comp_a";
sess.companionName = "Alice";
var written = tutor.writeTutoringSession("prof1", "world1", sess);
assert(written.problemSetId === "ps_001", "write returns session");
assert(written.updatedAt !== null, "write sets updatedAt");

var read = tutor.readTutoringSession("prof1", "world1", "ps_001");
assert(read !== null, "read after write");
assert(read.companionId === "comp_a", "read companionId");
assert(read.companionName === "Alice", "read companionName");

// --- appendMessage ---
var msg = tutor.appendMessage("prof1", "world1", "ps_001", {
  role: "user",
  content: "请讲解这道题",
  metadata: { action: "explain", problemId: "pb_x" }
});
assert(msg.id && msg.id.indexOf("msg_") === 0, "appendMessage id generated");
assert(msg.role === "user", "appendMessage role");
assert(msg.content === "请讲解这道题", "appendMessage content");
assert(msg.metadata.action === "explain", "appendMessage metadata");

var read2 = tutor.readTutoringSession("prof1", "world1", "ps_001");
assert(read2.messages.length === 1, "session has 1 message");

// append assistant message
tutor.appendMessage("prof1", "world1", "ps_001", {
  role: "assistant",
  content: "好的，让我们一起看看这道题。"
});
var read3 = tutor.readTutoringSession("prof1", "world1", "ps_001");
assert(read3.messages.length === 2, "session has 2 messages");
assert(read3.messages[1].role === "assistant", "second msg is assistant");

// --- appendMessage auto-creates session ---
var msg2 = tutor.appendMessage("prof1", "world1", "ps_new", {
  role: "user", content: "hi"
});
var readNew = tutor.readTutoringSession("prof1", "world1", "ps_new");
assert(readNew !== null, "appendMessage auto-creates session");
assert(readNew.messages.length === 1, "auto-created has 1 msg");

// --- updateContext ---
var ctx = {
  problemId: "pb_123",
  question: "What is 2+2?",
  userAnswer: "5",
  correctAnswer: "4",
  score: 0,
  mistakeType: "calculation",
  grading: { correct: false }
};
var updated = tutor.updateContext("prof1", "world1", "ps_001", ctx);
assert(updated.context !== null, "updateContext sets context");
assert(updated.context.problemId === "pb_123", "updateContext problemId");
assert(updated.activeProblemId === "pb_123", "updateContext sets activeProblemId");

// updateContext with null clears
var cleared = tutor.updateContext("prof1", "world1", "ps_001", null);
assert(cleared.context === null, "updateContext null clears");

// --- setCompanion ---
var comp = tutor.setCompanion("prof1", "world1", "ps_001", "comp_b", "Bob");
assert(comp.companionId === "comp_b", "setCompanion id");
assert(comp.companionName === "Bob", "setCompanion name");

// setCompanion on non-existent creates session
var comp2 = tutor.setCompanion("prof1", "world1", "ps_brand_new", "comp_c", "Charlie");
assert(comp2.problemSetId === "ps_brand_new", "setCompanion creates session");
assert(comp2.companionId === "comp_c", "setCompanion new session id");

// --- listTutoringSessions ---
var list = tutor.listTutoringSessions("prof1", "world1");
assert(Array.isArray(list), "list is array");
assert(list.length >= 3, "list has at least 3 sessions");
assert(list[0].messageCount !== undefined, "list item has messageCount");
assert(list[0].updatedAt !== undefined, "list item has updatedAt");
// sorted newest first
assert(String(list[0].updatedAt) >= String(list[list.length - 1].updatedAt), "list sorted newest first");

// --- deleteTutoringSession ---
var delResult = tutor.deleteTutoringSession("prof1", "world1", "ps_brand_new");
assert(delResult === true, "delete returns true");
var afterDel = tutor.readTutoringSession("prof1", "world1", "ps_brand_new");
assert(afterDel === null, "deleted session reads null");

// delete non-existent
var delNone = tutor.deleteTutoringSession("prof1", "world1", "no_such");
assert(delNone === false, "delete non-existent returns false");

// --- genId ---
var id1 = tutor.genId("test");
var id2 = tutor.genId("test");
assert(id1 !== id2, "genId unique");
assert(id1.indexOf("test_") === 0, "genId prefix");

// --- error cases ---
assertThrows(function () { tutor.writeTutoringSession("", "w", {}); }, "write empty profileId");
assertThrows(function () { tutor.writeTutoringSession("p", "w", { problemSetId: "a/b" }); }, "write invalid segment");
assertThrows(function () { tutor.appendMessage("", "", "", {}); }, "appendMessage empty ids");

// --- Cleanup ---
try {
  fs.rmSync(tmpDir, { recursive: true, force: true });
} catch (e) {}

// --- Report ---
console.log("\nTutoring session smoke test: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
console.log("ALL PASS");

