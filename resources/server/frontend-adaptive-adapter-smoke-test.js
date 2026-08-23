"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var vm = require("vm");
var acorn = require("acorn");
var webcrypto = require("crypto").webcrypto;

var bundlePath = path.join(__dirname, ".next", "static", "chunks", "app", "page-3a1fef7566e26c43.js");
var source = fs.readFileSync(bundlePath, "utf8");
var ast = acorn.parse(source, { ecmaVersion: 2022, sourceType: "script" });
var factoryNode = null;
(function walk(node) {
  if (!node || typeof node !== "object") return;
  if (node.type === "Property" && node.key && String(node.key.value) === "99001") factoryNode = node.value;
  Object.keys(node).forEach(function (key) {
    var value = node[key];
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") walk(value);
  });
})(ast);
assert(factoryNode, "webpack module 99001 must exist");
var factorySource = source.slice(factoryNode.start, factoryNode.end);

function sameDeps(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every(function (value, index) {
    return Object.is(value, right[index]);
  });
}

function createHarness(fetchImpl) {
  var slots = [];
  var cursor = 0;
  var logs = [];
  var storageWrites = [];
  var capabilityCalls = 0;
  var token = "stage-b-secret-capability-token";
  var react = {
    useRef: function (initial) {
      var index = cursor++;
      if (!slots[index]) slots[index] = { kind: "ref", value: { current: initial } };
      return slots[index].value;
    },
    useState: function (initial) {
      var index = cursor++;
      if (!slots[index]) slots[index] = { kind: "state", value: typeof initial === "function" ? initial() : initial };
      return [slots[index].value, function (next) {
        slots[index].value = typeof next === "function" ? next(slots[index].value) : next;
      }];
    },
    useEffect: function (effect, deps) {
      var index = cursor++;
      var slot = slots[index];
      if (!slot || !sameDeps(slot.deps, deps)) {
        if (slot && typeof slot.cleanup === "function") slot.cleanup();
        slots[index] = { kind: "effect", deps: deps, cleanup: effect() };
      }
    },
    useCallback: function (callback) { cursor++; return callback; },
    useMemo: function (factory) { cursor++; return factory(); }
  };
  var exports = {};
  function webpackRequire(id) {
    if (id === 2115) return react;
    if (id === 5155) return {
      jsx: function (type, props) { return { type: type, props: props }; },
      jsxs: function (type, props) { return { type: type, props: props }; }
    };
    throw new Error("unexpected webpack dependency " + id);
  }
  webpackRequire.d = function (target, definitions) {
    Object.keys(definitions).forEach(function (key) {
      Object.defineProperty(target, key, { enumerable: true, get: definitions[key] });
    });
  };
  var sandbox = {
    window: {
      electronAPI: {
        getAdaptiveCapability: async function () {
          capabilityCalls++;
          return token;
        }
      }
    },
    globalThis: null,
    fetch: function (url, options) { return fetchImpl(url, options); },
    Response: Response,
    Request: Request,
    Headers: Headers,
    AbortController: AbortController,
    DOMException: DOMException,
    crypto: webcrypto,
    console: {
      log: function () { logs.push(Array.prototype.join.call(arguments, " ")); },
      warn: function () { logs.push(Array.prototype.join.call(arguments, " ")); },
      error: function () { logs.push(Array.prototype.join.call(arguments, " ")); }
    },
    localStorage: { setItem: function (key, value) { storageWrites.push([key, value]); } },
    sessionStorage: { setItem: function (key, value) { storageWrites.push([key, value]); } },
    setTimeout: setTimeout,
    clearTimeout: clearTimeout
  };
  sandbox.globalThis = sandbox;
  var factory = vm.runInNewContext("(" + factorySource + ")", sandbox);
  factory({}, exports, webpackRequire);
  var scope = { profileId: "Profile", worldId: "World", textbookId: "Book", conversationId: "Conversation" };
  function render() {
    cursor = 0;
    return exports.useAdaptiveTeaching(scope);
  }
  function unmount() {
    slots.forEach(function (slot) { if (slot && slot.kind === "effect" && typeof slot.cleanup === "function") slot.cleanup(); });
  }
  return {
    render: render,
    unmount: unmount,
    getCapabilityCalls: function () { return capabilityCalls; },
    token: token,
    logs: logs,
    storageWrites: storageWrites
  };
}

