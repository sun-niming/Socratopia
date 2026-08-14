/**
 * Practice Source Adapter
 *
 * Resolves the "source text" used to generate practice problems, from the four
 * supported sourceType values: manual, textbook-page, chapter, conversation.
 *
 * Self-contained CommonJS module (no webpack require of "fs"). Reads the same
 * on-disk layout the existing Next.js routes write, under either:
 *   <PROJECT_ROOT>/profiles/<pid>/worlds/<wid>/...
 *   <PROJECT_ROOT>/accounts/<accountId>/profiles/<pid>/worlds/<wid>/...   (multi-account)
 *
 * On-disk layout reused (relative to the world dir profiles/<pid>/worlds/<wid>):
 *   textbooks/<tid>/current_reading.md      recently-taught page window text
 *   textbooks/<tid>/pages.json              TOC / page manifest (fallback titles)
 *   concept-summaries/<conversationId>.json { conversationId, sections: [...] }
 *   lesson_summaries/<conversationId>.md    compressed lesson summary (markdown)
 *   chats/<conversationId>.json             { id, messages: [{role,content}, ...] }
 *
 * Missing source returns { error: "no_source", message } so the caller can emit
 * a 404. When page text is missing but a local PDF is available, the adapter may
 * extract the requested pages and cache them under textbooks/<tid>/pages/.
 * adaptive ConceptGraph is OPTIONAL context — its absence never fails generate.
 */

