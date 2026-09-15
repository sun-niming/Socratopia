#!/usr/bin/env node
"use strict";

var assert = require("assert");
var builder = require("./concept-graph-builder.js");
var diagnostician = require("./diagnostician.js");

function throwingLegacy(label, counter) {
  return new Proxy({}, {
    get: function (_, property) {
      counter.count += 1;
      throw new Error(label + " legacy access: " + String(property));
    },
    set: function (_, property) {
      counter.count += 1;
      throw new Error(label + " legacy write: " + String(property));
    }
  });
}

async function exercise(counter) {
  var graph = await builder.buildConceptGraph({
    profileId: "profile-a",
    worldId: "world-a",
    textbookId: "textbook-a",
    sourceText: "力是物体之间的相互作用。牛顿第二定律描述加速度、质量与合力之间的关系。",
    textbookTitle: "物理",
    dryRun: true,
    persist: false,
    existingGraph: { version: 7 }
  });
  assert(!graph.error, graph.message || graph.error);
  assert.strictEqual(graph.version, 7, "version must come from the explicitly injected graph");
  assert(Array.isArray(graph.concepts) && graph.concepts.length > 0);

  var diagnosis = await diagnostician.diagnose({
    profileId: "profile-a",
    worldId: "world-a",
    textbookId: "textbook-a",
    sessionId: "session-a",
    userMessage: "我理解牛顿第二定律了",
    conceptGraph: graph,
    learnerModel: { concepts: {} },
    recentTurns: [],
    activeConceptIds: [graph.concepts[0].conceptId],
    dryRun: true,
    persist: false
  });
  assert(!diagnosis.error, diagnosis.message || diagnosis.error);
  assert.strictEqual(counter.count, 0, "persist:false must perform zero legacy reads, calls, or writes");
}

async function run() {
  var originalGlobal = global.__ADAPTIVE__;
  var dataLayerPath = require.resolve("./data-layer.js");
  var originalCache = require.cache[dataLayerPath];
  var counter = { count: 0 };
  try {
    global.__ADAPTIVE__ = throwingLegacy("global", counter);
    await exercise(counter);

    delete global.__ADAPTIVE__;
    require.cache[dataLayerPath] = {
      id: dataLayerPath,
      filename: dataLayerPath,
      loaded: true,
      exports: throwingLegacy("module", counter),
      children: [],
      paths: []
    };
    await exercise(counter);
    assert.strictEqual(counter.count, 0);
  } finally {
    if (originalGlobal === undefined) delete global.__ADAPTIVE__;
    else global.__ADAPTIVE__ = originalGlobal;
    if (originalCache) require.cache[dataLayerPath] = originalCache;
    else delete require.cache[dataLayerPath];
  }
  console.log("PASS: builder and diagnostician persist:false have zero legacy data-layer access");
}

run().catch(function (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
