// Contract test for A1: Compiled pack shape parity with jiexing (depth 3)
import assert from "node:assert/strict";
import fs from "node:fs";
import { loadWorldPack } from "../src/worlds/registry.mjs";
import { compileBlueprint } from "../src/worlds/compiler/index.mjs";

const jiexing = await loadWorldPack("jiexing");

const fixtures = [
  "scripts/fixtures/blueprints/tiny_hamlet.json",
  "scripts/fixtures/blueprints/river_town.json",
  "scripts/fixtures/blueprints/forest_village.json",
];

// Helper to extract key paths up to depth 3
function extractKeyPaths(obj, prefix = "", depth = 1) {
  const paths = new Set();
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return paths;
  for (const key of Object.keys(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    paths.add(fullKey);
    if (depth < 3 && obj[key] && typeof obj[key] === "object" && !Array.isArray(obj[key])) {
      const sub = extractKeyPaths(obj[key], fullKey, depth + 1);
      for (const p of sub) paths.add(p);
    }
  }
  return paths;
}

// Allowed whitelist of jiexing-specific keys not required in compiled packs
const WHITELIST = new Set([
  "cast.appearance.hairLight", // Jiexing special visual accent
  "cast.appearance.robeShade", // Jiexing special visual accent
  "cast.appearance.inner",     // Jiexing special visual accent
  "cast.appearance.beard",     // Jiexing specific beard attribute
  "cast.appearance.bandaged",  // Jiexing specific bandaged attribute
  "cast.ecologyProfile.appearance.hairLight",
  "cast.ecologyProfile.appearance.robeShade",
  "cast.ecologyProfile.appearance.inner",
  "cast.ecologyProfile.appearance.beard",
  "cast.ecologyProfile.appearance.bandaged",
  "layout.objects", // Handcrafted objects drawer
  "layout.ambient.fireflies", // Jiexing valley firefly ambient
  "layout.ambient.birds", // Jiexing valley birds ambient
  "layout.ambient.motes", // Jiexing valley motes ambient
  "layout.ambient.mist", // Jiexing valley mist ambient
  "layout.ambient.sunrise", // Jiexing valley sunrise ambient
  "layout.lights", // Handcrafted light fixtures
  "agenda.items.source", // Jiexing scenario doc citation
  "report.metrics.stateKey", // Metrics can be either stateKey or kind: 'holder'
  "report.metrics.unit",
  "report.metrics.target",
  "report.metrics.kind",
  "stage.topology.edges.visual", // Omitted on purpose where sight does not pass (doors), spec §7.1
  "stage.topology.edges.sound", // Same rule for sound; edgeSupports treats a missing modality as blocked
  "stage.topology.edges.conversation",
]);

// Keys that MUST NOT appear in compiled packs
const FORBIDDEN_KEYS = [
  "voice",
  "episodes",
  "beliefs",
  "routine",
  "situation",
  "householdId",
  "workSiteId",
  "social.claims",
  "social.publicAccess",
  "layout.size",
  "layout.layoutVersion",
  "layout.terrain",
  "work.durationSeconds",
  "completionEffects.objectStateFlags",
];

for (const fixPath of fixtures) {
  const bp = JSON.parse(fs.readFileSync(fixPath, "utf8"));
  const { pack } = compileBlueprint(bp);

  console.log(`Checking shape parity for ${pack.meta.id}...`);

  // 1. Cast[0]
  const jxCastKeys = extractKeyPaths(jiexing.cast[0], "cast");
  const compCastKeys = extractKeyPaths(pack.cast[0], "cast");
  for (const k of jxCastKeys) {
    if (!WHITELIST.has(k)) {
      assert.ok(compCastKeys.has(k), `[${pack.meta.id}] cast[0] missing expected key: ${k}`);
    }
  }

  // Check forbidden keys on cast[0]
  for (const k of ["voice", "episodes", "beliefs", "routine", "situation", "householdId", "workSiteId"]) {
    assert.equal(pack.cast[0][k], undefined, `[${pack.meta.id}] cast[0] must not have forbidden key: ${k}`);
  }

  // 2. Relationships[0]
  const jxRelKeys = extractKeyPaths(jiexing.relationships[0], "relationships");
  const compRelKeys = extractKeyPaths(pack.relationships[0], "relationships");
  for (const k of jxRelKeys) {
    if (!WHITELIST.has(k)) {
      assert.ok(compRelKeys.has(k), `[${pack.meta.id}] relationships[0] missing expected key: ${k}`);
    }
  }

  // 3. Objects[0]
  assert.ok(pack.objects[0].id, "objects[0] must have id");
  assert.ok(pack.objects[0].label, "objects[0] must have label");
  assert.ok(pack.objects[0].zoneId, "objects[0] must have zoneId");
  assert.ok(typeof pack.objects[0].portable === "boolean", "objects[0] must have portable boolean");
  assert.ok(pack.objects[0].state && typeof pack.objects[0].state === "object", "objects[0] must have state object");
  assert.ok(pack.objects[0].presentation && typeof pack.objects[0].presentation === "object", "objects[0] must have presentation object");

  // 4. Work[0]
  const jxWorkKeys = extractKeyPaths(jiexing.work[0], "work");
  const compWorkKeys = extractKeyPaths(pack.work[0], "work");
  for (const k of jxWorkKeys) {
    if (!WHITELIST.has(k)) {
      assert.ok(compWorkKeys.has(k), `[${pack.meta.id}] work[0] missing expected key: ${k}`);
    }
  }
  assert.equal(pack.work[0].durationSeconds, undefined, `work[0] must not have durationSeconds`);
  assert.equal(pack.work[0].completionEffects?.objectStateFlags, undefined, `work[0] must not have objectStateFlags`);

  // 5. Agenda.items[0]
  const jxAgendaKeys = extractKeyPaths(jiexing.agenda.items[0], "agenda.items");
  const compAgendaKeys = extractKeyPaths(pack.agenda.items[0], "agenda.items");
  for (const k of jxAgendaKeys) {
    if (!WHITELIST.has(k)) {
      assert.ok(compAgendaKeys.has(k), `[${pack.meta.id}] agenda.items[0] missing expected key: ${k}`);
    }
  }

  // 6. Social.facts and social.boundaries
  assert.ok(Array.isArray(pack.social?.facts), "social.facts must be an array");
  assert.ok(Array.isArray(pack.social?.boundaries), "social.boundaries must be an array");
  assert.equal(pack.social.claims, undefined, "social.claims must not exist");
  assert.equal(pack.social.publicAccess, undefined, "social.publicAccess must not exist");
  for (const [section, jxRow, row] of [
    ["social.facts", jiexing.social.facts[0], pack.social.facts[0]],
    ["social.boundaries", jiexing.social.boundaries[0], pack.social.boundaries[0]],
    ["stage.topology.edges", jiexing.stage.topology.edges[0], pack.stage.topology.edges[0]],
  ]) {
    assert.ok(row, `[${pack.meta.id}] ${section} has at least one row`);
    const have = extractKeyPaths(row, section);
    for (const k of extractKeyPaths(jxRow, section)) {
      if (!WHITELIST.has(k)) assert.ok(have.has(k), `[${pack.meta.id}] ${section}[0] missing expected key: ${k}`);
    }
  }

  // 7. Report and report.metrics[0]
  assert.equal(pack.report?.renderer, "pack-metrics", "report.renderer must be pack-metrics");
  assert.ok(Array.isArray(pack.report?.metrics), "report.metrics must be an array");
  if (pack.report.metrics.length > 0) {
    const jxMetKeys = extractKeyPaths(jiexing.report.metrics[0], "report.metrics");
    const compMetKeys = extractKeyPaths(pack.report.metrics[0], "report.metrics");
    for (const k of jxMetKeys) {
      if (!WHITELIST.has(k)) {
        assert.ok(compMetKeys.has(k), `[${pack.meta.id}] report.metrics[0] missing expected key: ${k}`);
      }
    }
  }

  // 8. Stage.perceptionEnvironment
  const jxPercKeys = extractKeyPaths(jiexing.stage.perceptionEnvironment, "stage.perceptionEnvironment");
  const compPercKeys = extractKeyPaths(pack.stage.perceptionEnvironment, "stage.perceptionEnvironment");
  for (const k of jxPercKeys) {
    if (!WHITELIST.has(k)) {
      assert.ok(compPercKeys.has(k), `[${pack.meta.id}] stage.perceptionEnvironment missing expected key: ${k}`);
    }
  }
  assert.equal(pack.stage.perceptionEnvironment.maxVisualDistance, 2.5, "maxVisualDistance must be 2.5");
  assert.equal(pack.stage.perceptionEnvironment.maxSoundDistance, 3, "maxSoundDistance is 3 route units (P4.1)");

  // 9. Stage.topology.zones.*
  const jxFirstZoneKey = Object.keys(jiexing.stage.topology.zones)[0];
  const compFirstZoneKey = Object.keys(pack.stage.topology.zones)[0];
  const jxZoneKeys = extractKeyPaths(jiexing.stage.topology.zones[jxFirstZoneKey], "stage.topology.zones");
  const compZoneKeys = extractKeyPaths(pack.stage.topology.zones[compFirstZoneKey], "stage.topology.zones");
  for (const k of jxZoneKeys) {
    if (!WHITELIST.has(k)) {
      assert.ok(compZoneKeys.has(k), `[${pack.meta.id}] stage.topology.zones[0] missing expected key: ${k}`);
    }
  }
  assert.equal(pack.stage.topology.zones[compFirstZoneKey].name, undefined, "zone must use label, not name");

  // 10. Exterior map keys include the jiexing layout keys
  const jxLayoutTopKeys = Object.keys(jiexing.layout);
  const exterior = pack.layout.maps.exterior;
  const compLayoutTopKeys = new Set(Object.keys(exterior));
  for (const k of jxLayoutTopKeys) {
    if (!WHITELIST.has(`layout.${k}`)) {
      assert.ok(compLayoutTopKeys.has(k), `[${pack.meta.id}] layout missing expected top-level key: layout.${k}`);
    }
  }
  assert.ok(exterior.grid.cols > 0 && exterior.grid.rows > 0 && exterior.grid.tile === 16, "layout.grid valid");
  assert.ok(Array.isArray(exterior.floors) && exterior.floors.length > 0, "layout.floors valid");
  assert.ok(Array.isArray(exterior.doors), "layout.doors valid");
  const firstZoneId = Object.keys(exterior.zones)[0];
  assert.ok(exterior.zones[firstZoneId].label, "layout zone has label");
  assert.ok(Array.isArray(exterior.zones[firstZoneId].rects), "layout zone has rects");

  assert.equal(exterior.size, undefined, "layout must not have size");
  assert.equal(pack.layout.size, undefined, "layout must not have size");
  assert.equal(pack.layout.layoutVersion, 2, "town layout must be v2");
  assert.ok(pack.layout.maps && pack.layout.zoneMap && Array.isArray(pack.layout.portals), "v2 has maps, zoneMap and portals");
  assert.equal(exterior.terrain, undefined, "layout must not have terrain");
  assert.equal(pack.layout.terrain, undefined, "layout must not have terrain");
}

console.log("Compiled pack shape contracts passed.");
