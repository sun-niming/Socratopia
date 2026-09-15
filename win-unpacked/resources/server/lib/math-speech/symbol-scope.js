"use strict";

var contracts = require("./contracts");

var EXPLICIT_TYPES = Object.freeze({
  "集合": "set",
  "有限集合": "set",
  "矩阵": "matrix",
  "向量": "vector",
  "函数": "function",
  "映射": "function",
  "实数": "scalar",
  "标量": "scalar",
  "随机变量": "random-variable",
  "概率": "probability",
  "事件": "event",
  "区间": "interval",
});

var SCOPE_DISTANCE = Object.freeze({
  currentformula: 0,
  formula: 0,
  currentsentence: 0,
  sentence: 0,
  current: 0,
  currentreply: 1,
  currentresponse: 1,
  reply: 1,
  response: 1,
  knowledgepoint: 2,
  knowledge: 2,
  lesson: 2,
  classroom: 3,
  class: 3,
  preceding: 4,
  prior: 4,
  remote: 5,
});

function isExplicitFact(fact) {
  return !!(fact && typeof fact === "object" && fact.evidence === "explicit" && typeof fact.type === "string");
}

function copyFact(fact) {
  if (!fact || typeof fact !== "object") return null;
  try {
    var copy = contracts.cloneData(fact);
    return isExplicitFact(copy) ? copy : null;
  } catch (error) {
    return null;
  }
}

function normalizedScopeName(value) {
  return typeof value === "string" ? value.toLowerCase().replace(/[\s_-]+/g, "") : "";
}

function distanceFor(scopeKind, fallback) {
  var normalized = normalizedScopeName(scopeKind);
  if (Object.prototype.hasOwnProperty.call(SCOPE_DISTANCE, normalized)) return SCOPE_DISTANCE[normalized];
  return Number.isInteger(fallback) && fallback >= 0 ? fallback : 2;
}

function factDistance(fact, fallback) {
  if (!fact || typeof fact !== "object") return fallback;
  if (Number.isInteger(fact.distance) && fact.distance >= 0) return fact.distance;
  var scopeKind = fact.scopeKind;
  if (!scopeKind || normalizedScopeName(scopeKind) === "symbolfacts") scopeKind = fact.scope || fact.scopeId;
  return distanceFor(scopeKind, fallback);
}

function factWithSource(fact, sourceText, scopeKind, scopeId) {
  var copy = copyFact(fact);
  if (!copy) return null;
  if (sourceText && !copy.sourceText) copy.sourceText = sourceText;
  if (scopeKind && !copy.scopeKind) copy.scopeKind = scopeKind;
  if (scopeId && !copy.scopeId) copy.scopeId = scopeId;
  if (!Object.prototype.hasOwnProperty.call(copy, "supersedes")) copy.supersedes = null;
  return copy;
}

function extractExplicitFactCandidates(text, scopeKind, scopeId, distance) {
  var candidates = [];
  if (typeof text !== "string" || !text) return candidates;
  var typePattern = Object.keys(EXPLICIT_TYPES).sort(function (left, right) { return right.length - left.length; }).join("|");
  var identifierStart = "A-Za-zΑ-Ωα-ω";
  var identifierContinue = identifierStart + "0-9";
  var declaration = "((?:设|令|假设|记|取)?\\s*([" + identifierStart + "][" + identifierContinue + "]{0,63})\\s*(?:为|是|表示|记作)\\s*(" + typePattern + "))";
  var expression = new RegExp("(?:^|[^" + identifierContinue + "])" + declaration, "g");
  var matches = text.matchAll(expression);
  for (var match of matches) {
    candidates.push({
      name: match[2],
      fact: {
        type: EXPLICIT_TYPES[match[3]],
        evidence: "explicit",
        sourceText: match[1],
        sourceMessageId: null,
        scopeId: scopeId || scopeKind || null,
        scopeKind: scopeKind || null,
        supersedes: null,
      },
      distance: distanceFor(scopeKind, distance),
      scopeKind: scopeKind || null,
      scopeId: scopeId || null,
    });
  }
  return candidates;
}

function extractExplicitFacts(text) {
  var facts = {};
  extractExplicitFactCandidates(text, "currentSentence", "currentSentence", 0).forEach(function (candidate) {
    facts[candidate.name] = candidate.fact;
  });
  return facts;
}

