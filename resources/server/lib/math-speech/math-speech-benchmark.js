"use strict";

var DEFAULT_WORKLOAD = Object.freeze([
  { latex: "x+1", expectedMode: "semantic" },
  { latex: "x^2+y^2=z^2", expectedMode: "semantic" },
  { latex: String.raw`\frac{1}{2}`, expectedMode: "semantic" },
  { latex: String.raw`\sqrt{x+1}`, expectedMode: "semantic" },
  { latex: String.raw`\sum_{i=1}^{n}a_i`, expectedMode: "semantic" },
  { latex: String.raw`\int_0^1 x^2\,dx`, expectedMode: "semantic" },
  { latex: "|A|", expectedMode: "structural" },
  { latex: String.raw`P(A\mid B)`, expectedMode: "structural" },
  { latex: "AB", expectedMode: "structural" },
  { latex: String.raw`\frac{\sqrt{x^2+1}}{a-b}`, expectedMode: "detailed" },
  { latex: String.raw`\frac{x+1}{y+2}`, expectedMode: "detailed" },
  { latex: String.raw`\frac{\sqrt{x+1}}{b-c}`, expectedMode: "detailed" },
]);

var DEFAULT_OPTIONS = Object.freeze({
  iterations: 1000,
  warmup: 1000,
  memoryIterations: 10000,
  successRatioAtLeast: 0.8,
  meanNodeCoverageAtLeast: 0.95,
  modeRatiosAtLeast: { semantic: 0.35, structural: 0.1, detailed: 0.1 },
  p50MsAtMost: 10,
  p95MsAtMost: 30,
  maxMsAtMost: 200,
});

function nowNs() {
  return process.hrtime.bigint();
}

function elapsedMs(start) {
  return Number(nowNs() - start) / 1000000;
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  var index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * ratio) - 1));
  return values[index];
}

function mean(values) {
  return values.length ? values.reduce(function (sum, value) { return sum + value; }, 0) / values.length : 0;
}

function standardDeviation(values, average) {
  if (!values.length) return 0;
  var variance = values.reduce(function (sum, value) { return sum + Math.pow(value - average, 2); }, 0) / values.length;
  return Math.sqrt(variance);
}

