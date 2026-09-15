"use strict";

var http = require("http");
var https = require("https");

var CHAT_COMPLETIONS_SUFFIX = "/chat/completions";
var RESPONSES_SUFFIX = "/responses";
var INSTALL_MARK = "__SOCRATOPIA_RESPONSES_FALLBACK_INSTALLED__";

function requestUrl(input) {
  if (typeof input === "string") return input;
  if (input && typeof input.url === "string") return input.url;
  return String(input || "");
}

function isChatCompletionsUrl(value) {
  try {
    return new URL(value).pathname.endsWith(CHAT_COMPLETIONS_SUFFIX);
  } catch (_error) {
    return false;
  }
}

function responsesUrl(value) {
  var url = new URL(value);
  url.pathname = url.pathname.slice(0, -CHAT_COMPLETIONS_SUFFIX.length) + RESPONSES_SUFFIX;
  return url.toString();
}

function isResponsesOnlyError(status, text) {
  if (!(status >= 400) || !text) return false;
  var value = String(text);
  return /codex\s+channel/i.test(value) && /only\s+\/v1\/responses(?:\b|,|\s)/i.test(value);
}

function prefersResponses(body) {
  var model = String(body && body.model || "");
  return /^gpt-5\.6(?:-|$)/i.test(model) || /(?:^|[-_.])codex(?:[-_.]|$)/i.test(model);
}

function unsupportedOptionalField(status, text, body) {
  if (!(status >= 400) || !text) return false;
  var value = String(text);
  var fields = ["max_output_tokens", "prompt_cache_retention", "prompt_cache_key"];
  for (var index = 0; index < fields.length; index++) {
    var field = fields[index];
    if (!body || body[field] === undefined) continue;
    var pattern = new RegExp("(?:unsupported|unknown|unrecognized|not\\s+supported)[^\\r\\n]{0,80}" + field + "|" + field + "[^\\r\\n]{0,80}(?:unsupported|unknown|unrecognized|not\\s+supported)", "i");
    if (pattern.test(value)) return field;
  }
  return "";
}

function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content == null ? "" : String(content);
  return content.map(function (part) {
    if (!part || typeof part !== "object") return String(part || "");
    if (typeof part.text === "string") return part.text;
    return "";
  }).join("");
}

function responsesContent(content, role) {
  if (!Array.isArray(content)) return content == null ? "" : content;
  return content.map(function (part) {
    if (!part || typeof part !== "object") {
      return { type: role === "assistant" ? "output_text" : "input_text", text: String(part || "") };
    }
    if (part.type === "text" || part.type === "input_text" || part.type === "output_text") {
      return {
        type: role === "assistant" ? "output_text" : "input_text",
        text: typeof part.text === "string" ? part.text : ""
      };
    }
    if (part.type === "image_url") {
      return {
        type: "input_image",
        image_url: typeof part.image_url === "string" ? part.image_url : part.image_url && part.image_url.url
      };
    }
    return part;
  });
}

function convertMessages(messages) {
  var input = [];
  (Array.isArray(messages) ? messages : []).forEach(function (message) {
    if (!message || typeof message !== "object") return;
    var role = message.role || "user";
    if (role === "system" || role === "developer") {
      var instruction = textFromContent(message.content).trim();
      // Keep system/developer text in input. Some Codex gateways validate JSON
      // mode against input messages and ignore the top-level instructions field.
      if (instruction) input.push({ role: role, content: instruction });
      return;
    }
    if (role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: message.tool_call_id || message.call_id || "",
        output: textFromContent(message.content)
      });
      return;
    }
    var content = responsesContent(message.content, role);
    if (content !== "" && content != null) input.push({ role: role, content: content });
    if (role === "assistant" && Array.isArray(message.tool_calls)) {
      message.tool_calls.forEach(function (toolCall) {
        var fn = toolCall && toolCall.function || {};
        input.push({
          type: "function_call",
          call_id: toolCall.call_id || toolCall.id || "",
          name: fn.name || toolCall.name || "",
          arguments: fn.arguments || toolCall.arguments || "{}"
        });
      });
    }
  });
  return { input: input };
}

