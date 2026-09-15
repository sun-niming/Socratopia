"use strict";

// PN-006 — post-class notes job state machine.
//
// Short lessons go straight through in one structured call.  Long lessons are
// sliced on turn boundaries, each slice is extracted to evidence and
// checkpointed, then a single reduce call merges the evidence into the final
// note.  Every failure is a coded error, and every stage is resumable.
//
// The orchestrator owns the §6.2 retry matrix; `provider.js` performs exactly
// one call.  That keeps retry accounting in one place.
//
// Plan: POST_CLASS_NOTES_QUALITY_RELIABILITY_DEVELOPMENT_PLAN.md §3, §4.4, §6, §9.

var crypto = require("crypto");
var errors = require("./errors.js");
var partitioner = require("./partitioner.js");
var prompts = require("./prompts.js");
var quality = require("./quality.js");
var schema = require("./schema.js");

var PIPELINE_VERSION = "post-class-v2";

var STATUS = {
  created: "created",
  running: "running",
  ready: "ready",
  degraded: "degraded",
  failed: "failed",
  cancelled: "cancelled"
};

var TERMINAL = { ready: true, degraded: true, failed: true, cancelled: true };

var DEFAULT_LIMITS = {
  softBudgetMs: 300000,
  hardBudgetMs: 480000,
  maxConcurrentChunks: 2,
  maxCallsPerJob: 40,
  minSubstantiveUserTurns: 6,
  directTimeoutMs: 120000,
  mapTimeoutMs: 90000,
  reduceTimeoutMs: 150000,
  repairTimeoutMs: 60000,
  directMaxTokens: 4096,
  mapMaxTokens: 4096,
  reduceMaxTokens: 4096,
  repairMaxTokens: 4096,
  tokenScaleOnShorten: 0.7
};

var PLACEHOLDER = {
  chinese: function (companion) { return "本次对话过短，学习者未充分参与。主要是 " + companion + " 抛出了话题后即下课。"; },
  "chinese-traditional": function (companion) { return "本次對話過短，學習者未充分參與。主要是 " + companion + " 拋出了話題後即下課。"; },
  english: function (companion) { return "This session was brief — the learner didn't engage substantially. Mainly " + companion + " introduced the topic and the session ended."; }
};

var SHRINK_HINT = {
  chinese: "\n\n比上一次更简短：覆盖同样的要点，但少写铺垫。",
  "chinese-traditional": "\n\n比上一次更簡短：覆蓋同樣的重點，但少寫鋪墊。",
  english: "\n\nShorter than last time: cover the same points with less prose."
};

function normalizeLanguage(value) {
  var text = String(value || "").trim().toLowerCase();
  if (text === "english" || text === "en") return "english";
  if (text === "chinese-traditional" || text === "zh-tw" || text === "traditional") return "chinese-traditional";
  return "chinese";
}

function newId(prefix) {
  return prefix + Date.now().toString(36) + crypto.randomBytes(6).toString("hex");
}

function truncate(value, limit) {
  var text = String(value == null ? "" : value);
  return text.length > (limit || 200) ? text.slice(0, limit || 200) : text;
}

