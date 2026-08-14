"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8").replace(/\r\n/g, "\n");
}

function write(relativePath, content) {
  fs.writeFileSync(path.join(root, relativePath), content, "utf8");
  console.log("patched " + relativePath);
}

function replaceOnce(content, before, after, label) {
  const count = content.split(before).length - 1;
  if (count !== 1) throw new Error(label + ": expected one anchor, found " + count);
  return content.replace(before, after);
}

function patchServer() {
  const file = "resources/server/server.js";
  let content = read(file);
  if (content.includes('"__CLOSE_READING__"')) return console.log("already patched " + file);
  content = replaceOnce(
    content,
    '  ["__MODEL_ROUTER__", "./lib/model-router.js", "[model-router]"]\n',
    '  ["__MODEL_ROUTER__", "./lib/model-router.js", "[model-router]"],\n' +
      '  ["__CLOSE_READING__", "./lib/close-reading/index.js", "[close-reading] Skill", function (m) { return m.enabled ? "enabled" : "disabled"; }]\n',
    "server global registration"
  );
  write(file, content);
}

function patchPdfWorker() {
  const file = "resources/server/lib/pdf-worker.mjs";
  let content = read(file);
  const patchResources = function (value) {
    value = replaceOnce(
      value,
      'function findPdfjsPath(subpath) {\n  return findDependencyPath(path.join("pdfjs-dist", subpath));\n}',
      'function findPdfjsPath(subpath) {\n  return findDependencyPath(path.join("pdfjs-dist", subpath));\n}\n\n' +
        'function pdfjsResourcePath(directory) {\n' +
        '  const fsPath = fileURLToPath(findPdfjsPath(directory)).replace(/\\\\/g, "/");\n' +
        '  return fsPath.endsWith("/") ? fsPath : fsPath + "/";\n' +
        '}',
      "PDF.js resource helper"
    );
    return replaceOnce(
      value,
      '    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),\n    useSystemFonts: true,',
      '    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),\n' +
        '    cMapUrl: pdfjsResourcePath("cmaps"),\n' +
        '    cMapPacked: true,\n' +
        '    standardFontDataUrl: pdfjsResourcePath("standard_fonts"),\n' +
        '    wasmUrl: pdfjsResourcePath("wasm"),\n' +
        '    iccUrl: pdfjsResourcePath("iccs"),\n' +
        '    useSystemFonts: true,',
      "PDF.js resource options"
    );
  };
  if (content.includes('case "render"')) {
    if (content.includes("function pdfjsResourcePath")) return console.log("already patched " + file);
    content = patchResources(content);
    write(file, content);
    return;
  }
  content = replaceOnce(
    content,
    " *   scan <filepath>                    — detect scanned PDF (JSON)\n",
    " *   scan <filepath>                    — detect scanned PDF (JSON)\n" +
      " *   render <filepath> <start> <end> [scale] — render pages as PNG base64 (JSON)\n",
    "worker usage"
  );
  content = replaceOnce(content, "function findPdfjsPath(subpath) {", "function findDependencyPath(subpath) {", "dependency resolver name");
  content = replaceOnce(content, 'path.join(__dirname, "..", ".next", "node_modules", "pdfjs-dist", subpath)', 'path.join(__dirname, "..", ".next", "node_modules", subpath)', "production dependency path");
  content = replaceOnce(content, 'path.join(__dirname, "..", "..", "node_modules", "pdfjs-dist", subpath)', 'path.join(__dirname, "..", "..", "node_modules", subpath)', "development dependency path");
  content = replaceOnce(content, 'path.join(root, "pdfjs-dist", subpath)', 'path.join(root, subpath)', "NODE_PATH dependency path");
  content = replaceOnce(
    content,
    "}\n\n// Polyfill DOM globals required by pdfjs-dist at module load time.",
    "}\n\nfunction findPdfjsPath(subpath) {\n" +
      '  return findDependencyPath(path.join("pdfjs-dist", subpath));\n' +
      "}\n\n" +
      "const [,, command, filePath, ...args] = process.argv;\n" +
      "let canvasModule = null;\n" +
      'if (command === "render") {\n' +
      '  canvasModule = await import(findDependencyPath(path.join("@napi-rs", "canvas", "index.js")));\n' +
      "}\n\n" +
      "// Polyfill DOM globals required by pdfjs-dist at module load time.",
    "worker dependency insertion"
  );
  content = replaceOnce(
    content,
    'if (typeof globalThis.DOMMatrix === "undefined") {',
    "if (canvasModule) {\n" +
      "  globalThis.DOMMatrix = canvasModule.DOMMatrix;\n" +
      "  globalThis.ImageData = canvasModule.ImageData;\n" +
      "  globalThis.Path2D = canvasModule.Path2D;\n" +
      '} else if (typeof globalThis.DOMMatrix === "undefined") {',
    "worker real canvas globals"
  );
  content = replaceOnce(
    content,
    "\nconst [,, command, filePath, ...args] = process.argv;\n\nasync function loadDoc()",
    "\nasync function loadDoc()",
    "worker duplicate argv"
  );
  content = replaceOnce(
    content,
    "\nasync function main() {",
    "\nfunction canvasFactory() {\n" +
      "  const { createCanvas } = canvasModule;\n" +
      "  return {\n" +
      '    create(w, h) { const canvas = createCanvas(w, h); return { canvas, context: canvas.getContext("2d") }; },\n' +
      "    reset(holder, w, h) { holder.canvas.width = w; holder.canvas.height = h; },\n" +
      "    destroy(holder) { holder.canvas.width = 0; holder.canvas.height = 0; },\n" +
      "  };\n" +
      "}\n\n" +
      "async function renderPage(doc, pageNum, scale) {\n" +
      '  if (!canvasModule) throw new Error("@napi-rs/canvas is required for PDF rendering");\n' +
      "  const page = await doc.getPage(pageNum);\n" +
      "  const viewport = page.getViewport({ scale });\n" +
      "  const canvas = canvasModule.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));\n" +
      '  const context = canvas.getContext("2d");\n' +
      "  await page.render({ canvasContext: context, viewport, canvasFactory: canvasFactory() }).promise;\n" +
      '  return canvas.toBuffer("image/png").toString("base64");\n' +
      "}\n\n" +
      "async function main() {",
    "worker render helper"
  );
  content = replaceOnce(
    content,
    "\n    default:\n",
    "\n    case \"render\": {\n" +
      '      const start = Math.max(1, parseInt(args[0] || "1", 10));\n' +
      '      const end = Math.min(numPages, parseInt(args[1] || String(start), 10));\n' +
      "      const scale = Math.min(3, Math.max(1, Number(args[2]) || 2));\n" +
      "      const pages = [];\n" +
      "      for (let i = start; i <= end; i++) {\n" +
      "        pages.push({ page: i, pngB64: await renderPage(doc, i, scale) });\n" +
      "      }\n" +
      "      console.log(JSON.stringify({ pages, metadata: { numPages }, scale }));\n" +
      "      break;\n" +
      "    }\n\n" +
      "    default:\n",
    "worker render command"
  );
  content = patchResources(content);
  write(file, content);
}

