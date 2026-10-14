import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { request } from "node:http";
import { initialState } from "../src/data/seed.js";

function localRequest(url, { method = "GET", body = null } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === null ? "" : JSON.stringify(body);
    const req = request(url, {
      method,
      agent: false,
      headers: {
        connection: "close",
        ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = text; }
        resolve({ status: res.statusCode || 0, ok: (res.statusCode || 0) < 400, data, headers: res.headers });
      });
    });
    req.once("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

async function waitForServer(url, child, logs) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`test server exited early\n${logs()}`);
    try {
      const response = await localRequest(`${url}/api/health`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`test server did not start\n${logs()}`);
}

const port = await reservePort();
const url = `http://127.0.0.1:${port}`;
let stdout = "";
let stderr = "";
const child = spawn(process.execPath, ["server.mjs"], {
  cwd: new URL("..", import.meta.url),
  env: {
    ...process.env,
    PORT: String(port),
    DEEPSEEK_API_KEY: "test-key",
    OPENAI_API_KEY: "",
    OPENAI_BASE_URL: "bad://deepseek.invalid",
    CHARACTER_TOWN_MODEL_MODE: "openai",
    CHARACTER_TOWN_MODEL: "deepseek-v4-flash",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", (chunk) => { stdout += chunk; });
child.stderr.on("data", (chunk) => { stderr += chunk; });
const logs = () => `${stdout}\n${stderr}`;

try {
  await waitForServer(url, child, logs);
  const response = await localRequest(`${url}/api/engine/play`, {
    method: "POST",
    body: { state: initialState, mode: "openai", allowFallback: false },
  });
  const payload = response.data;

  assert.equal(response.status, 500, "an async model failure should become an HTTP 500 response");
  assert.equal(payload.ok, false);
  assert.equal(typeof payload.error, "string");
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(child.exitCode, null, `server must survive the rejected model promise\n${logs()}`);

  const health = await localRequest(`${url}/api/health`);
  assert.equal(health.status, 200, "server should still accept requests after the model error");
  const staticModule = await localRequest(`${url}/src/engine/dialogueProtocol.js`);
  assert.match(
    String(staticModule.headers["cache-control"] || ""),
    /no-store/,
    "local static modules should not stay stale across code changes and ordinary reloads",
  );

  const setupResponse = await localRequest(`${url}/api/world/setup`, {
    method: "POST",
    body: {
      setupWorldPrompt: "测试世界",
      setupPeoplePrompt: "测试人物",
      allowFallback: false,
    },
  });
  const setupPayload = setupResponse.data;
  assert.equal(setupResponse.status, 500, "an async setup failure should become an HTTP 500 response");
  assert.equal(setupPayload.ok, false);
  assert.equal(child.exitCode, null, `server must survive a rejected world setup promise\n${logs()}`);

  console.log("serverAsyncErrorResponse:test passed", {
    playStatus: response.status,
    setupStatus: setupResponse.status,
    alive: true,
  });
} finally {
  child.kill("SIGTERM");
}
