"use strict";

// Persistent per-conversation classroom task state (2026-09-13).
//
// The chapter-end exercise regression (outputs/deepseek-classroom-20260913-diagnosis.md)
// had one structural cause: nothing recorded that the learner had switched the
// session from "teach the chapter" to "work through the chapter-end exercises".
// The old KB concept queue therefore kept driving the teaching direction, and a
// trailing question mark was enough to cap a concept and force the next card.
//
// This module owns the missing record: which task the learner is actually on
// (lecture vs. exercise practice), the agreed exercise queue, the current
// exercise, the phase, and the corrections the learner asked for. It is stored
// per conversation on disk, independent of the lesson summary, so refreshing or
// resuming the chat cannot lose the queue. Nothing here calls a model.

var fs = require("fs");
var path = require("path");

var SCHEMA_VERSION = 1;
var TASK_FILE = "classroom-task.json";
var MAX_QUEUE = 40;
var MAX_CONSTRAINTS = 6;
var MAX_EXERCISE_RESULTS = 40;
var MAX_RECENT_TEXTS = 8;
var MAX_RECENT_TEXT_CHARS = 4000;

var MODE_LECTURE = "lecture";
var MODE_EXERCISE = "exercise";

// Short acknowledgements and give-ups. These must never be read as a task
// switch, as an answer worth counting, or as "advance to the next exercise".
var SHORT_ACK_RE = /^(?:嗯+|哦+|噢+|好|好的|好呀|好吧|行|行的|可以|懂了|明白了?|知道了|收到|谢谢|多谢|继续|接着|下一条|下一个|ok|okay|yes|yep|no|thanks|继续吧|不会|不懂|不会做|不[会懂]了?|不知道|不清楚|不明白|没听懂|没思路|不懂啊|不知道啊|不确定|想不起来|忘记了?|太难了|没想法|没有思路|看不到|看不清)[\s。，,.!！?？~～…]*$/i;

// Explicit task switches. Leaving exercise mode is checked before entering it,
// so "不要做题了，继续讲课" cannot be misread as a request to start exercises.
var LECTURE_INTENT_RE = /(?:别|不要|不用|停止|不再)(?:再)?(?:做题|刷题|做练习|练题)|不(?:做|刷)题了?|回到(?:讲授|讲课|课文|教材|正常)|继续讲(?:课|教材|课文)|正常(?:讲|上)课|按(?:教材|章节|课文)(?:讲|讲授)|讲授模式/;
var EXERCISE_INTENT_RE = /章末(?:习题|练习|题|部分)|课后(?:习题|练习|题)|书后(?:习题|练习|题)|习题(?:训练|练习|课)|练习(?:课|题)|按题(?:目)?(?:逐个|一道|依次)|逐题(?:训练|练习|做)|一题一题|一道一道|刷题|做练习|练题|做题|end-of-chapter|practice problems|exercise (?:set|problems)|work through the (?:exercises|problems)/i;

// Exercise labels such as R26, P7, P28. Two uppercase letters at most keeps
// acronym+digit noise (ISO9001, TCP2) out of the queue.
var EXERCISE_ID_RE = /\b([A-Z]{1,2})[-–—]?(\d{1,3})\b/g;

var EXERCISE_SECTION_RE = /^#{1,6}[^\n]*(?:章末|课后|书后|习题|练习|题目|Exercises?|Problems?|Review\s+Questions)[^\n]*$/im;
var HEADING_RE = /^#{1,6}[^\n]*$/gm;

var CONSTRAINT_RULES = [
  { key: "no-drift", re: /跑偏|跑题|别跑|不要偏|离题|不要讲其他|别讲其他|不要扩展|别扯/, text: "不要跑偏：只围绕当前题目，不讲无关知识点" },
  { key: "one-at-a-time", re: /只(?:讲|看|说|补充|问|处理)(?:当前|这|本)?(?:道)?题|按题(?:目)?(?:来|逐个|一道|依次)|逐题|一题一题|一道一道/, text: "逐题训练：一次只处理当前题，按约定队列推进" },
  { key: "no-answer-first", re: /不要(?:直接)?给(?:我)?答案|先别(?:给|说|公布)答案|让我(?:先)?(?:想|试)/, text: "先不要直接给答案，等学习者作答后再判断缺口" },
  { key: "current-only", re: /只(?:补充|讲|要)(?:当前题)?(?:所需|必要)(?:的)?知识|不要(?:补充|扩展)(?:无关|其他)/, text: "只补充当前题所需知识" }
];

