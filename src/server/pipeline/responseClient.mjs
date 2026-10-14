import {
  modelRequestBudgetSnapshot,
  reserveModelProviderRequest,
} from "./modelRequestBudget.mjs";
import { resolveOperatorApiCredentials } from "../modelEnvironment.mjs";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";

function trimSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function configuredBaseUrl(environment, credentials) {
  if (credentials.baseUrl) return trimSlash(credentials.baseUrl);
  if (!environment.CHARACTER_TOWN_API_KEY && environment.DEEPSEEK_API_KEY && !environment.OPENAI_API_KEY) return DEFAULT_DEEPSEEK_BASE_URL;
  return DEFAULT_OPENAI_BASE_URL;
}

function configuredApiStyle(baseUrl, environment) {
  const explicit = environment.CHARACTER_TOWN_API_STYLE || environment.OPENAI_API_STYLE || "";
  if (explicit === "chat" || explicit === "chat-completions") return "chat-completions";
  if (explicit === "responses") return "responses";
  return /deepseek|chat\/completions/i.test(baseUrl) ? "chat-completions" : "responses";
}

function configuredDeepSeekThinkingMode(baseUrl, environment) {
  if (!/deepseek/i.test(baseUrl)) return "";
  const explicit = String(
    environment.CHARACTER_TOWN_DEEPSEEK_THINKING
      || environment.DEEPSEEK_THINKING
      || "",
  ).trim().toLowerCase();
  if (["enabled", "disabled"].includes(explicit)) return explicit;
  // DeepSeek V4 defaults to thinking mode and returns its private reasoning in
  // `reasoning_content`. Character Agent stages require a final JSON commit in
  // `content`; never promote hidden reasoning into the public protocol merely
  // because a provider omitted that final commit.
  return "disabled";
}

export function currentProviderConfig(environment = process.env) {
  const credentials = resolveOperatorApiCredentials(environment);
  const baseUrl = configuredBaseUrl(environment, credentials);
  const kind = configuredApiStyle(baseUrl, environment);
  return {
    kind,
    baseUrl,
    url: `${baseUrl}/${kind === "chat-completions" ? "chat/completions" : "responses"}`,
    apiKey: credentials.apiKey,
    thinkingMode: configuredDeepSeekThinkingMode(baseUrl, environment),
  };
}

/**
 * The operator's model, or an empty string. There is deliberately no fallback:
 * inferring a model name from the base URL meant an unconfigured run silently
 * billed whichever provider happened to be reachable, and recorded that model
 * in the run's provenance as if it had been chosen. Callers that require a
 * model must say so themselves — see `requireCurrentModel`.
 */
export function currentModel() {
  return String(
    process.env.CHARACTER_TOWN_MODEL
    || process.env.OPENAI_MODEL
    || process.env.DEEPSEEK_MODEL
    || "",
  ).trim();
}

export function requireCurrentModel() {
  const model = currentModel();
  if (!model) {
    const error = new TypeError(
      "No model is configured. Set CHARACTER_TOWN_MODEL (or OPENAI_MODEL / DEEPSEEK_MODEL) for an operator-supplied API, or run inside an agent shell to use the subagent transport. This project ships no default model.",
    );
    error.code = "CHARACTER_TOWN_MODEL_NOT_CONFIGURED";
    throw error;
  }
  return model;
}

export function extractText(data) {
  const chatContent = data?.choices?.[0]?.message?.content;
  if (typeof chatContent === "string" && chatContent.trim()) return chatContent;
  if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text;
  if (data.output_parsed && typeof data.output_parsed === "object") return JSON.stringify(data.output_parsed);
  const parts = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") parts.push(content.text);
      if (typeof content.output_text === "string") parts.push(content.output_text);
    }
  }
  return parts.join("\n");
}

function buildResponsesBody({ model, system, user, schema, schemaName, previousResponseId = "" }) {
  const body = {
    model,
    input: previousResponseId
      ? [{ role: "user", content: [{ type: "input_text", text: user }] }]
      : [
        { role: "system", content: [{ type: "input_text", text: system }] },
        { role: "user", content: [{ type: "input_text", text: user }] },
      ],
    text: {
      format: {
        type: "json_schema",
        name: schemaName || "character_town_payload",
        strict: false,
        schema,
      },
    },
  };
  if (previousResponseId) {
    body.previous_response_id = previousResponseId;
    // Instructions are not inherited through previous_response_id.  Supplying
    // the current phase contract keeps one private conversation without
    // turning earlier stage instructions into permanent world authority.
    body.instructions = system;
  }
  return body;
}