function convertTools(tools) {
  if (!Array.isArray(tools)) return undefined;
  return tools.map(function (tool) {
    if (!tool || tool.type !== "function") return tool;
    var fn = tool.function || tool;
    var converted = {
      type: "function",
      name: fn.name,
      parameters: fn.parameters || {}
    };
    if (fn.description) converted.description = fn.description;
    if (fn.strict !== undefined) converted.strict = fn.strict;
    return converted;
  });
}

function convertToolChoice(choice) {
  if (!choice || typeof choice === "string") return choice;
  if (choice.type === "function") {
    var fn = choice.function || choice;
    return { type: "function", name: fn.name };
  }
  return choice;
}

function chatRequestToResponses(body) {
  body = body || {};
  var convertedMessages = convertMessages(body.messages);
  var result = {
    model: body.model,
    input: convertedMessages.input,
    stream: !!body.stream,
    // Codex-channel gateways reject persisted Responses requests.
    store: body.store === undefined ? false : body.store
  };
  if (convertedMessages.instructions) result.instructions = convertedMessages.instructions;
  var outputLimit = body.max_output_tokens;
  if (outputLimit === undefined) outputLimit = body.max_completion_tokens;
  if (outputLimit === undefined) outputLimit = body.max_tokens;
  if (outputLimit !== undefined) result.max_output_tokens = outputLimit;
  var copy = [
    "temperature", "top_p", "parallel_tool_calls", "metadata",
    "truncation", "service_tier", "prompt_cache_key", "prompt_cache_retention", "safety_identifier"
  ];
  copy.forEach(function (key) {
    if (body[key] !== undefined) result[key] = body[key];
  });
  if (body.reasoning !== undefined) result.reasoning = body.reasoning;
  else if (body.reasoning_effort !== undefined) result.reasoning = { effort: body.reasoning_effort };
  var tools = convertTools(body.tools);
  if (tools) result.tools = tools;
  if (body.tool_choice !== undefined) result.tool_choice = convertToolChoice(body.tool_choice);
  if (body.response_format) result.text = { format: body.response_format };
  return result;
}

function outputItems(response) {
  return response && Array.isArray(response.output) ? response.output : [];
}

function outputText(response) {
  if (response && typeof response.output_text === "string") return response.output_text;
  var parts = [];
  outputItems(response).forEach(function (item) {
    if (!item || item.type !== "message" || !Array.isArray(item.content)) return;
    item.content.forEach(function (content) {
      if (content && (content.type === "output_text" || content.type === "text") && typeof content.text === "string") {
        parts.push(content.text);
      }
    });
  });
  return parts.join("");
}

function outputToolCalls(response) {
  return outputItems(response).filter(function (item) {
    return item && item.type === "function_call";
  }).map(function (item) {
    return {
      id: item.call_id || item.id || "",
      type: "function",
      function: { name: item.name || "", arguments: item.arguments || "{}" }
    };
  });
}

function chatUsage(usage) {
  usage = usage || {};
  var inputDetails = usage.input_tokens_details || {};
  return {
    prompt_tokens: usage.input_tokens || 0,
    completion_tokens: usage.output_tokens || 0,
    total_tokens: usage.total_tokens || (usage.input_tokens || 0) + (usage.output_tokens || 0),
    prompt_tokens_details: {
      cached_tokens: inputDetails.cached_tokens || 0,
      cache_write_tokens: inputDetails.cache_write_tokens || 0
    }
  };
}

function responsesJsonToChat(response) {
  var toolCalls = outputToolCalls(response);
  var message = { role: "assistant", content: outputText(response) || null };
  if (toolCalls.length) message.tool_calls = toolCalls;
  return {
    id: response && response.id || "",
    object: "chat.completion",
    created: response && response.created_at || Math.floor(Date.now() / 1000),
    model: response && response.model || "",
    choices: [{ index: 0, message: message, finish_reason: toolCalls.length ? "tool_calls" : "stop" }],
    usage: chatUsage(response && response.usage)
  };
}

function errorMessage(event) {
  var error = event && (event.error || event.response && event.response.error);
  if (typeof error === "string") return error;
  if (error && typeof error.message === "string") return error.message;
  if (event && typeof event.message === "string") return event.message;
  return "Responses API stream failed";
}

