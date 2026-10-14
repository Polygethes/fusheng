// Application-only schema annotations are not Gemini JSON Schema keywords.
export function geminiResponseSchema(value) {
  if (Array.isArray(value)) return value.map(geminiResponseSchema);
  if (!value || typeof value !== "object") return value;
  // Gemini refuses an empty string among enum values. A field that may be left
  // empty is sent as a plain string; the stage's own validation still checks it.
  const emptyAllowed = (key, child) => key === "enum" && Array.isArray(child) && child.includes("");
  return Object.fromEntries(Object.entries(value).filter(([key, child]) => key !== "optionalProperties" && !emptyAllowed(key, child))
    .map(([key, child]) => [key, geminiResponseSchema(child)]));
}

/**
 * Send one system+user prompt and receive one JSON object.
 * @returns {Promise<{ output: object, stage: { provider, requestedModel, model, responseId, usage, outputEnvelope, elapsedMs } }>}
 * Errors keep the existing codes: GEMINI_API_KEY_REQUIRED, GEMINI_CONFIGURATION_INVALID,
 * GEMINI_RESPONSE_INVALID, GEMINI_API_ERROR, GEMINI_RESPONSE_INCOMPLETE, CHARACTER_STAGE_OUTPUT_INVALID (with rawOutput, issues).
 */
/** DeepSeek's own API (api.deepseek.com). */
export function isDeepSeekHost(hostname = "") {
  const host = String(hostname).toLowerCase();
  return host === "api.deepseek.com" || host.endsWith(".deepseek.com");
}

