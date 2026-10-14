// A hidden valley needs someone to keep its array stones lit: the catalog has
// an 阵法 skill and an array-eye site that sits on the hills, with work that
// only someone who knows 阵法 can do. Towns that do not use it are unchanged.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { SITE_TYPES, SKILLS } from "../src/worlds/catalog/index.mjs";
import { compileBlueprint } from "../src/worlds/compiler/index.mjs";
import { validateWorldPack } from "../src/worlds/validateWorldPack.mjs";
import { validateBlueprint } from "../src/worlds/blueprint/validateBlueprint.mjs";

// 1. The skill and the site type.
assert.deepEqual(SKILLS.arrays, { id: "arrays", name: "阵法", description: "刻画阵纹、修补阵石阵眼" });
const eye = SITE_TYPES.array_eye;
assert.equal(eye.kind, "outdoor");
assert.equal(eye.label, "阵眼");
assert.equal(eye.terrain, "hills");
assert.deepEqual(eye.zones.map((row) => [row.suffix, row.label]), [["slope", "阵石坡"], ["eye", "阵眼石台"]]);
assert.deepEqual(eye.objects.map((row) => [row.slug, row.label, row.room, row.portable]), [["eye_stone", "阵眼石", "eye", false]]);
const mend = eye.work.find((row) => row.templateId === "mend_array_eye");
assert.equal(mend.taskLabel, "补阵眼");
assert.deepEqual(mend.requiredSkillIds, ["arrays"]);
assert.equal(mend.room, "eye");
assert.deepEqual(mend.objectSlugs, ["eye_stone"]);

// 2. A hamlet with an array eye on its northern hills, and a resident who knows 阵法.
const hamlet = JSON.parse(fs.readFileSync("scripts/fixtures/blueprints/tiny_hamlet.json", "utf8"));
const blueprint = JSON.parse(JSON.stringify(hamlet));
blueprint.town.sites.push({ id: "north_eye", name: "北坡阵眼", type: "array_eye" });
blueprint.residents[0].skills.push("arrays");
assert.deepEqual(validateBlueprint(blueprint).issues, []);
const { pack } = compileBlueprint(blueprint);
assert.equal(validateWorldPack(pack).ok, true, JSON.stringify(validateWorldPack(pack).issues));
const zones = pack.stage.topology.zones;
assert.ok(zones.north_eye__slope && zones.north_eye__eye, "both zones of the array eye exist");
const site = pack.stage.sites.find((row) => row.id === "north_eye");
assert.deepEqual([site.kind, site.entryZoneId], ["outdoor", "north_eye__slope"]);
const work = pack.work.find((row) => row.zoneId === "north_eye__eye");
assert.ok(work, "the mending work is at the eye");
assert.deepEqual(work.requiredSkillIds, ["arrays"]);
// It sits in the northern hills band (tiny_hamlet puts its hills to the north).
const layoutZone = pack.layout.maps.exterior.zones.north_eye__slope || pack.layout.zoneMap?.north_eye__slope;
const rects = (pack.layout.maps.exterior.zones?.north_eye__slope?.rects) || [];
assert.ok(layoutZone, "the array eye is drawn on the exterior map");
assert.ok(rects.length && rects.every(([, y, , h]) => y + h <= 14), "on the hills at the north edge");
const upper = (pack.layout.maps.exterior.floors || []).find((row) => JSON.stringify(row.rect) === JSON.stringify(pack.layout.maps.exterior.zones.north_eye__eye.rects[0]));
assert.equal(upper?.material, "hill", "the stone platform is drawn as hillside");

// 3. Towns that do not use it compile exactly as before.
const before = { big_town: "a0cdde98c544fe30", forest_village: "148151abbced5605", river_town: "38603127517048da", tiny_hamlet: "737f8456da55d7fb" };
for (const [name, digest] of Object.entries(before)) {
  const fixture = JSON.parse(fs.readFileSync(`scripts/fixtures/blueprints/${name}.json`, "utf8"));
  const compiled = compileBlueprint(fixture).pack;
  assert.equal(crypto.createHash("sha256").update(JSON.stringify(compiled)).digest("hex").slice(0, 16), digest, `${name} is unchanged`);
}

console.log("Array eye catalog passed: 阵法 skill, array-eye site on the hills, other towns unchanged.");