function text(value) {
  return String(value == null ? "" : value);
}

function trimTo(value, max) {
  value = text(value);
  return value.length > max ? value.slice(0, max) : value;
}

function isShortAck(value) {
  var trimmed = text(value).trim();
  if (!trimmed) return true;
  return SHORT_ACK_RE.test(trimmed);
}

function modeIntent(value) {
  var trimmed = text(value).trim();
  if (!trimmed) return null;
  if (LECTURE_INTENT_RE.test(trimmed)) return MODE_LECTURE;
  if (EXERCISE_INTENT_RE.test(trimmed)) return MODE_EXERCISE;
  return null;
}

function extractExerciseIds(value) {
  var found = [];
  var seen = {};
  var input = text(value);
  var match;
  EXERCISE_ID_RE.lastIndex = 0;
  while ((match = EXERCISE_ID_RE.exec(input)) !== null) {
    var id = match[1] + match[2];
    if (seen[id]) continue;
    seen[id] = true;
    found.push(id);
  }
  return found;
}

// The exercise block of the loaded window, when the textbook marks it with a
// heading. Falls back to the whole window so an unlabelled exercise list still
// supplies real ids instead of hardcoded ones.
function exerciseSectionText(readingText) {
  var input = text(readingText).replace(/\r\n/g, "\n");
  if (!input) return "";
  var heading = input.match(EXERCISE_SECTION_RE);
  if (!heading) return input;
  var start = input.indexOf(heading[0]);
  if (start < 0) return input;
  var rest = input.slice(start + heading[0].length);
  HEADING_RE.lastIndex = 0;
  var next = HEADING_RE.exec(rest);
  var section = rest.slice(0, next ? next.index : rest.length);
  return section.trim() ? section : input;
}

function readingIds(readingText) {
  return extractExerciseIds(exerciseSectionText(readingText));
}

function constraintsFrom(value) {
  var input = text(value);
  if (!input) return [];
  var found = [];
  CONSTRAINT_RULES.forEach(function (rule) {
    if (rule.re.test(input)) found.push(rule);
  });
  return found;
}

function taskPath(paths) {
  if (!paths || !paths.worldDir || !paths.conversationId) return null;
  return path.join(paths.worldDir, "conversations", paths.conversationId, TASK_FILE);
}

function readTask(paths) {
  var file = taskPath(paths);
  if (!file) return null;
  try {
    var parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (!parsed || typeof parsed !== "object") return null;
    return normalizeTask(parsed);
  } catch (e) {
    return null;
  }
}

function writeTask(paths, task) {
  var file = taskPath(paths);
  if (!file || !task) return null;
  var next = normalizeTask(task);
  next.updatedAt = new Date().toISOString();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    var tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), "utf-8");
    for (var attempt = 0; ; attempt += 1) {
      try {
        fs.renameSync(tmp, file);
        return next;
      } catch (error) {
        var code = error && error.code;
        // Windows: progress_state.json and the conversation files are written
        // by other runtime paths too; retry briefly instead of losing the task.
        if (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY") throw error;
        if (attempt >= 9) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * (attempt + 1));
      }
    }
  } catch (e) {
    return null;
  }
}

function clearTask(paths) {
  var file = taskPath(paths);
  if (!file) return false;
  try { fs.unlinkSync(file); return true; } catch (e) { return false; }
}

function normalizeIdList(value, max) {
  var out = [];
  var seen = {};
  (Array.isArray(value) ? value : []).forEach(function (item) {
    var id = text(item).trim();
    if (!id || seen[id]) return;
    seen[id] = true;
    if (out.length < max) out.push(id);
  });
  return out;
}

function normalizeConstraints(value) {
  var out = [];
  var seen = {};
  (Array.isArray(value) ? value : []).forEach(function (item) {
    var entry = item;
    if (typeof entry === "string") entry = { key: entry, text: entry };
    if (!entry || typeof entry !== "object") return;
    var label = text(entry.text || entry.key).trim();
    if (!label || seen[label]) return;
    seen[label] = true;
    if (out.length < MAX_CONSTRAINTS) out.push({
      key: text(entry.key || label).slice(0, 64),
      text: trimTo(label, 120),
      source: trimTo(entry.source, 160),
      at: text(entry.at) || null,
    });
  });
  return out;
}

