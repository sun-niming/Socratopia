"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");

var serverRoot = path.resolve(__dirname, "..");
var pagePath = path.join(serverRoot, ".next", "static", "chunks", "app", "page-87daa6ca210ab9dc.js");
var chatPath = path.join(serverRoot, ".next", "server", "app", "api", "chat", "route.js");
var readingPath = path.join(serverRoot, ".next", "server", "app", "api", "reading-context", "route.js");
var page = fs.readFileSync(pagePath, "utf8");
var chat = fs.readFileSync(chatPath, "utf8");
var reading = fs.readFileSync(readingPath, "utf8");

var sendAnchor = page.indexOf("r7=(0,n.useCallback)(async");
assert.ok(sendAnchor >= 0, "classroom send callback must exist");
var sendEnd = page.indexOf("at=(0,n.useCallback)", sendAnchor);
assert.ok(sendEnd > sendAnchor, "retry callback must follow classroom send callback");
var send = page.slice(sendAnchor, sendEnd);

assert.ok(send.includes("deferPersist:!0"), "new conversation empty snapshot must be deferred");
assert.ok(send.includes("conversation_persistence_base_missing"), "missing persistence base must fail closed");
assert.ok(send.indexOf("await I(eZ,e8") < send.indexOf('fetch)("/api/chat"'), "TurnEnvelope snapshot must persist before chat request");
assert.ok(page.includes("conversation_persistence_failed_"), "critical persistence must reject HTTP failures");
assert.ok(send.includes("_retryConversationBase=t?.retryConversationBase||null"), "retry must use the post-deletion conversation snapshot");
assert.ok(send.includes("let e=_retryConversationBase||W.find"), "retry chat context must not use the stale render closure");
assert.ok(send.includes("_retryEnvelope=t?.retryEnvelope||null"), "retry must reuse the original TurnEnvelope");
assert.ok(send.includes("t?.retryAssistantMessageId||"), "retry must reuse the original assistant message id");
assert.ok(send.includes('_parentMessage=(_retryConversationBase?.messages||K?.messages||[]).slice().reverse().find(e=>"assistant"===e.role&&!e.notAccepted)'), "unaccepted assistant errors must not become parents");
assert.ok(send.includes("_isFirstAssistant"), "assistant first-turn boolean must not shadow the assistant message object");
assert.ok(!send.includes('let e=W.find(e=>e.id===r),s=!("assistant"'), "assistant message object shadow regression");

assert.ok(page.includes("let s=await ec(q,e);await r7(t,{retryEnvelope:a,retryAssistantMessageId:n,retryConversationBase:s})"), "failed-tail deletion must finish before retry");
assert.ok(page.includes("_advanceNotAccepted=!1===t.accepted||"), "client must honor explicit server non-acceptance");
assert.ok(page.includes("retryEnvelope:_advanceNotAccepted?null:n.turnEnvelope"), "stale/unaccepted turns must discard the old retry envelope");
assert.ok(page.includes("retryAssistantMessageId:_advanceNotAccepted?null:s.id"), "stale/unaccepted turns must generate a new assistant message id");
assert.ok(page.includes("n>=Number(a.stateGeneration||0)"), "stream snapshots must merge monotonically");
assert.ok(page.includes('e.ok?e.json():Promise.reject(Error("reading_context_failed"))'), "reading-context HTTP errors must not overwrite state");
assert.ok(page.includes("t.advance&&s>=Number(n.stateGeneration||0))&&(rr(t.readingRange||null)"), "stale reading-context responses must not roll back the displayed range");

assert.ok(chat.includes('if(_advanceError){await _advanceOuterCleanup?.(_advanceError),d({type:"error",accepted:!1'), "beginTurn rejection must be explicitly unaccepted after cleanup");
assert.ok(chat.includes('else if("error"===a.type)throw Object.assign(Error(a.error||"model_stream_error")'), "model error events must enter the failure path");
var beginTurnAnchor = chat.indexOf("_advanceTurn=await global.__AUTO_ADVANCE__.beginTurn(");
var acceptedCleanupAnchor = chat.indexOf("if(_advanceTurn&&!_advanceTurn.replay)_advanceOuterCleanup=", beginTurnAnchor);
assert.ok(beginTurnAnchor >= 0 && acceptedCleanupAnchor > beginTurnAnchor, "accepted turns must arm outer cleanup immediately after beginTurn");
assert.ok(chat.includes("else try{var _advanceOuterCleanup=null;_advanceTurn=await"), "outer cleanup must be function-scoped and visible to adaptiveCore's catch");
assert.ok(chat.includes('if(_advanceError){await _advanceOuterCleanup?.(_advanceError),d('), "accepted turns rejected before stream startup must be cleaned up");
assert.ok(chat.includes("}catch(a){await _advanceOuterCleanup?.(a);return new Response"), "pre-stream failures after beginTurn must fail the accepted turn");
assert.ok(chat.includes("decision:K.get(O)||null});_advanceOuterCleanup=null;_advanceComplete.shouldPrefetch"), "completed turns must disarm failure cleanup");
assert.ok(reading.includes("global.__AUTO_ADVANCE__.readSnapshot("), "reading-context GET must use the owner-neutral snapshot API");
assert.ok(!reading.includes("global.__AUTO_ADVANCE__.bootstrap("), "reading-context GET must never activate an owner");

console.log("auto-advance protocol bundle smoke: PASS");
