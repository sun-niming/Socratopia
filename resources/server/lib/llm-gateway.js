"use strict";

var ResponsesCompat = require("./responses-api-compat.js");

function GatewayError(code, message, status, cause) {
  Error.call(this, message);
  this.name = "GatewayError";
  this.code = code || "llm_gateway_error";
  this.status = status || 502;
  this.message = message || this.code;
  if (cause) this.cause = cause;
  if (Error.captureStackTrace) Error.captureStackTrace(this, GatewayError);
}
GatewayError.prototype = Object.create(Error.prototype);
GatewayError.prototype.constructor = GatewayError;

function routerFor(options) {
  if (options && options.router) return options.router;
  if (global.__MODEL_ROUTER__) return global.__MODEL_ROUTER__;
  return require("./model-router.js");
}

function baseConfigFor(options) {
  if (options && options.baseConfig) return options.baseConfig;
  return global.__SOCRATOPIA_SET__ || {};
}

function publicRoute(route) {
  route = route || {};
  return {
    provider: route.provider || "",
    apiType: route.apiType || "",
    baseUrl: route.baseUrl || "",
    model: route.model || "",
    tier: route.tier || "",
    reason: route.reason || "",
  };
}

function parseJson(text) {
  var value = String(text == null ? "" : text).trim();
  if (!value) throw new GatewayError("llm_empty", "LLM returned an empty response", 502);
  value = value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try { return JSON.parse(value); } catch (firstError) {
    var objectStart = value.indexOf("{");
    var arrayStart = value.indexOf("[");
    var start = objectStart < 0 ? arrayStart : arrayStart < 0 ? objectStart : Math.min(objectStart, arrayStart);
    var end = start >= 0 && value[start] === "[" ? value.lastIndexOf("]") : value.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try { return JSON.parse(value.slice(start, end + 1)); } catch (_) {}
    }
    throw new GatewayError("llm_invalid_json", "LLM response was not valid JSON", 502, firstError);
  }
}

function createGateway(options) {
  options = options || {};
  var defaultTimeoutMs = Math.max(1, Number(options.timeoutMs) || 90000);
  var logger = options.logger || console;

  async function invokeRoute(route, input) {
    if (typeof options.transport === "function") return options.transport(route, input);
    if (!route || !route.baseUrl || !route.apiKey || !route.model) {
      throw new GatewayError("llm_unavailable", "No configured model route is available", 503);
    }
    var payload = {
      model: route.model,
      stream: false,
      max_tokens: Math.max(1, Number(input.maxTokens) || 4096),
      messages: [{ role: "system", content: String(input.system || "") }].concat(
        Array.isArray(input.messages) ? input.messages.map(function (message) {
          return { role: message.role || "user", content: message.content == null ? "" : message.content };
        }) : [{ role: "user", content: String(input.user || "") }]
      ),
    };
    if (input.requiresJson !== false) payload.response_format = { type: "json_object" };
    // deepseek 与 gpt-5.6 默认开启思考,会把 max_tokens 烧在 reasoning_content 上、content 返回空串,JSON 任务随之失败。
    // BUG-0014: gpt-5.6 走 /responses,由 responses-api-compat 把 thinking 映射成 reasoning;
    // 若这里不发 thinking,兼容层没有可映射的东西,@responses 上的推理就永远关不掉。
    if (/^(?:deepseek|gpt-5\.6)/i.test(String(route.model || ""))) payload.thinking = { type: "disabled" };
    var result = await ResponsesCompat.postChatCompletionsJson(
      String(route.baseUrl).replace(/\/$/, "") + "/chat/completions",
      payload,
      {
        headers: {
          Authorization: "Bearer " + route.apiKey,
          "Content-Type": "application/json",
          Connection: "close",
        },
        timeoutMs: Math.max(1, Number(input.timeoutMs) || defaultTimeoutMs),
        timeoutMessage: "adaptive LLM timeout",
        logger: logger,
      }
    );
    var message = result && result.choices && result.choices[0] && result.choices[0].message;
    var content = message && (message.content || message.reasoning_content) || "";
    if (!content) throw new GatewayError("llm_empty", "LLM returned no message content", 502);
    return content;
  }

  async function callText(input) {
    input = input || {};
    var router = routerFor(options);
    if (!router || typeof router.callRoutedLLM !== "function") {
      throw new GatewayError("model_router_unavailable", "Model router is unavailable", 503);
    }
    var routedInput = {
      task: input.task || "diagnosis",
      role: input.role || "strong",
      baseConfig: baseConfigFor(options),
      inputChars: String(input.system || "").length + String(input.user || "").length,
      pageCount: input.pageCount || 0,
      requiresJson: input.requiresJson !== false,
      schemaComplexity: input.schemaComplexity || "high",
      userQualityMode: input.userQualityMode || "auto",
      hasImages: !!input.hasImages,
      hasTablesOrCode: !!input.hasTablesOrCode,
    };
    var result;
    try {
      result = await router.callRoutedLLM(routedInput, function (route) {
        return invokeRoute(route, input);
      });
    } catch (error) {
      if (error instanceof GatewayError) throw error;
      var classified = typeof router.classifyError === "function" ? router.classifyError(error) : null;
      throw new GatewayError("llm_" + (classified && classified.kind || "request_failed"), error && error.message || "LLM request failed", classified && classified.httpStatus || 502, error);
    }
    if (!result || result.content == null || result.failure) {
      var failure = result && result.failure || { kind: "empty" };
      throw new GatewayError("llm_" + (failure.kind || "invalid_output"), "LLM output failed validation", failure.httpStatus || 502);
    }
    return {
      content: String(result.content),
      route: publicRoute(result.route),
      fallbackAttempt: result.fallbackAttempt || 0,
      tier: result.tier || "",
    };
  }

  async function callJson(input) {
    var result = await callText(Object.assign({}, input || {}, { requiresJson: true }));
    var data = parseJson(result.content);
    if (input && typeof input.validate === "function") {
      var validation = input.validate(data);
      var errors = validation === true || validation == null ? [] : Array.isArray(validation) ? validation : [String(validation)];
      if (errors.length) {
        var error = new GatewayError("llm_schema_invalid", "LLM JSON failed schema validation", 502);
        error.validationErrors = errors.slice(0, 20);
        throw error;
      }
    }
    result.data = data;
    return result;
  }

  function createPromptCaller(defaults) {
    defaults = defaults || {};
    return async function (prompt) {
      var promptText = typeof prompt === "string" ? prompt : null;
      prompt = prompt && typeof prompt === "object" ? prompt : {};
      var result = await callText(Object.assign({}, defaults, {
        system: prompt.system || defaults.system || "",
        user: promptText == null ? prompt.user || defaults.user || "" : promptText,
        messages: prompt.messages || defaults.messages,
      }));
      return result.content;
    };
  }

  return {
    callText: callText,
    callJson: callJson,
    createPromptCaller: createPromptCaller,
  };
}

module.exports = {
  GatewayError: GatewayError,
  createGateway: createGateway,
  parseJson: parseJson,
};
