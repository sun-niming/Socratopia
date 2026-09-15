/**
 * Standalone knowledge-base builder worker (pure JS, no Python).
 *
 * Spawned as a detached child process by the textbook upload route after a
 * textbook is saved. Builds <textbookDir>/knowledge_base/{index.json, cards/,
 * teaching_map.json} which the runtime __KB_DISTILL__ then consumes verbatim.
 *
 * Pipeline:
 *   PDF  -> pdfjs text extract per page -> sparse image-dense pages rendered
 *           to PNG -> local OCR text -> text-only card model -> teaching map.
 *           Page images are never sent to card/premium teaching models.
 *           Independent ocrVision is optional only after explicit job consent.
 *   MD   -> read + split into page-like blocks -> chunk -> card model -> cards.
 *   PPTX -> extract slide text from OpenXML -> chunk -> card model -> cards.
 *
 * ZERO hardcoded config. Every model / apiKey / baseUrl arrives via env, which
 * the parent fills from global.__SOCRATOPIA_SET__ (set.json + settings.json):
 *   KB_CARD_BASEURL / KB_CARD_APIKEY / KB_CARD_MODEL / KB_CARD_MAXINPUT  (kb||strong)
 *   KB_ALLOW_REMOTE_VISION + KB_VISION_*  (independent ocrVision; explicit opt-in only)
 * Job inputs:
 *   KB_TEXTBOOK_DIR  KB_SRC_PATH  KB_FORMAT(pdf|markdown|pptx)  KB_TITLE  KB_LANG
 *   KB_START_PAGE  KB_END_PAGE  KB_PAGES_PER_CHUNK  KB_MAX_CHUNKS
 *
 * Usage: node kb-builder.mjs   (all input via env)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, renameSync, createReadStream, createWriteStream } from "fs";
import readline from "readline";
import { fileURLToPath, pathToFileURL } from "url";
import path from "path";
import { inflateRawSync } from "zlib";
import KBQuality from "./kb-quality.js";
import PdfJsPaths from "./pdfjs-paths.js";
import KBPublisher from "./kb-publisher.js";
import ResponsesCompat from "./responses-api-compat.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SUPERVISED = process.env.KB_SUPERVISED === "1";
let supervisorSequence = 0;
let supervisorRequests = null;
let supervisorWriter = null;
let supervisorResponses = null;

if (SUPERVISED) {
  supervisorRequests = new Map();
  supervisorWriter = createWriteStream(null, { fd: 3, autoClose: false });
  supervisorResponses = readline.createInterface({ input: createReadStream(null, { fd: 4, autoClose: false }), crlfDelay: Infinity });
  supervisorResponses.on("line", function (line) {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    const pending = supervisorRequests.get(message && message.id);
    if (!pending) return;
    supervisorRequests.delete(message.id);
    if (message.ok) pending.resolve(message.value);
    else {
      const error = new Error(String(message.error || "builder_request_failed"));
      error.code = String(message.error || "builder_request_failed");
      pending.reject(error);
    }
  });
}

function closeSupervisor(reason) {
  if (!SUPERVISED) return;
  const error = reason instanceof Error ? reason : new Error(String(reason || "builder_supervisor_closed"));
  if (supervisorRequests) {
    supervisorRequests.forEach(function (pending) { pending.reject(error); });
    supervisorRequests.clear();
  }
  if (supervisorResponses) {
    try { if (supervisorResponses.input) supervisorResponses.input.destroy(); } catch (_) {}
    try { supervisorResponses.close(); } catch (_) {}
    supervisorResponses = null;
  }
  if (supervisorWriter) {
    try { supervisorWriter.end(); } catch (_) {}
    supervisorWriter = null;
  }
}

function supervisorCall(message) {
  if (!SUPERVISED || !supervisorWriter) return Promise.reject(new Error("builder_protocol_unavailable"));
  const id = "rpc-" + process.pid + "-" + (++supervisorSequence);
  return new Promise(function (resolve, reject) {
    supervisorRequests.set(id, { resolve, reject });
    supervisorWriter.write(JSON.stringify(Object.assign({ v: 1, id }, message)) + "\n", function (error) {
      if (!error) return;
      supervisorRequests.delete(id);
      reject(error);
    });
  });
}

function requestPublish() {
  if (!SUPERVISED) return Promise.resolve({ published: false });
  return new Promise(function (resolve, reject) {
    const writer = createWriteStream(null, { fd: 5, autoClose: false });
    const responses = readline.createInterface({ input: createReadStream(null, { fd: 6, autoClose: false }), crlfDelay: Infinity });
    responses.once("line", function (line) {
      let message;
      try { message = JSON.parse(line); } catch { message = null; }
      responses.close();
      if (message && message.ok) resolve(message.value);
      else reject(Object.assign(new Error(message && message.error || "builder_commit_failed"), { code: message && message.error || "builder_commit_failed" }));
    });
    writer.end(JSON.stringify({ v: 1, type: "publish" }) + "\n");
  });
}

// --- config from env (single source of truth = parent's __SOCRATOPIA_SET__) ---
const ENV = process.env;
const TEXTBOOK_DIR = ENV.KB_TEXTBOOK_DIR || "";
const SRC_PATH = ENV.KB_SRC_PATH || "";
const FORMAT = (ENV.KB_FORMAT || "pdf").toLowerCase();
const TITLE = ENV.KB_TITLE || "";
const LANG = ENV.KB_LANG || "chinese";
const START_PAGE = parseInt(ENV.KB_START_PAGE || "1", 10);
const END_PAGE = parseInt(ENV.KB_END_PAGE || "0", 10) || 0; // 0 = to end
const PAGES_PER_CHUNK = Math.max(1, Math.min(6, parseInt(ENV.KB_PAGES_PER_CHUNK || "4", 10) || 4));
const MAX_CHUNKS = Math.max(1, Math.min(50, parseInt(ENV.KB_MAX_CHUNKS || "50", 10) || 50));
const BUILD_CONCURRENCY = Math.max(1, Math.min(4, parseInt(ENV.KB_CONCURRENCY || "1", 10) || 1));
const CHUNK_RETRIES = Math.max(0, Math.min(4, parseInt(ENV.KB_CHUNK_RETRIES || "2", 10) || 0));

const CARD = {
  baseUrl: (ENV.KB_CARD_BASEURL || "").replace(/\/$/, ""),
  apiKey: ENV.KB_CARD_APIKEY || "",
  model: ENV.KB_CARD_MODEL || "",
  maxInput: parseInt(ENV.KB_CARD_MAXINPUT || "8000", 10),
};
// Premium (high-value) model — used only to escalate ONCE when the mini card
// model returns 0 cards / unparseable JSON for a chunk. Optional: absent =>
// no escalation (the existing text-only + vision fallbacks still apply).
const PREMIUM = {
  baseUrl: (ENV.KB_PREMIUM_BASEURL || "").replace(/\/$/, ""),
  apiKey: ENV.KB_PREMIUM_APIKEY || "",
  model: ENV.KB_PREMIUM_MODEL || "",
};
const PREMIUM_OK = SUPERVISED ? !!PREMIUM.model : !!(PREMIUM.baseUrl && PREMIUM.apiKey && PREMIUM.model);
const REMOTE_VISION_ALLOWED = ENV.KB_ALLOW_REMOTE_VISION === "1";
const VISION = {
  baseUrl: (ENV.KB_VISION_BASEURL || "").replace(/\/$/, ""),
  apiKey: ENV.KB_VISION_APIKEY || "",
  model: ENV.KB_VISION_MODEL || "",
};
const VISION_OK = REMOTE_VISION_ALLOWED && (SUPERVISED ? !!VISION.model : !!(VISION.baseUrl && VISION.apiKey && VISION.model));

const SPARSE_TEXT_THRESHOLD = 80; // chars; below this a PDF page is "image-dense"
const MAX_SOURCE_PAGES = 200;
const MAX_RENDERED_IMAGES = 5;
const MAX_CANVAS_PIXELS = 16 * 1024 * 1024;
const MAX_CANVAS_SIDE = 2600;
const MAX_PNG_BYTES = 12 * 1024 * 1024;
const MAX_RETAINED_IMAGE_BYTES = 64 * 1024 * 1024;
const KB_PATHS = KBPublisher.paths(TEXTBOOK_DIR);
const KB_DIR = KB_PATHS.stageDir;
const STATUS_PATH = path.join(KB_DIR, "build_status.json");
const BUILD_LOG = []; // per-chunk events, flushed into build_status.json
const EXTRACTION_STATS = { sourcePages: 0, requestedPages: 0, sourceChunks: 0, pages: 0, sparsePages: 0, garbledPages: 0, renderedPages: 0, successfulPages: [], failedPages: [], sourcesByPage: {}, processingComplete: false, transcriptionComplete: false };

function log(msg) { process.stdout.write("[kb-build] " + msg + "\n"); }

function sourceLimitError(code, actual, limit, unit) {
  const error = new Error(code);
  error.code = code;
  error.actual = actual;
  error.limit = limit;
  error.unit = unit;
  return error;
}

function assertSourceWithinLimit(code, actual, limit, unit) {
  if (actual > limit) throw sourceLimitError(code, actual, limit, unit);
}

function failureStatus(error) {
  const message = String(error && (error.code || error.message) || "builder_failed");
  const status = { error: message, errorCode: message, activationEligible: false, extraction: Object.assign({}, EXTRACTION_STATS) };
  if (Number.isSafeInteger(error && error.actual)) status.actual = error.actual;
  if (Number.isSafeInteger(error && error.limit)) status.limit = error.limit;
  if (error && error.unit) status.unit = String(error.unit);
  return status;
}

function writeStatus(state, extra) {
  try {
    mkdirSync(KB_DIR, { recursive: true });
    writeStatus._data = Object.assign(
      { state, title: TITLE, format: FORMAT, updatedAt: new Date().toISOString() },
      writeStatus._data || {}, extra || {}, { state, updatedAt: new Date().toISOString() },
    );
    if (BUILD_LOG.length) writeStatus._data.log = BUILD_LOG.slice();
    writeFileSync(STATUS_PATH, JSON.stringify(writeStatus._data, null, 2), "utf-8");
  } catch (e) { log("writeStatus failed: " + (e && e.message)); }
}

function appendBuildLog(entry) {
  if (BUILD_LOG.length >= 2000) return;
  var next = Object.assign({ ts: new Date().toISOString() }, entry);
  if (Buffer.byteLength(JSON.stringify(next), "utf8") <= 16 * 1024) BUILD_LOG.push(next);
}

// ---------------------------------------------------------------------------
// pdfjs + @napi-rs/canvas loader (resolve by absolute path; ESM ignores NODE_PATH)
// Mirrors pdf-worker.mjs resolution: packaged (.next/node_modules) then dev.
// ---------------------------------------------------------------------------
function resolveDep(subpath) {
  const prod = path.join(__dirname, "..", ".next", "node_modules", subpath);
  if (existsSync(prod)) return pathToFileURL(prod).href;
  const dev = path.join(__dirname, "..", "..", "node_modules", subpath);
  if (existsSync(dev)) return pathToFileURL(dev).href;
  for (const root of (process.env.NODE_PATH || "").split(path.delimiter).filter(Boolean)) {
    const p = path.join(root, subpath);
    if (existsSync(p)) return pathToFileURL(p).href;
  }
  throw new Error("dependency not found: " + subpath);
}

function resolveDepDir(subpath) {
  return PdfJsPaths.resourceDir(fileURLToPath(resolveDep(subpath)));
}

let _pdfjs = null, _canvas = null;
async function loadPdfStack() {
  if (_pdfjs) return;
  _canvas = await import(resolveDep("@napi-rs/canvas/index.js"));
  // pdfjs reads these globals at module-load time; provide the real ones.
  globalThis.DOMMatrix ??= _canvas.DOMMatrix;
  globalThis.ImageData ??= _canvas.ImageData;
  globalThis.Path2D ??= _canvas.Path2D;
  const pdfjs = await import(resolveDep("pdfjs-dist/legacy/build/pdf.mjs"));
  pdfjs.GlobalWorkerOptions.workerSrc = resolveDep("pdfjs-dist/legacy/build/pdf.worker.mjs");
  _pdfjs = pdfjs;
}

function canvasFactory() {
  const { createCanvas } = _canvas;
  return {
    create(w, h) { const c = createCanvas(w, h); return { canvas: c, context: c.getContext("2d") }; },
    reset(co, w, h) { co.canvas.width = w; co.canvas.height = h; },
    destroy(co) { co.canvas.width = 0; co.canvas.height = 0; },
  };
}

// ---------------------------------------------------------------------------
// HTTP helpers — use raw http/https (Next patches global.fetch; avoid it), same
// pattern as server.js __KB_DISTILL_IMPL__.
// ---------------------------------------------------------------------------
async function postJSON(baseUrl, apiKey, payload, timeoutMs, purpose, page) {
  const cachePurpose = purpose || "kb-builder";
  const cacheModel = String((payload && payload.model) || "");
  if (/^gpt-5\.6/i.test(cacheModel)) {
    payload = Object.assign({}, payload, {
      prompt_cache_key: ("socratopia:" + cachePurpose + ":" + cacheModel).toLowerCase().replace(/[^a-z0-9_.:-]/g, "-").slice(0, 64),
      prompt_cache_retention: "24h",
    });
  }
  // deepseek 系模型默认开启思考,会把 max_tokens 烧在 reasoning_content 上、content 返回空串,
  // 卡片 JSON 随之解析失败。与 callLLM 的处理保持一致显式关闭。
  if (/^deepseek/i.test(cacheModel)) {
    payload = Object.assign({}, payload, { thinking: { type: "disabled" } });
  }
  if (SUPERVISED) {
    const result = await supervisorCall({ type: "model", purpose: purpose || "kb-builder-cards", page: Number(page) || 1, payload });
    return String(result && result.content || "");
  }
  const url = new URL(baseUrl.replace(/\/$/, "") + "/chat/completions");
  const parsed = await ResponsesCompat.postChatCompletionsJson(url, payload, {
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + apiKey,
      "Connection": "close",
    },
    timeoutMs,
    timeoutMessage: "timeout " + timeoutMs + "ms",
  });
  if (parsed.usage) {
    const details = parsed.usage.prompt_tokens_details || {};
    console.log("[direct-llm-cache]", { model: cacheModel, purpose: cachePurpose, promptTokens: parsed.usage.prompt_tokens, cachedTokens: details.cached_tokens || 0, cacheWriteTokens: details.cache_write_tokens || 0 });
  }
  const msg = parsed.choices && parsed.choices[0] && parsed.choices[0].message;
  if (!msg) throw new Error("no choices[0].message");
  return msg.content || msg.reasoning_content || "";
}

/**
 * Call the card model. When images are provided, builds a multimodal content
 * array (text + image_url data URLs). Falls back gracefully when images are
 * rejected.
 *
 * @param {string} system
 * @param {string} user
 * @param {Array<{page:number, pngB64:string}>|null} images
 * @param {number} maxTokens
 * @param {boolean} forceJson  default true; set false to skip response_format
 */
