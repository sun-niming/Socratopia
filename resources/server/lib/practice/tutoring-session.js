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

  function accountError(code, message) {
    var error = new Error(message || code); error.code = code; error.status = 409; error.statusCode = 409; return error;
  }

  function readCurrentAccountContext() {
    try { return typeof global.__SOCRATOPIA_ACCOUNT_CONTEXT__ === "function" ? global.__SOCRATOPIA_ACCOUNT_CONTEXT__() : null; } catch (_) { return null; }
  }

  function normalizeAccountContext(value) {
    if (!value || !value.active) return null;
    var accountId = safeSegment(value.accountId, "accountId");
    if (!Number.isSafeInteger(value.sessionEpoch) || value.sessionEpoch < 0) throw accountError("TUTORING_SESSION_EPOCH_INVALID", "sessionEpoch must be a non-negative integer");
    return { active: true, accountId: accountId, sessionEpoch: value.sessionEpoch };
  }

  function requestContext(value) {
    var current = normalizeAccountContext(readCurrentAccountContext());
    var context = normalizeAccountContext(value === undefined ? current : value);
    // An active server account is authoritative.  A missing or stale caller
    // context must never downgrade this operation to the legacy profiles root.
    if (current) {
      if (!context || current.accountId !== context.accountId || current.sessionEpoch !== context.sessionEpoch) throw accountError("TUTORING_SESSION_EPOCH_STALE", "Tutoring request account session changed");
      return context;
    }
    if (context) throw accountError("TUTORING_SESSION_EPOCH_STALE", "Tutoring request account is no longer active");
    return null;
  }

  function profilesRoot(context) {
    return context ? path.join(projectRoot(), "accounts", context.accountId, "profiles") : path.join(projectRoot(), "profiles");
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

  function worldDir(profileId, worldId, context) {
    context = requestContext(context);
    return path.join(profilesRoot(context), safeSegment(profileId, "profileId"), "worlds", safeSegment(worldId, "worldId"));
  }

  function tutoringSessionsDir(profileId, worldId, context) {
    return path.join(worldDir(profileId, worldId, context), "practice", "tutoring_sessions");
  }

  function sessionFilePath(profileId, worldId, problemSetId, context) {
    return path.join(tutoringSessionsDir(profileId, worldId, context), safeSegment(problemSetId, "problemSetId") + ".json");
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

  function defaultSession(problemSetId, context) {
    context = requestContext(context);
    return {
      problemSetId: problemSetId,
      companionId: null,
      companionName: null,
      companionSlotId: null,
      companionInstanceId: null,
      candidateId: null,
      accountId: context ? context.accountId : null,
      sessionEpoch: context ? context.sessionEpoch : null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
      activeProblemId: null,
      context: null
    };
  }

  function assertSessionOwnership(session, context) {
    if (!context || !session) return session;
    if (session.accountId && session.accountId !== context.accountId) throw accountError("TUTORING_ACCOUNT_MISMATCH", "Tutoring session belongs to another account");
    if (!session.accountId) session.accountId = context.accountId;
    return session;
  }

  function stampSessionContext(session, context) {
    if (context) { session.accountId = context.accountId; session.sessionEpoch = context.sessionEpoch; }
    return session;
  }

  // ========== CRUD ==========

  function readTutoringSession(profileId, worldId, problemSetId, context) {
    if (!profileId || !worldId || !problemSetId) return null;
    context = requestContext(context);
    var fp = sessionFilePath(profileId, worldId, problemSetId, context);
    var sess = readJSON(fp);
    if (!sess || !Array.isArray(sess.messages)) return null;
    return assertSessionOwnership(sess, context);
  }

  function writeTutoringSession(profileId, worldId, session, context) {
    if (!profileId || !worldId) throw new Error("writeTutoringSession requires profileId and worldId");
    if (!session || typeof session !== "object") throw new Error("session is required");
    if (!session.problemSetId) throw new Error("session.problemSetId is required");
    context = requestContext(context);
    safeSegment(session.problemSetId, "problemSetId");
    if (!Array.isArray(session.messages)) session.messages = [];
    assertSessionOwnership(session, context);
    stampSessionContext(session, context);
    if (!session.createdAt) session.createdAt = new Date().toISOString();
    session.updatedAt = new Date().toISOString();
    writeJSON(sessionFilePath(profileId, worldId, session.problemSetId, context), session);
    return session;
  }

  function appendMessage(profileId, worldId, problemSetId, message, context) {
    if (!profileId || !worldId || !problemSetId) {
      throw new Error("appendMessage requires profileId, worldId, problemSetId");
    }
    if (!message || typeof message !== "object") throw new Error("message is required");

    context = requestContext(context);
    var sess = readTutoringSession(profileId, worldId, problemSetId, context);
    if (!sess) {
      sess = defaultSession(problemSetId, context);
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
    writeTutoringSession(profileId, worldId, sess, context);
    return entry;
  }

  function updateContext(profileId, worldId, problemSetId, context, requestCtx) {
    if (!profileId || !worldId || !problemSetId) {
      throw new Error("updateContext requires profileId, worldId, problemSetId");
    }
    requestCtx = requestContext(requestCtx);
    var sess = readTutoringSession(profileId, worldId, problemSetId, requestCtx);
    if (!sess) {
      sess = defaultSession(problemSetId, requestCtx);
    }
    sess.context = context && typeof context === "object" ? context : null;
    if (context && context.problemId) sess.activeProblemId = context.problemId;
    sess.updatedAt = new Date().toISOString();
    writeTutoringSession(profileId, worldId, sess, requestCtx);
    return sess;
  }

  function setCompanion(profileId, worldId, problemSetId, companionId, companionName, identity, context) {
    if (!profileId || !worldId || !problemSetId) {
      throw new Error("setCompanion requires profileId, worldId, problemSetId");
    }
    if (identity && identity.active !== undefined && context === undefined) { context = identity; identity = null; }
    context = requestContext(context);
    var sess = readTutoringSession(profileId, worldId, problemSetId, context);
    if (!sess) {
      sess = defaultSession(problemSetId, context);
    }
    sess.companionId = companionId || null;
    sess.companionName = companionName || null;
    if (identity && typeof identity === "object") {
      sess.companionSlotId = identity.slotId || null;
      sess.companionInstanceId = identity.companionInstanceId || companionId || null;
      sess.candidateId = identity.candidateId || null;
    }
    sess.updatedAt = new Date().toISOString();
    writeTutoringSession(profileId, worldId, sess, context);
    return sess;
  }

  function listTutoringSessions(profileId, worldId, context) {
    if (!profileId || !worldId) return [];
    context = requestContext(context);
    var dir = tutoringSessionsDir(profileId, worldId, context);
    if (!fs.existsSync(dir)) return [];
    var out = [];
    var entries;
    try { entries = fs.readdirSync(dir); } catch (e) { return []; }
    for (var i = 0; i < entries.length; i++) {
      if (!/\.json$/.test(entries[i])) continue;
      var sess = readJSON(path.join(dir, entries[i]));
      if (!sess || !Array.isArray(sess.messages)) continue;
      try { assertSessionOwnership(sess, context); } catch (_) { continue; }
      out.push({
        problemSetId: sess.problemSetId || entries[i].replace(/\.json$/, ""),
        companionId: sess.companionId || null,
        companionName: sess.companionName || null,
        companionSlotId: sess.companionSlotId || null,
        companionInstanceId: sess.companionInstanceId || null,
        candidateId: sess.candidateId || null,
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

  function deleteTutoringSession(profileId, worldId, problemSetId, context) {
    if (!profileId || !worldId || !problemSetId) return false;
    context = requestContext(context);
    var fp = sessionFilePath(profileId, worldId, problemSetId, context);
    if (!fs.existsSync(fp)) return false;
    try { fs.unlinkSync(fp); return true; } catch (e) { return false; }
  }

  // ========== Export ==========

  var api = {
    tutoringSessionsDir: tutoringSessionsDir,
    sessionFilePath: sessionFilePath,
    safeSegment: safeSegment,
    requestContext: requestContext,
    profilesRoot: profilesRoot,
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
