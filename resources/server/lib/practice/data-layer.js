/**
 * Practice Data Layer
 *
 * Storage for the practice workbench (出题 / 解题 / 讲题): PracticeProblem,
 * PracticeProblemSet, PracticeAnswerRecord, GradingResult, ProblemExplanation,
 * PracticeMistake.
 *
 * Loaded by server.js into global.__PRACTICE__. Data lives under the real
 * profile/world layout — NOT under adaptive-teaching/:
 *   <PROJECT_ROOT>/profiles/<profileId>/worlds/<worldId>/practice/
 *     problem_sets/<problemSetId>.json
 *     sessions/<sessionId>.json
 *     mistakes/<problemId>.json
 *     practice_records/<problemSetId>.json
 *
 * Self-contained CommonJS module (no webpack). Mirrors the safe-segment,
 * atomic-write, and corrupt-JSON handling of lib/adaptive/data-layer.js.
 */

(function () {
  var fs = require("fs");
  var path = require("path");
  var crypto = require("crypto");

  // ========== Path helpers ==========

  function projectRoot() {
    return process.env.PROJECT_ROOT || "";
  }

  function safeSegment(value, name) {
    if (value === null || value === undefined || typeof value !== "string" || value.trim() === "")
      throw new Error(name + " must be a non-empty string");
    if (value.length > 128) throw new Error(name + " exceeds max length (128)");
    if (value.indexOf("/") >= 0) throw new Error(name + " must not contain '/'");
    if (value.indexOf("\\") >= 0) throw new Error(name + " must not contain '\\'");
    if (value.indexOf("..") >= 0) throw new Error(name + " must not contain '..'");
    if (/[\x00-\x1f\x7f]/.test(value)) throw new Error(name + " must not contain control characters");
    return value;
  }

  function profilesRoot() {
    var context = global.__SOCRATOPIA_ACCOUNT_REQUEST_CONTEXT__;
    var accountId = context && typeof context.getAccountId === "function" ? context.getAccountId() : null;
    return accountId
      ? path.join(projectRoot(), "accounts", safeSegment(accountId, "accountId"), "profiles")
      : path.join(projectRoot(), "profiles");
  }

  function worldDir(profileId, worldId) {
    return path.join(
      profilesRoot(),
      safeSegment(profileId, "profileId"),
      "worlds",
      safeSegment(worldId, "worldId")
    );
  }

  function practiceDir(profileId, worldId) {
    return path.join(worldDir(profileId, worldId), "practice");
  }

  function problemSetsDir(profileId, worldId) {
    return path.join(practiceDir(profileId, worldId), "problem_sets");
  }

  function sessionsDir(profileId, worldId) {
    return path.join(practiceDir(profileId, worldId), "sessions");
  }

  function mistakesDir(profileId, worldId) {
    return path.join(practiceDir(profileId, worldId), "mistakes");
  }

  function practiceRecordsDir(profileId, worldId) {
    return path.join(practiceDir(profileId, worldId), "practice_records");
  }

  function problemSetPath(profileId, worldId, problemSetId) {
    return path.join(problemSetsDir(profileId, worldId), safeSegment(problemSetId, "problemSetId") + ".json");
  }

  function sessionPath(profileId, worldId, sessionId) {
    return path.join(sessionsDir(profileId, worldId), safeSegment(sessionId, "sessionId") + ".json");
  }

  function mistakePath(profileId, worldId, problemId) {
    return path.join(mistakesDir(profileId, worldId), safeSegment(problemId, "problemId") + ".json");
  }

  function practiceRecordPath(profileId, worldId, problemSetId) {
    return path.join(practiceRecordsDir(profileId, worldId), safeSegment(problemSetId, "problemSetId") + ".json");
  }

  // ========== Low-level IO ==========

  function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  function genId(prefix) {
    return (prefix || "id") + "_" + Date.now().toString(36) + "_" + crypto.randomBytes(3).toString("hex");
  }

  function readJSON(filePath) {
    if (!fs.existsSync(filePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch (e) {
      // Never silently overwrite — rename the corrupt file aside for inspection.
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

  // ========== Defaults / normalization ==========

  function normalizeProblem(p, idx) {
    if (!p || typeof p !== "object") return null;
    var validTypes = { choice: 1, fill: 1, "short-answer": 1, step: 1 };
    var type = validTypes[p.type] ? p.type : "short-answer";
    var diff = (typeof p.difficulty === "number" && p.difficulty >= 1 && p.difficulty <= 3) ? p.difficulty : 1;
    var validStatus = { active: 1, mistake: 1, mastered: 1, deleted: 1 };
    return {
      id: (typeof p.id === "string" && p.id.trim()) ? p.id.trim() : genId("pb"),
      type: type,
      question: String(p.question || "").trim(),
      choices: Array.isArray(p.choices) ? p.choices.map(function (c) { return String(c); }) : undefined,
      correctAnswer: String(p.correctAnswer != null ? p.correctAnswer : "").trim(),
      correctIndex: (typeof p.correctIndex === "number" && Number.isInteger(p.correctIndex)) ? p.correctIndex : undefined,
      solution: String(p.solution || "").trim(),
      knowledgePoints: Array.isArray(p.knowledgePoints) ? p.knowledgePoints.filter(function (k) { return typeof k === "string"; }) : [],
      difficulty: diff,
      source: (p.source && typeof p.source === "object") ? p.source : {},
      rubric: Array.isArray(p.rubric) ? p.rubric.filter(function (r) { return typeof r === "string"; }) : undefined,
      commonMistakes: Array.isArray(p.commonMistakes) ? p.commonMistakes.filter(function (m) { return typeof m === "string"; }) : [],
      createdAt: typeof p.createdAt === "string" ? p.createdAt : new Date().toISOString(),
      status: validStatus[p.status] ? p.status : "active",
      history: Array.isArray(p.history) ? p.history : []
    };
  }

  // Validate a problem has the minimum fields to be usable. Returns array of error strings.
  function validateProblem(p) {
    var errors = [];
    if (!p || typeof p !== "object") return ["problem must be an object"];
    if (!p.id || typeof p.id !== "string") errors.push("missing id");
    var validTypes = { choice: 1, fill: 1, "short-answer": 1, step: 1 };
    if (!validTypes[p.type]) errors.push("invalid type '" + p.type + "'");
    if (!p.question || typeof p.question !== "string") errors.push("missing question");
    if (p.correctAnswer === undefined || p.correctAnswer === null || p.correctAnswer === "") errors.push("missing correctAnswer");
    if (p.type === "choice") {
      if (!Array.isArray(p.choices) || p.choices.length < 2) errors.push("choice problem must have >= 2 choices");
    }
    if (typeof p.difficulty !== "number" || p.difficulty < 1 || p.difficulty > 3) errors.push("difficulty must be 1-3");
    return errors;
  }

  // ========== Problem Set ==========

  function defaultProblemSet(problemSetId, source) {
    return {
      id: problemSetId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: source || {},
      problems: []
    };
  }

  // Read-only. Returns null on miss (no auto-create).
  function readProblemSet(profileId, worldId, problemSetId) {
    if (!profileId || !worldId || !problemSetId) return null;
    var fp = problemSetPath(profileId, worldId, problemSetId);
    var ps = readJSON(fp);
    if (!ps || !Array.isArray(ps.problems)) return null;
    return ps;
  }

  function writeProblemSet(profileId, worldId, problemSet) {
    if (!profileId || !worldId) throw new Error("writeProblemSet requires profileId and worldId");
    if (!problemSet || typeof problemSet !== "object") throw new Error("problemSet is required");
    if (!problemSet.id) problemSet.id = genId("ps");
    safeSegment(problemSet.id, "problemSetId");
    if (!Array.isArray(problemSet.problems)) problemSet.problems = [];
    if (!problemSet.createdAt) problemSet.createdAt = new Date().toISOString();
    problemSet.updatedAt = new Date().toISOString();
    writeJSON(problemSetPath(profileId, worldId, problemSet.id), problemSet);
    return problemSet;
  }

  function listProblemSets(profileId, worldId) {
    if (!profileId || !worldId) return [];
    var dir = problemSetsDir(profileId, worldId);
    if (!fs.existsSync(dir)) return [];
    var out = [];
    var entries;
    try { entries = fs.readdirSync(dir); } catch (e) { return []; }
    for (var i = 0; i < entries.length; i++) {
      if (!/\.json$/.test(entries[i])) continue;
      var ps = readJSON(path.join(dir, entries[i]));
      if (!ps || !Array.isArray(ps.problems)) continue;
      out.push({
        id: ps.id,
        createdAt: ps.createdAt || null,
        updatedAt: ps.updatedAt || null,
        source: ps.source || {},
        problemCount: ps.problems.length
      });
    }
    // Newest first
    out.sort(function (a, b) {
      return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    });
    return out;
  }

  // ========== Answer Record (append into problem.history) ==========

  function appendAnswerRecord(profileId, worldId, problemSetId, problemId, record, options) {
    if (!profileId || !worldId || !problemSetId || !problemId) {
      throw new Error("appendAnswerRecord requires profileId, worldId, problemSetId, problemId");
    }
    if (!record || typeof record !== "object") throw new Error("record is required");
    options = options || {};
    var ps = readProblemSet(profileId, worldId, problemSetId);
    if (!ps) throw new Error("ProblemSet not found: " + problemSetId);
    var problem = null;
    for (var i = 0; i < ps.problems.length; i++) {
      if (ps.problems[i].id === problemId) { problem = ps.problems[i]; break; }
    }
    if (!problem) throw new Error("Problem not found: " + problemId + " in set " + problemSetId);
    if (!Array.isArray(problem.history)) problem.history = [];
    var maxRevision = 0;
    for (var h = 0; h < problem.history.length; h++) {
      var priorRevision = problem.history[h] && problem.history[h].domainRevision;
      if (Number.isSafeInteger(priorRevision) && priorRevision > maxRevision) maxRevision = priorRevision;
    }
    var domainRevision = maxRevision + 1;
    var createdAt = record.timestamp || new Date().toISOString();
    var answerRecordId = "answer_" + crypto.createHash("sha256").update(JSON.stringify([
      profileId, worldId, problemSetId, problemId, domainRevision
    ]), "utf8").digest("hex").slice(0, 32);
    var entry = {
      schemaVersion: 2,
      answerRecordId: answerRecordId,
      domainRevision: domainRevision,
      timestamp: createdAt,
      userAnswer: record.userAnswer != null ? record.userAnswer : "",
      correct: record.correct === true,
      score: typeof record.score === "number" ? record.score : null,
      mistakeType: record.mistakeType || null,
      feedback: record.feedback || null
    };
    var answerRecordHash = "sha256:" + crypto.createHash("sha256").update(JSON.stringify([
      entry.schemaVersion, entry.answerRecordId, entry.domainRevision, entry.timestamp,
      entry.userAnswer, entry.correct, entry.score, entry.mistakeType, entry.feedback
    ]), "utf8").digest("hex");
    if (typeof options.buildAdaptiveIntent === "function") {
      try {
        var intent = options.buildAdaptiveIntent({
          domainRevision: domainRevision,
          createdAt: createdAt,
          businessReceipt: {
            kind: "practice_answer",
            problemSetId: problemSetId,
            problemId: problemId,
            domainRevision: domainRevision,
            answerRecordId: answerRecordId,
            answerRecordHash: answerRecordHash
          }
        });
        if (intent && typeof intent === "object") entry.adaptiveEvidence = intent;
      } catch (_) {
        entry.adaptiveEvidenceBuildError = "intent_build_failed";
      }
    }
    problem.history.push(entry);
    writeProblemSet(profileId, worldId, ps);
    return entry;
  }

  function findAnswerEntry(problem, sourceEventId, observationInputHash) {
    var history = Array.isArray(problem && problem.history) ? problem.history : [];
    for (var i = 0; i < history.length; i++) {
      var intent = history[i] && history[i].adaptiveEvidence;
      if (!intent || intent.sourceEventId !== sourceEventId) continue;
      if (observationInputHash && intent.observationInputHash !== observationInputHash) {
        throw new Error("adaptive evidence observation hash mismatch");
      }
      return history[i];
    }
    return null;
  }

  function updateAnswerAdaptiveSync(profileId, worldId, problemSetId, problemId, sourceEventId, observationInputHash, transition) {
    if (!profileId || !worldId || !problemSetId || !problemId || !sourceEventId) {
      throw new Error("updateAnswerAdaptiveSync requires the complete answer identity");
    }
    if (!transition || typeof transition !== "object") throw new Error("adaptive sync transition is required");
    var ps = readProblemSet(profileId, worldId, problemSetId);
    if (!ps) throw new Error("ProblemSet not found: " + problemSetId);
    var problem = null;
    for (var i = 0; i < ps.problems.length; i++) {
      if (ps.problems[i].id === problemId) { problem = ps.problems[i]; break; }
    }
    if (!problem) throw new Error("Problem not found: " + problemId + " in set " + problemSetId);
    var entry = findAnswerEntry(problem, sourceEventId, observationInputHash);
    if (!entry) throw new Error("Adaptive answer intent not found");
    var intent = entry.adaptiveEvidence;
    var patch = transition.intentPatch;
    if (patch && typeof patch === "object") {
      if (patch.conceptResolution && intent.conceptResolution && intent.conceptResolution.status !== "resolved") {
        intent.conceptResolution = JSON.parse(JSON.stringify(patch.conceptResolution));
      }
      if (patch.eventInputHash) {
        if (intent.eventInputHash && intent.eventInputHash !== patch.eventInputHash) {
          throw new Error("adaptive evidence input hash mismatch");
        }
        if (!intent.eventInputHash) {
          if (!patch.payload || patch.payload.eventInputHash !== patch.eventInputHash || patch.payload.sourceEventId !== intent.sourceEventId) {
            throw new Error("adaptive evidence resolution patch is invalid");
          }
          intent.eventInputHash = patch.eventInputHash;
          intent.payload = JSON.parse(JSON.stringify(patch.payload));
        }
      }
    }
    var terminal = { committed: true, duplicate: true, unverified: true, conflict: true };
    var currentState = intent.sync && intent.sync.state || "pending";
    var nextState = typeof transition.state === "string" ? transition.state : "retryable";
    if (!intent.sync || typeof intent.sync !== "object") {
      intent.sync = { state: "pending", attempts: 0, lastReasonCode: null, updatedAt: intent.createdAt };
    }
    if (!terminal[currentState] || currentState === nextState) intent.sync.state = nextState;
    intent.sync.attempts = (Number.isSafeInteger(intent.sync.attempts) ? intent.sync.attempts : 0) + 1;
    intent.sync.lastReasonCode = typeof transition.reasonCode === "string" ? transition.reasonCode : null;
    intent.sync.updatedAt = transition.updatedAt || new Date().toISOString();
    writeProblemSet(profileId, worldId, ps);
    return entry;
  }

  function listPendingAnswerEvidence(profileId, worldId, problemSetId, problemId, accountBindingHash, limit) {
    var ps = readProblemSet(profileId, worldId, problemSetId);
    if (!ps) return [];
    var problem = null;
    for (var i = 0; i < ps.problems.length; i++) {
      if (ps.problems[i].id === problemId) { problem = ps.problems[i]; break; }
    }
    if (!problem) return [];
    var max = Number.isSafeInteger(limit) ? Math.max(1, Math.min(50, limit)) : 10;
    return (Array.isArray(problem.history) ? problem.history : []).filter(function (entry) {
      var intent = entry && entry.adaptiveEvidence;
      var state = intent && intent.sync && intent.sync.state;
      return intent && intent.accountBindingHash === accountBindingHash && (state === "pending" || state === "retryable");
    }).sort(function (left, right) {
      return (left.domainRevision || 0) - (right.domainRevision || 0);
    }).slice(0, max).map(function (entry) {
      return {
        answerRecordId: entry.answerRecordId,
        domainRevision: entry.domainRevision,
        adaptiveEvidence: JSON.parse(JSON.stringify(entry.adaptiveEvidence))
      };
    });
  }

  // ========== Mistakes ==========

  function defaultMistake(problemId) {
    return {
      problemId: problemId,
      wrongAnswer: "",
      correctAnswer: "",
      diagnosis: "",
      knowledgePoints: [],
      source: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "active",
      reviewHistory: [],
      nextReview: null
    };
  }

  function readMistake(profileId, worldId, problemId) {
    if (!profileId || !worldId || !problemId) return null;
    var fp = mistakePath(profileId, worldId, problemId);
    return readJSON(fp);
  }

  // Idempotent: same problemId updates the existing mistake file in place.
  function saveMistake(profileId, worldId, mistake) {
    if (!profileId || !worldId) throw new Error("saveMistake requires profileId and worldId");
    if (!mistake || typeof mistake !== "object" || !mistake.problemId) {
      throw new Error("mistake must include problemId");
    }
    safeSegment(mistake.problemId, "problemId");
    var existing = readMistake(profileId, worldId, mistake.problemId);
    var base = existing || defaultMistake(mistake.problemId);

    base.problemId = mistake.problemId;
    if (mistake.wrongAnswer != null) base.wrongAnswer = mistake.wrongAnswer;
    if (mistake.correctAnswer != null) base.correctAnswer = mistake.correctAnswer;
    if (mistake.diagnosis != null) base.diagnosis = mistake.diagnosis;
    if (Array.isArray(mistake.knowledgePoints)) base.knowledgePoints = mistake.knowledgePoints;
    if (mistake.source && typeof mistake.source === "object") base.source = mistake.source;
    if (mistake.status) base.status = mistake.status;
    if (mistake.nextReview !== undefined) base.nextReview = mistake.nextReview;

    // Append a review-history entry if provided
    if (mistake.reviewEntry && typeof mistake.reviewEntry === "object") {
      if (!Array.isArray(base.reviewHistory)) base.reviewHistory = [];
      base.reviewHistory.push({
        timestamp: mistake.reviewEntry.timestamp || new Date().toISOString(),
        correct: mistake.reviewEntry.correct === true,
        note: mistake.reviewEntry.note || ""
      });
    } else if (Array.isArray(mistake.reviewHistory)) {
      base.reviewHistory = mistake.reviewHistory;
    }

    if (!base.createdAt) base.createdAt = new Date().toISOString();
    base.updatedAt = new Date().toISOString();

    writeJSON(mistakePath(profileId, worldId, mistake.problemId), base);
    return base;
  }

  function readMistakes(profileId, worldId, filters) {
    if (!profileId || !worldId) return [];
    var dir = mistakesDir(profileId, worldId);
    if (!fs.existsSync(dir)) return [];
    filters = filters || {};
    var includeMastered = filters.includeMastered === true;
    var nowIso = new Date().toISOString();
    var out = [];
    var entries;
    try { entries = fs.readdirSync(dir); } catch (e) { return []; }
    for (var i = 0; i < entries.length; i++) {
      if (!/\.json$/.test(entries[i])) continue;
      var m = readJSON(path.join(dir, entries[i]));
      if (!m || !m.problemId) continue;

      // Default: hide mastered unless explicitly requested
      if (!includeMastered && m.status === "mastered") continue;

      // Filter by textbookId (via source)
      if (filters.textbookId) {
        var tid = m.source && m.source.textbookId;
        if (tid !== filters.textbookId) continue;
      }
      // Filter by knowledgePoint
      if (filters.knowledgePoint) {
        var kps = Array.isArray(m.knowledgePoints) ? m.knowledgePoints : [];
        if (kps.indexOf(filters.knowledgePoint) < 0) continue;
      }
      // Filter by createdAfter (ISO string compare)
      if (filters.createdAfter) {
        if (String(m.createdAt || "") < filters.createdAfter) continue;
      }
      // Filter by reviewDue: nextReview <= now
      if (filters.reviewDue === true) {
        if (!m.nextReview || String(m.nextReview) > nowIso) continue;
      }
      out.push(m);
    }
    // Newest first
    out.sort(function (a, b) {
      return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    });
    return out;
  }

  // ========== Practice Records ==========

  function readPracticeRecord(profileId, worldId, problemSetId) {
    if (!profileId || !worldId || !problemSetId) return null;
    return readJSON(practiceRecordPath(profileId, worldId, problemSetId));
  }

  function savePracticeRecord(profileId, worldId, record) {
    if (!profileId || !worldId) throw new Error("savePracticeRecord requires profileId and worldId");
    if (!record || typeof record !== "object" || !record.problemSetId) {
      throw new Error("practice record must include problemSetId");
    }
    safeSegment(record.problemSetId, "problemSetId");
    var existing = readPracticeRecord(profileId, worldId, record.problemSetId);
    var now = new Date().toISOString();
    var base = existing || {
      id: record.problemSetId,
      problemSetId: record.problemSetId,
      createdAt: now
    };

    base.updatedAt = now;
    base.status = record.status || base.status || "generated";
    if (record.submittedAt) base.submittedAt = record.submittedAt;
    if (record.tutoringStartedAt) base.tutoringStartedAt = record.tutoringStartedAt;
    if (record.companionId !== undefined) base.companionId = record.companionId || null;
    if (record.companionName !== undefined) base.companionName = record.companionName || null;
    if (record.problemCount !== undefined) base.problemCount = record.problemCount;
    if (record.answeredCount !== undefined) base.answeredCount = record.answeredCount;
    if (record.correctCount !== undefined) base.correctCount = record.correctCount;
    if (record.score !== undefined) base.score = record.score;
    if (record.source && typeof record.source === "object") base.source = record.source;
    if (record.composition && typeof record.composition === "object") base.composition = record.composition;
    if (record.answers && typeof record.answers === "object") base.answers = record.answers;
    if (record.grades && typeof record.grades === "object") base.grades = record.grades;
    if (record.summary && typeof record.summary === "object") base.summary = record.summary;
    if (record.messageCount !== undefined) base.messageCount = record.messageCount;
    base.tutoringSessionId = record.tutoringSessionId || base.tutoringSessionId || record.problemSetId;

    writeJSON(practiceRecordPath(profileId, worldId, record.problemSetId), base);
    return base;
  }

  function listPracticeRecords(profileId, worldId) {
    if (!profileId || !worldId) return [];
    var dir = practiceRecordsDir(profileId, worldId);
    if (!fs.existsSync(dir)) return [];
    var out = [];
    var entries;
    try { entries = fs.readdirSync(dir); } catch (e) { return []; }
    for (var i = 0; i < entries.length; i++) {
      if (!/\.json$/.test(entries[i])) continue;
      var rec = readJSON(path.join(dir, entries[i]));
      if (!rec || !rec.problemSetId) continue;
      out.push(rec);
    }
    out.sort(function (a, b) {
      return String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || ""));
    });
    return out;
  }

  // ========== Sessions (optional bookkeeping) ==========

  function readSession(profileId, worldId, sessionId) {
    if (!profileId || !worldId || !sessionId) return null;
    return readJSON(sessionPath(profileId, worldId, sessionId));
  }

  function writeSession(profileId, worldId, session) {
    if (!profileId || !worldId) throw new Error("writeSession requires profileId and worldId");
    if (!session || typeof session !== "object") throw new Error("session is required");
    if (!session.sessionId) session.sessionId = genId("psess");
    safeSegment(session.sessionId, "sessionId");
    if (!session.createdAt) session.createdAt = new Date().toISOString();
    session.updatedAt = new Date().toISOString();
    writeJSON(sessionPath(profileId, worldId, session.sessionId), session);
    return session;
  }

  // ========== Export ==========

  var api = {
    // Paths
    practiceDir: practiceDir,
    practiceRecordsDir: practiceRecordsDir,
    problemSetPath: problemSetPath,
    mistakePath: mistakePath,
    practiceRecordPath: practiceRecordPath,
    sessionPath: sessionPath,
    safeSegment: safeSegment,
    // Problem sets
    readProblemSet: readProblemSet,
    writeProblemSet: writeProblemSet,
    listProblemSets: listProblemSets,
    defaultProblemSet: defaultProblemSet,
    // Answer records
    appendAnswerRecord: appendAnswerRecord,
    updateAnswerAdaptiveSync: updateAnswerAdaptiveSync,
    listPendingAnswerEvidence: listPendingAnswerEvidence,
    // Mistakes
    readMistake: readMistake,
    readMistakes: readMistakes,
    saveMistake: saveMistake,
    defaultMistake: defaultMistake,
    // Practice records
    readPracticeRecord: readPracticeRecord,
    savePracticeRecord: savePracticeRecord,
    listPracticeRecords: listPracticeRecords,
    // Sessions
    readSession: readSession,
    writeSession: writeSession,
    // Helpers
    genId: genId,
    normalizeProblem: normalizeProblem,
    validateProblem: validateProblem
  };

  global.__PRACTICE__ = api;
  module.exports = api;
})();