async function callCardLLM(system, user, images, maxTokens, forceJson, modelBlock) {
  const block = modelBlock || CARD;
  const hasImages = images && images.length > 0;
  let content;
  if (hasImages) {
    content = [
      { type: "text", text: user },
    ];
    for (const img of images) {
      content.push({
        type: "image_url",
        image_url: { url: "data:image/png;base64," + img.pngB64 },
      });
    }
  } else {
    content = user;
  }
  const payload = {
    model: block.model, max_tokens: maxTokens || 8096, stream: false,
    messages: [{ role: "system", content: system }, { role: "user", content }],
  };
  if (forceJson !== false) {
    payload.response_format = { type: "json_object" };
  }
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await postJSON(block.baseUrl, block.apiKey, payload, 180000, "kb-builder-cards", hasImages && images[0] && images[0].page);
    } catch (error) {
      lastError = error;
      const message = String((error && error.message) || error || "");
      const retryable = /ENOTFOUND|ECONNRESET|ETIMEDOUT|timeout|HTTP\s+(408|429|5\d\d)\b/i.test(message);
      if (!retryable || attempt >= 2) throw error;
      const delay = 750 * Math.pow(2, attempt);
      appendBuildLog({ type: "model_retry", attempt: attempt + 1, delayMs: delay, error: message.slice(0, 300) });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError || new Error("model request failed");
}

