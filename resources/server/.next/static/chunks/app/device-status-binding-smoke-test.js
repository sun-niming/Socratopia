"use strict";

const fs = require("fs");
const path = require("path");
const acorn = require("acorn");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function walk(node, visit) {
  if (!node || typeof node !== "object") return;
  visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === "start" || key === "end") continue;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, visit);
    } else {
      walk(value, visit);
    }
  }
}

function walkDirectFunction(functionNode, visit) {
  function descend(node) {
    if (!node || typeof node !== "object") return;
    if (
      node !== functionNode &&
      (node.type === "FunctionDeclaration" ||
        node.type === "FunctionExpression" ||
        node.type === "ArrowFunctionExpression")
    ) {
      return;
    }
    visit(node);
    for (const [key, value] of Object.entries(node)) {
      if (key === "start" || key === "end") continue;
      if (Array.isArray(value)) {
        for (const item of value) descend(item);
      } else {
        descend(value);
      }
    }
  }
  descend(functionNode);
}

const activePath = path.join(__dirname, "page-87daa6ca210ab9dc.js");
const activeSource = fs.readFileSync(activePath, "utf8");
const ast = acorn.parse(activeSource, {
  ecmaVersion: 2022,
  sourceType: "script",
});

let mainComponent = null;
walk(ast, (node) => {
  if (node.type === "FunctionDeclaration" && node.id?.name === "so") {
    mainComponent = node;
  }
});
assert(mainComponent, "main component so() was not found");

let conversationHook = null;
walk(mainComponent, (node) => {
  if (conversationHook || node.type !== "FunctionExpression") return;
  let returnsConversationShape = false;
  walkDirectFunction(node, (inner) => {
    if (inner.type !== "ReturnStatement" || inner.argument?.type !== "ObjectExpression") {
      return;
    }
    returnsConversationShape = inner.argument.properties.some(
      (property) => property.key?.name === "activeConversation",
    );
  });
  if (returnsConversationShape) conversationHook = node;
});
assert(conversationHook, "conversation hook IIFE was not found");

const leakedAssignments = [];
walkDirectFunction(conversationHook, (node) => {
  if (
    node.type === "AssignmentExpression" &&
    node.left?.type === "Identifier" &&
    (node.left.name === "A" || node.left.name === "S")
  ) {
    leakedAssignments.push(node.left.name);
  }
});
assert(
  leakedAssignments.length === 0,
  `conversation hook overwrites outer account/device bindings: ${leakedAssignments.join(",")}`,
);

for (const localName of ["conversationRef", "dropFailedTail", "activeConversation"]) {
  let declared = false;
  walkDirectFunction(conversationHook, (node) => {
    if (node.type === "VariableDeclarator" && node.id?.name === localName) {
      declared = true;
    }
  });
  assert(declared, `conversation hook local ${localName} is not declared`);
}

const clientBundles = [
  "page-87daa6ca210ab9dc.js",
  "page-3a1fef7566e26c43.js",
  "page-practice-ui-20260622.js",
  "page-practice-ui-20260625-jyfix.js",
  "page-practice-ui-20260626-postclass-notes.js",
];
for (const filename of clientBundles) {
  const source = fs.readFileSync(path.join(__dirname, filename), "utf8");
  assert(
    source.includes('if("limit"===A||"cooldown"===A)return'),
    `${filename} does not use an explicit device-status gate`,
  );
  assert(!source.includes("__ACCOUNT_HOOK_DIAG__"), `${filename} contains diagnostic code`);
  assert(!source.includes("Socratopia [AeqK="), `${filename} contains a diagnostic title`);
}

const serverPagePath = path.resolve(
  __dirname,
  "../../../server/app/page.js",
);
const serverPageSource = fs.readFileSync(serverPagePath, "utf8");
assert(
  serverPageSource.includes('if("limit"===t||"cooldown"===t)return'),
  "server page does not use an explicit device-status gate",
);

console.log(
  `device status binding smoke: PASS bundles=${clientBundles.length + 1}`,
);
