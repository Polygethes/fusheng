// Contract tests for World Compiler (Task P2.3 - Topology & Planning)
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { planTown } from "../src/worlds/compiler/townPlanner.mjs";
import { compileTopology } from "../src/worlds/compiler/topology.mjs";
import { SITE_TYPES } from "../src/worlds/catalog/index.mjs";
import { validateBlueprint } from "../src/worlds/blueprint/validateBlueprint.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, "fixtures/blueprints/tiny_hamlet.json");
const tinyHamlet = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

// 1. Plan town
const plan = planTown(tinyHamlet, { catalog: SITE_TYPES, seed: 7 });
assert.ok(Array.isArray(plan.streets));
assert.ok(plan.streets.length > 0);
assert.ok(plan.frontOf.li_home, "li_home must have a frontOf street");
assert.ok(plan.frontOf.herb_shop, "herb_shop must have a frontOf street");

// 2. Compile topology
const topology = compileTopology(tinyHamlet, plan, SITE_TYPES);

// Assertions on tiny_hamlet topology:
// li_home rooms
assert.ok(topology.zones.some((z) => z.id === "li_home__hall"), "li_home__hall must exist");
assert.ok(topology.zones.some((z) => z.id === "li_home__bedroom_1"), "li_home__bedroom_1 must exist");
assert.ok(topology.zones.some((z) => z.id === "li_home__kitchen"), "li_home__kitchen must exist");

// herb_shop rooms: attachedHome has hall + bedroom
assert.ok(topology.zones.some((z) => z.id === "herb_shop__front"), "herb_shop__front must exist");
assert.ok(topology.zones.some((z) => z.id === "herb_shop__dispensary"), "herb_shop__dispensary must exist");
assert.ok(topology.zones.some((z) => z.id === "herb_shop__hall"), "herb_shop__hall must exist");
assert.ok(topology.zones.some((z) => z.id === "herb_shop__bedroom_1"), "herb_shop__bedroom_1 must exist");

// Exterior and defaultZoneId
assert.ok(topology.defaultZoneId, "Must have a defaultZoneId");
assert.ok(topology.zones.some((z) => z.id === topology.defaultZoneId), "defaultZoneId must exist in zones");

// Door edge from entry room to frontOf street:
// Exactly one edge, sound = 2, NO visual key
const liDoorEdge = topology.edges.find(
  (e) => (e.from === "li_home__hall" && e.to === plan.frontOf.li_home) ||
         (e.to === "li_home__hall" && e.from === plan.frontOf.li_home)
);
assert.ok(liDoorEdge, "Door edge for li_home must exist");
assert.equal(liDoorEdge.sound, 2);
assert.equal(liDoorEdge.visual, undefined, "Door edge must omit visual property");

// Reachability: From defaultZoneId, all zones must be reachable
const adjacency = new Map();
for (const z of topology.zones) adjacency.set(z.id, []);
for (const e of topology.edges) {
  if (adjacency.has(e.from) && adjacency.has(e.to)) {
    adjacency.get(e.from).push(e.to);
    adjacency.get(e.to).push(e.from);
  }
}

const visited = new Set();
const queue = [topology.defaultZoneId];
visited.add(topology.defaultZoneId);
while (queue.length > 0) {
  const cur = queue.shift();
  for (const nxt of adjacency.get(cur) || []) {
    if (!visited.has(nxt)) {
      visited.add(nxt);
      queue.push(nxt);
    }
  }
}

for (const z of topology.zones) {
  assert.ok(visited.has(z.id), `Zone ${z.id} must be reachable from defaultZoneId ${topology.defaultZoneId}`);
}

// Determinism: Same blueprint and seed produce byte-identical JSON
const top1 = compileTopology(tinyHamlet, planTown(tinyHamlet, { catalog: SITE_TYPES, seed: 7 }), SITE_TYPES);
const top2 = compileTopology(tinyHamlet, planTown(tinyHamlet, { catalog: SITE_TYPES, seed: 7 }), SITE_TYPES);
assert.equal(JSON.stringify(top1), JSON.stringify(top2));

