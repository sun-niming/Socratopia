"use strict";

// ---------------------------------------------------------------------------
// Content-Security-Policy for the Socratopia renderer.
//
// The Electron window loads the local Next.js app from http://127.0.0.1:<port>.
// Everything the renderer needs is same-origin: scripts, styles, fonts, images
// and every API call.  The only foreign references in the shipped bundles are
// link targets the user may click (https://socratopia.app) and the SVG
// namespace URI - neither is a fetch, so a self-only policy is safe.
//
// Why the two "unsafe" keywords stay:
//   * 'unsafe-inline' in script-src - Next.js ships a pre-rendered inline
//     bootstrap script (self.__next_f.push) and this repo has no build step
//     that could re-sign it with a nonce.
//   * 'unsafe-eval' in script-src - the bundled React/antd code still calls
//     eval().
// Both are recorded in docs/reviews/2026-11-漏洞筛查与点评.md (V-01) as the
// remaining gap; the win of this policy is that no remote origin may serve
// script, style, image or XHR traffic, so a renderer XSS cannot phone home.
//
// The placeholder API base baked into the shipped bundle is
// http://127.0.0.1:9 (NEXT_PUBLIC_API_URL is unset in the packaged build), so
// that exact origin is allowed for images - not for connections.
// connect-src also allows the two loopback origins the renderer is allowed to
// talk to: the cloud placeholder (127.0.0.1:9, which the bundled fetch shim
// turns into an offline answer) and the local speech service
// (127.0.0.1:8000, used by the /infer_classic path). Loopback stays on the
// machine, so this does not give an injected script a remote exfiltration
// channel - but leaving it out would break local TTS streaming.
// ---------------------------------------------------------------------------

const HEADER_NAME = "Content-Security-Policy";

const LOOPBACK = ["http://127.0.0.1:9", "http://127.0.0.1:8000"];

const POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: " + LOOPBACK.join(" "),
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "connect-src 'self' " + LOOPBACK.join(" "),
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'"
].join("; ");

function contentSecurityPolicy() {
  return POLICY;
}

function isCspHeaderName(name) {
  return typeof name === "string" && name.toLowerCase() === "content-security-policy";
}

// installCsp() adds the policy to every response the local server sends.
// It is idempotent, never overwrites a policy another layer already set, and
// survives responses that go out through writeHead() with a header object.
function installCsp() {
  const http = require("http");
  const proto = http.ServerResponse && http.ServerResponse.prototype;
  if (!proto || typeof proto.setHeader !== "function") return false;
  if (proto.setHeader.__socratopiaCsp) return true;

  const setHeader = proto.setHeader;
  const patchedSetHeader = function (name, value) {
    if (!isCspHeaderName(name)) {
      try {
        setHeader.call(this, HEADER_NAME, POLICY);
      } catch (err) {
        // headers already sent - nothing to add
      }
    }
    return setHeader.call(this, name, value);
  };
  patchedSetHeader.__socratopiaCsp = true;
  proto.setHeader = patchedSetHeader;

  if (typeof proto.writeHead === "function" && !proto.writeHead.__socratopiaCsp) {
    const writeHead = proto.writeHead;
    const patchedWriteHead = function () {
      try {
        if (!this.headersSent) setHeader.call(this, HEADER_NAME, POLICY);
      } catch (err) {
        // headers already sent - nothing to add
      }
      return writeHead.apply(this, arguments);
    };
    patchedWriteHead.__socratopiaCsp = true;
    proto.writeHead = patchedWriteHead;
  }

  return true;
}

module.exports = {
  HEADER_NAME: HEADER_NAME,
  POLICY: POLICY,
  contentSecurityPolicy: contentSecurityPolicy,
  installCsp: installCsp
};