function patchChatRoute() {
  const file = "resources/server/.next/server/app/api/chat/route.js";
  let content = read(file);
  if (content.includes("_crActive")) return console.log("already patched " + file);
  content = replaceOnce(
    content,
    'let aa=w||p.$b[r]||p.$b.deepseek,ab=c[c.length-1]?.content??"",ac=F;',
    'let aa=w||p.$b[r]||p.$b.deepseek,ab=c[c.length-1]?.content??"",ac=F,_crActive=!!(global.__CLOSE_READING__&&global.__CLOSE_READING__.isCommand(ab)),_crResult=null;',
    "chat command detection"
  );
  content = replaceOnce(content, "if(1===c.length&&C&&!H&&ac&&await", "if(1===c.length&&C&&!H&&!_crActive&&ac&&await", "session plan guard");
  content = replaceOnce(content, "1===c.length&&C&&!H&&!S&&ac)try", "1===c.length&&C&&!H&&!S&&!_crActive&&ac)try", "initial page-load guard");
  const promptAnchor = ':await (0,o.Ex)(d,x,C,M,X,O,R,ac);let ae=[];';
  const promptReplacement = ':await (0,o.Ex)(d,x,C,M,X,O,R,ac);' +
    'if(_crActive){try{let _crFile=ac&&C?await (0,j.Wk)(x,C,ac):null,_crState=O?v.dq.get(O):null,_crBook=null;try{_crBook=(await (0,j.sd)(x,C)).find(a=>a.id===ac)||null}catch(_crMetaError){}' +
    '_crResult=await global.__CLOSE_READING__.execute({commandText:ab,messages:c,filePath:_crFile,currentPage:_crBook?.currentPage,windowStartPage:_crState?.windowStartPage,windowEndPage:_crState?.windowEndPage,teachingLanguage:X});' +
    '_crResult?.prompt&&(b+="\\n\\n"+_crResult.prompt)}catch(_crError){console.warn("[close-reading] execution failed:",_crError?.message||_crError);_crResult={active:!0,ok:!1,metadata:{error:_crError?.message||String(_crError)}}}}let ae=[];';
  content = replaceOnce(content, promptAnchor, promptReplacement, "chat evidence injection");
  content = replaceOnce(content, "let ah=N?void 0:af,ai=", "let ah=N||_crActive?void 0:af,ai=", "chat tool isolation");
  content = replaceOnce(
    content,
    "if(ad||S){let a=S?",
    'if(_crActive){let _crPage=_crResult?.metadata?.startPage||_crResult?.parsed?.startPage,_crLabel="english"===X?"Close reading PDF"+( _crPage?" page "+_crPage:""):"chinese-traditional"===X?"PDF 精讀"+(_crPage?"第 "+_crPage+" 頁":""):"PDF 精读"+(_crPage?"第 "+_crPage+" 页":"");d({type:"tool_use",name:"read_textbook_excerpt",label:_crLabel}),d({type:"tool_result",name:"read_textbook_excerpt",label:_crLabel,metadata:_crResult?.metadata||{}})}if(ad||S){let a=S?',
    "chat skill SSE"
  );
  content = replaceOnce(
    content,
    "if(O&&!H&&!N&&!(0,s.Q)(ab)&&C){if(ac){",
    "if(O&&!H&&!N&&!_crActive&&!(0,s.Q)(ab)&&C){if(ac){",
    "chat auto-advance guard"
  );
  write(file, content);
}