function normalizeResults(value) {
  var out = [];
  (Array.isArray(value) ? value : []).forEach(function (item) {
    if (!item || typeof item !== "object") return;
    var id = text(item.id).trim();
    if (!id) return;
    out.push({
      id: id,
      result: trimTo(item.result, 200),
      completedAt: text(item.completedAt) || null,
    });
    if (out.length >= MAX_EXERCISE_RESULTS) return;
  });
  return out.slice(0, MAX_EXERCISE_RESULTS);
}

function normalizeTask(value) {
  var raw = value && typeof value === "object" ? value : {};
  var mode = raw.mode === MODE_EXERCISE ? MODE_EXERCISE : MODE_LECTURE;
  var queue = normalizeIdList(raw.exerciseQueue, MAX_QUEUE);
  var current = text(raw.currentExerciseId).trim();
  if (current && queue.indexOf(current) < 0) current = "";
  if (!current) current = queue[0] || "";
  return {
    schemaVersion: SCHEMA_VERSION,
    mode: mode,
    exerciseQueue: queue,
    currentExerciseId: current,
    phase: text(raw.phase).trim() || (mode === MODE_EXERCISE ? "selecting" : "idle"),
    constraints: normalizeConstraints(raw.constraints),
    exerciseResults: normalizeResults(raw.exerciseResults),
    turnCount: Number.isFinite(Number(raw.turnCount)) ? Number(raw.turnCount) : 0,
    createdAt: text(raw.createdAt) || null,
    updatedAt: text(raw.updatedAt) || null,
    source: text(raw.source) || null,
  };
}

function defaultTask() {
  return normalizeTask({});
}

// Candidate ids come from what was actually said and from the loaded window.
// Ids harvested from the conversation survive only if the window also contains
// them; an id the learner typed themselves is trusted on its own.
function buildQueue(opts) {
  opts = opts || {};
  var windowIds = readingIds(opts.readingText);
  var known = {};
  windowIds.forEach(function (id) { known[id] = true; });

  var queue = [];
  var seen = {};
  function push(id) {
    id = text(id).trim();
    if (!id || seen[id]) return;
    seen[id] = true;
    if (queue.length < MAX_QUEUE) queue.push(id);
  }

  var explicit = [];
  (Array.isArray(opts.userTexts) ? opts.userTexts : []).forEach(function (entry) {
    extractExerciseIds(entry).forEach(function (id) {
      push(id);
      explicit.push(id);
    });
  });
  (Array.isArray(opts.recentTexts) ? opts.recentTexts : []).forEach(function (entry) {
    extractExerciseIds(entry).forEach(function (id) {
      if (known[id]) push(id);
    });
  });
  windowIds.forEach(push);

  var explicitSet = {};
  explicit.forEach(function (id) { explicitSet[id] = true; });
  return { queue: queue, explicit: explicitSet };
}

function nextQueueId(queue, completedIds, afterId) {
  var completed = {};
  (Array.isArray(completedIds) ? completedIds : []).forEach(function (id) { completed[text(id)] = true; });
  var start = afterId ? queue.indexOf(afterId) : -1;
  for (var i = start + 1; i < queue.length; i++) {
    if (!completed[queue[i]]) return queue[i];
  }
  for (var j = 0; j < queue.length; j++) {
    if (!completed[queue[j]]) return queue[j];
  }
  return "";
}

function completedIds(task) {
  return normalizeResults(task && task.exerciseResults).map(function (entry) { return entry.id; });
}

function advance(task, resultText) {
  var next = normalizeTask(task);
  var finished = next.currentExerciseId;
  if (finished) {
    next.exerciseResults = normalizeResults(next.exerciseResults.concat([{ id: finished, result: trimTo(resultText, 200), completedAt: new Date().toISOString() }]));
  }
  var upcoming = nextQueueId(next.exerciseQueue, completedIds(next), finished);
  next.currentExerciseId = upcoming || finished;
  next.phase = upcoming ? "awaiting_answer" : "completed";
  return next;
}

function addConstraints(task, entries, source) {
  var next = normalizeTask(task);
  var at = new Date().toISOString();
  entries.forEach(function (rule) {
    var exists = next.constraints.some(function (item) { return item.key === rule.key; });
    if (exists) return;
    next.constraints = normalizeConstraints(next.constraints.concat([{
      key: rule.key,
      text: rule.text,
      source: trimTo(source, 160),
      at: at,
    }]));
  });
  return next;
}

