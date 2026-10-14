// The 20-resident town used to accept P4: a real town that compiles, passes
// every world check on several seeds, and reaches its deadlines in the smoke.
import assert from "node:assert/strict";
import fs from "node:fs";
import { validateBlueprint } from "../src/worlds/blueprint/validateBlueprint.mjs";
import { compileBlueprint } from "../src/worlds/compiler/index.mjs";
import { validateWorldPack } from "../src/worlds/validateWorldPack.mjs";
import { runWorldSmoke } from "../src/worlds/worldSmoke.mjs";
import { SITE_TYPES } from "../src/worlds/catalog/siteTypes.mjs";

const blueprint = JSON.parse(fs.readFileSync("scripts/fixtures/blueprints/big_town.json", "utf8"));
const checked = validateBlueprint(blueprint);
assert.deepEqual(checked.issues, [], "big_town is a valid blueprint");

assert.equal(blueprint.residents.length, 20, "20 residents");
assert.equal(blueprint.households.length, 6, "6 households");
const buildings = blueprint.town.sites.filter((site) => SITE_TYPES[site.type].kind === "building");
assert.ok(buildings.length >= 10 && buildings.length <= 12, "10–12 buildings (the 96×64 map tier)");
for (const type of ["square", "well", "market", "forest", "field", "river_bank", "bridge", "road_out"]) {
  assert.ok(blueprint.town.sites.some((site) => site.type === type), `has a ${type}`);
}
const memberCount = new Map();
for (const resident of blueprint.residents) memberCount.set(resident.householdId, (memberCount.get(resident.householdId) || 0) + 1);
for (const household of blueprint.households) {
  const count = memberCount.get(household.id) || 0;
  assert.ok(count >= 2 && count <= 5, `${household.id} has 2–5 people (${count})`);
}
for (const resident of blueprint.residents) {
  const sites = new Set((resident.routine || []).map((row) => row.siteId));
  assert.ok((resident.routine || []).length >= 3, `${resident.id} has at least three routine blocks`);
  assert.ok(sites.size >= 2, `${resident.id}'s routine uses at least two places`);
  assert.ok(blueprint.relationships.some((row) => row.from === resident.id || row.to === resident.id), `${resident.id} has a relationship`);
}
assert.ok(blueprint.residents.some((row) => row.appearance?.child === true), "at least one child");
assert.ok(blueprint.opening.deadlines.length >= 2, "at least two deadlines");
assert.ok(blueprint.opening.deadlines.some((row) => new Set(row.responsible).size >= 2), "a deadline that needs two or more people");

for (const seed of [1, 7, 42]) {
  const { pack } = compileBlueprint(blueprint, { seed });
  assert.equal(pack.cast.length, 20);
  assert.deepEqual(validateWorldPack(pack).issues, [], `big_town#${seed}: V1–V13 clean`);
  const smoke = await runWorldSmoke(pack, { stages: false });
  assert.deepEqual(smoke.issues, [], `big_town#${seed}: smoke clean`);
  assert.deepEqual(pack.meta.provisional, [], `big_town#${seed}: every desire is grounded`);
}

console.log("Big town fixture passed: 20 residents in 6 households, 10–12 buildings, clean on seeds 1/7/42.");
