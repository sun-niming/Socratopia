// locate-figure-smoke-test.js
"use strict";
const assert = require("assert");
const lib = require("./locate-figure.js");

const results = [];
function test(name, fn) {
  const p = (async () => fn())();
  return p.then(function () { results.push(true); console.log("  PASS  " + name); },
    function (e) { results.push(false); console.log("  FAIL  " + name + "\n        " + e.message); });
}

const conf = { baseUrl: "https://x/v1", apiKey: "k", model: "m" };

(async function main() {
  await test("parseRect takes a bare object and a fenced one", function () {
    assert.deepStrictEqual(lib.parseRect('{"x0":0.1,"y0":0.2,"x1":0.9,"y1":0.8}'), [0.1, 0.2, 0.9, 0.8]);
    assert.deepStrictEqual(lib.parseRect('here you go:\n```json\n{"x0":0,"y0":0.3,"x1":1,"y1":0.7}\n```'), [0, 0.3, 1, 0.7]);
    assert.strictEqual(lib.parseRect('{"none":true}'), null);
    assert.strictEqual(lib.parseRect("no json at all"), null);
    assert.strictEqual(lib.parseRect('{"x0":0.1,"y0":0.2}'), null);
    assert.strictEqual(lib.parseRect('{"x0":"a","y0":0.2,"x1":0.9,"y1":0.8}'), null);
  });

  await test("the last usable object wins over an echoed example", function () {
    var echoed = '{"x0":0.08,"y0":0.22,"x1":0.92,"y1":0.55} -> the answer is {"x0":0.1,"y0":0.3,"x1":0.7,"y1":0.6}';
    assert.deepStrictEqual(lib.parseRect(echoed), [0.1, 0.3, 0.7, 0.6]);
    assert.deepStrictEqual(lib.parseRect('{"x0":0.08,"y0":0.22,"x1":0.92,"y1":0.55}'), [0.08, 0.22, 0.92, 0.55]);
    // a whole-page object first, the real answer second
    assert.deepStrictEqual(lib.parseRect('{"x0":0,"y0":0,"x1":1,"y1":1} then {"x0":0.2,"y0":0.4,"x1":0.8,"y1":0.66}'), [0.2, 0.4, 0.8, 0.66]);
    assert.strictEqual(lib.parseRect('{"x0":0,"y0":0,"x1":1,"y1":1}'), null, "whole page alone is not usable");
  });

  await test("loose shapes parse: bare keys, single quotes, arrays, prose", function () {
    assert.deepStrictEqual(lib.parseRect("{x0:0.1, y0:0.3, x1:0.7, y1:0.6}"), [0.1, 0.3, 0.7, 0.6]);
    assert.deepStrictEqual(lib.parseRect("{'x0':0.1,'y0':0.3,'x1':0.7,'y1':0.6,}"), [0.1, 0.3, 0.7, 0.6]);
    assert.deepStrictEqual(lib.parseRect("box = [0.1, 0.3, 0.7, 0.6]"), [0.1, 0.3, 0.7, 0.6]);
    assert.deepStrictEqual(lib.parseRect("x0=0.1, y0=0.3, x1=0.7, y1=0.6"), [0.1, 0.3, 0.7, 0.6]);
    assert.deepStrictEqual(lib.parseRect("0.1 0.3 0.7 0.6"), [0.1, 0.3, 0.7, 0.6], "four loose numbers are taken in order");
  });

  await test("sanitizeRect clamps, rejects slivers and near-full pages", function () {
    assert.deepStrictEqual(lib.sanitizeRect([-0.1, 0.21, 1.2, 0.79]), [0, 0.21, 1, 0.79]);
    assert.strictEqual(lib.sanitizeRect([0.5, 0.2, 0.55, 0.8]), null, "10% wide is a sliver");
    assert.strictEqual(lib.sanitizeRect([0, 0.4, 1, 0.44]), null, "4% tall is a sliver");
    assert.strictEqual(lib.sanitizeRect([0, 0, 1, 1]), null, "whole page is no gain");
    assert.deepStrictEqual(lib.sanitizeRect([0.02, 0.3, 0.98, 0.72]), [0.02, 0.3, 0.98, 0.72]);
  });

  await test("isWholePage flags missing and full-page rects", function () {
    assert.strictEqual(lib.isWholePage(null), true);
    assert.strictEqual(lib.isWholePage([0, 0, 1, 1]), true);
    assert.strictEqual(lib.isWholePage([0.05, 0.95, 0.3, 1]), false);
  });

  await test("locateFigure renders, posts the page and returns a rect", async function () {
    lib.resetCache();
    let posted = null;
    const out = await lib.locateFigure({
      config: function () { return conf; },
      render: async function () { return { png: Buffer.from("fakepng") }; },
      post: async function (c, payload) {
        posted = payload;
        assert.strictEqual(c.model, "m");
        assert.ok(payload.messages[0].content[1].image_url.url.indexOf("data:image/png;base64,") === 0);
        return '{"x0":0.1,"y0":0.3,"x1":0.9,"y1":0.7}';
      },
    }, { pdfPath: "p.pdf", page: 168, hint: "图 4-30" });
    assert.deepStrictEqual(out, { rect: [0.1, 0.3, 0.9, 0.7], reason: "ok" });
    assert.ok(posted.messages[0].content[0].text.indexOf("图 4-30") > 0, "the caption hint must be in the prompt");
    assert.ok(posted.messages[0].content[0].text.indexOf("page 168") > 0);
  });

  await test("the same page+hint is only asked once", async function () {
    let calls = 0;
    const deps = {
      config: function () { return conf; },
      render: async function () { return { png: Buffer.from("x") }; },
      post: async function () { calls += 1; return '{"x0":0,"y0":0.2,"x1":1,"y1":0.7}'; },
    };
    await lib.locateFigure(deps, { pdfPath: "p2.pdf", page: 5, hint: "h" });
    await lib.locateFigure(deps, { pdfPath: "p2.pdf", page: 5, hint: "h" });
    assert.strictEqual(calls, 1);
  });

  await test("no vision config, render failure and junk replies degrade to null", async function () {
    lib.resetCache();
    assert.strictEqual((await lib.locateFigure({ config: function () { return { baseUrl: "", apiKey: "", model: "" }; } }, { pdfPath: "p", page: 1 })).reason, "vision_not_configured");
    assert.strictEqual((await lib.locateFigure({ config: function () { return conf; }, render: async function () { return {}; } }, { pdfPath: "p", page: 2 })).reason, "render_failed");
    const junk = await lib.locateFigure({ config: function () { return conf; }, render: async function () { return { png: Buffer.from("x") }; }, post: async function () { return "hmm"; } }, { pdfPath: "p", page: 3 });
    assert.strictEqual(junk.rect, null);
    const boom = await lib.locateFigure({ config: function () { return conf; }, render: async function () { return { png: Buffer.from("x") }; }, post: async function () { throw new Error("locate_http_500"); } }, { pdfPath: "p", page: 4 });
    assert.ok(/locate_failed/.test(boom.reason), boom.reason);
    assert.strictEqual((await lib.locateFigure({}, { pdfPath: "", page: 0 })).reason, "bad_request");
  });

  const passed = results.filter(Boolean).length;
  console.log("\nlocate-figure: " + passed + " passed, " + (results.length - passed) + " failed");
  if (passed !== results.length) process.exit(1);
})();
