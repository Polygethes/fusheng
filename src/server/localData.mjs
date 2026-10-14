// Per-user data that never lives in the project folder: model settings (with
// the API key) and the player's own worlds. The key is written only to a
// 0600 file and handed to model processes through their environment.
import os from "node:os";
import path from "node:path";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";

export const SETTINGS_SCHEMA_VERSION = 1;
export const PROVIDERS = Object.freeze(["gemini", "openai-compatible", "deepseek"]);
export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const DEEPSEEK_DEFAULT_MODEL = "deepseek-flash";
const MODEL = /^[\w.:-]{1,80}$/u;
const clean = (value) => String(value ?? "").trim();

export function dataHome(env = process.env) {
  return path.resolve(env.CHARACTER_TOWN_HOME || path.join(os.homedir(), ".character-town"));
}

export async function ensureDataHome(env = process.env) {
  const home = dataHome(env);
  await mkdir(path.join(home, "worlds"), { recursive: true, mode: 0o700 });
  return home;
}

const settingsFile = (env) => path.join(dataHome(env), "settings.json");

export function normalizeSettings(raw = {}) {
  const model = clean(raw.model);
  const provider = PROVIDERS.includes(raw.provider) ? raw.provider : "gemini";
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    provider,
    baseUrl: provider === "openai-compatible" ? clean(raw.baseUrl) : "",
    apiKey: clean(raw.apiKey),
    model: MODEL.test(model) ? model : provider === "deepseek" ? DEEPSEEK_DEFAULT_MODEL : "gemini-3.8-flash",
    // DeepSeek returns JSON only through json_object.
    responseFormat: provider !== "deepseek" && raw.responseFormat === "json_schema" ? "json_schema" : "json_object",
  };
}

export function modelApiBaseUrl(settings = {}) {
  const norm = normalizeSettings(settings);
  if (norm.provider === "openai-compatible") return norm.baseUrl;
  if (norm.provider === "deepseek") return DEEPSEEK_BASE_URL;
  return "https://generativelanguage.googleapis.com";
}

export function validateSettingsPatch(patch = {}, current = {}) {
  const mergedProvider = patch.provider !== undefined ? patch.provider : current.provider;
  const mergedBaseUrl = patch.baseUrl !== undefined ? patch.baseUrl : current.baseUrl;
  const issues = [];
  const add = (field, message) => issues.push({ field, message });
  if (patch.provider !== undefined && !PROVIDERS.includes(patch.provider)) add("provider", "提供方只能是 gemini、openai-compatible 或 deepseek。");
  const needsUrl = mergedProvider === "openai-compatible";
  if (patch.baseUrl !== undefined || (patch.provider !== undefined && needsUrl)) {
    const value = clean(mergedBaseUrl);
    if (!value && needsUrl) add("baseUrl", "网关需要填写地址。");
    if (value) {
      try {
        const url = new URL(value);
        if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) add("baseUrl", "地址必须是 https，且不能带账号、查询参数或 #。");
      } catch { add("baseUrl", "地址格式不对。"); }
    }
  }
  if (patch.model !== undefined && !MODEL.test(clean(patch.model))) add("model", "模型名只能包含字母、数字和 . _ : -。");
  if (patch.apiKey !== undefined && clean(patch.apiKey) && !/^\S{8,400}$/u.test(clean(patch.apiKey))) add("apiKey", "密钥长度应在 8–400 之间，且不能有空格。");
  if (patch.responseFormat !== undefined && !["json_object", "json_schema"].includes(patch.responseFormat)) add("responseFormat", "输出格式只能是 json_object 或 json_schema。");
  return issues;
}

export async function readSettings(env = process.env) {
  try { return normalizeSettings(JSON.parse(await readFile(settingsFile(env), "utf8"))); }
  catch { return normalizeSettings({}); }
}

export async function writeSettings(patch = {}, env = process.env) {
  const current = await readSettings(env);
  const next = normalizeSettings({ ...current, ...patch, apiKey: patch.apiKey === undefined ? current.apiKey : patch.apiKey });
  await ensureDataHome(env);
  const file = settingsFile(env);
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
  await chmod(file, 0o600);
  return next;
}

export function maskKey(key = "") {
  const value = clean(key);
  if (!value) return "";
  return value.length <= 10 ? "••••" : `${value.slice(0, 3)}…${value.slice(-4)}`;
}

export function publicSettings(settings = {}) {
  const { apiKey, ...rest } = normalizeSettings(settings);
  return { ...rest, configured: Boolean(apiKey), keyMask: maskKey(apiKey) };
}

// Saved settings win over the launch environment; without a saved key the
// launch environment keeps working, so terminal users are not broken.
export function modelEnv(settings = {}, baseEnv = process.env) {
  const env = { ...baseEnv };
  const saved = normalizeSettings(settings);
  if (!saved.apiKey) return env;
  env.GEMINI_API_KEY = saved.apiKey;
  if (saved.provider === "openai-compatible" && saved.baseUrl) {
    env.GEMINI_API_BASE_URL = saved.baseUrl;
  } else if (saved.provider === "deepseek") {
    env.GEMINI_API_BASE_URL = DEEPSEEK_BASE_URL;
  } else {
    delete env.GEMINI_API_BASE_URL;
  }
  return env;
}
