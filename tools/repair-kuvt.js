#!/usr/bin/env node
"use strict";

var childProcess = require("child_process");
var crypto = require("crypto");
var fs = require("fs");
var path = require("path");

var ROOT = path.resolve(__dirname, "..");
var RESOURCES = path.join(ROOT, "resources");
var SERVER = path.join(RESOURCES, "server");
var BUILDER = path.join(SERVER, "lib", "kb-builder.mjs");
var Resume = require(path.join(SERVER, "lib", "resume", "progress-resume.js"));
var Progress = require(path.join(SERVER, "lib", "progress", "kb-progress.js"));
var TARGET_ID = "KUvt";
var TARGET_PDF_NAME = "C++20高级编程(第5版)(上下册） ([比]马克·格雷戈勒（Marc Gregoire）) .pdf";
var DEFAULT_PROJECT_ROOT = path.join(process.env.APPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Roaming"), "socratopia", "project-data");

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); } catch (e) { return null; }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  var tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf-8");
  fs.renameSync(tmp, file);
}

function writeTextAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  var tmp = file + ".tmp";
  fs.writeFileSync(tmp, value, "utf-8");
  fs.renameSync(tmp, file);
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sha256(file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function walk(dir, out) {
  out = out || [];
  if (!fs.existsSync(dir)) return out;
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (entry) {
    var full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  });
  return out;
}

function findTarget() {
  var projectRoot = path.resolve(process.env.SOCRATOPIA_PROJECT_ROOT || DEFAULT_PROJECT_ROOT);
  var indexFiles = walk(path.join(projectRoot, "accounts")).filter(function (file) {
    return /[\\/]textbooks[\\/]textbook_index\.json$/i.test(file);
  });
  var matches = [];
  indexFiles.forEach(function (indexFile) {
    var index = readJson(indexFile);
    var books = index && index.textbooks;
    if (!Array.isArray(books)) return;
    books.forEach(function (book) {
      if (book && String(book.id) === TARGET_ID && String(book.fileName || "") === TARGET_PDF_NAME) {
        matches.push({
          projectRoot: projectRoot,
          indexFile: indexFile,
          index: index,
          entry: book,
          textbookDir: path.join(path.dirname(indexFile), TARGET_ID),
          worldDir: path.dirname(path.dirname(indexFile)),
        });
      }
    });
  });
  if (matches.length !== 1) throw new Error("expected exactly one KUvt textbook, found " + matches.length);
  var target = matches[0];
  var requested = process.env.KUVT_PDF || "E:\\资料\\" + TARGET_PDF_NAME;
  target.sourcePdf = fs.existsSync(requested) ? requested : path.join(target.textbookDir, TARGET_PDF_NAME);
  if (!fs.existsSync(target.sourcePdf)) throw new Error("source PDF not found: " + target.sourcePdf);
  return target;
}

function provider(settings, setBlock) {
  setBlock = setBlock || {};
  var group = String(setBlock.group || setBlock.provider || "gpt").toLowerCase();
  if (group === "openai") group = "gpt";
  var block = settings[group] || settings.gpt || {};
  var keys = settings.apiKeys || {};
  return {
    baseUrl: setBlock.baseUrl || block.baseUrl || settings.endpoint || "",
    apiKey: setBlock.apiKey || block.apiKey || keys[setBlock.apiKeyGroup] || keys[block.apiKeyGroup] || keys.codex || "",
    model: setBlock.model || (block.models && (block.models[group] || block.models.gpt || block.models.openai)) || "",
    maxInputChars: setBlock.maxInputChars || 7000,
  };
}

function modelConfig() {
  var settings = readJson(path.join(RESOURCES, "settings.json")) || {};
  var set = readJson(path.join(RESOURCES, "set.json")) || {};
  var card = provider(settings, set.kb || set.strong);
  var premium = set.premium ? provider(settings, set.premium) : null;
  var vision = set.vision ? provider(settings, set.vision) : null;
  if (!card.baseUrl || !card.apiKey || !card.model) throw new Error("KB model configuration is incomplete");
  return { card: card, premium: premium, vision: vision };
}