// Independent OCR vision call. The supervisor exposes it only when both the
// ocrVision configuration and this individual Builder job are explicitly authorized.
async function callVision(pngB64, page) {
  return postJSON(VISION.baseUrl, VISION.apiKey, {
    model: VISION.model, max_tokens: 4096, stream: false,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: VISION_PROMPT },
        { type: "image_url", image_url: { url: "data:image/png;base64," + pngB64 } },
      ],
    }],
  }, 120000, "kb-builder-vision", page);
}

// Balanced-brace JSON extractor (reasoning models may wrap JSON in prose).
function extractBalanced(str, from) {
  let depth = 0, inStr = false, esc = false;
  for (let i = from; i < str.length; i++) {
    const ch = str[i];
    if (inStr) {
      if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return str.slice(from, i + 1); }
  }
  return null;
}
function parseLLMJson(content, anchorKey) {
  try { return JSON.parse(content.trim()); } catch (e0) {
    const re = new RegExp('\\{\\s*"' + anchorKey + '"', "g");
    let best = null, bestN = -1, m;
    while ((m = re.exec(content)) !== null) {
      const blk = extractBalanced(content, m.index);
      if (!blk) continue;
      try {
        const cand = JSON.parse(blk);
        const n = (cand && cand[anchorKey] && cand[anchorKey].length) || 0;
        if (n > bestN) { bestN = n; best = cand; }
      } catch (eb) { /* keep scanning */ }
    }
    if (best) return best;
    throw e0;
  }
}

// ---------------------------------------------------------------------------
// Prompts (simplified-Chinese; ported verbatim from the proven server.js path)
// ---------------------------------------------------------------------------
const VISION_PROMPT = "你是一名教材内容转录专家。请将这张教材页面图片中的所有文字和内容精确转录为纯文本。\n要求:\n- 保留原文的段落结构和层次\n- 代码/命令保持原格式\n- 表格用文本形式表示\n- 图表/流程图用简洁文字描述其内容和含义\n- 公式优先用 Markdown LaTeX 表示:行内 $...$,独立公式 $$...$$,矩阵/分段式用 bmatrix/cases/aligned 等环境\n- 忽略页眉、页脚、页码\n- 只输出转录文本,不加任何额外说明或标记\n- 只用简体中文输出(英文术语/代码保持原文)";

const CARD_SYSTEM = "你是一名严谨的学科知识库构建专家,正在把一本教材的原文整理成\u201c已核实知识卡片\u201d。\n这些卡片将来会被一个能力较弱、较廉价的大模型直接用于教学,因此卡片必须:\n1. 准确——只依据给定原文,不臆造原文没有的内容;\n2. 自足——弱模型不读原文也能照卡片把这个知识点讲清楚;\n3. 可核实——凡是你对某条事实没有十足把握(可能是教材笔误、版本差异、记忆模糊),必须把该卡片的 needs_verification 置为 true,并在 verify_query 写出用于联网核实的检索式;\n4. 可渲染——涉及公式、矩阵、分段式、递推式、坐标、图形标注或表格化结构时,优先保留/改写为 Markdown LaTeX:行内用 $...$,独立公式用 $$...$$;矩阵用 \\begin{bmatrix}...\\end{bmatrix},对齐用 aligned/cases/array。不要用纯 ASCII 方框硬画数学结构,除非原文就是代码或命令。\n\n只用简体中文输出。";

function cardUserPrompt(title, start, end, body, hasImages) {
  let extra = "";
  if (hasImages) {
    extra = "\n\n注：以上原文对应的教材页面截图已一并提供（image 格式），请结合图片中的完整内容（图表、公式、特殊排版等）进行抽取。";
  }
  return "下面是教材《" + title + "》第 " + start + "-" + end + " 页的原文(含页码标记)。\n请从中抽取**独立的知识点**,每个知识点产出一张卡片。忽略目录、页眉页脚、纯插图说明。\n\n严格输出如下 JSON(不要加 markdown 代码块标记,不要任何额外文字):\n" +
    "{\"cards\":[{\"title\":\"知识点名称(简短)\",\"definition\":\"准确、自足的定义/说明,弱模型据此即可讲解\",\"key_points\":[\"要点1\",\"要点2\"],\"examples\":[\"来自或贴合原文的示例;公式/矩阵/分段式优先用 Markdown LaTeX,代码用文本表示\"],\"misconceptions\":[\"学习者常见的错误理解(如能从原文推断)\"],\"qa_pairs\":[{\"q\":\"考察该点的问题\",\"a\":\"标准答案\"}],\"difficulty\":1,\"prerequisites\":[\"前置知识点名称\"],\"source_pages\":[" + start + "," + end + "],\"needs_verification\":false,\"verify_query\":\"\"}]}\n\n要求:\n- difficulty 取 1-3(1 入门 / 2 进阶 / 3 综合)。\n- source_pages 必须落在 " + start + "-" + end + " 范围内,指向该知识点实际出现的页。\n- 如果知识点包含数学表达、二维布局、表格关系、图形标注或递推/DP/矩阵等结构,请在 definition/key_points/examples/qa_pairs 中给出 weak 可直接照用的 LaTeX 写法,例如 $$\\begin{bmatrix} A & B \\\\ C & D \\end{bmatrix}$$、$$f(n)=\\begin{cases}1,&n=1\\\\f(n-1)+f(n-2),&n>1\\end{cases}$$。\n- 对任何你不确定的事实,把该卡片 needs_verification 设为 true,并写出 verify_query。\n- 没有内容可抽取时返回 {\"cards\":[]}。\n\n原文如下:\n----------------\n" + body + "\n----------------" + extra;
}

const MAP_SYSTEM = "你是课程设计专家。给定一组知识卡片(来自同一教材的连续页面),请将它们按教学逻辑组织为 2-5 个阶段(phase),使得前序阶段是后续阶段的前置知识。\n\n只用简体中文输出。";

