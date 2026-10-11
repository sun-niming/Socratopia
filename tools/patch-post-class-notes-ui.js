"use strict";

// PN-009 — move the concept-review UI from a blocking POST to a polled job.
//
// The repo ships five page bundles that are patched in lockstep (only one is
// ever loaded, but all five are asserted by frontend smoke tests), so this
// follows the same `replaceOnce` discipline as
// `remediate-tutoring-ui-bundles.js`: exactly one hit per bundle, idempotent.
//
//   node tools/patch-post-class-notes-ui.js           # patch
//   node tools/patch-post-class-notes-ui.js --check   # verify only
//
// Plan: POST_CLASS_NOTES_QUALITY_RELIABILITY_DEVELOPMENT_PLAN.md §8.

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

// --------------------------------------------------------------- new pieces

// Helpers are injected as extra bindings on the component's `let` list. No
// backticks and no `${}` on purpose: this text is spliced into a minified file
// that already contains template literals.
var HELPERS = [
  "PCRUN=(0,n.useRef)(0),PCJOB=(0,n.useRef)(null),",
  "pcLang=()=>{let a=I.current.teachingLanguage;return \"english\"===a?\"en\":\"chinese-traditional\"===a?\"zh-TW\":\"zh\"},",
  "pcText=(o)=>{let g=pcLang(),k=o.code||\"internal_error\",M={",
  "upstream_html_response:{zh:\"模型服务当前被网关拦截，请稍后重试。\",\"zh-TW\":\"模型服務目前被閘道攔截，請稍後重試。\",en:\"The model service is behind an intercepting gateway right now. Please retry shortly.\"},",
  "upstream_timeout:{zh:\"模型服务响应过慢，已保留生成进度。\",\"zh-TW\":\"模型服務回應過慢，已保留生成進度。\",en:\"The model service is responding slowly. Generation progress has been kept.\"},",
  "upstream_auth:{zh:\"模型地址和 API Key 不匹配。\",\"zh-TW\":\"模型位址與 API Key 不相符。\",en:\"The model endpoint and API key do not match.\"},",
  "upstream_rate_limit:{zh:\"模型服务繁忙，请稍后继续。\",\"zh-TW\":\"模型服務繁忙，請稍後繼續。\",en:\"The model service is busy. Please continue shortly.\"},",
  "upstream_network:{zh:\"网络连接模型服务失败，请检查网络后重试。\",\"zh-TW\":\"網路連線模型服務失敗，請檢查網路後重試。\",en:\"Could not reach the model service. Check the network and retry.\"},",
  "upstream_server:{zh:\"模型服务暂时不可用，请稍后重试。\",\"zh-TW\":\"模型服務暫時無法使用，請稍後重試。\",en:\"The model service is temporarily unavailable.\"},",
  "output_truncated:{zh:\"模型输出不完整，正在从检查点重试。\",\"zh-TW\":\"模型輸出不完整，正在從檢查點重試。\",en:\"The model output was cut short; retrying from the checkpoint.\"},",
  "quality_rejected:{zh:\"笔记完整度不足，正在重新整理。\",\"zh-TW\":\"筆記完整度不足，正在重新整理。\",en:\"The notes were not complete enough; reorganizing.\"},",
  "persist_failed:{zh:\"笔记已生成，但保存失败；可直接重试保存。\",\"zh-TW\":\"筆記已產生，但儲存失敗；可直接重試儲存。\",en:\"The notes were generated but could not be saved.\"},",
  "missing_dependency:{zh:\"课后笔记模块未加载。\",\"zh-TW\":\"課後筆記模組未載入。\",en:\"The post-class notes module is not loaded.\"},",
  "cancelled:{zh:\"生成已取消。\",\"zh-TW\":\"產生已取消。\",en:\"Generation was cancelled.\"},",
  "internal_error:{zh:\"生成课后笔记时发生内部错误。\",\"zh-TW\":\"產生課後筆記時發生內部錯誤。\",en:\"An internal error occurred while generating the notes.\"}};",
  "return ((M[k]||M.internal_error)[g]||\"\")+(o.traceId?\"  (\"+o.traceId+\")\":\"\")},",
  "pcDegraded=()=>{let g=pcLang();return \"en\"===g?\"Assembled from the saved progress \\u2014 some detail may be thinner than usual.\":\"zh-TW\"===g?\"已使用保底整理，細節可能比平常略少。\":\"已使用保底整理，细节可能比平常略少。\"},",
  "pcStage=(o)=>{let g=pcLang(),n=String(o.stage||\"\"),c=o.completedChunks||0,u=o.totalChunks||0,T=u>1?\" \"+c+\"/\"+u:\"\",M={",
  "created:[\"正在整理课堂内容\",\"正在整理課堂內容\",\"Preparing the lesson\"],",
  "partitioning:[\"正在整理课堂内容\",\"正在整理課堂內容\",\"Preparing the lesson\"],",
  "mapping:[u>1?\"正在提取第\"+c+\"/\"+u+\"段重点\":\"正在提取重点\",u>1?\"正在提取第\"+c+\"/\"+u+\"段重點\":\"正在提取重點\",u>1?\"Extracting part\"+T:\"Extracting key points\"],",
  "reducing:[\"正在合并完整笔记\",\"正在合併完整筆記\",\"Merging the full notes\"],",
  "validating:[\"正在检查遗漏\",\"正在檢查遺漏\",\"Checking for gaps\"],",
  "persisting:[\"正在保存\",\"正在儲存\",\"Saving\"]};",
  "let r=M[n]||M.partitioning;return \"en\"===g?r[2]:\"zh-TW\"===g?r[1]:r[0]},"
].join("");

