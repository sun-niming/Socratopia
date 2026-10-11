// last-conversation.js — which conversation ran the most recent turn, and which textbook it
// reads.  The streaming `book://p<page>` preview needs it: the order carries no book id when
// the tutor means "the current book", and the world's *active* textbook is not necessarily the
// open chat's textbook (opening a chat does not change the active one — measured 2026-10-11).
//
// In-memory on purpose: it is a hint for a preview rendered seconds after a turn, and it falls
// back to the active textbook (then the world's first) when the process just started.
"use strict";

var last = null;

function set(conversationId, textbookId) {
  if (!conversationId || typeof conversationId !== "string") return last;
  last = {
    id: String(conversationId).slice(0, 64),
    textbookId: textbookId ? String(textbookId).slice(0, 64) : null,
    at: Date.now(),
  };
  return last;
}

function get() {
  return last;
}

// textbookId for a given conversation (null = whatever ran last).
function textbookIdFor(conversationId) {
  if (!last || !last.textbookId) return null;
  if (conversationId && last.id !== String(conversationId)) return null;
  return last.textbookId;
}

function reset() {
  last = null;
}

module.exports = { set: set, get: get, textbookIdFor: textbookIdFor, reset: reset };