function hasUnsafeSpeech(speech) {
  if (typeof speech !== "string") return true;
  if (/[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/u.test(speech)) return true;
  if (/\\[A-Za-z]+|\$\$?|[{}]|<\/?[A-Za-z][^>]*>/.test(speech)) return true;
  if (/(?:^|[^A-Za-z])(undefined|null|NaN)(?:$|[^A-Za-z])/.test(speech)) return true;
  return ["这个公式", "来看这个公式", "请看公式", "公式如下"].some(function (phrase) { return speech.indexOf(phrase) !== -1; });
}

function validateResult(result, expectedMode, label) {
  var failures = [];
  if (!result || typeof result !== "object") return [label + ": result-not-object"];
  if (typeof result.speech !== "string") failures.push(label + ": speech-not-string");
  if (!result.decision || result.decision.sealed !== true) failures.push(label + ": unsealed");
  if (result.ok) {
    if (result.decision.mode !== expectedMode) failures.push(label + ": mode=" + result.decision.mode + ", expected=" + expectedMode);
    if (result.speech === "") failures.push(label + ": empty-success");
    if (!result.diagnostics || result.diagnostics.parseOk !== true) failures.push(label + ": parse-diagnostics-invalid");
    if (hasUnsafeSpeech(result.speech)) failures.push(label + ": unsafe-speech");
  } else {
    if (!result.decision || result.decision.mode !== "skip") failures.push(label + ": failed-result-not-skip");
    if (result.speech !== "") failures.push(label + ": skip-speech-not-empty");
  }
  return failures;
}

function runBenchmark(prepare, options) {
  var core = prepare;
  if (typeof core !== "function") core = require("./index").prepareMathSpeech;
  var supplied = options || {};
  var iterations = Number.isInteger(supplied.iterations) && supplied.iterations > 0 ? supplied.iterations : DEFAULT_OPTIONS.iterations;
  var warmup = Number.isInteger(supplied.warmup) && supplied.warmup >= 0 ? supplied.warmup : DEFAULT_OPTIONS.warmup;
  var workload = Array.isArray(supplied.workload) && supplied.workload.length ? supplied.workload : DEFAULT_WORKLOAD;
  var durations = [];
  var modeCounts = { semantic: 0, structural: 0, detailed: 0, skip: 0 };
  var coverageTotal = 0;
  var coverageCount = 0;
  var failures = [];
  var unexpectedSkips = 0;
  var successful = 0;
  for (var warm = 0; warm < warmup; warm += 1) core({ latex: workload[warm % workload.length].latex, locale: "zh-Hans", style: "concise" });
  for (var index = 0; index < iterations; index += 1) {
    var sample = workload[index % workload.length];
    var input = { latex: sample.latex, locale: "zh-Hans", style: "concise" };
    if (sample.mathml) {
      delete input.latex;
      input.mathml = sample.mathml;
    }
    if (sample.context) input.context = sample.context;
    var start = nowNs();
    var result;
    try {
      result = core(input);
    } catch (error) {
      result = null;
      failures.push((sample.id || sample.latex) + ": threw=" + error.message);
    }
    var duration = elapsedMs(start);
    durations.push(duration);
    var label = sample.id || "sample-" + index;
    validateResult(result, sample.expectedMode, label).forEach(function (failure) { failures.push(failure); });
    if (!result || !result.ok) {
      modeCounts.skip += 1;
      unexpectedSkips += 1;
    } else {
      successful += 1;
      var mode = result.decision.mode;
      modeCounts[mode] = (modeCounts[mode] || 0) + 1;
      if (result.diagnostics && Number.isFinite(result.diagnostics.nodeCoverage)) {
        coverageTotal += result.diagnostics.nodeCoverage;
        coverageCount += 1;
      } else {
        failures.push(label + ": missing-node-coverage");
      }
    }
  }
  durations.sort(function (left, right) { return left - right; });
  var average = mean(durations);
  var stats = {
    count: durations.length,
    minMs: percentile(durations, 0),
    p50Ms: percentile(durations, 0.5),
    p90Ms: percentile(durations, 0.9),
    p95Ms: percentile(durations, 0.95),
    p99Ms: percentile(durations, 0.99),
    maxMs: percentile(durations, 1),
    meanMs: average,
    standardDeviationMs: standardDeviation(durations, average),
  };
  var ratio = successful / iterations;
  var meanNodeCoverage = coverageCount ? coverageTotal / coverageCount : 0;
  var thresholdFailures = [];
  if (ratio < DEFAULT_OPTIONS.successRatioAtLeast) thresholdFailures.push("successRatio=" + ratio + " < " + DEFAULT_OPTIONS.successRatioAtLeast);
  if (unexpectedSkips !== 0) thresholdFailures.push("unexpectedSkips=" + unexpectedSkips + " != 0");
  if (meanNodeCoverage < DEFAULT_OPTIONS.meanNodeCoverageAtLeast) thresholdFailures.push("meanNodeCoverage=" + meanNodeCoverage + " < " + DEFAULT_OPTIONS.meanNodeCoverageAtLeast);
  Object.keys(DEFAULT_OPTIONS.modeRatiosAtLeast).forEach(function (mode) {
    var minimum = Math.max(1, Math.ceil(iterations * DEFAULT_OPTIONS.modeRatiosAtLeast[mode]));
    if ((modeCounts[mode] || 0) < minimum) thresholdFailures.push(mode + "Count=" + (modeCounts[mode] || 0) + " < " + minimum);
  });
  if (stats.p50Ms > DEFAULT_OPTIONS.p50MsAtMost) thresholdFailures.push("p50Ms=" + stats.p50Ms + " > " + DEFAULT_OPTIONS.p50MsAtMost);
  if (stats.p95Ms > DEFAULT_OPTIONS.p95MsAtMost) thresholdFailures.push("p95Ms=" + stats.p95Ms + " > " + DEFAULT_OPTIONS.p95MsAtMost);
  if (stats.maxMs > DEFAULT_OPTIONS.maxMsAtMost) thresholdFailures.push("maxMs=" + stats.maxMs + " > " + DEFAULT_OPTIONS.maxMsAtMost);
  failures = failures.concat(thresholdFailures);
  var report = {
    valid: failures.length === 0,
    iterations: iterations,
    warmupCalls: warmup,
    successCount: successful,
    successRatio: ratio,
    unexpectedSkips: unexpectedSkips,
    meanNodeCoverage: meanNodeCoverage,
    modeCounts: modeCounts,
    statistics: stats,
    thresholds: {
      successRatioAtLeast: DEFAULT_OPTIONS.successRatioAtLeast,
      unexpectedSkipsExactly: 0,
      meanNodeCoverageAtLeast: DEFAULT_OPTIONS.meanNodeCoverageAtLeast,
      modeRatiosAtLeast: DEFAULT_OPTIONS.modeRatiosAtLeast,
      p50MsAtMost: DEFAULT_OPTIONS.p50MsAtMost,
      p95MsAtMost: DEFAULT_OPTIONS.p95MsAtMost,
      maxMsAtMost: DEFAULT_OPTIONS.maxMsAtMost,
    },
    failures: failures,
  };
  if (iterations >= 100 && warmup >= 100 && !supplied.skipMemoryProbe) {
    var before = process.memoryUsage();
    for (var memoryIndex = 0; memoryIndex < DEFAULT_OPTIONS.memoryIterations; memoryIndex += 1) core({ latex: "x+1", locale: "zh-Hans" });
    var after = process.memoryUsage();
    report.memoryAfter10000Calls = {
      beforeHeapUsed: before.heapUsed,
      afterHeapUsed: after.heapUsed,
      heapDelta: after.heapUsed - before.heapUsed,
      beforeRss: before.rss,
      afterRss: after.rss,
      rssDelta: after.rss - before.rss,
    };
  }
  return report;
}

if (require.main === module) {
  var allSkip = process.argv.indexOf("--all-skip") !== -1;
  var injectedPrepare = allSkip ? function () {
    return { ok: false, speech: "", decision: { mode: "skip", sealed: true }, diagnostics: { nodeCoverage: 0 } };
  } : null;
  var report = runBenchmark(injectedPrepare);
  console.log(JSON.stringify(report, null, 2));
  if (!report.valid) process.exitCode = 1;
}

module.exports = {
  DEFAULT_WORKLOAD: DEFAULT_WORKLOAD,
  DEFAULT_OPTIONS: DEFAULT_OPTIONS,
  runBenchmark: runBenchmark,
};
