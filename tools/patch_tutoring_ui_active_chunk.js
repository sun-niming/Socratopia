const fs = require("fs");
const path = require("path");

const chunkPath = path.join(
  process.cwd(),
  "resources",
  "server",
  ".next",
  "static",
  "chunks",
  "app",
  "page-practice-ui-20260622.js"
);

let source = fs.readFileSync(chunkPath, "utf8");
const original = source;

function replaceOnce(needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0) throw new Error(`Missing patch target: ${label}`);
  if (source.indexOf(needle, first + needle.length) >= 0) {
    throw new Error(`Patch target is not unique: ${label}`);
  }
  source = source.slice(0, first) + replacement + source.slice(first + needle.length);
}

// Tutoring currently mounts beside the normal classroom workspace, which leaves
// the large blank area visible. Hide that workspace while the tutoring route is active.
replaceOnce(
  'className:"flex-1 flex flex-col min-w-0 min-h-0"',
  'className:"tutoring"===ek?"hidden":"flex-1 flex flex-col min-w-0 min-h-0"',
  "hide main workspace during tutoring"
);

// Once the main workspace is hidden, the tutoring container has full width again.
// Keep worksheet and chat side by side instead of stacked rows.
replaceOnce(
  'style:{gridTemplateColumns:"minmax(0,1fr)",gridTemplateRows:"minmax(0,1fr) minmax(0,1fr)"}',
  'style:{gridTemplateColumns:"minmax(320px,0.95fr) minmax(360px,1.05fr)",gridTemplateRows:"minmax(0,1fr)"}',
  "side-by-side tutoring grid"
);

// Classroom companion slots are stored as candidateId/customName/bio. The old
// tutoring picker used id/name only, causing wrong keys and avatar fallback.
replaceOnce(
  'companions.map((comp,idx)=>{let active=_tutS.compId===comp.id,color=comp.color||["#7BA8D9","#E88DA0","#9B7ED8","#7FB069"][idx%4];return(0,a.jsxs)("button",{onClick:()=>_tutSetComp(comp.id,comp.name),',
  'companions.map((comp,idx)=>{let compKey=comp.id||comp.candidateId||("slot_"+idx),compName=comp.customName||comp.name||compKey,active=_tutS.compId===compKey,color=comp.color||["#7BA8D9","#E88DA0","#9B7ED8","#7FB069"][idx%4];return(0,a.jsxs)("button",{onClick:()=>_tutSetComp(compKey,compName),',
  "normalize tutoring companion key/name"
);

replaceOnce(
  'active&&(0,a.jsx)("span",{className:"absolute top-2 right-2 z-10 flex items-center justify-center w-5 h-5 rounded-full text-white shadow",style:{background:"var(--accent-solid)"},children:"✓"}),',
  "",
  "remove always-on active badge risk"
);

const avatarMap =
  '({qiu_lingni:"/avatars/candidates/qiu_lingni.png",lu_yumeng:"/avatars/candidates/lu_yumeng.png",wen_ying:"/avatars/candidates/wen_ying.png",tao_li:"/avatars/candidates/tao_li.png",huo_yunlai:"/avatars/candidates/huo_yunlai.png",meng_xu:"/avatars/candidates/meng_xu.png",sun_wukong:"/avatars/candidates/sun_wukong.png",holmes:"/avatars/candidates/holmes.png",alice:"/avatars/candidates/alice.png"}[comp.candidateId||comp.id]||"/avatars/candidates/"+(comp.candidateId||comp.id)+".png")';

replaceOnce(
  'src:"/avatars/candidates/"+(comp.candidateId||comp.id)+".png",alt:comp.name||""',
  `src:${avatarMap},alt:compName||""`,
  "real tutoring companion avatar path"
);

replaceOnce(
  'children:(comp.name||"?").slice(0,1)',
  'children:(compName||"?").slice(0,1)',
  "fallback initial from normalized name"
);

replaceOnce(
  'children:comp.name||"讲题伙伴"',
  'children:compName||"讲题伙伴"',
  "display normalized companion name"
);

replaceOnce(
  'children:comp.identity||comp.role||"学习伙伴"',
  'children:comp.identity||comp.bio||comp.role||"学习伙伴"',
  "display classroom identity/bio fallback"
);

replaceOnce(
  'children:comp.personality||comp.description||"陪你复盘这张卷子"',
  'children:comp.personality||comp.description||comp.bio||""',
  "remove temporary tutoring description fallback"
);

replaceOnce(
  "]},comp.id||idx)})}):",
  "]},compKey)})}):",
  "stable tutoring companion card key"
);

if (source === original) throw new Error("No changes produced");

const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const backupPath = `${chunkPath}.bak-active-tutoring-ui-${stamp}`;
fs.writeFileSync(backupPath, original, "utf8");
fs.writeFileSync(chunkPath, source, "utf8");

console.log(`patched ${path.relative(process.cwd(), chunkPath)}`);
console.log(`backup ${path.relative(process.cwd(), backupPath)}`);
