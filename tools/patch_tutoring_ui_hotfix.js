const fs = require("fs");
const path = require("path");

const chunkPath = path.join(
  __dirname,
  "..",
  "resources",
  "server",
  ".next",
  "static",
  "chunks",
  "app",
  "page-3a1fef7566e26c43.js"
);

let source = fs.readFileSync(chunkPath, "utf8");
const original = source;

function replaceOnce(needle, replacement, label) {
  const index = source.indexOf(needle);
  if (index < 0) {
    throw new Error("Missing patch target: " + label);
  }
  if (source.indexOf(needle, index + needle.length) >= 0) {
    throw new Error("Patch target is not unique: " + label);
  }
  source = source.slice(0, index) + replacement + source.slice(index + needle.length);
}

function replaceAll(needle, replacement, label) {
  const count = source.split(needle).length - 1;
  if (count < 1) {
    throw new Error("Missing patch target: " + label);
  }
  source = source.split(needle).join(replacement);
  return count;
}

// The minifier-hotfix pass previously glued `await` and `_pracFetch` together,
// turning a fetch call into a reference to a non-existent function.
const awaitFixes = replaceAll("await_pracFetch()", "await _pracFetch()", "tutoring await _pracFetch");
if (awaitFixes !== 2) {
  throw new Error("Expected 2 await_pracFetch fixes, got " + awaitFixes);
}

// In tutoring mode, hide the normal classroom/workbench column. Otherwise the
// tutoring panel becomes a third sibling and leaves a large blank area on the left.
replaceOnce(
  'className:"flex-1 flex flex-col min-w-0 min-h-0"',
  'className:"tutoring"===ek?"hidden":"flex-1 flex flex-col min-w-0 min-h-0"',
  "main workspace hidden during tutoring"
);

// Keep the worksheet and chat side by side inside the tutoring page.
replaceOnce(
  'style:{gridTemplateColumns:"minmax(0,1fr)",gridTemplateRows:"minmax(0,1fr) minmax(0,1fr)"}',
  'style:{gridTemplateColumns:"minmax(320px,0.95fr) minmax(360px,1.05fr)",gridTemplateRows:"minmax(0,1fr)"}',
  "tutoring workbench/chat grid"
);

// Classroom companion slots use candidateId/customName rather than id/name.
// Normalize those fields before saving the bound tutoring companion.
replaceOnce(
  'companions.map((comp,idx)=>{let active=_tutS.compId===comp.id,color=comp.color||["#7BA8D9","#E88DA0","#9B7ED8","#7FB069"][idx%4];return(0,a.jsxs)("button",{onClick:()=>_tutSetComp(comp.id,comp.name),',
  'companions.map((comp,idx)=>{let compKey=comp.id||comp.candidateId||("slot_"+idx),compName=comp.customName||comp.name||compKey,active=_tutS.compId===compKey,color=comp.color||["#7BA8D9","#E88DA0","#9B7ED8","#7FB069"][idx%4];return(0,a.jsxs)("button",{onClick:()=>_tutSetComp(compKey,compName),',
  "tutoring companion key/name normalization"
);

// The checkmark badge is unnecessary and was showing on every card when ids
// were missing. Selected state remains visible through border/background color.
replaceOnce(
  'active&&(0,a.jsx)("span",{className:"absolute top-2 right-2 z-10 flex items-center justify-center w-5 h-5 rounded-full text-white shadow",style:{background:"var(--accent-solid)"},children:"✓"}),',
  "",
  "remove tutoring companion checkmark badge"
);

const avatarMap =
  '({qiu_lingni:"/avatars/candidates_q_version/Q_qiu.png",lu_yumeng:"/avatars/candidates_q_version/Q_lu.png",wen_ying:"/avatars/candidates_q_version/Q_wen.png",tao_li:"/avatars/candidates_q_version/Q_tao.png",huo_yunlai:"/avatars/candidates_q_version/Q_huo.png",meng_xu:"/avatars/candidates_q_version/Q_meng.png",sun_wukong:"/avatars/candidates_q_version/Q_sun.png",holmes:"/avatars/candidates_q_version/Q_holmes.png",alice:"/avatars/candidates_q_version/Q_alice.png"}[comp.candidateId||comp.id]||"/avatars/candidates/"+(comp.candidateId||comp.id)+".png")';

replaceOnce(
  'src:"/avatars/candidates/"+(comp.candidateId||comp.id)+".png",alt:comp.name||""',
  "src:" + avatarMap + ",alt:compName||\"\"",
  "tutoring companion Q avatar path"
);

replaceOnce(
  'children:(comp.name||"?").slice(0,1)',
  'children:(compName||"?").slice(0,1)',
  "tutoring companion fallback initial"
);

replaceOnce(
  'children:comp.name||"讲题伙伴"',
  'children:compName||"讲题伙伴"',
  "tutoring companion display name"
);

replaceOnce(
  'children:comp.identity||comp.role||"学习伙伴"',
  'children:comp.identity||comp.bio||comp.role||"学习伙伴"',
  "tutoring companion identity fallback"
);

replaceOnce(
  'children:comp.personality||comp.description||"陪你复盘这张卷子"',
  'children:comp.personality||comp.description||comp.bio||"陪你复盘这张卷子"',
  "tutoring companion description fallback"
);

replaceOnce(
  "]},comp.id||idx)})}):",
  "]},compKey)})}):",
  "tutoring companion card key"
);

if (source === original) {
  throw new Error("No changes produced");
}

const backupPath = chunkPath + ".bak-tutoring-ui-hotfix-" + new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
fs.writeFileSync(backupPath, original, "utf8");
fs.writeFileSync(chunkPath, source, "utf8");

console.log("patched", path.relative(process.cwd(), chunkPath));
console.log("backup", path.relative(process.cwd(), backupPath));
