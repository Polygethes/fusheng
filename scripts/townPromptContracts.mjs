// Town prompts are layered (spec §9.4): rooms of this building, the zones
// next door and the places this person knows; only people and things here
// or next door; at most 20 destinations and 8000 characters for a 20-person
// town. Built-in worlds keep their prompt exactly.
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildPerformanceStage, lowerPerformanceOutput } from "../src/server/pipeline/characterPerformanceTurn.mjs";
import { compileBlueprint } from "../src/worlds/compiler/index.mjs";
import { buildPlayableWorldFromPack } from "../src/worlds/buildPlayableWorldFromPack.mjs";
import { createWorldRuntimeV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";

// 1. The stage builder on a small synthetic town.
const zoneEdges = [["home__hall", "street_1"], ["street_1", "street_2"], ["street_2", "street_3"], ["street_3", "shop__front"],
  ["home__hall", "home__bedroom_1"], ["home__bedroom_1", "home__kitchen"]];
const zoneLabels = { home__hall: "家·堂屋", home__bedroom_1: "家·卧房", home__kitchen: "家·灶间", street_1: "东街一段", street_2: "东街二段", street_3: "东街三段", shop__front: "铺子·铺面" };
const canonicalInput = {
  agentTurnId: "agent-turn:me:1",
  agent: { id: "me", name: "我" },
  scene: { zoneId: "home__hall", zoneLabel: "家·堂屋", elapsedSeconds: 0 },
  perceivedCharacters: [
    { entityHandle: "h1", zoneId: "home__hall", zoneLabel: "家·堂屋", observableDescription: "堂屋有一人" },
    { entityHandle: "h2", zoneId: "street_1", zoneLabel: "东街一段", observableDescription: "东街一段有一人" },
    { entityHandle: "h3", zoneId: "street_2", zoneLabel: "东街二段", observableDescription: "东街二段有一人" },
  ],
  perceivedObjects: [
    { objectHandle: "o1", label: "竹篮", zoneId: "home__hall" },
    { objectHandle: "o2", label: "石磨", zoneId: "street_2" },
  ],
  reachableZones: [],
  availableAffordances: [],
};
const sites = [{ id: "home", name: "家", entryZoneId: "home__hall" }, { id: "shop", name: "铺子", entryZoneId: "shop__front" }];
const town = buildPerformanceStage({ canonicalInput, zoneEdges, zoneLabels, sites, knownSiteIds: ["home", "shop"] });
assert.deepEqual(town.table.people.map((row) => row.handle), ["h1", "h2"], "only people here and next door");
assert.deepEqual(town.table.objects.map((row) => row.handle), ["o1"], "only things here and next door");
for (const id of ["home__bedroom_1", "home__kitchen", "street_1", "shop"]) assert.ok(town.table.keys.zones.includes(id), `town move list has ${id}`);
for (const id of ["street_2", "street_3", "shop__front", "home"]) assert.ok(!town.table.keys.zones.includes(id), `town move list leaves out ${id}`);
assert.match(town.stageInput.prompt.user, /shop=铺子（要走4段路）/u, "a known place shows its name and how far it is");
const walk = lowerPerformanceOutput({ thought: "", say: { to: "", text: "", loud: false }, do: { type: "move", target: "shop", person: "", minutes: 0 }, gesture: "" }, town.table);
assert.equal(walk.payload.destinationId, "street_1", "a far place is walked one hop at a time");

// A known place stays a valid target from the street outside it.
const outside = buildPerformanceStage({ canonicalInput: { ...canonicalInput, scene: { zoneId: "street_3", zoneLabel: "东街三段", elapsedSeconds: 0 } }, zoneEdges, zoneLabels, sites, knownSiteIds: ["home", "shop"] });
assert.ok(outside.table.keys.zones.includes("shop") && !outside.table.keys.zones.includes("shop__front"), "the shop is listed by its place key");

// 2. Without sites the builder behaves exactly as before.
const legacy = buildPerformanceStage({ canonicalInput, zoneEdges, zoneLabels });
const legacyExplicit = buildPerformanceStage({ canonicalInput, zoneEdges, zoneLabels, sites: [], knownSiteIds: [] });
assert.equal(JSON.stringify(legacyExplicit.stageInput), JSON.stringify(legacy.stageInput));
assert.deepEqual(legacy.table.people.map((row) => row.handle), ["h1", "h2", "h3"]);
for (const id of ["street_2", "street_3", "shop__front"]) assert.ok(legacy.table.keys.zones.includes(id), `legacy move list keeps ${id}`);

// 3. A 20-person town: every first beat fits.
const blueprint = JSON.parse(fs.readFileSync("scripts/fixtures/blueprints/big_town.json", "utf8"));
const { pack } = compileBlueprint(blueprint, { seed: 1 });
assert.equal(pack.cast.length, 20);
assert.ok(Array.isArray(pack.stage.sites) && pack.stage.sites.length === blueprint.town.sites.length, "the pack lists every site");
for (const member of pack.cast) assert.ok(member.knownSiteIds.length >= 2 && member.knownSiteIds.length <= 20, `${member.id} knows 2–20 places`);
const inputs = [];
const instance = createWorldRuntimeV27(buildPlayableWorldFromPack(pack), {
  worldPack: pack, pacingMode: "scene", characterIds: pack.stage.sceneCast, enableDayPlanning: false, characterAgentCallMode: "performance",
  async runStage(input) {
    inputs.push(input);
    return { performance: { thought: "先看看", say: { to: "", text: "", loud: false }, do: { type: "wait", target: "", person: "", minutes: 10 }, gesture: "" } };
  },
});
for (const id of pack.stage.sceneCast) {
  await instance.runtime.enqueueWake(id, { wakeId: `wake:prompt:${id}`, kind: "continuation_due", evidenceIds: [], evidence: [] });
}
for (let i = 0; i < pack.stage.sceneCast.length * 2 && inputs.length < pack.stage.sceneCast.length; i += 1) {
  if (!(await instance.runtime.runNext())) break;
}
assert.equal(new Set(inputs.map((row) => row.characterId)).size, 20, "every resident took a beat");
for (const input of inputs) {
  const length = input.prompt.system.length + input.prompt.user.length;
  assert.ok(length <= 8000, `${input.characterId}: prompt is ${length} characters`);
  const moveLine = input.prompt.user.split("\n").find((line) => line.startsWith("- move："));
  const destinations = moveLine ? moveLine.replace(/^- move：[^。]*。/u, "").split("，").filter(Boolean) : [];
  assert.ok(destinations.length <= 20, `${input.characterId}: ${destinations.length} destinations`);
  assert.doesNotMatch(input.prompt.user, /要经过/u, `${input.characterId}: no street-by-street directions`);
}
for (const actor of instance.runtime.actors.values()) await actor.close?.();

console.log("Town prompt passed: layered destinations and nearby people, ≤20 places and ≤8000 characters in a 20-person town; built-in prompts unchanged.");
