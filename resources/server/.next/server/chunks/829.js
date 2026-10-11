"use strict";exports.id=829,exports.ids=[829],exports.modules={40969:(a,b,c)=>{c.d(b,{$9:()=>r,$x:()=>h,BF:()=>k,Dv:()=>t,Ed:()=>q,Te:()=>n,Uu:()=>o,Zd:()=>s,eX:()=>m,gQ:()=>u,iT:()=>l,nO:()=>p,o3:()=>j,u1:()=>i});var d=c(33873),e=c.n(d),f=c(93536);let g=process.env.PROJECT_ROOT||"";function h(a){let b=a||(0,f.sc)();return b?e().join((0,f.Yq)(b),"profiles"):e().join(g,"profiles")}function i(){return e().join(h(),"profiles.json")}function j(a){return e().join(h(),a)}function k(a){return e().join(j(a),"worlds")}function l(a,b){return e().join(k(a),b)}function m(a){return e().join(k(a),"active.json")}function n(a,b){return e().join(l(a,b),"textbooks")}function o(a,b,c){return e().join(n(a,b),c)}function p(a,b){return e().join(l(a,b),"chats")}function q(a,b){return e().join(l(a,b),"concept-summaries")}function r(a,b){return e().join(l(a,b),"flashcards")}function s(a){return e().join(j(a),"flashcards","favorites.json")}function t(a,b){return e().join(l(a,b),"companions")}function u(a,b,c){return e().join(l(a,b),"conversations",c,"current_reading_summary.json")}},70829:(a,b,c)=>{c.d(b,{Az:()=>K,Dp:()=>E,FL:()=>p,I0:()=>w,IN:()=>o,LM:()=>B,MU:()=>r,Uj:()=>C,V$:()=>q,VY:()=>H,XN:()=>x,YK:()=>I,bw:()=>J,by:()=>D,eZ:()=>G,jo:()=>A,ju:()=>v,sK:()=>z,sk:()=>u,uT:()=>F,vV:()=>n,y4:()=>t,zw:()=>y});var d=c(79748),e=c(23952),f=c.n(e),g=c(29021),h=c(33873),i=c.n(h),j=c(40969);let k=process.env.CONTENT_ROOT||"";function l(a){return"english"===a?"en":"chinese-traditional"===a?"zh-TW":"zh"}function m(a,b="chinese"){let c=l(b),d=i().join(k,c,a);if((0,g.existsSync)(d))return d;if("chinese-traditional"===b){let b=i().join(k,"zh",a);if((0,g.existsSync)(b))return b}let e=i().join(k,"en",a);if((0,g.existsSync)(e))return e;throw Error(`getContentDir: bundled content missing for "${a}" — must exist in en/ at minimum`)}function n(a,b){if(a)return`conversations/${a}/current_reading.md`;if(b)return`textbooks/${b}/current_reading.md`;throw Error("currentReadingPath: need conversationId or textbookId")}function o(a){return`textbooks/${a}/handoff/last_tail.json`}function p(a){return`textbooks/${a}/handoff/last_meta.json`}function q(a){return`conversations/${a}/handoff.json`}function r(a){let{sameCompanion:b,currentCompanionName:c,sourceCompanionName:d,savedAt:e,endingPage:f,teachingLanguage:g,tailCount:h,now:i=new Date}=a,j="english"===g,k=null,l=null;if(e){let a=new Date(e);Number.isNaN(a.getTime())||(l=a,k=`${a.getFullYear()}-${String(a.getMonth()+1).padStart(2,"0")}-${String(a.getDate()).padStart(2,"0")}`)}let m=l?function(a,b,c){let d=b.getTime()-a.getTime();if(d<0)return"";let e=Math.floor(d/36e5);if(e<1)return"";let f="english"===c;if(e<24)return f?`about ${e} hour${1===e?"":"s"} ago`:`约 ${e} 小时前`;let g=Math.floor(e/24);return f?`about ${g} day${1===g?"":"s"} ago`:`约 ${g} 天前`}(l,i,g):"";if(j){let a=k?m?`on ${k} (${m})`:`on ${k}`:"previously",e=null!=f?`, stopped on page ${f}`:"";return b?`(System note: The next ${h} messages are from the end of my previous lesson ${a}${e}.

This is a brand-new lesson, beginning only with my next reply. Any scene, action, or object from the previous lesson ("that piece of paper", "that book", etc.) is in the past — do NOT continue or wrap up those scenes in this lesson. The learner has come back to start a fresh class; respond as a fresh opening: warm greeting + a natural lead into today's learning content.

When referring to the previous lesson, say "last class" or "previously" — not "just now", "a moment ago", "earlier", "this whole class", "this session", "today", or anything implying continuity.)`:`(System note: The next ${h} messages are from the end of the previous lesson, taught by ${d||"the previous companion"} ${a}${e}.

This is a brand-new lesson, beginning only with my (${c}) next reply. Any scene, action, or object from the previous lesson is in the past — do NOT continue or wrap up those scenes in this lesson. The learner has come back to start a fresh class; respond as a fresh opening from me (${c}): warm greeting + a natural lead into today's learning content.

When referring to the previous lesson, say "last class" or "previously" — not "just now", "a moment ago", "earlier", "this whole class", "this session", "today", or anything implying continuity.)`}let n=k?m?`于 ${k}（${m}）`:`于 ${k}`:"之前",o=null!=f?`，停在第 ${f} 页`:"";if(b)return`（系统提示：以下 ${h} 条消息来自我上节课的结尾，${n}${o}。

本节课是一节全新的课，从我的下一条回复才正式开始。上节课里的任何场景、动作、物件（"那张纸"、"那本书"等）都已经过去，不要在本节课延续或收尾这些场景——学习者回来开启新的一节课，请按全新开场来回应：温暖招呼 + 自然引入今天的学习内容。

引用上节课时请说"上节课"，不要说"刚才"、"刚刚"、"整节课"、"本节课"、"这节课"、"今天"等暗示连续性的措辞。）`;let p=k?`${n} 教`:"之前教过";return`（系统提示：以下 ${h} 条消息来自上节课结尾，上节课由 ${d||"上节伙伴"} ${p}${o}。

本节课是一节全新的课，从我（${c}）的下一条回复才正式开始。上节课里的任何场景、动作、物件都已经过去，不要在本节课延续或收尾这些场景——学习者回来开启新的一节课，请按全新开场来回应（由我 ${c} 承接）：温暖招呼 + 自然引入今天的学习内容。

引用上节课时请说"上节课"，不要说"刚才"、"刚刚"、"整节课"、"本节课"、"这节课"、"今天"等暗示连续性的措辞。）`}function s(a){return"english"===a?{identity:"Role",personality:"Personality",colon:": "}:{identity:"身份",personality:"性格",colon:"："}}function t(a,b){return"english"===a?`**Gender**: ${"她"===b?"Female":"他"===b?"Male":"Other"} (in narration and inner monologue, always refer to this character as "${"她"===b?"she":"他"===b?"he":"it"}" — never use the wrong pronoun).`:"chinese-traditional"===a?`**性別**：${"她"===b?"女":"他"===b?"男":"其他"}（旁白和內心描寫中請使用「${b}」來指代此角色，絕不可用錯）`:`**性别**：${"她"===b?"女":"他"===b?"男":"其他"}（旁白和内心描写中请使用"${b}"来指代此角色，绝不可用错）`}async function u(a){let b=(0,j.eX)(a);if(!(0,g.existsSync)(b))return{worldId:null,textbookId:null};try{return JSON.parse(await (0,d.readFile)(b,"utf-8"))}catch{return{worldId:null,textbookId:null}}}async function v(a,b){let c=(0,j.BF)(a);(0,g.existsSync)(c)||await (0,d.mkdir)(c,{recursive:!0});let e=await u(a),h=e.worldId;e.worldId=b,h!==b&&(e.textbookId=null),await f()((0,j.eX)(a),JSON.stringify(e,null,2))}async function w(a,b){let c=i().join((0,j.iT)(a,b),"world_meta.json");if(!(0,g.existsSync)(c))return null;try{return JSON.parse(await (0,d.readFile)(c,"utf-8"))}catch{return null}}async function x(a,b,c){let e=i().join((0,j.iT)(a,b),"world_meta.json");if(!(0,g.existsSync)(e))throw Error("World not found");let h=JSON.parse(await (0,d.readFile)(e,"utf-8"));h.name=c.trim(),await f()(e,JSON.stringify(h,null,2))}async function y(a,b,c){let e=i().join((0,j.iT)(a,b),"world_meta.json");if(!(0,g.existsSync)(e))throw Error("World not found");let h=JSON.parse(await (0,d.readFile)(e,"utf-8")),k=(c||"").trim().slice(0,30);k?h.groupChatName=k:delete h.groupChatName,await f()(e,JSON.stringify(h,null,2))}async function z(a,b,c){let e=i().join((0,j.iT)(a,b),"world_records.md"),h=((0,g.existsSync)(e)?await (0,d.readFile)(e,"utf-8"):"").split("\n").filter(a=>a.trim()),k=`${c.date} | ${c.companionName} | ${c.textbookTitle}`;h.push(k);let l=h.slice(-100);await f()(e,l.join("\n")+"\n");let m=i().join((0,j.iT)(a,b),"world_meta.json");if((0,g.existsSync)(m))try{let a=JSON.parse(await (0,d.readFile)(m,"utf-8"));a.lastStudyDate=c.date,await f()(m,JSON.stringify(a,null,2))}catch{}}async function A(a,b){let c=i().join((0,j.iT)(a,b),"diary");return(0,g.existsSync)(c)?(await (0,d.readdir)(c,{withFileTypes:!0})).filter(a=>a.isFile()&&/^\d{4}-\d{2}\.md$/.test(a.name)).map(a=>a.name.replace(".md","")).sort().reverse():[]}async function B(a,b){let c=i().join((0,j.iT)(a,b),"groupchat","archive");if(!(0,g.existsSync)(c))return[];try{return(await (0,d.readdir)(c,{withFileTypes:!0})).filter(a=>a.isFile()&&/^\d{4}-\d{2}\.md$/.test(a.name)).map(a=>a.name.replace(".md","")).sort()}catch(a){if("ENOENT"===a?.code)return[];throw a}}async function C(a){let b=(0,j.BF)(a);if(!(0,g.existsSync)(b))return[];let c=await (0,d.readdir)(b,{withFileTypes:!0}),e=[];for(let b of c)if(b.isDirectory()&&/^[A-Z]{2}$/.test(b.name)){let c=await w(a,b.name);c&&e.push(c)}return e}async function D(a,b,e,h=[],n,o=!1,p="chinese"){let q,r=await C(a);if(r.length>=5)throw Error("english"===p?"World limit reached (max 5)":"chinese-traditional"===p?`世界數量已達上限（5個）`:`世界数量已达上限（5个）`);let t=function(a){let b="ABCDEFGHIJKLMNOPQRSTUVWXYZ";for(let c=0;c<200;c++){let c=b[Math.floor(26*Math.random())]+b[Math.floor(26*Math.random())];if(!a.has(c))return c}throw Error("Failed to generate unique world ID")}(new Set(r.map(a=>a.worldId))),u=(0,j.iT)(a,t);await (0,d.mkdir)(i().join(u,"textbooks"),{recursive:!0});let{buildCompanionSlot:v,SLOT_IDS:w,isCustomCandidate:x,getCandidateFromAll:y}=await c.e(4039).then(c.bind(c,74039)),{listCustomTemplates:z,getPersonaSourcePath:A,getCustomAvatarSourcePath:B}=await c.e(9964).then(c.bind(c,19964)),E=await z(),F=[null,null,null,null];for(let a=0;a<Math.min(b.length,4);a++){let c=b[a],d=y(c,E,p);F[a]=v(c,d??void 0,p);F[a]&&(F[a].companionInstanceId=global.__COMPANION_CONTINUITY__&&"function"==typeof global.__COMPANION_CONTINUITY__.newCompanionInstanceId?global.__COMPANION_CONTINUITY__.newCompanionInstanceId():"ci_"+Date.now().toString(36)+Math.random().toString(36).slice(2,18))}let G=o?"english"===p?`${e||"My"} Dream Space`:"chinese-traditional"===p?`${e||"我"}的夢想空間`:`${e||"我"}的梦想空间`:"english"===p?"Socrates Lab":"chinese-traditional"===p?"蘇格拉底實驗室":"苏格拉底实验室",H={worldId:t,name:n?.trim()||G,companions:F,createdAt:new Date().toISOString(),language:p};await (0,d.writeFile)(i().join(u,"world_meta.json"),JSON.stringify(H,null,2),"utf-8");let I=m("initial_world/candidates",p),J=i().join(k,"initial_world","candidates_pic"),K=i().join(u,"companions");await (0,d.mkdir)(K,{recursive:!0});for(let a=0;a<F.length;a++){let b=F[a];if(!b)continue;let c=b.candidateId,e=y(c,E,p);if(!e)continue;let f=i().join(u,`${w[a]}.md`);if(x(c)){let g=await A(c);if(g)await (0,d.cp)(g,f);else{let a=s(p);await (0,d.writeFile)(f,`# ${b.name}

**${a.identity}**${a.colon}${e.identity}
**${a.personality}**${a.colon}${e.personality}
`,"utf-8")}let h=await B(c);if(h){let b=i().extname(h);await (0,d.cp)(h,i().join(K,`${w[a]}${b}`))}}else{let c=i().join(I,e.fileName);if((0,g.existsSync)(c))await (0,d.cp)(c,f);else{let a=s(p);await (0,d.writeFile)(f,`# ${b.name}

**${a.identity}**${a.colon}${e.identity}
**${a.personality}**${a.colon}${e.personality}
`,"utf-8")}let h=i().join(J,`${e.id}.png`);(0,g.existsSync)(h)&&await (0,d.cp)(h,i().join(K,`${w[a]}.png`))}}let L=function(a,b="chinese"){let c=l(b),d=i().join(k,c,a);if((0,g.existsSync)(d))return d;if("chinese-traditional"===b){let b=i().join(k,"zh",a);if((0,g.existsSync)(b))return b}let e=i().join(k,"en",a);if((0,g.existsSync)(e))return e;throw Error(`getContentFile: bundled content missing for "${a}" — must exist in en/ at minimum`)}(`initial_world/${o?"world_preset_blank.md":"world_preset.md"}`,p);if((0,g.existsSync)(L))await (0,d.cp)(L,i().join(u,"story.md"));else{let a="english"===p?"# World Narrative\n\nThe story of this world is waiting to be written.\n":"chinese-traditional"===p?"# 世界敘事\n\n這個世界的故事，正在等待被書寫。\n":"# 世界叙事\n\n这个世界的故事，正在等待被书写。\n";await (0,d.writeFile)(i().join(u,"story.md"),a,"utf-8")}let M=[e,...h].filter(Boolean),N="english"===p?", ":"、";q="english"===p?o?`# Learner Profile

## Basic Info

- **Name**: ${e}
- **Nicknames**: ${M.join(N)}

## Background

## Learning Style

## Knowledge Map

## Strengths

## Weaknesses

## Current Status

`:`# Learner Profile

## Basic Info

- **Name**: ${e}
- **Nicknames**: ${M.join(N)}

## Background

- Entrepreneur who earned his first fortune from a second venture
- Founder of Socrates Lab: purchased a grand villa near a top university, recruited study companions who passed a rigorous selection, using himself as the experimental subject
- Driving belief: "Companion + Socrates = 3X \xb7 3A" — a trusted companion using the Socratic method can achieve 3\xd7 lecture efficiency and triple-A game–level engagement
- Ultimate goal: answer The Question of Natural Pedagogy and spread this learning method to the world

## Learning Style

## Knowledge Map

## Strengths

## Weaknesses

## Current Status

`:"chinese-traditional"===p?o?`# 學習者檔案

## 基本資訊

- **姓名**：${e}
- **稱呼**：${M.join(N)}

## 身份背景

## 學習風格

## 知識掌握地圖

## 強項

## 弱項

## 當前狀態

`:`# 學習者檔案

## 基本資訊

- **姓名**：${e}
- **稱呼**：${M.join(N)}

## 身份背景

- 創業者，第二次創業後積累了第一桶金
- 蘇格拉底實驗室的創立者：在名校附近購置豪華別墅，招募通過篩選的學習夥伴同住，以自身為實驗對象
- 驅動信念：「夥伴 + 蘇格拉底 = 3X \xb7 3A」——真心相屬的同伴以蘇格拉底法引導，能達到聽課三倍效率、3A 遊戲級吸引力
- 最終目標：回答「天性教育法之問」，把這套學習法傳播給全世界的學習者

## 學習風格

## 知識掌握地圖

## 強項

## 弱項

## 當前狀態

`:o?`# 学习者档案

## 基本信息

- **姓名**：${e}
- **称呼**：${M.join(N)}

## 身份背景

## 学习风格

## 知识掌握地图

## 强项

## 弱项

## 当前状态

`:`# 学习者档案

## 基本信息

- **姓名**：${e}
- **称呼**：${M.join(N)}

## 身份背景

- 创业者，第二次创业后积累了第一桶金
- 苏格拉底实验室的创立者：在名校附近购置豪华别墅，招募通过筛选的学习伙伴同住，以自身为实验对象
- 驱动信念：「伙伴 + 苏格拉底 = 3X \xb7 3A」——真心相属的同伴以苏格拉底法引导，能达到听课三倍效率、3A 游戏级吸引力
- 最终目标：回答"天性教育法之问"，把这套学习法传播给全世界的学习者

## 学习风格

## 知识掌握地图

## 强项

## 弱项

## 当前状态

`,await (0,d.writeFile)(i().join(u,"learner_profile.md"),q,"utf-8"),await (0,d.writeFile)(i().join(u,"world_records.md"),"","utf-8"),await (0,d.mkdir)(i().join(u,"groupchat","archive"),{recursive:!0}),await (0,d.writeFile)(i().join(u,"groupchat","recent.md"),"","utf-8"),await (0,d.writeFile)(i().join(u,"groupchat","last_read.txt"),"","utf-8");let O={worldId:t,updatedAt:new Date().toISOString(),textbooks:[]};return await f()(i().join(u,"textbooks","textbook_index.json"),JSON.stringify(O,null,2)),H}async function E(a,b,c){let e=i().join((0,j.iT)(a,b),c);return(0,g.existsSync)(e)?(0,d.readFile)(e,"utf-8"):""}async function F(a,b){let d=(0,j.iT)(a,b);if(!(0,g.existsSync)(d))return;let{rm:e}=await Promise.resolve().then(c.t.bind(c,79748,23));await e(d,{recursive:!0,force:!0}),(await u(a)).worldId===b&&await f()((0,j.eX)(a),JSON.stringify({worldId:null,textbookId:null},null,2))}async function G(a,b,e,h){let l=i().join((0,j.iT)(a,b),"world_meta.json");if(!(0,g.existsSync)(l))throw Error("World not found");let n=JSON.parse(await (0,d.readFile)(l,"utf-8")),o=n.language||"chinese",{buildCompanionSlot:p,getCandidateById:q,getCandidateFromAll:r,isCustomCandidate:t,SLOT_IDS:u}=await c.e(4039).then(c.bind(c,74039)),{listCustomTemplates:v,getPersonaSourcePath:w,getCustomAvatarSourcePath:x}=await c.e(9964).then(c.bind(c,19964)),y=await v(),z=n.companions[e],A=!z||z.candidateId!==h.candidateId,B=r(h.candidateId,y,o),C=p(h.candidateId,B??void 0,o);if(!C)throw Error("Invalid candidateId");C.companionInstanceId=A?global.__COMPANION_CONTINUITY__&&"function"==typeof global.__COMPANION_CONTINUITY__.newCompanionInstanceId?global.__COMPANION_CONTINUITY__.newCompanionInstanceId():"ci_"+Date.now().toString(36)+Math.random().toString(36).slice(2,18):(z?.companionInstanceId||(global.__COMPANION_CONTINUITY__&&"function"==typeof global.__COMPANION_CONTINUITY__.newCompanionInstanceId?global.__COMPANION_CONTINUITY__.newCompanionInstanceId():"ci_"+Date.now().toString(36)+Math.random().toString(36).slice(2,18)));let D=A?h.customName??null:h.customName??z?.customName??null;if(C.customName=D||null,C.bio=h.bio??(A?C.bio:z?.bio),h.pronoun?C.pronoun="他"===h.pronoun?"他":"她":!A&&z?.pronoun&&(C.pronoun=z.pronoun),h.color?C.color=h.color:z?.color&&(C.color=z.color),D&&(C.nicknames=[...new Set([...C.nicknames,D])]),n.companions[e]=C,await f()(l,JSON.stringify(n,null,2)),A){let c=h.candidateId,f=r(c,y,o);if(f){let h=i().join((0,j.iT)(a,b),`${u[e]}.md`),k=s(o),l=`# ${C.name}

**${k.identity}**${k.colon}${f.identity}
**${k.personality}**${k.colon}${f.personality}
`;if(t(c)){let a=await w(c);a?await (0,d.cp)(a,h):await (0,d.writeFile)(h,l,"utf-8")}else{let a=m("initial_world/candidates",o),b=i().join(a,f.fileName);(0,g.existsSync)(b)?await (0,d.cp)(b,h):await (0,d.writeFile)(h,l,"utf-8")}}}if(A||h.refreshAvatar){let f=h.candidateId,l=r(f,y,o);if(l){let h=i().join((0,j.iT)(a,b),"companions");(0,g.existsSync)(h)||await (0,d.mkdir)(h,{recursive:!0});let m=await (0,d.readdir)(h),n=u[e]+".";for(let a of m)if(a.startsWith(n)){let{unlink:b}=await Promise.resolve().then(c.t.bind(c,79748,23));await b(i().join(h,a))}if(t(f)){let a=await x(f);if(a){let b=i().extname(a);await (0,d.cp)(a,i().join(h,`${u[e]}${b}`))}}else{let a=i().join(k,"initial_world","candidates_pic",`${l.id}.png`);(0,g.existsSync)(a)&&await (0,d.cp)(a,i().join(h,`${u[e]}.png`))}}}let F=`relation_${u[e]}.md`;if(A)await I(a,b,F,"");else if(h.pronoun&&z?.pronoun&&z.pronoun!==h.pronoun)await I(a,b,F,"");else{let c=z?z.customName||z.name:null,d=C.customName||C.name;if(c&&c!==d){let e=await E(a,b,F);e.trim()&&await I(a,b,F,e.split(c).join(d))}}return n}async function H(a,b,e){let{SLOT_IDS:f}=await c.e(4039).then(c.bind(c,74039)),h=i().join((0,j.iT)(a,b),"world_meta.json");if(!(0,g.existsSync)(h))throw Error("World not found");let k=JSON.parse(await (0,d.readFile)(h,"utf-8"));k.companions[e]=null,await (0,d.writeFile)(h,JSON.stringify(k,null,2),"utf-8"),await I(a,b,`relation_${f[e]}.md`,"");let l=i().join((0,j.iT)(a,b),`${f[e]}.md`);if((0,g.existsSync)(l)){let{unlink:a}=await Promise.resolve().then(c.t.bind(c,79748,23));await a(l)}let m=i().join((0,j.iT)(a,b),"companions");if((0,g.existsSync)(m)){let a=await (0,d.readdir)(m),b=f[e]+".";for(let d of a)if(d.startsWith(b)){let{unlink:a}=await Promise.resolve().then(c.t.bind(c,79748,23));await a(i().join(m,d))}}return k}async function I(a,b,c,e){let f=i().join((0,j.iT)(a,b),c),h=i().dirname(f);(0,g.existsSync)(h)||await (0,d.mkdir)(h,{recursive:!0});let k=f+".tmp";await (0,d.writeFile)(k,e,"utf-8");try{await (0,d.rename)(k,f)}catch(a){throw await (0,d.unlink)(k).catch(()=>{}),a}}function J(a,b){let c=[...a];if(c.length<=b)return a;let d=c.slice(0,b).join(""),e=Math.max(d.lastIndexOf("。"),d.lastIndexOf("！"),d.lastIndexOf("？"),d.lastIndexOf("\n"));return e>0?d.slice(0,e+1).trim():d.trim()}async function K(a,b,d){let e=i().join((0,j.iT)(a,b),d);if((0,g.existsSync)(e)){let{unlink:a}=await Promise.resolve().then(c.t.bind(c,79748,23));await a(e)}}}};