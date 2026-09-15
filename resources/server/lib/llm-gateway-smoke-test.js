#!/usr/bin/env node
"use strict";

var assert = require("assert");
var gatewayModule = require("./llm-gateway.js");

async function run() {
  var captured = null;
  var router = {
    callRoutedLLM: async function (input, caller) {
      var content = await caller({ provider: "test", model: "test-model", tier: "high" });
      return { content: content, route: { provider: "test", model: "test-model", tier: "high" }, tier: "high", fallbackAttempt: 0 };
    }
  };
  var gateway = gatewayModule.createGateway({
    router: router,
    transport: async function (route, input) {
      captured = { route: route, input: input };
      return '{"ok":true,"value":42}';
    }
  });
  var caller = gateway.createPromptCaller({ task: "diagnosis", requiresJson: true });
  var text = await caller("diagnose this exact prompt");
  assert.strictEqual(text, '{"ok":true,"value":42}');
  assert.strictEqual(captured.input.user, "diagnose this exact prompt", "string prompt must reach the gateway as user content");
  var parsed = await gateway.callJson({ user: "json", validate: function (value) { return value.ok === true; } });
  assert.strictEqual(parsed.data.value, 42);
  assert.deepStrictEqual(gatewayModule.parseJson("```json\n{\"a\":1}\n```"), { a: 1 });
  assert.throws(function () { gatewayModule.parseJson("not json"); }, function (error) { return error && error.code === "llm_invalid_json"; });
  console.log("PASS: llm gateway preserves string prompts and enforces JSON boundaries");
}

run().catch(function (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
