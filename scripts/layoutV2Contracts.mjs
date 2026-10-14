// Layout v2: one geometry for checker and stage, the atlas the observer draws,
// routes across portals, and the V9/V13 checks for maps.
import assert from "node:assert/strict";
import { walkableTiles, findPath, rectsTouch, rectsOverlap } from "../src/worlds/layoutGeometry.mjs";
import { flattenLayout, routeTiles, mapAtTile, EXTERIOR } from "../src/worlds/layoutAtlas.mjs";
import { validateLayoutV2 } from "../src/worlds/validateLayoutV2.mjs";
import { JIEXING_LAYOUT } from "../src/worlds/jiexing/layout.mjs";

// 1. Geometry: the walkable rule tiles.js has always used.
{
  const walkable = walkableTiles(JIEXING_LAYOUT);
  assert.ok(walkable.has("13,4"), "a door through a wall stays walkable");
  assert.ok(!walkable.has("0,5"), "walls are not walkable");
  assert.ok(!walkable.has("19,11"), "water is not walkable");
  assert.ok(walkable.has("21,10"), "a bridge door over water is walkable");
  assert.ok(!walkable.has("6,4"), "blocked furniture is not walkable");
  assert.equal(findPath(walkable, [2, 4], [21, 12]).length > 0, true, "the bedroom reaches the bridge");
  assert.equal(findPath(walkable, [2, 4], [0, 5]), null);
  assert.ok(rectsTouch([0, 0, 2, 2], [2, 1, 2, 2]) && !rectsTouch([0, 0, 2, 2], [2, 2, 2, 2]), "a shared edge touches, a corner does not");
  assert.ok(rectsOverlap([0, 0, 3, 3], [2, 2, 3, 3]) && !rectsOverlap([0, 0, 2, 2], [2, 0, 2, 2]));
}

// 2. A v1 layout is its own atlas, untouched.
{
  const atlas = flattenLayout(JIEXING_LAYOUT);
  assert.equal(atlas.layout, JIEXING_LAYOUT);
  assert.equal(atlas.version, 1);
  assert.deepEqual(atlas.maps, { [EXTERIOR]: { rect: [0, 0, 24, 13], label: "" } });
  assert.equal(atlas.mapOfZone.yard, EXTERIOR);
  assert.deepEqual(atlas.portals, []);
}

// A street, two houses; each house is its own interior map.
const tinyV2 = () => ({
  layoutVersion: 2, clockLabel: "辰时",
  maps: {
    exterior: { grid: { cols: 14, rows: 6, tile: 16 }, theme: "day",
      zones: { st: { label: "街", rects: [[0, 2, 14, 2]] } },
      doors: [{ between: ["st", "a_hall"], tiles: [[3, 1]], style: "door" }, { between: ["st", "b_hall"], tiles: [[10, 1]], style: "door" }],
      spots: { st: [[1, 2], [2, 2], [4, 3], [6, 2], [8, 3], [12, 2]] },
      roofs: [{ siteId: "a", rect: [1, 0, 5, 2], label: "甲家" }, { siteId: "b", rect: [8, 0, 5, 2], label: "乙家" }],
      props: [{ kind: "lantern", at: [6.5, 4.2] }], lights: [{ at: [6.5, 4.2], r: 20, color: "#ffc060" }],
      walls: [{ rect: [0, 5, 14, 1], style: "fence-wood", posts: [3] }], floors: [{ rect: [0, 2, 14, 2], material: "dirt" }],
      objects: {}, blocked: [[0, 0, 0, 1]], ambient: { birds: [[0, 0, 14, 2]] } },
    "interior:a": { grid: { cols: 6, rows: 5, tile: 16 }, zones: { a_hall: { label: "堂屋", rects: [[1, 1, 4, 3]] } },
      doors: [{ between: ["a_hall", "st"], tiles: [[3, 4]], style: "door" }], spots: { a_hall: [[1, 1], [2, 1], [3, 1], [1, 2], [2, 2], [4, 3]] },
      objects: { pot: { zoneId: "a_hall", at: [1.2, 3.1], drawer: "pot" } } },
    "interior:b": { grid: { cols: 6, rows: 5, tile: 16 }, zones: { b_hall: { label: "堂屋", rects: [[1, 1, 4, 3]] } },
      doors: [{ between: ["b_hall", "st"], tiles: [[3, 4]], style: "door" }], spots: { b_hall: [[1, 1], [2, 1], [3, 1], [1, 2], [2, 2], [4, 3]] } },
  },
  zoneMap: { st: "exterior", a_hall: "interior:a", b_hall: "interior:b" },
  portals: [
    { siteId: "a", exteriorZoneId: "st", exteriorDoorTile: [3, 1], interiorMapId: "interior:a", interiorZoneId: "a_hall", interiorDoorTile: [3, 4] },
    { siteId: "b", exteriorZoneId: "st", exteriorDoorTile: [10, 1], interiorMapId: "interior:b", interiorZoneId: "b_hall", interiorDoorTile: [3, 4] },
  ],
});

