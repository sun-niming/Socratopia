#!/usr/bin/env node
// tools/figure-adoption-report.js — is the tutor actually drawing figures in ordinary
// conversation, and how often does one die as an un-citable "[图片: …]" leftover?
//
// Reads the desktop log and the worlds' chat files.  No deps, no app needed.
//
//   node tools/figure-adoption-report.js                    # last 7 days, every world
//   node tools/figure-adoption-report.js --days=2
//   node tools/figure-adoption-report.js --since=2026-10-11T06:40:00Z
//   node tools/figure-adoption-report.js --world=KU --profile=uolmzgq8
//   node tools/figure-adoption-report.js --log=<path> --root=<project-data path>
//
// Signals it counts (all of them already exist in the running app):
//   turns          — "[assets] figure catalogue chars=" per turn (the guide is injected every turn)
//   figureReplies  — pre-probe beacons (svg fence) + page-image sweep beacons (book:// crop)
//   materialized   — sum of N in "[assets] materialized figure orders in N message(s)"
//   deadLeftovers  — assistant messages whose text is literally "[图片: …]" with no anchor
//   promptChars    — last / max size of the injected guide+catalogue block
//
// The fix that removed dead leftovers shipped 2026-10-11 06:40Z, so pass --since after
// that when you want a clean read; earlier leftovers are historical, not regressions.
"use strict";

const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const out = { days: 7 };
  for (const arg of argv.slice(2)) {
    const m = /^--([a-z]+)(?:=(.*))?$/.exec(arg);
    if (!m) continue;
    out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

function defaultRoot() {
  const appData = process.env.APPDATA || path.join(process.env.USERPROFILE || ".", "AppData", "Roaming");
  return path.join(appData, "socratopia", "project-data");
}

function defaultLog() {
  const appData = process.env.APPDATA || path.join(process.env.USERPROFILE || ".", "AppData", "Roaming");
  return path.join(appData, "socratopia", "logs", "socralab_debug.log");
}

function worldDirs(root, filters) {
  const out = [];
  const accountsDir = path.join(root, "accounts");
  if (!fs.existsSync(accountsDir)) return out;
  for (const account of fs.readdirSync(accountsDir)) {
    const profilesDir = path.join(accountsDir, account, "profiles");
    if (!fs.existsSync(profilesDir)) continue;
    for (const profile of fs.readdirSync(profilesDir)) {
      if (filters.profile && filters.profile !== profile) continue;
      const worldsDir = path.join(profilesDir, profile, "worlds");
      if (!fs.existsSync(worldsDir)) continue;
      for (const world of fs.readdirSync(worldsDir)) {
        if (filters.world && filters.world !== world) continue;
        out.push({ account, profile, world, dir: path.join(worldsDir, world) });
      }
    }
  }
  return out;
}

// A log line looks like: [2026-10-11T06:13:02.331Z] [Next] [assets] figure catalogue chars=712
function timestampOf(line) {
  const m = /^\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\]/.exec(line);
  if (!m) return null;
  const t = Date.parse(m[1]);
  return Number.isFinite(t) ? t : null;
}

function scanLog(logPath, sinceMs) {
  const stats = { turns: 0, figureReplies: 0, materialized: 0, promptCharsLast: 0, promptCharsMax: 0, trashed: 0, cropFailures: 0 };
  if (!fs.existsSync(logPath)) return stats;
  const text = fs.readFileSync(logPath, "utf8");
  for (const line of text.split("\n")) {
    if (!line) continue;
    const at = timestampOf(line);
    if (at === null || at < sinceMs) continue;
    let m;
    if ((m = /figure catalogue chars=(\d+)/.exec(line))) {
      stats.turns += 1;
      const chars = Number(m[1]);
      stats.promptCharsLast = chars;
      if (chars > stats.promptCharsMax) stats.promptCharsMax = chars;
      continue;
    }
    if ((m = /materialized figure orders in (\d+) message/.exec(line))) {
      stats.materialized += Number(m[1]);
      continue;
    }
    if (line.indexOf("stage=pre-probe") >= 0) { stats.figureReplies += 1; continue; }
    // A crop has no live fence: it renders as /api/textbook?page-image=1 and the capture sweep
    // hydrates it (beaconOnce → one line per distinct page), so count that as an ordered figure.
    if (line.indexOf("stage=sweep-found") >= 0 && /page-image(%3D|=)1/.test(line)) { stats.figureReplies += 1; continue; }
    if (line.indexOf("[chat-trash] moved") >= 0) { stats.trashed += 1; continue; }
    if (/\[assets\] book order p\d+ failed/.test(line)) { stats.cropFailures += 1; continue; }
  }
  return stats;
}

