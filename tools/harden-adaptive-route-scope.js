"use strict";
var fs = require("fs");
var path = require("path");
var root = path.resolve(__dirname, "..");
var files = [
  path.join(root, "resources", "server", ".next", "server", "app", "api", "adaptive-teaching", "route.js"),
  path.join(root, "win-unpacked", "resources", "server", ".next", "server", "app", "api", "adaptive-teaching", "route.js"),
];
var scope = 'd.scope&&((d.scope.profileId!==undefined)||(d.scope.worldId!==undefined)||(d.scope.textbookId!==undefined)||(d.scope.conversationId!==undefined))&&b.auth.assertAccountScope&&b.auth.assertAccountScope(d,{profileId:f.profileId,worldId:f.worldId,textbookId:f.textbookId,conversationId:f.conversationId});';
var bodyScope = 'd.scope&&((d.scope.profileId!==undefined)||(d.scope.worldId!==undefined)||(d.scope.textbookId!==undefined)||(d.scope.conversationId!==undefined))&&b.auth.assertAccountScope&&b.auth.assertAccountScope(d,{profileId:e.profileId,worldId:e.worldId,textbookId:e.textbookId,conversationId:e.conversationId});';
files.forEach(function (file) {
  if (!fs.existsSync(file)) return;
  var source = fs.readFileSync(file, "utf8");
  source = source.replace('d=await b.auth.verifyRequest(a,f);b.auth.assertEligible(d,f);', 'd=await b.auth.verifyRequest(a,f);' + scope + 'b.auth.assertEligible(d,f);');
  source = source.replace('d=await b.auth.verifyRequest(a,e);b.auth.assertEligible(d,e);', 'd=await b.auth.verifyRequest(a,e);' + bodyScope + 'b.auth.assertEligible(d,e);');
  source = source.replace(/d=await b\.auth\.verifyRequest\(a,f\);b\.auth\.assertAccountScope&&b\.auth\.assertAccountScope\(d,\{profileId:f\.profileId,worldId:f\.worldId,textbookId:f\.textbookId,conversationId:f\.conversationId\}\);b\.auth\.assertEligible\(d,f\);/, 'd=await b.auth.verifyRequest(a,f);' + scope + 'b.auth.assertEligible(d,f);');
  source = source.replace(/d=await b\.auth\.verifyRequest\(a,e\);b\.auth\.assertAccountScope&&b\.auth\.assertAccountScope\(d,\{profileId:e\.profileId,worldId:e\.worldId,textbookId:e\.textbookId,conversationId:e\.conversationId\}\);b\.auth\.assertEligible\(d,e\);/, 'd=await b.auth.verifyRequest(a,e);' + bodyScope + 'b.auth.assertEligible(d,e);');
  fs.writeFileSync(file, source, "utf8");
});
console.log("hardened adaptive route scope checks");