// 3. The atlas shifts every coordinate of a map by the same origin.
{
  const atlas = flattenLayout(tinyV2());
  assert.equal(atlas.version, 2);
  assert.deepEqual(atlas.maps.exterior.rect, [0, 0, 14, 6]);
  assert.deepEqual(atlas.maps["interior:a"].rect, [0, 8, 6, 5], "interiors are packed below the exterior with a 2-tile gap");
  assert.deepEqual(atlas.maps["interior:b"].rect, [8, 8, 6, 5]);
  assert.deepEqual(atlas.layout.grid, { cols: 14, rows: 13, tile: 16 });
  assert.deepEqual(atlas.layout.zones.b_hall.rects, [[9, 9, 4, 3]]);
  assert.deepEqual(atlas.layout.spots.b_hall[0], [9, 9]);
  assert.deepEqual(atlas.layout.objects.pot.at, [1.2, 11.1]);
  assert.deepEqual(atlas.layout.walls[0].posts, [3], "exterior wall posts keep their x");
  assert.deepEqual(atlas.layout.blocked[0], [0, 0, 0, 1]);
  assert.equal(atlas.layout.dayCycle, true);
  assert.equal(atlas.layout.clockLabel, "辰时");
  assert.deepEqual(atlas.portals[1], { siteId: "b", exterior: { mapId: "exterior", zoneId: "st", tile: [10, 1] }, interior: { mapId: "interior:b", zoneId: "b_hall", tile: [11, 12] } });
  assert.equal(mapAtTile(atlas, [10, 10]), "interior:b");
  assert.equal(mapAtTile(atlas, [7, 7]), null, "the gap belongs to no map");
}

// 4. Routes cross maps only through portals.
{
  const atlas = flattenLayout(tinyV2());
  const walkable = walkableTiles(atlas.layout);
  const into = routeTiles(atlas, walkable, [1, 2], atlas.layout.spots.a_hall[0]);
  const jump = into.findIndex((step) => step.jump);
  assert.ok(jump > 0, "walk to the door, then jump");
  assert.deepEqual(into[jump - 1].tile, [3, 1], "the last outdoor step is the street door");
  assert.deepEqual(into[jump].tile, [3, 12], "the first indoor step is the house door");
  assert.deepEqual(into.at(-1).tile, atlas.layout.spots.a_hall[0]);
  const across = routeTiles(atlas, walkable, atlas.layout.spots.a_hall[0], atlas.layout.spots.b_hall[0]);
  assert.equal(across.filter((step) => step.jump).length, 2, "house to house goes out through the street");
  assert.ok(across.every((step, i) => step.jump || i === 0 || Math.abs(step.tile[0] - across[i - 1].tile[0]) + Math.abs(step.tile[1] - across[i - 1].tile[1]) === 1), "between jumps every step is one tile");
  assert.equal(routeTiles(atlas, walkable, [1, 2], [7, 7]), null, "no route into the gap");
  // A walk on one map has the same shape as one across maps (the observer reads step.tile).
  const street = routeTiles(atlas, walkable, [1, 2], [3, 1]);
  assert.ok(street.length > 0 && street.every((step) => Array.isArray(step.tile) && !step.jump), "a same-map walk is a list of { tile } steps");
  assert.deepEqual(street.at(-1).tile, [3, 1]);
  assert.deepEqual(routeTiles(atlas, walkable, [1, 2], [1, 2]), [], "standing still is an empty walk");
}

// 5. V9 (maps) and V13 (town) on a correct map and on broken ones.
{
  const pack = (layout) => ({ meta: { scale: "town" }, layout, objects: [{ id: "pot", label: "锅", zoneId: "a_hall" }],
    stage: { topology: { defaultZoneId: "st", zones: { st: {}, a_hall: {}, b_hall: {} }, edges: [{ from: "a_hall", to: "st" }, { from: "b_hall", to: "st" }] } } });
  const codes = (layout) => { const out = []; validateLayoutV2(pack(layout), (rule, code) => out.push(code)); return out; };
  assert.deepEqual(codes(tinyV2()), [], "the tiny town is clean");

  const lotOnStreet = tinyV2(); lotOnStreet.maps.exterior.roofs[0].rect = [1, 1, 5, 2];
  assert.ok(codes(lotOnStreet).includes("TOWN_LOT_ON_ZONE"));
  const detached = tinyV2(); detached.portals[0].exteriorDoorTile = [13, 5]; detached.maps.exterior.doors[0].tiles = [[13, 5]];
  assert.ok(codes(detached).includes("TOWN_PORTAL_DETACHED"));
  const noPortal = tinyV2(); noPortal.portals.pop();
  assert.ok(codes(noPortal).includes("LAYOUT_PORTAL_MISSING"));
  const fewSpots = tinyV2(); fewSpots.maps["interior:b"].spots.b_hall = [[1, 1], [2, 1]];
  assert.ok(codes(fewSpots).includes("TOWN_ZONE_FEW_SPOTS"));
  const twoMaps = tinyV2(); twoMaps.maps["interior:b"].zones.st = { rects: [[0, 0, 1, 1]] };
  assert.ok(codes(twoMaps).includes("LAYOUT_ZONE_MAP_MISMATCH"));
  const walled = tinyV2(); walled.maps["interior:a"].walls = [{ rect: [1, 2, 4, 1], style: "partition" }];
  assert.ok(codes(walled).includes("TOWN_PORTAL_UNREACHABLE"), "a wall between the room and its door is caught");
  const big = tinyV2(); big.maps["interior:a"].grid = { cols: 30, rows: 5, tile: 16 };
  assert.ok(codes(big).includes("TOWN_MAP_TOO_LARGE"));
  const misplaced = tinyV2(); misplaced.maps["interior:a"].objects.pot.at = [0.2, 0.2];
  assert.ok(codes(misplaced).includes("LAYOUT_OBJECT_OUTSIDE_ZONE"));
}

console.log("Layout v2 passed: shared walkable rule, v1 atlas identity, shifted v2 atlas, portal routes, V9/V13 on maps.");