// Textbook crops land in the asset index with kind "textbook-figure" — the only
// durable count of "the tutor pulled a real book figure into the chat".
function scanAssets(dir, sinceMs) {
  const out = { crops: 0, samples: [] };
  const indexFile = path.join(dir, "assets", "index.jsonl");
  if (!fs.existsSync(indexFile)) return out;
  for (const line of fs.readFileSync(indexFile, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch (_) { continue; }
    if (row.kind !== "textbook-figure") continue;
    const at = Number(row.createdAt);
    if (Number.isFinite(at) && at < sinceMs) continue;
    out.crops += 1;
    if (out.samples.length < 5) out.samples.push(row.id + " p" + ((row.ref && row.ref.page) || "?"));
  }
  return out;
}

function scanChats(dir, sinceMs) {
  const out = { assistantMessages: 0, withAnchor: 0, deadLeftovers: 0, samples: [] };
  const chatsDir = path.join(dir, "chats");
  if (!fs.existsSync(chatsDir)) return out;
  for (const file of fs.readdirSync(chatsDir)) {
    if (!file.endsWith(".json")) continue;
    let chat;
    try { chat = JSON.parse(fs.readFileSync(path.join(chatsDir, file), "utf8")); } catch (_) { continue; }
    for (const message of chat.messages || []) {
      if (!message || message.role !== "assistant" || typeof message.content !== "string") continue;
      const at = Date.parse(message.timestamp || "");
      if (Number.isFinite(at) && at < sinceMs) continue;
      out.assistantMessages += 1;
      const hasAnchor = /asset:\/\/ast_[0-9a-f]{16}/.test(message.content);
      const dead = !hasAnchor && /\[图片:/.test(message.content);
      if (hasAnchor) out.withAnchor += 1;
      if (dead) {
        out.deadLeftovers += 1;
        if (out.samples.length < 5) out.samples.push({ file: file, id: message.id, text: message.content.replace(/\s+/g, " ").slice(0, 60) });
      }
    }
  }
  return out;
}

function pct(part, whole) {
  if (!whole) return "n/a";
  return ((part / whole) * 100).toFixed(1) + "%";
}

function main() {
  const args = parseArgs(process.argv);
  const root = args.root ? String(args.root) : defaultRoot();
  const logPath = args.log ? String(args.log) : defaultLog();
  const sinceMs = args.since
    ? Date.parse(String(args.since))
    : Date.now() - (Number(args.days) || 7) * 24 * 3600 * 1000;

  console.log("figure adoption report");
  console.log("  window : since " + new Date(sinceMs).toISOString() + (args.since ? "" : " (" + (args.days || 7) + " days)"));
  console.log("  log    : " + logPath);
  console.log("  root   : " + root);
  console.log("");

  const log = scanLog(logPath, sinceMs);
  const worlds = worldDirs(root, { world: args.world, profile: args.profile });
  const chats = worlds.reduce(function (acc, w) {
    const one = scanChats(w.dir, sinceMs);
    acc.assistantMessages += one.assistantMessages;
    acc.withAnchor += one.withAnchor;
    acc.deadLeftovers += one.deadLeftovers;
    acc.samples = acc.samples.concat(one.samples.map(function (s) { return Object.assign({ world: w.world }, s); }));
    return acc;
  }, { assistantMessages: 0, withAnchor: 0, deadLeftovers: 0, samples: [] });

  const assets = worlds.reduce(function (acc, w) {
    const one = scanAssets(w.dir, sinceMs);
    acc.crops += one.crops;
    acc.samples = acc.samples.concat(one.samples.map(function (x) { return w.world + ": " + x; }));
    return acc;
  }, { crops: 0, samples: [] });

  console.log("turns (figure block injected)   : " + log.turns);
  console.log("replies that ordered a figure   : " + log.figureReplies + "  (" + pct(log.figureReplies, log.turns) + " of turns)");
  console.log("figures persisted to store      : " + log.materialized + " write events (a save can log one figure more than once)");
  console.log("assistant messages in window    : " + chats.assistantMessages + " across " + worlds.length + " world(s)");
  console.log("  ...carrying a figure anchor   : " + chats.withAnchor + "  (" + pct(chats.withAnchor, chats.assistantMessages) + " of messages — the reliable figure count)");
  console.log("  ...dead \"[图片: …]\" leftovers : " + chats.deadLeftovers + "  (" + pct(chats.deadLeftovers, chats.assistantMessages) + " of messages)");
  console.log("textbook crops ordered (book://): " + assets.crops + "  (" + pct(assets.crops, log.turns) + " of turns)" + (assets.samples.length ? "  [" + assets.samples.slice(0, 3).join(", ") + "]" : ""));
  console.log("  ...crop failures in the log   : " + log.cropFailures);
  console.log("deletes that went to the trash  : " + log.trashed);
  console.log("figure block size (chars)       : last " + log.promptCharsLast + " / max " + log.promptCharsMax);
  if (chats.samples.length) {
    console.log("\ndead leftover samples:");
    chats.samples.slice(0, 5).forEach(function (s) { console.log("  " + s.world + "/" + s.file + " " + JSON.stringify(s.text)); });
  }
  console.log("\nread it as: figureReplies > 0 means ordinary conversation draws without being asked;");
  console.log("deadLeftovers should trend to 0 after 2026-10-11T06:40Z (the anchor-form fix).");
}

if (require.main === module) main();

module.exports = { scanLog: scanLog, scanAssets: scanAssets, scanChats: scanChats, timestampOf: timestampOf, pct: pct, parseArgs: parseArgs, worldDirs: worldDirs };
