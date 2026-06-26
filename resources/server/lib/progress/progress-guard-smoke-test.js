// progress-guard smoke test — Pure computation: no I/O, no server needed.
"use strict";
var g = require("./progress-guard.js");
var assert = require("assert");
var total = 0, passed = 0;
function ok(cond, msg) { total++; if (cond) { passed++; } else { throw new Error("FAIL: " + msg); } }

// -- computeTeachingRange --
var r = g.computeTeachingRange({ taughtCursor: { startPage: 5, endPage: 10, status: "complete" }, loadedCursor: { startPage: 5 } });
ok(r.lastTaughtPage === 10, "complete taught cursor uses endPage");
ok(r.startPage === 5, "startPage from taught");
ok(r.endPage === 10, "endPage from taught");

var r2 = g.computeTeachingRange({ taughtCursor: { startPage: 5, status: "teaching" }, loadedCursor: { startPage: 5 } });
ok(r2.lastTaughtPage === 5, "incomplete taught cursor uses startPage");

var r3 = g.computeTeachingRange({});
ok(r3.lastTaughtPage >= 1, "empty state defaults to 1");
ok(r3.startPage >= 1, "empty state startPage >= 1");

var r4 = g.computeTeachingRange({ lastTaughtPage: 8, windowStartPage: 7, currentPage: 9 });
ok(r4.lastTaughtPage === 8, "lastTaughtPage from plain field");
ok(r4.startPage === 7, "startPage from windowStartPage when no cursors");

// -- allowedNextStart --
var a = g.allowedNextStart({ start: 1, end: 3 }, 4);
ok(a.allowed === true, "adjacent +1 allowed");
ok(a.reason === "adjacent", "adjacent reason");

var a2 = g.allowedNextStart({ start: 1, end: 3 }, 2);
ok(a2.allowed === true, "within range allowed");

var a3 = g.allowedNextStart({ start: 1, end: 3 }, 10);
ok(a3.allowed === false, "too_far_forward blocked");
ok(a3.corrected === 4, "too_far corrected to end+1");
ok(a3.reason === "too_far_forward", "too_far reason");

var a4 = g.allowedNextStart({ start: 1, end: 3 }, 0);
ok(a4.allowed === false, "page 0 blocked");

var a5 = g.allowedNextStart({ start: 1, end: 3 }, 50, { jump: true });
ok(a5.allowed === true, "jump explicit allows any forward");
ok(a5.reason === "jump_explicit", "jump reason");

var a6 = g.allowedNextStart({ start: 5, end: 5 }, 4, {});
ok(a6.allowed === false, "before_current blocked");
ok(a6.corrected === 5, "before_current stays at start");

// -- evaluateCommit --
var ec = g.evaluateCommit({ start: 1, end: 3 }, { startPage: 4, endPage: 6 }, { trigger: "user_page_intent" });
ok(ec.allowed === true, "user_page_intent allowed");

var ec2 = g.evaluateCommit({ start: 1, end: 3 }, { startPage: 4, endPage: 6 }, { trigger: "weak_stall" });
ok(ec2.allowed === true, "weak_stall allowed");

var ec3 = g.evaluateCommit({ start: 1, end: 3 }, { startPage: 4, endPage: 6 }, { trigger: "markdown_ready_commit" });
ok(ec3.allowed === true, "markdown_ready_commit allowed");

var ec4 = g.evaluateCommit({ start: 1, end: 3 }, { startPage: 10, endPage: 15 }, { trigger: "user_page_intent" });
ok(ec4.allowed === false, "user_page_intent non-adjacent blocked");
ok(ec4.reason === "direct_signal_non_adjacent", "direct signal non-adjacent reason");

var ec5 = g.evaluateCommit({ start: 1, end: 3 }, { startPage: 4, endPage: 6 }, { trigger: "tae_prefetch" });
ok(ec5.allowed === true, "auto trigger adjacent allowed");

var ec6 = g.evaluateCommit({ start: 1, end: 3 }, { startPage: 10, endPage: 15 }, { trigger: "threshold_prefetch" });
ok(ec6.allowed === false, "threshold_prefetch non-adjacent blocked");
ok(ec6.reason === "auto_trigger_non_adjacent", "auto trigger reason");
ok(ec6.correctedStart === 4, "auto trigger corrected to end+1");

var ec7 = g.evaluateCommit({ start: 1, end: 1 }, { startPage: 2, endPage: 4 }, { trigger: "cached_prefetch_commit", fromPrefetch: true });
ok(ec7.allowed === true, "cached prefetch adjacent allowed");

var ec8 = g.evaluateCommit({ start: 1, end: 1 }, { startPage: 8, endPage: 10 }, { trigger: "cached_prefetch_commit", fromPrefetch: true });
ok(ec8.allowed === false, "cached prefetch non-adjacent blocked");
ok(ec8.reason === "cached_prefetch_non_adjacent", "cached prefetch reason");

// -- endClassAnchor --
var ea = g.endClassAnchor({
  state: { taughtCursor: { startPage: 12, endPage: 14, status: "complete" } },
  windowStartPage: 10, windowEndPage: 30,
});
ok(ea.page === 14, "anchor uses taughtCursor endPage");
ok(ea.source === "taught_cursor", "source taught_cursor");

var ea2 = g.endClassAnchor({
  state: { lastTaughtPage: 12, windowStartPage: 10, windowEndPage: 30 },
  windowStartPage: 10, windowEndPage: 30,
});
ok(ea2.page === 12, "anchor from lastTaughtPage");

// 28 not window tail, but no taught cursor: clamped to max(1,10)+1=11
var ea3 = g.endClassAnchor({
  state: {},
  progressMdPage: 28,
  windowStartPage: 10, windowEndPage: 30,
});
ok(ea3.page === 11, "progress.md clamped to windowStart+1 when no teaching progress");

// 30 is window tail -> dewindowed
var ea4 = g.endClassAnchor({
  state: {},
  progressMdPage: 30,
  windowStartPage: 10, windowEndPage: 30,
});
ok(ea4.page === 1, "window tail dewindowed, falls to 1");

var ea5 = g.endClassAnchor({
  state: { taughtCursor: { startPage: 5, endPage: 5, status: "teaching" } },
  windowStartPage: 5, windowEndPage: 20,
});
ok(ea5.page === 5, "anchor from partial taught cursor");

var ea6 = g.endClassAnchor({
  state: { taughtCursor: { startPage: 3, endPage: 8, status: "complete" } },
  progressMdPage: 15,
  windowStartPage: 5, windowEndPage: 20,
});
// taughtPage=8, progressMd=15 > 8, not window tail (15 != 20) -> candidate=15
// clamp: max(8,5)=8, 15 > 9 -> 9
ok(ea6.page === 9, "progress.md beyond taught range clamped");

// -- log (no-op, just verifies no throw) --
try { g.log("test", { key: "value" }); ok(true, "log does not throw"); } catch (e) { ok(false, "log threw: " + e.message); }

console.log(total + " assertions, all passed");