function pushFactMap(candidates, value, scopeKind, scopeId, fallbackDistance) {
  if (!value) return;
  if (Array.isArray(value)) {
    value.forEach(function (entry) {
      if (!entry || typeof entry !== "object") return;
      var name = typeof entry.symbol === "string" ? entry.symbol : typeof entry.name === "string" ? entry.name : null;
      if (!name || contracts.isForbiddenPropertyKey(name)) return;
      var fact = factWithSource(entry, entry.sourceText, scopeKind, scopeId);
      if (fact) candidates.push({ name: name, fact: fact, distance: factDistance(fact, distanceFor(scopeKind, fallbackDistance)), scopeKind: scopeKind || null, scopeId: scopeId || null });
    });
    return;
  }
  if (typeof value !== "object") return;
  Object.keys(value).sort().forEach(function (name) {
    if (contracts.isForbiddenPropertyKey(name)) return;
    var valueForName = value[name];
    var factsForName = Array.isArray(valueForName) ? valueForName : [valueForName];
    factsForName.forEach(function (item) {
      var fact = factWithSource(item, null, scopeKind, scopeId);
      if (fact) candidates.push({ name: name, fact: fact, distance: factDistance(fact, distanceFor(scopeKind, fallbackDistance)), scopeKind: scopeKind || null, scopeId: scopeId || null });
    });
  });
}

function addTextScope(candidates, text, kind, id, distance) {
  extractExplicitFactCandidates(text, kind, id, distance).forEach(function (candidate) { candidates.push(candidate); });
}

function addScopeObject(candidates, scope, defaultKind, defaultDistance) {
  if (!scope || typeof scope !== "object") return;
  var kind = scope.kind || scope.scopeKind || defaultKind;
  var id = scope.scopeId || scope.id || kind || null;
  var distance = Number.isInteger(scope.distance) && scope.distance >= 0 ? scope.distance : distanceFor(kind, defaultDistance);
  var factMap = scope.symbolFacts || scope.facts;
  if (!factMap && !scope.text && !scope.kind && !scope.scopeKind && !scope.scopeId && !scope.id && !Object.prototype.hasOwnProperty.call(scope, "distance")) factMap = scope;
  pushFactMap(candidates, factMap, kind, id, distance);
  if (typeof scope.text === "string") addTextScope(candidates, scope.text, kind, id, distance);
}

function conflictNames(candidates) {
  var byName = Object.create(null);
  candidates.forEach(function (candidate) {
    if (!byName[candidate.name]) byName[candidate.name] = [];
    byName[candidate.name].push(candidate);
  });
  var conflicts = Object.create(null);
  Object.keys(byName).forEach(function (name) {
    var nearest = Math.min.apply(null, byName[name].map(function (candidate) { return candidate.distance; }));
    var nearestCandidates = byName[name].filter(function (candidate) { return candidate.distance === nearest; });
    var active = nearestCandidates.filter(function (candidate) {
      return !nearestCandidates.some(function (other) {
        if (other === candidate) return false;
        var supersedes = other.fact && other.fact.supersedes;
        if (supersedes === true || supersedes === "*") return true;
        return Array.isArray(supersedes) ? supersedes.indexOf(candidate.scopeId || candidate.scopeKind || candidate.fact.scopeId || candidate.fact.scopeKind) !== -1 : supersedes === (candidate.scopeId || candidate.scopeKind || candidate.fact.scopeId || candidate.fact.scopeKind);
      });
    });
    var types = Array.from(new Set(active.map(function (candidate) { return candidate.fact.type; })));
    if (types.length > 1) conflicts[name] = true;
  });
  return conflicts;
}