function mapUserPrompt(title, start, end, cardList) {
  return "下面是从教材《" + title + "》第 " + start + "-" + end + " 页提取出的知识卡片列表(标题+难度):\n" + cardList + "\n\n请输出如下 JSON(不要 markdown 标记,不要额外文字):\n{\"teaching_sequence\":[{\"phase\":1,\"label\":\"阶段名(简短)\",\"card_ids\":[\"卡片title1\",\"卡片title2\"],\"teach_goal\":\"本阶段教学目标(一句话)\",\"branches\":[\"可延伸方向(选填)\"]}]}\n\n要求:\n- 所有卡片必须恰好出现一次,不遗漏不重复。\n- 前序阶段的知识是后续阶段的前置条件。\n- difficulty 低的卡片优先放前面。\n- card_ids 用卡片的 title 字段。";
}

function slugify(title, idx) {
  let base = String(title || "").replace(/[^\w\u4e00-\u9fff]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase();
  base = base ? base.slice(0, 40) : "concept";
  return String(idx).padStart(3, "0") + "_" + base;
}

// ---------------------------------------------------------------------------
// Card normalization — sanitize LLM output so one bad card never drops a chunk.
// ---------------------------------------------------------------------------
function toArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v) return [v];
  return [];
}
function toQAPairs(v) {
  if (!Array.isArray(v)) return [];
  return v.map(function (x) {
    if (!x || typeof x !== "object") return { q: "", a: "" };
    return { q: typeof x.q === "string" ? x.q : String(x.q || ""), a: typeof x.a === "string" ? x.a : String(x.a || "") };
  }).filter(function (x) { return x.q || x.a; });
}
function normalizeCard(raw, chunkStart, chunkEnd) {
  if (!raw || typeof raw !== "object") return null;
  var title = typeof raw.title === "string" ? raw.title.trim() : "";
  var definition = typeof raw.definition === "string" ? raw.definition.trim() : (typeof raw.definition === "object" ? JSON.stringify(raw.definition) : String(raw.definition || ""));
  var keyPoints = toArray(raw.key_points || raw.keyPoints || raw.keypoints);
  var examples = toArray(raw.examples);
  var misconceptions = toArray(raw.misconceptions);
  var prerequisites = toArray(raw.prerequisites);
  var qaPairs = toQAPairs(raw.qa_pairs || raw.qaPairs);
  var difficulty = (typeof raw.difficulty === "number" && raw.difficulty >= 1 && raw.difficulty <= 3) ? raw.difficulty : null;
  var sourceValues = Array.isArray(raw.source_pages)
    ? raw.source_pages.map(function (value) { return Number(value); }).filter(function (value) {
        return Number.isFinite(value) && value >= chunkStart && value <= chunkEnd;
      })
    : [];
  var sourcePages = sourceValues.length
    ? [Math.min.apply(Math, sourceValues), Math.max.apply(Math, sourceValues)]
    : [chunkStart, chunkEnd];
  var needsVerification = !!raw.needs_verification;
  var verifyQuery = typeof raw.verify_query === "string" ? raw.verify_query.trim() : "";
  // Reject cards with neither title nor definition (hallucinated empty object)
  if (!title && !definition) return null;
  return {
    title: title,
    definition: definition,
    key_points: keyPoints,
    examples: examples,
    misconceptions: misconceptions,
    qa_pairs: qaPairs,
    difficulty: difficulty,
    prerequisites: prerequisites,
    source_pages: sourcePages,
    needs_verification: needsVerification,
    verify_query: verifyQuery,
  };
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------
async function extractPdfPageText(page) {
  const content = await page.getTextContent();
  const lines = [];
  let lastY = null;
  for (const item of content.items) {
    if (!("str" in item)) continue;
    const y = item.transform[5];
    if (lastY !== null && Math.abs(y - lastY) > 2) lines.push("\n");
    lines.push(item.str);
    lastY = y;
  }
  return lines.join("").trim();
}

async function renderPageToPngB64(page) {
  const base = page.getViewport({ scale: 1 });
  const requestedScale = 150 / 72;
  const sideScale = Math.min(1, MAX_CANVAS_SIDE / Math.max(base.width, base.height));
  const pixelScale = Math.min(1, Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, base.width * base.height)));
  const scale = Math.min(requestedScale, sideScale, pixelScale);
  const vp = page.getViewport({ scale });
  const width = Math.ceil(vp.width), height = Math.ceil(vp.height);
  if (width < 1 || height < 1 || width > MAX_CANVAS_SIDE || height > MAX_CANVAS_SIDE || width * height > MAX_CANVAS_PIXELS) throw new Error("builder_canvas_limit");
  const { createCanvas } = _canvas;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  await page.render({ canvasContext: ctx, viewport: vp, canvasFactory: canvasFactory() }).promise;
  const png = canvas.toBuffer("image/png");
  if (png.length > MAX_PNG_BYTES) throw new Error("builder_png_limit");
  return png.toString("base64");
}

// Extract text from every PDF page.  Image-dense pages (sparse text + visual
// operators) are also rasterized to PNG and stored alongside the text, so the
// multimodal card model can read them directly — no separate vision stage.
//
// Returns [{page, text, pngB64?}]
async function extractPdf() {
  await loadPdfStack();
  const data = readFileSync(SRC_PATH);
  const doc = await _pdfjs.getDocument({
    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    useSystemFonts: true, disableAutoFetch: true, disableStream: true,
    cMapUrl: resolveDepDir("pdfjs-dist/cmaps"),
    cMapPacked: true,
    standardFontDataUrl: resolveDepDir("pdfjs-dist/standard_fonts"),
    wasmUrl: resolveDepDir("pdfjs-dist/wasm"),
  }).promise;
  const total = doc.numPages;
  const s = Math.max(1, START_PAGE);
  const e = END_PAGE > 0 ? Math.min(total, END_PAGE) : total;
  const requestedPages = Math.max(0, e - s + 1);
  EXTRACTION_STATS.sourcePages = total;
  EXTRACTION_STATS.requestedPages = requestedPages;
  if (requestedPages > MAX_SOURCE_PAGES) {
    try { await doc.destroy(); } catch (_) {}
    throw sourceLimitError("builder_source_page_limit", requestedPages, MAX_SOURCE_PAGES, "pages");
  }
  const pages = [];
  let renderedCount = 0;
  let retainedImageBytes = 0;
  for (let pn = s; pn <= e; pn++) {
    const page = await doc.getPage(pn);
    let text = await extractPdfPageText(page);
    let quality = KBQuality.assessPdfText(text, { expectedCjk: /^chinese/.test(LANG) });
    let pageResolved = !quality.renderRecommended;
    let pageSource = pageResolved ? "text-layer" : "unresolved";
    let pageError = null;
    EXTRACTION_STATS.pages++;
    if (quality.sparse) EXTRACTION_STATS.sparsePages++;
    if (quality.garbled) EXTRACTION_STATS.garbledPages++;
    if (SUPERVISED && (quality.renderRecommended || text.length < SPARSE_TEXT_THRESHOLD)) {
      try {
        const local = await supervisorCall({ type: "ocr-page", page: pn });
        if (local && local.text && !local.error && local.source !== "unresolved") {
          text = String(local.text);
          quality = KBQuality.assessPdfText(text, { expectedCjk: /^chinese/.test(LANG) });
          pageResolved = true;
          pageSource = String(local.source || "local-ocr");
          log("p." + pn + " recovered by supervised local OCR source=" + String(local.source || "unknown"));
        } else { pageResolved = false; pageSource = "unresolved"; pageError = String(local && local.error || "builder_ocr_unresolved"); }
      } catch (ocrError) {
        pageResolved = false;
        pageSource = "unresolved";
        pageError = String(ocrError && ocrError.code || "builder_ocr_failed");
        log("p." + pn + " supervised local OCR failed: " + String(ocrError && ocrError.code || "builder_ocr_failed"));
      }
    }
    if (pageResolved && text.trim()) EXTRACTION_STATS.successfulPages.push(pn);
    else EXTRACTION_STATS.failedPages.push({ page: pn, reason: pageError || "unresolved" });
    EXTRACTION_STATS.sourcesByPage[String(pn)] = pageResolved && text.trim() ? pageSource : "unresolved";
    let pngB64 = null;
    if (quality.renderRecommended || text.length < SPARSE_TEXT_THRESHOLD) {
      // Sparse text + has drawn/image ops => image-dense page; render it.
      let hasVisual = quality.garbled;
      try {
        const ops = await page.getOperatorList();
        const OPS = _pdfjs.OPS || {};
        for (const fn of ops.fnArray) {
          if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject ||
              fn === OPS.paintJpegXObject || fn === OPS.paintImageMaskXObject ||
              fn === OPS.constructPath || fn === OPS.fill || fn === OPS.stroke ||
              fn === OPS.fillStroke) { hasVisual = true; break; }
        }
      } catch (e2) { hasVisual = true; }
      if (hasVisual && renderedCount < MAX_RENDERED_IMAGES) {
        try {
          const rendered = await renderPageToPngB64(page);
          const renderedBytes = Buffer.byteLength(rendered, "base64");
          if (retainedImageBytes + renderedBytes > MAX_RETAINED_IMAGE_BYTES) throw new Error("builder_image_budget_exhausted");
          pngB64 = rendered;
          retainedImageBytes += renderedBytes;
          renderedCount++;
          EXTRACTION_STATS.renderedPages++;
          log("p." + pn + " text quality=" + (quality.garbled ? "garbled" : "sparse") +
            " chars=" + quality.length + "; rendered to PNG (" +
            (pngB64 ? Math.round(pngB64.length * 3 / 4 / 1024) + "KB" : "fail") + ")");
        } catch (ev) { log("render failed p." + pn + ": " + (ev && ev.message)); }
      }
    }
    // Always push — card model can extract text from images even if pdfjs got nothing.
    pages.push({ page: pn, text: text || "", ...(pngB64 ? { pngB64 } : {}) });
  }
  await doc.destroy();
  EXTRACTION_STATS.processingComplete = true;
  EXTRACTION_STATS.transcriptionComplete = EXTRACTION_STATS.failedPages.length === 0 && EXTRACTION_STATS.successfulPages.length === requestedPages;
  log("PDF pages " + s + "-" + e + " of " + total + "; extracted " + pages.length + " (rendered " + renderedCount + " image pages)");
  return pages;
}

