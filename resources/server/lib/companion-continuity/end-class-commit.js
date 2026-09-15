"use strict";

// Converts the already-parsed six-section end-class response into a single
// continuity transaction.  This module deliberately does not call an LLM: it
// only turns structured data into deterministic file targets.

var fs = require("fs");
var path = require("path");
var Transaction = require("./transaction.js");

function endClassError(code, message, status) {
  return Transaction.continuityError(code, message, status);
}

function safeScopePart(value, name, optional) {
  if ((value === undefined || value === null || value === "") && optional) return null;
  if (typeof value !== "string" || !value || value.length > 512 || /[\x00-\x1f\\/]/.test(value)) {
    throw endClassError("CONTINUITY_SCOPE_INVALID", "Invalid continuity " + name, 400);
  }
  return value;
}

function normalizeScope(scope) {
  scope = scope || {};
  return {
    accountId: safeScopePart(scope.accountId || "legacy", "account id"),
    profileId: safeScopePart(scope.profileId, "profile id"),
    worldId: safeScopePart(scope.worldId, "world id"),
    conversationId: safeScopePart(scope.conversationId, "conversation id"),
  };
}

function canonicalOperationId(scope, clientOperationId) {
  var normalized = normalizeScope(scope);
  var base = "endclass:v1:" + Transaction.sha256(JSON.stringify(normalized)).slice(0, 32);
  if (clientOperationId === undefined || clientOperationId === null || clientOperationId === "") return base;
  if (typeof clientOperationId !== "string" || clientOperationId.length > 512 || /[\x00-\x1f]/.test(clientOperationId)) {
    throw endClassError("CONTINUITY_OPERATION_INVALID", "Invalid client continuity operation id", 400);
  }
  // The client contribution is hashed and appended to a server-bound scope.
  // It can make an operation stable across a lost response, but can never
  // select another account/profile/world/conversation receipt namespace.
  return base + ":" + Transaction.sha256(clientOperationId).slice(0, 24);
}

async function assertAccountContext(input, phase) {
  if (!input || typeof input.assertAccountContext !== "function") return;
  await input.assertAccountContext({ phase: phase });
}

async function readText(worldDir, relativePath) {
  var resolved = Transaction.resolveInsideWorld(worldDir, relativePath).absolute;
  try {
    return await fs.promises.readFile(resolved, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return "";
    throw error;
  }
}

function boundedText(value, maxLength) {
  value = String(value == null ? "" : value).trim();
  if (!value) return "";
  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength);
}

function eventMarker(operationId, companionInstanceId, mode) {
  return "<!-- continuityEvent:" + Transaction.operationHash(operationId).slice(0, 24) + " companion:" + String(companionInstanceId || "legacy") + " mode:" + String(mode || "classroom") + " -->";
}

