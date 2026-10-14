// Quick-mode drafting over HTTP (P5). POST /api/create/generate streams the
// draft's progress as server-sent events and ends with the blueprint and the
// problems still in it; POST /api/create/rewrite redoes one part. Both accept
// only same-origin JSON, need an explicit authorization and a request cap,
// and never echo the model key in any event, response or error.
import { readSettings, modelEnv, normalizeSettings } from "../localData.mjs";
import { callModelJson } from "../model/modelClient.mjs";
import { generateBlueprint, rewriteSection, SOURCE_MODES } from "../../worlds/generation/generateBlueprint.mjs";
import { SIZE_PLANS } from "../../worlds/generation/stages.mjs";

export const SOURCE_BYTES_LIMIT = 200 * 1024;
export const MAX_GENERATE_REQUESTS = 40;
export const MAX_REWRITE_REQUESTS = 5;
const IDEA_LIMIT = 2000;
const INSTRUCTION_LIMIT = 500;

function json(res, status, data) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("请求内容太大。"), { status: 413, code: "BODY_TOO_LARGE" });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { throw Object.assign(new Error("请求内容必须是 JSON。"), { status: 400, code: "BODY_NOT_JSON" }); }
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

function validSize(value) {
  if (SIZE_PLANS[value]) return value;
  const number = Number(value);
  return Number.isInteger(number) && number >= 4 && number <= 30 ? number : null;
}

/** The model as configured in settings (or the launch environment), one JSON answer per call. */
export function settingsModelCaller(settings = {}, env = {}) {
  const saved = normalizeSettings(settings);
  const resolved = modelEnv(saved, env);
  const apiKey = resolved.GEMINI_API_KEY || "";
  const apiBaseUrl = resolved.GEMINI_API_BASE_URL || "https://generativelanguage.googleapis.com";
  return {
    apiKey,
    async call({ system, user, schema, signal }) {
      const result = await callModelJson({ systemPrompt: system, userPrompt: user, schema },
        { apiKey, model: saved.model, apiBaseUrl, responseFormat: saved.responseFormat, thinkingLevel: "medium", signal });
      return result.output;
    },
  };
}