function responsesStreamToChat(response) {
  var encoder = new TextEncoder();
  var decoder = new TextDecoder();
  var reader = response.body.getReader();
  var buffer = "";
  var sawOutput = false;
  var finished = false;
  var completedSeen = false;
  var toolIndexes = new Map();
  var toolStates = new Map();
  var nextToolIndex = 0;

  function keyFor(event, item) {
    return String(event.item_id || item && (item.id || item.call_id) || event.output_index || "tool-" + nextToolIndex);
  }

  return new ReadableStream({
    async start(controller) {
      function emit(value) {
        controller.enqueue(encoder.encode("data: " + JSON.stringify(value) + "\n\n"));
      }
      function emitDone() {
        if (finished) return;
        finished = true;
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      }
      function toolIndex(key) {
        if (!toolIndexes.has(key)) toolIndexes.set(key, nextToolIndex++);
        return toolIndexes.get(key);
      }
      function emitTool(item, event, argumentsDelta, full) {
        item = item || {};
        var key = keyFor(event || {}, item);
        var index = toolIndex(key);
        var state = toolStates.get(key) || { announced: false, arguments: "" };
        var call = { index: index };
        if (!state.announced) {
          call.id = item.call_id || item.id || key;
          call.type = "function";
          call.function = { name: item.name || "", arguments: argumentsDelta || "" };
          state.announced = true;
          state.arguments += argumentsDelta || "";
        } else {
          call.function = { arguments: argumentsDelta || "" };
          state.arguments += argumentsDelta || "";
        }
        if (full && item.arguments && !state.arguments) {
          call.function.arguments = item.arguments;
          state.arguments = item.arguments;
        }
        toolStates.set(key, state);
        sawOutput = true;
        emit({ choices: [{ index: 0, delta: { tool_calls: [call] }, finish_reason: null }] });
      }
      function emitCompleted(responseValue) {
        var text = outputText(responseValue);
        if (!sawOutput && text) {
          sawOutput = true;
          emit({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] });
        }
        outputItems(responseValue).forEach(function (item) {
          if (item && item.type === "function_call") {
            var key = String(item.id || item.call_id || "");
            if (!toolStates.has(key)) emitTool(item, { item_id: key }, item.arguments || "", true);
          }
        });
        if (responseValue && responseValue.usage) emit({ choices: [], usage: chatUsage(responseValue.usage) });
      }
      function handle(event) {
        if (!event || typeof event !== "object") return;
        if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
          sawOutput = true;
          emit({ choices: [{ index: 0, delta: { content: event.delta }, finish_reason: null }] });
          return;
        }
        if ((event.type === "response.reasoning_summary_text.delta" || event.type === "response.reasoning_text.delta") && typeof event.delta === "string") {
          sawOutput = true;
          emit({ choices: [{ index: 0, delta: { reasoning_content: event.delta }, finish_reason: null }] });
          return;
        }
        if (event.type === "response.output_item.added" && event.item && event.item.type === "function_call") {
          emitTool(event.item, event, event.item.arguments || "", false);
          return;
        }
        if (event.type === "response.function_call_arguments.delta") {
          emitTool({}, event, event.delta || "", false);
          return;
        }
        if (event.type === "response.output_item.done" && event.item && event.item.type === "function_call") {
          var key = keyFor(event, event.item);
          if (!toolStates.has(key)) emitTool(event.item, event, event.item.arguments || "", true);
          return;
        }
        if (event.type === "response.completed") {
          emitCompleted(event.response || {});
          completedSeen = true;
          emitDone();
          return true;
        }
        if (event.type === "error" || event.type === "response.failed" || event.type === "response.incomplete") {
          throw new Error(errorMessage(event));
        }
      }
      function processBlock(block) {
        var data = block.split(/\r?\n/).filter(function (line) {
          return line.startsWith("data:");
        }).map(function (line) {
          return line.slice(5).trim();
        }).join("\n");
        if (!data || data === "[DONE]") return false;
        return handle(JSON.parse(data)) === true;
      }
      try {
        readLoop: for (;;) {
          var result = await reader.read();
          if (result.done) break;
          buffer += decoder.decode(result.value, { stream: true });
          var blocks = buffer.split(/\r?\n\r?\n/);
          buffer = blocks.pop() || "";
          for (var blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
            if (processBlock(blocks[blockIndex])) break readLoop;
          }
        }
        if (!completedSeen) {
          buffer += decoder.decode();
          if (buffer.trim()) processBlock(buffer);
        }
        if (!sawOutput) throw new Error("Responses API stream ended without text or tool output");
        emitDone();
        controller.close();
      } catch (error) {
        if (completedSeen) {
          try { controller.close(); } catch (_error) {}
        } else {
          controller.error(error);
        }
      } finally {
        if (completedSeen) {
          try { await reader.cancel("response completed"); } catch (_error) {}
        }
        try { reader.releaseLock(); } catch (_error) {}
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    }
  });
}

