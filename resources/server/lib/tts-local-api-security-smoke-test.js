"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ttsRoot = process.env.SOCRATOPIA_TTS_ROOT || "D:\\model_tts\\GPT-SoVITS-1007-cu124\\GPT-SoVITS-1007-cu124";
const gsvi = fs.readFileSync(path.join(ttsRoot, "gsvi.py"), "utf8");

assert(!gsvi.includes('origin = ["*"]'), "local TTS CORS must not allow arbitrary web origins");
assert(gsvi.includes("allow_origin_regex="), "local TTS must restrict CORS to loopback web origins");
assert(gsvi.includes('code": "shutdown_disabled"'), "shutdown endpoint must be disabled when no infer key is configured");
assert(gsvi.includes("hmac.compare_digest"), "shutdown secret comparison must be constant-time");
assert(!gsvi.includes("wYdjEHnnjrNAahFsQ0yVmv1TEeUU9Z8A"), "hard-coded shutdown password must be removed");

console.log("tts local API security smoke: PASS");