function applyUserText(task, opts) {
  opts = opts || {};
  var userText = text(opts.text);
  var next = normalizeTask(task);
  var intent = isShortAck(userText) ? null : modeIntent(userText);

  if (intent && intent !== next.mode) {
    next.mode = intent;
    next.source = trimTo(userText, 160);
    next.phase = intent === MODE_EXERCISE ? "selecting" : "idle";
    if (intent === MODE_EXERCISE) {
      var built = buildQueue({ userTexts: [userText], recentTexts: opts.recentTexts, readingText: opts.readingText });
      next.exerciseQueue = built.queue;
      var first = nextQueueId(next.exerciseQueue, completedIds(next), "");
      var named = extractExerciseIds(userText).filter(function (id) { return next.exerciseQueue.indexOf(id) >= 0; });
      next.currentExerciseId = named.length ? named[named.length - 1] : first;
      next.phase = next.currentExerciseId ? "awaiting_answer" : "selecting";
    }
    return { task: next, changed: true };
  }

  if (next.mode !== MODE_EXERCISE) return { task: next, changed: false };

  var changed = false;
  var constrained = addConstraints(next, isShortAck(userText) ? [] : constraintsFrom(userText), userText);
  if (JSON.stringify(constrained.constraints) !== JSON.stringify(next.constraints)) {
    next = constrained;
    changed = true;
  }

  // A learner-named id is a deliberate switch/correction: move immediately and
  // drop any pending advance that conflicts with it.
  var namedIds = isShortAck(userText) ? [] : extractExerciseIds(userText).filter(function (id) {
    return next.exerciseQueue.indexOf(id) >= 0;
  });
  if (namedIds.length) {
    var target = namedIds[namedIds.length - 1];
    if (target !== next.currentExerciseId) {
      next.currentExerciseId = target;
      next.phase = "awaiting_answer";
      changed = true;
    }
  }
  return { task: next, changed: changed };
}

function applyExerciseCompletion(task, exerciseId) {
  var next = normalizeTask(task);
  if (!exerciseId || String(exerciseId) !== next.currentExerciseId) return { task: next, changed: false };
  return { task: advance(next), changed: true };
}

function resolveForRequest(opts) {
  opts = opts || {};
  var paths = opts.paths;
  var body = opts.body || {};
  var stored = readTask(paths);
  var messages = Array.isArray(body.messages) ? body.messages : [];
  var lastUser = null;
  for (var i = messages.length - 1; i >= 0; i--) {
    if (messages[i] && messages[i].role === "user") { lastUser = text(messages[i].content); break; }
  }
  var recentTexts = [];
  for (var j = messages.length - 1; j >= 0 && recentTexts.length < MAX_RECENT_TEXTS; j--) {
    if (!messages[j] || (messages[j].role !== "user" && messages[j].role !== "assistant")) continue;
    if (messages[j].role === "user" && text(messages[j].content) === lastUser && recentTexts.length === 0) continue;
    recentTexts.push(trimTo(messages[j].content, MAX_RECENT_TEXT_CHARS));
  }
  var readingText = "";
  var readingFile = readingPath(paths);
  if (readingFile) {
    try { readingText = fs.readFileSync(readingFile, "utf-8"); } catch (e) { readingText = ""; }
  }
  var result = applyUserText(stored || defaultTask(), {
    text: lastUser,
    recentTexts: recentTexts,
    readingText: readingText,
  });
  var task = result.task;
  var changed = result.changed;
  if (!stored) {
    task.createdAt = new Date().toISOString();
    changed = true;
  }
  if (changed) {
    task.turnCount = (Number(stored && stored.turnCount) || 0) + 1;
    task = writeTask(paths, task) || task;
  }
  return { task: task, changed: changed, readingText: readingText };
}

function readingPath(paths) {
  if (!paths || !paths.worldDir || !paths.conversationId) return null;
  return path.join(paths.worldDir, "conversations", paths.conversationId, "current_reading.md");
}

