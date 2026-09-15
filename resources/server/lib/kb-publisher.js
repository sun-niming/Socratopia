"use strict";

var fs = require("fs");
var path = require("path");

var FINAL_NAME = "knowledge_base";
var STAGE_NAME = "knowledge_base.__building__";
var PREVIOUS_NAME = "knowledge_base.__previous__";

function paths(textbookDir) {
  var root = String(textbookDir || "");
  return {
    finalDir: path.join(root, FINAL_NAME),
    stageDir: path.join(root, STAGE_NAME),
    previousDir: path.join(root, PREVIOUS_NAME),
  };
}

function insideTextbook(textbookDir, target) {
  var root = path.resolve(String(textbookDir || ""));
  var resolved = path.resolve(String(target || ""));
  return !!root && resolved !== root && resolved.startsWith(root + path.sep);
}

function removeTree(textbookDir, target) {
  if (!insideTextbook(textbookDir, target)) throw new Error("refusing to remove path outside textbook directory");
  fs.rmSync(target, { recursive: true, force: true });
}

function prepare(textbookDir) {
  var p = paths(textbookDir);
  if (!insideTextbook(textbookDir, p.stageDir)) throw new Error("invalid KB staging path");
  removeTree(textbookDir, p.stageDir);
  fs.mkdirSync(p.stageDir, { recursive: true });
  return p;
}

function publish(textbookDir) {
  var p = paths(textbookDir);
  if (!fs.existsSync(p.stageDir)) throw new Error("KB staging directory is missing");
  removeTree(textbookDir, p.previousDir);
  var hadFinal = fs.existsSync(p.finalDir);
  if (hadFinal) fs.renameSync(p.finalDir, p.previousDir);
  try {
    fs.renameSync(p.stageDir, p.finalDir);
  } catch (error) {
    if (hadFinal && fs.existsSync(p.previousDir) && !fs.existsSync(p.finalDir)) {
      try { fs.renameSync(p.previousDir, p.finalDir); } catch (rollbackError) {
        error.rollbackError = rollbackError;
      }
    }
    throw error;
  }
  removeTree(textbookDir, p.previousDir);
  return p.finalDir;
}

// For a brand-new textbook there is no previous KB to protect. Publishing a
// partial/error status makes the failure visible to the runtime, which will
// refuse to teach from it. Existing KBs are never replaced by a failed build.
function publishFailureIfNoFinal(textbookDir) {
  var p = paths(textbookDir);
  if (fs.existsSync(p.finalDir) || !fs.existsSync(p.stageDir)) return false;
  fs.renameSync(p.stageDir, p.finalDir);
  return true;
}

module.exports = {
  FINAL_NAME: FINAL_NAME,
  STAGE_NAME: STAGE_NAME,
  PREVIOUS_NAME: PREVIOUS_NAME,
  paths: paths,
  prepare: prepare,
  publish: publish,
  publishFailureIfNoFinal: publishFailureIfNoFinal,
};
