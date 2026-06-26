"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var cursor = require("./progress-cursor.js");

function main() {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "md-cursor-"));
  try {
    var meta5 = { startPage: 5, endPage: 5, chunkId: "md-0005", ordinal: 5 };
    var meta6 = { startPage: 6, endPage: 6, chunkId: "md-0006", ordinal: 6 };

    cursor.updateLoadedCursor(dir, meta5, { loadedOnly: true });
    var state = cursor.readCursor(dir);
    assert.strictEqual(state.loadedCursor.chunkId, "md-0005");
    assert.strictEqual(state.taughtCursor, undefined);

    var notReady = cursor.parseProgressMarker("ok\n<!-- mdProgress: chunk=md-0005 status=teaching coverage=0.5 ready=false -->");
    assert.strictEqual(notReady.chunk, "md-0005");
    assert.strictEqual(notReady.ready, false);
    assert.strictEqual(cursor.commitTaughtChunk(dir, notReady, meta5), null);

    var ready = cursor.parseProgressMarker("done\n<!-- mdProgress: chunk=md-0005 status=complete coverage=1 ready=true -->");
    state = cursor.commitTaughtChunk(dir, ready, meta5);
    assert.strictEqual(state.taughtCursor.chunkId, "md-0005");
    assert.strictEqual(state.lastTaughtPage, 5);
    assert.strictEqual(state.currentPage, 5);
    assert.strictEqual(state.lastCommittedChunkId, "md-0005");

    cursor.updateLoadedCursor(dir, meta6, { loadedOnly: true });
    state = cursor.readCursor(dir);
    assert.strictEqual(state.loadedCursor.chunkId, "md-0006");
    assert.strictEqual(state.taughtCursor.chunkId, "md-0005");
    assert.strictEqual(state.lastTaughtPage, 5);

    var stripped = cursor.stripProgressMarker("A\n<!-- mdProgress: chunk=md-0006 status=teaching coverage=0.1 ready=false -->\n");
    assert.strictEqual(stripped.trim(), "A");

    var parsed = cursor.parseReadingMeta("<!-- startPage: 6 endPage: 6 chunkId: md-0006 ordinal: 6 loadedOnly: true -->\nbody");
    assert.strictEqual(parsed.chunkId, "md-0006");
    assert.strictEqual(parsed.loadedOnly, true);

    var meta10 = { startPage: 10, endPage: 12, chunkId: "md-0010", ordinal: 10 };
    var ready10 = cursor.parseProgressMarker("done\n<!-- mdProgress: chunk=md-0010 status=complete coverage=1 ready=true -->");
    state = cursor.commitTaughtChunk(dir, ready10, meta10);
    assert.strictEqual(state.lastTaughtPage, 10);
    assert.strictEqual(state.currentPage, 10);
    assert.strictEqual(state.taughtCursor.endPage, 12);

    console.log("progress-cursor smoke ok");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main();
