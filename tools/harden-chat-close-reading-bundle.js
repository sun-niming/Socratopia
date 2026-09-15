"use strict";

var fs = require("fs");
var path = require("path");
var root = path.resolve(__dirname, "..");
var files = [
  path.join(root, "resources", "server", ".next", "server", "app", "api", "chat", "route.js"),
  path.join(root, "win-unpacked", "resources", "server", ".next", "server", "app", "api", "chat", "route.js"),
];

var evidenceRules = [
  "## /Close_Reading compiled evidence rules",
  "下面的 <PDF_EVIDENCE> 是本轮唯一可引用的教材原文。",
  "source=text-layer 时，说明证据来自 PDF 内嵌文字层/可复制文本，不是本轮视觉 OCR。",
  "source=windows-ocr 时，说明证据来自本机 Windows OCR，并提示公式、表格、符号、大小写、下划线和代码换行可能有误。",
  "source=rapidocr-v5 时，说明证据来自随软件离线运行的 PP-OCRv5，并提示公式、表格、符号、大小写、下划线和代码换行可能有误。",
  "source=vision-transcription 时，说明证据来自本轮远程视觉转录，不得静默修正不确定代码字符。",
  "source=mixed 时，必须按 sourcesByPage 逐页说明来源。",
  "source=unresolved 时，明确没有取得可靠正文，不得用相邻页或常识补写。",
  "只有 successfulPages 可作为引用页；failedPages 必须保持失败语义。",
  "Close Reading 不改变普通课堂教学进度。",
].join("\\n");

files.forEach(function (file) {
  if (!fs.existsSync(file)) return;
  var source = fs.readFileSync(file, "utf8");
  if (source.indexOf("/Close_Reading compiled evidence rules") < 0) {
    var marker = "let adaptiveCore=";
    var index = source.indexOf(marker);
    if (index < 0) throw new Error("adaptiveCore marker missing: " + file);
    source = source.slice(0, index) + "let _compiledCloseReadingRules=" + JSON.stringify(evidenceRules) + ";" + source.slice(index);
  }
  source = source.replace(
    '_crResult?.prompt&&(b+="\\n\\n"+_crResult.prompt)',
    '_crResult?.prompt&&(b+="\\n\\n"+_crResult.prompt+"\\n\\n"+_compiledCloseReadingRules)'
  );
  source = source.replace(
    'textbookId:ac,accountId:_ocrFence.accountId,sessionEpoch:_ocrFence.sessionEpoch',
    'textbookId:ac,conversationId:O,worldDir:(0,B.Uu)(x,C,ac),accountId:_ocrFence.accountId,sessionEpoch:_ocrFence.sessionEpoch'
  );
  source = source.replace(
    'conversationId:O,worldDir:(0,B.Uu)(x,C),accountId:_ocrFence.accountId',
    'conversationId:O,worldDir:(0,B.Uu)(x,C,ac),accountId:_ocrFence.accountId'
  );
  source = source.replace(
    '(0,z.WS)(c2,a2,b2,30,{profileId:x,worldId:C,textbookId:ac,conversationId:O,worldDir:(0,B.Uu)(x,C,ac),accountId:_ocrFence.accountId',
    '(0,z.WS)(c2,a2,b2,30,{profileId:x,worldId:C,textbookId:ac,accountId:_ocrFence.accountId'
  );
  source = source.replace(
    '_crAccountContext=global.__SOCRATOPIA_ACCOUNT_CONTEXT__&&global.__SOCRATOPIA_ACCOUNT_CONTEXT__(),_crActive=!!(global.__CLOSE_READING__&&global.__CLOSE_READING__.isCommand(ab)),_crResult=null;',
    '_crAccountContext=global.__SOCRATOPIA_ACCOUNT_CONTEXT__&&global.__SOCRATOPIA_ACCOUNT_CONTEXT__(),_crActive=!!(global.__CLOSE_READING__&&global.__CLOSE_READING__.isCommand(ab)),_crResult=null,_crMemoryWorldDir=null;'
  );
  source = source.replace(
    'let _crFile=ac&&C?await (0,j.Wk)(x,C,ac):null,_crState=',
    'let _crFile=ac&&C?await (0,j.Wk)(x,C,ac):null;_crMemoryWorldDir=_crFile?g().dirname(g().dirname(g().dirname(_crFile))):null;let _crState='
  );
  source = source.replace(
    'let _crFile=ac&&C?await (0,j.Wk)(x,C,ac):null;_crMemoryWorldDir=_crFile?g().dirname(g().dirname(_crFile)):null;let _crState=',
    'let _crFile=ac&&C?await (0,j.Wk)(x,C,ac):null;_crMemoryWorldDir=_crFile?g().dirname(g().dirname(g().dirname(_crFile))):null;let _crState='
  );
  var done = 'd({type:"done",readingVersion:_advanceComplete?.readingVersion,stateGeneration:_advanceComplete?.stateGeneration,causalConversationRevision:_advanceComplete?.causalConversationRevision,parentAssistantMessageId:_advanceComplete?.parentAssistantMessageId||_assistantMessageId})';
  var save = 'if(_crActive&&_crResult?.ok&&global.__CLOSE_READING__&&typeof global.__CLOSE_READING__.rememberResponse==="function"&&O&&C){try{let _crTextbookDir=(0,B.Uu)(x,C,ac),_crWorldDir=_crMemoryWorldDir||g().dirname(g().dirname(_crTextbookDir));global.__CLOSE_READING__.rememberResponse({worldDir:_crWorldDir,conversationId:O,accountId:_ocrFence.accountId},k)}catch{}}';
  var savePrefix = 'if(_crActive&&_crResult?.ok&&global.__CLOSE_READING__&&typeof global.__CLOSE_READING__.rememberResponse==="function"&&O&&C){';
  var saveStart = source.indexOf(savePrefix);
  if (saveStart >= 0) {
    var saveEnd = source.indexOf(done, saveStart);
    if (saveEnd >= 0) source = source.slice(0, saveStart) + save + source.slice(saveEnd);
  } else {
    source = source.replace(done, save + done);
  }
  fs.writeFileSync(file, source, "utf8");
});
console.log("hardened compiled Close Reading evidence rules and memory handoff");
