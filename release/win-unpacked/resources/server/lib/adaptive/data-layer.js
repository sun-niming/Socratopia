/**
 * Adaptive Teaching Data Layer
 *
 * Structured Learner Model, Concept Graph, Teaching Session, and Assessment
 * storage for the self-contained adaptive teaching mode.
 *
 * Loaded by server.js into global.__ADAPTIVE__. All data lives under
 * <PROJECT_ROOT>/adaptive-teaching/ — physically isolated from
 * conversations, profile, world, and textbook data.
 *
 * Schema contracts follow ADAPTIVE_TEACHING_MODE_TECHNICAL_REPORT.md §3.
 */

(function () {
  var fs = require("fs");
  var path = require("path");
  var crypto = require("crypto");

  function dataRoot() {
    return path.join(process.env.PROJECT_ROOT || "", "adaptive-teaching");
  }

  function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  function genId(prefix) {
    return (prefix || "ev") + "_" + Date.now().toString(36) + "_" + crypto.randomBytes(3).toString("hex");
  }

  function safeSegment(value, name) {
    if (value === null || value === undefined || typeof value !== "string" || value.trim() === "")
      throw new Error(name + " must be a non-empty string");
    if (value.length > 128) throw new Error(name + " exceeds max length (128)");
    if (value.indexOf("/") >= 0) throw new Error(name + " must not contain '/'");
    if (value.indexOf("\\") >= 0) throw new Error(name + " must not contain '\\'");
    if (value.indexOf("..") >= 0)
      throw new Error(name + " must not contain '..'");
    if (/[\x00-\x1f\x7f]/.test(value))
      throw new Error(name + " must not contain control characters");
    return value;
  }

  function readJSON(filePath) {
    if (!fs.existsSync(filePath)) return null;
    try { return JSON.parse(fs.readFileSync(filePath, "utf-8")); } catch (e) {
      var corruptPath = filePath + ".corrupt-" + Date.now().toString(36);
      try { fs.renameSync(filePath, corruptPath); } catch (e2) {}
      return null;
    }
  }

  function writeJSON(filePath, obj) {
    ensureDir(path.dirname(filePath));
    var tmp = filePath + ".tmp-" + process.pid + "-" + Math.random().toString(36).slice(2, 8);
    try {
      fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf-8");
      fs.renameSync(tmp, filePath);
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch (_) {}
      throw e;
    }
  }

  // ========== Learner Model ==========

  function learnerModelPath(profileId, worldId) {
    return path.join(dataRoot(), "learner-models", safeSegment(profileId, "profileId") + "_" + safeSegment(worldId, "worldId") + ".json");
  }

  function defaultLearnerModel(profileId, worldId) {
    return {
      profileId: profileId,
      worldId: worldId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      conceptMastery: {},
      errorPatterns: [],
      teachingPreferences: {
        prefersExamples: true,
        prefersSocraticQuestions: false,
        needsStepByStep: true,
        preferredExplanationStyle: "balanced"
      },
      affectiveState: { confidence: 0.5, frustration: 0.0, engagement: 0.5 },
      reviewQueue: [],
      snapshotHistory: []
    };
  }

  function loadLearnerModel(profileId, worldId) {
    if (!profileId || !worldId) throw new Error("loadLearnerModel requires profileId and worldId");
    var fp = learnerModelPath(profileId, worldId);
    var m = readJSON(fp);
    if (!m) {
      m = defaultLearnerModel(profileId, worldId);
      writeJSON(fp, m);
    }
    if (!m.snapshotHistory) m.snapshotHistory = [];
    if (!m.reviewQueue) m.reviewQueue = [];
    return m;
  }

  function saveLearnerModel(profileId, worldId, model) {
    if (!profileId || !worldId) throw new Error("saveLearnerModel requires profileId and worldId");
    if (!model) throw new Error("model is required");
    model.profileId = profileId;
    model.worldId = worldId;
    model.updatedAt = new Date().toISOString();
    // Keep last 3 snapshots for rollback
    if (!model.snapshotHistory) model.snapshotHistory = [];
    var snap = {
      timestamp: model.updatedAt,
      conceptMastery: JSON.parse(JSON.stringify(model.conceptMastery || {})),
      errorPatterns: JSON.parse(JSON.stringify(model.errorPatterns || [])),
      reviewQueue: JSON.parse(JSON.stringify(model.reviewQueue || []))
    };
    model.snapshotHistory.push(snap);
    if (model.snapshotHistory.length > 3) model.snapshotHistory = model.snapshotHistory.slice(-3);
    writeJSON(learnerModelPath(profileId, worldId), model);
  }

  // ========== Concept Graph ==========

  function conceptGraphPath(profileId, worldId, textbookId) {
    return path.join(dataRoot(), "concept-graphs", safeSegment(profileId, "profileId") + "_" + safeSegment(worldId, "worldId") + "_" + safeSegment(textbookId, "textbookId") + ".json");
  }

  function defaultConceptGraph(profileId, worldId, textbookId) {
    return {
      profileId: profileId,
      worldId: worldId,
      textbookId: textbookId,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      concepts: []
    };
  }

  function loadConceptGraph(profileId, worldId, textbookId) {
    if (!profileId || !worldId || !textbookId) throw new Error("loadConceptGraph requires profileId, worldId, textbookId");
    var fp = conceptGraphPath(profileId, worldId, textbookId);
    var g = readJSON(fp);
    if (!g) {
      g = defaultConceptGraph(profileId, worldId, textbookId);
      writeJSON(fp, g);
    }
    if (!Array.isArray(g.concepts)) g.concepts = [];
    return g;
  }

  // Read-only query — returns null on miss (no auto-create). Used by GET endpoints.
  function getConceptGraph(profileId, worldId, textbookId) {
    if (!profileId || !worldId || !textbookId) return null;
    var fp = conceptGraphPath(profileId, worldId, textbookId);
    var g = readJSON(fp);
    if (!g || !Array.isArray(g.concepts)) return null;
    return g;
  }

  function saveConceptGraph(profileId, worldId, textbookId, graph) {
    if (!profileId || !worldId || !textbookId) throw new Error("saveConceptGraph requires profileId, worldId, textbookId");
    if (!graph) throw new Error("graph is required");
    graph.profileId = profileId;
    graph.worldId = worldId;
    graph.textbookId = textbookId;
    graph.updatedAt = new Date().toISOString();
    if (!graph.version) graph.version = 1; else graph.version++;
    if (!Array.isArray(graph.concepts)) graph.concepts = [];
    writeJSON(conceptGraphPath(profileId, worldId, textbookId), graph);
  }

  // ========== Teaching Session ==========

  function sessionPath(sessionId) {
    return path.join(dataRoot(), "sessions", safeSegment(sessionId, "sessionId") + ".json");
  }

  function defaultTeachingSession(sessionId, profileId, worldId, textbookId) {
    return {
      sessionId: sessionId,
      profileId: profileId,
      worldId: worldId,
      textbookId: textbookId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      currentObjective: null,
      activeConceptIds: [],
      phase: "idle",
      lastDiagnosis: null,
      lastStrategy: null,
      pendingQuestion: null,
      turnCount: 0,
      recentTurns: []
    };
  }

  function getTeachingSession(sessionId) {
    if (!sessionId) throw new Error("getTeachingSession requires sessionId");
    var fp = sessionPath(sessionId);
    var s = readJSON(fp);
    if (!s) return null;
    if (!Array.isArray(s.recentTurns)) s.recentTurns = [];
    return s;
  }

  function initTeachingSession(sessionId, profileId, worldId, textbookId) {
    if (!sessionId || !profileId || !worldId || !textbookId) throw new Error("initTeachingSession requires sessionId, profileId, worldId, textbookId");
    var s = defaultTeachingSession(sessionId, profileId, worldId, textbookId);
    writeJSON(sessionPath(sessionId), s);
    return s;
  }

  function updateTeachingSession(sessionId, updates) {
    if (!sessionId) throw new Error("updateTeachingSession requires sessionId");
    var s = getTeachingSession(sessionId);
    if (!s) throw new Error("TeachingSession not found: " + sessionId + ". Call initTeachingSession first.");
    if (!updates) return s;
    var skip = ["sessionId", "profileId", "worldId", "textbookId", "createdAt"];
    for (var k in updates) {
      if (!updates.hasOwnProperty(k)) continue;
      if (skip.indexOf(k) >= 0) continue;
      s[k] = updates[k];
    }
    s.updatedAt = new Date().toISOString();
    writeJSON(sessionPath(sessionId), s);
    return s;
  }

  // ========== Teaching Events (append-only JSONL) ==========

  function eventsPath(sessionId) {
    return path.join(dataRoot(), "events", safeSegment(sessionId, "sessionId") + ".jsonl");
  }

  function appendTeachingEvent(sessionId, event) {
    if (!sessionId) throw new Error("appendTeachingEvent requires sessionId");
    if (!event) throw new Error("event is required");
    if (!event.turnId) event.turnId = genId("turn");
    if (!event.timestamp) event.timestamp = new Date().toISOString();
    var fp = eventsPath(sessionId);
    ensureDir(path.dirname(fp));
    fs.appendFileSync(fp, JSON.stringify(event) + "\n", "utf-8");
    return event.turnId;
  }

  function getTeachingEvents(sessionId, limit) {
    if (!sessionId) throw new Error("getTeachingEvents requires sessionId");
    var fp = eventsPath(sessionId);
    if (!fs.existsSync(fp)) return [];
    var raw = fs.readFileSync(fp, "utf-8").trim();
    if (!raw) return [];
    var lines = raw.split("\n");
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      try { out.push(JSON.parse(lines[i])); } catch (e) { /* skip corrupt lines */ }
    }
    if (limit && limit > 0 && out.length > limit) out = out.slice(-limit);
    return out;
  }

  // ========== Assessment Result (writes into events) ==========

  function recordAssessment(sessionId, assessmentResult) {
    if (!sessionId) throw new Error("recordAssessment requires sessionId");
    if (!assessmentResult) throw new Error("assessmentResult is required");
    if (!assessmentResult.question || !assessmentResult.studentAnswer) throw new Error("assessmentResult needs question and studentAnswer");
    var event = {
      turnId: genId("asmt"),
      timestamp: new Date().toISOString(),
      type: "assessment",
      question: assessmentResult.question,
      studentAnswer: assessmentResult.studentAnswer,
      verdict: assessmentResult.verdict || "unscored",
      errorType: assessmentResult.errorType || null,
      masteryDelta: assessmentResult.masteryDelta || null,
      evidence: assessmentResult.evidence || null,
      conceptIds: assessmentResult.conceptIds || []
    };
    return appendTeachingEvent(sessionId, event);
  }

  // ========== Review Queue helpers ==========

  var REVIEW_MASTERY_THRESHOLD = 0.7;
  var REVIEW_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

  function reviewAgeMs(concept, nowDate) {
    if (!concept || !concept.lastReviewed) return NaN;
    return nowDate - new Date(concept.lastReviewed);
  }

  function wasRecentlyMastered(concept, nowDate) {
    var ageMs = reviewAgeMs(concept, nowDate);
    return concept.score >= REVIEW_MASTERY_THRESHOLD && isFinite(ageMs) && ageMs <= REVIEW_INTERVAL_MS;
  }

  function needsReview(concept, nowDate) {
    if (concept.score < REVIEW_MASTERY_THRESHOLD || !concept.lastReviewed) return true;
    var ageMs = reviewAgeMs(concept, nowDate);
    return isFinite(ageMs) && ageMs > REVIEW_INTERVAL_MS;
  }

  function updateReviewQueue(model) {
    if (!model || !model.conceptMastery) return model;
    if (!model.reviewQueue) model.reviewQueue = [];
    var now = new Date().toISOString();
    var concepts = model.conceptMastery;
    var nowDate = new Date();
    // Remove mastered concepts that were recently reviewed
    model.reviewQueue = model.reviewQueue.filter(function (r) {
      var c = concepts[r.conceptId];
      if (!c || typeof c.score !== "number") return false;
      return !wasRecentlyMastered(c, nowDate);
    });
    // Add or update concepts that need review
    for (var cid in concepts) {
      if (!concepts.hasOwnProperty(cid)) continue;
      var c = concepts[cid];
      if (typeof c.score !== "number") continue;
      if (needsReview(c, nowDate)) {
        var found = -1;
        for (var i = 0; i < model.reviewQueue.length; i++) {
          if (model.reviewQueue[i].conceptId === cid) { found = i; break; }
        }
        var priority = Math.round((1 - c.score) * 10) / 10;
        if (found >= 0) {
          model.reviewQueue[found].score = c.score;
          model.reviewQueue[found].priority = priority;
        } else {
          model.reviewQueue.push({
            conceptId: cid,
            score: c.score,
            addedAt: now,
            priority: priority
          });
        }
      }
    }
    // Sort by priority descending
    model.reviewQueue.sort(function (a, b) { return b.priority - a.priority; });
    return model;
  }

  // ========== Export ==========

  var api = {
    DATA_ROOT: dataRoot,
    // Learner Model
    loadLearnerModel: loadLearnerModel,
    saveLearnerModel: saveLearnerModel,
    learnerModelPath: learnerModelPath,
    // Concept Graph
    loadConceptGraph: loadConceptGraph,
    getConceptGraph: getConceptGraph,
    saveConceptGraph: saveConceptGraph,
    conceptGraphPath: conceptGraphPath,
    // Teaching Session
    getTeachingSession: getTeachingSession,
    initTeachingSession: initTeachingSession,
    updateTeachingSession: updateTeachingSession,
    // Teaching Events
    appendTeachingEvent: appendTeachingEvent,
    getTeachingEvents: getTeachingEvents,
    // Assessment
    recordAssessment: recordAssessment,
    // Review
    updateReviewQueue: updateReviewQueue,
    // Utilities
    genId: genId,
    defaultLearnerModel: defaultLearnerModel,
    defaultConceptGraph: defaultConceptGraph,
    defaultTeachingSession: defaultTeachingSession
  };

  global.__ADAPTIVE__ = api;
  module.exports = api;
})();
