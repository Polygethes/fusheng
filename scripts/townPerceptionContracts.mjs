// Perception carries only as far as the place allows. A compiled town sets
// maxVisualDistance / maxSoundDistance; built-in worlds set neither and keep
// every route they had.
import assert from "node:assert/strict";
import fs from "node:fs";
import { compileBlueprint } from "../src/worlds/compiler/index.mjs";
import { buildPlayableWorldFromPack } from "../src/worlds/buildPlayableWorldFromPack.mjs";
import { createWorldRuntimeV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { perceivableRoute, perceptionDistanceLimit, routeDistance } from "../src/server/simulation/worldActionRegistry.mjs";
import jiexing from "../src/worlds/jiexing/pack.mjs";
import xiaoyaoyou from "../src/worlds/xiaoyaoyou/pack.mjs";

const runtimeFor = (pack) => createWorldRuntimeV27(buildPlayableWorldFromPack(pack), {
  worldPack: pack, pacingMode: "scene", runStage: async () => { throw new Error("no model"); },
});
const closeAll = async (instance) => { for (const actor of instance.runtime.actors.values()) await actor.close?.(); };

// 1. Built-in worlds have no limit and every route is unchanged.
for (const pack of [jiexing, xiaoyaoyou]) {
  const instance = runtimeFor(pack);
  const place = Object.values(instance.coordinator.worldState.places)[0];
  const zones = Object.keys(place.topology.zones);
  for (const modality of ["visual", "sound"]) {
    assert.equal(perceptionDistanceLimit(place, modality), null, `${pack.meta.id}: no ${modality} limit`);
    for (const a of zones) for (const b of zones) {
      assert.equal(perceivableRoute(place, a, b, modality), routeDistance(place.topology, a, b, modality), `${pack.meta.id}: ${a}→${b} ${modality} unchanged`);
    }
  }
  await closeAll(instance);
}

// 2. A compiled town limits sight to 2.5 and sound to 3.
const blueprint = JSON.parse(fs.readFileSync("scripts/fixtures/blueprints/river_town.json", "utf8"));
const { pack } = compileBlueprint(blueprint, { seed: 1 });
assert.equal(pack.stage.perceptionEnvironment.maxVisualDistance, 2.5);
assert.equal(pack.stage.perceptionEnvironment.maxSoundDistance, 3);
const instance = runtimeFor(pack);
const coord = instance.coordinator;
const place = Object.values(coord.worldState.places)[0];
const byLabel = (text) => Object.keys(place.topology.zones).find((id) => place.topology.zones[id].label === text);
const [west3, west1, east1, east2] = ["西街三段", "西街一段", "东街一段", "东街二段"].map(byLabel);
assert.ok(west3 && west1 && east1 && east2, "river_town#1 has these four street segments");
assert.equal(perceptionDistanceLimit(place, "visual"), 2.5);
assert.equal(perceptionDistanceLimit(place, "sound"), 3);
assert.equal(perceivableRoute(place, west1, east1, "visual"), 2, "two segments away is in sight");
assert.equal(perceivableRoute(place, west3, east2, "visual"), null, "five segments away is out of sight");
assert.equal(perceivableRoute(place, west1, east1, "sound"), 3, "two segments away is within earshot");
assert.equal(perceivableRoute(place, west3, east2, "sound"), null, "five segments away is out of earshot");

// 3. The running world: a far-west person does not see a move at the east end;
//    a person on the next segment does.
function path(from, to) {
  const previous = new Map([[from, null]]);
  const queue = [from];
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    if (current === to) break;
    for (const edge of place.topology.edges) {
      if (!(Number(edge.move) > 0)) continue;
      const next = edge.from === current ? edge.to : edge.to === current ? edge.from : null;
      if (next && !previous.has(next)) { previous.set(next, current); queue.push(next); }
    }
  }
  const steps = [];
  for (let current = to; current !== from; current = previous.get(current)) steps.unshift(current);
  return steps;
}
let sequence = 0;
async function act(actorId, primitive, payload) {
  return coord.submitActionAttempt({ attemptId: `perception:${++sequence}`, actorId, primitive, expectedWorldVersion: coord.journal.worldVersion, payload });
}
async function walk(actorId, to) {
  let last = null;
  for (const step of path(coord.worldState.entities[actorId].zoneId, to)) {
    last = await act(actorId, "move", { destinationId: step });
    assert.equal(last.status, "success", `${actorId} walks into ${step}`);
  }
  return last;
}
const A = "char_river_town_song_ling", B = "char_river_town_chen_ahao", C = "char_river_town_zhou_xiaomei";
await walk(B, west3);
await walk(C, east1);
await walk(A, east1);
const finalMove = await walk(A, east2);
const recipients = new Set(finalMove.deliveries.map((row) => row.recipientCharacterId));
assert.ok(recipients.has(C), "the person on 东街一段 sees A walk on");
assert.ok(!recipients.has(B), "the person on 西街三段 does not");

const lookAround = await act(A, "observe", { targetId: "" });
const seen = lookAround.deliveries.find((row) => row.recipientCharacterId === A)?.content || "";
assert.match(seen, /东街一段有一人/u, "A sees the person one segment back");
assert.doesNotMatch(seen, /西街三段/u, "A does not see the far west street");
const lookAtB = await act(A, "observe", { targetId: B });
assert.ok(lookAtB.failedEffects.some((row) => row.code === "OBSERVE_TARGET_NOT_VISIBLE"), "B is out of sight");
const lookAtC = await act(A, "observe", { targetId: C });
assert.equal(lookAtC.status, "success", "C is in sight");
await closeAll(instance);

console.log("Town perception passed: built-in worlds unchanged; a compiled town sees 2.5 and hears 3 route units.");
