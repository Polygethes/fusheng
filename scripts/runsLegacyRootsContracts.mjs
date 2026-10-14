// Runs live in the player's data home (P7); the project's old sim-runs/ is
// still listed, replayed and continued from, but never written to. A
// continuation is a new run in the data home, and the save slot follows the
// chain across both folders.
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, writeFile, readFile, readdir, stat, rm } from "node:fs/promises";
import jiexing from "../src/worlds/jiexing/pack.mjs";
import { createFreshWorldSave } from "../src/worlds/freshWorld.mjs";
import { createRunsApi } from "../src/server/observer/runsApi.mjs";

const base = await mkdtemp(path.join(os.tmpdir(), "runs-roots-"));
const runsRoot = path.join(base, "home", "runs");
const legacy = path.join(base, "project", "sim-runs");
await mkdir(path.join(legacy, "old-jiexing"), { recursive: true });
const oldSave = JSON.stringify((await createFreshWorldSave(jiexing, { runId: "old-jiexing" })).save);
await writeFile(path.join(legacy, "old-jiexing", "world-save.json"), oldSave);
const snapshot = async () => {
  const rows = [];
  for (const dir of await readdir(legacy)) for (const file of await readdir(path.join(legacy, dir))) {
    const info = await stat(path.join(legacy, dir, file));
    rows.push([dir, file, info.size, info.mtimeMs]);
  }
  return JSON.stringify(rows);
};
const before = await snapshot();

const spawned = [];
function fakeSpawn({ args }) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  spawned.push({ args, child });
  return child;
}
const api = createRunsApi({ runsRoot, legacyRunsRoots: [legacy], projectRoot: process.cwd(), env: { GEMINI_API_KEY: "k-0123456789" },
  spawnRunner: fakeSpawn, clock: () => new Date("2026-10-11T08:00:00Z") });
const server = http.createServer((req, res) => {
  api.handle(req, res, new URL(req.url, "http://localhost")).then((handled) => { if (!handled) { res.writeHead(404); res.end(); } });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const call = async (pathname, { method = "GET", body } = {}) => {
  const response = await fetch(origin + pathname, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json().catch(() => null) };
};
const argAfter = (args, flag) => args[args.indexOf(flag) + 1];

try {
  // The data home has no runs folder yet; the old run is listed and replays.
  assert.deepEqual((await call("/api/runs")).body.runs.map((row) => row.id), ["old-jiexing"]);
  assert.equal((await call("/api/runs/old-jiexing/feed")).status, 200);
  assert.equal((await call("/api/runs/..%2F..%2Fetc/feed")).status, 404, "paths still cannot escape");

  // A new run is written in the data home.
  const request = { world: "jiexing", turns: 5, maxRequests: 20, model: "gemini-3.8-flash", authorized: true };
  const fresh = await call("/api/runs/start", { method: "POST", body: request });
  assert.equal(fresh.status, 202);
  assert.equal(path.dirname(argAfter(spawned[0].args, "--out")), runsRoot);
  spawned[0].child.emit("exit", 0, null);

  // Continuing the old run reads its save and writes a new run in the data home.
  const resumed = await call("/api/runs/start", { method: "POST", body: { ...request, resumeFrom: "old-jiexing" } });
  assert.equal(resumed.status, 202);
  assert.equal(argAfter(spawned[1].args, "--resume"), path.join(legacy, "old-jiexing", "world-save.json"));
  const out = argAfter(spawned[1].args, "--out");
  assert.equal(path.dirname(out), runsRoot);
  // What the runner would leave behind.
  await mkdir(out);
  await writeFile(path.join(out, "world-save.json"), oldSave);
  await writeFile(path.join(out, "report.json"), JSON.stringify({ status: "turn_limit_reached", source: path.join(legacy, "old-jiexing", "world-save.json"), startedAt: "2026-10-11T08:00:00Z" }));
  spawned[1].child.emit("exit", 0, null);

  // One save slot follows the chain from the old folder into the data home.
  const saves = (await call("/api/saves")).body.saves;
  assert.equal(saves.length, 1);
  assert.deepEqual(saves[0].segments, ["old-jiexing", path.basename(out)]);
  assert.equal((await call(`/api/runs/${path.basename(out)}/feed`)).status, 200);

  // The old folder was never written.
  assert.equal(await snapshot(), before);
  assert.equal(await readFile(path.join(legacy, "old-jiexing", "world-save.json"), "utf8"), oldSave);
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(base, { recursive: true, force: true });
}

console.log("Runs roots passed: new runs in the data home, old sim-runs listed, replayed and continued but never written, save slots across both.");