async function responsesStreamToChatJson(response) {
  var translated = new Response(responsesStreamToChat(response));
  var raw = await translated.text();
  var content = "";
  var reasoningContent = "";
  var tools = new Map();
  var usage = null;
  raw.split(/\r?\n/).forEach(function (line) {
    if (!line.startsWith("data: ") || line === "data: [DONE]") return;
    var event;
    try { event = JSON.parse(line.slice(6)); } catch (_error) { return; }
    if (event.usage) usage = event.usage;
    var delta = event.choices && event.choices[0] && event.choices[0].delta;
    if (!delta) return;
    if (typeof delta.content === "string") content += delta.content;
    if (typeof delta.reasoning_content === "string") reasoningContent += delta.reasoning_content;
    (delta.tool_calls || []).forEach(function (call) {
      var index = call.index || 0;
      var current = tools.get(index) || { id: "", type: "function", function: { name: "", arguments: "" } };
      if (call.id) current.id = call.id;
      if (call.type) current.type = call.type;
      if (call.function && call.function.name) current.function.name = call.function.name;
      if (call.function && call.function.arguments) current.function.arguments += call.function.arguments;
      tools.set(index, current);
    });
  });
  var toolCalls = Array.from(tools.keys()).sort(function (a, b) { return a - b; }).map(function (key) {
    return tools.get(key);
  });
  var message = { role: "assistant", content: content || null };
  if (reasoningContent) message.reasoning_content = reasoningContent;
  if (toolCalls.length) message.tool_calls = toolCalls;
  return {
    id: "",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "",
    choices: [{ index: 0, message: message, finish_reason: toolCalls.length ? "tool_calls" : "stop" }],
    usage: usage || chatUsage()
  };
}

async function requestBody(input, init) {
  if (init && typeof init.body === "string") return init.body;
  if (input && typeof input.clone === "function") return input.clone().text();
  return "";
}

function responseHeaders(response, contentType) {
  var headers = new Headers(response.headers);
  headers.set("Content-Type", contentType);
  headers.delete("Content-Length");
  return headers;
}

function headerObject(headers) {
  var result = {};
  if (!headers) return result;
  if (typeof headers.forEach === "function") {
    headers.forEach(function (value, key) { result[key] = value; });
    return result;
  }
  Object.keys(headers).forEach(function (key) { result[key] = headers[key]; });
  return result;
}

function setHeader(headers, name, value) {
  var match = Object.keys(headers).find(function (key) { return key.toLowerCase() === name.toLowerCase(); });
  if (match) headers[match] = value;
  else headers[name] = value;
}

