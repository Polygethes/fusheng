// The drafting endpoints (P5): same-origin JSON only, an explicit authorization
// and request cap, a 200KB reference-text limit, server-sent progress ending in
// the blueprint, one-part rewrites, one draft at a time, and the model key never
// appearing in any event, response or error.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { createCreateApi, SOURCE_BYTES_LIMIT } from "../src/server/observer/createApi.mjs";
import { TAVERN_RELATIONSHIP_METRICS } from "../src/server/ecology/tavernRelationshipDynamics.mjs";

const KEY = "probe-model-key-0123456789";
const fixture = JSON.parse(fs.readFileSync("scripts/fixtures/blueprints/river_town.json", "utf8"));
for (const row of fixture.relationships) {
  row.feelings = Object.fromEntries(Object.entries(row.feelings || {}).filter(([key]) => TAVERN_RELATIONSHIP_METRICS.includes(key)));
  if (!Object.keys(row.feelings).length) row.feelings = { love: 40 };
}
const sizes = Object.fromEntries(fixture.households.map((row) => [row.id, fixture.residents.filter((r) => r.householdId === row.id).length]));
let mode = "ok";
let release = null;
const calls = [];
async function callModel(request) {
  calls.push(request);
  if (mode === "leak") throw Object.assign(new Error(`gateway rejected key ${KEY}`), { code: "MODEL_HTTP_401" });
  if (mode === "slow" && request.stage === "world") await new Promise((resolve) => { release = resolve; });
  if (request.stage === "world") return { meta: fixture.meta, town: fixture.town, households: fixture.households, householdSizes: sizes };
  if (request.stage === "residents") return { residents: fixture.residents.filter((row) => row.householdId === request.user.match(/householdId: ([a-z0-9_-]+)/u)[1]) };
  if (request.stage === "relationships") return { relationships: fixture.relationships };
  if (request.stage === "opening") return { opening: fixture.opening };
  if (request.stage === "rewrite") return { ...structuredClone(fixture.residents[0]), situation: `换了个说法 ${KEY}` };
  return { sections: {} };
}

const api = createCreateApi({ env: { GEMINI_API_KEY: KEY }, callModel });
const keyless = createCreateApi({ env: {}, callModel });
const serve = (target) => http.createServer((req, res) => target.handle(req, res, new URL(req.url, "http://localhost")).then((handled) => { if (!handled) { res.writeHead(404); res.end(); } }));
const server = serve(api);
const keylessServer = serve(keyless);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
await new Promise((resolve) => keylessServer.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
async function post(path, body, { headers = {}, at = base } = {}) {
  const response = await fetch(at + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const text = await response.text();
  assert.ok(!text.includes(KEY), `${path} never returns the key`);
  return { status: response.status, type: response.headers.get("content-type") || "", text, body: response.headers.get("content-type")?.includes("json") ? JSON.parse(text) : null };
}
const events = (text) => text.split("\n\n").filter(Boolean).map((block) => ({
  event: block.match(/^event: (.+)$/mu)?.[1], data: JSON.parse(block.match(/^data: (.+)$/mu)?.[1] || "null") }));
const request = { idea: "江边渡口小镇", sizeHint: 14, authorized: true, maxRequests: 20 };

try {
  // Refusals before any model call.
  const plain = await fetch(`${base}/api/create/generate`, { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" });
  assert.equal(plain.status, 415);
  assert.equal((await post("/api/create/generate", request, { headers: { origin: "https://evil.example" } })).status, 403);
  assert.equal((await post("/api/create/generate", { ...request, authorized: false })).body.code, "AUTHORIZATION_REQUIRED");
  assert.equal((await post("/api/create/generate", { ...request, maxRequests: 41 })).body.code, "REQUESTS_OUT_OF_RANGE");
  assert.equal((await post("/api/create/generate", { ...request, sizeHint: "huge" })).body.code, "SIZE_INVALID");
  assert.equal((await post("/api/create/generate", { ...request, idea: "", sourceText: "" })).body.code, "IDEA_REQUIRED");
  const big = await post("/api/create/generate", { ...request, sourceText: "字".repeat(Math.ceil(SOURCE_BYTES_LIMIT / 3) + 10) });
  assert.equal(big.status, 413);
  assert.equal(big.body.code, "SOURCE_TOO_LARGE");
  assert.equal((await post("/api/create/generate", request, { at: `http://127.0.0.1:${keylessServer.address().port}` })).status, 412);
  assert.equal(calls.length, 0, "nothing reached the model");

  // A draft streams progress and ends with the blueprint.
  const ok = await post("/api/create/generate", request);
  assert.equal(ok.status, 200);
  assert.match(ok.type, /text\/event-stream/u);
  const stream = events(ok.text);
  assert.ok(stream.some((row) => row.event === "progress" && row.data.stage === "world"));
  assert.ok(stream.some((row) => row.event === "progress" && row.data.event === "request"));
  const result = stream.at(-1);
  assert.equal(result.event, "result");
  assert.equal(result.data.ok, true);
  assert.equal(result.data.requests, 8);
  assert.equal(result.data.blueprint.residents.length, 14);
  assert.equal(calls.length, 8);

  // One draft at a time.
  mode = "slow";
  const first = post("/api/create/generate", request);
  while (!release) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal((await post("/api/create/generate", request)).status, 409);
  release();
  assert.equal(events((await first).text).at(-1).data.ok, true);

  // A model error carrying the key is reported without it.
  mode = "leak";
  const leak = await post("/api/create/generate", request);
  const failure = events(leak.text).at(-1);
  assert.equal(failure.event, "error");
  assert.match(failure.data.message, /<REDACTED>/u);

  // One-part rewrite.
  mode = "ok";
  const rewritten = await post("/api/create/rewrite", { blueprint: fixture, sectionPath: `residents/${fixture.residents[0].id}`, instruction: "换个说法", authorized: true, maxRequests: 3 });
  assert.equal(rewritten.status, 200);
  assert.equal(rewritten.body.ok, true);
  assert.match(rewritten.body.blueprint.residents[0].situation, /^换了个说法 <REDACTED>$/u);
  assert.equal(JSON.stringify(rewritten.body.blueprint.residents.slice(1)), JSON.stringify(fixture.residents.slice(1)));
  assert.equal((await post("/api/create/rewrite", { blueprint: fixture, sectionPath: "residents/nobody", authorized: true })).status, 400);
  assert.equal((await post("/api/create/rewrite", { blueprint: fixture, sectionPath: "meta", authorized: true, maxRequests: 6 })).body.code, "REQUESTS_OUT_OF_RANGE");
  assert.equal((await post("/api/create/rewrite", { blueprint: fixture, sectionPath: "meta" })).body.code, "AUTHORIZATION_REQUIRED");
} finally {
  server.close();
  keylessServer.close();
}

console.log("Create API passed: guarded, authorized, capped, streamed, one at a time, key never echoed, one-part rewrite.");