// 3. Cast, Relationships, Objects, Work, Agenda, Social Rules (Task P2.4)
import { compileCast } from "../src/worlds/compiler/cast.mjs";
import { compileRelationships } from "../src/worlds/compiler/relationships.mjs";
import { compileObjects, compileWork } from "../src/worlds/compiler/objects.mjs";
import { compileAgenda, compileSocial, compileReport } from "../src/worlds/compiler/agenda.mjs";
import { validateEcologyProfile } from "../src/server/ecology/tavernEcologyProfile.mjs";

const worldId = tinyHamlet.meta.id;
const { cast, scenePositions, report: castReport, idMap } = compileCast(tinyHamlet, { worldId, topology });

// 4 characters in tiny_hamlet
assert.equal(Object.keys(cast).length, 4);

// Every resident has ecologyProfile and validates
for (const [cId, charData] of Object.entries(cast)) {
  assert.ok(charData.ecologyProfile, `${cId} must have ecologyProfile`);
  const validation = validateEcologyProfile(charData.ecologyProfile);
  assert.equal(validation.valid, true, `Ecology profile invalid for ${cId}: ${JSON.stringify(validation.errors)}`);
}

// Check Li Xiaohe desires: target should be resolved (not provisional)
const xiaoheChar = Object.values(cast).find((c) => c.name === "李小禾");
assert.ok(xiaoheChar);
assert.ok(xiaoheChar.ecologyProfile.desires.length > 0);
const medicineDesire = xiaoheChar.ecologyProfile.desires.find((d) => d.desiredState.object.includes("药"));
assert.ok(medicineDesire);
assert.ok(medicineDesire.target, "Medicine desire must have a target");
assert.ok(!castReport.provisional.some((p) => p.includes(xiaoheChar.id)), "Li Xiaohe desires should not be provisional");

// Relationships: 6 entries, all 15 metrics present (TAVERN_RELATIONSHIP_METRICS has 15 dimensions)
const relationships = compileRelationships(tinyHamlet, idMap);
assert.equal(relationships.length, 6);
for (const rel of relationships) {
  assert.equal(Object.keys(rel.metrics).length, 15);
}

// Objects and Work
const objects = compileObjects(tinyHamlet, topology, SITE_TYPES, worldId);
assert.ok(objects.length > 0);
const medicineObj = objects.find((o) => o.name === "腰伤药包");
assert.ok(medicineObj, "腰伤药包 must be instantiated in objects");

const workTemplates = compileWork(tinyHamlet, topology, SITE_TYPES, objects, worldId);
assert.ok(workTemplates.length > 0);

// Agenda / Deadlines: due at 13:00 from startClock 08:00 is 5 hours = 18000s
const agenda = compileAgenda(tinyHamlet, idMap, objects, topology, worldId);
assert.equal(agenda.length, 1);
assert.equal(agenda[0].due.atSeconds, 5 * 3600);
assert.equal(agenda[0].conditions[0].objectId, medicineObj.id);

// Social rules
const social = compileSocial(tinyHamlet, idMap, topology, SITE_TYPES, worldId);
assert.ok(social.facts.length >= 2);
const liBoundaries = social.boundaries.filter((b) => b.id.includes("li"));
assert.ok(liBoundaries.length > 0);
for (const b of liBoundaries) {
  assert.ok(b.exemptActorIds.includes(xiaoheChar.id));
}

// Report
const report = compileReport(agenda, castReport.provisional, objects);
assert.ok(Array.isArray(report.metrics));

// 4. Assemble and validate WorldPack (Task P2.5)
import { compileBlueprint } from "../src/worlds/compiler/index.mjs";
import { validateWorldPack } from "../src/worlds/validateWorldPack.mjs";
import { runWorldSmoke } from "../src/worlds/worldSmoke.mjs";
import { worldPackDigest } from "../src/worlds/worldPack.mjs";
import { saveUserWorld } from "../src/worlds/userWorldStore.mjs";
import { loadWorldPack } from "../src/worlds/registry.mjs";
import { createFreshWorldSave } from "../src/worlds/freshWorld.mjs";

const { pack: pack1, report: rep1 } = compileBlueprint(tinyHamlet, { seed: 1 });
const { pack: pack2 } = compileBlueprint(tinyHamlet, { seed: 1 });
assert.equal(worldPackDigest(pack1), worldPackDigest(pack2), "Compile must be deterministic");