function nativePost(urlValue, rawBody, options, stage) {
  options = options || {};
  var url = urlValue instanceof URL ? urlValue : new URL(urlValue);
  var transport = url.protocol === "https:" ? https : http;
  var signal = options.signal;
  if (signal && signal.aborted) return Promise.reject(signal.reason instanceof Error ? signal.reason : Object.assign(new Error("request aborted"), { code: "ABORT_ERR" }));
  var headers = headerObject(options.headers);
  setHeader(headers, "Content-Type", headers["Content-Type"] || "application/json; charset=utf-8");
  setHeader(headers, "Content-Length", Buffer.byteLength(rawBody));
  if (!Object.keys(headers).some(function (key) { return key.toLowerCase() === "connection"; })) headers.Connection = "close";
  var timeoutMs = Math.max(1, Number(options.timeoutMs) || 120000);
  var maxResponseBytes = Math.min(32 * 1024 * 1024, Math.max(1024, Number(options.maxResponseBytes) || 8 * 1024 * 1024));
  return new Promise(function (resolve, reject) {
    var settled = false;
    var timer;
    var abortRequest;
    var requestOptions = { method: "POST", agent: false, headers: headers };
    if (url.protocol === "https:") requestOptions.ALPNProtocols = ["http/1.1"];
  var startedAt = Date.now();
  var bodyKb = Math.round(Buffer.byteLength(rawBody || "") / 1024);
  console.error("[llm-request] stage=" + stage + " bodyKb=" + bodyKb + " timeoutMs=" + timeoutMs + " url=" + url.pathname);
    function rejectOnce(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal && abortRequest) signal.removeEventListener("abort", abortRequest);
      console.error("[llm-failure] stage=" + stage + " elapsedMs=" + (Date.now() - startedAt) + " code=" + (error && error.code || "") + " message=" + (error && error.message || error));
      reject(error);
    }
    var request = transport.request(url, requestOptions, function (response) {
      var chunks = [];
      var responseBytes = 0;
      function truncatedResponseError(event) {
        var error = new Error("native " + stage + " response " + event + " before completion");
        error.code = "ECONNRESET";
        return error;
      }
      response.on("data", function (chunk) {
        responseBytes += chunk.length;
        if (responseBytes > maxResponseBytes) {
          var error = new Error("native response body too large");
          error.code = "response_body_too_large";
          rejectOnce(error);
          response.destroy(error);
          return;
        }
        chunks.push(chunk);
      });
      response.on("error", rejectOnce);
      response.on("aborted", function () { rejectOnce(truncatedResponseError("aborted")); });
      response.on("close", function () {
        if (!response.complete) rejectOnce(truncatedResponseError("closed"));
      });
      response.on("end", function () {
        if (settled) return;
        if (!response.complete) {
          rejectOnce(truncatedResponseError("ended"));
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (signal && abortRequest) signal.removeEventListener("abort", abortRequest);
        var result = {
          statusCode: response.statusCode || 0,
          statusMessage: response.statusMessage || "",
          headers: response.headers || {},
          raw: Buffer.concat(chunks).toString("utf8"),
          elapsedMs: Date.now() - startedAt,
          stage: stage
        };
        console.error("[llm-timing] stage=" + stage + " status=" + result.statusCode + " elapsedMs=" + result.elapsedMs + " responseBytes=" + responseBytes + " url=" + url.pathname);
        if (typeof options.onResponse === "function") {
          try { options.onResponse(result); } catch (error) { reject(error); return; }
        }
        resolve(result);
      });
    });
    timer = setTimeout(function () {
      var error = new Error(options.timeoutMessage || "request timeout after " + timeoutMs + "ms");
      rejectOnce(error);
      request.destroy(error);
    }, timeoutMs);
    if (signal) {
      abortRequest = function () {
        var error = signal.reason instanceof Error ? signal.reason : Object.assign(new Error("request aborted"), { code: "ABORT_ERR" });
        rejectOnce(error);
        request.destroy(error);
      };
      signal.addEventListener("abort", abortRequest, { once: true });
      if (signal.aborted) {
        abortRequest();
        return;
      }
    }
    request.on("error", rejectOnce);
    request.write(rawBody);
    request.end();
  });
}

function nativeHttpError(result) {
  var error = new Error("HTTP " + result.statusCode + ": " + String(result.raw || "").slice(0, 300));
  error.statusCode = result.statusCode;
  error.responseBody = result.raw;
  return error;
}

function parseNativeJson(result) {
  try {
    return JSON.parse(String(result.raw || "").trim());
  } catch (error) {
    throw new Error("Invalid model JSON: " + error.message);
  }
}

async function postResponsesJson(chatUrl, chatBody, stageOptions, options, reason) {
  var responsesBody = chatRequestToResponses(chatBody || {});
  // The target Codex gateways require streaming Responses even though these
  // native callers consume one final Chat Completions-compatible JSON object.
  responsesBody.stream = true;
  var target = responsesUrl(chatUrl.toString());
  var logger = options.logger || console;
  logger.warn(reason === "responses_first"
    ? "[responses-compat] Codex model routed directly to /responses"
    : "[responses-compat] Codex channel detected; retrying native request with /responses", {
    model: chatBody && chatBody.model || "",
    stream: false
  });
  var retried = await nativePost(target, JSON.stringify(responsesBody), stageOptions(), reason);
  for (var compatibilityRetry = 0; compatibilityRetry < 3; compatibilityRetry++) {
    var unsupportedField = unsupportedOptionalField(retried.statusCode, retried.raw, responsesBody);
    if (!unsupportedField) break;
    delete responsesBody[unsupportedField];
    logger.warn("[responses-compat] Gateway rejected optional Responses field; retrying without it", {
      model: chatBody && chatBody.model || "",
      field: unsupportedField
    });
    retried = await nativePost(target, JSON.stringify(responsesBody), stageOptions(), reason + "_without_" + unsupportedField);
  }
  if (retried.statusCode < 200 || retried.statusCode >= 300) throw nativeHttpError(retried);
  var contentType = String(retried.headers["content-type"] || "");
  if (/text\/event-stream/i.test(contentType)) {
    return responsesStreamToChatJson(new Response(retried.raw, {
      status: retried.statusCode,
      headers: { "Content-Type": contentType }
    }));
  }
  return responsesJsonToChat(parseNativeJson(retried));
}