function patchFrontendBundles() {
  const directory = path.join(root, "resources/server/.next/static/chunks/app");
  const names = [
    "page-practice-ui-20260626-postclass-notes.js",
    "page-practice-ui-20260625-jyfix.js",
    "page-practice-ui-20260622.js",
    "page-3a1fef7566e26c43.js",
  ];
  const loader = '(()=>{try{if(typeof window!=="undefined"&&!window.__SOCRATOPIA_CLOSE_READING_MENU_LOADER__){window.__SOCRATOPIA_CLOSE_READING_MENU_LOADER__=!0;let e=document.createElement("script");e.src="/close-reading-skill-menu.js?v=20260806-2";e.defer=!0;(document.head||document.documentElement).appendChild(e)}}catch(e){}})();';
  for (const name of names) {
    const fullPath = path.join(directory, name);
    if (!fs.existsSync(fullPath)) continue;
    const relative = path.relative(root, fullPath).replace(/\\/g, "/");
    let content = fs.readFileSync(fullPath, "utf8");
    if (content.includes("__SOCRATOPIA_CLOSE_READING_MENU_LOADER__")) {
      if (!content.includes("/close-reading-skill-menu.js?v=20260806-2")) {
        content = content.replace("/close-reading-skill-menu.js", "/close-reading-skill-menu.js?v=20260806-2");
        write(relative, content);
      } else {
        console.log("already patched " + relative);
      }
      continue;
    }
    write(relative, loader + content);
  }
}

patchServer();
patchPdfWorker();
patchChatRoute();
patchFrontendBundles();
console.log("Close Reading patches complete");
