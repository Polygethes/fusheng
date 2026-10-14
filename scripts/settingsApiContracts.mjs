import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createSettingsApi } from "../src/server/observer/settingsApi.mjs";
import { createRunsApi } from "../src/server/observer/runsApi.mjs";
import { readSettings, modelEnv } from "../src/server/localData.mjs";

const home = await mkdtemp(path.join(os.tmpdir(), "settings-api-"));
const runsRoot = await mkdtemp(path.join(os.tmpdir(), "settings-runs-"));
const envForHome = { CHARACTER_TOWN_HOME: home };

const KEY = "sk-settings-contract-secret-key-12345678";
let fakeFetchStatus = 200;
let fakeFetchBody = { ok: true, model: "gemini-3.8-flash" };
let lastFetch = null;
const fakeFetch = async (url, init = {}) => {
  lastFetch = { url: String(url), body: init.body ? JSON.parse(init.body) : null };
  if (fakeFetchStatus !== 200) {
    return new Response(JSON.stringify({ error: { message: "Invalid key" } }), {
      status: fakeFetchStatus,
      headers: { "content-type": "application/json" },
    });
  }
  return new Response(JSON.stringify({
    choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }],
    model: "gemini-3.8-flash",
  }), { status: 200, headers: { "content-type": "application/json" } });
};

const settingsApi = createSettingsApi({ env: envForHome, fetchImpl: fakeFetch });

const spawned = [];
function fakeSpawn({ args, env }) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kills = [];
  child.kill = (signal) => { child.kills.push(signal); };
  spawned.push({ args, env, child });
  return child;
}