// Different seed compiles and validates
const { pack: packDiffSeed } = compileBlueprint(tinyHamlet, { seed: 99 });
assert.ok(packDiffSeed);
const diffValidation = validateWorldPack(packDiffSeed);
assert.deepEqual(diffValidation.issues, [], `Different seed validation issues: ${JSON.stringify(diffValidation.issues)}`);

// validateWorldPack passes cleanly
const validation = validateWorldPack(pack1);
assert.deepEqual(validation.issues, [], `validateWorldPack had issues: ${JSON.stringify(validation.issues)}`);

// runWorldSmoke passes cleanly
const smoke = await runWorldSmoke(pack1);
assert.deepEqual(smoke.issues, [], `runWorldSmoke had issues: ${JSON.stringify(smoke.issues)}`);

// userWorldStore save & fresh save (isolated in tmp dir)
import os from "node:os";
import fsp from "node:fs/promises";
const tmpHome = await fsp.mkdtemp(path.join(os.tmpdir(), "gtown-compiler-test-"));
const testEnv = { CHARACTER_TOWN_HOME: tmpHome };
try {
  await saveUserWorld({ pack: pack1, blueprint: tinyHamlet, report: rep1 }, testEnv);
  const loaded = await loadWorldPack(tinyHamlet.meta.id, testEnv);
  assert.ok(loaded);
  assert.equal(loaded.meta.id, tinyHamlet.meta.id);
  const freshSave = await createFreshWorldSave(pack1);
  assert.ok(freshSave);
} finally {
  await fsp.rm(tmpHome, { recursive: true, force: true });
}

// 5. Scripted multi-turn performance contract (Task P2.5)
// Li Xiaohe walks from home to herb shop, talks with Wang Shen, picks up medicine, and observes it.
import { createWorldRuntimeV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { buildPlayableWorldFromPack } from "../src/worlds/buildPlayableWorldFromPack.mjs";

const playableHamlet = buildPlayableWorldFromPack(pack1);
const hamletRuntime = createWorldRuntimeV27(playableHamlet, {
  worldPack: pack1,
  pacingMode: "scene",
  runStage: async () => {
    throw new Error("multi-turn performance smoke never calls a model");
  },
});
const coord = hamletRuntime.coordinator;

{
// The scripted runtime uses pack1 (seed 1), so use that same exterior plan.
const plan = planTown(tinyHamlet, { catalog: SITE_TYPES, seed: 1 });

// Turn 1: Li Xiaohe moves from li_home__hall to the street outside her home
const turn1 = await coord.submitActionAttempt({
  attemptId: "scripted:hamlet:1",
  actorId: "char_tiny_hamlet_li_xiaohe",
  primitive: "move",
  expectedWorldVersion: coord.journal.worldVersion,
  payload: { destinationId: plan.frontOf.li_home },
});
assert.equal(turn1.status, "success", "Turn 1 move to street must succeed");
assert.equal(coord.worldState.entities["char_tiny_hamlet_li_xiaohe"].zoneId, plan.frontOf.li_home);

// Turn 2: Follow the topology from the front street to herb_shop__front.
function findPath(topology, from, to) {
  const previous = new Map([[from, null]]);
  const queue = [from];
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    if (current === to) break;
    for (const edge of topology.edges) {
      if (!(Number(edge.move) > 0 && Number.isFinite(Number(edge.move)))) continue;
      const next = edge.from === current ? edge.to : edge.to === current ? edge.from : null;
      if (next && !previous.has(next)) { previous.set(next, current); queue.push(next); }
    }
  }
  if (!previous.has(to)) return null;
  const path = [];
  for (let current = to; current !== from; current = previous.get(current)) path.unshift(current);
  return path;
}
const steps = findPath(pack1.stage.topology, plan.frontOf.li_home, "herb_shop__front");
assert.ok(steps && steps.length, "Turn 2 has a topology route to herb shop");
for (const [index, destinationId] of steps.entries()) {
  const turn2 = await coord.submitActionAttempt({
    attemptId: `scripted:hamlet:2:${index}`,
    actorId: "char_tiny_hamlet_li_xiaohe",
    primitive: "move",
    expectedWorldVersion: coord.journal.worldVersion,
    payload: { destinationId },
  });
  assert.equal(turn2.status, "success", "Turn 2 move to herb shop must succeed");
}
assert.equal(coord.worldState.entities["char_tiny_hamlet_li_xiaohe"].zoneId, "herb_shop__front");

// Turn 3: Li Xiaohe speaks to Wang Shen
const turn3 = await coord.submitActionAttempt({
  attemptId: "scripted:hamlet:3",
  actorId: "char_tiny_hamlet_li_xiaohe",
  primitive: "speak",
  expectedWorldVersion: coord.journal.worldVersion,
  payload: { utterance: "王婶，我爹的腰伤药配好了吗？", targetActorId: "char_tiny_hamlet_wang_shen" },
});
assert.equal(turn3.status, "success", "Turn 3 speech must succeed");

// Turn 4: Wang Shen replies to Li Xiaohe
const turn4 = await coord.submitActionAttempt({
  attemptId: "scripted:hamlet:4",
  actorId: "char_tiny_hamlet_wang_shen",
  primitive: "speak",
  expectedWorldVersion: coord.journal.worldVersion,
  payload: { utterance: "小禾来了，药包正放在柜台上呢。", targetActorId: "char_tiny_hamlet_li_xiaohe" },
});
assert.equal(turn4.status, "success", "Turn 4 response speech must succeed");

// Turn 5: Li Xiaohe picks up the medicine packet
const turn5 = await coord.submitActionAttempt({
  attemptId: "scripted:hamlet:5",
  actorId: "char_tiny_hamlet_li_xiaohe",
  primitive: "handle",
  expectedWorldVersion: coord.journal.worldVersion,
  payload: { objectId: "tiny_hamlet_obj_2", operation: "take" },
});
assert.equal(turn5.status, "success", "Turn 5 take object must succeed");
assert.equal(coord.worldState.objects["tiny_hamlet_obj_2"].holderCharacterId, "char_tiny_hamlet_li_xiaohe");

// Turn 6: Li Xiaohe inspects / observes the medicine packet
const turn6 = await coord.submitActionAttempt({
  attemptId: "scripted:hamlet:6",
  actorId: "char_tiny_hamlet_li_xiaohe",
  primitive: "observe",
  expectedWorldVersion: coord.journal.worldVersion,
  payload: { targetId: "tiny_hamlet_obj_2" },
});
assert.equal(turn6.status, "success", "Turn 6 observe must succeed");

}