async function postChatCompletionsJson(urlValue, chatBody, options) {
  options = options || {};
  var url = urlValue instanceof URL ? urlValue : new URL(urlValue);
  var totalTimeoutMs = Math.max(1, Number(options.timeoutMs) || 120000);
  var deadline = Date.now() + totalTimeoutMs;
  function stageOptions() {
    return Object.assign({}, options, { timeoutMs: Math.max(1, deadline - Date.now()) });
  }
  if (isChatCompletionsUrl(url.toString()) && prefersResponses(chatBody)) {
    return postResponsesJson(url, chatBody, stageOptions, options, "responses_first");
  }
  var initial = await nativePost(url, JSON.stringify(chatBody || {}), stageOptions(), "chat_completions");
  var initialOk = initial.statusCode >= 200 && initial.statusCode < 300;
  if (initialOk) return parseNativeJson(initial);
  if (!isChatCompletionsUrl(url.toString()) || !isResponsesOnlyError(initial.statusCode, initial.raw)) {
    throw nativeHttpError(initial);
  }

  return postResponsesJson(url, chatBody, stageOptions, options, "responses_fallback");
}

async function fetchResponsesForChat(baseFetch, input, init, url, chatBody, logger, reason) {
  var target = responsesUrl(url);
  var responsesBody = chatRequestToResponses(chatBody);
  // Keep one parser path for streaming and non-streaming Chat Completions
  // consumers. The Codex channel accepts streaming Responses consistently.
  responsesBody.stream = true;
  var retryInit = Object.assign({}, init || {}, {
    method: "POST",
    body: JSON.stringify(responsesBody)
  });
  if (!retryInit.headers && input && input.headers) retryInit.headers = input.headers;
  if (!retryInit.signal && input && input.signal) retryInit.signal = input.signal;
  logger.warn(reason === "responses_first"
    ? "[responses-compat] Codex model routed directly to /responses"
    : "[responses-compat] Codex channel detected; retrying with /responses", {
    model: chatBody.model || "",
    stream: !!chatBody.stream
  });
  var retried = await baseFetch(target, retryInit);
  for (var compatibilityRetry = 0; !retried.ok && compatibilityRetry < 3; compatibilityRetry++) {
    var retryText;
    try { retryText = await retried.clone().text(); } catch (_error) { retryText = ""; }
    var unsupportedField = unsupportedOptionalField(retried.status, retryText, responsesBody);
    if (!unsupportedField) break;
    delete responsesBody[unsupportedField];
    retryInit.body = JSON.stringify(responsesBody);
    logger.warn("[responses-compat] Gateway rejected optional Responses field; retrying without it", {
      model: chatBody.model || "",
      field: unsupportedField
    });
    retried = await baseFetch(target, retryInit);
  }
  if (!retried.ok || !retried.body) return retried;
  if (chatBody.stream) {
    return new Response(responsesStreamToChat(retried), {
      status: retried.status,
      statusText: retried.statusText,
      headers: responseHeaders(retried, "text/event-stream; charset=utf-8")
    });
  }
  var contentType = retried.headers.get("content-type") || "";
  var chatJson = /text\/event-stream/i.test(contentType)
    ? await responsesStreamToChatJson(retried)
    : responsesJsonToChat(await retried.json());
  return new Response(JSON.stringify(chatJson), {
    status: retried.status,
    statusText: retried.statusText,
    headers: responseHeaders(retried, "application/json; charset=utf-8")
  });
}

