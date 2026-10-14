import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import jiexing from "../src/worlds/jiexing/pack.mjs";
import { createFreshWorldSave } from "../src/worlds/freshWorld.mjs";
import { createRunsApi, worldVisual } from "../src/server/observer/runsApi.mjs";
import { compileBlueprint } from "../src/worlds/compiler/index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEY = "probe-secret-key-0123456789";
const runsRoot = await mkdtemp(path.join(os.tmpdir(), "observer-runs-"));
await mkdir(path.join(runsRoot, "fresh-jiexing"));
await writeFile(path.join(runsRoot, "fresh-jiexing", "world-save.json"), JSON.stringify((await createFreshWorldSave(jiexing, { runId: "fresh-jiexing" })).save));

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
const env = { GEMINI_API_KEY: KEY, GEMINI_API_BASE_URL: "https://gateway.invalid/v1" };
const api = createRunsApi({ runsRoot, projectRoot: process.cwd(), env, spawnRunner: fakeSpawn, clock: () => new Date("2026-10-09T12:00:00Z") });
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
  const worlds = await call("/api/worlds");
  assert.deepEqual(worlds.body.worlds.map((row) => row.id).sort(), ["cangxinggu", "jiexing", "xiaoyaoyou"]);

  const runs = await call("/api/runs");
  assert.equal(runs.body.runs.length, 1);
  assert.equal(runs.body.runs[0].worldPackId, "jiexing");
  assert.equal(runs.body.modelKeyConfigured, true);

  const feed = await call("/api/runs/fresh-jiexing/feed");
  assert.equal(feed.status, 200);
  assert.equal(feed.body.world.id, "jiexing");
  assert.ok(feed.body.world.layout.zones.array_eye, "the feed carries the world's pixel layout");
  assert.equal(feed.body.world.cast.length, 5);
  assert.equal(feed.body.initial.entities.char_jx_abao.zoneId, "lane");

  for (const probe of ["/api/runs/..%2F..%2Fetc/feed", "/api/runs/.hidden/feed", "/api/runs/no-such-run/feed"]) {
    assert.equal((await call(probe)).status, 404, `${probe} is refused`);
  }

  const request = { world: "jiexing", turns: 10, maxRequests: 60, model: "gemini-3.8-flash-medium" };
  assert.equal((await call("/api/runs/start", { method: "POST", body: request })).body.code, "AUTHORIZATION_REQUIRED");
  const plain = await fetch(`${base}/api/runs/start`, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ ...request, authorized: true }) });
  assert.equal(plain.status, 415, "a form-style cross-site request cannot start a run");
  assert.equal((await call("/api/runs/start", { method: "POST", body: { ...request, authorized: true }, headers: { origin: "https://evil.example" } })).status, 403);
  assert.equal((await call("/api/runs/start", { method: "POST", body: { ...request, authorized: true, turns: 1001 } })).body.code, "TURNS_OUT_OF_RANGE");
  assert.equal((await call("/api/runs/start", { method: "POST", body: { ...request, authorized: true, maxRequests: 6001 } })).body.code, "REQUESTS_OUT_OF_RANGE");

  const keyless = createRunsApi({ runsRoot, projectRoot: process.cwd(), env: {}, spawnRunner: fakeSpawn });
  const keylessServer = http.createServer((req, res) => keyless.handle(req, res, new URL(req.url, "http://localhost")));
  await new Promise((resolve) => keylessServer.listen(0, "127.0.0.1", resolve));
  const missing = await fetch(`http://127.0.0.1:${keylessServer.address().port}/api/runs/start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...request, authorized: true }) });
  assert.equal(missing.status, 412);
  keylessServer.close();
  assert.equal(spawned.length, 0, "nothing was started without authorization, a key and valid caps");

  const started = await call("/api/runs/start", { method: "POST", body: { ...request, authorized: true } });
  assert.equal(started.status, 202);
  assert.equal(spawned.length, 1);
  const { args, child } = spawned[0];
  assert.deepEqual(args.slice(1, 3), ["--world", "jiexing"]);
  assert.ok(args.includes("--max-requests") && args[args.indexOf("--max-requests") + 1] === "60");
  assert.ok(!args.some((arg) => arg.includes(KEY)), "the key is passed only through the environment");
  assert.equal(args[args.indexOf("--call-mode") + 1], "performance", "new runs use the one-call performance mode unless asked otherwise");
  assert.ok(path.dirname(args[args.indexOf("--out") + 1]) === runsRoot, "the run writes inside sim-runs");

  child.stdout.emit("data", `${JSON.stringify({ event: "request_started", index: 1, startedAt: "2026-10-09T12:00:01.000Z" })}\nnoise ${KEY}\n`);
  const during = await call("/api/runs");
  assert.equal(during.body.active.runId, started.body.runId);
  assert.equal(during.body.active.calls, 1);
  assert.equal(during.body.active.waitingSince, "2026-10-09T12:00:01.000Z", "the observer knows since when the run has waited for the model");
  child.stdout.emit("data", `${JSON.stringify({ event: "request_finished", index: 1, elapsedMs: 5000, attempts: 1 })}\n`);
  assert.equal((await call("/api/runs")).body.active.waitingSince, null, "an answer ends the wait");

  // A silent gateway: the runner says when it will try again, and the retry ends that wait.
  child.stdout.emit("data", `${JSON.stringify({ event: "gateway_wait", round: 1, rounds: 4, waitSeconds: 30, until: "2026-10-09T12:00:40.000Z" })}\n`);
  assert.deepEqual((await call("/api/runs")).body.active.gatewayWait, { until: "2026-10-09T12:00:40.000Z", round: 1, rounds: 4 }, "the observer knows the run is waiting for the gateway");
  child.stdout.emit("data", `${JSON.stringify({ event: "request_started", index: 2, startedAt: "2026-10-09T12:00:40.000Z", gatewayRetry: 1 })}\n`);
  const retrying = (await call("/api/runs")).body.active;
  assert.equal(retrying.gatewayWait, null, "the retry ends the gateway wait");
  assert.equal(retrying.calls, 2, "a retry is a request of its own");
  child.stdout.emit("data", `${JSON.stringify({ event: "request_finished", index: 2, elapsedMs: 3000, attempts: 1 })}\n`);

  assert.equal((await call("/api/runs/start", { method: "POST", body: { ...request, authorized: true } })).status, 409, "one run at a time");
  const startingFeed = await call(`/api/runs/${started.body.runId}/feed`);
  assert.equal(startingFeed.status, 202, "a starting run reports that it is starting");
  assert.equal(startingFeed.body.calls, 2, "and how far it has got before its first save");
  assert.ok("gatewayWait" in startingFeed.body && "waitingSince" in startingFeed.body, "and what it is waiting for");

  assert.equal((await call(`/api/runs/${started.body.runId}/stop`, { method: "POST" })).status, 202);
  assert.deepEqual(child.kills, ["SIGTERM"], "stop asks the runner to finish its current turn and exit");
  child.emit("exit", 0, null);
  assert.equal((await call("/api/runs")).body.active, null);

  // Resume run support contract
  const resumeRequest = { resumeFrom: "fresh-jiexing", turns: 5, maxRequests: 20, model: "gemini-3.8-flash-medium", authorized: true };
  const resumed = await call("/api/runs/start", { method: "POST", body: resumeRequest });
  assert.equal(resumed.status, 202);
  assert.equal(spawned.length, 2);
  const { args: resumeArgs, child: resumeChild } = spawned[1];
  assert.ok(resumeArgs.includes("--resume") && resumeArgs[resumeArgs.indexOf("--resume") + 1].endsWith("fresh-jiexing/world-save.json"));
  assert.ok(resumeArgs.includes("--retry-authorization"));
  assert.ok(resumeArgs.includes("--turns") && resumeArgs[resumeArgs.indexOf("--turns") + 1] === "5");
  resumeChild.emit("exit", 0, null);

  // Save slots: a run and the run that continued it are one save file.
  const freshSave = path.join(runsRoot, "fresh-jiexing", "world-save.json");
  await mkdir(path.join(runsRoot, "cont-1"));
  await writeFile(path.join(runsRoot, "cont-1", "world-save.json"), await readFile(freshSave, "utf8"));
  await writeFile(path.join(runsRoot, "cont-1", "report.json"), JSON.stringify({ source: freshSave, status: "turn_limit_reached", callMode: "performance", startedAt: "2026-10-09T12:05:00Z" }));
  const saves = await call("/api/saves");
  assert.equal(saves.status, 200);
  assert.equal(saves.body.saves.length, 1, "a continued run joins the save it came from");
  const [slot] = saves.body.saves;
  assert.deepEqual(slot.segments, ["fresh-jiexing", "cont-1"]);
  assert.equal(slot.id, "cont-1", "the slot opens at its newest segment");
  assert.equal(slot.slotNumber, 1);
  assert.equal(slot.worldTitle, jiexing.meta.title);
  assert.equal(slot.callMode, "performance");
  assert.equal(slot.cast.length, 5);
  assert.ok(slot.cast.every((row) => row.name && row.zone), "every cast member is placed by name");

  // A1 contract assertions for worldVisual households and startClock
  const jxVisual = worldVisual(jiexing);
  assert.deepEqual(jxVisual.households, [], "jiexing households are empty");
  assert.equal(jxVisual.startClock, "", "jiexing startClock is empty");

  const xiaoyaoyouPack = (await import("../src/worlds/xiaoyaoyou/pack.mjs")).default;
  const xyVisual = worldVisual(xiaoyaoyouPack);
  assert.deepEqual(xyVisual.households, [], "xiaoyaoyou households are empty");

  const riverBlueprint = JSON.parse(await readFile(path.join(__dirname, "fixtures/blueprints/river_town.json"), "utf8"));
  const riverPack = compileBlueprint(riverBlueprint, { seed: 1 }).pack;
  const riverVisual = worldVisual(riverPack);
  const labels = riverVisual.households.map((row) => row.label);
  for (const expected of ["铁家", "林家", "宋家", "陈家", "周家"]) {
    assert.ok(labels.includes(expected), `river town includes household ${expected}`);
  }
  assert.ok(riverVisual.households.every((row) => row.members && row.members.length > 0), "every river town household has members");
  assert.equal(riverVisual.startClock, "08:00", "river town startClock is 08:00");

  // A continued run keeps the mode of the run it continues unless the player picks another.
  await mkdir(path.join(runsRoot, "deep-1"));
  await writeFile(path.join(runsRoot, "deep-1", "world-save.json"), await readFile(path.join(runsRoot, "fresh-jiexing", "world-save.json"), "utf8"));
  await writeFile(path.join(runsRoot, "deep-1", "report.json"), JSON.stringify({ status: "stopped_by_operator", startedAt: "2026-10-09T12:01:00Z" }));
  const listed = (await call("/api/runs")).body.runs.find((row) => row.id === "deep-1");
  assert.equal(listed.callMode, "three-call", "a report from before the field existed was a three-call run");
  const before = spawned.length;
  const inherit = await call("/api/runs/start", { method: "POST", body: { resumeFrom: "deep-1", turns: 2, maxRequests: 10, model: "gemini-3.8-flash-medium", authorized: true } });
  assert.equal(inherit.status, 202);
  assert.equal(spawned[before].args[spawned[before].args.indexOf("--call-mode") + 1], "three-call", "continuing a deep run stays deep");
  spawned[before].child.emit("exit", 0, null);
  await call("/api/runs/start", { method: "POST", body: { resumeFrom: "deep-1", turns: 2, maxRequests: 10, model: "gemini-3.8-flash-medium", callMode: "performance", authorized: true } });
  assert.equal(spawned[before + 1].args[spawned[before + 1].args.indexOf("--call-mode") + 1], "performance", "the player can still choose another mode");
  spawned[before + 1].child.emit("exit", 0, null);
  await call("/api/runs/start", { method: "POST", body: { resumeFrom: "fresh-jiexing", turns: 2, maxRequests: 10, model: "gemini-3.8-flash-medium", authorized: true } });
  assert.equal(spawned[before + 2].args[spawned[before + 2].args.indexOf("--call-mode") + 1], "performance", "a save with no report starts in the default mode");
  spawned[before + 2].child.emit("exit", 0, null);

  // A failed run says why, in the runner's words.
  await mkdir(path.join(runsRoot, "failed-1"));
  await writeFile(path.join(runsRoot, "failed-1", "world-save.json"), await readFile(path.join(runsRoot, "fresh-jiexing", "world-save.json"), "utf8"));
  await writeFile(path.join(runsRoot, "failed-1", "report.json"), JSON.stringify({ status: "failed", callMode: "performance", startedAt: "2026-10-09T12:02:00Z",
    error: { code: "MODEL_REQUEST_TIMEOUT", message: "模型连续 3 次在 45 秒内没有回应。" } }));
  const failedRow = (await call("/api/runs")).body.runs.find((row) => row.id === "failed-1");
  assert.equal(failedRow.status, "failed");
  assert.equal(failedRow.error, "模型连续 3 次在 45 秒内没有回应。", "the run list says why it stopped");
  assert.equal((await call("/api/runs")).body.runs.find((row) => row.id === "fresh-jiexing").error, null, "a run that did not fail has no error");
} finally {
  server.close();
  await rm(runsRoot, { recursive: true, force: true });
}
console.log("Observer runs API passed: listing, save slots, feeds, path safety, explicit authorization, no cross-site starts, no key leakage, single active run and graceful stop.");
