// Smoke test for progress-resume helper + KB resume focus rendering.
// Run: node resources/server/lib/resume/smoke-test.js
"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");

var R = require("./progress-resume.js");

var pass = 0;
function ok(cond, msg) { assert.ok(cond, msg); pass++; }
function eq(a, b, msg) { assert.strictEqual(a, b, msg + " (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")"); pass++; }

// ---- 1. parseProgressPage: Chinese formats ----
eq(R.parseProgressPage("# 当前页码：第 148 页\n其余内容"), 148, "zh '# 当前页码：第 148 页'");
eq(R.parseProgressPage("# 当前页：第 148 页"), 148, "zh '# 当前页：第 148 页'");
eq(R.parseProgressPage("第 148 页"), 148, "zh bare '第 148 页'");
eq(R.parseProgressPage("# 當前頁碼：第 99 頁"), 99, "zh-TW '第 99 頁'");

// ---- 2. parseProgressPage: English formats ----
eq(R.parseProgressPage("# Current Page: Page 148\nrest"), 148, "en '# Current Page: Page 148'");
eq(R.parseProgressPage("Current Page: 200"), 200, "en 'Current Page: 200'");
eq(R.parseProgressPage("Page 77"), 77, "en bare 'Page 77'");
eq(R.parseProgressPage("nothing here"), null, "no page -> null");
eq(R.parseProgressPage(""), null, "empty -> null");

// ---- 3. resolveStartPage priority ----
var tmp = fs.mkdtempSync(path.join(os.tmpdir(), "resume-smoke-"));
var tbDir = path.join(tmp, "textbooks", "TB1");
fs.mkdirSync(tbDir, { recursive: true });

// no state, no md, currentPage only
var r0 = R.resolveStartPage({ textbookDir: tbDir, progressMdText: "", currentPage: 12 });
eq(r0.startPage, 12, "fallback currentPage");
eq(r0.source, "currentPage", "source currentPage");

// md present, no state -> md wins over currentPage
var r1 = R.resolveStartPage({ textbookDir: tbDir, progressMdText: "# 当前页码：第 148 页", currentPage: 12 });
eq(r1.startPage, 148, "progress.md page beats currentPage");
eq(r1.source, "progress.md", "source progress.md");
ok(r1.resumeState && r1.resumeState.lastTaughtPage === 148, "resumeState carries lastTaughtPage from md");

var r1TailOnly = R.resolveStartPage({
  textbookDir: path.join(tmp, "textbooks", "NO_STATE"),
  progressMdText: "# Current Page: Page 171\n## 2026-06-25 | A\np.142-171 | CSS",
  currentPage: 142,
});
eq(r1TailOnly.startPage, 142, "no-state progress.md window tail resumes from range start");
eq(r1TailOnly.source, "progress.md_window_start", "no-state window tail source marked");

// ---- 4. writeState merge + readState + resolve from state ----
var w1 = R.writeState(tbDir, { currentPage: 150, lastTaughtPage: 150, windowStartPage: 140, windowEndPage: 160, completedTitles: ["A", "B"], conversationId: "c1" });
ok(w1 && w1.schemaVersion === R.SCHEMA_VERSION, "writeState returns state w/ schemaVersion");
eq(w1.lastTaughtPage, 150, "writeState lastTaughtPage");

// merge: omit windowStartPage, add new completed title; old fields must survive
var w2 = R.writeState(tbDir, { lastTaughtPage: 175, completedTitles: ["C"] });
eq(w2.lastTaughtPage, 175, "merge updates lastTaughtPage");
eq(w2.windowStartPage, 140, "merge preserves old windowStartPage (not given)");
eq(w2.completedTitles.length, 3, "completedTitles union A,B,C");
ok(w2.completedTitles.indexOf("A") >= 0 && w2.completedTitles.indexOf("C") >= 0, "union has old+new");

var rs = R.readState(tbDir);
eq(rs.lastTaughtPage, 175, "readState reflects merged state");

// state beats progress.md
var r2 = R.resolveStartPage({ textbookDir: tbDir, progressMdText: "# 当前页码：第 148 页", currentPage: 12 });
eq(r2.startPage, 175, "progress_state beats progress.md + currentPage");
eq(r2.source, "progress_state", "source progress_state");

// stale state must not pull the learner backwards when progress.md is ahead; however
// textbook.currentPage alone must not pull the learner forward because it may be a
// preloaded/visible window rather than taught progress.
var tbDirStale = path.join(tmp, "textbooks", "STALE");
fs.mkdirSync(tbDirStale, { recursive: true });
R.writeState(tbDirStale, { currentPage: 162, lastTaughtPage: 162, windowStartPage: 162, windowEndPage: 191 });
var rStaleMd = R.resolveStartPage({ textbookDir: tbDirStale, progressMdText: "# 当前页码：第 173 页", currentPage: 162 });
eq(rStaleMd.startPage, 173, "progress.md ahead of stale state wins");
eq(rStaleMd.resumeState.lastTaughtPage, 173, "merged resumeState carries progress.md page");
eq(rStaleMd.source, "progress.md+state", "source marks reconciled progress.md state");
var rStaleIndex = R.resolveStartPage({ textbookDir: tbDirStale, progressMdText: "# 当前页码：第 150 页", currentPage: 180 });
eq(rStaleIndex.startPage, 162, "textbook.currentPage ahead of state does not win");
eq(rStaleIndex.source, "progress_state", "source remains progress_state when only currentPage is ahead");

// A page that is exactly the loaded window tail is not reliable teaching
// progress. This is the p.142-171 -> p.171 jump regression.
var tbDirWindowTail = path.join(tmp, "textbooks", "WINDOW_TAIL");
fs.mkdirSync(tbDirWindowTail, { recursive: true });
R.writeState(tbDirWindowTail, {
  currentPage: 171,
  lastTaughtPage: 171,
  loadedCursor: { startPage: 142, endPage: 171, chunkId: "md-0142" },
});
var rWindowTail = R.resolveStartPage({
  textbookDir: tbDirWindowTail,
  progressMdText: "# Current Page: Page 171",
  currentPage: 142,
});
eq(rWindowTail.startPage, 142, "window tail progress resumes from window start");
eq(rWindowTail.source, "progress_state_window_start", "window tail source marked");

// ---- 5. focusFromState: locate phase by page ----
var teachingMap = {
  page_range: [140, 180],
  sequence: [
    { label: "P1", card_ids: ["t1", "t2"], teach_goal: "g1" },
    { label: "P2", card_ids: ["t3", "t4"], teach_goal: "g2" },
    { label: "P3", card_ids: ["t5"], teach_goal: "g3" },
  ],
};
var cardMap = {
  t1: { title: "t1", source_pages: [140, 150] },
  t2: { title: "t2", source_pages: [140, 150] },
  t3: { title: "t3", source_pages: [151, 165] },
  t4: { title: "t4", source_pages: [151, 165] },
  t5: { title: "t5", source_pages: [166, 180] },
};
// lastTaughtPage 160 -> phase index 1 (P2)
var f1 = R.focusFromState(teachingMap, cardMap, { lastTaughtPage: 160 });
eq(f1.phaseIndex, 1, "page 160 -> phase 2 (index 1)");
ok(f1.completedSet[0] === true && f1.completedSet[1] === undefined, "phase 1 completed, phase 2 not");

// explicit title
var f2 = R.focusFromState(teachingMap, cardMap, { title: "t5" });
eq(f2.phaseIndex, 2, "title t5 -> phase index 2");

// explicit phaseIndex
var f3 = R.focusFromState(teachingMap, cardMap, { phaseIndex: 0 });
eq(f3.phaseIndex, 0, "explicit phaseIndex 0");

// unlocatable -> phaseIndex null but keeps page/text
var f4 = R.focusFromState(teachingMap, cardMap, { lastTaughtPage: 999, lastFocus: "some topic" });
eq(f4.phaseIndex, null, "page out of range -> null phaseIndex");
eq(f4.lastFocusText, "some topic", "keeps lastFocus text");

// ---- 6. stateHash differs by progress, stable for same ----
var h1 = R.stateHash({ lastTaughtPage: 160 });
var h2 = R.stateHash({ lastTaughtPage: 175 });
var h1b = R.stateHash({ lastTaughtPage: 160 });
ok(h1 && h1 !== h2, "different progress -> different hash");
eq(h1, h1b, "same progress -> same hash");
eq(R.stateHash(null), "", "null -> empty hash");

// ---- 7. setPending / takePending one-shot ----
R.setPending("conv9", { lastTaughtPage: 200 });
var taken = R.takePending("conv9");
ok(taken && taken.lastTaughtPage === 200, "takePending returns stashed state");
eq(R.takePending("conv9"), null, "takePending is one-shot (second call null)");

// ---- 8. End-to-end render: phase-2 resume must NOT say focus is 阶段 1 ----
// Replicate renderCards focus logic the way server.js uses __RESUME__ (without booting Next.js).
function renderFocusDirective(startPage, endPage, cards, teachingMap, resumeState) {
  var cardMap = {}; cards.forEach(function (c) { if (c.concept_id) cardMap[c.concept_id] = c; if (c.title) cardMap[c.title] = c; });
  var focus = resumeState ? R.focusFromState(teachingMap, cardMap, resumeState) : null;
  var focusIdx = (focus && typeof focus.phaseIndex === "number") ? focus.phaseIndex : 0;
  return "当前焦点是【阶段 " + (focusIdx + 1) + "】";
}
var cardsArr = Object.keys(cardMap).map(function (k) { return cardMap[k]; });
var dirP2 = renderFocusDirective(140, 180, cardsArr, teachingMap, { lastTaughtPage: 160 });
ok(dirP2.indexOf("阶段 2") >= 0, "resume to page 160 directive says 阶段 2");
ok(dirP2.indexOf("阶段 1") < 0, "resume to page 160 directive does NOT say 阶段 1");

var dirNew = renderFocusDirective(140, 180, cardsArr, teachingMap, null);
ok(dirNew.indexOf("阶段 1") >= 0, "no resumeState -> defaults to 阶段 1 (backward compat)");

// ---- 9. writeState must not overwrite old fields with undefined ----
var tbDir2 = path.join(tmp, "textbooks", "TB2");
fs.mkdirSync(tbDir2, { recursive: true });
R.writeState(tbDir2, { currentPage: 50, lastTaughtPage: 50, windowStartPage: 40, conceptId: "c-alpha" });
// patch with explicit undefined fields + omitted fields: old values must survive
R.writeState(tbDir2, { lastTaughtPage: 60, windowStartPage: undefined, conceptId: undefined });
var st2 = R.readState(tbDir2);
eq(st2.lastTaughtPage, 60, "writeState updates given field");
eq(st2.windowStartPage, 40, "undefined does not overwrite windowStartPage");
eq(st2.conceptId, "c-alpha", "undefined does not overwrite conceptId");

// ---- 10. completed* merge dedup ----
R.writeState(tbDir2, { completedTitles: ["X", "Y", "X"], completedConceptIds: ["c1"] });
R.writeState(tbDir2, { completedTitles: ["Y", "Z"], completedConceptIds: ["c1", "c2"] });
var st3 = R.readState(tbDir2);
eq(st3.completedTitles.length, 3, "completedTitles union dedup X,Y,Z");
ok(st3.completedTitles.indexOf("X") >= 0 && st3.completedTitles.indexOf("Z") >= 0, "union keeps old+new titles");
eq(st3.completedConceptIds.length, 2, "completedConceptIds union dedup c1,c2");

// ---- 11. focusFromState: explicit phaseIndex beats page ----
// page 160 alone -> phase 1; but explicit phaseIndex 0 must win
var f5 = R.focusFromState(teachingMap, cardMap, { phaseIndex: 0, lastTaughtPage: 160 });
eq(f5.phaseIndex, 0, "explicit phaseIndex beats page coverage");

// ---- 12. focusFromState: title matches card.title, conceptId matches concept_id ----
var teachingMap2 = {
  sequence: [
    { label: "Q1", card_ids: ["k1"] },
    { label: "Q2", card_ids: ["k2"] },
    { label: "Q3", card_ids: ["k3"] },
  ],
};
var cardMap2 = {
  k1: { title: "Intro", concept_id: "concept-intro", source_pages: [1, 10] },
  k2: { title: "Body", concept_id: "concept-body", source_pages: [11, 20] },
  k3: { title: "End", concept_id: "concept-end", source_pages: [21, 30] },
};
var fTitle = R.focusFromState(teachingMap2, cardMap2, { title: "Body" });
eq(fTitle.phaseIndex, 1, "title 'Body' matches card.title -> phase 1");
var fConcept = R.focusFromState(teachingMap2, cardMap2, { conceptId: "concept-end" });
eq(fConcept.phaseIndex, 2, "conceptId 'concept-end' matches card.concept_id -> phase 2");
var fCardId = R.focusFromState(teachingMap2, cardMap2, { title: "k1" });
eq(fCardId.phaseIndex, 0, "title equal to card_id still matches -> phase 0");

// ---- 13. currentFocus freeform text must NOT exact-match; falls back to page ----
// currentFocus is junk text; lastTaughtPage 15 covers phase 1 (k2: 11-20)
var fFuzzy = R.focusFromState(teachingMap2, cardMap2, { currentFocus: "we were discussing photosynthesis basics", lastTaughtPage: 15 });
eq(fFuzzy.phaseIndex, 1, "currentFocus freeform ignored, page 15 -> phase 1");
ok(fFuzzy.lastFocusText && fFuzzy.lastFocusText.indexOf("photosynthesis") >= 0, "currentFocus still surfaced as lastFocusText");
// currentFocus that happens to equal a title must NOT match (currentFocus is never used for exact match)
var fFuzzy2 = R.focusFromState(teachingMap2, cardMap2, { currentFocus: "Body" });
eq(fFuzzy2.phaseIndex, null, "currentFocus='Body' does NOT exact-match a title (no page -> null)");

// ---- 14. page coverage with completed* skips to first uncompleted phase ----
// Two phases cover the same page range; completedTitles marks the first done -> pick the second.
var teachingMap3 = {
  sequence: [
    { label: "Seg-A", card_ids: ["m1"] },
    { label: "Seg-B", card_ids: ["m2"] },
    { label: "Seg-C", card_ids: ["m3"] },
  ],
};
var cardMap3 = {
  m1: { title: "A", source_pages: [100, 120] },
  m2: { title: "B", source_pages: [100, 120] },
  m3: { title: "C", source_pages: [100, 120] },
};
// no completed -> last covering phase (index 2), preserves legacy fallback
var fNoComp = R.focusFromState(teachingMap3, cardMap3, { lastTaughtPage: 110 });
eq(fNoComp.phaseIndex, 2, "no completed -> last covering phase (legacy fallback)");
// completed A -> first uncompleted covering phase is B (index 1)
var fComp = R.focusFromState(teachingMap3, cardMap3, { lastTaughtPage: 110, completedTitles: ["A"] });
eq(fComp.phaseIndex, 1, "completed A -> skip to first uncompleted covering phase B (index 1)");
ok(fComp.completedSet[0] === true, "phase 0 (A) marked completed");

// ---- 15. end-class fallback must NOT use windowEndPage when progress.md present ----
// Simulate the chat route end-class logic: prefer progress.md, then windowStartPage, last windowEndPage.
function endClassLastTaughtPage(progressMd, windowStartPage, windowEndPage) {
  var pp = R.parseProgressPage(progressMd);
  if (pp && pp > 0) return { page: pp, source: "progress.md" };
  if (windowStartPage != null) return { page: windowStartPage, source: "end-class" };
  return { page: windowEndPage, source: "end-class" }; // last resort: read-window end, not teaching progress
}
var ec1 = endClassLastTaughtPage("# 当前页码：第 145 页", 130, 170);
eq(ec1.page, 145, "end-class prefers progress.md page over window");
eq(ec1.source, "progress.md", "end-class source progress.md");
var ec2 = endClassLastTaughtPage("", 130, 170);
eq(ec2.page, 130, "end-class fallback uses windowStartPage, NOT windowEndPage");
ok(ec2.page !== 170, "end-class does NOT use windowEndPage 170 when windowStartPage available");
var ec3 = endClassLastTaughtPage("", null, 170);
eq(ec3.page, 170, "end-class last resort windowEndPage only when nothing better");

var anchor1 = R.resolveEndClassAnchor({
  progressMdText: "# Current Page: Page 145",
  currentPage: 142,
  windowStartPage: 142,
  windowEndPage: 171,
});
eq(anchor1.page, 145, "end-class anchor prefers recorded progress over window tail");
eq(anchor1.source, "progress.md", "end-class anchor source progress.md");
var anchor2 = R.resolveEndClassAnchor({
  progressMdText: "",
  currentPage: 142,
  windowStartPage: 142,
  windowEndPage: 171,
});
eq(anchor2.page, 142, "end-class anchor uses window start before window end");
eq(anchor2.source, "windowStartPage", "end-class anchor source windowStartPage");
var anchor3 = R.resolveEndClassAnchor({
  progressMdText: "# Current Page: Page 171",
  currentPage: 142,
  windowStartPage: 142,
  windowEndPage: 171,
});
eq(anchor3.page, 142, "end-class anchor ignores progress.md when it is the window tail");
var anchor4 = R.resolveEndClassAnchor({
  state: {
    lastTaughtPage: 171,
    loadedCursor: { startPage: 142, endPage: 171, chunkId: "md-0142" },
  },
  progressMdText: "# Current Page: Page 171",
  currentPage: 142,
  windowStartPage: 142,
  windowEndPage: 171,
});
eq(anchor4.page, 142, "end-class anchor ignores stale state when it is the window tail");
eq(anchor4.source, "progress_state_window_start", "end-class stale state source marked");
var normalizedProgress = R.normalizeProgressMdPage(
  "# Current Page: Page 171\n## 2026-06-25 | A\np.142-171 | CSS\nnotes",
  145,
  142
);
ok(normalizedProgress.indexOf("# Current Page: Page 145") >= 0, "normalizes progress first line");
ok(normalizedProgress.indexOf("p.142-145 | CSS") >= 0, "normalizes first session range");

// ---- 16. runtime cache key differs by resumeState ----
var hk1 = R.stateHash({ lastTaughtPage: 100 });
var hk2 = R.stateHash({ lastTaughtPage: 100, phaseIndex: 2 });
var hk3 = R.stateHash({ lastTaughtPage: 100, completedTitles: ["A", "B"] });
ok(hk1 !== hk2, "phaseIndex changes hash");
ok(hk1 !== hk3, "completed* count changes hash");
ok(hk2 !== hk3, "different resumeState -> different hash");

// cleanup
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}

console.log("progress-resume smoke test: " + pass + " assertions passed");
