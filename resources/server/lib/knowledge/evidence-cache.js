/**
 * Evidence Cache
 *
 * Caches normalized evidence packages so repeated queries with the same
 * question + context hit the cache instead of the external provider.
 *
 * Cache key: providerId + mode + stableContextHash + providerConfigHash + questionHash + dateBucket
 * Storage: %APPDATA%/socratopia/knowledge-cache/<providerId>/<YYYY-MM-DD>/<keyHash>.json
 *
 * The stable context hash includes textbookTitle, currentPage, courseLanguage,
 * learnerLevel, and fingerprints of selectedText/pageText.
 */

(function () {
  "use strict";

  var fs = require("fs");
  var path = require("path");
  var crypto = require("crypto");

  var CACHE_DIR = null; // resolved lazily from PROJECT_ROOT
  var enabled = true;

  function setEnabled(v) { enabled = v; }
  function isEnabled() { return enabled; }

  function cacheRoot() {
    if (CACHE_DIR) return CACHE_DIR;
    var base = process.env.PROJECT_ROOT || "";
    if (!base) {
      CACHE_DIR = null;
      return null;
    }
    CACHE_DIR = path.join(base, "knowledge-cache");
    return CACHE_DIR;
  }

  /**
   * Build a stable context hash from request.context.
   * Include fields that can materially change the provider answer.
   */
  function stableContextHash(ctx) {
    ctx = ctx || {};
    var stable = [
      String(ctx.textbookTitle || ""),
      String(ctx.currentPage != null ? ctx.currentPage : ""),
      String(ctx.courseLanguage || ""),
      String(ctx.learnerLevel || ""),
      questionHash(ctx.selectedText || ""),
      questionHash(ctx.pageText || ""),
    ].join("|");
    return crypto.createHash("sha256").update(stable).digest("hex").slice(0, 16);
  }

  function questionHash(q) {
    return crypto.createHash("sha256").update(String(q || "")).digest("hex").slice(0, 16);
  }

  function stableValue(value) {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) return value.map(stableValue);
    if (typeof value !== "object") return value;
    var out = {};
    Object.keys(value).sort().forEach(function (key) {
      out[key] = stableValue(value[key]);
    });
    return out;
  }

  function providerConfigHash(config) {
    var serialized = "";
    try {
      serialized = JSON.stringify(stableValue(config || {}));
    } catch (e) {
      serialized = String(config || "");
    }
    return crypto.createHash("sha256").update(serialized).digest("hex").slice(0, 16);
  }

  function dateBucket(date) {
    var d = date || new Date();
    return d.toISOString().slice(0, 10); // YYYY-MM-DD
  }

  function safeSegment(value) {
    value = String(value || "");
    return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) && value !== "." && value !== "..";
  }

  function cacheFilePath(providerId, mode, stableHash, configHash, qHash, bucket) {
    if (!safeSegment(providerId) || !safeSegment(mode) || !/^\d{4}-\d{2}-\d{2}$/.test(String(bucket || ""))) return null;
    var root = cacheRoot();
    if (!root) return null;
    var key = [mode, stableHash, configHash, qHash].join("_") + ".json";
    return path.join(root, providerId, bucket, key);
  }

  /**
   * Look up a cached evidence package. Returns null on miss or error.
   */
  function get(providerId, mode, context, question, providerConfig) {
    try {
      if (!enabled) return null;
      var root = cacheRoot();
      if (!root) return null;

      var sHash = stableContextHash(context);
      var cHash = providerConfigHash(providerConfig);
      var qHash = questionHash(question);
      var now = new Date();
      for (var offset = 0; offset <= 14; offset++) {
        var candidateDate = new Date(Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate() - offset
        ));
        var bucket = dateBucket(candidateDate);
        var file = cacheFilePath(providerId, mode, sHash, cHash, qHash, bucket);
        if (!file || !fs.existsSync(file)) continue;

        try {
          var raw = fs.readFileSync(file, "utf-8");
          var entry = JSON.parse(raw);
          if (entry.expiresAt && new Date(entry.expiresAt) < now) {
            try { fs.unlinkSync(file); } catch (_) {}
            try {
              var bucketDir = path.dirname(file);
              if (fs.readdirSync(bucketDir).length === 0) fs.rmdirSync(bucketDir);
            } catch (_) {}
            continue;
          }
          if (entry.response) return entry.response;
        } catch (_) {
          // A corrupt bucket must not hide an older valid entry.
        }
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Store an evidence package in the cache.
   * ttlDays controls how long the entry lives.
   */
  function set(providerId, mode, context, question, response, ttlDays, providerConfig) {
    try {
      if (!enabled) return;
      var root = cacheRoot();
      if (!root) return;

      var sHash = stableContextHash(context);
      var cHash = providerConfigHash(providerConfig);
      var qHash = questionHash(question);
      var bucket = dateBucket();

      var file = cacheFilePath(providerId, mode, sHash, cHash, qHash, bucket);
      if (!file) return;

      var dir = path.dirname(file);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      var createdAt = new Date().toISOString();
      var expiresAt = new Date(Date.now() + (ttlDays || 7) * 86400000).toISOString();

      var entry = {
        key: [providerId, mode, sHash, cHash, qHash].join("|"),
        providerId: providerId,
        createdAt: createdAt,
        expiresAt: expiresAt,
        request: { context: context, question: question },
        response: response,
      };

      var tmp = file + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(entry, null, 2), "utf-8");
      fs.renameSync(tmp, file);
    } catch (e) {
      // Cache write failures are non-fatal
    }
  }

  /**
   * Determine appropriate TTL based on content freshness needs.
   */
  function ttlForMode(mode) {
    switch (mode) {
      case "verify":
        return 1;    // fact-check: short-lived
      case "search":
        return 3;    // current info: a few days
      case "expand":
      case "explain":
        return 14;   // background explanation: two weeks
      case "compare":
        return 7;    // comparison: one week
      default:
        return 7;
    }
  }

  module.exports = {
    get: get,
    set: set,
    ttlForMode: ttlForMode,
    stableContextHash: stableContextHash,
    providerConfigHash: providerConfigHash,
    questionHash: questionHash,
    setEnabled: setEnabled,
    isEnabled: isEnabled,
  };
})();