function compactSchemaHint(schema = {}, schemaName = "character_town_payload") {
  const required = Array.isArray(schema.required) ? schema.required : Object.keys(schema.properties || {});
  const fields = required.map((key) => {
    const property = schema.properties?.[key] || {};
    const enumHint = Array.isArray(property.enum) && property.enum.length
      ? ` one of [${property.enum.join("|")}]`
      : "";
    return `${key}:${property.type || "value"}${enumHint}`;
  }).join(", ");
  return `\n\nReturn only one valid JSON object. Put these fields directly at the top level: ${fields}. Do not wrap the object inside a key named ${schemaName}. Follow the field semantics and nested shapes described in the task; do not use Markdown.`;
}

function buildChatCompletionsBody({
  model,
  system,
  user,
  schema,
  schemaName,
  schemaHintMode = "full",
  conversationMessages = [],
  thinkingMode = "",
}) {
  const schemaHint = schema
    ? (schemaHintMode === "compact"
      ? compactSchemaHint(schema, schemaName || "character_town_payload")
      : `\n\nReturn only valid JSON matching this schema named ${schemaName || "character_town_payload"}:\n${JSON.stringify(schema)}`)
    : "\n\nReturn only valid JSON.";
  const currentMessages = [
    { role: "system", content: `${system}${schemaHint}` },
    { role: "user", content: user },
  ];
  return {
    model,
    messages: [...conversationMessages, ...currentMessages],
    response_format: { type: "json_object" },
    ...(thinkingMode ? { thinking: { type: thinkingMode } } : {}),
  };
}

function buildStreamingTextBody({ config, model, system, user }) {
  if (config.kind === "chat-completions") {
    return {
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      stream: true,
      stream_options: { include_usage: true },
    };
  }
  return {
    model,
    input: [
      { role: "system", content: [{ type: "input_text", text: system }] },
      { role: "user", content: [{ type: "input_text", text: user }] },
    ],
    stream: true,
  };
}

export function parseModelJson(data) {
  if (data.output_parsed && typeof data.output_parsed === "object") return data.output_parsed;
  const text = extractText(data);
  if (!text) throw new Error("模型响应缺少可解析文本。 ");
  const parseJsonText = (value) => {
    try {
      return JSON.parse(value);
    } catch (error) {
      const punctuationRepaired = repairLikelyClosingSmartQuotes(value);
      const repaired = repairStringControlCharacters(punctuationRepaired);
      if (repaired === value) throw error;
      return JSON.parse(repaired);
    }
  };
  try {
    return parseJsonText(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("模型响应不是 JSON。 ");
    return parseJsonText(match[0]);
  }
}

function repairLikelyClosingSmartQuotes(text) {
  const source = String(text);
  let repaired = "";
  let inString = false;
  let escaped = false;
  let changed = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      repaired += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      repaired += char;
      escaped = inString;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      repaired += char;
      continue;
    }
    if (inString && char === "”") {
      let cursor = index + 1;
      while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;
      if (cursor < source.length && /[,\]}]/.test(source[cursor])) {
        repaired += "\"";
        inString = false;
        changed = true;
        continue;
      }
    }
    repaired += char;
  }
  return changed ? repaired : text;
}

function repairStringControlCharacters(text) {
  let repaired = "";
  let inString = false;
  let escaped = false;
  let changed = false;
  for (const char of String(text)) {
    if (escaped) {
      repaired += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      repaired += char;
      escaped = inString;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      repaired += char;
      continue;
    }
    if (inString && char === "\n") {
      repaired += "\\n";
      changed = true;
      continue;
    }
    if (inString && char === "\r") {
      repaired += "\\r";
      changed = true;
      continue;
    }
    if (inString && char === "\t") {
      repaired += "\\t";
      changed = true;
      continue;
    }
    repaired += char;
  }
  return changed ? repaired : text;
}

function modelFinishReason(data = {}) {
  return data?.choices?.[0]?.finish_reason
    || data?.status
    || data?.incomplete_details?.reason
    || "";
}