function backup(target) {
  var backupDir = path.join(target.textbookDir, "repair_backups", stamp());
  fs.mkdirSync(backupDir, { recursive: true });
  var kb = path.join(target.textbookDir, "knowledge_base");
  if (fs.existsSync(kb)) fs.cpSync(kb, path.join(backupDir, "knowledge_base"), { recursive: true, errorOnExist: true });
  ["progress.md", "progress_state.json"].forEach(function (name) {
    var src = path.join(target.textbookDir, name);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(backupDir, name));
  });
  fs.copyFileSync(target.indexFile, path.join(backupDir, "textbook_index.json"));
  writeJsonAtomic(path.join(backupDir, "textbook_index_entry.json"), target.entry);
  var manifest = {
    createdAt: new Date().toISOString(),
    textbookId: TARGET_ID,
    sourcePdf: target.sourcePdf,
    sourcePdfSha256: sha256(target.sourcePdf),
    progressMdSha256: sha256(path.join(target.textbookDir, "progress.md")),
    progressStateSha256: sha256(path.join(target.textbookDir, "progress_state.json")),
    knowledgeBaseFileCount: walk(kb).length,
  };
  writeJsonAtomic(path.join(backupDir, "manifest.json"), manifest);
  console.log("[repair-kuvt] backup=" + backupDir);
  return backupDir;
}

function rebuild(target, backupDir, resume) {
  var config = modelConfig();
  var concurrency = Math.max(1, Math.min(4, parseInt(process.env.KB_REPAIR_CONCURRENCY || "2", 10) || 2));
  var logFile = path.join(backupDir, "rebuild.log");
  var log = fs.createWriteStream(logFile, { flags: "a" });
  var env = Object.assign({}, process.env, {
    KB_TEXTBOOK_DIR: target.textbookDir,
    KB_SRC_PATH: target.sourcePdf,
    KB_FORMAT: "pdf",
    KB_TITLE: target.entry.title || TARGET_PDF_NAME,
    KB_LANG: "chinese",
    KB_START_PAGE: "1",
    KB_END_PAGE: String(target.entry.numPages || 1012),
    KB_PAGES_PER_CHUNK: "4",
    KB_MAX_CHUNKS: "0",
    KB_CONCURRENCY: String(concurrency),
    KB_CHUNK_RETRIES: "2",
    KB_RESUME: resume ? "1" : "0",
    KB_CARD_BASEURL: config.card.baseUrl,
    KB_CARD_APIKEY: config.card.apiKey,
    KB_CARD_MODEL: config.card.model,
    KB_CARD_MAXINPUT: String(config.card.maxInputChars || 7000),
  });
  if (config.premium && config.premium.baseUrl && config.premium.apiKey && config.premium.model) {
    env.KB_PREMIUM_BASEURL = config.premium.baseUrl;
    env.KB_PREMIUM_APIKEY = config.premium.apiKey;
    env.KB_PREMIUM_MODEL = config.premium.model;
  }
  if (config.vision && config.vision.baseUrl && config.vision.apiKey && config.vision.model) {
    env.KB_VISION_BASEURL = config.vision.baseUrl;
    env.KB_VISION_APIKEY = config.vision.apiKey;
    env.KB_VISION_MODEL = config.vision.model;
  }
  console.log("[repair-kuvt] " + (resume ? "resuming" : "rebuilding") + " 1-" + env.KB_END_PAGE + " with cardModel=" + config.card.model +
    " premium=" + (config.premium && config.premium.model || "none") + " concurrency=" + concurrency);
  return new Promise(function (resolve, reject) {
    var child = childProcess.spawn(process.execPath, [BUILDER], { cwd: SERVER, env: env, windowsHide: true });
    child.stdout.on("data", function (chunk) { process.stdout.write(chunk); log.write(chunk); });
    child.stderr.on("data", function (chunk) { process.stderr.write(chunk); log.write(chunk); });
    child.on("error", reject);
    child.on("close", function (code) { log.end(); resolve(code); });
  });
}