const runsApi = createRunsApi({
  runsRoot,
  projectRoot: process.cwd(),
  env: async () => modelEnv(await readSettings(envForHome), process.env),
  spawnRunner: fakeSpawn,
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/settings") && await settingsApi.handle(req, res, url)) return;
  if (await runsApi.handle(req, res, url)) return;
  res.writeHead(404);
  res.end();
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const call = async (pathname, { method = "GET", body, headers = {} } = {}) => {
  const response = await fetch(base + pathname, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  assert.ok(!text.includes(KEY), `response to ${method} ${pathname} never contains the secret key`);
  return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
};

try {
  // 1. Initial GET -> configured: false
  const initial = await call("/api/settings");
  assert.equal(initial.status, 200);
  assert.equal(initial.body.ok, true);
  assert.equal(initial.body.settings.configured, false);
  assert.equal(initial.headers.get("cache-control"), "no-store");

  // 2. PUT text/plain -> 415; cross-site origin -> 403; bad baseUrl -> 400
  const plain = await fetch(`${base}/api/settings`, {
    method: "PUT",
    headers: { "content-type": "text/plain" },
    body: JSON.stringify({ provider: "gemini" }),
  });
  assert.equal(plain.status, 415, "rejects non-json content-type");

  const evil = await call("/api/settings", {
    method: "PUT",
    body: { provider: "gemini" },
    headers: { origin: "https://evil.example" },
  });
  assert.equal(evil.status, 403, "rejects cross-site origin");

  const badUrl = await call("/api/settings", {
    method: "PUT",
    body: { provider: "openai-compatible", baseUrl: "http://insecure.example" },
  });
  assert.equal(badUrl.status, 400);
  assert.equal(badUrl.body.code, "SETTINGS_INVALID");
  assert.ok(badUrl.body.issues.some((i) => i.field === "baseUrl"));

  // 3. PUT valid (including KEY) -> 200, no KEY in body, includes keyMask
  const validPut = await call("/api/settings", {
    method: "PUT",
    body: {
      provider: "openai-compatible",
      baseUrl: "https://gw.example:18081/v1",
      apiKey: KEY,
      model: "gemini-3.8-flash-high",
      responseFormat: "json_object",
    },
  });
  assert.equal(validPut.status, 200);
  assert.equal(validPut.body.ok, true);
  assert.equal(validPut.body.settings.configured, true);
  assert.ok(validPut.body.settings.keyMask);
  assert.ok(!JSON.stringify(validPut.body).includes(KEY));

  // A2 contract: Changing host without providing apiKey returns 400 KEY_REQUIRED_FOR_NEW_HOST
  const changeHostWithoutKey = await call("/api/settings", {
    method: "PUT",
    body: {
      baseUrl: "https://newgw.example:18081/v1",
    },
  });
  assert.equal(changeHostWithoutKey.status, 400);
  assert.equal(changeHostWithoutKey.body.code, "KEY_REQUIRED_FOR_NEW_HOST");

  // Providing new key succeeds
  const changeHostWithKey = await call("/api/settings", {
    method: "PUT",
    body: {
      baseUrl: "https://newgw.example:18081/v1",
      apiKey: KEY,
    },
  });
  assert.equal(changeHostWithKey.status, 200);

  // 4. GET /api/runs reports modelKeyConfigured === true, gateway host
  const runs = await call("/api/runs");
  assert.equal(runs.body.modelKeyConfigured, true);
  assert.equal(runs.body.gateway, "newgw.example:18081");

  // 5. POST /api/runs/start -> 202, fake spawn env.GEMINI_API_KEY === KEY, no key in args
  const startRes = await call("/api/runs/start", {
    method: "POST",
    body: {
      world: "jiexing",
      model: "gemini-3.8-flash-high",
      turns: 2,
      maxRequests: 10,
      authorized: true,
    },
  });
  assert.equal(startRes.status, 202);
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].env.GEMINI_API_KEY, KEY);
  assert.ok(!spawned[0].args.join(" ").includes(KEY));

  // 6. POST /api/settings/test
  fakeFetchStatus = 200;
  const testSuccess = await call("/api/settings/test", { method: "POST", body: {} });
  assert.equal(testSuccess.status, 200);
  assert.equal(testSuccess.body.ok, true);
  assert.equal(testSuccess.body.model, "gemini-3.8-flash");

  fakeFetchStatus = 401;
  const testFail = await call("/api/settings/test", { method: "POST", body: {} });
  assert.equal(testFail.status, 200);
  assert.equal(testFail.body.ok, false);
  assert.equal(testFail.body.code, "GEMINI_API_ERROR");
  assert.equal(testFail.body.message, "密钥被拒绝。", "a rejected key is explained in plain Chinese");

  // 7. DeepSeek: a gateway key is never carried over; the address is fixed;
  // answers come as json_object; the test call reaches DeepSeek's own endpoint.
  const toDeepSeekWithoutKey = await call("/api/settings", { method: "PUT", body: { provider: "deepseek" } });
  assert.equal(toDeepSeekWithoutKey.status, 400);
  assert.equal(toDeepSeekWithoutKey.body.code, "KEY_REQUIRED_FOR_NEW_HOST", "switching to DeepSeek asks for its own key");
  const toDeepSeek = await call("/api/settings", { method: "PUT", body: { provider: "deepseek", model: "deepseek-flash", responseFormat: "json_schema", apiKey: KEY } });
  assert.equal(toDeepSeek.status, 200);
  assert.deepEqual([toDeepSeek.body.settings.provider, toDeepSeek.body.settings.baseUrl, toDeepSeek.body.settings.responseFormat, toDeepSeek.body.settings.model],
    ["deepseek", "", "json_object", "deepseek-flash"]);
  fakeFetchStatus = 200;
  const deepSeekTest = await call("/api/settings/test", { method: "POST", body: {} });
  assert.equal(deepSeekTest.body.ok, true);
  assert.equal(lastFetch.url, "https://api.deepseek.com/chat/completions");
  assert.deepEqual(lastFetch.body.response_format, { type: "json_object" });
  assert.equal((await call("/api/runs")).body.gateway, "api.deepseek.com");
} finally {
  server.close();
  await rm(home, { recursive: true, force: true });
  await rm(runsRoot, { recursive: true, force: true });
}
console.log("Settings API contracts passed: read/write/test with secret isolation, runsApi env integration.");
