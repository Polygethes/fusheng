// The creation pages' pure helpers (P6): every genre starts from catalog
// places, edits never leave a dangling reference, a place in use cannot be
// deleted, sliders round-trip the 0–1 personality, and the cost estimate
// follows spec §12.
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  GENRES, blankBlueprint, addSite, removeSite, siteReferences, addHousehold, removeHousehold, addResident, removeResident,
  updateResident, setRelationship, removeRelationship, PERSONALITY_SLIDERS, sliderValue, setSlider, estimateDraftCalls, estimateRun, uniqueId,
} from "../src/play/blueprintModel.js";
import { validateBlueprint } from "../src/worlds/blueprint/validateBlueprint.mjs";
import { SITE_TYPES } from "../src/worlds/catalog/index.mjs";

// Genres start from real catalog places.
for (const name of Object.keys(GENRES)) {
  const bp = blankBlueprint(name);
  assert.equal(bp.blueprintVersion, 1);
  assert.ok(bp.town.sites.every((row) => SITE_TYPES[row.type]), `${name}: catalog places only`);
  assert.equal(new Set(bp.town.sites.map((row) => row.id)).size, bp.town.sites.length, `${name}: unique ids`);
}
assert.equal(uniqueId("home", ["home_1", "home_3"]), "home_2");

// Building a small town by hand gives a blueprint the checker can read.
let bp = blankBlueprint("古风");
const homeId = bp.town.sites.find((row) => row.type === "home").id;
({ blueprint: bp } = addHousehold(bp, { name: "张家", siteId: homeId }));
const householdId = bp.households[0].id;
let a, b;
({ blueprint: bp, id: a } = addResident(bp, householdId));
({ blueprint: bp, id: b } = addResident(bp, householdId));
assert.notEqual(a, b);
assert.equal(bp.residents[0].workSiteId, homeId, "a new resident works at home until told otherwise");
assert.deepEqual(Object.keys(bp.residents[0].personality).sort(), PERSONALITY_SLIDERS.map((row) => row.key).sort());
bp = updateResident(bp, a, { name: "张大", id: "hijack" });
assert.equal(bp.residents[0].id, a, "an edit cannot change who someone is");
assert.equal(bp.residents[0].name, "张大");
bp = setRelationship(bp, a, b, { label: "父子", feelings: { love: 70 } });
bp = setRelationship(bp, a, b, { address: ["儿子"] });
assert.equal(bp.relationships.length, 1, "setting again updates, not duplicates");
assert.deepEqual(bp.relationships[0].address, ["儿子"]);
assert.throws(() => setRelationship(bp, a, a, {}), (error) => error.code === "RELATIONSHIP_SELF");
assert.equal(removeRelationship(bp, a, b).relationships.length, 0);
assert.ok(Array.isArray(validateBlueprint(bp).issues), "the checker reads a hand-built draft");

// A place in use cannot be deleted; the page is told what uses it.
const blocked = removeSite(bp, homeId);
assert.equal(blocked.ok, false);
assert.ok(blocked.references.includes("households[0].siteId"));
assert.deepEqual(siteReferences(bp, homeId), blocked.references);
const spare = bp.town.sites.find((row) => row.type === "well").id;
assert.equal(removeSite(bp, spare).ok, true);
assert.ok(!removeSite(bp, spare).blueprint.town.sites.some((row) => row.id === spare));
assert.equal(removeHousehold(bp, householdId).ok, false, "a household with people stays");
const added = addSite(bp, "mill", "");
assert.equal(added.blueprint.town.sites.at(-1).name, "磨坊");
assert.throws(() => addSite(bp, "castle"), (error) => error.code === "SITE_TYPE_UNKNOWN");

// Removing someone removes every reference to them.
const hamlet = JSON.parse(fs.readFileSync("scripts/fixtures/blueprints/tiny_hamlet.json", "utf8"));
assert.deepEqual(validateBlueprint(hamlet).issues, []);
for (const resident of hamlet.residents) {
  const after = removeResident(hamlet, resident.id);
  const text = JSON.stringify({ relationships: after.relationships, opening: after.opening });
  assert.ok(!text.includes(`"${resident.id}"`), `${resident.id}: no reference left`);
  assert.ok(!validateBlueprint(after).issues.some((row) => /UNKNOWN/u.test(row.code) && row.path.startsWith("opening")), `${resident.id}: the opening points at no one missing`);
}

// Sliders.
assert.equal(sliderValue({ care: 0.83 }, "care"), 83);
assert.equal(sliderValue({}, "care"), 50);
assert.deepEqual(setSlider({ care: 0.5 }, "care", 140), { care: 1 });
assert.equal(setSlider({}, "caution", 37).caution, 0.37);

// Cost estimate (spec §12).
assert.equal(estimateDraftCalls(12), 9);
assert.equal(estimateDraftCalls(20), 11);
const run = estimateRun({ residents: 20, gameHours: 8 });
assert.equal(run.schedules, 20);
assert.equal(run.beats, 80);
assert.equal(run.calls, 100);
assert.match(run.text, /^约 100 次调用、约 \d+ 万 token$/u);
assert.equal(estimateRun({ residents: 10, gameHours: 30 }).schedules, 20, "a second day means a second schedule each");

console.log("Blueprint model passed: genre starts, consistent edits, guarded deletes, sliders, cost estimate.");
