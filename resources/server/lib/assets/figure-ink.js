// figure-ink.js — a coarse ink grid for a rendered page, so `figure-box` can tell the figure
// from the paragraph beside/below it.  Decoding is async once; the returned sampler is sync.
"use strict";

var GRID_X = 96;
var GRID_Y = 132;
var DARK = 170; // 0..255 luminance below this counts as ink

function defaultDecoder(pngBuffer, columns, rows) {
  var sharp = require("sharp");
  return sharp(pngBuffer).greyscale().resize(columns, rows, { fit: "fill" }).raw().toBuffer();
}

// createInk(pngBuffer, { decoder, columns, rows }) -> { ink(rect), grid }
async function createInk(pngBuffer, options) {
  options = options || {};
  var columns = Number(options.columns) || GRID_X;
  var rows = Number(options.rows) || GRID_Y;
  var decoder = options.decoder || defaultDecoder;
  var raw = await decoder(pngBuffer, columns, rows);
  if (!raw || raw.length < columns * rows) return null;
  var grid = new Float32Array(columns * rows);
  var channels = Math.max(1, Math.round(raw.length / (columns * rows)));
  // A scanned page has a grey paper tone; threshold against the page's own median, not a
  // constant, or the whole page counts as ink and every trim becomes a no-op.
  var samples = [];
  for (var sample = 0; sample < raw.length; sample += channels) samples.push(raw[sample]);
  samples.sort(function (a, b) { return a - b; });
  var median = samples.length ? samples[Math.floor(samples.length / 2)] : 255;
  var cutoff = Math.max(20, Math.min(DARK, median - 28));
  for (var y = 0; y < rows; y += 1) {
    for (var x = 0; x < columns; x += 1) {
      var value = raw[(y * columns + x) * channels];
      grid[y * columns + x] = value < cutoff ? 1 : 0;
    }
  }

  function coverage(index, count, axis) {
    var covered = 0;
    var total = 0;
    for (var i = 0; i < count; i += 1) {
      var on = axis === "x" ? grid[i * columns + index] : grid[index * columns + i];
      covered += on;
      total += 1;
    }
    return total ? covered / total : 0;
  }

  return {
    cutoff: cutoff,
    grid: grid,
    columns: columns,
    rows: rows,
    // rect is page-relative 0..1: [x0,y0,x1,y1]
    ink: function (rect) {
      if (!Array.isArray(rect) || rect.length !== 4) return { colCoverage: [], rowCoverage: [] };
      var x0 = Math.max(0, Math.min(1, Number(rect[0])));
      var y0 = Math.max(0, Math.min(1, Number(rect[1])));
      var x1 = Math.max(0, Math.min(1, Number(rect[2])));
      var y1 = Math.max(0, Math.min(1, Number(rect[3])));
      var cx0 = Math.floor(x0 * columns);
      var cx1 = Math.max(cx0 + 1, Math.ceil(x1 * columns));
      var cy0 = Math.floor(y0 * rows);
      var cy1 = Math.max(cy0 + 1, Math.ceil(y1 * rows));
      var colCoverage = [];
      for (var x = cx0; x < Math.min(cx1, columns); x += 1) colCoverage.push(coverage(x, Math.min(cy1, rows) - cy0, "x"));
      var rowCoverage = [];
      for (var y = cy0; y < Math.min(cy1, rows); y += 1) rowCoverage.push(coverage(y, Math.min(cx1, columns) - cx0, "y"));
      return { colCoverage: colCoverage, rowCoverage: rowCoverage };
    },
  };
}

module.exports = { createInk: createInk, GRID_X: GRID_X, GRID_Y: GRID_Y, DARK: DARK };
