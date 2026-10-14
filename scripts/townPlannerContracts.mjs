// The exterior planner: a real town map for any blueprint, the same map for
// the same seed, and nothing built on top of anything else.
import assert from "node:assert/strict";
import fs from "node:fs";
import { planTown } from "../src/worlds/compiler/townPlanner.mjs";
import { SITE_TYPES } from "../src/worlds/catalog/siteTypes.mjs";
import { walkableTiles, findPath, inRect, rectsOverlap, rectsTouch, rectTiles, tileKey } from "../src/worlds/layoutGeometry.mjs";

const SEEDS = [1, 2, 3, 7, 42];
const fixture = (name) => JSON.parse(fs.readFileSync(`scripts/fixtures/blueprints/${name}.json`, "utf8"));

// A crowded town that uses every outdoor type and the largest map tier.
function bigTown() {
  const homes = Array.from({ length: 16 }, (_, i) => ({ id: `home_${i + 1}`, name: `${i + 1}号院`, type: i % 4 === 0 ? "smithy" : i % 5 === 0 ? "inn" : "home", householdId: `hh_${i + 1}` }));
  const outdoors = ["square", "well", "market", "forest", "hill", "field", "river_bank", "bridge", "pond", "road_out"]
    .map((type) => ({ id: `${type}_site`, name: SITE_TYPES[type].label.split(/[/\s]/u)[0], type }));
  return {
    meta: { id: "big_town", seed: 5 },
    town: { name: "大镇", terrain: { river: "south", forest: "north", hills: "east", fields: "west" }, sites: [...homes, ...outdoors] },
    households: homes.map((site) => ({ id: site.householdId, name: site.name, siteId: site.id })),
    residents: homes.map((site, i) => ({ id: `r_${i + 1}`, householdId: site.householdId })),
  };
}

const tier = (buildings) => (buildings <= 6 ? [64, 48] : buildings <= 12 ? [96, 64] : [128, 96]);
const siteZoneIds = (site) => (SITE_TYPES[site.type].zones || SITE_TYPES[site.type].rooms).map((row) => `${site.id}__${row.suffix}`);

