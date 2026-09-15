"use strict";exports.id=2751,exports.ids=[2751],exports.modules={24073:(a,b,c)=>{c.d(b,{NE:()=>f,Tz:()=>e});var g=c(29021),h=c(74075);let d={".pdf":"pdf",".md":"markdown",".markdown":"markdown",".epub":"epub",".qbook":"qbook",".pptx":"pptx"};function e(a){return d[a.toLowerCase().replace(/^.*(\.[^.]+)$/,"$1")]??null}function i(a){let b=(0,g.readFileSync)(a),c=-1;for(let a=b.length-22;a>=Math.max(0,b.length-65558);a--)if(101010256===b.readUInt32LE(a)){c=a;break}if(c<0)throw Error("Invalid PPTX/ZIP file");let d=b.readUInt16LE(c+10),e=b.readUInt32LE(c+16),f=new Map;for(let a=0;a<d;a++){if(33639248!==b.readUInt32LE(e))throw Error("Invalid PPTX central directory");let a=b.readUInt16LE(e+10),c=b.readUInt32LE(e+20),d=b.readUInt16LE(e+28),i=b.readUInt16LE(e+30),j=b.readUInt16LE(e+32),k=b.readUInt32LE(e+42),l=b.slice(e+46,e+46+d).toString("utf-8");e+=46+d+i+j;if(67324752!==b.readUInt32LE(k))continue;let m=b.readUInt16LE(k+26),n=b.readUInt16LE(k+28),o=b.slice(k+30+m+n,k+30+m+n+c);0===a?f.set(l,o):8===a&&f.set(l,h.inflateRawSync(o))}return f}function j(a){return String(a||"").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&apos;/g,"'")}function k(a){let b=[],c=/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g,d;for(;null!==(d=c.exec(a));){let a=j(d[1]).replace(/\s+/g," ").trim();a&&b.push(a)}return b.join("\n").trim()}function l(a,b){let c=a.get("docProps/core.xml");if(!c)return null;let d=c.toString("utf-8"),e=d.match(RegExp("<(?:[^:>]+:)?"+b+"\\b[^>]*>([\\s\\S]*?)</(?:[^:>]+:)?"+b+">"));return e?j(e[1]).trim()||null:null}function n(a){let b=i(a),c=Array.from(b.keys()).filter(a=>/^ppt\/slides\/slide\d+\.xml$/i.test(a)).sort((a,b)=>Number((a.match(/slide(\d+)\.xml/i)||[0,0])[1])-Number((b.match(/slide(\d+)\.xml/i)||[0,0])[1])),d=[];for(let a=0;a<c.length;a++){let e=k(b.get(c[a]).toString("utf-8"));e&&d.push({pageNum:a+1,title:(e.split(/\n/)[0]||"").slice(0,80)||void 0,text:e})}return{entries:b,pages:d,slideCount:c.length}}class o{async getMetadata(a){let{entries:b,pages:c,slideCount:d}=n(a),e=l(b,"created"),f=e&&e.match(/(\d{4})/);return{title:l(b,"title"),author:l(b,"creator"),year:f?f[1]:null,description:null,language:null,numPages:Math.max(c.length,d)}}async buildPageManifest(a){let{pages:b,slideCount:c}=n(a);return{format:"pptx",totalPages:Math.max(b.length,c),pages:b.map(a=>({pageNum:a.pageNum,title:a.title}))}}async extractAdaptive(a,b,c,d,e){let{pages:f}=n(a),g="",h=b;for(let a=b-1;a<f.length&&a<b-1+d;a++){let b=f[a],d="--- Page "+b.pageNum+" ---\n"+b.text.trim();if(g.length+d.length>c&&g.length>0)break;g+=(g?"\n\n":"")+d,h=b.pageNum}return{text:g,startPage:b,endPage:h,totalChars:g.length}}async getToc(a){let{pages:b}=n(a);return b.map(a=>({title:a.title||("Slide "+a.pageNum),page:a.pageNum,level:0}))}async detectQuality(a){if(!(0,g.existsSync)(a))return{ok:!1,reason:"File does not exist"};try{let{pages:b}=n(a);return b.some(a=>a.text&&a.text.trim().length>=10)?{ok:!0}:{ok:!1,reason:"This PPTX file has no readable slide text."}}catch(a){return{ok:!1,reason:"PPTX parsing failed: "+(a instanceof Error?a.message:String(a))}}}}async function f(a){switch(a){case"pdf":{let{PdfExtractor:a}=await c.e(7962).then(c.bind(c,27962));return new a}case"markdown":{let{MarkdownExtractor:a}=await c.e(1069).then(c.bind(c,11069));return new a}case"epub":{let{EpubExtractor:a}=await c.e(9241).then(c.bind(c,79241));return new a}case"qbook":{let{QbookExtractor:a}=await c.e(602).then(c.bind(c,40602));return new a}case"pptx":return new o;default:throw Error("Unsupported format: "+a)}}Object.keys(d)},
 36547:(a,b,c)=>{c.d(b,{J1:()=>k,Ob:()=>n,U8:()=>i,Vi:()=>m,WS:()=>l,ut:()=>j});var f=c(33873),g=c.n(f);
function o(a){return{scope:{accountId:a&&a.accountId,profileId:a&&a.profileId,worldId:a&&a.worldId,textbookId:a&&a.textbookId,sessionEpoch:a&&a.sessionEpoch},expectedLanguage:a&&a.expectedLanguage||"zh-Hans-CN",signal:a&&a.signal,deadlineAt:a&&a.deadlineAt}}
function h(a,b,...c){let d=c.length&&c[c.length-1]&&"object"==typeof c[c.length-1]&&!Array.isArray(c[c.length-1])?c.pop():null,e=global.__PDF_OCR_COORDINATOR__;if(!d||!d.scope||!d.scope.accountId||!Number.isSafeInteger(d.scope.sessionEpoch)||!d.signal||!Number.isFinite(d.deadlineAt))return Promise.reject(Error("ocr_scope_invalid"));if(!e||"function"!=typeof e.run)return Promise.reject(Error("ocr_coordinator_unavailable"));let f={command:a,filePath:b,scope:d.scope,expectedLanguage:d.expectedLanguage||"zh-Hans-CN",signal:d.signal,deadlineAt:d.deadlineAt};return"extract"===a?(f.startPage=Number(c[0]),f.endPage=Number(c[1])):"extract_adaptive"===a?(f.startPage=Number(c[0]),f.targetChars=Number(c[1]),f.maxPages=Number(c[2])):"render"===a&&(f.startPage=Number(c[0]),f.endPage=Number(c[1]),f.scale=Number(c[2])),e.run(f).then(a=>JSON.stringify(a))}
async function i(a,b){return{...JSON.parse(await h("meta",a,o(b))),fileName:g().basename(a)}}
async function j(a,b,c,d,e=!1,f){let i=b,k=c;e&&d&&(i=Math.max(1,b-2),k=Math.min(d,c+5));let l=JSON.parse(await h("extract",a,String(i),String(k),o(f)));
if(Number.isInteger(l.contiguousUsableEndPage))return{...l,failedPages:l.failedPages||[],sourcesByPage:l.sourcesByPage||{},supplementalPages:l.supplementalPages||[],pages:(l.pageResults||l.pages||[]).map(a=>a.page),metadata:{...l.metadata,fileName:g().basename(a)}};
let m=l.pages.map(a=>`--- Page ${a.page} ---
${a.text}`).join("\n\n");return{text:m,pages:l.pages.map(a=>a.page),totalChars:m.length,metadata:{...l.metadata,fileName:g().basename(a)}}}
async function k(a,b,c,d){let e=Math.min(b,Math.max(c??0,20)),f=await j(a,1,e,void 0,!1,d);if(f.totalChars>=1e3||e>=b)return f.text;let g=Math.min(b,e+30);return(await j(a,1,g,void 0,!1,d)).text}
async function l(a,b,c=15e3,d=30,e){let f=JSON.parse(await h("extract_adaptive",a,String(b),String(c),String(d),o(e)));
if(Number.isInteger(f.contiguousUsableEndPage))return{...f,failedPages:f.failedPages||[],sourcesByPage:f.sourcesByPage||{},supplementalPages:f.supplementalPages||[],pages:(f.pageResults||f.pages||[]).map(a=>a.page),metadata:{...f.metadata,fileName:g().basename(a)}};
let i=f.pages.map(a=>`--- 第 ${a.page} 页 ---
${a.text}`).join("\n\n");return{text:i,pages:f.pages.map(a=>a.page),startPage:b,endPage:f.endPage??b,totalChars:i.length,metadata:{...f.metadata,fileName:g().basename(a)}}}
async function m(a,b){try{let c=await h("toc",a,o(b));return JSON.parse(c).entries??[]}catch{return[]}}async function n(a,b){return JSON.parse(await h("scan",a,o(b)))}},
82751:(a,b,c)=>{c.d(b,{$g:()=>U,Gt:()=>T,J1:()=>J,KC:()=>M,P_:()=>S,Qs:()=>R,Wk:()=>Q,XB:()=>L,bF:()=>K,fU:()=>N,sd:()=>H,tn:()=>I});var d=c(79748),e=c(23952),f=c.n(e),g=c(29021),h=c(33873),i=c.n(h),j=c(40969),k=c(70829),l=c(36547),m=c(24073),__kbSpawn=c(79646);let n=[/第[一二三1-3]章/,/第[一二三1-3]课/,/第[一二三1-3]讲/,/第[一二三1-3]部分/,/第[一二三1-3]单元/,/第[一二三1-3]节/,/第[一二三1-3]编/,/第[一二三1-3]篇/,/第[一二三1-3]模块/,/第[一二三1-3]課/,/第[一二三1-3]講/,/第[一二三1-3]節/,/第[一二三1-3]單元/,/第[一二三1-3]編/,/第[壹貳參]章/,/^正文/m,/^Chapter\s+[1-3]\b/im,/^CHAPTER\s+(?:ONE|TWO|THREE|[1-3])\b/m,/^Part\s+(?:I{1,3}|One|Two|Three|[1-3])\b/im,/^Unit\s+[1-3]\b/im,/^Lesson\s+[1-3]\b/im,/^Module\s+[1-3]\b/im,/^Section\s+[1-3]\b/im,/^Topic\s+[1-3]\b/im,/^Lecture\s+[1-3]\b/im,/^1\.\s+\S/m,/^1\.1\s+\S/m,/^I\.\s+\S/m,/^I\s{2,}\S/m],o=[/^Table of Contents$/im,/^Contents$/im,/^Preface$/im,/^Foreword$/im,/^Introduction$/im,/^Prologue$/im,/^Overview$/im,/^Acknowledgments?$/im,/^Acknowledgements?$/im,/^About the Authors?$/im,/^Copyright/im,/^Dedication$/im,/^List of (?:Figures|Tables|Abbreviations)/im,/^Note to (?:the\s+)?(?:Reader|Student|Instructor)/im,/^How to Use This Book/im,/^To the (?:Reader|Student|Instructor)/im,/^目录/m,/^前言/m,/^序言/m,/^序$/m,/^绪言/m,/^绪论/m,/^引言/m,/^导论/m,/^导读/m,/^概论/m,/^总论/m,/^概述/m,/^综述/m,/^致谢/m,/^编者的话/m,/^作者简介/m,/^版权/m,/^出版说明/m,/^凡例/m,/^使用说明/m,/^编写说明/m,/^目錄/m,/^緒言/m,/^緒論/m,/^導論/m,/^導讀/m,/^概論/m,/^總論/m,/^綜述/m,/^致謝/m,/^編者的話/m,/^作者簡介/m,/^版權/m,/^出版說明/m,/^使用說明/m,/^編寫說明/m],p=/\.{3,}\s*\d+/,q=[/^Cover$/i,/^Title\s*Page$/i,/^Copyright(?:\s+Page)?$/i,/^Dedication$/i,/^Epigraph$/i,/^(?:Table\s+of\s+)?Contents$/i,/^Preface$/i,/^Foreword$/i,/^Prologue$/i,/^Introduction$/i,/^Overview$/i,/^Acknowledg(?:e)?ments?$/i,/^About\s+(?:the\s+)?(?:Author|Editors?|Translator|This\s+Book)$/i,/^How\s+to\s+(?:Use|Read)\s+This\s+Book$/i,/^Note\s+to\s+(?:the\s+)?(?:Reader|Student|Instructor|Teacher)$/i,/^To\s+the\s+(?:Reader|Student|Instructor|Teacher)$/i,/^List\s+of\s+(?:Figures|Tables|Abbreviations|Illustrations)$/i,/^Abbreviations?$/i,/^Glossary$/i,/^封面$/,/^版权(?:页|信息)?$/,/^版權(?:頁|信息)?$/,/^扉页$/,/^扉頁$/,/^献辞$/,/^獻辭$/,/^目录$/,/^目錄$/,/^前言$/,/^序(?:言)?$/,/^自序$/,/^代序$/,/^绪言$/,/^緒言$/,/^绪论$/,/^緒論$/,/^引言$/,/^导论$/,/^導論$/,/^导读$/,/^導讀$/,/^概论$/,/^概論$/,/^概述$/,/^综述$/,/^綜述$/,/^致谢$/,/^致謝$/,/^鸣谢$/,/^鳴謝$/,/^编者的话$/,/^編者的話$/,/^作者简介$/,/^作者簡介$/,/^译者序$/,/^譯者序$/,/^出版说明$/,/^出版說明$/,/^凡例$/,/^使用说明$/,/^使用說明$/,/^编写说明$/,/^編寫說明$/,/^推荐序$/,/^推薦序$/],r=`你是教材目录分析助手。给你一份按顺序排列的教材目录条目（每条包含 \`title\`、\`page\`、\`level\`），你要找出**真正的教学正文**从哪一条开始。

**永远跳过以下条目**（即使它们看起来内容丰富）：
- 封面 / 扉页 / 版权 / 题献 / 题记
- 目录 / 索引
- 序 / 前言 / 序言 / 自序 / 代序 / 推荐序
- Foreword / Preface / Prologue
- **Introduction / 引言 / 导言 / 导论 / 绪论 / 绪言**（产品设计：始终跳过，让用户主动选）
- 致谢 / 鸣谢 / Acknowledgments
- 作者简介 / About the Author / 译者序
- 关于本书 / 本书的特点 / 如何使用本书 / 致读者 / Note to Reader
- 出版说明 / 版权与传播 / 凡例 / 使用说明 / 编写说明
- 预设知识基础 / Prerequisites（属于使用说明类）

**优先选择**以下形式的条目作为正文起点：
- 第一章 / 第1章 / 第一节 / 第一课 / 第一讲 / 第一篇 / 第一单元
- Chapter 1 / Chapter One
- Day 1 / Lesson 1 / Lecture 1 / Module 1 / Unit 1 / Section 1
- Part 1 / Part I（若全书以 Part 划分大块）
- "1." / "1.1" / "I." 开头的标准章节编号

**关于 heading 层级（level）**：
- 不同书的章节可能用不同 level——有的书 H1 留给 "Part"、H2 给 "Chapter"，有的书 H1 直接是 Chapter
- 不要靠 level 数字判断，要靠 title 内容 + 上下文综合判断
- 如果一个 H1 标题后紧跟多个 H2 子标题，再换 H1，则前一个 H1 + 它的 H2 们构成一个 "块"

**边界情况**：
- 没有任何明确"第N章/Chapter N"标识时，挑前置内容结束后的**第一条带实质内容的条目**
- 拿不准时**宁可选靠后**（多跳前置比误起在前置上更安全）

只输出严格 JSON，不加任何额外说明：
{ "selectedIndex": <1 开始的索引数字>, "reasoning": "<一句话解释为什么选这条>" }

如果整份 TOC 全都是前置内容、或无法判断，返回 {"selectedIndex": null, "reasoning": "..."}。`,s=`You are a textbook table-of-contents analyzer. Given a list of TOC entries in order (each with \`title\`, \`page\`, \`level\`), identify where the **real teaching content** begins.

**Always skip these as front matter** (regardless of how substantive they seem):
- Cover / Title Page / Copyright / Dedication / Epigraph
- Contents / Table of Contents / Index
- Preface / Foreword / Prologue
- **Introduction** (product decision: always skip; users who want it can navigate back manually)
- Acknowledg(e)ments
- About the Author / About This Book
- How to Use This Book / Note to Reader
- Front-matter sections in other languages: 序 / 前言 / 序言 / 致谢 / 导言 / 引言 / 绪论 / 绪言 / 关于本书 / 致读者 etc.
- Prerequisites / Required Background (these are "how to use" material)

**Prefer these as content start:**
- Chapter 1 / Chapter One / 第一章 / 第1章
- Day 1 / Lesson 1 / Lecture 1 / Module 1 / Unit 1 / Section 1
- Part 1 / Part I (when the book is organized into Parts)
- "1." / "1.1" / "I." numbered entries

**About heading level**:
- Different books use different levels for chapters — some reserve H1 for Parts and put Chapters at H2; others use H1 directly for Chapters
- Don't decide based on the level number; judge from title content + context
- If an H1 is followed by several H2s before the next H1, the H1 + its H2s form a block together

**Edge cases**:
- If there is no explicit Chapter N / Day N marker, pick the **first substantive entry after the front matter ends**
- When unsure, **prefer later entries** (skipping more is safer than starting on front matter)

Return strict JSON only, no commentary:
{ "selectedIndex": <1-based integer index>, "reasoning": "<one-sentence explanation>" }

If the entire TOC is front matter or you can't determine, return {"selectedIndex": null, "reasoning": "..."}.`,t=[/^第\s*[一二三四五六七八九十百零0-9]+\s*[章节節课課讲講篇單单元]/,/^Chapter\s+\d+/i,/^Part\s+[IVXLCM]+\b/i,/^Part\s+\d+/i,/^Day\s+\d+/i,/^Lesson\s+\d+/i,/^Lecture\s+\d+/i,/^Module\s+\d+/i,/^Unit\s+\d+/i,/^Section\s+\d+/i];async function u(a,b,d,e,f="chinese",g,h,ocrOperation){let i=a.filter(a=>a.title&&a.title.trim()&&null!=a.page&&a.page>=1).slice(0,200);if(0===i.length)return null;let j=i.map((a,b)=>`${b+1}. (level=${a.level}, page=${a.page}) ${a.title.trim()}`).join("\n"),k="english"===f?`Table of contents:
  ${j}`:`教材目录：
  ${j}`;try{assertTextbookOcrFence(ocrOperation);let{callLLM:a}=await c.e(4092).then(c.bind(c,64092));assertTextbookOcrFence(ocrOperation);let j=(await a({provider:b,apiKey:d,model:e||"gpt-4o-mini",systemPrompt:"english"===f?s:r+("chinese-traditional"===f?"\n\n請使用繁體中文輸出 reasoning。":""),messages:[{role:"user",content:k}],maxTokens:200,timeoutMs:3e4,hosted:g,forceProvider:h,signal:ocrOperation.signal,deadlineAt:ocrOperation.deadlineAt}));assertTextbookOcrFence(ocrOperation);j=j.match(/\{[\s\S]*\}/);if(!j)return null;let l=JSON.parse(j[0]);if(null==l.selectedIndex||"number"!=typeof l.selectedIndex)return null;let m=l.selectedIndex-1;if(m<0||m>=i.length)return null;let n=i[m];return{page:n.page,title:n.title.trim(),reasoning:"string"==typeof l.reasoning?l.reasoning:""}}catch(a){if(isTextbookOcrFenceError(a))throw a;assertTextbookOcrFence(ocrOperation);return console.warn("[textbook:preface] TOC LLM analysis failed:",a),null}}function v(a){let b=a.split(/--- (?:Page|第)\s*(\d+)\s*(?:页\s*)?---/),c=[];for(let a=1;a<b.length-1;a+=2)c.push({pageNum:parseInt(b[a],10),text:b[a+1]||""});return c}function w(a){let b=v(a);if(0===b.length)return{contentStartPage:1,marker:null,method:"default",confidence:"low"};for(let a of b){if(o.some(b=>b.test(a.text)))continue;let b=[];for(let c of n){let d=a.text.match(c);d&&b.push({pattern:c,match:d})}let c=0;for(let b of n){let d=b.flags.includes("g")?b.flags:b.flags+"g",e=new RegExp(b.source,d),f=a.text.match(e);if(f&&(c+=f.length),c>=5)break}if(!(c>=5)&&!(b.length>=3)&&b.length>0){let c=b[0].match[0],d=a.text.split("\n").find(a=>a.includes(c))||"";if(p.test(d))continue;return{contentStartPage:a.pageNum,marker:c,method:"positive-regex",confidence:"high"}}}let c=0;for(let a of b)for(let b of o)if(b.test(a.text)){c=a.pageNum;break}return c>0?{contentStartPage:Math.min(c+1,b[b.length-1]?.pageNum??1),marker:null,method:"negative-regex",confidence:"medium"}:{contentStartPage:1,marker:null,method:"default",confidence:"low"}}function x(a,b){return assertTextbookSegments(a,b),i().join((0,j.Te)(a,b),"textbook_index.json")}async function y(a,b){let c=x(a,b);if(!(0,g.existsSync)(c))return{worldId:b,updatedAt:new Date().toISOString(),textbooks:[]};try{return JSON.parse(await (0,d.readFile)(c,"utf-8"))}catch{return{worldId:b,updatedAt:new Date().toISOString(),textbooks:[]}}}async function z(a,b,c){let e=(0,j.Te)(a,b);(0,g.existsSync)(e)||await (0,d.mkdir)(e,{recursive:!0}),c.updatedAt=new Date().toISOString(),await f()(x(a,b),JSON.stringify(c,null,2))}let A=`你是一个教材信息提取助手。根据提供的教材开头文字，提取关键信息并返回严格的JSON格式。

字段说明：
- title: 书名（字符串，若无法确定填null）
- author: 作者（字符串，若无法确定填null）
- year: 出版年份（4位数字字符串，若无法确定填null）
- field: 学科领域，简洁描述（如"经济学"、"线性代数"、"历史"，若无法确定填null）
- abstract: 本书内容简介，不超过150字（字符串，若无法确定填null）
- contentStartPage: 第一段**系统教学干货**起始的物理页码（数字）。跳过目录、前言、序言、致谢、版权、绪言/引言/导论/概述/导读 等**非干货**内容。

  **判断的核心：看内容，不是看标题。** 标题（如"绪言"vs"第一章"）只是辅助信号；最终判断要基于该页**实际写的是什么**。

  **要跳过的"非干货"内容特征**（无论标题叫什么）：
  - 全书总览 / 学习路线图 / "本书将介绍 X 和 Y"
  - 学科发展史 / 重大事件年表 / 名人简介
  - 应用领域罗列（"X 在 A、B、C 中的应用..." 而无具体讲解）
  - "什么是 X" 式的宽泛定义（无深入推导 / 无具体例子）
  - 编者寄语 / 学习方法 / 使用本书的建议
  - 各章节预告 / 内容概述

  **要作为正文起点的"干货"内容特征**：
  - 一个具体概念被定义并系统探究（如"物质的变化和性质"、"极限的 ε-δ 定义"）
  - 具体实验 / 例题 / 推导过程 / 习题
  - 结构化的子段展开（"一、xxx / 二、xxx" 或"1.1 / 1.2"）
  - 有可教可问可练的具体材料

  **标题辅助信号**（仅供参考，必须用内容验证）：
  - "绪言 / 引言 / 前言 / 导论 / 概述 / 导读 / Introduction / Prologue" → 通常是预告性，**多数情况要跳过**；但极少数书里这一节就是真正干货
  - "第一章 / 第一单元 / 第一节 / Chapter 1 / Unit 1 / Part I" → 通常是干货起点；但极少数书里这一节本身只是背景

  **典型场景示例**：一本化学教材先有"绪言：化学使世界变得多彩"（4 页讲化学是什么、化学应用、化学发展史），然后是"第一单元 走进化学世界 / 课题1 物质的变化和性质"（实验 + 概念定义）——绪言是预告性总览，应跳过；从课题1（实质教学）开始。

  页码对应文本中"--- Page N ---"或"--- 第 N 页 ---"标记的N值。注意：N是物理页码，不是书上印的页码。如果无法判断填null
- contentStartSnippet: 从第一章教学内容开始处（如章节标题及其后第一句话），原样复制50-100个字符。必须是文本中的精确引用，不要改写或省略。如果无法判断填null

只返回JSON对象，不要加任何说明文字：
{"title": "...", "author": "...", "year": "...", "field": "...", "abstract": "...", "contentStartPage": 数字或null, "contentStartSnippet": "精确引用或null"}`,B=`You are a textbook information extraction assistant. Based on the provided opening text of a textbook, extract key information and return it in strict JSON format.

IMPORTANT: ALL output values MUST be in English, even if the source text is in another language. Translate titles, fields, and abstracts into English.

Field descriptions:
- title: Book title in its ORIGINAL language (do NOT translate the title) (string, null if undetermined)
- author: Author name (keep original name, do not translate) (string, null if undetermined)
- year: Publication year (4-digit string, null if undetermined)
- field: Subject area in English, brief description (e.g. "Economics", "Linear Algebra", "History", null if undetermined)
- abstract: Brief summary of the book in English, no more than 150 words (string, null if undetermined)
- contentStartPage: Physical page number where the **first systematic teaching content** begins (number). Skip TOC, preface, foreword, acknowledgments, copyright, AND "Introduction / Prologue / Overview / Foreword / 绪言 / 引言 / 导论 / 概述" type opener content.

  **Judge by CONTENT, not by section title.** Titles (e.g. "Introduction" vs "Chapter 1") are only supporting signals; the final call is based on what the page **actually contains**.

  **Content patterns to SKIP** (regardless of section title):
  - Whole-book overview / roadmap / "this book will cover X and Y"
  - History of the field / timeline of milestones / biographical sketches
  - List of application areas without depth ("X is used in A, B, C")
  - Broad "What is X?" definitions without concrete examples or derivations
  - Editor's note / study-method tips / "how to use this book"
  - Per-chapter previews / abstract of upcoming material

  **Content patterns that QUALIFY as teaching start**:
  - A specific concept being defined and systematically explored (e.g. "Properties and changes of matter", "ε-δ definition of a limit")
  - Concrete experiments / worked examples / derivations / exercises
  - Structured subsection development ("1. xxx / 2. xxx" or "1.1 / 1.2")
  - Teachable / questionable / practicable specific material

  **Title hints (use as supplementary signal, verify with content)**:
  - "Introduction / Prologue / Foreword / Overview / 绪言 / 引言 / 导论" → usually preview material, **usually skip**; but in rare books this section IS the real teaching
  - "Chapter 1 / Unit 1 / Part I / 第一章 / 第一单元" → usually the teaching start; but in rare books this section is just background

  **Typical scenario**: A chemistry textbook has "Foreword: Chemistry makes the world more colorful" (4 pages on what chemistry is, applications, history), then "Unit 1: Stepping into the chemistry world / Lesson 1: Properties and changes of matter" (experiments + concept definitions) — the Foreword is preview-material overview, should be skipped; start at Lesson 1 (real teaching).

  The page number corresponds to the N value in "--- Page N ---" or "--- 第 N 页 ---" markers in the text. NOTE: N is the physical page number, NOT the printed page number in the book. null if undetermined
- contentStartSnippet: Copy EXACTLY 50-100 characters of text from where teaching content begins (e.g., the chapter heading and beginning of first sentence). Must be a verbatim quote — do not paraphrase or modify. null if undetermined

Return only a JSON object, no explanatory text:
{"title": "...", "author": "...", "year": "...", "field": "...", "abstract": "...", "contentStartPage": number or null, "contentStartSnippet": "exact verbatim quote or null"}`;async function C(a,b,d,e,f,g="chinese",h,i,j,k,ocrOperation){let l="chinese-traditional"===g,m="";m=j&&j.page>1?"english"===g?`

Content start hint: We detected that chapter content may start at physical page ${j.page}${j.marker?` (matched "${j.marker}")`:""}. Please confirm this is correct — i.e., it skips TOC, preface, foreword, acknowledgments and other non-teaching content. If incorrect, provide the correct physical page number in contentStartPage. IMPORTANT: Also provide contentStartSnippet — copy exactly 50-100 characters from the chapter heading where teaching content begins.`:`

正文起始提示：我们检测到章节内容可能从物理页 ${j.page} 开始${j.marker?`（匹配到"${j.marker}"）`:""}。请确认是否正确——即跳过了目录、前言、序言、致谢等非教学内容。如果不正确，请在contentStartPage中提供正确的物理页码。重要：请同时提供contentStartSnippet——从教学内容开始处（章节标题及第一句话）原样复制50-100个字符。`:"english"===g?`

Content start detection: We could not determine where chapter content begins. Please examine the text and determine which physical page (marked with "--- Page N ---") contains the start of the first chapter's teaching content, after skipping TOC, preface, foreword, acknowledgments, etc. IMPORTANT: Also provide contentStartSnippet — copy exactly 50-100 characters from the chapter heading where teaching content begins.`:`

正文起始检测：我们无法确定章节教学内容的起始位置。请检查文本，判断哪个物理页（以"--- Page N ---"或"--- 第 N 页 ---"标记）是第一章教学内容的开始，跳过目录、前言、序言、致谢等。重要：请同时提供contentStartSnippet——从教学内容开始处（章节标题及第一句话）原样复制50-100个字符。`;let n=function(a,b){if(!a||0===a.length)return"";let c=a.filter(a=>"number"==typeof a.page&&a.page>=1&&a.level<=1).slice(0,60);if(0===c.length)return"";let d=c.map(a=>{let b=(a.title||"").trim().slice(0,80),c="  ".repeat(a.level);return`${c}- ${b} → p.${a.page}`});return"english"===b?`

[Publisher-embedded outline (informational hint, verify against actual text)]
`+d.join("\n")+`

Use this outline to anchor your decision, but always verify against the actual text excerpt above. `+`If the outline's claimed first-chapter page is beyond the text you can see, you may report that page in contentStartPage but DO NOT fabricate a contentStartSnippet — leave it null. `+"If the outline is clearly broken (e.g. every entry claims p.1, or chapter titles look unrelated to what's in the text), ignore it.":`

[出版社内嵌大纲（参考用，必须以实际文本为准）]
`+d.join("\n")+`

请把这份大纲跟上面提供的实际文本对照，作为判断 contentStartPage 的辅助证据。`+`如果大纲声称第一章在某页，而那页超出了你能看到的文本范围，你可以把那个页码报到 contentStartPage 里，但**不要伪造** contentStartSnippet——留 null（系统会用其它机制验证）。`+`如果大纲明显有问题（如所有 entry 都标 p.1，或章节标题跟实际文本毫无关系），直接忽略大纲，按文本判断。`}(k,g),o=function(a,b=3e4){let c=v(a);if(0===c.length)return a.slice(0,b);let d=Math.max(200,Math.min(1500,Math.floor(b/c.length))),e=[],f=0;for(let a of c){let c=a.text.length>d?a.text.slice(0,d)+" […]":a.text,g=`--- Page ${a.pageNum} ---
${c}
`;if(e.push(g),(f+=g.length)>=b)break}return e.join("\n")}(a,3e4),p="english"===g?`Please analyze the following textbook content and extract the title, author, year, subject, summary, and content start page.
Filename reference: ${b}${m}${n}

Content:
${o}`:`请分析以下教材内容，提取书名、作者、年份、学科、摘要和正文起始页码。
文件名参考：${b}${m}${n}

内容：
${o}`,q={title:null,author:null,year:null,field:null,abstract:null,contentStartPage:null,contentStartSnippet:null};try{assertTextbookOcrFence(ocrOperation);let{callLLM:a}=await c.e(4092).then(c.bind(c,64092));assertTextbookOcrFence(ocrOperation);let b=await a({provider:d,apiKey:e,model:f||"gpt-4o-mini",systemPrompt:"english"===g?B:A+(l?"\n\n請使用繁體中文輸出所有欄位內容。":""),messages:[{role:"user",content:p}],maxTokens:500,timeoutMs:3e4,hosted:h,forceProvider:i,signal:ocrOperation.signal,deadlineAt:ocrOperation.deadlineAt});assertTextbookOcrFence(ocrOperation);b=b.match(/\{[\s\S]*\}/);if(!b)return q;let j=JSON.parse(b[0]);return{title:j.title??null,author:j.author??null,year:j.year??null,field:j.field??null,abstract:j.abstract??null,contentStartPage:"number"==typeof j.contentStartPage?j.contentStartPage:null,contentStartSnippet:"string"==typeof j.contentStartSnippet?j.contentStartSnippet:null}}catch(a){if(isTextbookOcrFenceError(a))throw a;assertTextbookOcrFence(ocrOperation);return console.error("[textbook] LLM analysis failed:",a),q}}let D=`你是一个教材目录提取助手。你会收到教材前 30 页的提取文字，其中每页以 "--- Page N ---" 标记（N 是 PDF 文件页码，从 1 开始）。

你的任务：
1. 找到目录页（通常标题为"目录"、"Contents"等），提取所有章节条目
2. 识别每个条目的标题、书页码（目录页上印的数字）、层级（0=章/篇，1=节，2=小节）
3. 计算 offset（偏移量）：offset = 某章实际所在的 PDF 页码 - 该章在目录上标注的书页码
   - 验证方法：在提取文字中找到某章的开头内容，确认它在哪个 PDF 页，然后和目录标注的书页码做差
   - 如果无法精确验证，用 contentStartPage 参数（正文起始 PDF 页码）和目录中第一章的书页码估算
4. **忠实于印刷目录**：印刷目录里有什么就收什么，**不要凭空补充**没列出来的章节。如果印刷目录列了 Preface / Foreword / Acknowledgments / Introduction / 序言 / 前言 等前置内容，就要把它们也收进来作为 level 0 条目；如果印刷目录没列，就不要补。
   - **重要**：contentStartPage 参数只告诉你"正文教学从哪里开始"——它**不是**目录过滤器。不要因为某条目位于 contentStartPage 之前就主动跳过它，只要它在印刷目录里就要收。

返回严格的 JSON，不要加说明文字：
{
  "offset": 数字,
  "entries": [
    {"title": "章节标题", "bookPage": 书页码数字, "pdfPage": PDF页码数字, "level": 0或1或2}
  ]
}

规则：
- pdfPage = bookPage + offset（每个条目都要算出 pdfPage）
- 如果目录上没有印页码，bookPage 填 null，pdfPage 尽量根据上下文推算
- 只提取到二级标题（level 0 和 1），更细的小节不需要
- 如果找不到目录页或目录内容为空，返回 {"offset": 0, "entries": []}`,E=`You are a textbook table of contents extraction assistant. You will receive the extracted text of the first 30 pages of a textbook, where each page is marked with "--- Page N ---" (N is the PDF page number, starting from 1).

Your tasks:
1. Find the table of contents page (typically titled "Table of Contents", "Contents", etc.) and extract all chapter entries
2. Identify each entry's title, book page number (the number printed on the TOC page), and level (0=chapter/part, 1=section, 2=subsection)
3. Calculate the offset: offset = actual PDF page number of a chapter - book page number shown in the TOC
   - Verification method: find the beginning of a chapter in the extracted text, confirm which PDF page it's on, then subtract the book page number shown in the TOC
   - If exact verification is not possible, estimate using the contentStartPage parameter (PDF page where main content starts) and the book page number of the first chapter in the TOC
4. **Stay faithful to the printed TOC**: extract whatever is listed; do **NOT** invent entries that aren't in the printed TOC. If the printed TOC lists front-matter sections like Preface / Foreword / Acknowledgments / Introduction, include them as level 0 entries; if it doesn't list them, don't add them.
   - **Important**: The contentStartPage parameter only tells you "where teaching content begins" — it is **NOT** a TOC filter. Don't skip an entry just because it falls before contentStartPage; if it's in the printed TOC, include it.

Return strict JSON, no explanatory text:
{
  "offset": number,
  "entries": [
    {"title": "Chapter title", "bookPage": book_page_number, "pdfPage": PDF_page_number, "level": 0_or_1_or_2}
  ]
}

Rules:
- pdfPage = bookPage + offset (calculate pdfPage for every entry)
- If the TOC does not print page numbers, set bookPage to null and estimate pdfPage from context
- Only extract up to level 1 headings (level 0 and 1); finer subsections are not needed
- If no TOC page is found or the TOC is empty, return {"offset": 0, "entries": []}`;async function F(a,b,d,e,f,g="chinese",h,i,ocrOperation){let j="english"===g?`Content start PDF page (contentStartPage) = ${b}

Below is the extracted text of the first 30 pages of the textbook:

${a.slice(0,12e3)}`:`正文起始 PDF 页码（contentStartPage）= ${b}

以下是教材前 30 页的提取文字：

${a.slice(0,12e3)}`;try{assertTextbookOcrFence(ocrOperation);let{callLLM:a}=await c.e(4092).then(c.bind(c,64092));assertTextbookOcrFence(ocrOperation);let b=await a({provider:d,apiKey:e,model:f||"gpt-4o-mini",systemPrompt:"english"===g?E:D+("chinese-traditional"===g?"\n\n請使用繁體中文輸出所有章節標題。":""),messages:[{role:"user",content:j}],maxTokens:2e3,timeoutMs:3e4,hosted:h,forceProvider:i,signal:ocrOperation.signal,deadlineAt:ocrOperation.deadlineAt});assertTextbookOcrFence(ocrOperation);b=b.match(/\{[\s\S]*\}/);if(!b)return null;let k=JSON.parse(b[0]);if(!Array.isArray(k.entries))return null;let l="number"==typeof k.offset?k.offset:0,m=k.entries.filter(a=>a.title&&"number"==typeof a.pdfPage).map(a=>({title:String(a.title),bookPage:"number"==typeof a.bookPage?a.bookPage:null,pdfPage:Number(a.pdfPage),level:"number"==typeof a.level?Math.min(a.level,2):0}));if(0===m.length)return null;return{offset:l,entries:m,source:"llm",generatedAt:new Date().toISOString()}}catch(a){if(isTextbookOcrFenceError(a))throw a;assertTextbookOcrFence(ocrOperation);return console.error("[textbook] TOC generation failed:",a),null}}async function G(a,b,c){assertTextbookSegments(a,b),null!=c&&assertTextbookSegments(c);let e=(0,j.eX)(a);await (0,d.writeFile)(e,JSON.stringify({worldId:b,textbookId:c},null,2),"utf-8")}async function H(a,b){return(await y(a,b)).textbooks}async function I(a,b,c){assertTextbookSegments(a,b,c);let d=(await y(a,b)).textbooks.find(a=>a.id===c);return d?(await G(a,b,c),d):null}async function J(a,b,c){assertTextbookSegments(a,b);if(!Array.isArray(c)||!c.every(validTextbookSegment))throw Error("textbook_scope_invalid");let d=await y(a,b),e=new Map(d.textbooks.map(a=>[a.id,a])),f=[];for(let a of c){let b=e.get(a);if(!b)return!1;f.push(b),e.delete(a)}for(let a of e.values())f.push(a);return d.textbooks=f,await z(a,b,d),!0}async function K(a,b,c,d){assertTextbookSegments(a,b,c);let e=await y(a,b),f=e.textbooks.find(a=>a.id===c);return!!f&&(f.title=d.trim(),f.titleSource="llm",await z(a,b,e),!0)}async function L(a,b,c,d){assertTextbookSegments(a,b,c);let e=await y(a,b),f=e.textbooks.find(a=>a.id===c);return!!f&&(d?f.color=d:delete f.color,await z(a,b,e),!0)}
let textbookOcrFenceErrors=new Set(["request_aborted","request_deadline","request_stale","ocr_request_aborted","ocr_request_deadline","ocr_request_stale","ocr_delivery_scope_stale","ocr_scope_stale","ocr_scope_invalid","ocr_scope_tombstoned","ocr_account_state_unavailable","vision_account_changed","pdf_scope_mismatch","pdf_scope_reparse","pdf_path_invalid","pdf_path_unavailable","pdf_changed_during_ocr","pdf_scope_generation_changed"]);function isTextbookOcrFenceError(a){return textbookOcrFenceErrors.has(String(a&&a.code||""))}function validTextbookSegment(a){return"string"==typeof a&&/^[A-Za-z0-9_-]{1,64}$/.test(a)}function assertTextbookSegments(){for(let a of arguments)if(!validTextbookSegment(a)){let a=Error("textbook_scope_invalid");throw a.code="textbook_scope_invalid",a}}function safeTextbookFileName(a){return"string"==typeof a&&a.length>0&&a.length<=180&&"."!==a&&".."!==a&&!/[<>:"/\\|?*\x00-\x1f]/.test(a)&&!/[. ]$/.test(a)&&!/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(a)?a:null}function assertTextbookOcrFence(a){let b=global.__SOCRATOPIA_ACCOUNT_REQUEST_CONTEXT__,c=b&&"function"==typeof b.getAccountId?b.getAccountId():null,d="function"==typeof global.__SOCRATOPIA_ACCOUNT_CONTEXT__?global.__SOCRATOPIA_ACCOUNT_CONTEXT__():null,e=null;if(!a||!a.accountId||!Number.isSafeInteger(a.sessionEpoch)||!a.signal||!Number.isFinite(a.deadlineAt))e=Error("ocr_scope_invalid"),e.code="ocr_scope_invalid";else if(a.signal.aborted)e=Error("request_aborted"),e.code="request_aborted";else if(Date.now()>=a.deadlineAt)e=Error("request_deadline"),e.code="request_deadline";else if(c!==a.accountId||!d||!0!==d.active||d.accountId!==a.accountId||d.sessionEpoch!==a.sessionEpoch)e=Error("request_stale"),e.code="request_stale";if(e)throw e;return a}
async function M(a,b,c,ocrOperation){assertTextbookSegments(a,b,c);assertTextbookOcrFence(ocrOperation);
let e=(0,j.Uu)(a,b,c);
if(!(0,g.existsSync)(e))return!1;
  let builderCoordinator=global.__KB_BUILDER_COORDINATOR__;builderCoordinator&&"function"==typeof builderCoordinator.cancelScope&&await builderCoordinator.cancelScope({accountId:ocrOperation.accountId,sessionEpoch:ocrOperation.sessionEpoch,profileId:a,worldId:b,textbookId:c});let ocrCoordinator=global.__PDF_OCR_COORDINATOR__;if(!ocrCoordinator||"function"!=typeof ocrCoordinator.purgeScope)throw Error("ocr_lifecycle_unavailable");await ocrCoordinator.purgeScope({accountId:ocrOperation.accountId,sessionEpoch:ocrOperation.sessionEpoch,profileId:a,worldId:b,textbookId:c,signal:ocrOperation.signal,deadlineAt:ocrOperation.deadlineAt});
 assertTextbookOcrFence(ocrOperation);await (0,d.rm)(e,{recursive:!0,force:!0});assertTextbookOcrFence(ocrOperation);
 let f=await y(a,b);f.textbooks=f.textbooks.filter(a=>a.id!==c),assertTextbookOcrFence(ocrOperation),await z(a,b,f),assertTextbookOcrFence(ocrOperation);let h=await (0,k.sk)(a);return h.worldId===b&&h.textbookId===c&&(assertTextbookOcrFence(ocrOperation),await G(a,b,null),assertTextbookOcrFence(ocrOperation)),!0}
async function N(a,b,c,d){assertTextbookSegments(a,b,c);let e=await y(a,b),f=e.textbooks.find(a=>a.id===c);f&&(f.currentPage=d,await z(a,b,e))}let O=/\.(pdf|md|markdown|epub|qbook|pptx)$/i,P=new Set(["progress.md","progress_archive.md","session_plan.md"]);async function Q(a,b,c){assertTextbookSegments(a,b,c);let e=(0,j.Uu)(a,b,c);if(!(0,g.existsSync)(e))return null;let f=(await y(a,b)).textbooks.find(a=>a.id===c);if(f?.fileName){let a=safeTextbookFileName(f.fileName);if(a){a=i().join(e,a);if((0,g.existsSync)(a))return a}}let h=(await (0,d.readdir)(e)).find(a=>O.test(a)&&!P.has(a));return h?i().join(e,h):null}async function R(a,b,c){let d=(await y(a,b)).textbooks.find(a=>a.id===c);if(d?.format)return d.format;let e=await Q(a,b,c);return e?(0,m.Tz)(i().basename(e)):null}function S(a,b,c){return assertTextbookSegments(a,b,c),i().join((0,j.Uu)(a,b,c),"progress.md")}
async function T(a){let ocrOperation=assertTextbookOcrFence(a&&a.ocrOperation),fenceMismatch=!Object.isFrozen(ocrOperation)||a.accountId!==ocrOperation.accountId||a.sessionEpoch!==ocrOperation.sessionEpoch||a.signal!==ocrOperation.signal||a.deadlineAt!==ocrOperation.deadlineAt;if(fenceMismatch){let a=Error("ocr_scope_invalid");throw a.code="ocr_scope_invalid",a}let{profileId:b,worldId:e,sourcePath:f,originalFileName:h}=a;if(!validTextbookSegment(b)||!validTextbookSegment(e)||!(h=safeTextbookFileName(h))){let a=Error("textbook_scope_invalid");throw a.code="textbook_scope_invalid",a}let n=(0,m.Tz)(h);if(!n)throw Error("不支持的文件格式。支持的格式：PDF、ePub、Markdown、PPTX");if(!(0,g.existsSync)(f))throw Error("文件不存在");let o=await y(b,e);assertTextbookOcrFence(ocrOperation);if(o.textbooks.length>=50)throw Error(`此世界已达教材上限（50 本）`);
let p=function(a,b){let c="abcdefghijklmnopqrstuvwxyz";for(let d=0;d<200;d++){let d=a+c[Math.floor(26*Math.random())]+c[Math.floor(26*Math.random())];if(!b.has(d))return d}throw Error("Failed to generate unique textbook ID")}(e,new Set(o.textbooks.map(a=>a.id))),r=(0,j.Uu)(b,e,p);let pdfOcrScope=null;let importCommitted=!1,indexCommitted=!1,activeCommitted=!1;try{
 assertTextbookOcrFence(ocrOperation);await (0,d.mkdir)(r,{recursive:!0});assertTextbookOcrFence(ocrOperation);let{copyFile:s}=await Promise.resolve().then(c.t.bind(c,79748,23)),x=i().join(r,h);
 assertTextbookOcrFence(ocrOperation);await s(f,x,g.constants.COPYFILE_EXCL),assertTextbookOcrFence(ocrOperation);
 pdfOcrScope="pdf"===n?{accountId:ocrOperation.accountId,profileId:b,worldId:e,textbookId:p,sessionEpoch:ocrOperation.sessionEpoch,expectedLanguage:"english"===a.lang?"en-US":"chinese-traditional"===a.lang?"zh-Hant-TW":"zh-Hans-CN",signal:ocrOperation.signal,deadlineAt:ocrOperation.deadlineAt}:null;
 if(pdfOcrScope){assertTextbookOcrFence(ocrOperation);let ocrCoordinator=global.__PDF_OCR_COORDINATOR__;if(!ocrCoordinator||"function"!=typeof ocrCoordinator.activateScope)throw Error("ocr_lifecycle_unavailable");await ocrCoordinator.activateScope(pdfOcrScope);assertTextbookOcrFence(ocrOperation)}
 assertTextbookOcrFence(ocrOperation);let A=await (0,m.NE)(n),B=await A.detectQuality(x,pdfOcrScope);assertTextbookOcrFence(ocrOperation);
if(!B.ok)throw await (0,d.rm)(r,{recursive:!0,force:!0}),Error(B.reason||"QUALITY_CHECK_FAILED");
 let D=await A.getMetadata(x,pdfOcrScope);assertTextbookOcrFence(ocrOperation);let E=1,H=null,I="",J=null,K=null,L=null,M={contentStartPage:1,marker:null,method:"default",confidence:"low"},N="",O=null,P=0,Q=0,R=0;
if("pdf"===n){
 assertTextbookOcrFence(ocrOperation);let a=await (0,l.U8)(x,pdfOcrScope);assertTextbookOcrFence(ocrOperation);
J=a.title||null,K=a.author||null,L=a.year||null,Q=Math.min(P=a.numPages,Math.max(30,Math.ceil(.12*P))),R=Math.min(P,Math.max(200,Math.ceil(.3*P)));let b=((
 O=await (0,l.Vi)(x,pdfOcrScope).catch(a=>{if(isTextbookOcrFenceError(a))throw a;assertTextbookOcrFence(ocrOperation);return[]}))
||[]).filter(a=>"number"==typeof a.page&&a.page>=1).length;console.log(`[textbook:preface] PDF ${P}p; scanPages=${Q}; outline=${O?.length??0} entries (${b} with pages)`),
 assertTextbookOcrFence(ocrOperation),E=(M=w(N=(await (0,l.ut)(x,1,Q,void 0,!1,pdfOcrScope)).text)).contentStartPage,assertTextbookOcrFence(ocrOperation),
H=M.marker,
 assertTextbookOcrFence(ocrOperation),I=await (0,l.J1)(x,P,E>1?E-1:void 0,pdfOcrScope),assertTextbookOcrFence(ocrOperation)
 }else{assertTextbookOcrFence(ocrOperation);let b=await A.buildPageManifest(x),c=await A.extractAdaptive(x,1,15e3,30,b);assertTextbookOcrFence(ocrOperation);I=c.text,N=c.text;let e=null;try{assertTextbookOcrFence(ocrOperation);let b=await A.getToc(x);assertTextbookOcrFence(ocrOperation);O=b;let c="hosted"===a.accessMode&&a.sessionToken;if((c||a.provider&&a.apiKey)&&b.length>0){let d=await u(b,c?"deepseek":a.provider,c?"hosted":a.apiKey,c?"deepseek-v4-flash":a.model||"",a.lang,{accessMode:a.accessMode,sessionToken:a.sessionToken,deviceId:a.deviceId},c?"deepseek":void 0,ocrOperation);assertTextbookOcrFence(ocrOperation);d&&(e={page:d.page,title:d.title,method:"toc-llm"},console.log(`[textbook:preface] ${n} TOC (LLM-picked): ${b.length} entries; first-content="${d.title}" page=${d.page} reasoning="${d.reasoning}"`))}if(!e){let a="markdown"===n?{preferChapterPattern:!0}:void 0,c=function(a,b){if(b?.preferChapterPattern)for(let b of a){if(!b.title||null==b.page||b.page<1)continue;let a=b.title.trim();if(a&&t.some(b=>b.test(a)))return{page:b.page,title:a}}for(let b of a){if(!b.title||null==b.page||b.page<1)continue;let a=b.title.trim();if(a&&!q.some(b=>b.test(a)))return{page:b.page,title:a}}return null}(b,a);c&&(e={page:c.page,title:c.title,method:"toc-structural"},console.log(`[textbook:preface] ${n} TOC (pattern-picked): ${b.length} entries; first-content="${c.title}" page=${c.page}`))}}catch(a){if(isTextbookOcrFenceError(a))throw a;assertTextbookOcrFence(ocrOperation);console.warn(`[textbook:preface] ${n} getToc failed:`,a)}E=(M=e?{contentStartPage:e.page,marker:e.title,method:e.method,confidence:"high"}:w(N)).contentStartPage,
 H=M.marker,assertTextbookOcrFence(ocrOperation),await (0,d.writeFile)(i().join(r,"pages.json"),JSON.stringify(b,null,2),"utf-8"),assertTextbookOcrFence(ocrOperation)}let S={title:null,author:null,year:null,field:null,abstract:null,contentStartPage:null,contentStartSnippet:null},T=0,U="hosted"===a.accessMode&&a.sessionToken;for(;;){(U||a.provider&&a.apiKey)&&(N||I)&&(assertTextbookOcrFence(ocrOperation),S=await C(N||I,h,U?"deepseek":a.provider,U?"hosted":a.apiKey,U?"deepseek-v4-flash":a.model||"",a.lang,{accessMode:a.accessMode,sessionToken:a.sessionToken,deviceId:a.deviceId},U?"deepseek":void 0,M.contentStartPage>1?{page:M.contentStartPage,marker:M.marker}:null,O,ocrOperation),assertTextbookOcrFence(ocrOperation));let b="toc-structural"===M.method||"toc-llm"===M.method,c=b?[]:v(N||I),d=!1;if(!b&&S.contentStartSnippet){let a=function(a,b){if(!b||b.length<10)return null;let c=a=>a.replace(/\s+/g," ").trim().toLowerCase(),d=c(b);for(let b of a)if(c(b.text).includes(d))return b.pageNum;for(let b=Math.floor(.7*d.length);b>=20;b-=10){let e=d.slice(0,b);for(let b of a)if(c(b.text).includes(e))return b.pageNum}return null}(c,S.contentStartSnippet);if(null!=a){let b=S.contentStartPage,c=null!=b&&Math.abs(a-b)>5,e="high"===M.confidence&&("toc-structural"===M.method||"toc-llm"===M.method||"positive-regex"===M.method)&&a<M.contentStartPage-5;c?console.warn(`[textbook:preface] snippet matched at page ${a} but LLM said page ${b}; rejecting snippet as coincidence`):e?console.warn(`[textbook:preface] snippet matched at page ${a} but ${M.method} says ${M.contentStartPage}; rejecting snippet (likely matched a chapter-title quote in front matter)`):(H=null,M={contentStartPage:E=a,marker:null,method:"llm",confidence:"high"},d=!0)}}if(!b&&!d&&null!=S.contentStartPage&&S.contentStartPage>=1){let a=P>50&&S.contentStartPage<=3,b="high"===M.confidence&&("toc-structural"===M.method||"toc-llm"===M.method||"positive-regex"===M.method);a?console.warn(`[textbook:preface] LLM page=${S.contentStartPage} rejected as suspiciously early for ${P}-page book; keeping regex page=${E} method=${M.method}`):b&&S.contentStartPage!==E?console.warn(`[textbook:preface] LLM page=${S.contentStartPage} (no snippet) rejected; keeping ${M.method} page=${E} (high confidence)`):(S.contentStartPage!==E||"default"===M.method||"negative-regex"===M.method)&&(E=S.contentStartPage,H=null,M={contentStartPage:E,marker:null,method:"llm",confidence:"medium"})}if(console.log(`[textbook:preface] round ${T}: regex page=${M.contentStartPage} (${M.method}/${M.confidence}); LLM page=${S.contentStartPage??"null"} snippet=${S.contentStartSnippet?"yes":"no"}; final page=${E} (${M.method}/${M.confidence})`),"pdf"!==n)break;let e=E>=Q-5,f=(S.contentStartPage??0)>Q,g="default"===M.method,i="low"===M.confidence&&P>50,j=P>50&&E<=3;if(!(e||f||g||i||j)||T>=3||Q>=R)break;Q=Math.min(R,Q+30),T++,
 assertTextbookOcrFence(ocrOperation),E=(M=w(N=(await (0,l.ut)(x,1,Q,void 0,!1,pdfOcrScope)).text)).contentStartPage,assertTextbookOcrFence(ocrOperation),
 H=M.marker,console.log(`[textbook:preface] extension round ${T}: scanPages=${Q}, regex method=${M.method} page=${E}`)}assertTextbookOcrFence(ocrOperation);let V=D.numPages>0?D.numPages:1;E<1&&(E=1),E>V&&(E=V);let W=D.title,X=a.forcedTitle||S.title||W||J||null,Y=a.forcedTitle?"filename":S.title?"llm":W?"epub"===n?"epub":"markdown"===n?"frontmatter":"pdf":J?"pdf":"filename";X||(X=h.replace(/\.[^.]+$/,""),Y="filename");let Z=S.author||D.author||K||null,$=S.year||D.year||L||null,_=D.numPages,aa=new Date().toISOString(),ab={contentStartPage:E,detectedMarker:H,detectionMethod:M.method,confidence:M.confidence,analyzedAt:aa};if(assertTextbookOcrFence(ocrOperation),await (0,d.writeFile)(i().join(r,"preface.json"),JSON.stringify(ab,null,2),"utf-8"),assertTextbookOcrFence(ocrOperation),"pdf"===n&&(U||a.provider&&a.apiKey))try{let b=Math.min(_,30);
 assertTextbookOcrFence(ocrOperation);let c=await (0,l.ut)(x,1,b,void 0,!1,pdfOcrScope);assertTextbookOcrFence(ocrOperation);
 let e=await F(c.text,E,U?"deepseek":a.provider,U?"hosted":a.apiKey,U?"deepseek-v4-flash":a.model||"",a.lang,{accessMode:a.accessMode,sessionToken:a.sessionToken,deviceId:a.deviceId},U?"deepseek":void 0,ocrOperation);assertTextbookOcrFence(ocrOperation);e&&(await (0,d.writeFile)(i().join(r,"toc.json"),JSON.stringify(e,null,2),"utf-8"),assertTextbookOcrFence(ocrOperation))}catch(a){if(isTextbookOcrFenceError(a))throw a;assertTextbookOcrFence(ocrOperation);console.error("[textbook] TOC generation failed (non-critical):",a)}let ac=function(a){let{title:b,format:c,author:d,field:e,abstract:f,contentStartPage:g,numPages:h,date:i,lang:j="chinese"}=a,k="english"===j,l="chinese-traditional"===j,m="pdf"===c,n=m?k?"page":"頁":k?"section":"節",o=m?"页":"节",p=[];return(d&&p.push(k?`- Author: ${d}`:`- 作者：${d}`),e&&p.push(k?`- Field: ${e}`:l?`- 領域：${e}`:`- 领域：${e}`),f&&p.push(k?`- Summary: ${f}`:l?`- 簡介：${f}`:`- 简介：${f}`),p.push(k?`- Format: ${c.toUpperCase()}`:`- 格式：${c.toUpperCase()}`),m&&p.push(k?`- Content starts at: page ${g}`:l?`- 正文起始頁：第 ${g} 頁`:`- 正文起始页：第 ${g} 页`),p.push(k?`- Total ${n}s: ${h}`:l?`- 總${n}數：${h}`:`- 总${o}数：${h}`),p.push(k?`- Date added: ${i}`:`- 添加日期：${i}`),k)?`# "${b}" Study Progress

${p.join("\n")}

## Current Progress

- Current page: ${g} (not yet started)
- Chapters studied: none

## Study Status

This textbook was just added. Study has not yet begun. The next session will start from the first ${m?"chapter":"section"} (${n} ${g}).

## Study Log

(none yet)
`:l?`# 《${b}》學習進度

${p.join("\n")}

## 當前進度

- 當前頁碼：${g}（尚未開始）
- 已學章節：無

## 學習狀態

此教材剛剛添加，尚未開始學習。下次上課將從第一${m?"章":"節"}（第 ${g} ${n}）開始講起。

## 學習記錄

（暫無）
`:`# 《${b}》学习进度

${p.join("\n")}

## 当前进度

- 当前页码：${g}（尚未开始）
- 已学章节：无

## 学习状态

此教材刚刚添加，尚未开始学习。下次上课将从第一${m?"章":"节"}（第 ${g} ${o}）开始讲起。

## 学习记录

（暂无）
`}({title:X,format:n,author:Z||null,field:S.field||null,abstract:S.abstract||null,contentStartPage:E,numPages:_,date:aa.slice(0,10),lang:a.lang});assertTextbookOcrFence(ocrOperation);await (0,d.writeFile)(i().join(r,"progress.md"),ac,"utf-8");assertTextbookOcrFence(ocrOperation);let ad=h,ae=n;if(a.fromLibrary&&"markdown"===n){assertTextbookOcrFence(ocrOperation);try{(0,g.writeFileSync)(i().join(r,"_kb_src.md"),(0,g.readFileSync)(i().join(r,h),"utf-8"))}catch(_){}assertTextbookOcrFence(ocrOperation);let{encryptMarkdown:a,QBOOK_EXTENSION:b}=await c.e(6163).then(c.bind(c,96163)),e=a(await (0,d.readFile)(i().join(r,h),"utf-8"));ad=h.replace(/\.(md|markdown)$/i,b),await (0,d.writeFile)(i().join(r,ad),e),assertTextbookOcrFence(ocrOperation),await (0,d.unlink)(i().join(r,h)).catch(()=>{}),assertTextbookOcrFence(ocrOperation),ae="qbook"}
 assertTextbookOcrFence(ocrOperation);let af={id:p,fileName:ad,format:ae,title:X,titleSource:Y,author:Z,year:$,numPages:_,currentPage:E,field:S.field||null,abstract:S.abstract||null,abstractGeneratedAt:S.abstract?aa:null,addedAt:aa,color:"#7BA8D9",librarySlug:a.librarySlug},ag=await y(b,e);
 ag.textbooks.push(af),assertTextbookOcrFence(ocrOperation),await z(b,e,ag),indexCommitted=!0,assertTextbookOcrFence(ocrOperation),await G(b,e,p),activeCommitted=!0,assertTextbookOcrFence(ocrOperation),
(function(){try{var managed=global.__KB_BUILDER_COORDINATOR__;if(!managed||typeof managed.enqueue!=="function")return void console.warn("[kb-build] builder_protocol_unavailable");Promise.resolve(managed.enqueue({profileId:b,worldId:e,textbookId:p,format:ae,title:X||""})).catch(function(e){console.warn("[kb-build] supervised enqueue failed:",e&&e.message)})
 }catch(e){console.warn("[kb-build] supervised trigger failed:",e&&e.message)}}()),importCommitted=!0;return{entry:af}}catch(importError){if(importCommitted)throw importError;if(indexCommitted)try{let rollback=await y(b,e);rollback.textbooks=rollback.textbooks.filter(a=>a.id!==p),await z(b,e,rollback);if(activeCommitted){let active=await (0,k.sk)(b);active.worldId===e&&active.textbookId===p&&await G(b,e,null)}}catch(cleanupError){console.warn("[textbook] failed import index rollback:",cleanupError&&cleanupError.message)}let importBuilder=global.__KB_BUILDER_COORDINATOR__;if(importBuilder&&"function"==typeof importBuilder.cancelScope)try{await importBuilder.cancelScope({accountId:ocrOperation.accountId,sessionEpoch:ocrOperation.sessionEpoch,profileId:b,worldId:e,textbookId:p})}catch(cleanupError){console.warn("[textbook] failed import Builder cleanup:",cleanupError&&cleanupError.message)}let importOcr=global.__PDF_OCR_COORDINATOR__;if(pdfOcrScope&&importOcr&&"function"==typeof importOcr.purgeScope)try{await importOcr.purgeScope(pdfOcrScope)}catch(cleanupError){console.warn("[textbook] failed import OCR cleanup:",cleanupError&&cleanupError.message)}try{await (0,d.rm)(r,{recursive:!0,force:!0})}catch(cleanupError){console.warn("[textbook] failed import directory cleanup:",cleanupError&&cleanupError.message)}throw importError}}
async function U(a,b,c="chinese"){let d="english"===c,e="chinese-traditional"===c,f=await y(a,b);if(0===f.textbooks.length)return d?"(No textbooks in this world yet)":e?"（此世界暫無教材）":"（此世界暂无教材）";let g=await (0,k.sk)(a);return f.textbooks.map(a=>{let b=a.id===g.textbookId,c=d?[`[${a.id}] "${a.title}"`]:[`【${a.id}】《${a.title}》`];return a.author&&c.push(d?`Author: ${a.author}`:`作者：${a.author}`),a.year&&c.push(d?`${a.year}`:`${a.year}年`),a.field&&c.push(d?`Field: ${a.field}`:e?`領域：${a.field}`:`领域：${a.field}`),a.abstract&&c.push(d?`Summary: ${a.abstract}`:e?`簡介：${a.abstract}`:`简介：${a.abstract}`),b&&c.push(d?"✦ Currently studying":e?"✦ 當前學習中":"✦ 当前学习中"),c.join(" | ")}).join("\n")}}};
