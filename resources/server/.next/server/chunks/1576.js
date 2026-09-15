"use strict";exports.id=1576,exports.ids=[1576,4092],exports.modules={31576:(a,b,c)=>{c.d(b,{B6:()=>j,JM:()=>m,Kk:()=>p,Ui:()=>g,bP:()=>f,cf:()=>q,kc:()=>n,qH:()=>o,qK:()=>k,xC:()=>l});var d=c(87788);function e(a){return a>=19968&&a<=40959||a>=13312&&a<=19903||a>=12352&&a<=12543||a>=44032&&a<=55215}function f(a){let b=0;for(let c=0;c<a.length;){let d=a.codePointAt(c)??0;b+=e(d)?1:.25,c+=d>65535?2:1}return Math.ceil(b)}function g(a,b){let c=0;for(let d=0;d<a.length;){let f=a.codePointAt(d)??0;if((c+=e(f)?1:.25)>b)return a.slice(0,d);d+=f>65535?2:1}return a}function h(a){let b=Math.floor(f(a)/2),c=0,d=a.length;for(let f=0;f<a.length;){let g=a.codePointAt(f)??0;if((c+=e(g)?1:.25)>=b){d=f;break}f+=g>65535?2:1}let g=a.indexOf("\n",d),h=g>=0?g+1:d;return{firstHalf:a.slice(0,h),secondHalf:a.slice(h)}}function i(a,b=5){return a.split("\n").filter(a=>a.trim().length>0).slice(0,b).join("\n")}async function j(a,b="chinese",c){let e,g;if(2e3>f(a))return"";let k=null;if(c&&(k=await (0,d.x)(c.profileId,c.worldId,c.convId,a)),k)e=k.firstHalf,g=k.secondHalf;else{let{firstHalf:f,secondHalf:j}=h(a);e=i(f,5),g=i(j,5),c&&(0,d.p)({profileId:c.profileId,worldId:c.worldId,convId:c.convId,content:a,pageStart:c.pageStart,pageEnd:c.pageEnd,apiKey:c.apiKey,hosted:c.hosted,teachingLanguage:b})}return e.trim()&&g.trim()?"english"===b?`

## Textbook Progress Detection

The currently loaded textbook content has two halves.

First half summary:
${e}

Second half summary:
${g}

Based on the companion's recent 3 responses, is the teaching content more about the first half or the second half? Add a field "contentProgress" with value "first_half" or "second_half" to your JSON output.`:`

## 教材进度检测

当前已加载的教材内容分为前后两部分。

前半部分摘要：
${e}

后半部分摘要：
${g}

根据伙伴最近3轮发言，教学内容更像在讲前半部分还是后半部分？请在JSON输出中增加 "contentProgress" 字段，取值 "first_half" 或 "second_half"。`:""}function k(){return!1}async function l(a){let b,c,{currentContent:d,endPage:e,extractFn:f,writeFn:i,targetTokens:j=1e4}=a,k=Math.floor(j/2),s=Math.max(1,(Number(e)||0)+1);try{c=await f(s,4*k)}catch{return null}if(!c.text.trim())return null;let l=c.text,n=g(l,j),o=n.length<l.length,p=m(n,o)??c.endPage,q=(b=n.match(/---\s*(?:第\s*(\d+)\s*页|Page\s*(\d+))\s*---/))?parseInt(b[1]||b[2],10):null;null===q&&(q=c.startPage??s);q=Number(q)||s,p=Number(p),(!Number.isFinite(p)||p<q)&&(p=q);let r=await i(n,p,q)||{};return{newEndPage:r.endPage??p,newStartPage:r.startPage??q}}function m(a,b=!1){let c,d=/---\s*(?:第\s*(\d+)\s*页|Page\s*(\d+))\s*---/g,e=[];for(;null!==(c=d.exec(a));)e.push(parseInt(c[1]||c[2],10));return 0===e.length?null:b&&e.length>=2?e[e.length-2]:e[e.length-1]}function n(a,b,c,d){let e="string"==typeof a?a.match(/^<!-- kbRange: (\d+)-(\d+) -->\r?\n?/):null;e&&(b=parseInt(e[1],10),c=parseInt(e[2],10),a=a.slice(e[0].length));let f="";return d&&"object"==typeof d&&(d.chunkId&&(f+=" chunkId: "+d.chunkId),d.ordinal&&(f+=" ordinal: "+d.ordinal),void 0!==d.loadedOnly&&(f+=" loadedOnly: "+(d.loadedOnly?"true":"false"))),`<!-- startPage: ${b} endPage: ${c}${f} -->\r\n${a}`}function o(a){let b=a.match(/^<!-- startPage: (\d+) endPage: (\d+)([^>]*)-->/);if(b){let c=b[3]||"",d=a=>{let b=c.match(new RegExp("\\b"+a+"\\s*:\\s*([^\\s>]+)"));return b?b[1]:null},e=d("ordinal");return{startPage:parseInt(b[1],10),endPage:parseInt(b[2],10),chunkId:d("chunkId")||null,ordinal:e?parseInt(e,10):void 0,loadedOnly:"true"===String(d("loadedOnly")).toLowerCase()}}let c=a.match(/^<!-- endPage: (\d+) -->/);return c?{startPage:1,endPage:parseInt(c[1],10)}:null}function p(a){let b=o(a);return b?b.endPage:null}function q(a){return a.replace(/^<!-- startPage: \d+ endPage: \d+[^>]*-->\r?\n/,"").replace(/^<!-- (?:startPage: \d+ )?endPage: \d+ -->\r?\n/,"")}},36741:(a,b,c)=>{c.d(b,{I:()=>d});function d(a){if(!a||"string"!=typeof a)return null;let b=a.replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/g,"").trim();if(!b)return null;try{return JSON.parse(b)}catch{}let c=b.indexOf("{"),d=b.indexOf("["),e=-1,f="}";if(c>=0&&(d<0||c<d)?(e=c,f="}"):d>=0&&(e=d,f="]"),e<0)return null;let g=b.lastIndexOf(f);if(g<=e)return null;b=(b=b.slice(e,g+1)).replace(/[“”]/g,'"');try{return JSON.parse(b)}catch{return null}}},64092:(a,b,c)=>{c.d(b,{$b:()=>d,callLLM:()=>g,mx:()=>f});let d=function(){let a={anthropic:"claude-sonnet-4-20250514",openai:"gpt-4o-mini",gemini:"gemini-2.5-flash",deepseek:"deepseek-v4-flash",qwen:"qwen-plus",moonshot:"moonshot-v1-auto",minimax:"MiniMax-M2.7-highspeed"},b=global.__SOCRATOPIA_SETTINGS__||{},c=(process.env.SOCRATOPIA_API_TYPE||b.apiType||b.Base_API||"").toLowerCase();return b[c]?.models||a}(),e=process.env.SOCRATOPIA_PROXY_URL||"http://127.0.0.1:9";function h(a){return a=(a||"").toLowerCase(),"openai"===a||"deepseek"===a?a:""}function i(a,b){let c=h(process.env.SOCRATOPIA_API_TYPE)||h(a?.apiType)||h(a?.Base_API)||h(b);return c&&a?.[c]?c:h(b)||"deepseek"}function f(a,b,c,d){let s=global.__SOCRATOPIA_SETTINGS__||{},t=i(s,d||a),u=s[t]||{},v="openai"===t?process.env.SOCRATOPIA_OPENAI_API_KEY:"deepseek"===t?process.env.SOCRATOPIA_DEEPSEEK_API_KEY:"",w=v||u.apiKey,x=u.baseUrl||"";if(w&&x)return{apiKey:w,baseURL:x,extraHeaders:{},isHosted:!1,provider:t};let y=s[a]||{};if(b){let c=x||y.baseUrl||s.proxyUrl||e;return{apiKey:b,baseURL:c,extraHeaders:{},isHosted:!1,provider:t}}if(c?.accessMode==="hosted"&&c?.sessionToken){let a={"X-Session-Token":c.sessionToken};return c.deviceId&&(a["X-Device-Id"]=c.deviceId),d&&(a["X-Force-Provider"]=d),{apiKey:"hosted",baseURL:e,extraHeaders:a,isHosted:!0,provider:t}}throw Error("BYOK_NOT_AVAILABLE")}async function g(a){let{provider:b,apiKey:c,model:d,systemPrompt:e,messages:g,maxTokens:h=4096,timeoutMs:i=9e4,hosted:j,forceProvider:k,stripThink:l=!0,thinking:m,purpose:n,noFallback:o,responseFormat:p,signal:_externalSignal,deadlineAt:_deadlineAt}=a,q=f(b,c,j,k);a.baseURL&&(q.baseURL=a.baseURL,q.apiKey=c||q.apiKey,q.isHosted=!1);q.isHosted&&n&&(q.extraHeaders["X-Socratopia-Purpose"]=n),q.isHosted&&o&&(q.extraHeaders["X-No-Fallback"]="true");d||(d=((global.__SOCRATOPIA_SET__||{}).strong||{}).model||((global.__SOCRATOPIA_SET__||{}).kb||{}).model||((global.__SOCRATOPIA_SET__||{}).weak||{}).model||d);let r=new AbortController,_finiteDeadline=Number.isFinite(Number(_deadlineAt)),_deadlineRemaining=_finiteDeadline?Number(_deadlineAt)-Date.now():1/0;if(_finiteDeadline&&_deadlineRemaining<=0){let a=Error("request_deadline");throw a.code="request_deadline",a}if(_externalSignal&&_externalSignal.aborted){let a=_externalSignal.reason;if(a&&"string"==typeof a.code)throw a;let b=Error("request_aborted");throw b.code="request_aborted",b}let _configuredTimeout=Math.max(1,Number(i)||9e4),_effectiveTimeout=Math.max(1,Math.min(_configuredTimeout,_deadlineRemaining)),_deadlineWins=_finiteDeadline&&_deadlineRemaining<=_configuredTimeout,_externalAbort=()=>{let a=_externalSignal&&_externalSignal.reason;if(a&&"string"==typeof a.code)return r.abort(a);let b=Error("request_aborted");b.code="request_aborted",r.abort(b)};_externalSignal&&_externalSignal.addEventListener("abort",_externalAbort,{once:!0});let s=setTimeout(()=>{if(_deadlineWins){let a=Error("request_deadline");a.code="request_deadline",r.abort(a)}else r.abort()},_effectiveTimeout);try{let a="";{let c=q.baseURL||"",f=await fetch(`${c}/chat/completions`,{method:"POST",headers:{Authorization:`Bearer ${q.apiKey}`,"Content-Type":"application/json",...q.extraHeaders},body:JSON.stringify({model:d,max_tokens:h,stream:!1,messages:[{role:"system",content:e},...g.map(a=>({role:a.role,content:a.content}))],...void 0!==m&&(console.log("[callLLM] thinking="+(m?"enabled":"disabled")+" applied="+/^deepseek/i.test(String(d||""))+" model="+d),/^deepseek/i.test(String(d||"")))?{thinking:{type:m?"enabled":"disabled"}}:{},.../^gpt-5\.6/i.test(String(d||""))?{prompt_cache_key:("socratopia:"+(n||"general")+":"+d).toLowerCase().replace(/[^a-z0-9_.:-]/g,"-").slice(0,64),prompt_cache_retention:"24h"}:{},..."json_object"===p?{response_format:{type:"json_object"}}:{}}),signal:r.signal}),i=await f.json();i?.usage&&console.log("[callLLM-cache]",{model:d,purpose:n,promptTokens:i.usage.prompt_tokens,cachedTokens:i.usage.prompt_tokens_details?.cached_tokens||0,cacheWriteTokens:i.usage.prompt_tokens_details?.cache_write_tokens||0});if(f.ok&&"end-class"===n&&"length"===i.choices?.[0]?.finish_reason){let a=Error("End-class report exceeded the provider output limit");throw a.code="END_CLASS_OUTPUT_TRUNCATED",console.warn("[end-class] provider output truncated",{model:d,maxTokens:h,completionTokens:i.usage?.completion_tokens,finishReason:"length"}),a}a=i.choices?.[0]?.message?.content||"",f.ok&&a||console.error("[callLLM-DIAG] non-OK or empty response:",{status:f.status,statusText:f.statusText,dataKeys:Object.keys(i||{}),dataError:i?.error,dataPreview:JSON.stringify(i).slice(0,500),provider:b,model:d,purpose:n,systemPromptLen:e.length,messagesLen:g.length})}return l&&a?a.replace(/<think>[\s\S]*?<\/think>\s*/g,""):a}catch(_llmError){if(_externalSignal&&_externalSignal.aborted){let a=_externalSignal.reason;if(a&&"string"==typeof a.code)throw a;let b=Error("request_aborted");throw b.code="request_aborted",b}if(_finiteDeadline&&Date.now()>=Number(_deadlineAt)){let a=Error("request_deadline");throw a.code="request_deadline",a}throw _llmError}finally{clearTimeout(s),_externalSignal&&_externalSignal.removeEventListener("abort",_externalAbort)}}},87788:(a,b,c)=>{c.d(b,{p:()=>s,x:()=>r});var d=c(55511),e=c.n(d),f=c(79748),g=c(29021),h=c(33873),i=c.n(h),j=c(23952),k=c.n(j),l=c(40969),m=c(64092),n=c(36741);function o(a){return"sha256:"+e().createHash("sha256").update(a,"utf-8").digest("hex")}let p=new Set,q=new Map;async function r(a,b,c,d){let e=(0,l.gQ)(a,b,c);if(!(0,g.existsSync)(e))return null;try{let a=await (0,f.readFile)(e,"utf-8"),b=JSON.parse(a);if(1!==b.schemaVersion||b.contentHash!==o(d)||"string"!=typeof b.firstHalf?.summary||"string"!=typeof b.secondHalf?.summary||0===b.firstHalf.summary.length||0===b.secondHalf.summary.length)return null;return{firstHalf:b.firstHalf.summary,secondHalf:b.secondHalf.summary}}catch{return null}}async function s(a){let{profileId:b,worldId:c,convId:d,content:e,pageStart:g,pageEnd:h,apiKey:j,hosted:r,teachingLanguage:s}=a,t=o(e),u=`${d}:${t}`;if(p.has(u))return;let v=q.get(u);if(!(v&&Date.now()-v<6e4)){p.add(u);try{let a="english"===s,o=a?`You are a textbook content summarization assistant. Task: conceptually split the given textbook content into a "front half" and "back half" by token count, and summarize each in 200-300 tokens (hard cap 500).

Summary should:
- List main concepts, terms, and method names
- Capture the core argument / coverage of each half in 2-3 sentences
- Note the page range covered (inferred from --- Page N --- or --- 第 N 页 --- markers in the content)

Output strict JSON, no markdown code block:
{
  "firstHalf": {
    "pageRange": "e.g. 4-13",
    "summary": "front half summary, 200-300 tokens"
  },
  "secondHalf": {
    "pageRange": "e.g. 14-23",
    "summary": "back half summary, 200-300 tokens"
  }
}`:`你是教材内容摘要助手。任务：把给定的教材内容按 token 数概念性地切成"前半"和"后半"，分别用 200-300 个 tokens（不超过 500）的中文总结。

总结要点：
- 列出主要概念、术语、方法名
- 用 2-3 句话说每一半的核心论点 / 涵盖范围
- 注明涵盖的页码范围（从内容中的 --- 第 N 页 --- 或 --- Page N --- 标记推算）

严格输出 JSON，不要 markdown 代码块：
{
  "firstHalf": {
    "pageRange": "页码范围如 4-13",
    "summary": "前半部分总结，200-300 tokens"
  },
  "secondHalf": {
    "pageRange": "页码范围",
    "summary": "后半部分总结，200-300 tokens"
  }
}`,p=a?`Here is the textbook content currently loaded for teaching (pages ${g}-${h}). Split it conceptually into a front half and back half, then summarize each.

Content:

${e}`:`下面是当前教学加载的教材内容（页 ${g}-${h}）。请概念性地分为前半和后半，分别总结。

内容：

${e}`,v=await (0,m.callLLM)({provider:(()=>{var S=global.__SOCRATOPIA_SETTINGS__||{};if(S.apiType===S.Base_API)return S.apiType;return""})(),apiKey:j,model:(()=>{var S=global.__SOCRATOPIA_SETTINGS__||{};if(S.apiType===S.Base_API){var T=S[S.apiType];if(T&&T.models){var M=T.models[S.apiType];if(M)return M}}return""})(),systemPrompt:o,messages:[{role:"user",content:p}],timeoutMs:3e4,hosted:r,forceProvider:void 0,thinking:!1,purpose:"summary"}),w=(0,n.I)(v);if(!w){console.warn(`[reading-summary] JSON repair returned null for conv=${d.slice(0,8)}, skipping cache write`),q.set(u,Date.now());return}if("string"!=typeof w.firstHalf?.summary||"string"!=typeof w.secondHalf?.summary||0===w.firstHalf.summary.length||0===w.secondHalf.summary.length){console.warn(`[reading-summary] LLM returned invalid schema for conv=${d.slice(0,8)}, skipping cache write`),q.set(u,Date.now());return}let x=w.firstHalf.summary.length,y=w.secondHalf.summary.length;if(x<50||x>2e3||y<50||y>2e3){console.warn(`[reading-summary] summary length out of sanity range (${x}, ${y}) for conv=${d.slice(0,8)}, skipping cache write`),q.set(u,Date.now());return}let z={schemaVersion:1,contentHash:t,generatedAt:new Date().toISOString(),pageRange:{start:g,end:h},firstHalf:{pageRange:w.firstHalf.pageRange??`${g}-?`,summary:w.firstHalf.summary},secondHalf:{pageRange:w.secondHalf.pageRange??`?-${h}`,summary:w.secondHalf.summary}},A=(0,l.gQ)(b,c,d);await (0,f.mkdir)(i().dirname(A),{recursive:!0}),await k()(A,JSON.stringify(z,null,2),"utf-8"),q.delete(u)}catch(a){console.warn(`[reading-summary] generation failed for conv=${d.slice(0,8)}: ${a instanceof Error?a.message:a}`),q.set(u,Date.now())}finally{p.delete(u)}}}}};
