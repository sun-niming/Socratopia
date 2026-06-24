/**
 * Tutoring Session Data Layer
 *
 * Storage for AI tutoring conversations (AI讲题): per-problemSet chat sessions
 * with a bound companion. Each problemSet gets one tutoring session file.
 *
 * Loaded by server.js into global.__PRACTICE_TUTOR__. Data lives under:
 *   <PROJECT_ROOT>/profiles/<profileId>/worlds/<worldId>/practice/
 *     tutoring_sessions/<problemSetId>.json
 *
 * Self-contained CommonJS module (no webpack). Mirrors the safe-segment,
 * atomic-write, and corrupt-JSON handling of lib/practice/data-layer.js.
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

  function worldDir(profileId, worldId) {
    return path.join(
      projectRoot(),
      "profiles",
      safeSegment(profileId, "profileId"),
      "worlds",
      safeSegment(worldId, "worldId")
    );
  }

  function tutoringSessionsDir(profileId, worldId) {
    return path.join(worldDir(profileId, worldId), "practice", "tutoring_sessions");
  }

  function sessionFilePath(profileId, worldId, problemSetId) {
    return path.join(tutoringSessionsDir(profileId, worldId), safeSegment(problemSetId, "problemSetId") + ".json");
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

  // ========== Default session ==========

  function defaultSession(problemSetId) {
    return {
      problemSetId: problemSetId,
      companionId: null,
      companionName: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
      activeProblemId: null,
      context: null
    };
  }

  // ========== CRUD ==========

  function readTutoringSession(profileId, worldId, problemSetId) {
    if (!profileId || !worldId || !problemSetId) return null;
    var fp = sessionFilePath(profileId, worldId, problemSetId);
    var sess = readJSON(fp);
    if (!sess || !Array.isArray(sess.messages)) return null;
    return sess;
  }

  function writeTutoringSession(profileId, worldId, session) {
    if (!profileId || !worldId) throw new Error("writeTutoringSession requires profileId and worldId");
    if (!session || typeof session !== "object") throw new Error("session is required");
    if (!session.problemSetId) throw new Error("session.problemSetId is required");
    safeSegment(session.problemSetId, "problemSetId");
    if (!Array.isArray(session.messages)) session.messages = [];
    if (!session.createdAt) session.createdAt = new Date().toISOString();
    session.updatedAt = new Date().toISOString();
    writeJSON(sessionFilePath(profileId, worldId, session.problemSetId), session);
    return session;
  }

  function appendMessage(profileId, worldId, problemSetId, message) {
    if (!profileId || !worldId || !problemSetId) {
      throw new Error("appendMessage requires profileId, worldId, problemSetId");
    }
    if (!message || typeof message !== "object") throw new Error("message is required");

    var sess = readTutoringSession(profileId, worldId, problemSetId);
    if (!sess) {
      sess = defaultSession(problemSetId);
    }

    var entry = {
      id: message.id || genId("msg"),
      role: message.role || "user",
      content: String(message.content || ""),
      timestamp: message.timestamp || new Date().toISOString(),
      metadata: message.metadata && typeof message.metadata === "object" ? message.metadata : null
    };

    sess.messages.push(entry);
    sess.updatedAt = new Date().toISOString();
    writeJSON(sessionFilePath(profileId, worldId, problemSetId), sess);
    return entry;
  }

  function updateContext(profileId, worldId, problemSetId, context) {
    if (!profileId || !worldId || !problemSetId) {
      throw new Error("updateContext requires profileId, worldId, problemSetId");
    }
    var sess = readTutoringSession(profileId, worldId, problemSetId);
    if (!sess) {
      sess = defaultSession(problemSetId);
    }
    sess.context = context && typeof context === "object" ? context : null;
    if (context && context.problemId) sess.activeProblemId = context.problemId;
    sess.updatedAt = new Date().toISOString();
    writeJSON(sessionFilePath(profileId, worldId, problemSetId), sess);
    return sess;
  }

  function setCompanion(profileId, worldId, problemSetId, companionId, companionName) {
    if (!profileId || !worldId || !problemSetId) {
      throw new Error("setCompanion requires profileId, worldId, problemSetId");
    }
    var sess = readTutoringSession(profileId, worldId, problemSetId);
    if (!sess) {
      sess = defaultSession(problemSetId);
    }
    sess.companionId = companionId || null;
    sess.companionName = companionName || null;
    sess.updatedAt = new Date().toISOString();
    writeJSON(sessionFilePath(profileId, worldId, problemSetId), sess);
    return sess;
  }

  function listTutoringSessions(profileId, worldId) {
    if (!profileId || !worldId) return [];
    var dir = tutoringSessionsDir(profileId, worldId);
    if (!fs.existsSync(dir)) return [];
    var out = [];
    var entries;
    try { entries = fs.readdirSync(dir); } catch (e) { return []; }
    for (var i = 0; i < entries.length; i++) {
      if (!/\.json$/.test(entries[i])) continue;
      var sess = readJSON(path.join(dir, entries[i]));
      if (!sess || !Array.isArray(sess.messages)) continue;
      out.push({
        problemSetId: sess.problemSetId || entries[i].replace(/\.json$/, ""),
        companionId: sess.companionId || null,
        companionName: sess.companionName || null,
        messageCount: sess.messages.length,
        createdAt: sess.createdAt || null,
        updatedAt: sess.updatedAt || null
      });
    }
    out.sort(function (a, b) {
      return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
    });
    return out;
  }

  function deleteTutoringSession(profileId, worldId, problemSetId) {
    if (!profileId || !worldId || !problemSetId) return false;
    var fp = sessionFilePath(profileId, worldId, problemSetId);
    if (!fs.existsSync(fp)) return false;
    try { fs.unlinkSync(fp); return true; } catch (e) { return false; }
  }

  // ========== Export ==========

  var api = {
    tutoringSessionsDir: tutoringSessionsDir,
    sessionFilePath: sessionFilePath,
    safeSegment: safeSegment,
    readTutoringSession: readTutoringSession,
    writeTutoringSession: writeTutoringSession,
    appendMessage: appendMessage,
    updateContext: updateContext,
    setCompanion: setCompanion,
    listTutoringSessions: listTutoringSessions,
    deleteTutoringSession: deleteTutoringSession,
    defaultSession: defaultSession,
    genId: genId
  };

  global.__PRACTICE_TUTOR__ = api;
  module.exports = api;
})();
