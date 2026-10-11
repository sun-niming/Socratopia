"use strict";

// Regression test for BUG-0012 (2026-09-14 live E2E): real classroom turns lost
// their post-response progress save 3~5 times a day with
//
//   [kb-progress] post-response progress save failed: EPERM
//     rename '.../textbook_index.json.<digits>' -> '.../textbook_index.json'
//
// Root cause: chat/route.js fires `prefetchCandidate(...)` WITHOUT awaiting it, so
// that background write competes with the foreground post-response save on the very
// same textbook_index.json. Both sides protect themselves with a retry budget rather
// than with auto-advance's withLock(), and the budgets were mismatched:
//   * auto-advance.js  atomicWrite  -> 5 attempts, 25ms..125ms  (~375ms total)
//   * kb-progress.js   atomicWrite  -> 10 attempts, 20ms..200ms (~1100ms total)
// The shorter one loses, and the failure kills the whole turn's progress save.
//
// This test injects a burst of EPERM renames (the Windows symptom) and asserts the
// writer outlasts more than the old 5-attempt budget. It runs against the real
// write-file-atomic call path, so it also pins the library's lack of built-in retry.

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var Auto = require("./auto-advance.js");

var scope = {
  accountId: "local",
  profileId: "p",
  worldId: "w",
  textbookId: "tb",
  conversationId: "c1",
};

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

// Fail the next `count` renames *onto* a given target with EPERM, then delegate.
// Restricting to one target mirrors the real symptom: only textbook_index.json lost
// the race, and only the call writing it should exhaust its budget.
function injectEpermBurst(count, targetSuffix) {
  var original = fs.renameSync;
  var left = count;
  var attemptsOnTarget = 0;
  fs.renameSync = function (from, to) {
    var isTarget = String(to).split(path.sep).join("/").indexOf(targetSuffix) >= 0;
    if (!isTarget) return original.apply(fs, arguments);
    attemptsOnTarget += 1;
    if (left > 0) {
      left -= 1;
      var error = new Error("EPERM: operation not permitted, rename '" + from + "' -> '" + to + "'");
      error.code = "EPERM";
      error.syscall = "rename";
      throw error;
    }
    return original.apply(fs, arguments);
  };
  return {
    calls: function () { return attemptsOnTarget; },
    restore: function () { fs.renameSync = original; },
  };
}

function makeRuntime(root) {
  return Auto.createAutoAdvance({
    projectRoot: root,
    bootId: "atomic-retry",
    getAccountContext: function () { return { active: true, accountId: "local", sessionEpoch: 1 }; },
  });
}

function seed(root) {
  write(path.join(root, "accounts/local/profiles/p/worlds/w/textbooks/tb/progress_state.json"), JSON.stringify({
    textbookId: "tb",
    sourceConversationId: "c1",
    lastTaughtPage: 5,
    currentPage: 5,
    lessonStartPage: 5,
  }));
  // currentPage deliberately behind the projection, so the index really gets rewritten.
  write(path.join(root, "accounts/local/profiles/p/worlds/w/textbooks/textbook_index.json"), JSON.stringify({
    textbooks: [{ id: "tb", currentPage: 1, numPages: 40 }],
  }));
  write(path.join(root, "accounts/local/profiles/p/worlds/w/conversations/c1/current_reading.md"),
    "<!-- startPage: 4 endPage: 6 -->\n\npage four\npage five\npage six\n");
  write(path.join(root, "accounts/local/profiles/p/worlds/w/chats/c1.json"), JSON.stringify({
    messages: [{ id: "a0", role: "assistant", content: "ready" }],
  }));
}

async function run(label, failures, expectThrown) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "adv-atomic-"));
  try {
    seed(root);
    var runtime = makeRuntime(root);

    // Seed the index behind the projection, then let the *single* projection write
    // hit the injected burst (bootstrap rewrites currentPage 1 -> 5).
    var burst = injectEpermBurst(failures, "textbook_index.json");
    var thrown = null;
    try {
      await runtime.bootstrap(Object.assign({}, scope));
    } catch (error) {
      thrown = error;
    } finally {
      burst.restore();
    }
    assert.ok(burst.calls() > 0, label + ": the index write must have been attempted");

    if (expectThrown) {
      assert.ok(thrown, label + ": expected the writer to give up after " + failures + " EPERM renames");
      assert.strictEqual(thrown.code, "EPERM", label + ": expected EPERM to surface, got " + (thrown && thrown.code));
      console.log("PASS " + label + " (" + failures + " EPERM renames -> surfaced " + thrown.code + " after " + burst.calls() + " attempts)");
      return;
    }
    assert.strictEqual(thrown, null, label + ": unexpected failure " + (thrown && thrown.message));

    // The burst must have been survived, and the projection must still be readable.
    var index = JSON.parse(fs.readFileSync(path.join(root, "accounts/local/profiles/p/worlds/w/textbooks/textbook_index.json"), "utf8"));
    assert.strictEqual(index.textbooks[0].id, "tb", label + ": index must stay intact");
    assert.ok(burst.calls() > failures,
      label + ": writer must have retried past the burst (attempts=" + burst.calls() + ", failures=" + failures + ")");
    console.log("PASS " + label + " (" + failures + " EPERM renames survived in " + burst.calls() + " rename calls)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// Scenario 3 (2026-09-18): the failure mode that widens the budget on its own.
//
// The two scenarios above assume a *finite* burst. In production the contention is
// not a burst at all: renameSync fails with EPERM for as long as ANY handle has the
// target open (Node does not open with FILE_SHARE_DELETE), and the retry sleeps via
// Atomics.wait -- which BLOCKS THE EVENT LOOP. So if that handle belongs to a
// same-process async fs task, the JS continuation that would `close()` it cannot
// run until we give up. The retry therefore always burns its ENTIRE budget, and
// widening the budget cannot help. This is R-23 / Q-054.
//
// Asserted here against the real writer: an open handle held by this process makes
// bootstrap() throw, rather than surviving like a finite burst would.
async function runAgainstOpenHandle(label) {
  var fsp = require("fs/promises");
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "adv-holder-"));
  try {
    seed(root);
    var runtime = makeRuntime(root);
    var target = path.join(root, "accounts/local/profiles/p/worlds/w/textbooks/textbook_index.json");
    var handle = await fsp.open(target, "r");
    try {
      var thrown = null;
      try {
        await runtime.bootstrap(Object.assign({}, scope));
      } catch (error) {
        thrown = error;
      }
      assert.ok(thrown, label + ": an open handle must defeat even the widened budget");
      assert.strictEqual(thrown.code, "EPERM", label + ": expected EPERM, got " + (thrown && thrown.code));
      console.log("PASS " + label + " (open handle -> " + thrown.code + " after the full budget)");
    } finally {
      await handle.close();
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

(async function main() {
  // 6 consecutive EPERM renames: the OLD 5-attempt budget threw on the 5th.
  await run("survives a 6-deep EPERM burst", 6, false);
  // A burst deeper than the new budget must still fail loudly rather than hang.
  await run("still fails loudly beyond the budget", 14, true);
  // A same-process open handle cannot be released while we block -> full budget burns.
  await runAgainstOpenHandle("a same-process open handle burns the whole budget");

  console.log("auto-advance atomic write retry smoke: 3/3 passed");
})().catch(function (error) {
  console.error(error && error.stack || error);
  process.exit(1);
});
