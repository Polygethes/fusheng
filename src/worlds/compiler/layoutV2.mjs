// Assemble the planner's exterior and the same rooms used by the topology.
import { createRng } from "./rng.mjs";
import { buildInterior, interiorVariant } from "./interiors.mjs";
import { rectTiles, tileKey, walkableTiles } from "../layoutGeometry.mjs";

export function buildLayoutV2({ blueprint, plan, topology, objects, catalog, seed, clockLabel }) {
  const rng = createRng(seed);
  const labels = Object.fromEntries(topology.zones.map((zone) => [zone.id, zone.name || zone.label || zone.id]));
  const exterior = structuredClone(plan.map);
  exterior.label = blueprint.town.name;
  exterior.clockLabel = clockLabel;
  exterior.objects = {};
  exterior.lights ||= [];
  const maps = { exterior };
  const zoneMap = {};
  const portals = [];
  const drawnObjects = objects.filter((object) => !object.holderCharacterId && !object.initialHolderActorId)
    .map((object) => ({ ...object, zoneId: object.zoneId || topology.defaultZoneId }));
  const labelMap = (map, mapId) => {
    for (const [zoneId, zone] of Object.entries(map.zones)) {
      zone.label = labels[zoneId];
      zoneMap[zoneId] = mapId;
    }
  };
  labelMap(exterior, "exterior");

  for (const site of blueprint.town.sites) {
    const def = catalog[site.type];
    if (def.kind !== "building") continue;
    const rooms = new Set(topology.siteZones[site.id].rooms);
    const residentCount = blueprint.residents.filter((resident) => resident.householdId && resident.householdId === site.householdId).length || 1;
    const template = def.interiorTemplates[Math.floor(rng() * def.interiorTemplates.length)];
    const interior = buildInterior({ site, def, residentCount, objects: drawnObjects.filter((object) => rooms.has(object.zoneId)), variant: interiorVariant(template), seed });
    const { mapId, entryZoneId, frontDoorTile, map } = interior;
    map.clockLabel = clockLabel;
    labelMap(map, mapId);
    maps[mapId] = map;
    const exteriorZoneId = plan.frontOf[site.id];
    const lot = plan.lots[site.id];
    const exteriorDoor = exterior.doors.find((door) => door.between[1] === site.id);
    exteriorDoor.between[1] = entryZoneId;
    map.doors.find((door) => door.front).between[1] = exteriorZoneId;
    portals.push({ siteId: site.id, exteriorZoneId, exteriorDoorTile: [...lot.doorTile], interiorMapId: mapId, interiorZoneId: entryZoneId, interiorDoorTile: frontDoorTile });
  }

  const walkable = walkableTiles(exterior);
  const occupied = new Set();
  for (const object of drawnObjects.filter((row) => zoneMap[row.zoneId] === "exterior")) {
    const zoneId = object.zoneId;
    const spots = exterior.spots[zoneId];
    const standing = new Set(spots.map(tileKey));
    const tiles = exterior.zones[zoneId].rects.flatMap(rectTiles)
      .filter((tile) => walkable.has(tileKey(tile)) && !occupied.has(tileKey(tile)));
    const tile = tiles.find((candidate) => !standing.has(tileKey(candidate)))
      || (spots.length > 6 ? tiles.find((candidate) => standing.has(tileKey(candidate))) : null);
    if (!tile) throw new Error(`LAYOUT_NO_OBJECT_TILE: ${object.id}`);
    occupied.add(tileKey(tile));
    exterior.spots[zoneId] = spots.filter((spot) => tileKey(spot) !== tileKey(tile));
    exterior.objects[object.id] = { zoneId, at: tile.map((value) => value + 0.2) };
  }
  // Carried objects reserve no floor tile or furniture. Keep their identity
  // so the observer can draw them at a live drop spot after a settled release.
  for (const object of objects.filter((row) => row.holderCharacterId || row.initialHolderActorId)) {
    const zoneId = object.zoneId || topology.defaultZoneId;
    maps[zoneMap[zoneId]].objects[object.id] = { zoneId };
  }
  return { layoutVersion: 2, clockLabel, maps, zoneMap, portals };
}
