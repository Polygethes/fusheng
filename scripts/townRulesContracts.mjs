// Town-scale rules (spec §9.1, §9.6): V10 habits lead somewhere reachable,
// V11 every tool a job needs can be picked up, V12 perception has a range,
// and a town world is only ever run in the one-call performance mode.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { compileBlueprint } from "../src/worlds/compiler/index.mjs";
import { validateWorldPack } from "../src/worlds/validateWorldPack.mjs";
import { resolveCallMode } from "../src/worlds/callMode.mjs";
import { saveUserWorld } from "../src/worlds/userWorldStore.mjs";
import { createRunsApi } from "../src/server/observer/runsApi.mjs";
import jiexing from "../src/worlds/jiexing/pack.mjs";
import xiaoyaoyou from "../src/worlds/xiaoyaoyou/pack.mjs";

const codes = (pack) => validateWorldPack(pack).issues.map((row) => row.code);
const plain = (pack) => JSON.parse(JSON.stringify(pack));
const siteOf = (zoneId) => String(zoneId || "").split("__")[0];

// Built-in worlds are not towns: none of the town rules apply.
for (const pack of [jiexing, xiaoyaoyou]) assert.deepEqual(validateWorldPack(pack).issues, [], `${pack.meta.id} stays clean`);

let riverTown = null;
for (const name of ["tiny_hamlet", "river_town", "forest_village"]) {
  const { pack } = compileBlueprint(JSON.parse(fs.readFileSync(`scripts/fixtures/blueprints/${name}.json`, "utf8")), { seed: 1 });
  if (name === "river_town") riverTown = pack;
  assert.equal(pack.meta.scale, "town");
  assert.deepEqual(validateWorldPack(pack).issues, [], `${name}: V1–V13 clean`);
  const zoneIds = Object.keys(pack.stage.topology.zones);
  const sites = [...new Set(zoneIds.filter((id) => id.includes("__")).map(siteOf))];

  // V10: a habit at a place that does not exist.
  { const bad = plain(pack);
    bad.cast[0].routineHabits = [{ from: "08:00", to: "09:00", activity: "去一个没有的地方", siteId: "no_such_site" }];
    assert.ok(codes(bad).includes("TOWN_ROUTINE_SITE_UNKNOWN"), `${name}: unknown habit site`); }

  // V10: a habit at a place cut off from the resident's starting place.
  { const bad = plain(pack);
    const member = bad.cast[0];
    const start = bad.stage.scenePositions[member.id];
    const other = sites.find((site) => site !== siteOf(start));
    member.routineHabits = [{ from: "08:00", to: "09:00", activity: "去隔壁", siteId: other }];
    bad.stage.topology.edges = bad.stage.topology.edges.filter((edge) => (siteOf(edge.from) === other) === (siteOf(edge.to) === other));
    assert.ok(codes(bad).includes("TOWN_ROUTINE_SITE_UNREACHABLE"), `${name}: unreachable habit site`); }

  // V11: a tool lying in another building, then the same tool in someone's hands.
  { const bad = plain(pack);
    const tool = bad.objects.find((row) => !row.initialHolderActorId && row.zoneId);
    const work = bad.work.find((row) => siteOf(row.zoneId) !== siteOf(tool.zoneId));
    work.toolIds = [tool.id];
    assert.ok(codes(bad).includes("TOWN_WORK_TOOL_UNREACHABLE"), `${name}: tool in another building`);
    tool.initialHolderActorId = bad.cast[0].id;
    assert.ok(!codes(bad).includes("TOWN_WORK_TOOL_UNREACHABLE"), `${name}: a tool someone holds can be handed over`);
    work.toolIds = ["no_such_tool"];
    assert.ok(codes(bad).includes("TOWN_WORK_TOOL_UNKNOWN"), `${name}: unknown tool`); }

  // V12: both ranges are required.
  for (const key of ["maxVisualDistance", "maxSoundDistance"]) {
    const bad = plain(pack);
    delete bad.stage.perceptionEnvironment[key];
    assert.ok(codes(bad).includes("TOWN_PERCEPTION_RANGE_MISSING"), `${name}: ${key} missing`);
  }
}

// Call mode: towns run in performance mode only.
assert.equal(resolveCallMode({ scale: "town", requested: "", fallback: "three-call" }), "performance");
assert.equal(resolveCallMode({ scale: "town", requested: "performance", fallback: "three-call" }), "performance");
assert.throws(() => resolveCallMode({ scale: "town", requested: "three-call", fallback: "performance" }), (error) => error.code === "CALL_MODE_UNSUPPORTED" && /演绎模式/u.test(error.message));
assert.equal(resolveCallMode({ scale: undefined, requested: "", fallback: "three-call" }), "three-call");
assert.equal(resolveCallMode({ scale: undefined, requested: "three-call", fallback: "performance" }), "three-call");
assert.equal(resolveCallMode({ scale: undefined, requested: "", fallback: "performance" }), "performance");
assert.throws(() => resolveCallMode({ scale: undefined, requested: "two-call", fallback: "performance" }), (error) => error.code === "CALL_MODE_INVALID");

// The observer's start endpoint refuses three-call for a town before anything is spawned.
const home = await mkdtemp(path.join(os.tmpdir(), "ct-town-rules-"));
const runsRoot = await mkdtemp(path.join(os.tmpdir(), "ct-town-runs-"));
const previousHome = process.env.CHARACTER_TOWN_HOME;
process.env.CHARACTER_TOWN_HOME = home;
const spawned = [];
const fakeSpawn = ({ args }) => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
  spawned.push(args);
  return child;
};
const server = http.createServer();
try {
  await saveUserWorld({ pack: riverTown });
  const api = createRunsApi({ runsRoot, projectRoot: process.cwd(), env: { GEMINI_API_KEY: "probe-key-not-real", GEMINI_API_BASE_URL: "https://gateway.invalid/v1" }, spawnRunner: fakeSpawn });
  server.on("request", (req, res) => api.handle(req, res, new URL(req.url, "http://localhost")));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const post = async (body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/runs/start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const base = { authorized: true, turns: 5, maxRequests: 10, model: "gemini-3.8-flash" };
  const refused = await post({ ...base, world: "river_town", callMode: "three-call" });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.code, "CALL_MODE_UNSUPPORTED");
  assert.match(refused.body.message, /演绎模式/u);
  assert.equal(spawned.length, 0, "nothing was started");
  const started = await post({ ...base, world: "river_town" });
  assert.equal(started.status, 202);
  assert.equal(spawned[0][spawned[0].indexOf("--call-mode") + 1], "performance");
} finally {
  server.close();
  if (previousHome === undefined) delete process.env.CHARACTER_TOWN_HOME; else process.env.CHARACTER_TOWN_HOME = previousHome;
  await rm(home, { recursive: true, force: true });
  await rm(runsRoot, { recursive: true, force: true });
}

console.log("Town rules passed: V10 habits reachable, V11 tools obtainable, V12 ranges set, towns run in performance mode only.");