function jsonResponse(value, status) {
  return new Response(JSON.stringify(value), {
    status: status || 200,
    headers: { "Content-Type": "application/json" }
  });
}

function startResult(decisionId) {
  return {
    ok: true,
    sessionId: "session-1",
    decisionId: decisionId || "decision-1",
    decision: { conceptId: "concept-1", action: "check", difficulty: "same", reasonCodes: ["CHECK"] }
  };
}

function chatResponse(text) {
  return new Response('data: {"type":"text","text":"' + text + '"}\n\ndata: {"type":"done"}\n\n', {
    headers: { "Content-Type": "text/event-stream" }
  });
}

function sendInput(ordinaryFetch) {
  return {
    body: {
      messages: [{ role: "user", content: "hello" }],
      profileId: "Profile",
      worldId: "World",
      textbookId: "Book",
      conversationId: "Conversation"
    },
    learnerMessage: "hello",
    allowAdaptive: true,
    ordinaryFetch: ordinaryFetch
  };
}

async function testDefaultAndSuccess() {
  var calls = [];
  var harness = createHarness(async function (url, options) {
    calls.push({ url: url, options: options });
    if (url === "/api/adaptive-teaching") return jsonResponse(startResult());
    if (url === "/api/chat") return chatResponse("answer");
    throw new Error("unexpected URL " + url);
  });
  var ordinaryCalls = 0;
  var controller = harness.render();
  controller = harness.render();
  assert.strictEqual(controller.state.enabled, false);
  assert.strictEqual(controller.state.available, true);
  assert.strictEqual(harness.getCapabilityCalls(), 0, "default-off render must not request a capability");
  controller.toggle();
  controller = harness.render();
  assert.strictEqual(controller.state.enabled, true);
  assert.strictEqual(harness.getCapabilityCalls(), 0, "enabling the panel alone must not request a capability");
  var response = await controller.send(sendInput(function () {
    ordinaryCalls++;
    return new Response("ordinary");
  }));
  assert.strictEqual(response.headers.get("content-type"), "text/event-stream");
  assert.strictEqual(ordinaryCalls, 0);
  assert.strictEqual(calls.length, 2);
  calls.forEach(function (call) {
    assert.strictEqual(call.options.headers.Authorization, "Socratopia " + harness.token);
  });
  var adaptiveChatBody = JSON.parse(calls[1].options.body);
  assert.strictEqual(adaptiveChatBody.adaptiveDecisionId, "decision-1");
  assert(/^adaptive_chat_/.test(adaptiveChatBody.adaptiveRequestId));
  controller = harness.render();
  assert.strictEqual(JSON.stringify(controller.state).indexOf(harness.token), -1, "capability must not enter React state");
  assert.strictEqual(JSON.stringify(harness.storageWrites).indexOf(harness.token), -1, "capability must not enter storage");
  assert.strictEqual(JSON.stringify(harness.logs).indexOf(harness.token), -1, "capability must not enter logs");
  controller.onEvent({ type: "done" });
  controller = harness.render();
  assert.strictEqual(controller.state.pending, false);
  harness.unmount();
}

async function testSafeFallbackOnce() {
  var adaptiveCalls = 0;
  var ordinaryCalls = 0;
  var harness = createHarness(async function (url) {
    adaptiveCalls++;
    assert.strictEqual(url, "/api/adaptive-teaching");
    return jsonResponse({ ok: false, error: { code: "adaptive_not_eligible" }, safeToFallback: true }, 403);
  });
  var controller = harness.render();
  controller = harness.render();
  controller.toggle();
  controller = harness.render();
  var ordinaryResponse = new Response("ordinary-fallback");
  var response = await controller.send(sendInput(function () {
    ordinaryCalls++;
    return ordinaryResponse;
  }));
  assert.strictEqual(response, ordinaryResponse);
  assert.strictEqual(adaptiveCalls, 1);
  assert.strictEqual(ordinaryCalls, 1, "safe pre-claim failure permits exactly one ordinary fallback");
  harness.unmount();
}

