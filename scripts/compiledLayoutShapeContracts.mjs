// Contract test for A9: Town map shapes match jiexing map fields and tiles.js floors
import assert from "node:assert/strict";
import fs from "node:fs";
import { compileBlueprint } from "../src/worlds/compiler/index.mjs";

const fixtures = [
  "scripts/fixtures/blueprints/tiny_hamlet.json",
  "scripts/fixtures/blueprints/river_town.json",
  "scripts/fixtures/blueprints/forest_village.json",
];

// Extract FLOORS keys from tiles.js
const tilesSource = fs.readFileSync("src/stage/tiles.js", "utf8");
const matchFloors = tilesSource.match(/const FLOORS = \{([\s\S]*?)\n\};/);
assert.ok(matchFloors, "tiles.js must contain FLOORS definition");

const floorKeys = new Set();
const floorLines = matchFloors[1].split("\n");
for (const line of floorLines) {
  const m = line.match(/^\s*([a-zA-Z0-9_-]+)[\s:(]/);
  if (m) floorKeys.add(m[1]);
}
const VALID_FLOORS = new Set([
  "wood", "earth", "dirt", "stone", "grass", "meadow", "hill", "path", "water", "herbs"
]);
for (const k of VALID_FLOORS) {
  assert.ok(floorKeys.has(k), `tiles.js must have floor ${k}`);
}

for (const fixPath of fixtures) {
  const bp = JSON.parse(fs.readFileSync(fixPath, "utf8"));
  const { pack, layout } = compileBlueprint(bp);

  console.log(`Checking layout A9 for ${pack.meta.id}...`);

  assert.equal(layout.layoutVersion, 2, "town layout must be v2");
  assert.ok(layout.clockLabel, "layout must have clockLabel");
  assert.equal(layout.size, undefined, "layout must not have size");
  assert.equal(layout.terrain, undefined, "layout must not have terrain");
  for (const map of Object.values(layout.maps)) {
  // 1. Grid
  assert.ok(map.grid, "layout must have grid");
  assert.ok(Number.isInteger(map.grid.cols) && map.grid.cols > 0, "cols must be positive integer");
  assert.ok(Number.isInteger(map.grid.rows) && map.grid.rows > 0, "rows must be positive integer");
  assert.equal(map.grid.tile, 16, "tile must be 16");

  // 2. Forbidden keys
  assert.equal(map.size, undefined, "layout must not have size");
  assert.equal(map.terrain, undefined, "layout must not have terrain");

  // 3. Required top-level keys matching jiexing v1
  assert.ok(map.theme, "layout must have theme");
  assert.ok(map.clockLabel, "layout must have clockLabel");
  assert.ok(map.zones && typeof map.zones === "object", "layout must have zones");
  assert.ok(Array.isArray(map.floors), "layout must have floors array");
  assert.ok(Array.isArray(map.walls), "layout must have walls array");
  assert.ok(Array.isArray(map.doors), "layout must have doors array");
  assert.ok(Array.isArray(map.props), "layout must have props array");
  assert.ok(map.objects && typeof map.objects === "object", "layout must have objects");
  assert.ok(Array.isArray(map.lights), "layout must have lights array");
  assert.ok(map.spots && typeof map.spots === "object", "layout must have spots");
  assert.ok(Array.isArray(map.blocked), "layout must have blocked array");
  assert.ok(map.ambient && typeof map.ambient === "object", "layout must have ambient object");

  // 4. Floors materials must all exist in tiles.js FLOORS
  for (const [idx, floor] of map.floors.entries()) {
    assert.ok(floor.rect && floor.rect.length === 4, `floors[${idx}] must have rect [x, y, w, h]`);
    assert.ok(VALID_FLOORS.has(floor.material), `floors[${idx}] material '${floor.material}' must exist in tiles.js FLOORS`);
  }

  // 5. Doors between and style
  for (const [idx, door] of map.doors.entries()) {
    assert.ok(Array.isArray(door.between) && door.between.length === 2, `doors[${idx}] must have between array of 2 zone ids`);
    assert.ok(Array.isArray(door.tiles) && door.tiles.length > 0, `doors[${idx}] must have tiles array with at least one tile`);
    assert.ok(door.style, `doors[${idx}] must have style`);
  }

  // 6. Zones have label and rects
  for (const [zId, z] of Object.entries(map.zones)) {
    assert.ok(z.label, `zones.${zId} must have label`);
    assert.ok(Array.isArray(z.rects) && z.rects.length > 0, `zones.${zId} must have rects`);
  }
  }
}

console.log("Layout A9 contracts passed.");