export function createCreateApi({ env = process.env, callModel = null } = {}) {
  let active = false;
  const resolveEnv = async () => (typeof env === "function" ? env() : env);

  async function modelFor() {
    const baseEnv = await resolveEnv();
    if (callModel) return { apiKey: baseEnv.GEMINI_API_KEY || "", call: callModel };
    return settingsModelCaller(await readSettings(baseEnv), baseEnv);
  }

  function guard(req, res) {
    if (!String(req.headers["content-type"] || "").startsWith("application/json")) { json(res, 415, { ok: false, code: "JSON_REQUIRED" }); return false; }
    if (!sameOrigin(req)) { json(res, 403, { ok: false, code: "CROSS_ORIGIN_FORBIDDEN" }); return false; }
    return true;
  }

  async function generate(req, res) {
    if (!guard(req, res)) return;
    const body = await readBody(req, SOURCE_BYTES_LIMIT * 3 + 16 * 1024);
    if (body.authorized !== true) return json(res, 400, { ok: false, code: "AUTHORIZATION_REQUIRED", message: "勾选授权后才能调用模型生成世界。" });
    const maxRequests = Number(body.maxRequests);
    if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > MAX_GENERATE_REQUESTS) {
      return json(res, 400, { ok: false, code: "REQUESTS_OUT_OF_RANGE", message: `请求上限须在 1–${MAX_GENERATE_REQUESTS}。` });
    }
    const sizeHint = validSize(body.sizeHint ?? "medium");
    if (sizeHint == null) return json(res, 400, { ok: false, code: "SIZE_INVALID", message: "规模只能是 small、medium、large 或 4–30 的人数。" });
    const idea = String(body.idea ?? "");
    const sourceText = String(body.sourceText ?? "");
    const sourceMode = String(body.sourceMode ?? "reference");
    if (!SOURCE_MODES.includes(sourceMode)) return json(res, 400, { ok: false, code: "SOURCE_MODE_INVALID", message: "导入文本的用法只能是 reference（参考）或 adapt（按原作改编）。" });
    if (idea.length > IDEA_LIMIT) return json(res, 400, { ok: false, code: "IDEA_TOO_LONG", message: `想法不超过 ${IDEA_LIMIT} 字；长文本请作为参考资料上传。` });
    if (!idea.trim() && !sourceText.trim()) return json(res, 400, { ok: false, code: "IDEA_REQUIRED", message: "写一句想法，或者上传一段参考资料。" });
    if (Buffer.byteLength(sourceText, "utf8") > SOURCE_BYTES_LIMIT) return json(res, 413, { ok: false, code: "SOURCE_TOO_LARGE", message: "参考资料不能超过 200KB。" });
    const model = await modelFor();
    if (!model.apiKey) return json(res, 412, { ok: false, code: "MODEL_KEY_MISSING", message: "先在设置里填 API 密钥。" });
    if (active) return json(res, 409, { ok: false, code: "GENERATION_ACTIVE", message: "已经有一个世界正在生成。" });
    active = true;
    const controller = new AbortController();
    res.on("close", () => controller.abort());
    const redact = (text) => (model.apiKey ? String(text).split(model.apiKey).join("<REDACTED>") : String(text));
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
    const send = (event, data) => { if (!res.writableEnded && !res.destroyed) res.write(`event: ${event}\ndata: ${redact(JSON.stringify(data))}\n\n`); };
    try {
      const result = await generateBlueprint({ idea, sourceText, sourceMode, sizeHint }, {
        maxRequests,
        callModel: (request) => model.call({ ...request, signal: controller.signal }),
        onProgress: (row) => send("progress", row),
      });
      send("result", result);
    } catch (error) {
      send("error", { code: error.code || "GENERATION_FAILED", message: redact(error.message || error).slice(0, 400) });
    } finally {
      active = false;
      if (!res.writableEnded) res.end();
    }
  }

  async function rewrite(req, res) {
    if (!guard(req, res)) return;
    const body = await readBody(req, 512 * 1024);
    if (body.authorized !== true) return json(res, 400, { ok: false, code: "AUTHORIZATION_REQUIRED", message: "勾选授权后才能调用模型重写。" });
    const maxRequests = Number(body.maxRequests ?? 3);
    if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > MAX_REWRITE_REQUESTS) {
      return json(res, 400, { ok: false, code: "REQUESTS_OUT_OF_RANGE", message: `请求上限须在 1–${MAX_REWRITE_REQUESTS}。` });
    }
    if (!body.blueprint || typeof body.blueprint !== "object") return json(res, 400, { ok: false, code: "BLUEPRINT_REQUIRED" });
    const instruction = String(body.instruction ?? "");
    if (instruction.length > INSTRUCTION_LIMIT) return json(res, 400, { ok: false, code: "INSTRUCTION_TOO_LONG", message: `要求不超过 ${INSTRUCTION_LIMIT} 字。` });
    const model = await modelFor();
    if (!model.apiKey) return json(res, 412, { ok: false, code: "MODEL_KEY_MISSING", message: "先在设置里填 API 密钥。" });
    const redact = (text) => (model.apiKey ? String(text).split(model.apiKey).join("<REDACTED>") : String(text));
    try {
      const result = await rewriteSection(body.blueprint, String(body.sectionPath || ""), instruction, { callModel: model.call, maxRequests });
      // A model answer that happens to repeat the key is never sent back as is.
      return json(res, 200, JSON.parse(redact(JSON.stringify(result))));
    } catch (error) {
      const status = ["REWRITE_TARGET_UNKNOWN", "REWRITE_PATH_INVALID"].includes(error.code) ? 400 : 502;
      return json(res, status, { ok: false, code: error.code || "REWRITE_FAILED", message: redact(error.message || error).slice(0, 400) });
    }
  }

  return {
    async handle(req, res, url) {
      try {
        if (url.pathname === "/api/create/generate" && req.method === "POST") { await generate(req, res); return true; }
        if (url.pathname === "/api/create/rewrite" && req.method === "POST") { await rewrite(req, res); return true; }
        return false;
      } catch (error) {
        if (!res.headersSent) json(res, error.status || 500, { ok: false, code: error.code || "CREATE_API_ERROR", message: error.status ? error.message : "服务出错了。" });
        else if (!res.writableEnded) res.end();
        return true;
      }
    },
  };
}