async function testNetworkUncertainRetriesSameAdaptiveRequest() {
  var chatBodies = [];
  var chatAttempts = 0;
  var ordinaryCalls = 0;
  var harness = createHarness(async function (url, options) {
    if (url === "/api/adaptive-teaching") return jsonResponse(startResult("decision-retry"));
    chatAttempts++;
    chatBodies.push(JSON.parse(options.body));
    if (chatAttempts <= 2) throw new TypeError("network unavailable");
    return chatResponse("retry-answer");
  });
  var controller = harness.render();
  controller = harness.render();
  controller.toggle();
  controller = harness.render();
  var input = sendInput(function () {
    ordinaryCalls++;
    return new Response("ordinary");
  });
  var firstError = null;
  try {
    await controller.send(input);
  } catch (error) {
    firstError = error;
    controller.onFailure(error);
  }
  assert(firstError);
  assert.strictEqual(firstError.message, "adaptive_network_uncertain");
  assert.strictEqual(ordinaryCalls, 0, "uncertain adaptive execution must not ordinary-fallback");
  controller = harness.render();
  assert.strictEqual(controller.state.errorCode, "adaptive_network_uncertain");
  var response = await controller.send(input);
  assert.strictEqual(response.headers.get("content-type"), "text/event-stream");
  assert.strictEqual(chatAttempts, 3);
  assert.strictEqual(chatBodies[0].adaptiveRequestId, chatBodies[1].adaptiveRequestId);
  assert.strictEqual(chatBodies[1].adaptiveRequestId, chatBodies[2].adaptiveRequestId);
  assert.strictEqual(chatBodies[0].adaptiveDecisionId, "decision-retry");
  assert.strictEqual(ordinaryCalls, 0);
  harness.unmount();
}

async function testLatestOnlyAbortsOlderRequest() {
  var startCalls = 0;
  var firstAborted = false;
  var harness = createHarness(function (url, options) {
    if (url === "/api/chat") return Promise.resolve(chatResponse("latest"));
    startCalls++;
    if (startCalls === 1) {
      return new Promise(function (_resolve, reject) {
        if (options.signal.aborted) {
          firstAborted = true;
          reject(new DOMException("aborted", "AbortError"));
          return;
        }
        options.signal.addEventListener("abort", function () {
          firstAborted = true;
          reject(new DOMException("aborted", "AbortError"));
        }, { once: true });
      });
    }
    return Promise.resolve(jsonResponse(startResult("decision-latest")));
  });
  var controller = harness.render();
  controller = harness.render();
  controller.toggle();
  controller = harness.render();
  var input = sendInput(function () { throw new Error("ordinary path must not run"); });
  var first = controller.send(input);
  while (startCalls < 1) await new Promise(function (resolve) { setTimeout(resolve, 0); });
  var second = controller.send(input);
  var firstError = null;
  try { await first; } catch (error) { firstError = error; }
  var response = await second;
  assert(firstError && firstError.name === "AbortError");
  assert.strictEqual(firstAborted, true);
  assert.strictEqual(response.headers.get("content-type"), "text/event-stream");
  controller = harness.render();
  assert.strictEqual(controller.state.status, "streaming", "older completion must not overwrite latest state");
  harness.unmount();
}

async function main() {
  assert.strictEqual(factorySource.indexOf("localStorage"), -1, "adapter module must not persist capability or server state");
  assert.strictEqual(factorySource.indexOf("sessionStorage"), -1, "adapter module must not persist capability or server state");
  assert.strictEqual(factorySource.indexOf("indexedDB"), -1, "adapter module must not persist capability or server state");
  await testDefaultAndSuccess();
  await testSafeFallbackOnce();
  await testNetworkUncertainRetriesSameAdaptiveRequest();
  await testLatestOnlyAbortsOlderRequest();
  console.log("frontend adaptive adapter smoke test passed");
}

main().catch(function (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