// Markdown: split into page-like blocks by top-level headings (no rendering).
function extractMarkdown() {
  const raw = readFileSync(SRC_PATH, "utf-8");
  const lines = raw.split(/\r?\n/);
  const blocks = [];
  let cur = [];
  for (const line of lines) {
    if (/^#{1,2}\s+\S/.test(line) && cur.join("").trim()) { blocks.push(cur.join("\n")); cur = []; }
    cur.push(line);
  }
  if (cur.join("").trim()) blocks.push(cur.join("\n"));
  EXTRACTION_STATS.sourcePages = blocks.length;
  EXTRACTION_STATS.requestedPages = blocks.length;
  assertSourceWithinLimit("builder_source_page_limit", blocks.length, MAX_SOURCE_PAGES, "markdown_blocks");
  const pages = [];
  blocks.forEach((b, i) => { const t = b.trim(); if (t) pages.push({ page: i + 1, text: t }); });
  log("Markdown split into " + pages.length + " blocks");
  return pages;
}

function readZipEntries(filePath) {
  const buf = readFileSync(filePath);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 0x10000 - 22); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("invalid zip: end of central directory not found");
  const total = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  let p = cdOffset;
  for (let i = 0; i < total; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("invalid zip: central directory entry");
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString("utf-8");
    p += 46 + nameLen + extraLen + commentLen;
    if (buf.readUInt32LE(localOffset) !== 0x04034b50) continue;
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const data = buf.slice(dataStart, dataStart + compSize);
    if (method === 0) entries.set(name, data);
    else if (method === 8) entries.set(name, inflateRawSync(data));
  }
  return entries;
}

function xmlText(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

function extractPptxSlideText(xml) {
  const parts = [];
  const re = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const t = xmlText(m[1]).replace(/\s+/g, " ").trim();
    if (t) parts.push(t);
  }
  return parts.join("\n").trim();
}

function extractCoreProp(entries, tag) {
  const core = entries.get("docProps/core.xml");
  if (!core) return null;
  const xml = core.toString("utf-8");
  const m = xml.match(new RegExp("<(?:[^:>]+:)?" + tag + "\\b[^>]*>([\\s\\S]*?)</(?:[^:>]+:)?" + tag + ">"));
  return m ? xmlText(m[1]).trim() || null : null;
}

function extractPptx() {
  const entries = readZipEntries(SRC_PATH);
  const slideNames = Array.from(entries.keys())
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => Number((a.match(/slide(\d+)\.xml/i) || [0, 0])[1]) - Number((b.match(/slide(\d+)\.xml/i) || [0, 0])[1]));
  EXTRACTION_STATS.sourcePages = slideNames.length;
  EXTRACTION_STATS.requestedPages = slideNames.length;
  assertSourceWithinLimit("builder_source_page_limit", slideNames.length, MAX_SOURCE_PAGES, "slides");
  const pages = [];
  for (let i = 0; i < slideNames.length; i++) {
    const text = extractPptxSlideText(entries.get(slideNames[i]).toString("utf-8"));
    if (text) pages.push({ page: i + 1, text });
  }
  const metaTitle = extractCoreProp(entries, "title");
  log("PPTX slides " + slideNames.length + "; extracted text from " + pages.length + (metaTitle ? "; title=" + metaTitle : ""));
  return pages;
}

function chunkPages(pages, perChunk) {
  const chunks = [];
  for (let i = 0; i < pages.length; i += perChunk) {
    const group = pages.slice(i, i + perChunk);
    const body = group.map((p) => "[第" + p.page + "页]\n" + p.text).join("\n\n");
    const images = group.filter((p) => p.pngB64).slice(0, 1).map((p) => ({ page: p.page, pngB64: p.pngB64 }));
    chunks.push({ start_page: group[0].page, end_page: group[group.length - 1].page, text: body, images });
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Optional final fallback: transcribe rendered images with independent ocrVision.
// Card and premium teaching models never receive page images.
// ---------------------------------------------------------------------------
async function transcribeImagesViaVision(chunk) {
  if (!VISION_OK || !chunk.images || !chunk.images.length) return null;
  log("fallback: transcribing " + chunk.images.length + " image(s) via vision model");
  const transcribed = [];
  for (const img of chunk.images) {
    try {
      const text = (await callVision(img.pngB64, img.page) || "").trim();
      if (text) transcribed.push("[第" + img.page + "页 视觉转录]\n" + text);
    } catch (e) { log("vision fallback failed p." + img.page + ": " + (e && e.message)); }
  }
  if (!transcribed.length) return null;
  return transcribed.join("\n\n");
}

// ---------------------------------------------------------------------------
// Durable KB artifacts. Cards are written chunk-by-chunk, so index/map creation
// must tolerate partial runs and model-side map failures.
// ---------------------------------------------------------------------------
function writeJsonAtomic(filePath, data) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = filePath + ".tmp-" + process.pid + "-" + Date.now();
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  renameSync(tmp, filePath);
}

function readJsonMaybe(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8").replace(/^\uFEFF/, ""));
  } catch (e) {
    return null;
  }
}

