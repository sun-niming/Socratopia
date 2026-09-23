#!/usr/bin/env node
/**
 * probe-agent-gw.js — agent-gw.kimi.com 可用性探测
 *
 * 背景：2026-09-23 排查 "Model attempt execution lease expired" 报错时发现
 * 该错误由 Kimi 模型网关服务端产生，本地无任何记录手段。此脚本定时探测
 * 网关可达性并累计失败率，用于区分"服务端抖动"与"本地网络问题"。
 *
 * 用法：
 *   node tools/gateway-monitor/probe-agent-gw.js           # 探测一次并追加日志
 *   node tools/gateway-monitor/probe-agent-gw.js --report  # 统计最近 24h / 7d 失败率
 *
 * 退出码：0 = 全部可达；1 = 至少一个端点失败（供定时任务判读）。
 * 无第三方依赖。日志：tools/gateway-monitor/logs/probe-log.jsonl
 *
 * 注意：脚本故意不带 API key，401/404/405 均视为"网关可达"（只证明服务在线）。
 */
"use strict";

const https = require("https");
const fs = require("fs");
const path = require("path");

const LOG_DIR = path.join(__dirname, "logs");
const LOG_FILE = path.join(LOG_DIR, "probe-log.jsonl");
// Kimi Work 定时任务（automation_56386431，沙箱限制只能写自身目录）的日志，
// --report 时与本仓库日志合并统计。
const EXTRA_LOG_FILES = [
  path.join(
    process.env.APPDATA || "",
    "kimi-desktop/daimon-share/daimon/agents/main/blueprint/automations",
    "automation_56386431-11ae-4fc6-829e-0103c7146003/workspace/probe-log.jsonl"
  ),
];
const TIMEOUT_MS = 15000;

const ENDPOINTS = [
  { name: "coding", url: "https://agent-gw.kimi.com/coding" },
  { name: "coding-v1", url: "https://agent-gw.kimi.com/coding/v1" },
];

function probeOnce({ name, url }) {
  return new Promise((resolve) => {
    const started = Date.now();
    const req = https.get(url, { timeout: TIMEOUT_MS }, (res) => {
      res.resume(); // 丢弃 body
      res.on("end", () => {
        resolve({
          name,
          ok: true, // 拿到任何 HTTP 响应即视为网关在线
          httpStatus: res.statusCode,
          latencyMs: Date.now() - started,
          error: null,
        });
      });
    });
    req.on("timeout", () => {
      req.destroy(new Error(`timeout after ${TIMEOUT_MS}ms`));
    });
    req.on("error", (err) => {
      resolve({
        name,
        ok: false,
        httpStatus: null,
        latencyMs: Date.now() - started,
        error: err.code || err.message,
      });
    });
  });
}

function appendLog(record) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.appendFileSync(LOG_FILE, JSON.stringify(record) + "\n", "utf8");
}

function readLog() {
  const files = [LOG_FILE, ...EXTRA_LOG_FILES];
  const records = [];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      if (!line) continue;
      try {
        records.push(JSON.parse(line));
      } catch {
        // 跳过坏行
      }
    }
  }
  records.sort((a, b) => new Date(a.ts) - new Date(b.ts));
  return records;
}

function report() {
  const records = readLog();
  if (records.length === 0) {
    console.log("暂无探测记录。");
    return;
  }
  const now = Date.now();
  for (const [label, windowMs] of [
    ["最近 24 小时", 24 * 3600 * 1000],
    ["最近 7 天", 7 * 24 * 3600 * 1000],
    ["全部记录", Infinity],
  ]) {
    const inWindow = records.filter(
      (r) => now - new Date(r.ts).getTime() <= windowMs
    );
    if (inWindow.length === 0) continue;
    const totalProbes = inWindow.reduce((n, r) => n + r.results.length, 0);
    const failedProbes = inWindow.reduce(
      (n, r) => n + r.results.filter((x) => !x.ok).length,
      0
    );
    const runsFailed = inWindow.filter((r) =>
      r.results.some((x) => !x.ok)
    ).length;
    const latencies = inWindow
      .flatMap((r) => r.results)
      .filter((x) => x.ok)
      .map((x) => x.latencyMs)
      .sort((a, b) => a - b);
    const p50 = latencies.length
      ? latencies[Math.floor(latencies.length * 0.5)]
      : null;
    const p95 = latencies.length
      ? latencies[Math.floor(Math.min(latencies.length - 1, latencies.length * 0.95))]
      : null;
    const errKinds = {};
    for (const r of inWindow)
      for (const x of r.results)
        if (!x.ok) errKinds[x.error] = (errKinds[x.error] || 0) + 1;
    console.log(`\n[${label}]`);
    console.log(
      `  探测轮次: ${inWindow.length}（失败轮次 ${runsFailed}）  端点探测: ${totalProbes} 次，失败 ${failedProbes} 次（${((failedProbes / totalProbes) * 100).toFixed(1)}%）`
    );
    if (p50 !== null) console.log(`  延迟 p50=${p50}ms p95=${p95}ms`);
    const errs = Object.entries(errKinds);
    if (errs.length)
      console.log(
        `  错误分布: ${errs.map(([k, v]) => `${k}×${v}`).join(", ")}`
      );
  }
  const last = records[records.length - 1];
  console.log(
    `\n最近一次: ${last.ts} — ${
      last.results.every((x) => x.ok) ? "全部可达" : "存在失败"
    }`
  );
}

async function main() {
  if (process.argv.includes("--report")) {
    report();
    return;
  }
  const results = [];
  for (const ep of ENDPOINTS) {
    results.push(await probeOnce(ep));
  }
  const record = { ts: new Date().toISOString(), results };
  appendLog(record);
  for (const r of results) {
    console.log(
      `${r.ok ? "OK  " : "FAIL"} ${r.name}  status=${r.httpStatus ?? "-"}  ${r.latencyMs}ms${r.error ? `  error=${r.error}` : ""}`
    );
  }
  const allOk = results.every((r) => r.ok);
  console.log(allOk ? "网关全部可达" : "网关存在不可达端点");
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error("probe 执行异常:", err);
  process.exit(1);
});
