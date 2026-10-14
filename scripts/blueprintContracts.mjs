// Contract tests for World Blueprint Schema and Validation (Task P2.1)
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BLUEPRINT_VERSION, BLUEPRINT_SCHEMA, SECTION_SCHEMAS } from "../src/worlds/blueprint/schema.mjs";
import { validateBlueprint } from "../src/worlds/blueprint/validateBlueprint.mjs";
import { unsatisfiableSchemaPaths } from "../src/worlds/worldSmoke.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, "fixtures/blueprints/tiny_hamlet.json");
const tinyHamlet = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

// 1. BLUEPRINT_VERSION and schema validity
assert.equal(BLUEPRINT_VERSION, 1);
assert.deepEqual(JSON.parse(JSON.stringify(BLUEPRINT_SCHEMA)), BLUEPRINT_SCHEMA);
assert.ok(SECTION_SCHEMAS.world);
assert.ok(SECTION_SCHEMAS.sites);
assert.ok(SECTION_SCHEMAS.residents);
assert.ok(SECTION_SCHEMAS.relationships);
assert.ok(SECTION_SCHEMAS.opening);

const brokenSchemaPaths = unsatisfiableSchemaPaths(BLUEPRINT_SCHEMA);
assert.deepEqual(brokenSchemaPaths, [], `Unsatisfiable schema paths: ${brokenSchemaPaths.join(", ")}`);

// 2. Base fixture tiny_hamlet must pass cleanly
const baseResult = validateBlueprint(tinyHamlet);
assert.equal(baseResult.ok, true, `tiny_hamlet had unexpected issues: ${JSON.stringify(baseResult.issues)}`);
assert.equal(baseResult.issues.length, 0);

// Helper to make a cloned copy
function cloneFixture() {
  return JSON.parse(JSON.stringify(tinyHamlet));
}

// B1: ID uniqueness and format (e.g. duplicate resident ID or site ID)
{
  const bp = cloneFixture();
  bp.residents[1].id = "li_dashan";
  const res = validateBlueprint(bp);
  assert.equal(res.ok, false);
  const issue = res.issues.find((i) => i.rule === "B1");
  assert.ok(issue, "Expected B1 rule issue for duplicate resident id");
  assert.equal(issue.path, "residents[1].id");
}

// B2: Household / workSite / routine.siteId must point to existing site
{
  const bp = cloneFixture();
  bp.residents[0].workSiteId = "nowhere";
  const res = validateBlueprint(bp);
  assert.equal(res.ok, false);
  const issue = res.issues.find((i) => i.rule === "B2");
  assert.ok(issue, "Expected B2 rule issue for missing workSiteId");
  assert.equal(issue.path, "residents[0].workSiteId");
}

// B3: Resident count <= 30, household >= 1 resident, at least 1 outdoor site
{
  const bp = cloneFixture();
  // 31 residents
  const template = bp.residents[0];
  bp.residents = Array.from({ length: 31 }, (_, idx) => ({
    ...template,
    id: `res_${idx}`,
    name: `居民${idx}`,
    householdId: "li",
    workSiteId: "li_home",
    routine: [{ from: "08:00", to: "12:00", activity: "忙碌", siteId: "li_home" }],
  }));
  const res = validateBlueprint(bp);
  assert.equal(res.ok, false);
  const issue = res.issues.find((i) => i.rule === "B3");
  assert.ok(issue, "Expected B3 rule issue for resident count > 30");
  assert.equal(issue.path, "residents");
}

// B4: Every resident has at least 1 desire, grounded in real town people/sites/objects
{
  const bp = cloneFixture();
  bp.residents[0].desires = [];
  const res = validateBlueprint(bp);
  assert.equal(res.ok, false);
  const issue = res.issues.find((i) => i.rule === "B4");
  assert.ok(issue, "Expected B4 rule issue for empty desires");
  assert.equal(issue.path, "residents[0].desires");
}

// B5: Relationships endpoints exist and not self-referential
{
  const bp = cloneFixture();
  bp.relationships[0].to = bp.relationships[0].from;
  const res = validateBlueprint(bp);
  assert.equal(res.ok, false);
  const issue = res.issues.find((i) => i.rule === "B5");
  assert.ok(issue, "Expected B5 rule issue for self-referential relationship");
  assert.equal(issue.path, "relationships[0].to");
}

// B6: Deadline responsible / knownBy exist, referenced condition targets exist
{
  const bp = cloneFixture();
  bp.opening.deadlines[0].responsible = ["ghost_person"];
  const res = validateBlueprint(bp);
  assert.equal(res.ok, false);
  const issue = res.issues.find((i) => i.rule === "B6");
  assert.ok(issue, "Expected B6 rule issue for non-existent deadline responsible");
  assert.equal(issue.path, "opening.deadlines[0].responsible[0]");
}

// B7: Routine time format and no overlaps
{
  const bp = cloneFixture();
  bp.residents[0].routine[0].from = "25:00";
  const res = validateBlueprint(bp);
  assert.equal(res.ok, false);
  const issue = res.issues.find((i) => i.rule === "B7");
  assert.ok(issue, "Expected B7 rule issue for invalid routine time 25:00");
  assert.equal(issue.path, "residents[0].routine[0].from");
}

