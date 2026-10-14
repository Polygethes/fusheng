// The real server.mjs refuses API requests whose Host is not this machine, so
// a page that DNS-rebinds its own domain to 127.0.0.1 cannot read or change
// settings (and so cannot send the saved key to a host it chooses).
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { request } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";

function call(port, pathname, { method = "GET", host = `127.0.0.1:${port}`, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === null ? "" : JSON.stringify(body);
    const req = request({ host: "127.0.0.1", port, path: pathname, method, agent: false,
      headers: { host, connection: "close", ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}) } }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = text; }
        resolve({ status: res.statusCode || 0, data });
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
      const { port } = probe.address();
      probe.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

const home = await mkdtemp(path.join(os.tmpdir(), "ct-guard-home-"));
const sessions = await mkdtemp(path.join(os.tmpdir(), "ct-guard-sessions-"));
const port = await reservePort();
let logs = "";
const child = spawn(process.execPath, ["server.mjs"], {
  cwd: new URL("..", import.meta.url),
  env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", CHARACTER_TOWN_HOME: home, GTOWN_RUNTIME_SESSION_DIR: sessions },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", (chunk) => { logs += chunk; });
child.stderr.on("data", (chunk) => { logs += chunk; });

try {
  const deadline = Date.now() + 8_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`server exited early\n${logs}`);
    try { if ((await call(port, "/api/health")).status === 200) break; } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error(`server did not start\n${logs}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  for (const host of [`127.0.0.1:${port}`, `localhost:${port}`]) {
    const ok = await call(port, "/api/settings", { host });
    assert.equal(ok.status, 200, `${host} is this machine`);
  }
  for (const host of [`evil.example:${port}`, "evil.example", `127.0.0.1:${port + 1}`]) {
    const read = await call(port, "/api/settings", { host });
    assert.equal(read.status, 403, `reading settings through ${host} is refused`);
    assert.equal(read.data.code, "HOST_FORBIDDEN");
    const write = await call(port, "/api/settings", { method: "PUT", host, body: { provider: "openai-compatible", baseUrl: "https://evil.example/v1" } });
    assert.equal(write.status, 403, `changing settings through ${host} is refused`);
    const test = await call(port, "/api/settings/test", { method: "POST", host, body: {} });
    assert.equal(test.status, 403, `triggering a model call through ${host} is refused`);
    const create = await call(port, "/api/create/generate", { method: "POST", host, body: { idea: "x", authorized: true, maxRequests: 1 } });
    assert.equal(create.status, 403, `drafting a world through ${host} is refused`);
    const compile = await call(port, "/api/create/compile", { method: "POST", host, body: { blueprint: {} } });
    assert.equal(compile.status, 403, `compiling a world through ${host} is refused`);
  }
  const after = await call(port, "/api/settings");
  assert.equal(after.data.settings.baseUrl, "", "the refused writes changed nothing");
} finally {
  child.kill("SIGTERM");
  await new Promise((resolve) => (child.exitCode !== null ? resolve() : child.once("exit", resolve)));
  await rm(home, { recursive: true, force: true });
  await rm(sessions, { recursive: true, force: true });
}

console.log("Server local guard passed: the running server refuses API calls whose Host is not this machine.");