function insertMarkerAfterHeading(markdown, marker) {
  var content = String(markdown || "").trim();
  if (!content || content.indexOf(marker) >= 0) return content;
  var newline = content.indexOf("\n");
  if (newline < 0) return content + "\n" + marker;
  if (/^##\s+/.test(content)) return content.slice(0, newline) + "\n" + marker + content.slice(newline);
  return marker + "\n" + content;
}

function mergePalMoments(previous, newest, limit) {
  var oldEntries = String(previous || "").trim().split(/(?=^##\s+\d{4}-\d{2}-\d{2}\s*\|)/m).map(function (entry) {
    return entry.trim();
  }).filter(Boolean);
  var entries = [String(newest || "").trim()].concat(oldEntries).filter(Boolean);
  while (entries.length > 1 && entries.join("\n\n").length > limit) entries.pop();
  return entries.join("\n\n");
}

function appendDiary(previous, entry, marker) {
  var marked = String(entry || "").trim();
  if (!marked) return String(previous || "");
  if (marked.indexOf(marker) < 0) marked = marker + "\n" + marked;
  var prior = String(previous || "");
  return prior.trim() ? prior.replace(/\s*$/, "") + "\n\n---\n\n" + marked + "\n" : marked + "\n";
}

function appendWorldRecord(previous, input) {
  var lines = String(previous || "").split(/\r?\n/).filter(function (line) { return line.trim(); });
  var line = [input.date, input.displayName, input.textbookTitle || "未知教材", "event=" + Transaction.operationHash(input.operationId).slice(0, 12)].join(" | ");
  if (!lines.some(function (current) { return current.indexOf("event=" + Transaction.operationHash(input.operationId).slice(0, 12)) >= 0; })) lines.push(line);
  return lines.slice(-100).join("\n") + "\n";
}

function parseJson(text, relativePath) {
  try {
    return JSON.parse(String(text || "").replace(/^\uFEFF/, ""));
  } catch (_) {
    throw endClassError("CONTINUITY_STATE_INVALID", "Invalid JSON in " + relativePath, 500);
  }
}

function verifyCurrentCompanion(worldMeta, companion) {
  if (!companion) return;
  var index = Number(companion.slotIndex);
  var slot = worldMeta && Array.isArray(worldMeta.companions) && Number.isInteger(index) ? worldMeta.companions[index] : null;
  if (!slot || !slot.companionInstanceId || slot.companionInstanceId !== companion.companionInstanceId) {
    throw endClassError("COMPANION_CONTEXT_MISMATCH", "The selected companion changed before the end-class commit", 409);
  }
  if (companion.candidateId && slot.candidateId !== companion.candidateId) {
    throw endClassError("COMPANION_CONTEXT_MISMATCH", "The selected companion candidate changed before the end-class commit", 409);
  }
}

function candidateBelongsToScope(candidate, scope, companion) {
  if (!candidate || typeof candidate !== "object") return false;
  if (candidate.consumedByOperationId) return false;
  var candidateScope = candidate.scope;
  if (!candidateScope) return true; // Old candidate files are already conversation-scoped by path.
  if (candidateScope.accountId && candidateScope.accountId !== scope.accountId) return false;
  if (candidateScope.profileId && candidateScope.profileId !== scope.profileId) return false;
  if (candidateScope.worldId && candidateScope.worldId !== scope.worldId) return false;
  if (candidateScope.conversationId && candidateScope.conversationId !== scope.conversationId) return false;
  if (candidateScope.companionInstanceId && candidateScope.companionInstanceId !== companion.companionInstanceId) return false;
  return true;
}

function consumeCandidatesText(previous, scope, companion, operationId) {
  if (!String(previous || "").trim()) return null;
  var candidates = parseJson(previous, "close_reading_candidates.json");
  if (!Array.isArray(candidates)) return null;
  var changed = false;
  var next = candidates.map(function (candidate) {
    if (!candidateBelongsToScope(candidate, scope, companion)) return candidate;
    changed = true;
    var copy = Object.assign({}, candidate);
    copy.schemaVersion = Math.max(Number(copy.schemaVersion) || 0, 1);
    copy.scope = Object.assign({}, copy.scope || {}, {
      accountId: scope.accountId,
      profileId: scope.profileId,
      worldId: scope.worldId,
      conversationId: scope.conversationId,
      companionInstanceId: companion.companionInstanceId,
    });
    copy.consumedByOperationId = operationId;
    copy.consumedAt = new Date().toISOString();
    return copy;
  });
  return changed ? JSON.stringify(next.slice(-20), null, 2) + "\n" : null;
}

function buildHandoffMessages(messages) {
  return (Array.isArray(messages) ? messages : []).filter(function (message) {
    return message && (message.role === "user" || message.role === "assistant") && String(message.content || "").trim();
  }).slice(-8).map(function (message) {
    return { role: message.role, content: boundedText(message.content, 2400) };
  });
}

async function buildTargets(input, scope, operationId) {
  var worldDir = input.worldDir;
  var output = input.output || {};
  var companion = input.companion || {};
  if (!boundedText(output.palMomentsMd, 20000) || !boundedText(output.progressMd, 40000)) {
    throw endClassError("CONTINUITY_OUTPUT_INVALID", "End-class output is incomplete", 400);
  }
  if (!companion.companionInstanceId || !companion.slotId || !Number.isInteger(Number(companion.slotIndex))) {
    throw endClassError("COMPANION_CONTEXT_MISMATCH", "A resolved companion snapshot is required", 409);
  }
  var marker = eventMarker(operationId, companion.companionInstanceId, "classroom");
  var date = safeScopePart(input.date, "date");
  var diaryPath = input.diaryPath || "diary/" + date.slice(0, 7) + ".md";
  var relationPath = "relation_" + companion.slotId + ".md";
  var textbookId = input.textbookId ? safeScopePart(input.textbookId, "textbook id") : null;
  var targets = [];
  var oldPal = await readText(worldDir, "pal_moments.md");
  var markedPal = insertMarkerAfterHeading(output.palMomentsMd, marker);
  targets.push({ relativePath: "pal_moments.md", content: mergePalMoments(oldPal, markedPal, Number(input.palMomentsLimit) || 1800) });

  if (textbookId) targets.push({ relativePath: "textbooks/" + textbookId + "/progress.md", content: String(output.progressMd).trim() + "\n" });
  if (String(output.diaryEntry || "").trim()) {
    var previousDiary = await readText(worldDir, diaryPath);
    targets.push({ relativePath: diaryPath, content: appendDiary(previousDiary, output.diaryEntry, marker) });
  }
  if (output.relationMd !== undefined) targets.push({ relativePath: relationPath, content: boundedText(output.relationMd, Number(input.relationLimit) || 400) + "\n" });

  var metaText = await readText(worldDir, "world_meta.json");
  var worldMeta = parseJson(metaText, "world_meta.json");
  verifyCurrentCompanion(worldMeta, companion);
  worldMeta.lastStudyDate = date;
  targets.push({ relativePath: "world_meta.json", content: JSON.stringify(worldMeta, null, 2) + "\n" });
  var oldRecords = await readText(worldDir, "world_records.md");
  targets.push({ relativePath: "world_records.md", content: appendWorldRecord(oldRecords, {
    date: date,
    displayName: companion.displayName || companion.slotId,
    textbookTitle: input.textbookTitle,
    operationId: operationId,
  }) });

  if (textbookId) {
    var endingPage = Number(input.endingPage);
    if (Number.isInteger(endingPage) && endingPage > 0) {
      var indexPath = "textbooks/textbook_index.json";
      var indexRaw = await readText(worldDir, indexPath);
      if (indexRaw.trim()) try {
        var textbookIndex = parseJson(indexRaw, indexPath);
        var textbookList = Array.isArray(textbookIndex.textbooks) ? textbookIndex.textbooks : [];
        var textbook = textbookList.find(function (item) { return item && item.id === textbookId; });
        if (textbook) { textbook.currentPage = endingPage; targets.push({ relativePath: indexPath, content: JSON.stringify(textbookIndex, null, 2) + "\n" }); }
      } catch (indexError) { console.warn("[continuity] textbook index sync skipped:", indexError && indexError.message); }
    }
    var handoffMessages = buildHandoffMessages(input.handoffMessages);
    if (handoffMessages.length) {
      var savedAt = input.savedAt || new Date().toISOString();
      targets.push({
        relativePath: "textbooks/" + textbookId + "/handoff/last_tail.json",
        content: JSON.stringify({ savedAt: savedAt, messages: handoffMessages, operationId: operationId }, null, 2) + "\n",
      });
      targets.push({
        relativePath: "textbooks/" + textbookId + "/handoff/last_meta.json",
        content: JSON.stringify({
          savedAt: savedAt,
          prevConvId: scope.conversationId,
          companionName: companion.displayName || companion.slotId,
          companionSlot: companion.slotId,
          companionInstanceId: companion.companionInstanceId,
          candidateId: companion.candidateId || null,
          endingPage: input.endingPage == null ? null : input.endingPage,
          teachingLanguage: input.teachingLanguage || "chinese",
          operationId: operationId,
        }, null, 2) + "\n",
      });
    }
  }

  var candidatePath = "conversations/" + scope.conversationId + "/close_reading_candidates.json";
  var candidateNext = consumeCandidatesText(await readText(worldDir, candidatePath), scope, companion, operationId);
  if (candidateNext !== null) targets.push({ relativePath: candidatePath, content: candidateNext });

  (Array.isArray(input.cleanupPaths) ? input.cleanupPaths : []).forEach(function (relativePath) {
    targets.push({ relativePath: relativePath, delete: true, content: null });
  });
  return { targets: targets, marker: marker };
}

async function commitEndClass(input) {
  input = input || {};
  var scope = normalizeScope(input.scope);
  var operationId = canonicalOperationId(scope, input.clientOperationId);
  var worldDir = input.worldDir;
  await assertAccountContext(input, "before_recover");
  await Transaction.recoverWorld(worldDir);
  await assertAccountContext(input, "before_receipt");
  var prior = await Transaction.readReceipt(worldDir, operationId);
  if (prior) return { committed: true, replayed: true, operationId: operationId, receipt: prior, payload: prior.payload || null };
  var built = await buildTargets(input, scope, operationId);
  await assertAccountContext(input, "before_commit");
  var result = await Transaction.commit({
    worldDir: worldDir,
    operationId: operationId,
    scope: scope,
    companion: {
      slotId: input.companion.slotId,
      companionInstanceId: input.companion.companionInstanceId,
      candidateId: input.companion.candidateId || null,
      displayName: input.companion.displayName || null,
    },
    targets: built.targets,
    receiptPayload: {
      farewell: boundedText(input.output && input.output.farewell, 4000),
      companionNote: boundedText(input.output && input.output.companionNote, 1000),
      marker: built.marker,
      endingPage: Number.isInteger(Number(input.endingPage)) && Number(input.endingPage) > 0 ? Number(input.endingPage) : null,
    },
    faultInjector: input.faultInjector,
    assertStillAuthorized: function (info) {
      return assertAccountContext(input, info && info.phase || "transaction");
    },
  });
  return {
    committed: true,
    replayed: !!result.replayed,
    operationId: operationId,
    receipt: result.receipt,
    payload: result.receipt && result.receipt.payload || null,
  };
}

async function getEndClassReceipt(input) {
  input = input || {};
  var scope = normalizeScope(input.scope);
  var operationId = canonicalOperationId(scope, input.clientOperationId);
  await assertAccountContext(input, "before_recover");
  await Transaction.recoverWorld(input.worldDir);
  await assertAccountContext(input, "before_receipt");
  var receipt = await Transaction.readReceipt(input.worldDir, operationId);
  return receipt ? { operationId: operationId, receipt: receipt, payload: receipt.payload || null } : null;
}

module.exports = {
  canonicalOperationId: canonicalOperationId,
  eventMarker: eventMarker,
  mergePalMoments: mergePalMoments,
  candidateBelongsToScope: candidateBelongsToScope,
  consumeCandidatesText: consumeCandidatesText,
  buildTargets: buildTargets,
  commitEndClass: commitEndClass,
  getEndClassReceipt: getEndClassReceipt,
};