export async function callModelJson({ systemPrompt, userPrompt, schema }, {
  apiKey,
  model = "gemini-3.8-flash",
  thinkingLevel = "medium",
  apiBaseUrl = "https://generativelanguage.googleapis.com",
  responseFormat = "json_schema",
  fetchImpl = fetch,
  signal,
  timeoutMs,
  onRequest,
  onResponse,
  maxTokens = 32768,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (!apiKey) throw Object.assign(new Error("GEMINI_API_KEY is required in the process environment."), { code: "GEMINI_API_KEY_REQUIRED" });
  if (!/^[a-zA-Z0-9_.-]+$/.test(model) || !["low", "medium", "high"].includes(thinkingLevel)
    || !["json_schema", "json_object"].includes(responseFormat)) {
    throw Object.assign(new Error("Invalid Gemini model or thinking level."), { code: "GEMINI_CONFIGURATION_INVALID" });
  }

  const base = new URL(apiBaseUrl);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) {
    throw Object.assign(new Error("Use an explicit HTTPS API base URL without credentials or query parameters."), { code: "GEMINI_CONFIGURATION_INVALID" });
  }
  const native = base.hostname === "generativelanguage.googleapis.com";
  // DeepSeek: POST /chat/completions on its own root, JSON only through
  // json_object, and the word "json" must appear in the prompt.
  const deepseek = isDeepSeekHost(base.hostname);
  if (deepseek) responseFormat = "json_object";
  const apiRoot = apiBaseUrl.replace(/\/+$/u, "");
  const endpoint = native ? `${apiRoot}/v1beta/models/${model}:generateContent`
    : deepseek ? `${apiRoot}/chat/completions`
      : `${apiRoot.endsWith("/v1") ? apiRoot : `${apiRoot}/v1`}/chat/completions`;
  const body = native ? { systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    generationConfig: { responseMimeType: "application/json", responseJsonSchema: geminiResponseSchema(schema),
      thinkingConfig: { thinkingLevel }, maxOutputTokens: maxTokens } }
    : { model, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
      response_format: { type: "json_schema", json_schema: { name: "character_stage", strict: true, schema: geminiResponseSchema(schema) } },
      max_tokens: maxTokens, stream: false };
  if (!native && responseFormat === "json_object") {
    body.response_format = { type: "json_object" };
    // Gateways that reject nested structured-output schemas still receive the
    // complete contract. Local validation/repair retains exactly the same rules.
    body.messages[1].content += `\n\nReturn one JSON object matching this complete output schema. Include EVERY required field at EVERY nesting level. Use enum values exactly. No markdown fences or commentary. Do not replace required private decisions with omitted fields.\n${JSON.stringify(schema)}`;
  }
  if (deepseek) {
    if (!/json/u.test(`${systemPrompt}\n${body.messages[1].content}`)) body.messages[1].content += "\n\nOutput json only.";
    body.thinking = { type: "enabled", reasoning_effort: thinkingLevel === "low" ? "low" : "high" };
  }
  if (onRequest) await onRequest({ endpoint, model, thinkingLevel, body });
  const startedAt = performance.now();
  let response = null;
  let rawText = "";
  let raw = null;
  const attempts = [];
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const attemptStartedAt = performance.now();
    const attemptSignal = signal
      ? (timeoutMs ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : signal)
      : AbortSignal.timeout(timeoutMs ?? 180000);
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json", ...(native ? { "x-goog-api-key": apiKey } : { Authorization: `Bearer ${apiKey}` }) },
        body: JSON.stringify(body),
        signal: attemptSignal,
      });
      rawText = (await response.text()).replaceAll(apiKey, "<REDACTED>");
      try { raw = JSON.parse(rawText); } catch { raw = null; }

      // Retry on transient gateway/upstream failures (502, 503, 504, 429) or unparseable non-JSON responses
      const isTransientHttp = [429, 502, 503, 504].includes(response.status);
      const isHtmlOrNonJson = !raw && !response.ok;
      const isAdmissionControlError = Boolean(raw?.error?.message && String(raw.error.message).includes("admission control"));

      let outcome;
      if (!response.ok || isAdmissionControlError) {
        outcome = `http_${response.status}`;
      } else if (!raw) {
        outcome = "non_json";
      } else {
        outcome = "ok";
      }
      attempts.push({ attempt, outcome, elapsedMs: performance.now() - attemptStartedAt });

      if ((isTransientHttp || isHtmlOrNonJson || isAdmissionControlError) && attempt < maxAttempts) {
        const delay = attempt * 2000;
        await sleep(delay);
        continue;
      }
      break;
    } catch (networkError) {
      const outcome = networkError?.name === "TimeoutError" ? "timeout" : "network_error";
      attempts.push({ attempt, outcome, elapsedMs: performance.now() - attemptStartedAt });
      if (signal?.aborted) {
        networkError.attempts = attempts;
        throw networkError;
      }
      if (attempt < maxAttempts) {
        const delay = attempt * 2000;
        await sleep(delay);
        continue;
      }
      if (outcome === "timeout") {
        throw Object.assign(
          new Error(`模型连续 ${attempts.length} 次在 ${Math.max(1, Math.round((timeoutMs ?? 180000) / 1000))} 秒内没有回应。`),
          { code: "MODEL_REQUEST_TIMEOUT", attempts }
        );
      }
      networkError.attempts = attempts;
      throw networkError;
    }
  }

  if (!raw) {
    throw Object.assign(new Error(`Gemini returned non-JSON (HTTP ${response?.status || "unknown"}).`), { code: "GEMINI_RESPONSE_INVALID", attempts });
  }
  if (onResponse) await onResponse({ httpStatus: response.status, elapsedMs: performance.now() - startedAt, raw, attempts });
  if (!response.ok) throw Object.assign(new Error(String(raw.error?.message || `Gemini HTTP ${response.status}`).slice(0, 1000)),
    { code: "GEMINI_API_ERROR", httpStatus: response.status, attempts });
  const candidate = native ? raw.candidates?.[0] : raw.choices?.[0];
  const finishReason = native ? candidate?.finishReason : candidate?.finish_reason;
  if (finishReason !== (native ? "STOP" : "stop")) throw Object.assign(new Error(`Gemini response did not finish: ${finishReason || raw.promptFeedback?.blockReason || "empty"}.`), { code: "GEMINI_RESPONSE_INCOMPLETE", attempts });
  const text = native ? (candidate.content?.parts || []).filter(part => !part.thought && typeof part.text === "string").map(part => part.text).join("")
    : candidate.message?.content;
  let output;
  const trimmed = String(text ?? "").trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/u.exec(trimmed);
  // Remove only a complete transport envelope; never fill or rewrite authored
  // content. The original provider response is archived before this step.
  try { output = JSON.parse(fenced ? fenced[1] : trimmed); }
  catch { throw Object.assign(new Error("Gemini output was not a complete JSON object."), {
    code: "CHARACTER_STAGE_OUTPUT_INVALID", rawOutput: text,
    issues: [{ code: "STAGE_OUTPUT_INVALID_JSON", path: "output", message: "Return one complete valid JSON object matching the schema." }],
    attempts,
  }); }
  return {
    output,
    stage: {
      provider: native ? "google-gemini-api" : "openai-compatible-gemini-api",
      requestedModel: model,
      model: raw.modelVersion || raw.model || model,
      responseId: raw.responseId || raw.id || null,
      usage: raw.usageMetadata || raw.usage || null,
      outputEnvelope: fenced ? "markdown-json" : "json",
      elapsedMs: performance.now() - startedAt,
      attempts,
    },
  };
}