function latestConversationId(target) {
  var chats = path.join(target.worldDir, "chats");
  if (!fs.existsSync(chats)) return "";
  return fs.readdirSync(chats).filter(function (name) { return /\.json$/i.test(name); }).map(function (name) {
    var file = path.join(chats, name);
    return { file: file, value: readJson(file), mtime: fs.statSync(file).mtimeMs };
  }).filter(function (item) { return item.value && String(item.value.textbookId || "") === TARGET_ID; })
    .sort(function (a, b) { return b.mtime - a.mtime; })
    .map(function (item) { return String(item.value.id || path.basename(item.file, ".json")); })[0] || "";
}

function flattenTeachingMap(teachingMap) {
  var ids = [];
  (teachingMap && teachingMap.segments || []).forEach(function (segment) {
    (segment && segment.sequence || []).forEach(function (phase) {
      (phase && phase.card_ids || []).forEach(function (id) { ids.push(String(id || "")); });
    });
  });
  return ids;
}

function repairTeachingMapOrder(target) {
  var kbDir = path.join(target.textbookDir, "knowledge_base");
  var statusPath = path.join(kbDir, "build_status.json");
  var mapPath = path.join(kbDir, "teaching_map.json");
  var status = readJson(statusPath);
  var index = readJson(path.join(kbDir, "index.json"));
  var teachingMap = readJson(mapPath);
  if (!status || status.state !== "done" || status.activationEligible !== true) {
    throw new Error("refusing to repair teaching map before a healthy KB is active");
  }
  var expected = index && Array.isArray(index.cards)
    ? index.cards.map(function (card) { return String(card && card.concept_id || ""); }).filter(Boolean)
    : [];
  var actual = flattenTeachingMap(teachingMap);
  if (!expected.length || expected.length !== actual.length || new Set(expected).size !== expected.length ||
      expected.some(function (id) { return actual.indexOf(id) < 0; })) {
    throw new Error("teaching map and index do not contain the same unique card set");
  }

  var phaseByCard = {};
  var phaseSerial = 0;
  (teachingMap.segments || []).forEach(function (segment) {
    (segment.sequence || []).forEach(function (phase) {
      var meta = {
        key: "phase-" + (++phaseSerial),
        label: String(phase.label || ""),
        teach_goal: String(phase.teach_goal || ""),
        branches: Array.isArray(phase.branches) ? phase.branches.slice() : [],
      };
      (phase.card_ids || []).forEach(function (id) { phaseByCard[String(id)] = meta; });
    });
  });

  var cursor = 0;
  var repairedSegments = (teachingMap.segments || []).map(function (segment) {
    var segmentSize = (segment.sequence || []).reduce(function (sum, phase) {
      return sum + (Array.isArray(phase.card_ids) ? phase.card_ids.length : 0);
    }, 0);
    var segmentIds = expected.slice(cursor, cursor + segmentSize);
    cursor += segmentSize;
    var phases = [];
    segmentIds.forEach(function (id) {
      var meta = phaseByCard[id] || { key: "unmapped", label: "", teach_goal: "", branches: [] };
      var phase = phases[phases.length - 1];
      if (!phase || phase._key !== meta.key) {
        phase = {
          _key: meta.key,
          phase: phases.length + 1,
          label: meta.label || "按教材顺序教学",
          card_ids: [],
          teach_goal: meta.teach_goal || "按教材页序讲清本阶段知识点。",
          branches: meta.branches,
        };
        phases.push(phase);
      }
      phase.card_ids.push(id);
    });
    phases.forEach(function (phase) { delete phase._key; });
    return Object.assign({}, segment, {
      sequence: phases,
      generated_by: segment.generated_by === "llm-validated" ? "llm-order-repaired" : segment.generated_by,
    });
  });
  var now = new Date().toISOString();
  var repaired = Object.assign({}, teachingMap, {
    version: 3,
    ordering: "chunk-ordinal-then-source-page",
    order_repaired_at: now,
    segments: repairedSegments,
  });
  if (flattenTeachingMap(repaired).some(function (id, index) { return id !== expected[index]; })) {
    throw new Error("teaching map order repair verification failed");
  }
  writeJsonAtomic(mapPath, repaired);
  writeJsonAtomic(statusPath, Object.assign({}, status, {
    teachingMapOrderRepairedAt: now,
    updatedAt: now,
  }));
  console.log("[repair-kuvt] teaching map order repaired cards=" + expected.length);
  return repaired;
}