// The generate callback now starts (or resumes) a job and polls it. Cadence per
// §8.2: 1.5s, 3s after 30s, 8s while the window is in the background.
var GENERATE = [
  "z=(0,n.useCallback)(async(w)=>{",
  "let token=PCRUN.current+1;PCRUN.current=token;",
  "S({kind:\"generating\",stageText:pcStage({stage:\"partitioning\"})});",
  "let api=j&&\"function\"==typeof j.n?j.n:fetch,",
  "post=async(act,extra)=>{let q=I.current;return api(\"/api/concept-summary\",{method:\"POST\",headers:{\"Content-Type\":\"application/json\"},body:JSON.stringify(Object.assign({action:act,messages:q.messages,companionName:q.companionName,textbookTitle:q.textbookTitle,teachingLanguage:q.teachingLanguage,profileId:e,worldId:t,conversationId:r,accessMode:q.accessMode,apiKey:q.apiKey,provider:q.provider,model:q.model,sessionToken:(0,c.mj)()||void 0},extra||{}))})};",
  "try{",
  "let res=await post(w?\"retry\":\"start\",w?{jobId:w}:void 0),body=await res.json().catch(()=>({}));",
  "if(PCRUN.current!==token)return;",
  "if(!res.ok)throw Object.assign(Error(body.error||\"HTTP \"+res.status),{code:body.code,traceId:body.traceId});",
  "if(body.summary){S({kind:\"ready\",summary:body.summary,degradedText:body.degraded?pcDegraded():\"\"});return}",
  "if(body.jobId)PCJOB.current=body.jobId;",
  "let started=Date.now(),jobId=body.jobId;",
  "for(;;){let delay=Date.now()-started>30000?3000:1500;if(\"undefined\"!=typeof document&&document.hidden)delay=8000;",
  "await new Promise(p=>setTimeout(p,delay));if(PCRUN.current!==token)return;",
  "let sr=await post(\"status\",{jobId:jobId}),sb=await sr.json().catch(()=>({}));",
  "if(PCRUN.current!==token)return;",
  "if(!sr.ok)throw Object.assign(Error(sb.error||\"HTTP \"+sr.status),{code:sb.code,traceId:sb.traceId});",
  "if((\"ready\"===sb.status||\"degraded\"===sb.status)&&sb.summary){S({kind:\"ready\",summary:sb.summary,degradedText:\"degraded\"===sb.status?pcDegraded():\"\"});return}",
  // A terminal status without a summary means the note could not be read back;
  // rendering it would crash on `summary.sections`. Surface it as a coded
  // error (with retry) instead — the server demotes such jobs to `failed` on
  // the next poll anyway.
  "if(\"ready\"===sb.status||\"degraded\"===sb.status)throw Object.assign(Error(\"\"),{code:sb.code||\"persist_failed\",traceId:sb.traceId});",
  "if(\"failed\"===sb.status||\"cancelled\"===sb.status)throw Object.assign(Error(\"\"),{code:sb.code||\"internal_error\",traceId:sb.traceId});",
  "S({kind:\"generating\",stageText:pcStage(sb)})}",
  "}catch(err){if(PCRUN.current!==token)return;S({kind:\"error\",message:pcText({code:err&&err.code,message:err&&err.message,traceId:err&&err.traceId}),code:err&&err.code})}},[e,t,r]),",
  "pcRetry=(0,n.useCallback)(async()=>{PCRUN.current=PCRUN.current+1;await z(PCJOB.current||void 0)},[z]);"
].join("");

