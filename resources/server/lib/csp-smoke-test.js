"use strict";

// Smoke test for resources/server/lib/csp.js
// Run: node resources/server/lib/csp-smoke-test.js

const assert = require("assert");
const http = require("http");
const path = require("path");
const csp = require("./csp.js");

const policy = csp.contentSecurityPolicy();

// --- policy shape -----------------------------------------------------------
assert.ok(policy && typeof policy === "string", "policy must be a non-empty string");
assert.ok(policy.indexOf("default-src 'self'") >= 0, "default-src must be 'self'");
assert.ok(policy.indexOf("connect-src 'self'") >= 0, "connect-src must start from 'self'");
assert.ok(policy.indexOf("object-src 'none'") >= 0, "object-src must be none");
assert.ok(policy.indexOf("frame-ancestors 'none'") >= 0, "frame-ancestors must be none");
assert.ok(policy.indexOf("base-uri 'self'") >= 0, "base-uri must be self");
assert.ok(policy.indexOf("script-src 'self'") >= 0, "script-src must allow self");
assert.ok(policy.indexOf("style-src 'self'") >= 0, "style-src must allow self");
assert.ok(policy.indexOf("img-src 'self'") >= 0, "img-src must allow self");
assert.ok(policy.indexOf("data:") >= 0, "data: images (SVG fences) must stay allowed");
assert.ok(policy.indexOf("blob:") >= 0, "blob: objects must stay allowed");
assert.ok(policy.indexOf("http://127.0.0.1:9") >= 0, "the bundled placeholder origin must stay allowed for images");
// only the two loopback origins the renderer legitimately talks to
const allowedHosts = ["127.0.0.1:9", "127.0.0.1:8000"];
const hostMatches = policy.match(/https?:\/\/[a-z0-9.:-]+/gi) || [];
hostMatches.forEach(function (host) {
  const bare = host.replace(/^https?:\/\//, "");
  assert.ok(allowedHosts.indexOf(bare) >= 0, "unexpected origin in the policy: " + host);
});
assert.ok(policy.indexOf("upgrade-insecure-requests") < 0, "upgrade-insecure-requests would break the http://127.0.0.1 app");

// every directive must be self-contained and known
const directives = policy.split(";").map(function (part) { return part.trim(); }).filter(Boolean);
const known = [
  "default-src", "script-src", "style-src", "img-src", "font-src", "media-src",
  "connect-src", "worker-src", "manifest-src", "object-src", "frame-src",
  "frame-ancestors", "base-uri", "form-action"
];
directives.forEach(function (directive) {
  const name = directive.split(/\s+/)[0];
  assert.ok(known.indexOf(name) >= 0, "unknown directive: " + name);
});

// --- installation -----------------------------------------------------------
assert.ok(csp.installCsp() === true, "installCsp() must report success");
const patchedSetHeader = http.ServerResponse.prototype.setHeader;
assert.ok(csp.installCsp() === true, "installCsp() must be idempotent");
assert.ok(
  http.ServerResponse.prototype.setHeader === patchedSetHeader,
  "installCsp() must not patch setHeader twice"
);

// --- functional check: a real response carries the header --------------------
const server = http.createServer(function (req, res) {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end("ok");
});

server.listen(0, "127.0.0.1", function () {
  const port = server.address().port;
  http.get({ host: "127.0.0.1", port: port, path: "/" }, function (res) {
    const header = res.headers["content-security-policy"];
    assert.ok(header, "response must carry a Content-Security-Policy header");
    assert.strictEqual(header, policy, "response must carry the exact policy");
    res.resume();
    res.on("end", function () {
      server.close(function () {
        console.log("csp smoke: ok (policy installed on " + header.length + " chars)");
      });
    });
  }).on("error", function (err) {
    server.close();
    throw err;
  });
});
