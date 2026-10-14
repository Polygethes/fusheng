// Contract tests for World Catalog (Task P2.2)
import assert from "node:assert/strict";
import {
  SITE_TYPES,
  SKILLS,
  APPEARANCE_STYLES,
  COLOR_PALETTES,
  EDGES,
  TOWN_TIME_POLICY,
} from "../src/worlds/catalog/index.mjs";

// 1. Immutability: All catalog structures must be deeply frozen
assert.ok(Object.isFrozen(SITE_TYPES));
assert.ok(Object.isFrozen(SKILLS));
assert.ok(Object.isFrozen(APPEARANCE_STYLES));
assert.ok(Object.isFrozen(COLOR_PALETTES));
assert.ok(Object.isFrozen(EDGES));
assert.ok(Object.isFrozen(TOWN_TIME_POLICY));

// 2. Minimum required site types
const requiredBuildings = ["home", "smithy", "inn", "shop", "herb_shop", "clinic", "temple", "school", "farmhouse", "mill", "post"];
const requiredOutdoors = ["square", "street", "market", "well", "field", "forest", "river_bank", "bridge", "pond", "hill", "road_out"];

for (const b of requiredBuildings) {
  assert.ok(SITE_TYPES[b], `Missing building site type: ${b}`);
  assert.equal(SITE_TYPES[b].kind, "building");
}
for (const o of requiredOutdoors) {
  assert.ok(SITE_TYPES[o], `Missing outdoor site type: ${o}`);
  assert.equal(SITE_TYPES[o].kind, "outdoor");
}

// 3. Building consistency checks
for (const [typeId, def] of Object.entries(SITE_TYPES)) {
  if (def.kind === "building") {
    assert.ok(Array.isArray(def.rooms) && def.rooms.length > 0, `${typeId} must have rooms`);
    assert.ok(def.rooms.some((r) => r.entry), `${typeId} must have an entry room`);

    // Suffix uniqueness
    const suffixes = new Set();
    for (const r of def.rooms) {
      assert.ok(!suffixes.has(r.suffix), `${typeId} room suffix duplicated: ${r.suffix}`);
      suffixes.add(r.suffix);
    }

    // Links reference existing room suffixes (or wildcard bedroom*)
    if (Array.isArray(def.links)) {
      for (const [from, to] of def.links) {
        const fromMatches = suffixes.has(from) || from.endsWith("*");
        const toMatches = suffixes.has(to) || to.endsWith("*");
        assert.ok(fromMatches, `${typeId} link from '${from}' does not match any room suffix`);
        assert.ok(toMatches, `${typeId} link to '${to}' does not match any room suffix`);
      }
    }

    // Objects slugs uniqueness
    const objSlugs = new Set();
    if (Array.isArray(def.objects)) {
      for (const obj of def.objects) {
        assert.ok(!objSlugs.has(obj.slug), `${typeId} duplicate object slug: ${obj.slug}`);
        objSlugs.add(obj.slug);
        assert.ok(suffixes.has(obj.room), `${typeId} object ${obj.slug} placed in non-existent room: ${obj.room}`);
      }
    }

    // Work tasks reference valid room, objects, skills, and tools
    assert.ok(Array.isArray(def.work) && def.work.length > 0, `${typeId} must have at least 1 work task`);
    for (const w of def.work) {
      assert.ok(suffixes.has(w.room), `${typeId} work room '${w.room}' does not exist`);
      for (const slug of w.objectSlugs || []) {
        assert.ok(objSlugs.has(slug), `${typeId} work references non-existent object slug: ${slug}`);
      }
      for (const slug of w.toolSlugs || []) {
        assert.ok(objSlugs.has(slug), `${typeId} work references non-existent tool slug: ${slug}`);
      }
      for (const sId of w.requiredSkillIds || []) {
        assert.ok(SKILLS[sId], `${typeId} work references unknown skill: ${sId}`);
      }
    }

    // interiorTemplates non-empty
    assert.ok(Array.isArray(def.interiorTemplates) && def.interiorTemplates.length > 0, `${typeId} interiorTemplates must not be empty`);
  } else if (def.kind === "outdoor") {
    assert.ok(Array.isArray(def.zones) && def.zones.length > 0, `${typeId} outdoor must have zones`);
  }
}

// 4. Specific requirement checks:
// - herb_shop must have "配药" requiring medicine or herbalism
const herbShop = SITE_TYPES.herb_shop;
const dispenseTask = herbShop.work.find((w) => w.templateId === "dispense_medicine" || w.taskLabel.includes("配药"));
assert.ok(dispenseTask, "herb_shop must have a dispensing medicine work task");
assert.ok(
  dispenseTask.requiredSkillIds.includes("medicine") || dispenseTask.requiredSkillIds.includes("herbalism"),
  "dispense_medicine must require medicine or herbalism"
);

// - forest must have herbalism / woodcutting tasks
const forest = SITE_TYPES.forest;
assert.ok(forest.work.some((w) => w.templateId === "forage_herbs" || w.requiredSkillIds.includes("herbalism")), "forest must have forage herbs work");
assert.ok(forest.work.some((w) => w.templateId === "cut_firewood" || w.requiredSkillIds.includes("woodcutting")), "forest must have cut firewood work");

// 5. Edge constants: JSON round-trip equality & omitting unreachable modalities
assert.deepEqual(JSON.parse(JSON.stringify(EDGES.ROOM_ROOM)), EDGES.ROOM_ROOM);
assert.deepEqual(JSON.parse(JSON.stringify(EDGES.ROOM_DOOR)), EDGES.ROOM_DOOR);
assert.deepEqual(JSON.parse(JSON.stringify(EDGES.STREET_STREET(1))), EDGES.STREET_STREET(1));
assert.deepEqual(JSON.parse(JSON.stringify(EDGES.TO_WILD(3))), EDGES.TO_WILD(3));

// ROOM_DOOR visual modality is omitted (not Infinity)
assert.strictEqual(EDGES.ROOM_DOOR.visual, undefined);
assert.strictEqual(EDGES.ROOM_DOOR.sound, 2);

console.log("Catalog contracts passed.");
