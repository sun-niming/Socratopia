"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");

var source = fs.readFileSync(path.join(__dirname, "route.js"), "utf8");

assert(
  source.includes('maxTokens:4096'),
  "concept summary must cap output at 4096 tokens so non-streaming generation finishes before the 180s deadline",
);
assert(
  source.includes('responseFormat:"json_object"'),
  "concept summary must request provider JSON mode",
);
assert(
  source.includes("整份 JSON 响应必须控制在 1800 个字符以内"),
  "concept summary prompt must bound response length",
);
assert(
  source.includes("Keep the entire JSON response under 1800 characters"),
  "English concept summary prompt must carry the same response bound",
);
assert(
  source.includes("课后笔记生成超时，模型服务响应过慢，请重试。"),
  "provider timeouts must be translated into an actionable message",
);
assert(
  source.includes("模型服务暂时不可用（上游返回了网页而非 JSON），请稍后重试。"),
  "HTML gateway responses must not leak as JSON syntax errors",
);

console.log("concept-summary response budget smoke: PASS");
