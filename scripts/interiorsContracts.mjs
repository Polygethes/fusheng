// Interiors: every building type, any household size, both variants — rooms
// as topology expands them, a door in the wall for every link, a front door
// on the bottom wall, furniture and objects in their rooms, six spots a room.
import assert from "node:assert/strict";
import { SITE_TYPES } from "../src/worlds/catalog/siteTypes.mjs";
import { expandRooms, expandLinks } from "../src/worlds/compiler/rooms.mjs";
import { buildInterior, interiorVariant } from "../src/worlds/compiler/interiors.mjs";
import { walkableTiles, findPath, inRect, rectsOverlap, rectTiles, tileKey } from "../src/worlds/layoutGeometry.mjs";

const near = ([x, y], rect) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inRect([x + dx, y + dy], rect));

for (const [type, def] of Object.entries(SITE_TYPES).filter(([, row]) => row.kind === "building")) {
  assert.ok(def.interiorTemplates?.length, `${type} lists interior templates`);
  for (const residentCount of [1, 2, 4, 6]) {
    for (const templateId of def.interiorTemplates) {
      const label = `${type}/${templateId}/${residentCount}`;
      const site = { id: `t_${type}`, name: def.label, type };
      const objects = [
        ...(def.objects || []).map((row) => ({ id: `${site.id}_${row.slug}`, name: row.label, slug: row.slug, room: row.room, portable: Boolean(row.portable) })),
        { id: `${site.id}_extra`, name: "包袱", portable: true },
      ];
      const args = { site, def, residentCount, objects, variant: interiorVariant(templateId), seed: 3 };
      const built = buildInterior(args);
      assert.equal(JSON.stringify(buildInterior(args)), JSON.stringify(built), `${label}: deterministic`);
      const { map, frontDoorTile, entryZoneId, mapId } = built;
      assert.equal(mapId, `interior:${site.id}`);
      assert.ok(map.grid.cols <= 24 && map.grid.rows <= 16, `${label}: fits 24×16 (${map.grid.cols}×${map.grid.rows})`);

      // Rooms are exactly what topology expands, inside the map, apart.
      const rooms = expandRooms(def, residentCount);
      const zoneOf = (suffix) => `${site.id}__${suffix}`;
      assert.deepEqual(Object.keys(map.zones).sort(), rooms.map((room) => zoneOf(room.suffix)).sort(), `${label}: rooms match topology`);
      assert.equal(entryZoneId, zoneOf(rooms.find((room) => room.entry).suffix));
      const rect = (zoneId) => map.zones[zoneId].rects[0];
      for (const zoneId of Object.keys(map.zones)) {
        const [c, r, w, h] = rect(zoneId);
        assert.ok(c >= 1 && r >= 1 && c + w <= map.grid.cols - 1 && r + h <= map.grid.rows - 1, `${label}: ${zoneId} is inside the walls`);
        assert.ok(map.zones[zoneId].label, `${label}: ${zoneId} has a label`);
      }
      const ids = Object.keys(map.zones);
      for (let i = 0; i < ids.length; i += 1) for (let j = i + 1; j < ids.length; j += 1) assert.ok(!rectsOverlap(rect(ids[i]), rect(ids[j])), `${label}: ${ids[i]} and ${ids[j]} do not overlap`);

      // A door for every link, in the wall between the two rooms.
      const walkable = walkableTiles(map);
      for (const [a, b] of expandLinks(def, rooms)) {
        const door = map.doors.find((row) => row.between.includes(zoneOf(a)) && row.between.includes(zoneOf(b)));
        assert.ok(door, `${label}: a door between ${a} and ${b}`);
        const [tile] = door.tiles;
        assert.ok(walkable.has(tileKey(tile)) && near(tile, rect(zoneOf(a))) && near(tile, rect(zoneOf(b))), `${label}: the ${a}/${b} door joins both rooms`);
        assert.ok(!map.walls.some((wall) => inRect(tile, wall.rect)), `${label}: door tile ${tile} is not inside any wall`);
        assert.ok(map.floors.some((floor) => inRect(tile, floor.rect)), `${label}: door tile ${tile} has floor`);
      }

      // The front door is on the bottom wall of the entry room and reaches every room.
      assert.equal(frontDoorTile[1], map.grid.rows - 1, `${label}: the front door is on the bottom wall`);
      assert.ok(near(frontDoorTile, rect(entryZoneId)) && walkable.has(tileKey(frontDoorTile)), `${label}: the front door opens into ${entryZoneId}`);
      assert.ok(map.doors.some((row) => row.front && tileKey(row.tiles[0]) === tileKey(frontDoorTile)), `${label}: the front door is drawn and marked`);

      // Objects sit in their rooms; fixed ones are drawn by their furniture.
      for (const object of objects) {
        const drawn = map.objects[object.id];
        assert.ok(drawn, `${label}: ${object.id} is placed`);
        const room = object.room ? rooms.find((row) => row.baseSuffix === object.room) : rooms.find((row) => row.entry);
        assert.equal(drawn.zoneId, zoneOf(room.suffix), `${label}: ${object.id} is in ${room.suffix}`);
        assert.ok(inRect([Math.floor(drawn.at[0]), Math.floor(drawn.at[1])], rect(drawn.zoneId)), `${label}: ${object.id} is inside its room`);
        if (object.slug && !object.portable) assert.equal(drawn.drawer, "fixture", `${label}: ${object.id} is drawn as furniture`);
      }

      // Six places to stand in every room, all reachable from the front door.
      const objectTiles = new Set(Object.values(map.objects).map((row) => tileKey([Math.floor(row.at[0]), Math.floor(row.at[1])])));
      const doorTiles = new Set(map.doors.flatMap((row) => row.tiles.map(tileKey)));
      for (const zoneId of ids) {
        const spots = map.spots[zoneId] || [];
        assert.ok(new Set(spots.map(tileKey)).size >= 6, `${label}: ${zoneId} has six spots (${spots.length})`);
        for (const spot of spots) {
          assert.ok(walkable.has(tileKey(spot)) && inRect(spot, rect(zoneId)) && !doorTiles.has(tileKey(spot)) && !objectTiles.has(tileKey(spot)), `${label}: ${zoneId} spot ${spot} is free floor`);
        }
        assert.ok(findPath(walkable, frontDoorTile, spots[0]), `${label}: the front door reaches ${zoneId}`);
      }
      assert.ok(rectTiles([0, 0, map.grid.cols, 1]).every((tile) => !walkable.has(tileKey(tile))), `${label}: the back wall is solid`);
    }
  }
}

console.log("Interiors passed: every type and household size fits, links are doors, front door on the bottom wall, objects in their rooms, six spots per room.");
