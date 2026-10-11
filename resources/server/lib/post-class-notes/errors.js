"use strict";

// Post-class notes v2 — upstream failure taxonomy and retry policy.
//
// Every failure that can reach the user travels as a coded error with a stable
// `code` string.  The compiled route only ever prints `code` + a translated
// message, so a provider outage can never surface as `Unexpected token '<'`.
//
// Plan: POST_CLASS_NOTES_QUALITY_RELIABILITY_DEVELOPMENT_PLAN.md §6.

var CODES = {
  // transport / upstream
  upstream_network: "upstream_network",
  upstream_timeout: "upstream_timeout",
  upstream_server: "upstream_server",
  upstream_rate_limit: "upstream_rate_limit",
  upstream_html_response: "upstream_html_response",
  upstream_auth: "upstream_auth",
  upstream_bad_request: "upstream_bad_request",
  upstream_malformed_body: "upstream_malformed_body",
  // model output shape
  upstream_empty_content: "upstream_empty_content",
  output_truncated: "output_truncated",
  schema_invalid: "schema_invalid",
  quality_rejected: "quality_rejected",
  // local
  persist_failed: "persist_failed",
  cancelled: "cancelled",
  budget_exceeded: "budget_exceeded",
  missing_dependency: "missing_dependency",
  not_found: "not_found",
  conflict: "conflict",
  internal_error: "internal_error"
};

// §6.2 retry matrix.  `attempts` is the number of *retries* after the first try.
var RETRY_POLICY = {};
RETRY_POLICY[CODES.upstream_network] = { attempts: 1, delayMs: 1500, jitterMs: 1500 };
// §6.3 gives every stage a single retry on timeout, so a slow-but-alive
// gateway is distinguishable from a dead one.
RETRY_POLICY[CODES.upstream_timeout] = { attempts: 1, delayMs: 1000, jitterMs: 1000 };
RETRY_POLICY[CODES.upstream_server] = { attempts: 1, delayMs: 1500, jitterMs: 1500 };
RETRY_POLICY[CODES.upstream_rate_limit] = { attempts: 1, delayMs: 2000, jitterMs: 1000, respectRetryAfter: true, maxDelayMs: 30000 };
RETRY_POLICY[CODES.upstream_html_response] = { attempts: 1, delayMs: 3000, jitterMs: 0 };
RETRY_POLICY[CODES.upstream_malformed_body] = { attempts: 1, delayMs: 1000, jitterMs: 1000 };
RETRY_POLICY[CODES.upstream_empty_content] = { attempts: 1, delayMs: 0, jitterMs: 0, shortenTarget: true };
RETRY_POLICY[CODES.output_truncated] = { attempts: 1, delayMs: 0, jitterMs: 0, shortenTarget: true };
RETRY_POLICY[CODES.schema_invalid] = { attempts: 1, delayMs: 0, jitterMs: 0, repairOnly: true };
RETRY_POLICY[CODES.upstream_auth] = { attempts: 0 };
RETRY_POLICY[CODES.upstream_bad_request] = { attempts: 0 };
RETRY_POLICY[CODES.cancelled] = { attempts: 0 };

var HTML_MARKER = /^\s*(?:<!doctype|<html|<\?xml)/i;

function codedError(code, message, details) {
  var error = new Error(message || code);
  error.code = code;
  error.retryable = !!(RETRY_POLICY[code] && RETRY_POLICY[code].attempts > 0);
  if (details) {
    var keys = Object.keys(details);
    for (var i = 0; i < keys.length; i++) error[keys[i]] = details[keys[i]];
  }
  return error;
}

function isCodedError(error) {
  return !!(error && typeof error.code === "string" && CODES[error.code]);
}

function snippet(text, limit) {
  var value = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
  var max = limit || 160;
  return value.length > max ? value.slice(0, max) + "…" : value;
}

function looksLikeHtml(text) {
  return HTML_MARKER.test(String(text == null ? "" : text));
}

