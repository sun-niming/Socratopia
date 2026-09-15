"use strict";

var contracts = require("./contracts");
var lexicon = require("./lexicon-zh");

var ENTITY_VALUES = Object.freeze({
  amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: "\u00a0",
  ApplyFunction: "\u2061", InvisibleTimes: "\u2062", InvisibleComma: "\u2063",
  ThinSpace: "\u2009", ThickSpace: "\u2005", NegativeThinSpace: "\u200b",
  le: "≤", ge: "≥", ne: "≠", infin: "∞", emptyset: "∅",
});

function parseFailure(message, position) {
  return {
    ok: false,
    code: contracts.ERROR_CODES.MATHML_PARSE_FAILED,
    message: (message || "invalid MathML") + (Number.isInteger(position) ? " at " + position : ""),
  };
}

function hasUnsafeDecodedCharacters(value, allowGeneratedControls) {
  for (var index = 0; index < value.length; index += 1) {
    var codePoint = value.codePointAt(index);
    if (contracts.hasUnsafeControlCharacters(String.fromCodePoint(codePoint))) {
      if (!(allowGeneratedControls && codePoint >= 0x2060 && codePoint <= 0x2064)) return true;
    }
    if (codePoint > 0xffff) index += 1;
  }
  return false;
}

function decodeEntities(value, allowGeneratedControls) {
  if (/&(?!#x[0-9a-fA-F]+;|#\d+;|[A-Za-z][A-Za-z0-9]+;)/.test(value)) return null;
  if (!allowGeneratedControls && contracts.hasUnsafeControlCharacters(value)) return null;
  var failed = null;
  var decoded = value.replace(/&(#x[0-9a-fA-F]+|#\d+|[A-Za-z][A-Za-z0-9]+);/g, function (whole, entity) {
    if (entity[0] === "#") {
      var hexadecimal = entity.slice(1, 2).toLowerCase() === "x";
      var digits = entity.slice(hexadecimal ? 2 : 1);
      var codePoint = parseInt(digits, hexadecimal ? 16 : 10);
      if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
        failed = whole;
        return "";
      }
      return String.fromCodePoint(codePoint);
    }
    if (!Object.prototype.hasOwnProperty.call(ENTITY_VALUES, entity)) {
      failed = whole;
      return "";
    }
    return ENTITY_VALUES[entity];
  });
  if (failed || hasUnsafeDecodedCharacters(decoded, allowGeneratedControls)) return null;
  return decoded;
}

function isNameCharacter(character) {
  return !!character && /[A-Za-z0-9_:.\-]/.test(character);
}

function skipWhitespace(text, index) {
  while (index < text.length && /\s/.test(text[index])) index += 1;
  return index;
}

function parseTagBody(body, offset, allowGeneratedControls) {
  var index = skipWhitespace(body, 0);
  var start = index;
  while (index < body.length && isNameCharacter(body[index])) index += 1;
  if (start === index) return parseFailure("tag name is missing", offset);
  var name = body.slice(start, index);
  var attributes = {};
  while (index < body.length) {
    index = skipWhitespace(body, index);
    if (index >= body.length) break;
    var attrStart = index;
    while (index < body.length && isNameCharacter(body[index])) index += 1;
    if (attrStart === index) return parseFailure("invalid attribute name", offset + index);
    var attrName = body.slice(attrStart, index);
    index = skipWhitespace(body, index);
    if (body[index] !== "=") return parseFailure("attribute value is missing", offset + index);
    index = skipWhitespace(body, index + 1);
    var quote = body[index];
    if (quote !== "\"" && quote !== "'") return parseFailure("attribute must be quoted", offset + index);
    index += 1;
    var valueStart = index;
    while (index < body.length && body[index] !== quote) index += 1;
    if (index >= body.length) return parseFailure("unterminated attribute", offset + valueStart);
    var value = decodeEntities(body.slice(valueStart, index), allowGeneratedControls);
    if (value === null) return parseFailure("invalid entity in attribute", offset + valueStart);
    attributes[attrName] = value;
    index += 1;
  }
  return { ok: true, name: name, attributes: attributes };
}

function findTagEnd(text, start) {
  var quote = "";
  for (var index = start; index < text.length; index += 1) {
    var character = text[index];
    if (quote) {
      if (character === quote) quote = "";
    } else if (character === "\"" || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  return -1;
}

function appendChild(parent, child) {
  parent.children.push(child);
}

/**
 * Parse the controlled MathML produced by KaTeX without resolving external
 * entities or fetching anything.  This is a strict, small tree reader for
 * MathML elements, not a general HTML/XML compatibility layer.
 */
function parseMathml(xml, limits, options) {
  if (typeof xml !== "string" || !xml.trim()) return parseFailure("MathML must be a non-empty string");
  var safeLimits = limits || contracts.DEFAULT_LIMITS;
  var allowGeneratedControls = !!(options && options.generated);
  if (xml.length > safeLimits.maxMathmlChars) return parseFailure("MathML exceeds the safety limit");
  if (!allowGeneratedControls && contracts.hasUnsafeControlCharacters(xml)) return parseFailure("MathML contains unsafe control characters");
  var documentNode = { type: "document", children: [] };
  var stack = [documentNode];
  var position = 0;
  var elementCount = 0;
  while (position < xml.length) {
    if (xml[position] !== "<") {
      var nextTag = xml.indexOf("<", position);
      if (nextTag === -1) nextTag = xml.length;
      var text = decodeEntities(xml.slice(position, nextTag), allowGeneratedControls);
      if (text === null) return parseFailure("invalid entity in text", position);
      if (text) appendChild(stack[stack.length - 1], { type: "text", value: text });
      position = nextTag;
      continue;
    }
    if (xml.slice(position, position + 4) === "<!--") {
      var commentEnd = xml.indexOf("-->", position + 4);
      if (commentEnd === -1) return parseFailure("unterminated comment", position);
      position = commentEnd + 3;
      continue;
    }
    if (xml.slice(position, position + 9).toUpperCase() === "<!DOCTYPE") {
      return parseFailure("DOCTYPE and external entities are not permitted", position);
    }
    if (xml.slice(position, position + 9) === "<![CDATA[") {
      var cdataEnd = xml.indexOf("]]>", position + 9);
      if (cdataEnd === -1) return parseFailure("unterminated CDATA", position);
      appendChild(stack[stack.length - 1], { type: "text", value: xml.slice(position + 9, cdataEnd) });
      position = cdataEnd + 3;
      continue;
    }
    if (xml[position + 1] === "?") {
      var instructionEnd = xml.indexOf("?>", position + 2);
      if (instructionEnd === -1) return parseFailure("unterminated processing instruction", position);
      position = instructionEnd + 2;
      continue;
    }
    var tagEnd = findTagEnd(xml, position + 1);
    if (tagEnd === -1) return parseFailure("unterminated tag", position);
    var body = xml.slice(position + 1, tagEnd);
    var closing = false;
    var selfClosing = false;
    body = body.replace(/^\s+|\s+$/g, "");
    if (body[0] === "/") {
      closing = true;
      body = body.slice(1).replace(/^\s+/, "");
    } else if (body.endsWith("/")) {
      selfClosing = true;
      body = body.slice(0, -1).replace(/\s+$/, "");
    }
    if (body[0] === "!" || body[0] === "$") return parseFailure("unsupported declaration", position);
    if (closing) {
      var closingName = body.trim();
      if (!/^[A-Za-z][A-Za-z0-9_:.\-]*$/.test(closingName)) return parseFailure("invalid closing tag", position);
      if (stack.length === 1 || stack[stack.length - 1].name !== closingName) return parseFailure("mismatched closing tag", position);
      stack.pop();
    } else {
      var parsed = parseTagBody(body, position + 1, allowGeneratedControls);
      if (!parsed.ok) return parsed;
      var element = {
        type: "element",
        name: parsed.name,
        attributes: parsed.attributes,
        children: [],
      };
      appendChild(stack[stack.length - 1], element);
      elementCount += 1;
      if (elementCount > safeLimits.maxAstNodes * 4) return parseFailure("MathML node count exceeds the safety limit", position);
      if (!selfClosing) {
        stack.push(element);
        if (stack.length > safeLimits.maxAstDepth * 2 + 16) return parseFailure("MathML nesting exceeds the safety limit", position);
      }
    }
    position = tagEnd + 1;
  }
  if (stack.length !== 1) return parseFailure("unclosed MathML element", xml.length);
  var mathElements = [];
  function collectMath(node) {
    if (!node || !Array.isArray(node.children)) return;
    node.children.forEach(function (child) {
      if (child.type === "element") {
        if (child.name.toLowerCase() === "math") mathElements.push(child);
        collectMath(child);
      }
    });
  }
  collectMath(documentNode);
  if (mathElements.length !== 1) return parseFailure("MathML document must contain exactly one math element");
  return { ok: true, root: mathElements[0], elementCount: elementCount };
}

function elementChildren(element) {
  return (element && Array.isArray(element.children) ? element.children : []).filter(function (child) {
    return child.type === "element";
  });
}

function textContent(element) {
  var result = "";
  function collect(node) {
    if (!node) return;
    if (node.type === "text") result += node.value;
    else if (Array.isArray(node.children)) node.children.forEach(collect);
  }
  collect(element);
  return result;
}

function sourceOf(element) {
  var attributes = {};
  var allowed = ["mathvariant", "fence", "separator", "stretchy", "accent", "accentunder", "linethickness", "open", "close", "separators", "columnalign", "intent"];
  allowed.forEach(function (key) {
    if (element.attributes && Object.prototype.hasOwnProperty.call(element.attributes, key)) attributes[key] = element.attributes[key];
  });
  return { tag: element.name, attributes: attributes };
}

function node(type, fields, element) {
  var result = { type: type };
  Object.keys(fields || {}).forEach(function (key) {
    if (typeof fields[key] !== "undefined") result[key] = fields[key];
  });
  if (element) result.source = sourceOf(element);
  return result;
}

function cleanText(value) {
  return String(value || "").replace(/[\u200b\u200c\u200d\ufeff]/g, "").trim();
}

function leafHasElementChildren(element) {
  return elementChildren(element).length > 0;
}

function asSequence(children, convert) {
  var values = [];
  children.forEach(function (child) {
    var converted = convert(child);
    if (converted) values.push(converted);
  });
  if (values.length === 0) return null;
  if (values.length === 1) return values[0];
  return node("row", { children: values });
}

function operatorSymbol(ast) {
  return ast && ast.type === "operator" ? ast.symbol : null;
}

function functionName(ast) {
  if (!ast) return null;
  if (ast.type === "identifier") return ast.name;
  if (ast.type === "row") {
    var children = ast.children || [];
    var identifiers = children.filter(function (child) { return child.type === "identifier"; });
    if (identifiers.length === 1 && children.every(function (child) { return child.type === "identifier" || (child.type === "operator" && child.applyFunction); })) return identifiers[0].name;
  }
  return null;
}

function isLargeOperator(base) {
  var symbol = operatorSymbol(base);
  var info = symbol && lexicon.operatorInfo(symbol);
  if (info && info.large) return info.large;
  return null;
}

function makeLargeOperator(base, lower, upper, element) {
  var largeType = isLargeOperator(base);
  if (largeType === "summation" || largeType === "product" || largeType === "integral") {
    return node(largeType, { lower: lower, upper: upper, body: null, operator: operatorSymbol(base) }, element);
  }
  var baseName = functionName(base);
  if (baseName === "lim") return node("limit", { condition: lower, body: null }, element);
  return null;
}

function convertElement(element, state) {
  var tag = element.name.toLowerCase();
  var children = elementChildren(element);
  var convert = function (child) { return convertElement(child, state); };
  if (tag === "math") return asSequence(children, convert);
  if (tag === "semantics") {
    var presentation = children.filter(function (child) {
      var name = child.name.toLowerCase();
      return name !== "annotation" && name !== "annotation-xml";
    })[0];
    return presentation ? convert(presentation) : null;
  }
  if (tag === "annotation" || tag === "annotation-xml") return null;
  if (tag === "mrow" || tag === "mstyle" || tag === "mpadded" || tag === "mphantom") return asSequence(children, convert);
  if (tag === "mspace") return null;
  if (tag === "mn") {
    if (leafHasElementChildren(element)) return node("unknown", { reason: "number-contains-child-element" }, element);
    var number = cleanText(textContent(element));
    return number ? node("number", { value: number }, element) : node("unknown", { reason: "empty-number" }, element);
  }
  if (tag === "mi") {
    if (leafHasElementChildren(element)) return node("unknown", { reason: "identifier-contains-child-element" }, element);
    var identifier = cleanText(textContent(element));
    if (identifier === "|" || identifier === "∣" || identifier === "‖" || identifier === "∥" || (lexicon.operatorInfo(identifier) && !/^[A-Za-z]+$/.test(identifier))) {
      return node("operator", {
        symbol: identifier,
        fence: false,
        separator: false,
        stretchy: true,
        applyFunction: false,
      }, element);
    }
    return identifier ? node("identifier", { name: identifier }, element) : node("unknown", { reason: "empty-identifier" }, element);
  }
  if (tag === "mtext") {
    if (leafHasElementChildren(element)) return node("unknown", { reason: "text-contains-child-element" }, element);
    var text = cleanText(textContent(element));
    return text ? node("text", { value: text }, element) : null;
  }
  if (tag === "mo") {
    if (leafHasElementChildren(element)) return node("unknown", { reason: "operator-contains-child-element" }, element);
    var symbol = cleanText(textContent(element));
    if (!symbol) return null;
    return node("operator", {
      symbol: symbol,
      fence: element.attributes.fence === "true",
      separator: element.attributes.separator === "true",
      stretchy: element.attributes.stretchy !== "false",
      applyFunction: symbol === "⁡" || symbol === "\u2061",
    }, element);
  }
  if (tag === "mfrac") {
    if (children.length !== 2) return node("unknown", { reason: "fraction-arity" }, element);
    return node("fraction", { numerator: convert(children[0]), denominator: convert(children[1]), linethickness: element.attributes.linethickness || null }, element);
  }
  if (tag === "msqrt") {
    return node("root", { radicand: asSequence(children, convert), index: null }, element);
  }
  if (tag === "mroot") {
    if (children.length !== 2) return node("unknown", { reason: "root-arity" }, element);
    return node("root", { radicand: convert(children[0]), index: convert(children[1]) }, element);
  }
  if (tag === "msup" || tag === "msub" || tag === "msubsup" || tag === "mover" || tag === "munder" || tag === "munderover") {
    var expected = tag === "msubsup" || tag === "munderover" ? 3 : 2;
    if (children.length !== expected) return node("unknown", { reason: tag + "-arity" }, element);
    var base = convert(children[0]);
    var lower = tag === "msub" || tag === "msubsup" || tag === "munder" || tag === "munderover" ? convert(children[1]) : null;
    var upper = tag === "msup" || tag === "msubsup" || tag === "mover" || tag === "munderover" ? convert(children[expected - 1]) : null;
    if (tag === "msup") return node("power", { base: base, exponent: upper }, element);
    if (tag === "msub") {
      var subLarge = makeLargeOperator(base, lower, null, element);
      return subLarge || node("subscript", { base: base, index: lower }, element);
    }
    if (tag === "msubsup") {
      var subsupLarge = makeLargeOperator(base, lower, upper, element);
      return subsupLarge || node("subsup", { base: base, lower: lower, upper: upper }, element);
    }
    var accentSymbol = operatorSymbol(upper || lower);
    var accentInfo = accentSymbol && lexicon.operatorInfo(accentSymbol);
    var accent = element.attributes.accent === "true" || !!(accentInfo && accentInfo.accent) || ["⃗", "^", "‾", "⏟", "⏞"].indexOf(accentSymbol) !== -1;
    if (operatorSymbol(upper || lower) === "⃗") return node("vector", { base: base }, element);
    if (base && base.type === "accent" && (base.accent === "⏟" || base.accent === "⏞")) {
      return node("accent", { base: base.base, over: tag === "mover" ? upper : null, under: tag === "munder" ? lower : null, accent: base.accent }, element);
    }
    if (accent) return node("accent", { base: base, over: upper, under: lower, accent: operatorSymbol(upper || lower) || "" }, element);
    var underLarge = makeLargeOperator(base, lower, upper, element);
    return underLarge || node("unknown", { reason: tag + "-unsupported" }, element);
  }
  if (tag === "mfenced") {
    var open = element.attributes.open === undefined ? "(" : element.attributes.open;
    var close = element.attributes.close === undefined ? ")" : element.attributes.close;
    var separators = element.attributes.separators === undefined ? "," : element.attributes.separators;
    return node("fenced", { open: open, close: close, separators: separators, body: asSequence(children, convert) }, element);
  }
  if (tag === "mtable") {
    var rows = [];
    children.forEach(function (rowElement) {
      if (rowElement.name.toLowerCase() !== "mtr") {
        state.unknownTags.push(rowElement.name.toLowerCase());
        return;
      }
      var cells = [];
      elementChildren(rowElement).forEach(function (cellElement) {
        if (cellElement.name.toLowerCase() !== "mtd") {
          state.unknownTags.push(cellElement.name.toLowerCase());
          return;
        }
        cells.push(convert(cellElement));
      });
      rows.push(cells);
    });
    return node("matrix", { rows: rows }, element);
  }
  if (tag === "mtr" || tag === "mtd") return asSequence(children, convert);
  if (tag === "annotation" || tag === "annotation-xml") return null;
  state.unknownTags.push(tag);
  return node("unknown", { tag: tag, reason: "unsupported-mathml-node" }, element);
}

function mathmlToAst(root, options) {
  var state = { unknownTags: [] };
  if (!root || root.type !== "element") return { ok: false, code: contracts.ERROR_CODES.EMPTY_AST, message: "MathML root is empty" };
  var ast = convertElement(root, state);
  if (!ast) return { ok: false, code: contracts.ERROR_CODES.EMPTY_AST, message: "MathML produced an empty AST", unknownTags: state.unknownTags };
  var intent = root.attributes && typeof root.attributes.intent === "string" ? root.attributes.intent : null;
  if (!intent) {
    elementChildren(root).some(function (child) {
      if (child.name.toLowerCase() === "semantics" && child.attributes && typeof child.attributes.intent === "string") {
        intent = child.attributes.intent;
        return true;
      }
      return false;
    });
  }
  return { ok: true, ast: ast, unknownTags: state.unknownTags.slice(), intent: intent };
}

module.exports = {
  parseMathml: parseMathml,
  mathmlToAst: mathmlToAst,
  elementChildren: elementChildren,
  textContent: textContent,
  sourceOf: sourceOf,
};
