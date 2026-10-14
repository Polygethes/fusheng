// A town the player built earlier keeps its blueprint. When the compiler has
// moved on (perception ranges, the site list), the town can be rebuilt from
// that blueprint with today's compiler. The old pack is kept beside it, and a
// town that already has saves is only rebuilt when asked, because its saves
// were made with the old pack.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compileBlueprint } from "../src/worlds/compiler/index.mjs";
import { rebuildUserWorld } from "../src/worlds/userWorldStore.mjs";
import { validateWorldPack } from "../src/worlds/validateWorldPack.mjs";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "rebuild-world-"));
const env = { ...process.env, CHARACTER_TOWN_HOME: home };
const blueprint = JSON.parse(fs.readFileSync("scripts/fixtures/blueprints/big_town.json", "utf8"));
const id = blueprint.meta.id;
const dir = path.join(home, "worlds", id);
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

// A pack written before the town rules: no perception ranges, no site list.
const old = JSON.parse(JSON.stringify(compileBlueprint(blueprint).pack));
delete old.stage.perceptionEnvironment.maxSoundDistance;
delete old.stage.perceptionEnvironment.maxVisualDistance;
delete old.stage.sites;
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "pack.json"), JSON.stringify(old));
fs.writeFileSync(path.join(dir, "blueprint.json"), JSON.stringify(blueprint));
fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify({ renderer: "pack-metrics", metrics: [] }));
assert.equal(validateWorldPack(old).ok, false, "the old pack fails today's checks");

try {
  // 1. A dry run says what would change and touches nothing.
  const dry = await rebuildUserWorld(id, { env, dryRun: true });
  assert.equal(dry.id, id);
  assert.equal(dry.saved, false);
  assert.equal(dry.backupDir, null);
  assert.ok(dry.before.issues.some((row) => row.code === "TOWN_PERCEPTION_RANGE_MISSING"), "the dry run names what is wrong now");
  assert.deepEqual(dry.after.issues, [], "and that the rebuilt pack is clean");
  assert.deepEqual(read(path.join(dir, "pack.json")), old, "a dry run writes nothing");

  // 2. The rebuild compiles the saved blueprint with today's compiler and keeps the old pack beside it.
  const done = await rebuildUserWorld(id, { env, now: () => new Date("2026-10-12T02:00:00Z") });
  assert.equal(done.saved, true);
  const rebuilt = read(path.join(dir, "pack.json"));
  assert.equal(validateWorldPack(rebuilt).ok, true);
  assert.equal(rebuilt.stage.perceptionEnvironment.maxSoundDistance, 3);
  assert.ok(rebuilt.stage.sites.length > 0, "the rebuilt town lists its sites");
  assert.deepEqual(rebuilt, JSON.parse(JSON.stringify(compileBlueprint(blueprint).pack)), "exactly what today's compiler makes from the blueprint");
  assert.deepEqual(read(path.join(dir, "blueprint.json")), blueprint, "the blueprint is kept as written");
  assert.ok(Array.isArray(read(path.join(dir, "report.json")).warnings), "the report is the compiler's own");
  const backup = path.join(home, "worlds", `.backup_${id}_20261012-020000`);
  assert.equal(done.backupDir, backup);
  assert.deepEqual(read(path.join(backup, "pack.json")), old, "the old pack is kept");
  assert.deepEqual(read(path.join(backup, "blueprint.json")), blueprint);

  // 3. A town with saves is rebuilt only when asked.
  fs.mkdirSync(path.join(home, "runs", `20261012-030000-${id}-new`), { recursive: true });
  await assert.rejects(rebuildUserWorld(id, { env }), (error) => {
    assert.equal(error.code, "WORLD_HAS_SAVES");
    assert.match(error.message, /存档/u);
    return true;
  });
  const forced = await rebuildUserWorld(id, { env, force: true, now: () => new Date("2026-10-12T04:00:00Z") });
  assert.equal(forced.saved, true);
  assert.ok(fs.existsSync(path.join(home, "worlds", `.backup_${id}_20261012-040000`, "pack.json")));

  // 4. Built-in worlds, worlds without a blueprint and unknown worlds are refused.
  await assert.rejects(rebuildUserWorld("jiexing", { env }), (error) => error.code === "WORLD_ID_RESERVED");
  fs.mkdirSync(path.join(home, "worlds", "no_blueprint"), { recursive: true });
  fs.writeFileSync(path.join(home, "worlds", "no_blueprint", "pack.json"), JSON.stringify(old));
  await assert.rejects(rebuildUserWorld("no_blueprint", { env }), (error) => error.code === "WORLD_BLUEPRINT_MISSING");
  await assert.rejects(rebuildUserWorld("nowhere", { env }), (error) => error.code === "WORLD_PACK_UNKNOWN");

  // 5. Backups are hidden from the world list.
  const { listUserWorldIds } = await import("../src/worlds/userWorldStore.mjs");
  assert.ok(!listUserWorldIds(env).some((row) => row.startsWith(".")));

  // 6. The command line tool.
  const cli = fs.readFileSync("scripts/rebuildUserWorld.mjs", "utf8");
  assert.match(cli, /rebuildUserWorld\(/u);
  assert.match(cli, /--dry-run/u);
  assert.match(cli, /--force/u);
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}

console.log("Rebuild user world passed: dry run, rebuild with backup, saves need --force, refusals.");