function cleanPageRange(value, fallback) {
  const nums = Array.isArray(value)
    ? value.map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0)
    : [];
  let start = nums.length ? Math.min(...nums) : Number(fallback && fallback[0]);
  let end = nums.length ? Math.max(...nums) : Number(fallback && fallback[1]);
  if (!Number.isFinite(start) || start <= 0) start = Math.max(1, START_PAGE || 1);
  if (!Number.isFinite(end) || end <= 0) end = start;
  if (end < start) { const t = start; start = end; end = t; }
  return [start, end];
}

function normalizeCardPages(card) {
  const fallback = cleanPageRange(card && card._chunk_pages, null);
  const range = cleanPageRange(card && card.source_pages, fallback);
  if (card) card.source_pages = range;
  return range;
}

function cardOrderKey(card) {
  normalizeCardPages(card);
  return KBQuality.cardOrderKey(card);
}

function sortCardsForTeaching(cards) {
  (cards || []).forEach(function (card) { normalizeCardPages(card); });
  return KBQuality.sortCards(cards);
}

function loadCardsFromDisk() {
  const cardsDir = path.join(KB_DIR, "cards");
  if (!existsSync(cardsDir)) return [];
  const files = readdirSync(cardsDir).filter((name) => /\.json$/i.test(name)).sort();
  const cards = [];
  for (const file of files) {
    const card = readJsonMaybe(path.join(cardsDir, file));
    if (!card || typeof card !== "object") continue;
    if (!card.concept_id) card.concept_id = file.replace(/\.json$/i, "");
    normalizeCardPages(card);
    cards.push(card);
  }
  return sortCardsForTeaching(cards);
}

function buildIndex(allCards, extra) {
  const cards = sortCardsForTeaching(allCards).filter((c) => c && c.concept_id);
  const builtAt = new Date().toISOString();
  return Object.assign({
    textbook: path.basename(SRC_PATH || ""),
    title: TITLE,
    lang: "zh",
    built_at: builtAt,
    updated_at: builtAt,
    model: CARD.model,
    vision_fallback: VISION_OK ? VISION.model : null,
    premium_escalation: PREMIUM_OK ? PREMIUM.model : null,
    format: FORMAT,
    card_count: cards.length,
    needs_verification_count: cards.filter((c) => c.needs_verification).length,
    cards: cards.map((c) => ({
      concept_id: c.concept_id,
      title: c.title || "",
      difficulty: c.difficulty,
      source_pages: normalizeCardPages(c),
      needs_verification: !!c.needs_verification,
    })),
  }, extra || {});
}

function makeFallbackSequence(segmentCards) {
  const ordered = sortCardsForTeaching(segmentCards);
  if (!ordered.length) return [];
  const phaseCount = Math.max(1, Math.min(5, Math.ceil(ordered.length / 4)));
  const phaseSize = Math.max(1, Math.ceil(ordered.length / phaseCount));
  const sequence = [];
  for (let i = 0; i < ordered.length; i += phaseSize) {
    const group = ordered.slice(i, i + phaseSize);
    const start = Math.min(...group.map((c) => normalizeCardPages(c)[0]));
    const end = Math.max(...group.map((c) => normalizeCardPages(c)[1]));
    sequence.push({
      phase: sequence.length + 1,
      label: "第 " + start + "-" + end + " 页",
      card_ids: group.map((c) => c.concept_id),
      teach_goal: "按教材页序讲清本阶段知识点。",
      branches: [],
    });
  }
  return sequence;
}

function makeFallbackTeachingSegment(segmentCards, segStart, segEnd, reason) {
  return {
    page_range: [segStart, segEnd],
    sequence: makeFallbackSequence(segmentCards),
    generated_by: "deterministic-page-order",
    fallback_reason: reason || "llm_map_unavailable",
  };
}

function normalizeTeachingSegment(sequence, segmentCards, segStart, segEnd) {
  if (!Array.isArray(sequence) || !sequence.length) return null;
  const byKey = new Map();
  const expected = sortCardsForTeaching(segmentCards).filter((c) => c && c.concept_id);
  expected.forEach((c) => {
    byKey.set(String(c.concept_id), c);
    if (c.title) byKey.set(String(c.title), c);
    if (c.title) byKey.set(String(c.concept_id) + " | " + String(c.title), c);
  });
  const used = new Set();
  const phases = [];
  for (const rawPhase of sequence) {
    const rawIds = toArray(rawPhase && rawPhase.card_ids).map((id) => String(id || "").trim()).filter(Boolean);
    const phaseCards = [];
    for (const id of rawIds) {
      const card = byKey.get(id) || byKey.get(id.split("|")[0].trim());
      if (!card || used.has(card.concept_id)) continue;
      used.add(card.concept_id);
      phaseCards.push(card);
    }
    if (!phaseCards.length) continue;
    const ordered = sortCardsForTeaching(phaseCards);
    phases.push({
      phase: phases.length + 1,
      label: String((rawPhase && rawPhase.label) || ("第 " + (phases.length + 1) + " 阶段")),
      card_ids: ordered.map((c) => c.concept_id),
      teach_goal: String((rawPhase && rawPhase.teach_goal) || ""),
      branches: toArray(rawPhase && rawPhase.branches).map((b) => String(b || "").trim()).filter(Boolean),
    });
  }
  if (used.size !== expected.length || !phases.length) return null;

  if (!KBQuality.teachingPhasesPreserveOrder(expected, phases)) return null;
  return {
    page_range: [segStart, segEnd],
    sequence: phases,
    generated_by: "llm-validated",
  };
}

// ---------------------------------------------------------------------------
// Teaching map: order all cards into staged sequence segments (~16 cards/seg).
// ---------------------------------------------------------------------------
async function buildTeachingMap(allCards, opts) {
  if (!allCards.length) return null;
  opts = opts || {};
  const sorted = sortCardsForTeaching(allCards);
  const segSize = 16;
  const results = [];
  for (let i = 0; i < sorted.length; i += segSize) {
    const seg = sorted.slice(i, i + segSize);
    const segStart = Math.min(...seg.map((c) => normalizeCardPages(c)[0]));
    const segEnd = Math.max(...seg.map((c) => normalizeCardPages(c)[1]));
    const fallback = makeFallbackTeachingSegment(seg, segStart, segEnd, opts.deterministicOnly ? "deterministic_only" : "llm_map_failed");
    if (opts.deterministicOnly) {
      results.push(fallback);
      continue;
    }
    const cardList = seg.map((c) => "- " + c.concept_id + " | " + (c.title || "?") + " (difficulty=" + (c.difficulty || "?") + ", pages=" + JSON.stringify(c.source_pages || "?") + ")").join("\n");
    try {
      const raw = await callCardLLM(MAP_SYSTEM, mapUserPrompt(TITLE, segStart, segEnd, cardList), null, 2048);
      const obj = parseLLMJson(raw, "teaching_sequence");
      const seq = obj.teaching_sequence || [];
      const normalized = normalizeTeachingSegment(seq, seg, segStart, segEnd);
      if (normalized) {
        results.push(normalized);
        log("teaching map segment p." + segStart + "-" + segEnd + ": " + normalized.sequence.length + " validated phases");
      } else {
        results.push(fallback);
        log("teaching map segment p." + segStart + "-" + segEnd + ": invalid/incomplete LLM map; using page-order fallback");
      }
    } catch (e) {
      results.push(fallback);
      log("teaching map segment failed: " + (e && e.message) + "; using page-order fallback");
    }
  }
  return results.length ? {
    version: 3,
    ordering: "chunk-ordinal-then-source-page",
    generated_at: new Date().toISOString(),
    segments: results,
    fallback_segments: results.filter((seg) => seg.generated_by !== "llm-validated").length,
  } : null;
}