function createResponsesFallbackFetch(baseFetch, logger) {
  if (typeof baseFetch !== "function") throw new TypeError("baseFetch must be a function");
  logger = logger || console;
  return async function responsesFallbackFetch(input, init) {
    var url = requestUrl(input);
    var method = String(init && init.method || input && input.method || "GET").toUpperCase();
    // Clone a Request-backed body before the first fetch consumes it.
    var rawBodyPromise = method === "POST" && isChatCompletionsUrl(url)
      ? requestBody(input, init).catch(function () { return ""; })
      : null;
    if (rawBodyPromise) {
      var earlyRawBody;
      var earlyChatBody;
      try {
        earlyRawBody = await rawBodyPromise;
        earlyChatBody = JSON.parse(earlyRawBody || "{}");
      } catch (_error) {}
      if (earlyChatBody && prefersResponses(earlyChatBody)) {
        return fetchResponsesForChat(baseFetch, input, init, url, earlyChatBody, logger, "responses_first");
      }
    }
    var initial = await baseFetch(input, init);
    if (method !== "POST" || !isChatCompletionsUrl(url) || initial.ok) return initial;
    var initialText;
    try { initialText = await initial.clone().text(); } catch (_error) { return initial; }
    if (!isResponsesOnlyError(initial.status, initialText)) return initial;

    var rawBody;
    try { rawBody = rawBodyPromise ? await rawBodyPromise : ""; } catch (_error) { return initial; }
    var chatBody;
    try { chatBody = JSON.parse(rawBody || "{}"); } catch (_error) { return initial; }
    var target = responsesUrl(url);
    var responsesBody = chatRequestToResponses(chatBody);
    // The Codex channel exposed by this gateway requires streaming Responses,
    // even when the original Chat Completions caller requested one JSON body.
    responsesBody.stream = true;
    var retryInit = Object.assign({}, init || {}, {
      method: "POST",
      body: JSON.stringify(responsesBody)
    });
    if (!retryInit.headers && input && input.headers) retryInit.headers = input.headers;
    if (!retryInit.signal && input && input.signal) retryInit.signal = input.signal;
    logger.warn("[responses-compat] Codex channel detected; retrying with /responses", {
      model: chatBody.model || "",
      stream: !!chatBody.stream
    });
    var retried = await baseFetch(target, retryInit);
    for (var compatibilityRetry = 0; !retried.ok && compatibilityRetry < 3; compatibilityRetry++) {
      var retryText;
      try { retryText = await retried.clone().text(); } catch (_error) { retryText = ""; }
      var unsupportedField = unsupportedOptionalField(retried.status, retryText, responsesBody);
      if (!unsupportedField) break;
      delete responsesBody[unsupportedField];
      retryInit.body = JSON.stringify(responsesBody);
      logger.warn("[responses-compat] Gateway rejected optional Responses field; retrying without it", {
        model: chatBody.model || "",
        field: unsupportedField
      });
      retried = await baseFetch(target, retryInit);
    }
    if (!retried.ok || !retried.body) return retried;
    if (chatBody.stream) {
      return new Response(responsesStreamToChat(retried), {
        status: retried.status,
        statusText: retried.statusText,
        headers: responseHeaders(retried, "text/event-stream; charset=utf-8")
      });
    }
    var contentType = retried.headers.get("content-type") || "";
    var chatJson = /text\/event-stream/i.test(contentType)
      ? await responsesStreamToChatJson(retried)
      : responsesJsonToChat(await retried.json());
    return new Response(JSON.stringify(chatJson), {
      status: retried.status,
      statusText: retried.statusText,
      headers: responseHeaders(retried, "application/json; charset=utf-8")
    });
  };
}

function installGlobalResponsesFallback() {
  if (globalThis[INSTALL_MARK]) return false;
  var originalFetch = globalThis.fetch;
  if (typeof originalFetch !== "function") throw new Error("global fetch is unavailable");
  globalThis.fetch = createResponsesFallbackFetch(originalFetch.bind(globalThis), console);
  globalThis[INSTALL_MARK] = true;
  return true;
}

module.exports = {
  chatRequestToResponses: chatRequestToResponses,
  createResponsesFallbackFetch: createResponsesFallbackFetch,
  installGlobalResponsesFallback: installGlobalResponsesFallback,
  isResponsesOnlyError: isResponsesOnlyError,
  prefersResponses: prefersResponses,
  postChatCompletionsJson: postChatCompletionsJson,
  responsesJsonToChat: responsesJsonToChat,
  responsesStreamToChat: responsesStreamToChat,
  responsesUrl: responsesUrl
};