function migrate(target) {
  var status = readJson(path.join(target.textbookDir, "knowledge_base", "build_status.json"));
  if (!status || status.state !== "done" || status.activationEligible !== true) {
    throw new Error("refusing to migrate progress before a healthy KB is active");
  }
  var active = Progress.findConcept(target.textbookDir, [
    /import\s+MyModule/i,
    /模块导入|导入模块|module\s+import/i,
  ], 61, 64);
  if (!active) throw new Error("rebuilt KB has no card overlapping pages 61-64");
  var currentPage = Number(active.sourcePages && active.sourcePages[0]) || 61;
  var conversationId = latestConversationId(target);
  var progress = "# 当前页码：第 " + currentPage + " 页\n\n---\n\n" +
    "## 2026-07-17 | 青衣\n" +
    "p.61-64 | C++ 初始化列表与模块基础\n" +
    "学习者继续学习花括号初始化、窄化转换与 std::initializer_list，能够判断常见初始化是否合法，并理解初始化列表对象及 size()。模块内容刚开始，import MyModule 的作用尚未完成检查；下次从模块导入继续。\n";
  writeTextAtomic(path.join(target.textbookDir, "progress.md"), progress);
  var state = Resume.replaceState(target.textbookDir, {
    textbookId: TARGET_ID,
    sourceConversationId: conversationId,
    lessonStartPage: 61,
    activeConceptId: active.conceptId,
    completedConceptIds: [],
    completedTitles: [],
    lastTaughtPage: currentPage,
    currentPage: currentPage,
    loadedCursor: {
      chunkId: "repair-0061",
      ordinal: 61,
      startPage: 61,
      endPage: 64,
      updatedAt: new Date().toISOString(),
    },
    taughtCursor: {
      chunkId: "concept-" + active.conceptId,
      ordinal: active.queueIndex,
      startPage: currentPage,
      endPage: currentPage,
      status: "active",
      ready: true,
      committedAt: new Date().toISOString(),
      reason: "kuvt_repair_migration",
    },
  });
  if (!state) throw new Error("failed to replace progress_state.json");
  var index = readJson(target.indexFile);
  var found = false;
  index.textbooks.forEach(function (book) {
    if (String(book.id) === TARGET_ID) { book.currentPage = currentPage; found = true; }
  });
  if (!found) throw new Error("KUvt disappeared from textbook_index.json");
  index.updatedAt = new Date().toISOString();
  writeJsonAtomic(target.indexFile, index);
  console.log("[repair-kuvt] migrated activeConceptId=" + active.conceptId + " page=" + currentPage +
    " conversation=" + (conversationId || "none"));
  return { active: active, currentPage: currentPage };
}

function rebindLatestConversation(target) {
  var state = Resume.readState(target.textbookDir);
  var conversationId = latestConversationId(target);
  var meta = conversationId ? readJson(path.join(target.worldDir, "chats", conversationId + ".json")) : null;
  if (!state || state.schemaVersion !== 3) throw new Error("cannot rebind without schema v3 progress state");
  if (!conversationId || !meta || String(meta.textbookId || "") !== TARGET_ID) {
    throw new Error("latest conversation is not bound to KUvt");
  }
  var rebound = Resume.writeState(target.textbookDir, { sourceConversationId: conversationId });
  if (!rebound || String(rebound.sourceConversationId || "") !== conversationId) {
    throw new Error("failed to rebind progress state conversation");
  }
  console.log("[repair-kuvt] rebound sourceConversationId=" + conversationId +
    " activeConceptId=" + (rebound.activeConceptId || "") + " currentPage=" + (rebound.currentPage || ""));
  return rebound;
}

