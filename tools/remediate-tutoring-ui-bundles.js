"use strict";

var fs = require("fs");
var path = require("path");

var root = path.resolve(__dirname, "..");
var pages = [
  "page-87daa6ca210ab9dc.js",
  "page-3a1fef7566e26c43.js",
  "page-practice-ui-20260622.js",
  "page-practice-ui-20260625-jyfix.js",
  "page-practice-ui-20260626-postclass-notes.js"
].map(function (name) {
  return path.join(root, "resources", "server", ".next", "static", "chunks", "app", name);
});

function replaceOnce(source, needle, replacement, label, file) {
  var count = source.split(needle).length - 1;
  if (count === 1) return source.replace(needle, replacement);
  if (count === 0 && source.indexOf(replacement) >= 0) return source;
  throw new Error(path.basename(file) + ": expected one " + label + ", found " + count);
}

pages.forEach(function (file) {
  var source = fs.readFileSync(file, "utf8");
  var original = source;
  source = replaceOnce(
    source,
    'let dec=new TextDecoder,buf="",full="";',
    'let dec=new TextDecoder,buf="",full="",tutorError=null;',
    "tutor error state",
    file
  );
  source = replaceOnce(
    source,
    'if(d.t==="done"||d.type==="done")break',
    'if(d.type==="error"){tutorError=d.error||"讲题回复未能保存"}if(d.t==="done"||d.type==="done"){if(d.ok===false)tutorError=tutorError||"讲题回复未能保存";break}',
    "tutor terminal event handling",
    file
  );
  source = replaceOnce(
    source,
    '}if(full)_tutMD(p=>[...p,{role:"assistant",content:full,id:"msg_"+Date.now().toString(36)}])',
    '}if(tutorError)throw Error(tutorError);if(full)_tutMD(p=>[...p,{role:"assistant",content:full,id:"msg_"+Date.now().toString(36)}])',
    "tutor persistence failure gate",
    file
  );
  source = replaceOnce(
    source,
    '}catch(e){if(e.name!=="AbortError")console.error("[tutoring] send:",e)}finally{_tutStrD(!1);_tutSCD("");_tutAbort.current=null}}',
    '}catch(e){if(e.name!=="AbortError"){console.error("[tutoring] send:",e);window.alert("讲题回复未能保存："+(e?.message||"请重试"))}}finally{_tutStrD(!1);_tutSCD("");_tutAbort.current=null}}',
    "visible tutor persistence failure",
    file
  );
  if (source !== original) fs.writeFileSync(file, source, "utf8");
  console.log((source === original ? "already patched " : "patched ") + path.relative(root, file));
});