(function () {
  var fs = require("fs");
  var os = require("os");
  var path = require("path");
  var childProcess = require("child_process");
  var pdfExtractionInflight = Object.create(null);

  var PDF_RUNTIME_DEFAULTS = Object.freeze({
    timeoutMs: 120000,
    terminationGraceMs: 5000,
    cleanupRetryDelayMs: 250,
    maxStdoutBytes: 16 * 1024 * 1024
  });

  function numberSetting(env, name, fallback, minimum, zeroUsesFallback) {
    var raw = env && env[name];
    var value = raw === undefined || raw === null || String(raw).trim() === "" ? fallback : Number(raw);
    if (!isFinite(value) || (zeroUsesFallback && value === 0)) value = fallback;
    return Math.max(minimum, value);
  }

  function pdfRuntimeConfig(env) {
    env = env || process.env;
    return {
      timeoutMs: numberSetting(env, "PRACTICE_PDF_TIMEOUT_MS", PDF_RUNTIME_DEFAULTS.timeoutMs, 100, true),
      terminationGraceMs: numberSetting(env, "PRACTICE_PDF_TERMINATION_GRACE_MS", PDF_RUNTIME_DEFAULTS.terminationGraceMs, 100),
      cleanupRetryDelayMs: numberSetting(env, "PRACTICE_PDF_CLEANUP_RETRY_MS", PDF_RUNTIME_DEFAULTS.cleanupRetryDelayMs, 0),
      maxStdoutBytes: numberSetting(env, "PRACTICE_PDF_MAX_STDOUT_BYTES", PDF_RUNTIME_DEFAULTS.maxStdoutBytes, 1024)
    };
  }

  function projectRoot() {
    return process.env.PROJECT_ROOT || "";
  }

  // Same safety contract as the practice data layer.
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

  // Candidate world dirs: direct profiles/, plus any accounts/<id>/profiles/.
  // First existing match wins; if none exist we still return the direct path so
  // the caller gets a deterministic "no_source".
  function worldDirCandidates(profileId, worldId) {
    safeSegment(profileId, "profileId");
    safeSegment(worldId, "worldId");
    var root = projectRoot();
    var out = [];
    out.push(path.join(root, "profiles", profileId, "worlds", worldId));
    var accountsDir = path.join(root, "accounts");
    try {
      if (fs.existsSync(accountsDir)) {
        var accs = fs.readdirSync(accountsDir);
        for (var i = 0; i < accs.length; i++) {
          if (!/^[a-zA-Z0-9_-]{1,64}$/.test(accs[i])) continue;
          out.push(path.join(accountsDir, accs[i], "profiles", profileId, "worlds", worldId));
        }
      }
    } catch (e) {}
    return out;
  }

  // Resolve a file under the world dir, trying each candidate root. Returns the
  // first existing absolute path, or null.
  function resolveWorldFile(profileId, worldId, relParts) {
    var cands = worldDirCandidates(profileId, worldId);
    for (var i = 0; i < cands.length; i++) {
      var fp = path.join.apply(path, [cands[i]].concat(relParts));
      try { if (fs.existsSync(fp)) return fp; } catch (e) {}
    }
    return null;
  }

  function resolveWorldDir(profileId, worldId) {
    var cands = worldDirCandidates(profileId, worldId);
    for (var i = 0; i < cands.length; i++) {
      try { if (fs.existsSync(cands[i])) return cands[i]; } catch (e) {}
    }
    return cands[0] || null;
  }

  function readText(fp) {
    try { return fs.readFileSync(fp, "utf-8"); } catch (e) { return null; }
  }

  function readJSON(fp) {
    var raw = readText(fp);
    if (raw == null) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  function ensureDir(dir) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  }

  function isInside(parent, child) {
    try {
      var p = path.resolve(parent);
      var c = path.resolve(child);
      return c === p || c.indexOf(p + path.sep) === 0;
    } catch (e) {
      return false;
    }
  }

  function uniquePush(list, value) {
    if (value && list.indexOf(value) < 0) list.push(value);
  }
  // ===== Textbook page text =====
  // Build a deduped list of page numbers from pageRange [start,end] / currentPage / page.
  function collectPages(body) {
    var pages = [];
    var pr = body.pageRange;
    if (Array.isArray(pr) && pr.length >= 1) {
      var start = parseInt(pr[0], 10);
      var end = pr.length >= 2 ? parseInt(pr[1], 10) : start;
      if (!isFinite(start)) start = NaN;
      if (!isFinite(end)) end = start;
      if (isFinite(start)) {
        if (!isFinite(end) || end < start) end = start;
        // Cap range width defensively.
        if (end - start > 200) end = start + 200;
        for (var p = start; p <= end; p++) if (p >= 1) pages.push(p);
      }
    }
    var single = body.currentPage != null ? body.currentPage : body.page;
    if (pages.length === 0 && single != null) {
      var s = parseInt(single, 10);
      if (isFinite(s) && s >= 1) pages.push(s);
    }
    // dedupe
    var seen = {}, out = [];
    for (var i = 0; i < pages.length; i++) { if (!seen[pages[i]]) { seen[pages[i]] = 1; out.push(pages[i]); } }
    return out;
  }

  // Candidate per-page text file names for a given page number.
  function pageFileNames(page) {
    var padded = String(page).padStart(4, "0");
    var padded3 = String(page).padStart(3, "0");
    return [
      ["pages", page + ".txt"],
      ["pages", "page_" + page + ".txt"],
      ["pages", "page_" + padded3 + ".txt"],
      ["pages", "page_" + padded + ".txt"],
      ["page_" + page + ".txt"],
      ["page_" + padded + ".txt"],
      ["pages", page + ".json"],
      ["pages", "page_" + page + ".json"]
    ];
  }

  function extractPageTextFromJson(obj) {
    if (!obj || typeof obj !== "object") return null;
    if (typeof obj.text === "string" && obj.text.trim()) return obj.text;
    if (typeof obj.content === "string" && obj.content.trim()) return obj.content;
    return null;
  }

  function textbookDir(profileId, worldId, textbookId) {
    var wdir = resolveWorldDir(profileId, worldId);
    if (!wdir) return null;
    return path.join(wdir, "textbooks", textbookId);
  }

  function textbookIndex(profileId, worldId) {
    var fp = resolveWorldFile(profileId, worldId, ["textbooks", "textbook_index.json"]);
    return fp ? readJSON(fp) : null;
  }

  function textbookIndexEntry(profileId, worldId, textbookId) {
    var idx = textbookIndex(profileId, worldId);
    var arr = idx && Array.isArray(idx.textbooks) ? idx.textbooks : [];
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] && arr[i].id === textbookId) return arr[i];
    }
    return null;
  }

  function pdfCandidateValues(entry) {
    if (!entry || typeof entry !== "object") return [];
    var keys = [
      "pdfPath", "sourcePath", "originalPath", "filePath", "path",
      "storedPath", "localPath", "filename", "name"
    ];
    var out = [];
    for (var i = 0; i < keys.length; i++) {
      var v = entry[keys[i]];
      if (typeof v === "string" && /\.pdf$/i.test(v)) out.push(v);
    }
    return out;
  }

  function findPdfUnder(dir, limit) {
    var found = [];
    function walk(current, depth) {
      if (!current || depth > 3 || found.length >= (limit || 8)) return;
      var entries;
      try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch (e) { return; }
      for (var i = 0; i < entries.length && found.length < (limit || 8); i++) {
        var full = path.join(current, entries[i].name);
        if (entries[i].isDirectory()) walk(full, depth + 1);
        else if (/\.pdf$/i.test(entries[i].name)) found.push(full);
      }
    }
    walk(dir, 0);
    return found;
  }

  function resolveTextbookPdf(profileId, worldId, textbookId) {
    var tdir = textbookDir(profileId, worldId, textbookId);
    if (!tdir || !fs.existsSync(tdir)) return null;
    var wdir = resolveWorldDir(profileId, worldId);
    var root = projectRoot();
    var entry = textbookIndexEntry(profileId, worldId, textbookId);
    var values = pdfCandidateValues(entry);
    var candidates = [];

    for (var i = 0; i < values.length; i++) {
      var v = values[i];
      if (path.isAbsolute(v)) uniquePush(candidates, v);
      else {
        uniquePush(candidates, path.join(tdir, v));
        if (wdir) uniquePush(candidates, path.join(wdir, v));
        if (root) uniquePush(candidates, path.join(root, v));
      }
    }
    findPdfUnder(tdir, 12).forEach(function (p) { uniquePush(candidates, p); });

    for (var c = 0; c < candidates.length; c++) {
      var fp = candidates[c];
      try {
        if (!fs.existsSync(fp) || !fs.statSync(fp).isFile()) continue;
        // Keep absolute paths scoped to app data when possible. This still
        // allows legacy entries copied under the textbook directory.
        if (root && !isInside(root, fp) && !isInside(tdir, fp)) continue;
        return fp;
      } catch (e) {}
    }
    return null;
  }

  function cachePdfPageText(profileId, worldId, textbookId, page, text) {
    if (!text || !text.trim()) return false;
    var tdir = textbookDir(profileId, worldId, textbookId);
    if (!tdir) return false;
    var padded = String(page).padStart(4, "0");
    var fp = path.join(tdir, "pages", "page_" + padded + ".txt");
    try {
      ensureDir(path.dirname(fp));
      fs.writeFileSync(fp, text.trim() + "\n", "utf-8");
      return true;
    } catch (e) {
      return false;
    }
  }

  function expectedCjkForTextbook(profileId, worldId, textbookId) {
    var tdir = textbookDir(profileId, worldId, textbookId);
    if (!tdir) return false;
    var index = readJSON(path.join(path.dirname(tdir), "textbook_index.json"));
    var books = index && index.textbooks;
    if (!Array.isArray(books)) return false;
    for (var i = 0; i < books.length; i++) {
      if (books[i] && String(books[i].id) === String(textbookId)) {
        return /[\u3400-\u9fff]/.test(String(books[i].title || "") + String(books[i].fileName || ""));
      }
    }
    return false;
  }

  function extractPdfPagesToCache(profileId, worldId, textbookId, pages) {
    // Compatibility shim only. PDF/OCR extraction is intentionally async so
    // no caller can accidentally block the shared Next.js process.
    return false;
  }

  function cacheExtractedPdfPages(profileId, worldId, textbookId, pages, stdout) {
    var parsed = null;
    try { parsed = JSON.parse(stdout); } catch (e) { parsed = null; }
    if (!parsed || !parsed.pages || typeof parsed.pages !== "object") return false;
    var wrote = false;
    for (var i = 0; i < pages.length; i++) {
      var p = pages[i];
      var txt = parsed.pages[String(p)];
      if (typeof txt === "string" && txt.trim()) {
        wrote = cachePdfPageText(profileId, worldId, textbookId, p, txt) || wrote;
      }
    }
    return wrote;
  }

  // Non-blocking production path. Keep the synchronous helper above for
  // compatibility with callers that only read already-cached text.
  function extractPdfPagesToCacheAsync(profileId, worldId, textbookId, pages) {
    if (!Array.isArray(pages) || !pages.length) return Promise.resolve(false);
    pages = pages.slice(0, 80);
    var pdfPath = resolveTextbookPdf(profileId, worldId, textbookId);
    if (!pdfPath) return Promise.resolve(false);
    var helper = path.join(__dirname, "pdf-page-extractor-child.mjs");
    if (!fs.existsSync(helper)) return Promise.resolve(false);
    var expectedCjk = expectedCjkForTextbook(profileId, worldId, textbookId);
    // Include the cache target: two profiles may reference the same PDF but
    // still need their own page files populated.
    var inflightKey = JSON.stringify([textbookDir(profileId, worldId, textbookId), pdfPath, pages, expectedCjk]);
    if (pdfExtractionInflight[inflightKey]) return pdfExtractionInflight[inflightKey];
    var runtime = pdfRuntimeConfig();

    var work = new Promise(function (resolve) {
      var child;
      var stdout = "";
      var stdoutBytes = 0;
      var settled = false;
      var timer = null;
      var terminating = false;
      var jobDir = null;
      try { jobDir = fs.mkdtempSync(path.join(os.tmpdir(), "socratopia-ocr-job-")); } catch (e) {}

      function cleanupJobDir() {
        if (!jobDir) return;
        try { fs.rmSync(jobDir, { recursive: true, force: true }); } catch (e) {
          setTimeout(function () { try { fs.rmSync(jobDir, { recursive: true, force: true }); } catch (e2) {} }, runtime.cleanupRetryDelayMs);
        }
      }

      function finish(value) {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        cleanupJobDir();
        resolve(value);
      }

      function terminateTree() {
        if (settled || terminating) return;
        terminating = true;
        if (process.platform === "win32" && child && child.pid) {
          var taskkill = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe");
          var killer = null;
          try { killer = childProcess.spawn(taskkill, ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); } catch (e) {}
          if (killer) {
            var fallback = setTimeout(function () { try { child.kill(); } catch (e) {} finish(false); }, runtime.terminationGraceMs);
            killer.on("error", function () { clearTimeout(fallback); try { child.kill(); } catch (e) {} finish(false); });
            killer.on("close", function () { clearTimeout(fallback); finish(false); });
            return;
          }
        }
        try { if (child) child.kill(); } catch (e) {}
        finish(false);
      }

      try {
        child = childProcess.spawn(process.execPath, [helper, pdfPath, JSON.stringify(pages), String(expectedCjk)], {
          cwd: path.join(__dirname, "..", ".."),
          env: Object.assign({}, process.env, jobDir ? { SOCRATOPIA_OCR_JOB_DIR: jobDir } : {}),
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"]
        });
      } catch (e) {
        finish(false);
        return;
      }

      if (!child || !child.stdout) {
        finish(false);
        return;
      }
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", function (chunk) {
        if (settled) return;
        stdoutBytes += Buffer.byteLength(chunk, "utf8");
        if (stdoutBytes > runtime.maxStdoutBytes) {
          terminateTree();
          return;
        }
        stdout += chunk;
      });
      // Drain stderr so a noisy child cannot block on a full pipe.
      if (child.stderr && typeof child.stderr.resume === "function") child.stderr.resume();
      child.on("error", function () { finish(false); });
      child.on("close", function (code) {
        if (terminating) return;
        if (code !== 0 || !stdout) {
          finish(false);
          return;
        }
        finish(cacheExtractedPdfPages(profileId, worldId, textbookId, pages, stdout));
      });
      timer = setTimeout(function () {
        terminateTree();
      }, runtime.timeoutMs);
    });
    pdfExtractionInflight[inflightKey] = work;
    work.then(function () { delete pdfExtractionInflight[inflightKey]; }, function () { delete pdfExtractionInflight[inflightKey]; });
    return work;
  }

  // Read a single page's text by trying the known file-name patterns.
  function readPageText(profileId, worldId, textbookId, page) {
    var names = pageFileNames(page);
    for (var i = 0; i < names.length; i++) {
      var rel = ["textbooks", textbookId].concat(names[i]);
      var fp = resolveWorldFile(profileId, worldId, rel);
      if (!fp) continue;
      if (/\.json$/.test(fp)) {
        var j = readJSON(fp);
        var t = extractPageTextFromJson(j);
        if (t && t.trim()) return t;
      } else {
        var txt = readText(fp);
        if (txt && txt.trim()) return txt;
      }
    }
    return null;
  }

  // Fallback: the recently-taught window text the chat route persists.
  function readCurrentReading(profileId, worldId, textbookId) {
    var fp = resolveWorldFile(profileId, worldId, ["textbooks", textbookId, "current_reading.md"]);
    if (!fp) return null;
    var txt = readText(fp);
    return (txt && txt.trim()) ? txt : null;
  }

  function readCachedTextbookPages(body, tid, pages, kind) {
    var collected = [];
    for (var i = 0; i < pages.length; i++) {
      var t = readPageText(body.profileId, body.worldId, tid, pages[i]);
      if (t && t.trim()) collected.push("[p." + pages[i] + "]\n" + t.trim());
    }
    return collected.length ? { text: collected.join("\n\n"), kind: kind } : null;
  }

  function missingCachedTextbookPages(body, tid, pages) {
    var missing = [];
    for (var i = 0; i < pages.length; i++) {
      var t = readPageText(body.profileId, body.worldId, tid, pages[i]);
      if (!t || !t.trim()) missing.push(pages[i]);
    }
    return missing;
  }

  // sourceType = "textbook-page"
  function resolveTextbookPage(body, options) {
    var tid = body.textbookId;
    if (!tid) return { error: "no_source", message: "textbook-page source requires textbookId (or pass sourceText)." };
    safeSegment(tid, "textbookId");

    var pages = collectPages(body);
    var cached = readCachedTextbookPages(body, tid, pages, "textbook-page:pages");
    if (cached) return cached;
    // The synchronous compatibility path is cache-only. Expensive PDF/OCR
    // extraction belongs exclusively to resolveTextbookPageAsync.
    if (!options || options.allowCurrentReading !== false) {
      var cr = readCurrentReading(body.profileId, body.worldId, tid);
      if (cr) return { text: cr, kind: "textbook-page:current_reading" };
    }

    return { error: "no_source", message: "textbook-page source requires readable page text or sourceText." };
  }

  async function resolveTextbookPageAsync(body, options) {
    var tid = body.textbookId;
    if (!tid) return { error: "no_source", message: "textbook-page source requires textbookId (or pass sourceText)." };
    safeSegment(tid, "textbookId");

    var pages = collectPages(body);
    var missingPages = missingCachedTextbookPages(body, tid, pages);
    var extracted = false;
    if (missingPages.length) {
      extracted = await extractPdfPagesToCacheAsync(body.profileId, body.worldId, tid, missingPages);
    }
    // Always re-read the complete requested range after extraction so cached
    // and newly OCRed pages retain the caller's original ordering.
    var cached = readCachedTextbookPages(body, tid, pages, extracted ? "textbook-page:pdf-extracted" : "textbook-page:pages");
    if (cached) return cached;

    if (!options || options.allowCurrentReading !== false) {
      var cr = readCurrentReading(body.profileId, body.worldId, tid);
      if (cr) return { text: cr, kind: "textbook-page:current_reading" };
    }
    return { error: "no_source", message: "textbook-page source requires readable page text or sourceText." };
  }

  // sourceType = "chapter"
  // First version: if a pageRange is given, read it like textbook-page. Else try
  // a chapter json/txt under textbooks/<tid>/chapters/. Otherwise no_source.
  function resolveChapterFile(body, tid) {
    if (tid && (body.chapterId || body.chapterTitle)) {
      safeSegment(tid, "textbookId");
      var chId = body.chapterId || body.chapterTitle;
      safeSegment(String(chId), "chapterId");
      var cands = [
        ["textbooks", tid, "chapters", chId + ".json"],
        ["textbooks", tid, "chapters", chId + ".txt"]
      ];
      for (var i = 0; i < cands.length; i++) {
        var fp = resolveWorldFile(body.profileId, body.worldId, cands[i]);
        if (!fp) continue;
        if (/\.json$/.test(fp)) {
          var j = readJSON(fp);
          var t = extractPageTextFromJson(j);
          if (!t && j && Array.isArray(j.pages)) {
            t = j.pages.map(function (pg) { return extractPageTextFromJson(pg) || ""; }).join("\n\n");
          }
          if (t && t.trim()) return { text: t, kind: "chapter:chapter-file" };
        } else {
          var txt = readText(fp);
          if (txt && txt.trim()) return { text: txt, kind: "chapter:chapter-file" };
        }
      }
    }
    return { error: "no_source", message: "chapter source requires sourceText, a pageRange, or a readable chapter file." };
  }

  function resolveChapter(body) {
    var tid = body.textbookId;
    if (Array.isArray(body.pageRange) && body.pageRange.length) {
      var byPage = resolveTextbookPage(body, { allowCurrentReading: false });
      if (!byPage.error) return { text: byPage.text, kind: "chapter:pages" };
    }
    return resolveChapterFile(body, tid);
  }

  async function resolveChapterAsync(body) {
    var tid = body.textbookId;
    if (Array.isArray(body.pageRange) && body.pageRange.length) {
      var byPage = await resolveTextbookPageAsync(body, { allowCurrentReading: false });
      if (!byPage.error) return { text: byPage.text, kind: "chapter:pages" };
    }
    return resolveChapterFile(body, tid);
  }

  // ===== Conversation: concept-summary -> lesson-summary -> recent messages =====
  function readConceptSummary(profileId, worldId, conversationId) {
    var fp = resolveWorldFile(profileId, worldId, ["concept-summaries", conversationId + ".json"]);
    if (!fp) return null;
    var cs = readJSON(fp);
    if (!cs || !Array.isArray(cs.sections)) return null;
    var parts = [];
    cs.sections.forEach(function (s) {
      if (s.content) parts.push(String(s.content));
      if (Array.isArray(s.items)) s.items.forEach(function (it) {
        if (it.name && it.body) parts.push(it.name + ": " + it.body);
        else if (it.term && it.definition) parts.push(it.term + ": " + it.definition);
        else if (it.question) parts.push(it.question + (it.answer ? " => " + it.answer : ""));
        else if (it.body) parts.push(String(it.body));
      });
    });
    return parts.length ? parts.join("\n\n") : null;
  }

  function readLessonSummary(profileId, worldId, conversationId) {
    var fp = resolveWorldFile(profileId, worldId, ["lesson_summaries", conversationId + ".md"]);
    if (!fp) return null;
    var md = readText(fp);
    if (!md || !md.trim()) return null;
    // Strip the leading "<!-- windowStart: N -->" marker if present.
    return md.replace(/^<!--\s*windowStart:\s*\d+\s*-->\s*/, "").trim() || null;
  }

  function readRecentMessages(profileId, worldId, conversationId, maxMessages) {
    var fp = resolveWorldFile(profileId, worldId, ["chats", conversationId + ".json"]);
    if (!fp) return null;
    var conv = readJSON(fp);
    if (!conv || !Array.isArray(conv.messages)) return null;
    var msgs = conv.messages.filter(function (m) {
      return m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim();
    }).slice(-(maxMessages || 20));
    if (!msgs.length) return null;
    return msgs.map(function (m) {
      return (m.role === "user" ? "学生: " : "老师: ") + m.content.trim();
    }).join("\n\n");
  }

  // sourceType = "conversation"
  function resolveConversation(body) {
    var cid = body.conversationId;
    if (!cid) return { error: "no_source", message: "conversation source requires conversationId (or pass sourceText)." };
    safeSegment(cid, "conversationId");
    var cs = readConceptSummary(body.profileId, body.worldId, cid);
    if (cs) return { text: cs, kind: "conversation:concept-summary" };
    var ls = readLessonSummary(body.profileId, body.worldId, cid);
    if (ls) return { text: ls, kind: "conversation:lesson-summary" };
    var rm = readRecentMessages(body.profileId, body.worldId, cid, body.maxMessages || 20);
    if (rm) return { text: rm, kind: "conversation:recent-messages" };
    return { error: "no_source", message: "conversation source has no concept-summary, lesson-summary, or readable chat history." };
  }

  // ===== Top-level dispatch =====
  // Returns { text, kind } on success, or { error:"no_source", message } on miss.
  function resolveSourceText(body) {
    body = body || {};
    if (!body.profileId || !body.worldId) {
      return { error: "no_source", message: "profileId and worldId are required to resolve a source." };
    }
    // 1. Explicit sourceText always wins, regardless of sourceType.
    if (body.sourceText && typeof body.sourceText === "string" && body.sourceText.trim()) {
      var st = body.sourceType || "manual";
      return { text: body.sourceText.trim(), kind: st + ":provided-sourceText" };
    }
    var type = body.sourceType || "manual";
    try {
      if (type === "manual") {
        return { error: "no_source", message: "manual source requires sourceText." };
      }
      if (type === "textbook-page") return resolveTextbookPage(body);
      if (type === "chapter") return resolveChapter(body);
      if (type === "conversation") return resolveConversation(body);
      return { error: "no_source", message: "Unknown sourceType '" + type + "'. Provide sourceText." };
    } catch (e) {
      return { error: "no_source", message: "Source resolution failed: " + (e && e.message) };
    }
  }

  async function resolveSourceTextAsync(body) {
    body = body || {};
    if (!body.profileId || !body.worldId) {
      return { error: "no_source", message: "profileId and worldId are required to resolve a source." };
    }
    if (body.sourceText && typeof body.sourceText === "string" && body.sourceText.trim()) {
      var st = body.sourceType || "manual";
      return { text: body.sourceText.trim(), kind: st + ":provided-sourceText" };
    }
    var type = body.sourceType || "manual";
    try {
      if (type === "manual") return { error: "no_source", message: "manual source requires sourceText." };
      if (type === "textbook-page") return await resolveTextbookPageAsync(body);
      if (type === "chapter") return await resolveChapterAsync(body);
      if (type === "conversation") return resolveConversation(body);
      return { error: "no_source", message: "Unknown sourceType '" + type + "'. Provide sourceText." };
    } catch (e) {
      return { error: "no_source", message: "Source resolution failed: " + (e && e.message) };
    }
  }

  // ===== Optional ConceptGraph context (never throws, never required) =====
  // Returns a compact string summary of related concepts, or "" when unavailable.
  function conceptGraphContext(body, maxConcepts) {
    try {
      var A = global.__ADAPTIVE__;
      if (!A || typeof A.getConceptGraph !== "function") return "";
      if (!body || !body.profileId || !body.worldId || !body.textbookId) return "";
      var g = A.getConceptGraph(body.profileId, body.worldId, body.textbookId);
      if (!g || !Array.isArray(g.concepts) || !g.concepts.length) return "";
      var lim = maxConcepts || 8;
      var lines = [];
      for (var i = 0; i < g.concepts.length && lines.length < lim; i++) {
        var c = g.concepts[i];
        if (!c) continue;
        var parts = [];
        if (c.title) parts.push(c.title);
        if (c.description) parts.push(String(c.description).slice(0, 200));
        if (Array.isArray(c.masteryCriteria) && c.masteryCriteria.length) parts.push("掌握标准: " + c.masteryCriteria.join("; "));
        if (Array.isArray(c.commonMisconceptions) && c.commonMisconceptions.length) parts.push("常见误区: " + c.commonMisconceptions.join("; "));
        if (parts.length) lines.push("- " + parts.join(" | "));
      }
      return lines.length ? lines.join("\n") : "";
    } catch (e) {
      return "";
    }
  }

  var api = {
    resolveSourceText: resolveSourceText,
    resolveSourceTextAsync: resolveSourceTextAsync,
    conceptGraphContext: conceptGraphContext,
    // internals exposed for tests
    collectPages: collectPages,
    pageFileNames: pageFileNames,
    readPageText: readPageText,
    resolveTextbookPdf: resolveTextbookPdf,
    extractPdfPagesToCache: extractPdfPagesToCache,
    extractPdfPagesToCacheAsync: extractPdfPagesToCacheAsync,
    worldDirCandidates: worldDirCandidates,
    safeSegment: safeSegment,
    _pdfRuntimeConfig: pdfRuntimeConfig,
    _resolveTextbookPage: resolveTextbookPage,
    _resolveTextbookPageAsync: resolveTextbookPageAsync,
    _resolveChapter: resolveChapter,
    _resolveChapterAsync: resolveChapterAsync,
    _resolveConversation: resolveConversation
  };

  global.__PRACTICE_SOURCE__ = api;
  module.exports = api;
})();
