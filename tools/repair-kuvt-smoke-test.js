"use strict";

var assert = require("assert");
var childProcess = require("child_process");
var fs = require("fs");
var os = require("os");
var path = require("path");

var root = fs.mkdtempSync(path.join(os.tmpdir(), "repair-kuvt-smoke-"));
var world = path.join(root, "accounts", "local", "profiles", "p", "worlds", "KU");
var textbooks = path.join(world, "textbooks");
var textbook = path.join(textbooks, "KUvt");
var kb = path.join(textbook, "knowledge_base");
var cardsDir = path.join(kb, "cards");
fs.mkdirSync(cardsDir, { recursive: true });
fs.mkdirSync(path.join(world, "chats"), { recursive: true });

var pdfName = "C++20高级编程(第5版)(上下册） ([比]马克·格雷戈勒（Marc Gregoire）) .pdf";
fs.writeFileSync(path.join(textbook, pdfName), "fake-pdf");
fs.writeFileSync(path.join(textbooks, "textbook_index.json"), JSON.stringify({
  worldId: "KU",
  textbooks: [{ id: "KUvt", fileName: pdfName, title: "C++20", numPages: 1012, currentPage: 20 }]
}, null, 2));
var cards = [
  { concept_id: "c-init", title: "初始化列表", source_pages: [61, 62], definition: "initializer_list" },
  { concept_id: "c-module", title: "模块导入", source_pages: [63, 64], definition: "import MyModule 导入模块" },
];
cards.forEach(function (card) { fs.writeFileSync(path.join(cardsDir, card.concept_id + ".json"), JSON.stringify(card)); });
fs.writeFileSync(path.join(kb, "index.json"), JSON.stringify({ cards: cards }));
fs.writeFileSync(path.join(kb, "teaching_map.json"), JSON.stringify({ version: 3, segments: [{ sequence: [
  { label: "Modules", card_ids: ["c-module"] },
  { label: "Initialization", card_ids: ["c-init"] },
] }] }));
fs.writeFileSync(path.join(kb, "build_status.json"), JSON.stringify({ state: "done", activationEligible: true, cardCount: 2, coverageRatio: 1 }));
fs.writeFileSync(path.join(textbook, "progress.md"), "# 当前页码：第 20 页\n\n## 2026-07-12 | X\np.536-566 | 文件系统与事务恢复\n污染");
fs.writeFileSync(path.join(textbook, "progress_state.json"), JSON.stringify({ schemaVersion: 2, currentPage: 20, completedConceptIds: ["bad"] }));
fs.writeFileSync(path.join(world, "chats", "latest.json"), JSON.stringify({ id: "latest", textbookId: "KUvt" }));

var script = path.join(__dirname, "repair-kuvt.js");
function run(command) {
  return childProcess.spawnSync(process.execPath, [script, command], {
    env: Object.assign({}, process.env, { SOCRATOPIA_PROJECT_ROOT: root, KUVT_PDF: path.join(textbook, pdfName) }),
    encoding: "utf8",
    windowsHide: true,
  });
}

var backup = run("backup");
assert.strictEqual(backup.status, 0, backup.stderr);
var backups = fs.readdirSync(path.join(textbook, "repair_backups"));
assert.strictEqual(backups.length, 1, "one timestamped backup created");
assert.ok(fs.existsSync(path.join(textbook, "repair_backups", backups[0], "knowledge_base", "index.json")), "KB is backed up");
assert.ok(fs.existsSync(path.join(textbook, "repair_backups", backups[0], "textbook_index_entry.json")), "index entry is backed up");

var mapRepair = run("repair-map");
assert.strictEqual(mapRepair.status, 0, mapRepair.stderr + mapRepair.stdout);
var repairedMap = JSON.parse(fs.readFileSync(path.join(kb, "teaching_map.json"), "utf8"));
assert.deepStrictEqual(repairedMap.segments.flatMap(function (segment) {
  return segment.sequence.flatMap(function (phase) { return phase.card_ids; });
}), ["c-init", "c-module"], "teaching map is rewritten to exact index order");

var migrate = run("migrate");
assert.strictEqual(migrate.status, 0, migrate.stderr + migrate.stdout);
var progress = fs.readFileSync(path.join(textbook, "progress.md"), "utf8");
assert.ok(progress.includes("p.61-64"), "corrected lesson range written");
assert.ok(!progress.includes("文件系统"), "cross-textbook progress removed");
var state = JSON.parse(fs.readFileSync(path.join(textbook, "progress_state.json"), "utf8"));
assert.strictEqual(state.schemaVersion, 3, "state migrated to schema v3");
assert.strictEqual(state.activeConceptId, "c-module", "unfinished module card selected");
assert.deepStrictEqual(state.completedConceptIds, [], "unproven completions cleared");
assert.strictEqual(state.sourceConversationId, "latest", "latest bound conversation retained");
var index = JSON.parse(fs.readFileSync(path.join(textbooks, "textbook_index.json"), "utf8"));
assert.strictEqual(index.textbooks[0].currentPage, 63, "textbook page synchronized to active card");

fs.rmSync(root, { recursive: true, force: true });
console.log("repair KUvt smoke: PASS");