// §6.1 steps 3-4: classify a non-2xx response from status + content type +
// body shape.  An HTML interception page is its own code even when the status
// is 403, because it is transient while a JSON 401/403 is a configuration bug.
// Accepts either `status` or `httpStatus` so a response recorded by
// `provider.js` can be classified without a translation step.
function classifyHttp(input) {
  var raw = input && (input.status === undefined ? input.httpStatus : input.status);
  var status = Number(raw) || 0;
  var contentType = String((input && input.contentType) || "").toLowerCase();
  var text = (input && input.text) || "";
  var html = contentType.indexOf("text/html") >= 0 || looksLikeHtml(text);
  var detail = { httpStatus: status, contentType: contentType, bodyPreview: snippet(text) };

  if (html) return codedError(CODES.upstream_html_response, "upstream returned an HTML page (status " + status + ")", detail);
  if (status === 401 || status === 403) return codedError(CODES.upstream_auth, "upstream rejected the API key (status " + status + ")", detail);
  if (status === 429) {
    var error = codedError(CODES.upstream_rate_limit, "upstream rate limited the request", detail);
    error.retryAfterMs = parseRetryAfter(input && input.retryAfter);
    return error;
  }
  if (status === 408 || status === 502 || status === 503 || status === 504) {
    return codedError(CODES.upstream_server, "upstream gateway error (status " + status + ")", detail);
  }
  if (status >= 500) return codedError(CODES.upstream_server, "upstream server error (status " + status + ")", detail);
  if (status === 400 || status === 404 || status === 422) {
    return codedError(CODES.upstream_bad_request, "upstream rejected the request (status " + status + ")", detail);
  }
  return codedError(status >= 400 ? CODES.upstream_bad_request : CODES.upstream_server, "unexpected upstream status " + status, detail);
}

function parseRetryAfter(value) {
  var raw = String(value == null ? "" : value).trim();
  if (!raw) return 0;
  var seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 30000);
  var at = Date.parse(raw);
  if (Number.isFinite(at)) return Math.max(0, Math.min(at - Date.now(), 30000));
  return 0;
}

// §6.1 step 3: transport-level failures.  An external abort is *cancelled*
// (no retry, propagated immediately); a deadline abort is a timeout.
function classifyNetwork(error) {
  if (isCodedError(error)) return error;
  var name = error && error.name;
  var code = error && error.code;
  var message = String((error && error.message) || "");

  if (code === CODES.cancelled || code === "request_aborted" || name === "AbortError" && error && error.external) {
    return codedError(CODES.cancelled, "request cancelled");
  }
  if (code === CODES.upstream_timeout || code === "request_deadline" || name === "TimeoutError" || code === "ETIMEDOUT" || /timed?\s*out/i.test(message)) {
    return codedError(CODES.upstream_timeout, "upstream did not answer in time");
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "EAI_FAIL") {
    return codedError(CODES.upstream_network, "upstream host could not be resolved", { syscallCode: code });
  }
  if (name === "AbortError") return codedError(CODES.cancelled, "request aborted");
  return codedError(CODES.upstream_network, "upstream connection failed: " + snippet(message), { syscallCode: code || "" });
}

function isCancellation(error) {
  return isCodedError(error) && error.code === CODES.cancelled;
}

function retryPlan(error) {
  var code = error && error.code;
  var policy = RETRY_POLICY[code];
  if (!policy || !policy.attempts) return { retry: false, attempts: 0, delayMs: 0, shortenTarget: false, repairOnly: false };
  var delay = policy.delayMs || 0;
  if (policy.respectRetryAfter && error.retryAfterMs) delay = Math.max(delay, error.retryAfterMs);
  if (policy.jitterMs) delay += Math.floor(Math.random() * policy.jitterMs);
  if (policy.maxDelayMs) delay = Math.min(delay, policy.maxDelayMs);
  return {
    retry: true,
    attempts: policy.attempts,
    delayMs: delay,
    shortenTarget: !!policy.shortenTarget,
    repairOnly: !!policy.repairOnly
  };
}