function verify(target, migrated) {
  var status = readJson(path.join(target.textbookDir, "knowledge_base", "build_status.json"));
  var state = Resume.readState(target.textbookDir);
  var progress = fs.readFileSync(path.join(target.textbookDir, "progress.md"), "utf-8");
  var index = readJson(target.indexFile);
  var book = index.textbooks.find(function (item) { return String(item.id) === TARGET_ID; });
  var kbIndex = readJson(path.join(target.textbookDir, "knowledge_base", "index.json"));
  var teachingMap = readJson(path.join(target.textbookDir, "knowledge_base", "teaching_map.json"));
  var expectedOrder = kbIndex && Array.isArray(kbIndex.cards) ? kbIndex.cards.map(function (card) { return String(card.concept_id || ""); }) : [];
  var actualOrder = flattenTeachingMap(teachingMap);
  var cards = Progress.loadQueue(target.textbookDir).queue.filter(function (entry) {
    var pages = entry.sourcePages;
    return pages.length >= 2 && pages[0] <= 68 && pages[pages.length - 1] >= 32;
  });
  if (!status || status.state !== "done" || status.activationEligible !== true) throw new Error("KB health verification failed");
  if (!state || state.schemaVersion !== 3 || state.activeConceptId !== migrated.active.conceptId) throw new Error("progress-state verification failed");
  if (!book || Number(book.currentPage) !== migrated.currentPage) throw new Error("textbook-index verification failed");
  if (expectedOrder.length !== actualOrder.length || actualOrder.some(function (id, i) { return id !== expectedOrder[i]; })) {
    throw new Error("teaching-map order verification failed");
  }
  if (/文件系统|事务恢复|访问矩阵|界面流程测试/.test(progress) || /p\.61-20/.test(progress)) throw new Error("contaminated progress text survived migration");
  if (!/p\.61-64/.test(progress)) throw new Error("corrected p.61-64 range missing");
  console.log("[repair-kuvt] verify PASS cards32-68=" + cards.length + " cardCount=" + status.cardCount +
    " coverage=" + status.coverageRatio + " currentPage=" + book.currentPage);
}

async function main() {
  var command = process.argv[2] || "run";
  var target = findTarget();
  console.log("[repair-kuvt] target=" + target.textbookDir);
  if (command === "backup") { backup(target); return; }
  if (command === "repair-map") { backup(target); repairTeachingMapOrder(target); return; }
  if (command === "migrate") { var migratedOnly = migrate(target); verify(target, migratedOnly); return; }
  if (command === "rebind") { rebindLatestConversation(target); return; }
  if (command !== "run" && command !== "resume") throw new Error("unknown command: " + command);
  var backupDir;
  if (command === "resume") {
    var backupRoot = path.join(target.textbookDir, "repair_backups");
    var backups = fs.existsSync(backupRoot) ? fs.readdirSync(backupRoot).sort().reverse() : [];
    backupDir = backups.length ? path.join(backupRoot, backups[0]) : backup(target);
  } else {
    backupDir = backup(target);
  }
  var code = await rebuild(target, backupDir, command === "resume");
  var activeStatus = readJson(path.join(target.textbookDir, "knowledge_base", "build_status.json"));
  if (code !== 0 || !activeStatus || activeStatus.state !== "done" || activeStatus.activationEligible !== true) {
    var stagedStatus = readJson(path.join(target.textbookDir, "knowledge_base.__building__", "build_status.json"));
    console.error("[repair-kuvt] rebuild did not activate; old KB preserved. exit=" + code + " stagedState=" + (stagedStatus && stagedStatus.state || "missing"));
    process.exitCode = code || 2;
    return;
  }
  var migrated = migrate(target);
  verify(target, migrated);
}

if (require.main === module) {
  main().catch(function (error) {
    console.error("[repair-kuvt] FATAL: " + (error && error.stack || error));
    process.exit(1);
  });
}

module.exports = {
  findTarget: findTarget,
  backup: backup,
  flattenTeachingMap: flattenTeachingMap,
  repairTeachingMapOrder: repairTeachingMapOrder,
  migrate: migrate,
  verify: verify,
};
