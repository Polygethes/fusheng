import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { dataHome, readSettings, writeSettings, validateSettingsPatch, publicSettings, maskKey, modelEnv, normalizeSettings, modelApiBaseUrl } from "../src/server/localData.mjs";

const home = await mkdtemp(path.join(os.tmpdir(), "ct-home-"));
const env = { CHARACTER_TOWN_HOME: home };
try {
  assert.equal(dataHome(env), path.resolve(home));
  const empty = await readSettings(env);
  assert.equal(empty.apiKey, "");
  assert.equal(publicSettings(empty).configured, false);

  assert.ok(validateSettingsPatch({ provider: "openai-compatible", baseUrl: "http://x.example" }).some((row) => row.field === "baseUrl"), "http is refused");
  assert.ok(validateSettingsPatch({ provider: "openai-compatible", baseUrl: "" }).some((row) => row.field === "baseUrl"), "a gateway needs an address");
  assert.ok(validateSettingsPatch({ model: "bad model!" }).some((row) => row.field === "model"));
  assert.ok(validateSettingsPatch({ apiKey: "has space inside" }).some((row) => row.field === "apiKey"));
  assert.deepEqual(validateSettingsPatch({ provider: "openai-compatible", baseUrl: "https://gw.example:18081/v1", apiKey: "sk-test-0123456789", model: "gemini-3.8-flash-high" }), []);

  const KEY = "sk-test-0123456789abcd";
  const saved = await writeSettings({ provider: "openai-compatible", baseUrl: "https://gw.example/v1", apiKey: KEY, model: "gemini-3.8-flash-high" }, env);
  assert.equal(saved.apiKey, KEY);
  const file = path.join(home, "settings.json");
  assert.equal((await stat(file)).mode & 0o777, 0o600, "settings file is private to the user");
  assert.equal((await readSettings(env)).apiKey, KEY);

  const kept = await writeSettings({ model: "gemini-3.8-flash" }, env);
  assert.equal(kept.apiKey, KEY, "a patch without apiKey keeps the saved key");
  const pub = publicSettings(kept);
  assert.equal(pub.configured, true);
  assert.equal(pub.keyMask, maskKey(KEY));
  assert.ok(!JSON.stringify(pub).includes(KEY), "public settings never contain the key");
  assert.ok(!maskKey(KEY).includes(KEY.slice(4, -4)));

  const childEnv = modelEnv(kept, { PATH: "/bin", GEMINI_API_KEY: "old" });
  assert.equal(childEnv.GEMINI_API_KEY, KEY, "page settings win over the launch environment");
  assert.equal(childEnv.GEMINI_API_BASE_URL, "https://gw.example/v1");
  assert.equal(childEnv.PATH, "/bin");

  // A1 contract: switch to gemini clears baseUrl and drops GEMINI_API_BASE_URL
  const switchedToGemini = await writeSettings({ provider: "gemini" }, env);
  assert.equal(switchedToGemini.provider, "gemini");
  assert.equal(switchedToGemini.baseUrl, "");
  const geminiEnv = modelEnv(switchedToGemini, { GEMINI_API_BASE_URL: "https://old-gw.example/v1" });
  assert.equal(geminiEnv.GEMINI_API_BASE_URL, undefined, "switching to gemini drops GEMINI_API_BASE_URL");

  // A1 contract: validateSettingsPatch with current settings
  const gwSaved = { provider: "openai-compatible", baseUrl: "https://gw.example/v1", model: "gemini-3.8-flash" };
  assert.deepEqual(validateSettingsPatch({ provider: "openai-compatible" }, gwSaved), [], "patching provider with already saved baseUrl is valid");

  const nativeEnv = modelEnv({ ...kept, provider: "gemini", baseUrl: "" }, { GEMINI_API_BASE_URL: "https://stale.example" });
  assert.equal(nativeEnv.GEMINI_API_BASE_URL, undefined, "native Gemini drops a stale gateway address");
  assert.equal(modelEnv(empty, { GEMINI_API_KEY: "launch-key" }).GEMINI_API_KEY, "launch-key", "no saved key: the launch environment still works");

  // DeepSeek: a fixed address, its own default model, JSON only through json_object.
  const deepseek = normalizeSettings({ provider: "deepseek", baseUrl: "https://elsewhere.example/v1", model: "", responseFormat: "json_schema", apiKey: KEY });
  assert.deepEqual([deepseek.baseUrl, deepseek.model, deepseek.responseFormat], ["", "deepseek-flash", "json_object"]);
  assert.equal(modelApiBaseUrl(deepseek), "https://api.deepseek.com");
  assert.equal(modelEnv(deepseek, { GEMINI_API_BASE_URL: "https://stale.example" }).GEMINI_API_BASE_URL, "https://api.deepseek.com");
  assert.deepEqual(validateSettingsPatch({ provider: "deepseek", apiKey: "sk-deepseek-0123456789" }), [], "DeepSeek needs no address");

  await writeSettings({ apiKey: "" }, env);
  assert.equal((await readSettings(env)).apiKey, "", "an explicit empty key clears it");
  assert.ok(!(await readFile(file, "utf8")).includes(KEY));
} finally {
  await rm(home, { recursive: true, force: true });
}
console.log("Local data passed: private settings file, masked public view, launch-environment fallback, explicit clearing.");