{
  const bp = cloneFixture();
  // Overlapping routines: 06:00-08:30 and 08:00-12:00
  bp.residents[0].routine[0].to = "08:30";
  const res = validateBlueprint(bp);
  assert.equal(res.ok, false);
  const issue = res.issues.find((i) => i.rule === "B7");
  assert.ok(issue, "Expected B7 rule issue for overlapping routine times");
  assert.equal(issue.path, "residents[0].routine[1]");
}

// B8: Appearance hex colors and style set
{
  const bp = cloneFixture();
  bp.residents[0].appearance.skin = "red";
  const res = validateBlueprint(bp);
  assert.equal(res.ok, false);
  const issue = res.issues.find((i) => i.rule === "B8");
  assert.ok(issue, "Expected B8 rule issue for non-hex color 'red'");
  assert.equal(issue.path, "residents[0].appearance.skin");
}

// B9: Situation and text length limits
{
  const bp = cloneFixture();
  bp.residents[0].situation = "长".repeat(405);
  const res = validateBlueprint(bp);
  assert.equal(res.ok, false);
  const issue = res.issues.find((i) => i.rule === "B9");
  assert.ok(issue, "Expected B9 rule issue for situation length > 400");
  assert.equal(issue.path, "residents[0].situation");
}

// B0: the shape is checked before anything else (model drafts and player edits come in here).
{
  const bp = cloneFixture();
  delete bp.residents[2].personality;
  bp.residents[2].mood = "烦";
  const res = validateBlueprint(bp);
  assert.equal(res.ok, false);
  assert.ok(res.issues.some((i) => i.rule === "B0" && i.path === "residents[2].personality"), "a missing field is reported with its path");
  assert.ok(res.issues.some((i) => i.rule === "B0" && i.path === "residents[2].mood"), "an unknown field is reported");
}

// B2: site types come from the catalog; a site's household must exist.
{
  const bp = cloneFixture();
  bp.town.sites[2].type = "castle";
  bp.town.sites[0].householdId = "nobody";
  const res = validateBlueprint(bp);
  assert.ok(res.issues.some((i) => i.rule === "B2" && i.path === "town.sites[2].type"));
  assert.ok(res.issues.some((i) => i.rule === "B2" && i.path === "town.sites[0].householdId"));
}

// B4: a desire with nothing real behind it, and no routine to anchor the person, is refused.
{
  const bp = cloneFixture();
  bp.residents[3].desires = [{ verb: "看见", object: "远方的云", outcome: "云散开了", strength: 0.5 }];
  bp.residents[3].routine = [];
  const res = validateBlueprint(bp);
  assert.ok(res.issues.some((i) => i.rule === "B4" && i.code === "RESIDENT_DESIRES_UNGROUNDED" && i.path === "residents[3].desires"));
}

// B6: only three condition kinds; "made" needs madeAt; madeAt must be a site with work.
{
  const bp = cloneFixture();
  bp.opening.deadlines[0].conditions[0] = { kind: "repaired", object: "腰伤药包" };
  let res = validateBlueprint(bp);
  assert.ok(res.issues.some((i) => i.rule === "B6" && i.path === "opening.deadlines[0].conditions[0].kind"));

  const noMade = cloneFixture();
  delete noMade.opening.objects[1].madeAt;
  res = validateBlueprint(noMade);
  assert.ok(res.issues.some((i) => i.code === "CONDITION_OBJECT_NOT_MADE"));

  const nowhere = cloneFixture();
  nowhere.opening.objects[1].madeAt = "nowhere";
  res = validateBlueprint(nowhere);
  assert.ok(res.issues.some((i) => i.rule === "B6" && i.path === "opening.objects[1].madeAt"));

  const wrongWork = cloneFixture();
  wrongWork.opening.objects[1].madeWith = "forge_tool";
  res = validateBlueprint(wrongWork);
  assert.ok(res.issues.some((i) => i.code === "OBJECT_MADE_WITH_UNKNOWN"));

  const ghost = cloneFixture();
  ghost.opening.deadlines[0].conditions[1].object = "不存在的东西";
  res = validateBlueprint(ghost);
  assert.ok(res.issues.some((i) => i.code === "CONDITION_OBJECT_UNKNOWN"));
}

// B9 covers every text field through the schema, not just situation.
{
  const bp = cloneFixture();
  bp.residents[1].memories[0].content = "长".repeat(301);
  const res = validateBlueprint(bp);
  assert.ok(res.issues.some((i) => i.rule === "B9" && i.path === "residents[1].memories[0].content"));
}

// All three fixtures stay valid.
for (const name of ["tiny_hamlet", "river_town", "forest_village"]) {
  const bp = JSON.parse(fs.readFileSync(path.join(__dirname, `fixtures/blueprints/${name}.json`), "utf8"));
  const res = validateBlueprint(bp);
  assert.equal(res.ok, true, `${name}: ${JSON.stringify(res.issues.slice(0, 3))}`);
}

console.log("Blueprint schema and validation contracts passed.");