// On mount: cached note first, then adopt a job left behind by a previous visit
// (the page may have been closed mid-generation), then start fresh.
var MOUNT = [
  "(0,n.useEffect)(()=>{let a=!1;return(async()=>{",
  "try{",
  "let n=await (j&&\"function\"==typeof j.n?j.n:fetch)(`/api/concept-summary?profileId=${encodeURIComponent(e)}&worldId=${encodeURIComponent(t)}&conversationId=${encodeURIComponent(r)}`);",
  "if(a)return;",
  "if(n.ok){let{summary:e}=await n.json();S({kind:\"ready\",summary:e});return}",
  "let sr=await (j&&\"function\"==typeof j.n?j.n:fetch)(\"/api/concept-summary\",{method:\"POST\",headers:{\"Content-Type\":\"application/json\"},body:JSON.stringify({action:\"status\",profileId:e,worldId:t,conversationId:r})});",
  "if(a)return;",
  "if(sr.ok){let sb=await sr.json().catch(()=>({}));",
  "if(sb&&sb.jobId){PCJOB.current=sb.jobId;",
  "if((\"ready\"===sb.status||\"degraded\"===sb.status)&&sb.summary){S({kind:\"ready\",summary:sb.summary,degradedText:\"degraded\"===sb.status?pcDegraded():\"\"});return}",
  "await z(sb.jobId);return}}",
  "await z()}catch{a||await z()}})(),()=>{a=!0;PCRUN.current=PCRUN.current+1}},[e,t,r,z]);"
].join("");

// --------------------------------------------------------------- old pieces

var OLD_GENERATE_START = "z=(0,n.useCallback)(async()=>{S({kind:\"generating\"});try{";
var OLD_GENERATE_END = "}},[e,t,r]);";
var OLD_MOUNT = "(0,n.useEffect)(()=>{let a=!1;return(async()=>{try{let n=await (j&&\"function\"==typeof j.n?j.n:fetch)(`/api/concept-summary?profileId=${encodeURIComponent(e)}&worldId=${encodeURIComponent(t)}&conversationId=${encodeURIComponent(r)}`);if(a)return;if(n.ok){let{summary:e}=await n.json();S({kind:\"ready\",summary:e});return}a||await z()}catch{a||await z()}})(),()=>{a=!0}},[e,t,r,z]);";

