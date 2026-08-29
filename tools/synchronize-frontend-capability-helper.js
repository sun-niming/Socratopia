"use strict";

// Module 1292 is duplicated in the packaged page variants.  Replace all copies
// with the same renderer-side capability adapter: every account API request gets
// a fresh short-lived Authorization header, while raw account selectors are
// never emitted by the renderer.
var fs = require("fs");
var path = require("path");

var root = path.resolve(__dirname, "..");
var names = [
  "page-3a1fef7566e26c43.js",
  "page-87daa6ca210ab9dc.js",
  "page-f5f46cb5daf146a1.js",
  "page-practice-ui-20260622.js",
  "page-practice-ui-20260625-jyfix.js",
  "page-practice-ui-20260626-postclass-notes.js",
];
var files = [];
names.forEach(function (name) {
  files.push(path.join(root, "resources", "server", ".next", "static", "chunks", "app", name));
  files.push(path.join(root, "win-unpacked", "resources", "server", ".next", "static", "chunks", "app", name));
});

var replacement = '1292:(e,t,r)=>{"use strict";r.d(t,{n:()=>n,y:()=>s,z:()=>l});var a=r(1660);function v(e){return typeof e==="string"&&e.length>=16&&e.length<=8192&&!/[\\x00-\\x20\\x7f]/.test(e)}async function o(){let e=window.electronAPI,t=e&&(typeof e.getCapability==="function"?e.getCapability:typeof e.getAdaptiveCapability==="function"?e.getAdaptiveCapability:null);if(!t)throw Error("auth_unavailable");let r=await t();if(!v(r))throw Error("auth_unavailable");return r}function p(e){try{return new URL(typeof e==="string"?e:e&&e.url||"",typeof location!=="undefined"&&location.href||"http://127.0.0.1").pathname.startsWith("/api/")}catch{return!1}}if(typeof globalThis!=="undefined"&&!globalThis.__SOCRATOPIA_CAPABILITY_FETCH__&&typeof globalThis.fetch==="function"){let e=globalThis.fetch.bind(globalThis);globalThis.__SOCRATOPIA_NATIVE_FETCH__=e,globalThis.fetch=async function(t,r){if(!p(t))return e(t,r);let a=new Headers(r?.headers);a.delete("Authorization"),a.delete("X-Account-Id");if(!a.has("X-Device-Id")){let e=localStorage.getItem("socratopia_hw_device_id");e&&a.set("X-Device-Id",e)}let n=await o();a.set("Authorization","Socratopia "+n);return e(t,{...r,headers:a})},globalThis.__SOCRATOPIA_CAPABILITY_FETCH__=!0}async function n(e,t){let r=new Headers(t?.headers);r.delete("Authorization"),r.delete("X-Account-Id");if(!r.has("X-Device-Id")){let e=localStorage.getItem("socratopia_hw_device_id");e&&r.set("X-Device-Id",e)}let a=await o();r.set("Authorization","Socratopia "+a);let n=globalThis.__SOCRATOPIA_NATIVE_FETCH__||fetch;return n(e,{...t,headers:r})}function u(e,t){return n(e,t)}function s(e){return e}async function l(e,t){try{return await n(e,t)}catch(e){if(e?.name==="AbortError")throw e;throw Error("stage_c_request_uncertain")}}}';

function replace(source) {
  var start = source.indexOf("1292:(e,t,r)=>");
  if (start < 0) throw new Error("module 1292 not found");
  var end = source.indexOf("},1551:", start);
  var cut = end + 1;
  if (end < 0) {
    end = source.indexOf("},,1551:", start);
    if (end < 0) throw new Error("module 1292 terminator not found");
    cut = end + 2;
  }
  return source.slice(0, start) + replacement + source.slice(cut);
}

var changed = 0;
files.forEach(function (file) {
  if (!fs.existsSync(file)) return;
  var before = fs.readFileSync(file, "utf8");
  var after = replace(before);
  if (before !== after) { fs.writeFileSync(file, after, "utf8"); changed++; }
});
console.log("synchronized frontend capability helper in " + changed + " bundle files");
