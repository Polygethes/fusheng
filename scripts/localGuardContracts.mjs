// Contract verifying localGuard protects /api/ against DNS rebinding via Host header
import assert from "node:assert/strict";
import http from "node:http";
import { isLocalHostHeader } from "../src/server/localGuard.mjs";

assert.equal(isLocalHostHeader("127.0.0.1:8787", 8787), true);
assert.equal(isLocalHostHeader("localhost:8787", 8787), true);
assert.equal(isLocalHostHeader("[::1]:8787", 8787), true);
assert.equal(isLocalHostHeader("127.0.0.1", 8787), true);
assert.equal(isLocalHostHeader("localhost", 8787), true);
assert.equal(isLocalHostHeader("evil.example:8787", 8787), false);
assert.equal(isLocalHostHeader("attacker.com", 8787), false);
assert.equal(isLocalHostHeader("127.0.0.1:9999", 8787), false);

// HTTP integration test
const server = http.createServer((req, res) => {
  const hostHeader = req.headers.host;
  if (req.url?.startsWith("/api/") && !isLocalHostHeader(hostHeader, server.address().port)) {
    res.writeHead(403, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, code: "HOST_FORBIDDEN" }));
    return;
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

try {
  // Test evil host header -> 403
  const evilRes = await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: "/api/settings",
      headers: { host: `evil.example:${port}` },
    }, (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    });
    req.on("error", reject);
    req.end();
  });
  assert.equal(evilRes.status, 403);
  assert.equal(evilRes.body.code, "HOST_FORBIDDEN");

  // Test local host header -> 200
  const goodRes = await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: "/api/settings",
      headers: { host: `127.0.0.1:${port}` },
    }, (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    });
    req.on("error", reject);
    req.end();
  });
  assert.equal(goodRes.status, 200);
  assert.equal(goodRes.body.ok, true);
} finally {
  server.close();
}

console.log("localGuard contracts passed.");