var EDITS = [
  {
    label: "generate callback becomes start+resume with polling",
    from: function (source) {
      var start = source.indexOf(OLD_GENERATE_START);
      if (start < 0) return null;
      var end = source.indexOf(OLD_GENERATE_END, start);
      if (end < 0) return null;
      return source.slice(start, end + OLD_GENERATE_END.length);
    },
    to: HELPERS + GENERATE
  },
  {
    label: "mount effect adopts an existing job before starting one",
    from: OLD_MOUNT,
    to: MOUNT
  },
  {
    label: "spinner shows the current stage",
    from: "\"generating\"===C.kind&&(0,a.jsx)(nE,{t:N})",
    to: "\"generating\"===C.kind&&(0,a.jsx)(nE,{t:N,stageText:C.stageText})"
  },
  {
    label: "spinner component accepts stage text",
    from: "function nE({t:e,silent:t=!1}){let r=e(t?\"concept.review.loadingCache\":\"concept.review.generating\");",
    to: "function nE({t:e,silent:t=!1,stageText:s}){let r=s||e(t?\"concept.review.loadingCache\":\"concept.review.generating\");"
  },
  {
    label: "retry button resumes the failed job instead of restarting blindly",
    from: "(0,a.jsx)(n$,{message:C.message,onRetry:z,t:N})",
    to: "(0,a.jsx)(n$,{message:C.message,onRetry:pcRetry,t:N})"
  },
  {
    label: "ready view receives the degraded hint",
    from: "\"ready\"===C.kind&&(0,a.jsx)(nz,{summary:C.summary,learnerName:d,t:N})",
    to: "\"ready\"===C.kind&&(0,a.jsx)(nz,{summary:C.summary,learnerName:d,t:N,degradedText:C.degradedText})"
  },
  {
    label: "section list renders the degraded hint",
    from: "function nz({summary:e,learnerName:t,t:r}){let n=(e.sections||[]).filter(nD);return 0===n.length?(0,a.jsx)(nI,{t:r}):(0,a.jsxs)(\"div\",{className:\"concept-review__sections space-y-10\",children:[e.pagesRange&&",
    to: "function nz({summary:e,learnerName:t,t:r,degradedText:dg}){let n=(e.sections||[]).filter(nD);return 0===n.length?(0,a.jsx)(nI,{t:r}):(0,a.jsxs)(\"div\",{className:\"concept-review__sections space-y-10\",children:[dg&&(0,a.jsx)(\"div\",{className:\"concept-review__meta text-[12px] mb-4\",style:{color:\"var(--foreground)\",opacity:.6},children:dg}),e.pagesRange&&"
  }
];

var LEDGER = "post-class-notes-ui-v1";

function replaceOnce(source, needle, replacement, label, file) {
  var count = source.split(needle).length - 1;
  if (count === 1) return source.replace(needle, replacement);
  if (count === 0 && source.indexOf(replacement) >= 0) return source;
  throw new Error(path.basename(file) + ": expected one " + label + ", found " + count);
}

function applyEdits(file, checkOnly) {
  var source = fs.readFileSync(file, "utf8");
  var original = source;
  var applied = 0;

  // The first edit rewrites a range whose bounds are found, not a fixed string.
  var first = EDITS[0];
  var firstFrom = first.from(source);
  if (firstFrom) {
    source = source.replace(firstFrom, first.to);
    applied += 1;
  } else if (source.indexOf(first.to) < 0) {
    throw new Error(path.basename(file) + ": " + first.label + " — anchor not found");
  }

  for (var i = 1; i < EDITS.length; i++) {
    var edit = EDITS[i];
    var before = source;
    source = replaceOnce(source, edit.from, edit.to, edit.label, file);
    if (source !== before) applied += 1;
  }

  // `PCRUN` is the marker: it only exists in the patched form.
  if (!checkOnly && source !== original) fs.writeFileSync(file, source, "utf8");
  return { changed: source !== original, applied: applied, patched: source.indexOf("PCRUN") >= 0 };
}

function main() {
  var checkOnly = process.argv.indexOf("--check") >= 0;
  var failures = [];
  pages.forEach(function (file) {
    try {
      var result = applyEdits(file, checkOnly);
      var state = result.patched ? (result.changed ? "patched" : "already patched") : "NOT PATCHED";
      if (!result.patched) failures.push(path.basename(file));
      console.log(state + "  " + path.relative(root, file));
    } catch (error) {
      failures.push(path.basename(file) + ": " + error.message);
      console.log("FAILED  " + path.relative(root, file) + " — " + error.message);
    }
  });
  if (failures.length) {
    console.error("\n" + failures.length + " bundle(s) not patched");
    process.exitCode = 1;
    return;
  }
  console.log("\nall " + pages.length + " bundles carry " + LEDGER);
}

main();