function readExerciseMarker(textValue) {
  var input = text(textValue);
  var match = /<!--\s*kbProgress\s*:([\s\S]*?)\s*-->/.exec(input);
  if (!match) return null;
  try {
    var parsed = JSON.parse(match[1]);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (e) {
    return null;
  }
}

// Post-response bookkeeping: only an explicit completion report for the current
// exercise advances the queue. A missing or foreign id changes nothing, which
// is the property that keeps a knowledge card from being "completed" by a
// question about an unrelated exercise.
function commitResponse(opts) {
  opts = opts || {};
  var paths = opts.paths;
  var task = normalizeTask(opts.task || readTask(paths) || defaultTask());
  var marker = opts.marker || readExerciseMarker(opts.responseText);
  var changed = false;
  if (marker && String(marker.exerciseId || "") === task.currentExerciseId && marker.exerciseComplete === true) {
    task = advance(task, opts.resultText || marker.exerciseResult);
    changed = true;
  }
  if (changed) task = writeTask(paths, task) || task;
  return { task: task, changed: changed, marker: marker };
}

function list(value, max) {
  var items = (Array.isArray(value) ? value : []).slice(0, max);
  return items.join(", ");
}

// Injected immediately before the learner's message. Kept under 1500 chars: the
// classroom route truncates every non-final message at that limit.
function buildExerciseDirective(task, opts) {
  opts = opts || {};
  var current = normalizeTask(task);
  var textbookId = text(opts.textbookId);
  var conversationId = text(opts.conversationId);
  var pending = current.exerciseQueue.filter(function (id) {
    return completedIds(current).indexOf(id) < 0;
  });
  var constraintText = current.constraints.length
    ? " Learner constraints that stay in force: " + current.constraints.map(function (item) { return item.text; }).join("; ") + "."
    : "";
  var body =
    "EXERCISE_TRAINING_MODE: this conversation is working through chapter-end exercises, not teaching the chapter in order. " +
    "Current exercise: \"" + current.currentExerciseId + "\"" + (current.phase ? " (phase: " + current.phase + ")" : "") + ". " +
    "Agreed queue: [" + list(pending, 12) + "]" +
    (completedIds(current).length ? " (already finished: [" + list(completedIds(current), 8) + "])" : "") + ". " +
    "Follow the fixed cycle: question stem -> learner answers -> judge the gap -> the minimum hint or explanation -> close the exercise -> next queued id. " +
    "Explain only the knowledge this exercise needs. Do NOT teach a knowledge-base card queue, do NOT advance to a card the learner did not ask for, " +
    "and do NOT mark any concept complete in this mode; the knowledge base is reference material for the current exercise. " +
    "Do not add a topic the learner did not raise. Do not present the full answer first and then ask the learner to repeat it." + constraintText + " " +
    "At the very end of every reply append exactly one hidden progress line: <!-- kbProgress:{\"schemaVersion\":1,\"textbookId\":\"" +
    textbookId + "\",\"sourceConversationId\":\"" + conversationId + "\",\"exerciseId\":\"" + current.currentExerciseId +
    "\",\"exerciseComplete\":false,\"lastTaughtPage\":ACTUAL_PAGE_NUMBER} -->. " +
    "Set exerciseComplete to true only after this exercise is actually solved or fully explained; then the queue moves on. " +
    "lastTaughtPage must be the page of the current exercise inside the loaded window. Never write concept ids in this mode.";
  return body;
}

module.exports = {
  SCHEMA_VERSION: SCHEMA_VERSION,
  TASK_FILE: TASK_FILE,
  MODE_LECTURE: MODE_LECTURE,
  MODE_EXERCISE: MODE_EXERCISE,
  MAX_QUEUE: MAX_QUEUE,
  taskPath: taskPath,
  readingPath: readingPath,
  readTask: readTask,
  writeTask: writeTask,
  clearTask: clearTask,
  normalizeTask: normalizeTask,
  defaultTask: defaultTask,
  isShortAck: isShortAck,
  modeIntent: modeIntent,
  extractExerciseIds: extractExerciseIds,
  exerciseSectionText: exerciseSectionText,
  constraintsFrom: constraintsFrom,
  buildQueue: buildQueue,
  nextQueueId: nextQueueId,
  completedIds: completedIds,
  advance: advance,
  applyUserText: applyUserText,
  applyExerciseCompletion: applyExerciseCompletion,
  resolveForRequest: resolveForRequest,
  readExerciseMarker: readExerciseMarker,
  commitResponse: commitResponse,
  buildExerciseDirective: buildExerciseDirective,
};
