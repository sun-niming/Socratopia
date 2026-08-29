"use strict";

// Install the common capability gate around routes that do not use the shared
// webpack account helper (module 93536).  The generated route bundles are the
// runtime source in this packaged repository; keep root and win-unpacked copies
// in lockstep.
var fs = require("fs");
var path = require("path");

var root = path.resolve(__dirname, "..");
var routeNames = [
  "adaptive-concept-graph",
  "adaptive-diagnosis",
  "knowledge-source",
  "long-reasoning-demo",
  "practice",
  "test-key",
  "tts-audio",
];

var files = [];
function addTree(base) {
  routeNames.forEach(function (name) { files.push(path.join(base, name, "route.js")); });
}
addTree(path.join(root, "resources", "server", ".next", "server", "app", "api"));
addTree(path.join(root, "win-unpacked", "resources", "server", ".next", "server", "app", "api"));

function wrapper(routeName, bindings) {
  var body = ';(()=>{let __ra=global.__SOCRATOPIA_ROUTE_AUTH__,__err=()=>new Response(JSON.stringify({error:{code:"auth_unavailable",message:"Local request authentication is unavailable",status:503},code:"auth_unavailable"}),{status:503,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"private, no-store"}});';
  bindings.forEach(function (binding, index) {
    body += 'if(typeof ' + binding.name + '==="function"){let __f' + index + '=' + binding.name + ';' + binding.name + '=function(a,...b){let __http=!!a&&(typeof a.url==="string"||a.nextUrl);return __ra&&typeof __ra.dispatch==="function"?__ra.dispatch(__f' + index + ',a,b,"/api/' + routeName + '"):__http?__err():__f' + index + '(a,...b)}}';
  });
  return body + '})();';
}

files.forEach(function (file) {
  if (!fs.existsSync(file)) return;
  var source = fs.readFileSync(file, "utf8");
  var routeName = routeNames.filter(function (name) { return file.replace(/\\/g, "/").indexOf("/" + name + "/route.js") >= 0; })[0];
  if (!routeName) return;
  var exportMatch = /c\.d\(d,\{([^}]*)\}\)/.exec(source);
  if (!exportMatch) throw new Error("route export map missing: " + file);
  var bindings = [];
  var bindingRe = /([A-Z][A-Za-z0-9_$]*):\(\)=>\s*([A-Za-z_$][A-Za-z0-9_$]*)/g;
  var match;
  while ((match = bindingRe.exec(exportMatch[1]))) bindings.push({ method: match[1], name: match[2] });
  bindings = bindings.filter(function (binding) { return binding.method !== "MAXDURATION" && binding.method !== "maxDuration"; });
  if (!bindings.length) throw new Error("no route handlers in export map: " + file);
  var existing = source.indexOf("global.__SOCRATOPIA_ROUTE_AUTH__");
  if (existing >= 0) {
    var oldStart = source.lastIndexOf(";(()=>{", existing);
    var oldEnd = source.indexOf("})();", existing);
    if (oldStart >= 0 && oldEnd >= 0) source = source.slice(0, oldStart) + wrapper(routeName, bindings) + source.slice(oldEnd + 5);
    fs.writeFileSync(file, source, "utf8");
    return;
  }
  var marker = "let x=new e.AppRouteRouteModule";
  var index = source.indexOf(marker);
  if (index < 0) throw new Error("route module marker missing: " + file);
  source = source.slice(0, index) + wrapper(routeName, bindings) + source.slice(index);
  fs.writeFileSync(file, source, "utf8");
});
console.log("installed capability wrappers for " + routeNames.length + " route kinds");
