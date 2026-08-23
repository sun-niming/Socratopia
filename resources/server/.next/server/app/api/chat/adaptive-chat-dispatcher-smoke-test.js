"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var compiledPromise = require("./route.js");
var routePath = path.join(__dirname, "route.js");

function request(body) {
  return new Request("http://127.0.0.1:3000/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function main() {
  var compiled = await compiledPromise;
  var userland = compiled.routeModule.userland;
  var source = fs.readFileSync(routePath, "utf8");
  assert.strictEqual((source.match(/adaptiveCore=\(0,r\.pW\)/g) || []).length, 1, "existing pW core must remain wrapped once");
  assert.strictEqual((source.match(/let O=async function\(a\)/g) || []).length, 1, "POST export must use one thin dispatcher");
  assert(source.indexOf("b.chat.dispatch(a,adaptiveCore)") >= 0, "thin dispatcher must delegate to the server-only facade");
  assert(source.indexOf('Object.prototype.hasOwnProperty.call(c,"adaptiveDecisionId")') >= 0, "runtime-unavailable adaptive requests must fail closed by own property");
  var manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "route.js.nft.json"), "utf8"));
  assert(Array.isArray(manifest.files), "chat route manifest must remain valid");

  var original = global.__ADAPTIVE_TEACHING_RUNTIME__;
  try {
    var calls = 0;
    global.__ADAPTIVE_TEACHING_RUNTIME__ = {
      chat: {
        dispatch: async function (incoming, core) {
          calls++;
          assert.strictEqual(typeof core, "function");
          var body = await incoming.clone().json();
          assert.strictEqual(body.adaptiveDecisionId, "decision-1");
          return new Response("dispatched");
        }
      }
    };
    var delegated = await userland.POST(request({ messages: [], adaptiveDecisionId: "decision-1" }));
    assert.strictEqual(await delegated.text(), "dispatched");
    assert.strictEqual(calls, 1);

    delete global.__ADAPTIVE_TEACHING_RUNTIME__;
    var unavailable = await userland.POST(request({ messages: [], adaptiveDecisionId: "decision-1" }));
    assert.strictEqual(unavailable.status, 503);
    var payload = await unavailable.json();
    assert.strictEqual(payload.error.code, "adaptive_unavailable");
    assert.strictEqual(payload.safeToFallback, false);
  } finally {
    if (original === undefined) delete global.__ADAPTIVE_TEACHING_RUNTIME__;
    else global.__ADAPTIVE_TEACHING_RUNTIME__ = original;
  }
  console.log("adaptive chat compiled dispatcher smoke test passed");
}

main().catch(function (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