function createOrchestrator(deps) {
  var store = deps.store;
  if (!store) throw errors.codedError(errors.CODES.missing_dependency, "checkpoint store is required");
  var now = deps.now || function () { return Date.now(); };
  var sleep = deps.sleep || function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); };
  var limits = Object.assign({}, DEFAULT_LIMITS, deps.limits || {});
  var pipelineVersion = deps.pipelineVersion || PIPELINE_VERSION;
  var sink = deps.log || function (line) { console.log(line); };

  var runtimes = new Map();
  var jobsById = new Map();

  function log(job, stage, event, extra) {
    var parts = ["[post-class-notes]", "[trace=" + job.traceId + "]", "[job=" + job.jobId + "]"];
    parts.push("stage=" + (stage || job.stage));
    parts.push("event=" + event);
    var keys = Object.keys(extra || {});
    for (var i = 0; i < keys.length; i++) parts.push(keys[i] + "=" + extra[keys[i]]);
    sink(parts.join(" "));
  }

  // §9.2: traces carry counters, statuses and timings — never classroom text,
  // never reasoning, never credentials.
  function trace(job, entry) {
    var line = Object.assign({
      at: new Date(now()).toISOString(),
      traceId: job.traceId,
      jobId: job.jobId,
      conversationHash: job.conversationHash,
      pipelineVersion: pipelineVersion,
      stage: job.stage,
      attempt: 1,
      outcome: "ok"
    }, entry || {});
    return store.appendTrace(job.conversationId, job.jobId, line).catch(function () {});
  }

  function conversationHashOf(conversationId) {
    return "sha256:" + crypto.createHash("sha256").update(String(conversationId)).digest("hex").slice(0, 16);
  }

  function sourceHashOf(normalized, extra) {
    var hash = crypto.createHash("sha256");
    hash.update(pipelineVersion);
    hash.update("|" + (extra.language || ""));
    hash.update("|" + (extra.companionName || ""));
    hash.update("|" + (extra.textbookTitle || ""));
    normalized.forEach(function (message) {
      hash.update("|" + message.role + ":" + message.content);
    });
    return "sha256:" + hash.digest("hex");
  }

  function idempotencyKeyOf(scope, sourceHash) {
    return [scope.accountId || "local", scope.profileId || "", scope.worldId || "", scope.conversationId || "", sourceHash, pipelineVersion].join("|");
  }

  function view(job, extra) {
    return Object.assign({
      jobId: job.jobId,
      traceId: job.traceId,
      status: job.status,
      stage: job.stage,
      mode: job.mode,
      completedChunks: job.completedChunks || 0,
      totalChunks: job.totalChunks || 0,
      progress: progressFor(job),
      degraded: job.status === STATUS.degraded,
      error: job.error || null
    }, extra || {});
  }

  function progressFor(job) {
    if (job.status === STATUS.ready || job.status === STATUS.degraded) return 1;
    if (job.status === STATUS.failed || job.status === STATUS.cancelled) return Number(job.progress) || 0;
    var ratio = job.totalChunks ? job.completedChunks / job.totalChunks : 0;
    switch (job.stage) {
      case "created":
      case "partitioning": return 0.02;
      case "mapping": return job.mode === "short" ? 0.2 : 0.05 + 0.65 * ratio;
      case "reducing": return 0.78;
      case "validating": return 0.88;
      case "persisting": return 0.96;
      default: return 0.5;
    }
  }

  function requireScope(input) {
    var scope = {
      accountId: input.accountId || "local",
      profileId: input.profileId || "",
      worldId: input.worldId || "",
      conversationId: input.conversationId || ""
    };
    if (!scope.conversationId) throw errors.codedError(errors.CODES.upstream_bad_request, "conversationId is required");
    return scope;
  }

  // ---- job records -------------------------------------------------------

  // Every run takes ownership of the job by rotating `runToken`. A run that has
  // been superseded (retry, or a second start on the same lesson) must not write
  // its terminal state over the newer run's — including in memory, because the
  // job object is shared and the API reads it directly.
  function superseded(job, ctx) {
    return !!(ctx && ctx.token && ctx.token !== job.runToken);
  }

  function takeOwnership(job) {
    job.runToken = {};
    return job.runToken;
  }

  // A run can still be winding down after it has already published a terminal
  // status. Treating that as "in flight" would swallow an immediate retry, so
  // only a non-terminal job counts as actively running.
  function isActivelyRunning(job) {
    return runtimes.has(job.jobId) && !TERMINAL[job.status];
  }

  function persistJob(job, ctx) {
    if (superseded(job, ctx)) return Promise.resolve();
    job.updatedAt = now();
    job.progress = progressFor(job);
    return store.writeJob(job.conversationId, job.jobId, job);
  }

  async function updateStage(job, status, stage, ctx) {
    if (superseded(job, ctx)) return job;
    job.status = status;
    job.stage = stage;
    await persistJob(job, ctx);
    return job;
  }

  // ---- model calls -------------------------------------------------------

  function buildContext(job, runtime) {
    var startedAt = now();
    var hardBudget = Number(limits.hardBudgetMs) > 0 ? Number(limits.hardBudgetMs) : DEFAULT_LIMITS.hardBudgetMs;
    return {
      runtime: runtime,
      token: runtime.token,
      callModel: runtime.callModel,
      controller: runtime.controller,
      startedAt: startedAt,
      deadlineSoft: startedAt + limits.softBudgetMs,
      deadlineHard: startedAt + hardBudget,
      limits: limits,
      trace: function (entry) { return trace(job, entry); }
    };
  }

  function ensureNotCancelled(ctx) {
    if (ctx.controller.signal.aborted) throw errors.codedError(errors.CODES.cancelled, "job cancelled");
  }

  function ensureBudget(job, ctx) {
    ensureNotCancelled(ctx);
    if (now() > ctx.deadlineHard) throw errors.codedError(errors.CODES.budget_exceeded, "hard job budget reached");
    if (job.modelCalls >= limits.maxCallsPerJob) throw errors.codedError(errors.CODES.budget_exceeded, "model call budget reached");
  }

  function canRetry(ctx, error, attempt) {
    if (ctx.controller.signal.aborted) return false;
    if (now() > ctx.deadlineSoft) return false;
    var plan = errors.retryPlan(error);
    return plan.retry && attempt < plan.attempts;
  }

  async function backoff(ctx, error) {
    var plan = errors.retryPlan(error);
    if (!plan.delayMs) return;
    await sleep(plan.delayMs);
  }

  function tryReasoningJson(reasoning) {
    var text = String(reasoning || "").trim();
    if (!text) return null;
    var parsed = schema.parseJsonLoose(text);
    if (!parsed.ok) return null;
    // §6.1 step 8: reasoning is only accepted when it is itself a complete,
    // schema-shaped object.
    if (!parsed.value || typeof parsed.value !== "object" || parsed.truncated) return null;
    return parsed;
  }

  // Performs one logical JSON request, applying the §6.2 retry matrix.
  // Transport, empty-content and truncation retries happen here; a *parse*
  // failure is surfaced to the caller, which owns the one targeted repair.
  async function requestJson(job, ctx, request) {
    var attempt = 0;
    var scale = 1;
    var extraInstruction = "";

    for (;;) {
      ensureBudget(job, ctx);
      var callRequest = {
        stage: request.stage,
        purpose: request.purpose || "summary",
        systemPrompt: request.systemPrompt,
        userContent: request.userContent + extraInstruction,
        maxTokens: Math.max(512, Math.floor(request.maxTokens * scale)),
        responseFormat: "json_object",
        thinking: false,
        timeoutMs: request.timeoutMs,
        deadlineAt: Math.min(request.deadlineAt || ctx.deadlineHard, ctx.deadlineHard),
        signal: ctx.controller.signal
      };
      job.modelCalls += 1;
      var startedAt = now();
      await trace(job, { stage: request.stage, event: "provider_request", attempt: attempt + 1, maxTokens: callRequest.maxTokens, maxTokensScale: Number(scale.toFixed(2)) });

      var result;
      try {
        result = await ctx.callModel(callRequest);
      } catch (error) {
        var coded = errors.isCodedError(error) ? error : errors.classifyNetwork(error);
        await trace(job, { stage: request.stage, event: "provider_error", attempt: attempt + 1, elapsedMs: now() - startedAt, outcome: coded.code, httpStatus: coded.httpStatus || 0 });
        if (canRetry(ctx, coded, attempt)) { attempt += 1; await backoff(ctx, coded); continue; }
        throw coded;
      }

      await trace(job, {
        stage: request.stage,
        event: "provider_response",
        attempt: attempt + 1,
        elapsedMs: result.elapsedMs || (now() - startedAt),
        httpStatus: result.httpStatus || 0,
        contentType: result.contentType || "",
        promptTokens: result.promptTokens || 0,
        completionTokens: result.completionTokens || 0,
        contentChars: String(result.content || "").length,
        finishReason: result.finishReason || "",
        outcome: "ok"
      });

      var text = String(result.content || "").trim();
      if (!text) {
        var recovered = tryReasoningJson(result.reasoning);
        if (recovered) {
          await trace(job, { stage: request.stage, event: "reasoning_recovered", attempt: attempt + 1, contentChars: String(result.reasoning || "").length });
          return { ok: true, value: recovered.value, raw: "", meta: { attempts: attempt + 1, recoveredFromReasoning: true, elapsedMs: result.elapsedMs || 0 } };
        }
        var emptyError = errors.codedError(errors.CODES.upstream_empty_content, "model returned empty content", { httpStatus: result.httpStatus || 0 });
        await trace(job, { stage: request.stage, event: "empty_content", attempt: attempt + 1, outcome: emptyError.code });
        if (canRetry(ctx, emptyError, attempt)) { attempt += 1; scale = limits.tokenScaleOnShorten; extraInstruction = SHRINK_HINT[job.language] || SHRINK_HINT.chinese; await backoff(ctx, emptyError); continue; }
        throw emptyError;
      }

      var parsed = schema.parseJsonLoose(text);
      if (!parsed.ok) {
        // Not thrown: the caller owns the single targeted repair (§6.2), which
        // needs the bad output to send back to the model.
        await trace(job, { stage: request.stage, event: "schema_invalid", attempt: attempt + 1, rawChars: text.length, outcome: errors.CODES.schema_invalid });
        return { ok: false, reason: errors.CODES.schema_invalid, raw: text, meta: { attempts: attempt + 1, elapsedMs: result.elapsedMs || 0 } };
      }
      if (parsed.truncated) {
        var truncatedError = errors.codedError(errors.CODES.output_truncated, "model output was cut short", { rawChars: text.length });
        await trace(job, { stage: request.stage, event: "output_truncated", attempt: attempt + 1, rawChars: text.length, outcome: truncatedError.code });
        if (canRetry(ctx, truncatedError, attempt)) { attempt += 1; scale = limits.tokenScaleOnShorten; extraInstruction = SHRINK_HINT[job.language] || SHRINK_HINT.chinese; await backoff(ctx, truncatedError); continue; }
        return { ok: false, reason: errors.CODES.output_truncated, raw: text, meta: { attempts: attempt + 1, elapsedMs: result.elapsedMs || 0 } };
      }
      return { ok: true, value: parsed.value, raw: text, meta: { attempts: attempt + 1, recoveredFromReasoning: false, elapsedMs: result.elapsedMs || 0 } };
    }
  }

  async function runPool(items, limit, worker) {
    var index = 0;
    var size = Math.max(1, Math.min(limit, items.length));
    var workers = [];
    for (var i = 0; i < size; i++) {
      workers.push((async function () {
        for (;;) {
          var at = index;
          index += 1;
          if (at >= items.length) return;
          await worker(items[at], at);
        }
      })());
    }
    await Promise.all(workers);
  }

  // ---- stages ------------------------------------------------------------

  async function runDirect(job, ctx, normalized) {
    await updateStage(job, STATUS.running, "mapping", ctx);
    var target = partitioner.visibleTargetRange(normalized.length, job.language);
    var transcript = partitioner.formatTranscript(normalized, {
      learnerLabel: job.language === "english" ? "Learner" : "学习者",
      companionLabel: job.companionName || (job.language === "english" ? "Companion" : "伙伴")
    });
    var request = {
      stage: "direct",
      systemPrompt: prompts.systemFor("direct", job.language),
      userContent: prompts.directUserContent({ language: job.language, companionName: job.companionName, textbookTitle: job.textbookTitle, targetRange: target, transcript: transcript }),
      maxTokens: limits.directMaxTokens,
      timeoutMs: limits.directTimeoutMs
    };

    var attempt = await requestJson(job, ctx, request);
    job.completedChunks = 1;
    await trace(job, { stage: "mapping", event: "direct_completed", outcome: "ok" });
    return finalizeNote(job, ctx, attempt, [], target, { allowDegrade: false });
  }

  async function runChunked(job, ctx, normalized, chunks) {
    await updateStage(job, STATUS.running, "mapping", ctx);
    // Recounted from scratch so a resumed job does not double-count the slices
    // it restored from disk.
    job.completedChunks = 0;
    var failures = [];

    await runPool(chunks, limits.maxConcurrentChunks, async function (chunk) {
      if (job.status === STATUS.cancelled) return;
      var existing = await store.readChunk(job.conversationId, job.jobId, chunk.chunkId);
      if (existing) {
        job.completedChunks += 1;
        await trace(job, { stage: "mapping", event: "chunk_restored", chunk: chunk.position, totalChunks: chunks.length, outcome: "ok" });
        return;
      }
      await trace(job, { stage: "mapping", event: "chunk_started", chunk: chunk.position, totalChunks: chunks.length });
      var startedAt = now();
      try {
        var request = {
          stage: "map",
          systemPrompt: prompts.systemFor("map", job.language),
          userContent: prompts.mapUserContent({
            language: job.language,
            chunkId: chunk.chunkId,
            companionName: job.companionName,
            textbookTitle: job.textbookTitle,
            transcript: partitioner.formatTranscript(chunk.messages, {
              learnerLabel: job.language === "english" ? "Learner" : "学习者",
              companionLabel: job.companionName || (job.language === "english" ? "Companion" : "伙伴")
            })
          }),
          maxTokens: limits.mapMaxTokens,
          timeoutMs: limits.mapTimeoutMs
        };
        var result = await requestJson(job, ctx, request);
        // A slice has no repair of its own: an unusable slice is a failed
        // slice, and the job degrades from the slices that did land.
        if (!result.ok) throw errors.codedError(result.reason || errors.CODES.schema_invalid, "slice evidence was unusable");
        var evidence = schema.normalizeChunkEvidence(result.value, chunk);
        await store.writeChunk(job.conversationId, job.jobId, chunk.chunkId, evidence);
        job.completedChunks += 1;
        await persistJob(job, ctx);
        await trace(job, {
          stage: "mapping",
          event: "chunk_completed",
          chunk: chunk.position,
          totalChunks: chunks.length,
          elapsedMs: now() - startedAt,
          topics: evidence.topics.length,
          outcome: "ok"
        });
      } catch (error) {
        var coded = errors.isCodedError(error) ? error : errors.classifyNetwork(error);
        if (coded.code === errors.CODES.cancelled) throw coded;
        failures.push({ chunkId: chunk.chunkId, code: coded.code });
        await trace(job, { stage: "mapping", event: "chunk_failed", chunk: chunk.position, totalChunks: chunks.length, elapsedMs: now() - startedAt, outcome: coded.code });
      }
    });

    ensureNotCancelled(ctx);
    var evidence = await store.listChunks(job.conversationId, job.jobId);
    if (!evidence.length) {
      var firstFailure = failures[0] || { code: errors.CODES.internal_error };
      throw errors.codedError(firstFailure.code, "no slice could be extracted");
    }
    if (failures.length) {
      job.degradedReason = "chunk_failures";
      job.chunkFailures = failures;
      await trace(job, { stage: "mapping", event: "chunk_failures_settled", failedChunks: failures.length, completedChunks: evidence.length, outcome: "degraded" });
      await degradeAndPersist(job, ctx, evidence, errors.CODES.quality_rejected, failures);
      return;
    }

    var target = partitioner.visibleTargetRange(normalized.length, job.language);
    await updateStage(job, STATUS.running, "reducing", ctx);
    await trace(job, { stage: "reducing", event: "reduce_started", chunkCount: evidence.length });
    var request = {
      stage: "reduce",
      systemPrompt: prompts.systemFor("reduce", job.language),
      userContent: prompts.reduceUserContent({
        language: job.language,
        companionName: job.companionName,
        textbookTitle: job.textbookTitle,
        targetRange: target,
        chunkCount: evidence.length,
        evidence: evidence
      }),
      maxTokens: limits.reduceMaxTokens,
      timeoutMs: limits.reduceTimeoutMs
    };
    var attempt = await requestJson(job, ctx, request);
    await trace(job, { stage: "reducing", event: "reduce_completed", outcome: "ok" });
    return finalizeNote(job, ctx, attempt, evidence, target, { allowDegrade: true });
  }

  // Shared tail: validate -> repair -> score -> re-merge -> persist/degrade.
  // `attempt` may already be a parse failure; that is precisely the case the
  // one targeted repair exists for.
  async function finalizeNote(job, ctx, attempt, evidence, target, options) {
    var opts = options || {};
    var allowDegrade = !!opts.allowDegrade;
    var normalized = attempt.ok ? schema.normalizeSummary(attempt.value) : { summary: { sections: [] }, warnings: [] };
    var currentRaw = attempt.raw;
    var check = attempt.ok ? schema.validateSummary(normalized.summary) : { ok: false, errors: [attempt.reason || errors.CODES.schema_invalid] };
    var warnings = normalized.warnings.slice();

    await updateStage(job, STATUS.running, "validating", ctx);

    if (!check.ok) {
      await trace(job, { stage: "validating", event: "schema_rejected", problems: check.errors.length, outcome: errors.CODES.schema_invalid });
      var repaired = await repairOnce(job, ctx, evidence, currentRaw, target);
      if (repaired) {
        normalized = schema.normalizeSummary(repaired.value);
        check = schema.validateSummary(normalized.summary);
        warnings = warnings.concat(normalized.warnings);
      }
    }

    if (!check.ok) {
      await trace(job, { stage: "validating", event: "schema_unrecoverable", outcome: errors.CODES.schema_invalid });
      if (allowDegrade && evidence.length) return degradeAndPersist(job, ctx, evidence, errors.CODES.schema_invalid);
      throw errors.codedError(errors.CODES.schema_invalid, "note did not survive schema validation");
    }

    var scored = quality.score({ summary: normalized.summary, evidence: evidence, sourceMessageCount: job.sourceMessageCount, language: job.language, targetRange: target });
    await trace(job, {
      stage: "validating",
      event: "quality_decision",
      score: scored.score,
      decision: scored.decision,
      topicCoverage: Number(scored.metrics.topicCoverage.toFixed(3)),
      sourceIntegrity: Number(scored.metrics.sourceIntegrity.toFixed(3)),
      duplicationRatio: Number(scored.metrics.duplicationRatio.toFixed(3)),
      lengthChars: scored.metrics.lengthChars,
      outcome: scored.decision
    });
    log(job, "validating", "quality_decision", { score: scored.score, decision: scored.decision, warnings: scored.warnings.length });

    if (scored.decision === "repair") {
      var repaired2 = await repairOnce(job, ctx, evidence, currentRaw, target);
      if (repaired2) {
        var normalized2 = schema.normalizeSummary(repaired2.value);
        var check2 = schema.validateSummary(normalized2.summary);
        var scored2 = quality.score({ summary: normalized2.summary, evidence: evidence, sourceMessageCount: job.sourceMessageCount, language: job.language, targetRange: target });
        if (check2.ok && scored2.score >= scored.score) {
          normalized = normalized2;
          currentRaw = repaired2.raw;
          warnings = warnings.concat(normalized2.warnings);
          scored = scored2;
        }
      }
    }

    // §7.3: below the re-merge floor the note is rebuilt once from evidence.
    if (scored.decision === "remerge" && allowDegrade && evidence.length) {
      await trace(job, { stage: "validating", event: "remerge_started", score: scored.score });
      var retryAttempt = await requestJson(job, ctx, {
        stage: "reduce",
        systemPrompt: prompts.systemFor("reduce", job.language),
        userContent: prompts.reduceUserContent({
          language: job.language,
          companionName: job.companionName,
          textbookTitle: job.textbookTitle,
          targetRange: target,
          chunkCount: evidence.length,
          evidence: evidence
        }),
        maxTokens: limits.reduceMaxTokens,
        timeoutMs: limits.reduceTimeoutMs
      }).catch(function (error) {
        trace(job, { stage: "reducing", event: "reduce_failed", outcome: error && error.code || "error" });
        return null;
      });
      if (retryAttempt && retryAttempt.ok) {
        var normalized3 = schema.normalizeSummary(retryAttempt.value);
        if (schema.validateSummary(normalized3.summary).ok) {
          var scored3 = quality.score({ summary: normalized3.summary, evidence: evidence, sourceMessageCount: job.sourceMessageCount, language: job.language, targetRange: target });
          if (scored3.score > scored.score) {
            normalized = normalized3;
            warnings = warnings.concat(normalized3.warnings);
            scored = scored3;
          }
        }
      }
      if (scored.decision === "remerge") return degradeAndPersist(job, ctx, evidence, errors.CODES.quality_rejected);
    }

    await updateStage(job, STATUS.running, "persisting", ctx);
    await persistNote(job, normalized.summary, scored, evidence, warnings, STATUS.ready, ctx);
    return view(job);
  }

  // §7.3 allows *one* targeted repair per job, whether it is triggered by a
  // schema failure or by a low quality score — not one each.
  async function repairOnce(job, ctx, evidence, raw, target) {
    if ((job.repairs || 0) >= 1) {
      await trace(job, { stage: "validating", event: "repair_skipped", outcome: "budget" });
      return null;
    }
    job.repairs = (job.repairs || 0) + 1;
    await trace(job, { stage: "validating", event: "repair_started", outcome: "repair" });
    var request = {
      stage: "repair",
      systemPrompt: prompts.systemFor("repair", job.language),
      userContent: prompts.repairUserContent({ evidence: evidence, raw: raw }),
      maxTokens: limits.repairMaxTokens,
      timeoutMs: limits.repairTimeoutMs
    };
    try {
      // §6.3 gives the repair step no retry of its own.
      var result = await requestJson(job, ctx, request);
      if (!result.ok) {
        await trace(job, { stage: "validating", event: "repair_failed", outcome: result.reason || "error" });
        return null;
      }
      await trace(job, { stage: "validating", event: "repair_completed", outcome: "ok" });
      return result;
    } catch (error) {
      await trace(job, { stage: "validating", event: "repair_failed", outcome: error && error.code || "error" });
      return null;
    }
  }

  // §9.3 quality.json + §7.4 generationMeta.  The full evidence stays in the
  // job directory; the shipped note keeps a compact index of it so the file a
  // learner syncs stays close to the size of the note itself.
  function buildGenerationMeta(job, scored, evidence, warnings, decisionOverride) {
    var topics = [];
    (evidence || []).forEach(function (chunk) {
      (chunk.topics || []).forEach(function (topic) {
        topics.push({ name: topic.name, sourceMessageIndexes: topic.sourceMessageIndexes || [] });
      });
    });
    return {
      pipelineVersion: pipelineVersion,
      mode: job.mode,
      jobId: job.jobId,
      traceId: job.traceId,
      sourceHash: job.sourceHash,
      sourceMessageCount: job.sourceMessageCount,
      chunkCount: (evidence || []).length,
      generatedAt: now(),
      decision: decisionOverride || (scored ? scored.decision : "degraded"),
      quality: scored ? { score: scored.score, metrics: scored.metrics } : null,
      warnings: (warnings || []).slice(0, 20),
      evidenceIndex: topics.slice(0, 40),
      degradedReason: job.degradedReason || null
    };
  }

  async function persistNote(job, summary, scored, evidence, warnings, terminalStatus, ctx) {
    if (superseded(job, ctx)) return view(job);
    await persistJob(job, ctx);
    await trace(job, { stage: "persisting", event: "persist_started", outcome: "ok" });
    var finalSummary = {
      conversationId: job.conversationId,
      generatedAt: now(),
      pagesRange: summary.pagesRange === undefined ? null : summary.pagesRange,
      sections: summary.sections,
      generationMeta: buildGenerationMeta(job, scored, evidence, warnings, terminalStatus === STATUS.degraded ? "degraded" : null)
    };
    await store.writeFinal(job.conversationId, finalSummary);
    if (scored) await store.writeQuality(job.conversationId, job.jobId, {
      schemaVersion: 1,
      pipelineVersion: pipelineVersion,
      sourceHash: job.sourceHash,
      sourceMessageCount: job.sourceMessageCount,
      chunkCount: (evidence || []).length,
      score: scored.score,
      metrics: scored.metrics,
      warnings: scored.warnings,
      decision: terminalStatus === STATUS.degraded ? "degraded" : scored.decision
    });

    // The terminal status is published last, on purpose: a caller that observes
    // `ready` must be able to rely on the note being written and the trace being
    // complete. Publishing first makes both racy.
    var finalStage = terminalStatus === STATUS.degraded ? "degraded" : "ready";
    await trace(job, {
      stage: "persisting",
      event: "persist_completed",
      status: terminalStatus,
      sections: finalSummary.sections.length,
      outcome: "ok"
    });
    await trace(job, { stage: finalStage, event: terminalStatus === STATUS.degraded ? "job_degraded" : "job_completed", outcome: "ok" });
    log(job, finalStage, terminalStatus === STATUS.degraded ? "job_degraded" : "job_completed", { score: scored ? scored.score : "-" });

    job.status = terminalStatus;
    job.stage = finalStage;
    job.quality = scored ? { score: scored.score } : null;
    // The note itself is not duplicated into job.json — the job file stays a
    // state record, and the note has exactly one home.
    await persistJob(job, ctx);
    return view(job, { summary: finalSummary });
  }

  // §3.5: everything else failed, but the slices are intact — assemble.
  async function degradeAndPersist(job, ctx, evidence, code, failures) {
    if (superseded(job, ctx)) return view(job);
    await updateStage(job, STATUS.running, "validating", ctx);
    var assembled = quality.assembleDegraded({ evidence: evidence, language: job.language });
    var normalized = schema.normalizeSummary(assembled);
    if (!schema.validateSummary(normalized.summary).ok) {
      job.status = STATUS.failed;
      job.stage = "failed";
      job.error = { code: errors.CODES.quality_rejected, detail: "deterministic assembly produced nothing renderable" };
      await persistJob(job, ctx);
      await trace(job, { stage: "failed", event: "job_failed", outcome: errors.CODES.quality_rejected });
      return view(job);
    }
    var scored = quality.score({
      summary: normalized.summary,
      evidence: evidence,
      sourceMessageCount: job.sourceMessageCount,
      language: job.language
    });
    job.degradedReason = job.degradedReason || (failures && failures.length ? "chunk_failures" : code);
    job.chunkFailures = failures || job.chunkFailures || [];
    await trace(job, {
      stage: "validating",
      event: "quality_decision",
      score: scored.score,
      decision: "degraded",
      reason: job.degradedReason,
      outcome: "degraded"
    });
    await updateStage(job, STATUS.running, "persisting", ctx);
    await persistNote(job, normalized.summary, scored, evidence, normalized.warnings, STATUS.degraded, ctx);
    return view(job);
  }

  function buildPlaceholder(job) {
    var text = (PLACEHOLDER[job.language] || PLACEHOLDER.chinese)(job.companionName || "伙伴");
    return {
      conversationId: job.conversationId,
      generatedAt: now(),
      pagesRange: null,
      sections: [{ type: "tldr", content: text }],
      generationMeta: buildGenerationMeta(job, null, [], ["short conversation placeholder"], "placeholder")
    };
  }

  // ---- public API --------------------------------------------------------

  async function start(input) {
    var scope = requireScope(input || {});
    if (typeof input.callModel !== "function") throw errors.codedError(errors.CODES.missing_dependency, "callModel is required");

    var language = normalizeLanguage(input.language);
    var normalized = partitioner.normalizeMessages(input.messages || []);
    var route = partitioner.routeFor(normalized);
    var meta = { language: language, companionName: input.companionName || "", textbookTitle: input.textbookTitle || "" };
    var sourceHash = input.sourceHash || sourceHashOf(normalized, meta);
    var idempotencyKey = idempotencyKeyOf(scope, sourceHash);

    // §5.3 idempotency: reuse a finished job, join a running one, resume a
    // partial one, and only start fresh when the pipeline version changed.
    var existingJobs = await store.listJobs(scope.conversationId);
    var adopted = null;
    for (var i = 0; i < existingJobs.length; i++) {
      var candidate = existingJobs[i];
      if (candidate.idempotencyKey !== idempotencyKey) continue;
      // Resolve the live object first: the on-disk record lags the in-memory
      // state by design, and deciding from the stale copy would restart work
      // that has already finished.
      var live = jobsById.get(candidate.jobId) || candidate;
      if (live.status === STATUS.ready || live.status === STATUS.degraded) {
        var finalNote = await store.readFinal(scope.conversationId);
        return view(live, { reused: true, summary: finalNote });
      }
      if (isActivelyRunning(live)) return view(live, { reused: true });
      adopted = live;
      break;
    }

    var job;
    if (adopted) {
      // Resume in place: the slice boundaries are deterministic and finished
      // slices are already on disk, so only the missing ones are re-extracted.
      job = adopted;
      job.status = STATUS.created;
      job.stage = "created";
      job.error = null;
      job.modelCalls = 0;
      job.updatedAt = now();
      jobsById.set(job.jobId, job);
      var restored = (await store.listChunks(job.conversationId, job.jobId)).length;
      await trace(job, { stage: "partitioning", event: "job_resumed", restoredChunks: restored, outcome: "ok" });
    } else {
      job = {
        jobId: newId("pn_"),
        traceId: newId("tr_"),
        conversationId: scope.conversationId,
        accountId: scope.accountId,
        profileId: scope.profileId,
        worldId: scope.worldId,
        idempotencyKey: idempotencyKey,
        sourceHash: sourceHash,
        pipelineVersion: pipelineVersion,
        status: STATUS.created,
        stage: "created",
        createdAt: now(),
        updatedAt: now(),
        mode: route.mode,
        language: language,
        companionName: meta.companionName,
        textbookTitle: meta.textbookTitle,
        substantiveUserTurns: route.substantiveUserCount,
        estimatedTokens: route.estimatedTokens,
        quality: null,
        error: null,
        degradedReason: null
      };
      jobsById.set(job.jobId, job);
    }

    job.mode = route.mode;
    job.language = language;
    job.companionName = meta.companionName;
    job.textbookTitle = meta.textbookTitle;
    job.sourceMessageCount = normalized.length;
    job.substantiveUserTurns = route.substantiveUserCount;
    job.estimatedTokens = route.estimatedTokens;
    job.conversationHash = conversationHashOf(scope.conversationId);
    if (!job.completedChunks) job.completedChunks = 0;
    // Take ownership before touching status: any still-running previous run is
    // now superseded and can no longer overwrite this one's state.
    takeOwnership(job);

    await updateStage(job, STATUS.created, "partitioning");
    if (!adopted) {
      await trace(job, {
        stage: "partitioning",
        event: "job_created",
        mode: route.mode,
        messageCount: normalized.length,
        estimatedTokens: route.estimatedTokens,
        substantiveUserTurns: route.substantiveUserCount,
        outcome: "ok"
      });
    }

    // Short conversations never reach the model; the shipped behaviour is kept
    // so the route does not have to special-case it.
    if (route.substantiveUserCount < limits.minSubstantiveUserTurns) {
      var placeholder = buildPlaceholder(job);
      job.status = STATUS.ready;
      job.stage = "ready";
      job.completedChunks = 0;
      job.totalChunks = 0;
      await store.writeFinal(job.conversationId, placeholder);
      await persistJob(job);
      await trace(job, { stage: "ready", event: "job_completed", outcome: "placeholder" });
      return view(job, { summary: placeholder, placeholder: true });
    }

    var chunks = route.mode === "short" ? [] : partitioner.buildChunks(normalized);
    if (route.mode !== "short") {
      job.totalChunks = chunks.length;
      await store.writePartition(scope.conversationId, job.jobId, chunks.map(function (chunk) {
        return {
          chunkId: chunk.chunkId,
          position: chunk.position,
          messageRange: chunk.messageRange,
          sourceIndexes: chunk.sourceIndexes,
          tokens: chunk.tokens
        };
      }));
    } else {
      job.totalChunks = 1;
      job.completedChunks = 0;
    }
    await persistJob(job);
    await trace(job, {
      stage: "partitioning",
      event: "partition_completed",
      chunkCount: job.totalChunks,
      outcome: "ok"
    });

    launch(job, input.callModel, normalized, chunks);
    return view(job);
  }

  function launch(job, callModel, normalized, chunks) {
    var runtime = { token: job.runToken, callModel: callModel, controller: new AbortController() };
    runtimes.set(job.jobId, runtime);
    jobsById.set(job.jobId, job);
    Promise.resolve()
      .then(function () {
        var ctx = buildContext(job, runtime);
        return job.mode === "short" ? runDirect(job, ctx, normalized) : runChunked(job, ctx, normalized, chunks);
      })
      .catch(function (error) {
        return settleFailure(job, runtime, error);
      })
      .then(function () {
        runtimes.delete(job.jobId);
      }, function (error) {
        runtimes.delete(job.jobId);
        log(job, job.stage, "job_settle_error", { error: truncate(error && error.message, 120) });
      });
  }

  async function settleFailure(job, runtime, error) {
    var coded = errors.isCodedError(error) ? error : errors.classifyNetwork(error);
    var ctx = buildContext(job, runtime);
    if (superseded(job, ctx)) return view(job);
    if (coded.code === errors.CODES.cancelled) {
      job.status = STATUS.cancelled;
      job.stage = "cancelled";
      job.error = { code: coded.code, detail: "cancelled by user" };
      await persistJob(job, ctx);
      await trace(job, { stage: "cancelled", event: "job_cancelled", outcome: "cancelled" });
      log(job, "cancelled", "job_cancelled", {});
      return view(job);
    }

    job.error = { code: coded.code, detail: truncate(coded.message, 200) };
    await trace(job, { stage: job.stage, event: "job_failed", outcome: coded.code });

    // §5.2: a persistence failure keeps the checkpoints and does NOT re-call
    // the model — the note only needs saving again.
    if (coded.code === errors.CODES.persist_failed) {
      job.status = STATUS.failed;
      job.stage = "failed";
      job.resumable = true;
      await persistJob(job, ctx);
      log(job, "failed", "job_failed", { reason: coded.code });
      return view(job);
    }

    var evidence = await store.listChunks(job.conversationId, job.jobId).catch(function () { return []; });
    if (evidence.length) {
      job.degradedReason = coded.code;
      return degradeAndPersist(job, ctx, evidence, coded.code);
    }

    job.status = STATUS.failed;
    job.stage = "failed";
    await persistJob(job, ctx);
    log(job, "failed", "job_failed", { reason: coded.code });
    return view(job);
  }

  async function status(input) {
    var scope = requireScope(input || {});
    var jobId = String(input.jobId || "");
    if (!jobId) throw errors.codedError(errors.CODES.upstream_bad_request, "jobId is required");
    var job = jobsById.get(jobId) || await store.readJob(scope.conversationId, jobId);
    if (!job) throw errors.codedError(errors.CODES.not_found, "no such job");
    var extra = {};
    if (TERMINAL[job.status] && (job.status === STATUS.ready || job.status === STATUS.degraded)) {
      extra.summary = await store.readFinal(scope.conversationId);
    }
    return view(job, extra);
  }

  async function cancel(input) {
    var scope = requireScope(input || {});
    var jobId = String(input.jobId || "");
    var runtime = runtimes.get(jobId);
    if (runtime) runtime.controller.abort(errors.codedError(errors.CODES.cancelled, "cancelled by user"));
    var job = jobsById.get(jobId) || await store.readJob(scope.conversationId, jobId);
    if (!job) throw errors.codedError(errors.CODES.not_found, "no such job");
    if (!TERMINAL[job.status]) {
      job.status = STATUS.cancelled;
      job.stage = "cancelled";
      job.error = { code: errors.CODES.cancelled, detail: "cancelled by user" };
      await persistJob(job);
      await trace(job, { stage: "cancelled", event: "job_cancelled", outcome: "cancelled" });
    }
    return view(job);
  }

  // Retry re-runs the job from its checkpoints.  It deliberately goes through
  // `start()` so adoption, partitioning and tracing follow one code path: the
  // finished slices are read back from disk and only the missing ones are
  // re-extracted.
  async function retry(input) {
    var scope = requireScope(input || {});
    var jobId = String(input.jobId || "");
    var job = jobsById.get(jobId) || await store.readJob(scope.conversationId, jobId);
    if (!job) throw errors.codedError(errors.CODES.not_found, "no such job");
    if (typeof input.callModel !== "function") throw errors.codedError(errors.CODES.missing_dependency, "callModel is required to retry");
    if (isActivelyRunning(job)) return view(job, { reused: true });

    // Supersede any run that is still winding down before mutating the job, so
    // it cannot write its old terminal state over this retry.
    takeOwnership(job);
    job.status = STATUS.created;
    job.stage = "created";
    job.error = null;
    job.modelCalls = 0;
    await persistJob(job);
    await trace(job, { stage: "created", event: "job_retry_requested", outcome: "ok" });
    return start(Object.assign({}, input, { jobId: job.jobId, sourceHash: job.sourceHash }));
  }

  async function cleanup(options) {
    return store.cleanup(options);
  }

  return {
    pipelineVersion: pipelineVersion,
    limits: limits,
    start: start,
    status: status,
    cancel: cancel,
    retry: retry,
    cleanup: cleanup,
    isRunning: function (jobId) { var job = jobsById.get(jobId); return !!job && isActivelyRunning(job); }
  };
}

module.exports = {
  PIPELINE_VERSION: PIPELINE_VERSION,
  STATUS: STATUS,
  TERMINAL: TERMINAL,
  DEFAULT_LIMITS: DEFAULT_LIMITS,
  createOrchestrator: createOrchestrator
};