function assertNotTruncatedModelResponse(data = {}, { model } = {}) {
  const reason = String(modelFinishReason(data) || "");
  const incompleteReason = String(data?.incomplete_details?.reason || "");
  if (reason === "length" || reason === "max_output_tokens" || incompleteReason === "max_output_tokens") {
    throw new Error(`模型响应在服务端输出上限处截断，无法解析完整 JSON。model=${model || "unknown"}；当前请求未设置 max_tokens。请收窄该阶段返回字段或使用支持更大输出的模型。`);
  }
}

const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENETRESET",
  "ECONNREFUSED",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);
const MAX_TRANSIENT_NETWORK_RETRIES = 2;

function isTransientNetworkError(error) {
  if (error?.name === "AbortError") return false;
  const code = String(error?.code || error?.cause?.code || "").toUpperCase();
  if (TRANSIENT_NETWORK_CODES.has(code)) return true;
  return /fetch failed|network|socket|connection reset|timed out/i.test(String(error?.message || ""));
}

function isTransientHttpStatus(status) {
  return status === 408 || status === 429 || (status >= 500 && status <= 504);
}

async function waitBeforeNetworkRetry(signal, retryCount = 1) {
  if (signal?.aborted) throw signal.reason || new Error("请求已取消。 ");
  await new Promise((resolve) => setTimeout(resolve, 350 * Math.max(1, retryCount)));
  if (signal?.aborted) throw signal.reason || new Error("请求已取消。 ");
}