var MESSAGES = {
  upstream_html_response: {
    zh: "模型服务当前被网关拦截，请稍后重试。",
    "zh-TW": "模型服務目前被閘道攔截，請稍後重試。",
    en: "The model service is behind an intercepting gateway right now. Please retry shortly."
  },
  upstream_timeout: {
    zh: "模型服务响应过慢，已保留生成进度。",
    "zh-TW": "模型服務回應過慢，已保留生成進度。",
    en: "The model service is responding slowly. Generation progress has been kept."
  },
  upstream_auth: {
    zh: "模型地址和 API Key 不匹配。",
    "zh-TW": "模型位址與 API Key 不相符。",
    en: "The model endpoint and API key do not match."
  },
  upstream_rate_limit: {
    zh: "模型服务繁忙，请稍后继续。",
    "zh-TW": "模型服務繁忙，請稍後繼續。",
    en: "The model service is busy. Please continue shortly."
  },
  upstream_network: {
    zh: "网络连接模型服务失败，请检查网络后重试。",
    "zh-TW": "網路連線模型服務失敗，請檢查網路後重試。",
    en: "Could not reach the model service. Check the network and retry."
  },
  upstream_server: {
    zh: "模型服务暂时不可用，请稍后重试。",
    "zh-TW": "模型服務暫時無法使用，請稍後重試。",
    en: "The model service is temporarily unavailable. Please retry shortly."
  },
  upstream_bad_request: {
    zh: "请求被模型服务拒绝，请重试或检查模型配置。",
    "zh-TW": "請求被模型服務拒絕，請重試或檢查模型設定。",
    en: "The model service rejected the request. Retry or check the model configuration."
  },
  upstream_malformed_body: {
    zh: "模型服务返回了无法解析的响应。",
    "zh-TW": "模型服務回傳了無法解析的回應。",
    en: "The model service returned an unparsable response."
  },
  upstream_empty_content: {
    zh: "模型这次没有产出正文，正在重试。",
    "zh-TW": "模型這次沒有產出正文，正在重試。",
    en: "The model produced no content this time. Retrying."
  },
  output_truncated: {
    zh: "模型输出不完整，正在从检查点重试。",
    "zh-TW": "模型輸出不完整，正在從檢查點重試。",
    en: "The model output was cut short. Retrying from the checkpoint."
  },
  schema_invalid: {
    zh: "模型输出结构不合格，正在定向修复。",
    "zh-TW": "模型輸出結構不合格，正在定向修復。",
    en: "The model output did not match the schema. Repairing it."
  },
  quality_rejected: {
    zh: "笔记完整度不足，正在重新整理。",
    "zh-TW": "筆記完整度不足，正在重新整理。",
    en: "The notes were not complete enough. Reorganizing."
  },
  persist_failed: {
    zh: "笔记已生成，但保存失败；可直接重试保存。",
    "zh-TW": "筆記已產生，但儲存失敗；可直接重試儲存。",
    en: "The notes were generated but could not be saved. Retry the save directly."
  },
  cancelled: {
    zh: "生成已取消。",
    "zh-TW": "產生已取消。",
    en: "Generation was cancelled."
  },
  budget_exceeded: {
    zh: "生成时间超出预算，已用已完成的片段整理笔记。",
    "zh-TW": "產生時間超出預算，已用已完成的片段整理筆記。",
    en: "Generation exceeded its time budget. Notes were assembled from completed chunks."
  },
  missing_dependency: {
    zh: "课后笔记模块未加载。",
    "zh-TW": "課後筆記模組未載入。",
    en: "The post-class notes module is not loaded."
  },
  not_found: {
    zh: "找不到该生成任务。",
    "zh-TW": "找不到該產生任務。",
    en: "No such generation job."
  },
  conflict: {
    zh: "同一份笔记已有生成任务在运行。",
    "zh-TW": "同一份筆記已有產生任務在執行。",
    en: "A generation job is already running for these notes."
  },
  internal_error: {
    zh: "生成课后笔记时发生内部错误。",
    "zh-TW": "產生課後筆記時發生內部錯誤。",
    en: "An internal error occurred while generating the notes."
  }
};

function publicMessage(code, language) {
  var entry = MESSAGES[code] || MESSAGES.internal_error;
  if (language === "en" || language === "english") return entry.en;
  if (language === "chinese-traditional" || language === "zh-TW") return entry["zh-TW"];
  return entry.zh;
}

function toPublicError(error, language) {
  var code = isCodedError(error) ? error.code : CODES.internal_error;
  return { code: code, message: publicMessage(code, language) };
}

module.exports = {
  CODES: CODES,
  RETRY_POLICY: RETRY_POLICY,
  codedError: codedError,
  isCodedError: isCodedError,
  looksLikeHtml: looksLikeHtml,
  classifyHttp: classifyHttp,
  classifyNetwork: classifyNetwork,
  isCancellation: isCancellation,
  retryPlan: retryPlan,
  publicMessage: publicMessage,
  toPublicError: toPublicError
};