// ---------------------------------------------------------------------------
// Generate cards for a single chunk with fallback chain:
//   1. local OCR/text -> text-only card model
//   2. optional premium text-only escalation
//   3. explicit-consent independent ocrVision -> text-only card model
// ---------------------------------------------------------------------------
async function generateCardsForChunk(c, ci, total) {
  const hasImages = c.images && c.images.length > 0;
  log("chunk " + (ci + 1) + "/" + total + " (p." + c.start_page + "-" + c.end_page + ")" +
    (hasImages ? " +" + c.images.length + " image(s)" : ""));

  let body = c.text;
  if (body.length > CARD.maxInput) { body = body.slice(0, CARD.maxInput) + "\n[原文过长,已截断]"; }

  appendBuildLog({
    type: "chunk_start", chunk: ci + 1,
    pages: [c.start_page, c.end_page],
    imageCount: hasImages ? c.images.length : 0,
  });

  let cards = [];
  let method = "none";
  let hadRequestFailure = false;

  // --- Level 1: text-only card model (local OCR/text; no page upload) ---
  if (!cards.length) {
    try {
      const raw = await callCardLLM(CARD_SYSTEM, cardUserPrompt(TITLE, c.start_page, c.end_page, body, false), null, 8096, true);
      const obj = parseLLMJson(raw, "cards");
      cards = obj.cards || [];
      if (cards.length) method = method === "none" ? "text-only" : method;
      appendBuildLog({ type: "card_text_ok", chunk: ci + 1, cardCount: cards.length });
    } catch (e2) {
      hadRequestFailure = true;
      appendBuildLog({ type: "card_text_fail", chunk: ci + 1, error: (e2 && e2.message) || "unknown" });
      log("chunk " + (ci + 1) + " text-only failed: " + (e2 && e2.message));
      cards = [];
    }
  }

  // --- Level 2.5: premium model escalation (mini produced 0 cards) ---
  // Content failure only — postJSON throwing on HTTP errors (auth/429) is NOT
  // retried here; those bubble up as a failed chunk. We escalate once when the
  // cheap model simply couldn't produce usable cards for this chunk.
  if (!cards.length && PREMIUM_OK) {
    log("chunk " + (ci + 1) + ": escalating to premium model " + PREMIUM.model);
    appendBuildLog({ type: "card_premium_escalate", chunk: ci + 1, model: PREMIUM.model, reason: "mini_zero_cards" });
    try {
      const raw = await callCardLLM(
        CARD_SYSTEM, cardUserPrompt(TITLE, c.start_page, c.end_page, body, false),
        null, 8096, true, PREMIUM);
      const obj = parseLLMJson(raw, "cards");
      cards = obj.cards || [];
      if (cards.length) method = "premium";
      appendBuildLog({ type: "card_premium_ok", chunk: ci + 1, cardCount: cards.length });
    } catch (ep) {
      hadRequestFailure = true;
      appendBuildLog({ type: "card_premium_fail", chunk: ci + 1, error: (ep && ep.message) || "unknown" });
      log("chunk " + (ci + 1) + " premium escalation failed: " + (ep && ep.message));
      cards = [];
    }
  }

  // --- Level 3: independent vision transcription (configuration + job consent) ---
  if (!cards.length && hasImages && VISION_OK) {
    log("chunk " + (ci + 1) + ": attempting vision fallback");
    try {
      const visionText = await transcribeImagesViaVision(c);
      if (visionText) {
        const hybridBody = body + "\n\n" + visionText;
        const raw = await callCardLLM(CARD_SYSTEM, cardUserPrompt(TITLE, c.start_page, c.end_page, hybridBody, false), null, 8096, true);
        const obj = parseLLMJson(raw, "cards");
        cards = obj.cards || [];
        if (cards.length) method = "vision-fallback";
        appendBuildLog({ type: "card_vision_fallback_ok", chunk: ci + 1, cardCount: cards.length });
      }
    } catch (e3) {
      hadRequestFailure = true;
      appendBuildLog({ type: "card_vision_fallback_fail", chunk: ci + 1, error: (e3 && e3.message) || "unknown" });
      log("chunk " + (ci + 1) + " vision fallback failed: " + (e3 && e3.message));
    }
  }

  const textQuality = KBQuality.assessPdfText(c.text, { expectedCjk: /^chinese/.test(LANG) });
  const terminalFailure = !cards.length && KBQuality.likelyTeachableChunk(c.text, hasImages);
  appendBuildLog({
    type: "chunk_done",
    chunk: ci + 1,
    pages: [c.start_page, c.end_page],
    cardCount: cards.length,
    method,
    sourceChars: textQuality.length,
    sourceCjk: textQuality.cjk,
    imageCount: hasImages ? c.images.length : 0,
    hadRequestFailure,
    terminalFailure,
  });
  return cards;
}