function checkPlan(blueprint, seed) {
  const label = `${blueprint.meta.id}#${seed}`;
  const plan = planTown(blueprint, { catalog: SITE_TYPES, seed });
  const { map } = plan;
  const sites = blueprint.town.sites;
  const buildings = sites.filter((site) => SITE_TYPES[site.type].kind === "building");
  const outdoors = sites.filter((site) => SITE_TYPES[site.type].kind === "outdoor");

  // Size tier and bounds.
  assert.deepEqual([map.grid.cols, map.grid.rows], tier(buildings.length), `${label}: map size follows the building count`);
  const inMap = ([c, r, w, h]) => c >= 0 && r >= 0 && c + w <= map.grid.cols && r + h <= map.grid.rows;

  // Every street, the plaza and every outdoor zone is drawn.
  const zoneIds = [...plan.streets.map((row) => row.id), plan.plazaZoneId, ...outdoors.flatMap(siteZoneIds)];
  for (const zoneId of new Set(zoneIds)) assert.ok(map.zones[zoneId]?.rects?.length, `${label}: ${zoneId} has a rect`);
  const zoneRects = Object.entries(map.zones).flatMap(([zoneId, zone]) => zone.rects.map((rect) => ({ zoneId, rect })));
  for (const { zoneId, rect } of zoneRects) assert.ok(inMap(rect), `${label}: ${zoneId} stays inside the map`);
  for (let i = 0; i < zoneRects.length; i += 1) for (let j = i + 1; j < zoneRects.length; j += 1) {
    if (zoneRects[i].zoneId !== zoneRects[j].zoneId) assert.ok(!rectsOverlap(zoneRects[i].rect, zoneRects[j].rect), `${label}: ${zoneRects[i].zoneId} and ${zoneRects[j].zoneId} do not overlap`);
  }

  // Lots: one per building, its catalog footprint, on nothing else, door facing its street.
  assert.deepEqual(Object.keys(plan.lots).sort(), buildings.map((site) => site.id).sort());
  const lots = Object.entries(plan.lots);
  for (const [siteId, lot] of lots) {
    const site = sites.find((row) => row.id === siteId);
    const [fw, fh] = SITE_TYPES[site.type].footprint;
    assert.ok((lot.rect[2] === fw && lot.rect[3] === fh) || (lot.rect[2] === fh && lot.rect[3] === fw), `${label}: ${siteId} uses its footprint`);
    assert.ok(inMap(lot.rect), `${label}: ${siteId} lot inside the map`);
    for (const { zoneId, rect } of zoneRects) assert.ok(!rectsOverlap(lot.rect, rect), `${label}: ${siteId} lot is not on ${zoneId}`);
    const [dx, dy] = lot.doorTile;
    const [c, r, w, h] = lot.rect;
    assert.ok(inRect(lot.doorTile, lot.rect) && (dx === c || dx === c + w - 1 || dy === r || dy === r + h - 1), `${label}: ${siteId} door is on the lot edge`);
    const street = map.zones[plan.frontOf[siteId]].rects;
    assert.ok([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ox, oy]) => street.some((rect) => inRect([dx + ox, dy + oy], rect))), `${label}: ${siteId} door opens onto ${plan.frontOf[siteId]}`);
    assert.ok(map.doors.some((door) => door.tiles.some((tile) => tileKey(tile) === tileKey(lot.doorTile))), `${label}: ${siteId} door is drawn`);
    assert.ok(map.roofs.some((roof) => roof.siteId === siteId && JSON.stringify(roof.rect) === JSON.stringify(lot.rect)), `${label}: ${siteId} has a roof`);
  }
  for (let i = 0; i < lots.length; i += 1) for (let j = i + 1; j < lots.length; j += 1) {
    assert.ok(!rectsOverlap(lots[i][1].rect, lots[j][1].rect), `${label}: ${lots[i][0]} and ${lots[j][0]} do not overlap`);
  }

  // The network: links touch, outdoor entries touch, and everything hangs together.
  const touch = (a, b) => map.zones[a].rects.some((x) => map.zones[b].rects.some((y) => rectsTouch(x, y)));
  for (const [a, b] of plan.streetLinks) assert.ok(touch(a, b), `${label}: linked ${a} and ${b} touch`);
  for (const site of outdoors) {
    const entry = siteZoneIds(site)[0];
    if (plan.outdoorEntry[site.id] !== entry) assert.ok(touch(entry, plan.outdoorEntry[site.id]), `${label}: ${entry} touches ${plan.outdoorEntry[site.id]}`);
    const ids = siteZoneIds(site);
    for (let k = 1; k < ids.length; k += 1) assert.ok(touch(ids[k - 1], ids[k]), `${label}: ${ids[k - 1]} touches ${ids[k]}`);
  }

  // Spots and walking: six places to stand per zone, and the plaza reaches every zone and door.
  const walkable = walkableTiles(map);
  for (const zoneId of Object.keys(map.zones)) {
    const spots = map.spots[zoneId] || [];
    assert.ok(new Set(spots.map(tileKey)).size >= 6, `${label}: ${zoneId} has six spots`);
    for (const spot of spots) assert.ok(walkable.has(tileKey(spot)) && map.zones[zoneId].rects.some((rect) => inRect(spot, rect)), `${label}: ${zoneId} spot ${spot} is walkable and inside`);
  }
  const start = map.spots[plan.plazaZoneId][0];
  for (const zoneId of Object.keys(map.zones)) assert.ok(findPath(walkable, start, map.spots[zoneId][0]), `${label}: the plaza reaches ${zoneId}`);
  for (const [siteId, lot] of lots) assert.ok(findPath(walkable, start, lot.doorTile), `${label}: the plaza reaches the door of ${siteId}`);

  // Water never covers a street, the plaza or a lot.
  const water = map.floors.filter((row) => row.material === "water").map((row) => row.rect);
  for (const id of [...plan.streets.map((row) => row.id), plan.plazaZoneId]) {
    for (const rect of map.zones[id].rects) assert.ok(!rectTiles(rect).some((tile) => water.some((w) => inRect(tile, w))), `${label}: ${id} is dry`);
  }
  for (const [siteId, lot] of lots) assert.ok(!water.some((w) => rectsOverlap(w, lot.rect)), `${label}: ${siteId} is dry`);

  // B3 assertion: all spots must be on dry tiles (spot tile not inside water rect)
  for (const [zoneId, spots] of Object.entries(map.spots)) {
    for (const spot of spots) {
      assert.ok(!water.some((w) => inRect(spot, w)), `${label}: spot ${spot} in ${zoneId} is not in water`);
    }
  }

  // B3 review fix assertion: exterior lights must exist for lanterns/shops
  assert.ok(Array.isArray(map.lights), `${label}: map has lights array`);
  const nonHomes = buildings.filter((b) => !["home", "farmhouse"].includes(b.type));
  if (nonHomes.length > 0) {
    assert.ok(map.lights.length >= nonHomes.length, `${label}: exterior lights generated for shops and lanterns`);
  }

  // Wild places sit on the side the blueprint names.
  const side = { forest: "forest", hill: "hills", field: "fields", river_bank: "river" };
  for (const site of outdoors) {
    const direction = blueprint.town.terrain?.[side[site.type]];
    if (!direction) continue;
    const rects = siteZoneIds(site).flatMap((id) => map.zones[id].rects);
    const cx = rects.reduce((sum, [c, , w]) => sum + c + w / 2, 0) / rects.length;
    const cy = rects.reduce((sum, [, r, , h]) => sum + r + h / 2, 0) / rects.length;
    const ok = { north: cy < map.grid.rows / 2, south: cy > map.grid.rows / 2, west: cx < map.grid.cols / 2, east: cx > map.grid.cols / 2 }[direction];
    assert.ok(ok, `${label}: ${site.id} lies to the ${direction}`);
  }
  return plan;
}

for (const blueprint of [fixture("tiny_hamlet"), fixture("river_town"), fixture("forest_village"), bigTown()]) {
  const maps = new Set();
  for (const seed of SEEDS) {
    const plan = checkPlan(blueprint, seed);
    assert.equal(JSON.stringify(planTown(blueprint, { catalog: SITE_TYPES, seed })), JSON.stringify(plan), `${blueprint.meta.id}#${seed}: the same seed gives the same town`);
    maps.add(JSON.stringify(plan.map));
  }
  assert.ok(maps.size >= 2, `${blueprint.meta.id}: different seeds give different towns`);
}

console.log("Town planner passed: footprints, doors on streets, no overlaps, connected network, six spots per zone, wild places on their side, deterministic.");
