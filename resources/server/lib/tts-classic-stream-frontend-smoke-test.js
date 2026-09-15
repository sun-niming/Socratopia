"use strict";

var assert = require("assert");
var fs = require("fs");
var http = require("http");
var path = require("path");

var bundlePath = path.resolve(__dirname, "..", ".next", "static", "chunks", "4137-131d0676e3b5bef7.js");

function listen(handler) {
  return new Promise(function (resolve, reject) {
    var server = http.createServer(handler);
    server.once("error", reject);
    server.listen(0, "127.0.0.1", function () { resolve(server); });
  });
}

function close(server) {
  return new Promise(function (resolve) { server.close(resolve); });
}

function wavBase64() {
  var bytes = Buffer.alloc(48);
  bytes.write("RIFF", 0, "ascii");
  bytes.write("WAVE", 8, "ascii");
  return bytes.toString("base64");
}

function loadVoiceExports(baseUrl) {
  var chunkSource = fs.readFileSync(bundlePath, "utf8");
  var priorSelf = globalThis.self;
  var priorLocalStorage = globalThis.localStorage;
  globalThis.self = { webpackChunk_N_E: [] };
  globalThis.localStorage = { getItem: function () { return null; }, removeItem: function () {}, setItem: function () {} };
  try {
    eval(chunkSource);
    var pushed = globalThis.self.webpackChunk_N_E.at(-1);
    var factory = pushed && pushed[1] && pushed[1][4137];
    assert(factory, "webpack module 4137 missing");
    var exports = {};
    function webpackRequire(moduleId) {
      if (moduleId === 1660) return { tE: baseUrl, mj: function () { return "local-session"; } };
      if (moduleId === 508) return { A: { emit: function () {} } };
      throw new Error("unexpected module dependency: " + moduleId);
    }
    webpackRequire.r = function (target) { Object.defineProperty(target, "__esModule", { value: true }); };
    webpackRequire.d = function (target, definitions) {
      Object.keys(definitions).forEach(function (name) {
        Object.defineProperty(target, name, { enumerable: true, get: definitions[name] });
      });
    };
    factory({}, exports, webpackRequire);
    return exports;
  } finally {
    if (priorSelf === undefined) delete globalThis.self; else globalThis.self = priorSelf;
    if (priorLocalStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = priorLocalStorage;
  }
}

async function main() {
  var audio = wavBase64();
  var server = await listen(function (request, response) {
    if (request.url !== "/infer_classic_stream") {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { "Content-Type": "application/x-ndjson", "X-TTS-Protocol": "classic-stream-ndjson-v1" });
    var events = [
      JSON.stringify({ type: "start", protocol: "classic-stream-ndjson-v1" }) + "\n",
      JSON.stringify({ type: "audio", seq: 0, mime: "audio/wav", data: audio }) + "\n",
      JSON.stringify({ type: "audio", seq: 1, mime: "audio/wav", data: audio }) + "\n",
      JSON.stringify({ type: "end", chunks: 2 }) + "\n"
    ];
    response.write(events[0].slice(0, 11));
    response.write(events[0].slice(11) + events[1].slice(0, 19));
    setTimeout(function () {
      response.write(events[1].slice(19) + events[2] + events[3]);
      response.end();
    }, 5);
  });
  try {
    var baseUrl = "http://127.0.0.1:" + server.address().port;
    var voice = loadVoiceExports(baseUrl);
    globalThis.localStorage = { getItem: function () { return "force"; }, removeItem: function () {}, setItem: function () {} };
    var stream = await voice.synthesizeStream("mock text", "soft_girl", 1, AbortSignal.timeout(5000));
    var chunks = [];
    for await (var chunk of stream) chunks.push(chunk);
    assert.strictEqual(chunks.length, 2, "mock stream emits two audio chunks");
    chunks.forEach(function (chunk, index) {
      assert.strictEqual(chunk.seq, index, "chunk order is preserved");
      assert.strictEqual(chunk.voiceKey, "soft_girl", "chunk keeps the requested voice key");
      assert.strictEqual(chunk.audio.type, "audio/wav", "chunk keeps the declared MIME type");
      assert(chunk.audio.size > 44, "chunk contains a self-contained WAV blob");
    });
    console.log("tts classic stream frontend smoke: PASS");
  } finally {
    await close(server);
  }
}

main().catch(function (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