async function generateCardsWithRetries(c, ci, total) {
  var cards = [];
  for (let attempt = 0; attempt <= CHUNK_RETRIES; attempt++) {
    cards = await generateCardsForChunk(c, ci, total);
    const terminalEvent = BUILD_LOG.slice().reverse().find(function (event) {
      return event && event.type === "chunk_done" && Number(event.chunk) === ci + 1;
    });
    if (!terminalEvent || !terminalEvent.terminalFailure) return cards;
    if (attempt >= CHUNK_RETRIES) return cards;
    const delay = 3000 * (attempt + 1);
    appendBuildLog({ type: "chunk_retry", chunk: ci + 1, attempt: attempt + 1, delayMs: delay, reason: "terminal_failure" });
    log("chunk " + (ci + 1) + " terminal failure; retrying whole chunk after " + delay + "ms");
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  return cards;
}

async function finalizeKnowledgeBase(allCards, opts) {
  opts = opts || {};
  const cards = sortCardsForTeaching(allCards).filter((c) => c && c.concept_id);
  const index = buildIndex(cards, opts.indexExtra);
  writeJsonAtomic(path.join(KB_DIR, "index.json"), index);
  log("index: " + index.card_count + " cards -> " + KB_DIR);

  const tmap = await buildTeachingMap(cards, { deterministicOnly: !!opts.deterministicMapOnly });
  if (tmap) {
    writeJsonAtomic(path.join(KB_DIR, "teaching_map.json"), tmap);
    log("teaching map: " + tmap.segments.length + " segments" +
      (tmap.fallback_segments ? " (" + tmap.fallback_segments + " fallback)" : ""));
  }
  return { index, tmap };
}

async function recoverPartialKnowledgeBase(err) {
  const cards = loadCardsFromDisk();
  if (!cards.length) return false;
  const message = (err && err.message) || "unknown";
  const failure = failureStatus(err);
  log("recovering usable KB artifacts from " + cards.length + " card file(s)");
  appendBuildLog({ type: "partial_recovery", cardCount: cards.length, error: message });
  const result = await finalizeKnowledgeBase(cards, {
    deterministicMapOnly: true,
    indexExtra: {
      partial: true,
      recovered_from_cards: true,
      recovery_error: message,
    },
  });
  writeStatus("partial", Object.assign({
    cardCount: result.index.card_count,
    needsVerification: result.index.needs_verification_count,
    hasTeachingMap: !!result.tmap,
    partial: true,
    recoveredFromCards: true,
  }, failure));
  return true;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  if (!TEXTBOOK_DIR || !SRC_PATH) throw new Error("KB_TEXTBOOK_DIR and KB_SRC_PATH required");
  if (!CARD.model || !SUPERVISED && (!CARD.baseUrl || !CARD.apiKey)) throw new Error("card model config incomplete (KB_CARD_*)");
  if (!existsSync(SRC_PATH)) throw new Error("source file not found: " + SRC_PATH);

  var resumeStatus = null;
  if (ENV.KB_RESUME === "1" && existsSync(STATUS_PATH)) {
    try {
      resumeStatus = JSON.parse(readFileSync(STATUS_PATH, "utf-8"));
      if (Array.isArray(resumeStatus.log)) BUILD_LOG.push.apply(BUILD_LOG, resumeStatus.log);
      writeStatus._data = resumeStatus;
    } catch (e) { resumeStatus = null; BUILD_LOG.length = 0; }
  }
  if (!resumeStatus) KBPublisher.prepare(TEXTBOOK_DIR);
  writeStatus("building", resumeStatus ? {
    resumedAt: new Date().toISOString(),
    visionFallbackAvailable: VISION_OK,
    premiumEscalationAvailable: PREMIUM_OK,
  } : {
    startedAt: new Date().toISOString(),
    visionFallbackAvailable: VISION_OK,
    premiumEscalationAvailable: PREMIUM_OK,
  });

  let pages;
  if (FORMAT === "pdf") pages = await extractPdf();
  else if (FORMAT === "markdown" || FORMAT === "md") pages = extractMarkdown();
  else if (FORMAT === "pptx") pages = extractPptx();
  else throw new Error("unsupported KB_FORMAT: " + FORMAT);
  assertSourceWithinLimit("builder_source_page_limit", pages.length, MAX_SOURCE_PAGES, "pages");

  if (!pages.length) {
    writeStatus("error", { cardCount: 0, note: "no extractable text", activationEligible: false });
    KBPublisher.publishFailureIfNoFinal(TEXTBOOK_DIR);
    log("no pages; error");
    return;
  }

  let chunks = chunkPages(pages, PAGES_PER_CHUNK);
  EXTRACTION_STATS.sourceChunks = chunks.length;
  assertSourceWithinLimit("builder_source_chunk_limit", chunks.length, MAX_CHUNKS, "chunks");
  log("chunked into " + chunks.length + " blocks (~" + PAGES_PER_CHUNK + " pages each), concurrency=" + BUILD_CONCURRENCY);

  const cardsDir = path.join(KB_DIR, "cards");
  mkdirSync(cardsDir, { recursive: true });

  // A concurrent batch can append chunk_done events before its cards are
  // committed in source order.  chunksDone is advanced only after each
  // chunk's card files have been written, so it is the hard checkpoint cap.
  const committedChunkCap = resumeStatus
    ? Math.max(0, Math.min(chunks.length, Number(resumeStatus.chunksDone) || 0))
    : 0;
  const resumeFromChunk = resumeStatus
    ? KBQuality.contiguousHealthyChunks(BUILD_LOG, committedChunkCap)
    : 0;
  const allCards = resumeFromChunk > 0 ? loadCardsFromDisk().filter(function (card) {
    var range = KBQuality.cleanRange(card && card._chunk_pages, card && card.source_pages);
    return range[0] <= chunks[resumeFromChunk - 1].end_page;
  }) : [];
  let idx = allCards.length;
  let chunksProcessed = resumeFromChunk;
  let consecutiveTerminalFailures = 0;
  if (resumeFromChunk > 0) {
    log("resuming from checkpoint after chunk " + resumeFromChunk + "/" + chunks.length + " with " + allCards.length + " card(s)");
    writeStatus("building", { cardCount: allCards.length, chunksDone: resumeFromChunk, chunksTotal: chunks.length, resumedFromChunk: resumeFromChunk });
  }
  var aborted = false;
  for (let batchStart = resumeFromChunk; batchStart < chunks.length && !aborted; batchStart += BUILD_CONCURRENCY) {
    const batchEnd = Math.min(chunks.length, batchStart + BUILD_CONCURRENCY);
    const batchResults = await Promise.all(chunks.slice(batchStart, batchEnd).map(function (chunk, offset) {
      const ci = batchStart + offset;
      return generateCardsWithRetries(chunk, ci, chunks.length);
    }));
    // Model calls may finish out of order; normalization, concept IDs, files,
    // and progress are deliberately committed in source chunk order.
    for (let offset = 0; offset < batchResults.length; offset++) {
      const ci = batchStart + offset;
      const cards = batchResults[offset];
      for (const raw of cards) {
        const chunkStart = chunks[ci].start_page;
        const chunkEnd = chunks[ci].end_page;
        const card = normalizeCard(raw, chunkStart, chunkEnd);
        if (!card) { log("  skip invalid card in chunk " + (ci + 1)); continue; }
        idx++;
        const cid = slugify(card.title, idx);
        card.concept_id = cid;
        card._chunk_pages = [chunkStart, chunkEnd];
        writeJsonAtomic(path.join(cardsDir, cid + ".json"), card);
        allCards.push(card);
      }
      chunksProcessed = ci + 1;
      const terminalEvent = BUILD_LOG.slice().reverse().find(function (event) {
        return event && event.type === "chunk_done" && Number(event.chunk) === ci + 1;
      });
      consecutiveTerminalFailures = terminalEvent && terminalEvent.terminalFailure
        ? consecutiveTerminalFailures + 1 : 0;
      writeStatus("building", {
        cardCount: allCards.length,
        chunksDone: chunksProcessed,
        chunksTotal: chunks.length,
        consecutiveTerminalFailures,
      });
      if (consecutiveTerminalFailures >= 3) {
        appendBuildLog({ type: "build_aborted", reason: "consecutive_terminal_failures", afterChunk: chunksProcessed });
        log("aborting after 3 consecutive terminal chunk failures; build will remain partial");
        aborted = true;
        break;
      }
    }
  }

  const finalized = await finalizeKnowledgeBase(allCards);
  const index = finalized.index;
  const tmap = finalized.tmap;

  const requestedEndPage = END_PAGE || (pages.length ? pages[pages.length - 1].page : START_PAGE);
  const health = KBQuality.assessBuild(allCards, chunks, BUILD_LOG, START_PAGE, requestedEndPage, tmap, EXTRACTION_STATS);
  writeStatus(health.state, Object.assign({
    cardCount: allCards.length,
    needsVerification: index.needs_verification_count,
    hasTeachingMap: !!tmap,
    extraction: EXTRACTION_STATS,
    chunksProcessed,
    activationEligible: health.state === "done",
  }, health));
  if (health.state === "done") {
    if (SUPERVISED) {
      await requestPublish();
      closeSupervisor("builder_seal_accepted");
      log("parent accepted healthy KB seal; awaiting exit-fenced publish");
    } else {
      KBPublisher.publish(TEXTBOOK_DIR);
      log("published healthy KB -> " + KB_PATHS.finalDir);
    }
  } else {
    KBPublisher.publishFailureIfNoFinal(TEXTBOOK_DIR);
    process.exitCode = 2;
  }
  log(health.state + " coverage=" + Math.round(health.coverageRatio * 100) + "%" +
    " terminalFailedChunks=" + health.terminalFailedChunks + " trailingEmpty=" + health.trailingEmptyChunks);
}

main().catch(async (err) => {
  log("FATAL: " + (err && err.message));
  try {
    const recovered = await recoverPartialKnowledgeBase(err);
    if (!recovered) writeStatus("error", failureStatus(err));
    KBPublisher.publishFailureIfNoFinal(TEXTBOOK_DIR);
  } catch (e) {
    try { writeStatus("error", { error: err && err.message, recoveryError: e && e.message }); } catch (e2) {}
  }
  process.exit(1);
});
