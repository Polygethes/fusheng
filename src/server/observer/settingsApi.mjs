import { readSettings, writeSettings, validateSettingsPatch, publicSettings, modelApiBaseUrl } from "../localData.mjs";
import { callModelJson } from "../model/modelClient.mjs";

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function friendlyErrorMessage(err, apiKey) {
  const code = err.code || "";
  const status = err.httpStatus || err.status || 0;
  const msg = String(err.message || "");

  if (code === "FETCH_FAILED" || /fetch failed|ECONNREFUSED|ENOTFOUND/i.test(msg)) {
    return "连不上这个地址。";
  }
  if (code === "GEMINI_API_ERROR" && (status === 401 || status === 403)) {
    return "密钥被拒绝。";
  }
  if (status === 404 || /not found/i.test(msg)) {
    return "模型名或地址不对。";
  }
  if (code === "GEMINI_RESPONSE_INCOMPLETE") {
    return "模型没有答完，可换个模型再试。";
  }
  return msg.replaceAll(apiKey, "<REDACTED>") || "测试连接失败。";
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

async function readBody(req, limit = 16 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("Request body too large."), { status: 413, code: "BODY_TOO_LARGE" });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { throw Object.assign(new Error("Request body must be JSON."), { status: 400, code: "BODY_NOT_JSON" }); }
}

export function createSettingsApi({ env = process.env, fetchImpl = fetch } = {}) {
  async function handle(req, res, url) {
    if (!url.pathname.startsWith("/api/settings")) return false;

    // GET /api/settings
    if (url.pathname === "/api/settings" && req.method === "GET") {
      const current = await readSettings(env);
      json(res, 200, { ok: true, settings: publicSettings(current) });
      return true;
    }

    // PUT /api/settings
    if (url.pathname === "/api/settings" && req.method === "PUT") {
      if (!String(req.headers["content-type"] || "").startsWith("application/json")) {
        json(res, 415, { ok: false, code: "JSON_REQUIRED", message: "Content-Type 必须是 application/json。" });
        return true;
      }
      if (!sameOrigin(req)) {
        json(res, 403, { ok: false, code: "CROSS_ORIGIN_FORBIDDEN", message: "禁止跨域请求。" });
        return true;
      }

      let body;
      try { body = await readBody(req, 16 * 1024); }
      catch (err) { json(res, err.status || 400, { ok: false, code: err.code || "BODY_INVALID", message: err.message }); return true; }

      const allowedFields = ["provider", "baseUrl", "apiKey", "model", "responseFormat"];
      const patch = {};
      for (const field of allowedFields) {
        if (body[field] !== undefined) patch[field] = body[field];
      }

      const current = await readSettings(env);
      const issues = validateSettingsPatch(patch, current);
      if (issues.length > 0) {
        json(res, 400, { ok: false, code: "SETTINGS_INVALID", issues });
        return true;
      }

      // Defense in depth: changing the target host when an apiKey exists requires providing the key again
      if (current.apiKey && (patch.apiKey === undefined || patch.apiKey === "")) {
        const merged = { ...current, ...patch };
        const currentUrl = modelApiBaseUrl(current);
        const nextUrl = modelApiBaseUrl(merged);
        try {
          const currentHost = new URL(currentUrl).host;
          const nextHost = new URL(nextUrl).host;
          if (currentHost !== nextHost) {
            json(res, 400, { ok: false, code: "KEY_REQUIRED_FOR_NEW_HOST", message: "换了请求地址，请重新填写密钥。" });
            return true;
          }
        } catch {}
      }

      const saved = await writeSettings(patch, env);
      json(res, 200, { ok: true, settings: publicSettings(saved) });
      return true;
    }

    // POST /api/settings/test
    if (url.pathname === "/api/settings/test" && req.method === "POST") {
      if (!String(req.headers["content-type"] || "").startsWith("application/json")) {
        json(res, 415, { ok: false, code: "JSON_REQUIRED" });
        return true;
      }
      if (!sameOrigin(req)) {
        json(res, 403, { ok: false, code: "CROSS_ORIGIN_FORBIDDEN" });
        return true;
      }

      const current = await readSettings(env);
      if (!current.apiKey) {
        json(res, 412, { ok: false, code: "MODEL_KEY_MISSING", message: "未配置 API 密钥。" });
        return true;
      }

      const apiBaseUrl = modelApiBaseUrl(current);

      try {
        const result = await callModelJson(
          {
            systemPrompt: "Reply with JSON only.",
            userPrompt: 'Return {"ok":true}.',
            schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
          },
          {
            apiKey: current.apiKey,
            apiBaseUrl,
            model: current.model,
            responseFormat: current.responseFormat,
            fetchImpl,
            thinkingLevel: "low",
            maxTokens: 4096,
          }
        );
        json(res, 200, { ok: true, model: result.stage.model, elapsedMs: result.stage.elapsedMs });
      } catch (err) {
        const cleanMessage = friendlyErrorMessage(err, current.apiKey);
        json(res, 200, { ok: false, code: err.code || "MODEL_TEST_FAILED", message: cleanMessage });
      }
      return true;
    }

    return false;
  }

  return { handle };
}