export async function callOpenAIJson({
  system,
  user,
  schema,
  schemaName,
  schemaHintMode = "full",
  model: modelOverride,
  signal,
  requestBudget = null,
  requestContext = {},
  conversationContext = null,
  providerConfig = null,
}) {
  const config = providerConfig || currentProviderConfig();
  const apiKey = config.apiKey;
  if (!apiKey) throw new Error("缺少 CHARACTER_TOWN_API_KEY/OPENAI_API_KEY/DEEPSEEK_API_KEY，无法使用真实模型模式。 ");
  const model = modelOverride || currentModel();
  const startedAt = Date.now();
  let data = null;
  let parsed = null;
  let parseRetryCount = 0;
  let networkRetryCount = 0;
  let lastParseError = null;
  let acceptedRequestBody = null;
  const previousResponseId = String(conversationContext?.previousResponseId || "").trim();
  const conversationMessages = Array.isArray(conversationContext?.messages)
    ? structuredClone(conversationContext.messages).filter((row) => (
      row && ["system", "user", "assistant"].includes(row.role) && typeof row.content === "string"
    )).slice(-40)
    : [];
  while (!parsed) {
    const attemptSystem = parseRetryCount === 0
      ? system
      : `${system}\n\n上一次输出无法通过 JSON.parse。请重新生成，并且只返回完整、合法、没有 Markdown 围栏的 JSON；所有字符串必须使用英文双引号闭合。`;
    const body = config.kind === "chat-completions"
      ? buildChatCompletionsBody({
        model,
        system: attemptSystem,
        user,
        schema,
        schemaName,
        schemaHintMode,
        conversationMessages,
        thinkingMode: config.thinkingMode,
      })
      : buildResponsesBody({
        model,
        system: attemptSystem,
        user,
        schema,
        schemaName,
        previousResponseId,
      });
    if (requestBudget) {
      reserveModelProviderRequest(requestBudget, {
        ...requestContext,
        parseRetryCount,
        networkRetryCount,
      });
    }
    let response;
    try {
      response = await fetch(config.url, {
        method: "POST",
        headers: {
          "authorization": `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (!isTransientNetworkError(error) || networkRetryCount >= MAX_TRANSIENT_NETWORK_RETRIES) throw error;
      networkRetryCount += 1;
      await waitBeforeNetworkRetry(signal, networkRetryCount);
      continue;
    }
    data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data?.error?.message || `OpenAI API HTTP ${response.status}`;
      if (isTransientHttpStatus(response.status) && networkRetryCount < MAX_TRANSIENT_NETWORK_RETRIES) {
        networkRetryCount += 1;
        await waitBeforeNetworkRetry(signal, networkRetryCount);
        continue;
      }
      throw new Error(message);
    }
    assertNotTruncatedModelResponse(data, { model });
    try {
      parsed = parseModelJson(data);
      acceptedRequestBody = body;
      break;
    } catch (error) {
      lastParseError = error;
      if (parseRetryCount >= 1) throw error;
      parseRetryCount += 1;
    }
  }
  if (!parsed) throw lastParseError || new Error("模型响应不是 JSON。 ");
  const conversationCheckpoint = conversationContext == null
    ? undefined
    : config.kind === "responses"
      ? {
        schemaVersion: "model-conversation-context-v1",
        kind: "responses",
        previousResponseId: String(data.id || "").trim(),
      }
      : {
        schemaVersion: "model-conversation-context-v1",
        kind: "chat-completions",
        messages: [
          ...(acceptedRequestBody?.messages || []),
          { role: "assistant", content: extractText(data) },
        ].slice(-40),
      };
  return {
    parsed,
    meta: {
      model,
      provider: config.kind,
      url: config.url,
      elapsedMs: Date.now() - startedAt,
      responseId: data.id || null,
      usage: data.usage || null,
      retryCount: parseRetryCount + networkRetryCount,
      parseRetryCount,
      networkRetryCount,
      ...(conversationCheckpoint ? { conversationCheckpoint } : {}),
      ...(requestBudget ? { requestBudget: modelRequestBudgetSnapshot(requestBudget) } : {}),
    },
  };
}

function streamedTextDelta(data = {}, provider = "chat-completions") {
  if (provider === "chat-completions") return data?.choices?.[0]?.delta?.content || "";
  if (data?.type === "response.output_text.delta") return data.delta || "";
  return "";
}

async function consumeModelTextStream(response, { provider, onDelta }) {
  if (!response.body?.getReader) throw new Error("模型响应不支持流式读取。 ");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let usage = null;
  let finishReason = "";

  const consumeLine = async (line) => {
    const trimmed = String(line || "").trim();
    if (!trimmed || trimmed.startsWith(":") || trimmed.startsWith("event:")) return false;
    const payload = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed;
    if (!payload) return false;
    if (payload === "[DONE]") return true;
    let data;
    try {
      data = JSON.parse(payload);
    } catch {
      throw new Error("模型流包含无法解析的 SSE 数据。 ");
    }
    if (data?.error) throw new Error(data.error.message || "模型流返回错误。 ");
    const delta = String(streamedTextDelta(data, provider) || "");
    if (delta) {
      text += delta;
      await onDelta?.(delta);
    }
    usage = data.usage || data.response?.usage || usage;
    finishReason = data?.choices?.[0]?.finish_reason || data?.response?.status || finishReason;
    return false;
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (await consumeLine(line)) {
        await reader.cancel().catch(() => {});
        return { text, usage, finishReason };
      }
    }
    if (done) break;
  }
  if (buffer.trim()) await consumeLine(buffer);
  return { text, usage, finishReason };
}

export async function callOpenAITextStream({ system, user, signal, onDelta }) {
  const config = currentProviderConfig();
  if (!config.apiKey) throw new Error("缺少 OPENAI_API_KEY/DEEPSEEK_API_KEY，无法使用真实模型模式。 ");
  const model = currentModel();
  const startedAt = Date.now();
  let networkRetryCount = 0;

  while (true) {
    const body = buildStreamingTextBody({ config, model, system, user });
    let emittedText = false;
    let response;
    try {
      response = await fetch(config.url, {
        method: "POST",
        headers: {
          "authorization": `Bearer ${config.apiKey}`,
          "content-type": "application/json",
          "accept": "text/event-stream",
        },
        body: JSON.stringify(body),
        signal,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const error = new Error(data?.error?.message || `OpenAI API HTTP ${response.status}`);
        error.transient = isTransientHttpStatus(response.status);
        throw error;
      }
      const streamed = await consumeModelTextStream(response, {
        provider: config.kind,
        onDelta: async (delta) => {
          emittedText = true;
          await onDelta?.(delta);
        },
      });
      if (!streamed.text.trim()) throw new Error("模型流没有返回小说正文。 ");
      if (streamed.finishReason === "length" || streamed.finishReason === "max_output_tokens") {
        throw new Error(`模型正文在服务端输出上限处截断。model=${model}；当前请求未设置 max_tokens。`);
      }
      return {
        text: streamed.text,
        meta: {
          model,
          provider: config.kind,
          url: config.url,
          elapsedMs: Date.now() - startedAt,
          usage: streamed.usage,
          finishReason: streamed.finishReason,
          networkRetryCount,
        },
      };
    } catch (error) {
      const transient = error?.transient || isTransientNetworkError(error);
      if (emittedText || !transient || networkRetryCount >= MAX_TRANSIENT_NETWORK_RETRIES) throw error;
      networkRetryCount += 1;
      await waitBeforeNetworkRetry(signal, networkRetryCount);
    }
  }
}