function chooseFacts(candidates) {
  var byName = Object.create(null);
  candidates.forEach(function (candidate, index) {
    if (!byName[candidate.name]) byName[candidate.name] = [];
    candidate.order = index;
    byName[candidate.name].push(candidate);
  });
  var facts = Object.create(null);
  var conflicts = conflictNames(candidates);
  Object.keys(byName).sort().forEach(function (name) {
    if (conflicts[name]) return;
    var ordered = byName[name].slice().sort(function (left, right) {
      return left.distance - right.distance || left.order - right.order;
    });
    var nearest = ordered[0].distance;
    var nearestCandidates = ordered.filter(function (candidate) { return candidate.distance === nearest; });
    var active = nearestCandidates.filter(function (candidate) {
      return !nearestCandidates.some(function (other) {
        if (other === candidate) return false;
        var supersedes = other.fact && other.fact.supersedes;
        if (supersedes === true || supersedes === "*") return true;
        var target = candidate.scopeId || candidate.scopeKind || candidate.fact.scopeId || candidate.fact.scopeKind;
        return Array.isArray(supersedes) ? supersedes.indexOf(target) !== -1 : supersedes === target;
      });
    });
    if (active.length > 1 && Array.from(new Set(active.map(function (candidate) { return candidate.fact.type; }))).length > 1) return;
    var selected = active[0] || ordered[0];
    var copy = copyFact(selected.fact);
    if (!copy) return;
    if (!copy.scopeId) copy.scopeId = selected.scopeId || selected.scopeKind || null;
    if (!copy.scopeKind) copy.scopeKind = selected.scopeKind || null;
    if (!Object.prototype.hasOwnProperty.call(copy, "supersedes")) copy.supersedes = null;
    if (ordered.length > 1 && ordered[1].fact.type !== copy.type && !copy.supersedes) copy.supersedes = ordered[1].fact.scopeId || ordered[1].fact.scopeKind || null;
    facts[name] = copy;
  });
  return { facts: facts, conflicts: conflicts };
}

function buildScope(context) {
  var safeContext = context && typeof context === "object" ? context : {};
  var candidates = [];
  pushFactMap(candidates, safeContext.symbolFacts, "symbolFacts", null, 2);
  if (Array.isArray(safeContext.scopes)) {
    safeContext.scopes.forEach(function (scope) {
      var before = candidates.length;
      addScopeObject(candidates, scope, "knowledgePoint", 2);
      var distance = scope && typeof scope === "object" && Number.isInteger(scope.distance) && scope.distance >= 0 ? scope.distance : scope && typeof scope === "object" ? distanceFor(scope.kind || scope.scopeKind, 2) : 2;
      candidates.slice(before).forEach(function (candidate) { candidate.distance = distance; });
    });
  }
  if (safeContext.scopeFacts && typeof safeContext.scopeFacts === "object") {
    ["classroom", "knowledgePoint", "currentReply", "currentSentence"].forEach(function (kind) {
      var before = candidates.length;
      addScopeObject(candidates, safeContext.scopeFacts[kind], kind, distanceFor(kind));
      candidates.slice(before).forEach(function (candidate) { candidate.distance = distanceFor(kind); });
    });
  }
  addTextScope(candidates, safeContext.classroomText || safeContext.classroom, "classroom", "classroom", 3);
  addTextScope(candidates, safeContext.knowledgePointText || safeContext.knowledgePoint, "knowledgePoint", "knowledgePoint", 2);
  addTextScope(candidates, safeContext.currentReply || safeContext.currentResponse, "currentReply", "currentReply", 1);
  addTextScope(candidates, safeContext.precedingText, "preceding", "preceding", 4);
  addTextScope(candidates, safeContext.currentSentence, "currentSentence", "currentSentence", 0);
  var selected = chooseFacts(candidates);
  return {
    facts: selected.facts,
    conflicts: selected.conflicts,
    domainHints: Array.isArray(safeContext.domainHints) ? safeContext.domainHints.slice() : [],
    precedingText: typeof safeContext.precedingText === "string" ? safeContext.precedingText : "",
    currentSentence: typeof safeContext.currentSentence === "string" ? safeContext.currentSentence : "",
  };
}

function getFact(scope, name) {
  if (!scope || !scope.facts || typeof name !== "string" || (scope.conflicts && scope.conflicts[name])) return null;
  var fact = scope.facts[name];
  return isExplicitFact(fact) ? fact : null;
}

function hasConflict(scope, name) {
  return !!(scope && scope.conflicts && scope.conflicts[name]);
}

function hasType(scope, name, type) {
  var fact = getFact(scope, name);
  return !!(fact && fact.type === type);
}

function factTypeForNode(scope, node) {
  if (!node || node.type !== "identifier") return null;
  var fact = getFact(scope, node.name);
  return fact ? fact.type : null;
}

module.exports = {
  buildScope: buildScope,
  extractExplicitFacts: extractExplicitFacts,
  extractExplicitFactCandidates: extractExplicitFactCandidates,
  getFact: getFact,
  hasConflict: hasConflict,
  hasType: hasType,
  factTypeForNode: factTypeForNode,
  isExplicitFact: isExplicitFact,
  distanceFor: distanceFor,
};
