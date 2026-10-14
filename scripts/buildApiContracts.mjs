// From a reviewed blueprint to a playable world (P6): compile reports every
// problem with the review tab it belongs to and a map preview, without calling
// a model; start saves the world in the library and creates its opening save;
// a name already in the library or reserved by a built-in world is refused.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { createBuildApi, checkBlueprint, sectionOf } from "../src/server/observer/buildApi.mjs";
import { listWorldPackIds, loadWorldPack } from "../src/worlds/registry.mjs";

const home = await mkdtemp(path.join(os.tmpdir(), "ct-build-home-"));
const runsRoot = await mkdtemp(path.join(os.tmpdir(), "ct-build-runs-"));
const env = { ...process.env, CHARACTER_TOWN_HOME: home };
const hamlet = JSON.parse(fs.readFileSync("scripts/fixtures/blueprints/tiny_hamlet.json", "utf8"));

// Problems are tagged with the review tab that can fix them.
assert.equal(sectionOf("residents[2].desires[0].object"), "people");
assert.equal(sectionOf("town.sites[1].type"), "places");
assert.equal(sectionOf("opening.deadlines[0]"), "opening");
assert.equal(sectionOf("relationships[3].from"), "relationships");
assert.equal(sectionOf("meta.title"), "world");

const api = createBuildApi({ runsRoot, env, clock: () => new Date("2026-10-11T08:00:00Z"), titleBlueprintPath: "scripts/fixtures/blueprints/big_town.json" });
const server = http.createServer((req, res) => api.handle(req, res, new URL(req.url, "http://localhost")).then((handled) => { if (!handled) { res.writeHead(404); res.end(); } }));
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const post = async (pathname, body, headers = {}) => {
  const response = await fetch(base + pathname, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
};

try {
  // Compile: a clean town with a preview.
  const ok = await post("/api/create/compile", { blueprint: hamlet, seed: 7 });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.ok, true, JSON.stringify(ok.body.issues));
  assert.equal(ok.body.stage, "ready");
  assert.equal(ok.body.seed, 7);
  assert.equal(ok.body.preview.layout.layoutVersion, 2);
  assert.ok(ok.body.preview.layout.maps.exterior && ok.body.preview.cast.length === hamlet.residents.length);
  assert.ok(ok.body.preview.sites.length === hamlet.town.sites.length);
  assert.equal(ok.body.pack, undefined, "the whole pack is not sent to the page");
  const reroll = await post("/api/create/compile", { blueprint: hamlet, seed: 42 });
  assert.notEqual(JSON.stringify(reroll.body.preview.layout.maps.exterior), JSON.stringify(ok.body.preview.layout.maps.exterior), "another seed, another map");

  // Compile: blueprint problems come back with their tab, nothing thrown.
  const broken = structuredClone(hamlet);
  broken.residents[0].routine[0].siteId = "nowhere";
  broken.town.sites[0].type = "castle";
  const bad = await post("/api/create/compile", { blueprint: broken });
  assert.equal(bad.status, 200);
  assert.equal(bad.body.ok, false);
  assert.equal(bad.body.stage, "blueprint");
  assert.ok(bad.body.issues.some((row) => row.section === "places" && row.path.startsWith("town.sites")));
  assert.ok(bad.body.issues.every((row) => row.message && row.section));

  // Refusals.
  const plain = await fetch(`${base}/api/create/compile`, { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" });
  assert.equal(plain.status, 415);
  assert.equal((await post("/api/create/compile", { blueprint: hamlet }, { origin: "https://evil.example" })).status, 403);
  assert.equal((await post("/api/create/compile", {})).body.code, "BLUEPRINT_REQUIRED");

  // Start: saves the world and its opening save.
  const started = await post("/api/create/start", { blueprint: hamlet, seed: 7 });
  assert.equal(started.status, 201, JSON.stringify(started.body));
  assert.equal(started.body.worldId, hamlet.meta.id);
  assert.match(started.body.observerUrl, /^\/stage\.html\?run=/u);
  assert.ok(listWorldPackIds(env).includes(hamlet.meta.id), "the world is in the library");
  const loaded = await loadWorldPack(hamlet.meta.id, env);
  assert.equal(loaded.meta.id, hamlet.meta.id);
  const stored = JSON.parse(await readFile(path.join(home, "worlds", hamlet.meta.id, "blueprint.json"), "utf8"));
  assert.equal(stored.meta.seed, 7, "the library keeps the seed that drew this map");
  const save = JSON.parse(await readFile(path.join(runsRoot, started.body.runId, "world-save.json"), "utf8"));
  assert.equal(save.worldPackId, hamlet.meta.id);
  assert.equal(save.checkpoint.actors.length, hamlet.residents.length);

  // Start: an existing world is not overwritten without asking; a broken one is not started.
  const again = await post("/api/create/start", { blueprint: hamlet, seed: 7 });
  assert.equal(again.status, 409);
  assert.equal(again.body.code, "WORLD_EXISTS");
  const replaced = await post("/api/create/start", { blueprint: hamlet, seed: 7, replace: true });
  assert.equal(replaced.status, 201);
  assert.notEqual(replaced.body.runId, started.body.runId, "a replaced world gets a new opening save");
  const notReady = await post("/api/create/start", { blueprint: broken });
  assert.equal(notReady.status, 422);
  assert.equal(notReady.body.code, "WORLD_NOT_READY");
  const reserved = structuredClone(hamlet);
  reserved.meta.id = "jiexing";
  assert.equal((await post("/api/create/start", { blueprint: reserved })).body.code, "WORLD_ID_RESERVED");

  // A new opening save for a world already in the library, or a built-in one.
  const fromLibrary = await post("/api/create/new-save", { worldId: hamlet.meta.id });
  assert.equal(fromLibrary.status, 201);
  assert.ok(fs.existsSync(path.join(runsRoot, fromLibrary.body.runId, "world-save.json")));
  assert.equal((await post("/api/create/new-save", { worldId: "jiexing" })).status, 201);
  assert.equal((await post("/api/create/new-save", { worldId: "nowhere" })).status, 404);

  // The title screen's town.
  const titleMap = await (await fetch(`${base}/api/create/title-map`)).json();
  assert.equal(titleMap.ok, true);
  assert.equal(titleMap.layout.layoutVersion, 2);
  assert.ok(titleMap.layout.maps.exterior.roofs.length >= 10);

  // The helper never throws for a bad blueprint.
  assert.equal((await checkBlueprint({})).ok, false);
} finally {
  server.close();
  await rm(home, { recursive: true, force: true });
  await rm(runsRoot, { recursive: true, force: true });
}

console.log("Build API passed: compile with tagged problems and a preview, start into the library and an opening save, no silent overwrite.");