// 6. Loop contracts across all three blueprints (Task P2.6)
const fixtures = [
  { file: "scripts/fixtures/blueprints/tiny_hamlet.json", id: "tiny_hamlet" },
  { file: "scripts/fixtures/blueprints/river_town.json", id: "river_town" },
  { file: "scripts/fixtures/blueprints/forest_village.json", id: "forest_village" },
];

for (const { file, id } of fixtures) {
  const bp = JSON.parse(fs.readFileSync(file, "utf8"));
  const bpVal = validateBlueprint(bp);
  assert.equal(bpVal.ok, true, `Blueprint ${id} validation must pass`);

  const { pack: pA, report: rA } = compileBlueprint(bp, { seed: 10 });
  const { pack: pB } = compileBlueprint(bp, { seed: 10 });
  assert.equal(worldPackDigest(pA), worldPackDigest(pB), `Deterministic compilation for ${id}`);

  const val = validateWorldPack(pA);
  assert.deepEqual(val.issues, [], `validateWorldPack for ${id} must be clean`);

  const smk = await runWorldSmoke(pA);
  assert.deepEqual(smk.issues, [], `runWorldSmoke for ${id} must be clean`);

  const tmpFixtureHome = await fsp.mkdtemp(path.join(os.tmpdir(), `gtown-fixture-${id}-`));
  const fixtureEnv = { CHARACTER_TOWN_HOME: tmpFixtureHome };
  try {
    await saveUserWorld({ pack: pA, blueprint: bp, report: rA }, fixtureEnv);
    const loadedFixture = await loadWorldPack(id, fixtureEnv);
    assert.ok(loadedFixture);
    assert.equal(loadedFixture.meta.id, id);
    const freshSaveFixture = await createFreshWorldSave(pA);
    assert.ok(freshSaveFixture);
  } finally {
    await fsp.rm(tmpFixtureHome, { recursive: true, force: true });
  }
}

console.log("Compiler assembly and validation contracts passed.");


