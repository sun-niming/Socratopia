"use strict";

// Keep the webpack module 93536 copies byte-for-byte equivalent.  The source
// build is unavailable in this packaged repository, so this small mechanical
// synchronizer is the auditable single edit point for the five compiled copies.
var fs = require("fs");
var path = require("path");

var root = path.resolve(__dirname, "..");
var files = [
  path.join(root, "resources", "server", ".next", "server", "chunks", "7341.js"),
  path.join(root, "resources", "server", ".next", "server", "app", "api", "account", "init", "route.js"),
  path.join(root, "resources", "server", ".next", "server", "app", "api", "companion", "avatar", "route.js"),
  path.join(root, "resources", "server", ".next", "server", "app", "api", "pdf-assets", "route.js"),
  path.join(root, "resources", "server", ".next", "server", "app", "api", "profile", "reset", "route.js"),
];

var releaseRoot = path.join(root, "win-unpacked", "resources", "server");
files = files.concat([
  path.join(releaseRoot, ".next", "server", "chunks", "7341.js"),
  path.join(releaseRoot, ".next", "server", "app", "api", "account", "init", "route.js"),
  path.join(releaseRoot, ".next", "server", "app", "api", "companion", "avatar", "route.js"),
  path.join(releaseRoot, ".next", "server", "app", "api", "pdf-assets", "route.js"),
  path.join(releaseRoot, ".next", "server", "app", "api", "profile", "reset", "route.js"),
]);

function replaceModule(source) {
  var start = source.indexOf("93536:(a,b,c)=>");
  if (start < 0) throw new Error("module 93536 not found");
  var end = source.indexOf("},96487:()=>{}", start);
  if (end < 0) throw new Error("module 93536 terminator not found");
  var moduleText = source.slice(start, end);
  moduleText = moduleText.replace(
    /function k\(\)\{[^{}]*\}/,
    'function k(){let a=_accountContext(),b=a&&a.getAccountId();return b||null}'
  );
  var oldSetter = 'function l(a){if(!m(a))throw Error(`Invalid accountId: ${a}`);j=a}';
  moduleText = moduleText.replace(oldSetter, 'function l(a){if(!m(a))throw Error(`Invalid accountId: ${a}`);return a}');
  var handlerStart = moduleText.indexOf("function s(a){");
  if (handlerStart < 0) throw new Error("module 93536 pW handler not found");
  var handlerEnd = moduleText.length;
  var replacement = 'function s(a){return async function(b,c){let d=global.__SOCRATOPIA_ROUTE_AUTH__,e=!!b&&(typeof b.url==="string"||b.nextUrl);if(e){if(!d||typeof d.dispatch!=="function")return h.NextResponse.json({error:{code:"auth_unavailable",message:"Local request authentication is unavailable",status:503},code:"auth_unavailable"},{status:503});return d.dispatch(a,b,[c],d.pathOf?d.pathOf(b):"")}let f=_accountContext(),g=f&&f.getAccountId();return g?a(b,c):a(b,c)}}';
  moduleText = moduleText.slice(0, handlerStart) + replacement;
  return source.slice(0, start) + moduleText + source.slice(end);
}

var changed = 0;
files.forEach(function (file) {
  if (!fs.existsSync(file)) return;
  var before = fs.readFileSync(file, "utf8");
  var after = replaceModule(before);
  if (after !== before) {
    fs.writeFileSync(file, after, "utf8");
    changed++;
  }
});
console.log("synchronized module 93536 in " + changed + " bundle files");
