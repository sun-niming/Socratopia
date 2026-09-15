"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var Memory = require("../close-reading/memory-candidate.js");

var root = fs.mkdtempSync(path.join(os.tmpdir(), "socratopia-continuity-candidate-"));
var paths = {
  worldDir: root,
  conversationId: "conv_a",
  accountId: "acct_a",
  profileId: "profile_a",
  worldId: "world_a",
  companionInstanceId: "ci_a",
};

try {
  var candidate = Memory.buildCandidate({
    evidence: "PDF evidence",
    startPage: 4,
    endPage: 4,
    source: "text-layer",
    metadata: { startPage: 4, endPage: 4, source: "text-layer" },
  }, "grounded answer", { query: "remember this" }, paths);
  Memory.rememberLatest(paths, candidate);
  var all = Memory.loadCandidates(paths);
  assert.strictEqual(all.length, 1);
  assert.strictEqual(all[0].schemaVersion, 1);
  assert.strictEqual(all[0].scope.companionInstanceId, "ci_a");
  assert.strictEqual(Memory.loadPendingCandidates(paths, paths).length, 1);
  assert.strictEqual(Memory.loadPendingCandidates(paths, Object.assign({}, paths, { companionInstanceId: "ci_b" })).length, 0);
  all[0].consumedByOperationId = "endclass:v1:receipt";
  fs.writeFileSync(Memory.candidatesPath(paths), JSON.stringify(all, null, 2), "utf8");
  assert.strictEqual(Memory.loadPendingCandidates(paths, paths).length, 0);
  assert.strictEqual(Memory.formatEndClassCandidates(paths, paths), null);
  console.log("PASS close-reading candidate scope and one-time pending filter");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
