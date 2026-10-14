// 天意 over HTTP (P6.6b): a world event is queued only for the run that is
// actually running, only from the same origin, only as JSON and only of a
// known kind; only the event's own fields are written to the run's queue; the
// page sees each event with what became of it; worlds say whether they are
// towns. The model key never appears.
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, writeFile, readFile, appendFile, rm } from "node:fs/promises";
import jiexing from "../src/worlds/jiexing/pack.mjs";
import { createFreshWorldSave } from "../src/worlds/freshWorld.mjs";
import { createRunsApi } from "../src/server/observer/runsApi.mjs";
import { WORLD_EVENT_QUEUE_FILE, WORLD_EVENT_RESULTS_FILE } from "../src/server/simulation/worldEventQueue.mjs";

const KEY = "probe-secret-key-0123456789";
const runsRoot = await mkdtemp(path.join(os.tmpdir(), "world-events-api-"));
await mkdir(path.join(runsRoot, "fresh-jiexing"));
await writeFile(path.join(runsRoot, "fresh-jiexing", "world-save.json"), JSON.stringify((await createFreshWorldSave(jiexing, { runId: "fresh-jiexing" })).save));
const children = [];
function fakeSpawn() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  children.push(child);
  return child;
}
const api = createRunsApi({ runsRoot, projectRoot: process.cwd(), env: { GEMINI_API_KEY: KEY, GEMINI_API_BASE_URL: "https://gateway.invalid/v1" },
  spawnRunner: fakeSpawn, clock: () => new Date("2026-10-10T12:00:00Z") });
const server = http.createServer((req, res) => {
  api.handle(req, res, new URL(req.url, "http://localhost")).then((handled) => { if (!handled) { res.writeHead(404); res.end(); } });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (pathname, { method = "GET", body, headers = {} } = {}) => {
  const response = await fetch(base + pathname, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  assert.ok(!text.includes(KEY), `response to ${method} ${pathname} never contains the model key`);
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

try {
  // Worlds say whether they are towns, so the page knows where 天意 applies.
  const worlds = await call("/api/worlds");
  assert.ok(worlds.body.worlds.every((row) => typeof row.scale === "string"));
  assert.equal((await call("/api/runs/fresh-jiexing/feed")).body.world.scale, "");

  // Nothing is running: no event is queued.
  const rain = { kind: "weather", weather: "rain" };
  assert.equal((await call("/api/runs/fresh-jiexing/events", { method: "POST", body: rain })).body.code, "RUN_NOT_ACTIVE");
  assert.equal((await call("/api/runs/no-such-run/events", { method: "POST", body: rain })).body.code, "RUN_NOT_ACTIVE");
  assert.equal((await call("/api/runs/..%2Fescape/events", { method: "POST", body: rain })).status, 404);

  const started = await call("/api/runs/start", { method: "POST", body: { world: "jiexing", turns: 10, maxRequests: 60, model: "gemini-3.8-flash-medium", authorized: true } });
  assert.equal(started.status, 202);
  const runId = started.body.runId;
  const events = `/api/runs/${runId}/events`;

  // The runner has not made its directory yet.
  assert.equal((await call(events, { method: "POST", body: rain })).body.code, "RUN_STARTING");
  await mkdir(path.join(runsRoot, runId));

  // Guards.
  assert.equal((await call(events, { method: "POST", body: rain, headers: { origin: "https://evil.example" } })).status, 403);
  const plain = await fetch(base + events, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify(rain) });
  assert.equal(plain.status, 415, "a form-style cross-site post cannot queue an event");
  assert.equal((await call(events, { method: "POST", body: { kind: "boom" } })).body.code, "WORLD_EVENT_KIND_INVALID");
  assert.equal((await call(events, { method: "POST", body: { kind: "message", text: "x".repeat(5000) } })).status, 413);

  // Queued: only the event's own fields reach the runner.
  const queued = await call(events, { method: "POST", body: { ...rain, authorized: true, runId: "other", note: "<script>" } });
  assert.equal(queued.status, 202);
  assert.equal(queued.body.status, "queued");
  const message = await call(events, { method: "POST", body: { kind: "message", toCharacterId: "char_jx_abao", text: "官船到了。", from: "渡口的人" } });
  const lines = (await readFile(path.join(runsRoot, runId, WORLD_EVENT_QUEUE_FILE), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(lines.map((row) => row.event), [rain, { kind: "message", toCharacterId: "char_jx_abao", text: "官船到了。", from: "渡口的人" }]);
  assert.notEqual(lines[0].eventId, lines[1].eventId);

  // The page sees each event and, once the runner has settled it, its result.
  await appendFile(path.join(runsRoot, runId, WORLD_EVENT_RESULTS_FILE), `${JSON.stringify({ eventId: queued.body.eventId, status: "applied", delivered: 3 })}\n`);
  const listed = await call(events);
  assert.deepEqual(listed.body.events.map((row) => [row.eventId, row.kind, row.status]), [[queued.body.eventId, "weather", "applied"], [message.body.eventId, "message", "queued"]]);
  assert.equal(listed.body.events[0].delivered, 3);

  // A run that is stopping takes no more events.
  await call(`/api/runs/${runId}/stop`, { method: "POST" });
  assert.equal((await call(events, { method: "POST", body: rain })).body.code, "RUN_NOT_ACTIVE");
  children.at(-1).emit("exit", 0, null);
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(runsRoot, { recursive: true, force: true });
}

console.log("World events API passed: active run only, same origin, JSON, known kinds, own fields only, results listed, town flag on worlds.");
