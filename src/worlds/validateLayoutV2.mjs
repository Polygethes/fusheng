// Layout v2 checks (spec §8): V9 for maps, portals and objects, and V13 for
// town maps. Everything is decided with layoutGeometry, the same tile rules
// the observer walks by.
import { walkableTiles, findPath, inRect, rectsOverlap, rectsTouch, rectTiles, tileKey } from "./layoutGeometry.mjs";

const list = (value) => (Array.isArray(value) ? value : []);
const MAX_EXTERIOR = [128, 96], MAX_INTERIOR = [24, 16], MIN_TOWN_SPOTS = 6;

export function validateLayoutV2(pack, add) {
  const layout = pack.layout || {};
  const topology = pack.stage?.topology || {};
  const zoneIds = Object.keys(topology.zones || {});
  const edges = list(topology.edges);
  const maps = layout.maps || {};
  const town = pack.meta?.scale === "town";
  const mapOf = (zoneId) => layout.zoneMap?.[zoneId];
  const rectsOf = (zoneId) => list(maps[mapOf(zoneId)]?.zones?.[zoneId]?.rects);
  const walkable = Object.fromEntries(Object.entries(maps).map(([id, map]) => [id, walkableTiles(map)]));
  const spotsOf = (zoneId) => list(maps[mapOf(zoneId)]?.spots?.[zoneId]);

  if (!maps.exterior) add("V9", "LAYOUT_EXTERIOR_MISSING", "layout.maps.exterior", "v2 布局缺少外景图");

  // Every zone lives on exactly one map, has a rect there and somewhere to stand.
  for (const zoneId of zoneIds) {
    const mapId = mapOf(zoneId);
    const holders = Object.entries(maps).filter(([, map]) => map.zones?.[zoneId]).map(([id]) => id);
    if (!mapId || !maps[mapId]) { add("V9", "LAYOUT_ZONE_UNMAPPED", `layout.zoneMap.${zoneId}`, `区 ${zoneId} 没有指定所在的图`); continue; }
    if (holders.length !== 1 || holders[0] !== mapId) add("V9", "LAYOUT_ZONE_MAP_MISMATCH", `layout.zoneMap.${zoneId}`, `区 ${zoneId} 应只出现在 ${mapId} 上（现在：${holders.join("、") || "无"}）`);
    if (!rectsOf(zoneId).length) { add("V9", "LAYOUT_ZONE_MISSING", `layout.maps.${mapId}.zones.${zoneId}`, `布局缺少区 ${zoneId}`); continue; }
    const standing = spotsOf(zoneId).filter((spot) => rectsOf(zoneId).some((rect) => inRect(spot, rect)) && walkable[mapId].has(tileKey(spot)));
    if (!standing.length) add("V9", "LAYOUT_ZONE_WITHOUT_SPOT", `layout.maps.${mapId}.spots.${zoneId}`, `区 ${zoneId} 没有可站位置`);
    else if (town && new Set(standing.map(tileKey)).size < MIN_TOWN_SPOTS) add("V13", "TOWN_ZONE_FEW_SPOTS", `layout.maps.${mapId}.spots.${zoneId}`, `区 ${zoneId} 只有 ${standing.length} 个可站位置，小镇至少 ${MIN_TOWN_SPOTS} 个`);
  }

  // Every topology edge is walkable on the map: touching rects or a door on one map, a portal across maps.
  const portalFor = (a, b) => list(layout.portals).find((row) => (row.interiorZoneId === a && row.exteriorZoneId === b) || (row.interiorZoneId === b && row.exteriorZoneId === a));
  for (const edge of edges) {
    const [ma, mb] = [mapOf(edge.from), mapOf(edge.to)];
    if (!maps[ma] || !maps[mb]) continue;
    if (ma === mb) {
      const map = maps[ma];
      const linked = rectsOf(edge.from).some((a) => rectsOf(edge.to).some((b) => rectsTouch(a, b)))
        || list(map.doors).some((door) => door.between?.includes(edge.from) && door.between?.includes(edge.to));
      if (!linked) { add("V9", "LAYOUT_DOOR_MISSING", `layout.maps.${ma}.doors`, `布局缺少 ${edge.from}↔${edge.to} 的通道`); continue; }
      const [from, to] = [spotsOf(edge.from)[0], spotsOf(edge.to)[0]];
      if (town && from && to && !findPath(walkable[ma], from, to)) add("V13", "TOWN_EDGE_NOT_WALKABLE", `layout.maps.${ma}`, `${edge.from} 走不到 ${edge.to}`);
      continue;
    }
    const portal = portalFor(edge.from, edge.to);
    if (!portal) { add("V9", "LAYOUT_PORTAL_MISSING", "layout.portals", `${edge.from}↔${edge.to} 跨图却没有门`); continue; }
    const sides = [[portal.exteriorZoneId, "exterior", portal.exteriorDoorTile], [portal.interiorZoneId, portal.interiorMapId, portal.interiorDoorTile]];
    for (const [zoneId, mapId, tile] of sides) {
      if (mapOf(zoneId) !== mapId) { add("V9", "LAYOUT_PORTAL_MAP_MISMATCH", "layout.portals", `${portal.siteId} 的门所在的图与区 ${zoneId} 不符`); continue; }
      const spot = spotsOf(zoneId)[0];
      if (!tile || !walkable[mapId].has(tileKey(tile))) add("V9", "LAYOUT_PORTAL_TILE_BLOCKED", "layout.portals", `${portal.siteId} 在 ${mapId} 的门不在可走的格子上`);
      else if (town && spot && !findPath(walkable[mapId], spot, tile)) add("V13", "TOWN_PORTAL_UNREACHABLE", "layout.portals", `${zoneId} 走不到 ${portal.siteId} 的门`);
    }
    // The street door sits right next to its street (spec §8.2).
    const street = rectsOf(portal.exteriorZoneId);
    const [dx, dy] = portal.exteriorDoorTile || [];
    if (town && !street.some((rect) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ox, oy]) => inRect([dx + ox, dy + oy], rect)))) {
      add("V13", "TOWN_PORTAL_DETACHED", "layout.portals", `${portal.siteId} 的门没有挨着 ${portal.exteriorZoneId}`);
    }
  }

  // Drawn objects are on the map of their zone, inside it.
  const objects = new Map(list(pack.objects).map((row) => [row.id, row]));
  for (const [mapId, map] of Object.entries(maps)) {
    for (const [id, drawn] of Object.entries(map.objects || {})) {
      const object = objects.get(id);
      if (!object) { add("V9", "LAYOUT_OBJECT_UNKNOWN", `layout.maps.${mapId}.objects.${id}`, `布局画了不存在的物件 ${id}`); continue; }
      const zoneId = object.zoneId || topology.defaultZoneId;
      if (drawn.zoneId !== zoneId || mapOf(zoneId) !== mapId) add("V9", "LAYOUT_OBJECT_ZONE_MISMATCH", `layout.maps.${mapId}.objects.${id}`, `${object.label} 画在 ${mapId}/${drawn.zoneId}，世界里在 ${zoneId}`);
      else if (drawn.at && !rectsOf(zoneId).some((rect) => inRect(drawn.at, rect))) add("V9", "LAYOUT_OBJECT_OUTSIDE_ZONE", `layout.maps.${mapId}.objects.${id}`, `${object.label} 的位置不在所属区内`);
    }
  }
  if (!town) return;

  // V13 — map size and nothing built on top of anything else.
  for (const [mapId, map] of Object.entries(maps)) {
    const [maxCols, maxRows] = mapId === "exterior" ? MAX_EXTERIOR : MAX_INTERIOR;
    if (!(map.grid?.cols <= maxCols && map.grid?.rows <= maxRows)) add("V13", "TOWN_MAP_TOO_LARGE", `layout.maps.${mapId}.grid`, `${mapId} 尺寸 ${map.grid?.cols}×${map.grid?.rows} 超过 ${maxCols}×${maxRows}`);
    const zoneRects = Object.entries(map.zones || {}).flatMap(([zoneId, zone]) => list(zone.rects).map((rect) => ({ zoneId, rect })));
    const outOfBounds = zoneRects.find(({ rect }) => rect[0] < 0 || rect[1] < 0 || rect[0] + rect[2] > map.grid.cols || rect[1] + rect[3] > map.grid.rows);
    if (outOfBounds) add("V13", "TOWN_ZONE_OUT_OF_MAP", `layout.maps.${mapId}.zones.${outOfBounds.zoneId}`, `区 ${outOfBounds.zoneId} 超出了 ${mapId}`);
    for (let i = 0; i < zoneRects.length; i += 1) for (let j = i + 1; j < zoneRects.length; j += 1) {
      if (zoneRects[i].zoneId !== zoneRects[j].zoneId && rectsOverlap(zoneRects[i].rect, zoneRects[j].rect)) {
        add("V13", "TOWN_ZONES_OVERLAP", `layout.maps.${mapId}.zones`, `${zoneRects[i].zoneId} 与 ${zoneRects[j].zoneId} 重叠`);
      }
    }
    const lots = list(map.roofs);
    for (let i = 0; i < lots.length; i += 1) {
      for (let j = i + 1; j < lots.length; j += 1) if (rectsOverlap(lots[i].rect, lots[j].rect)) add("V13", "TOWN_LOTS_OVERLAP", `layout.maps.${mapId}.roofs`, `${lots[i].siteId} 与 ${lots[j].siteId} 的房子重叠`);
      const hit = zoneRects.find(({ rect }) => rectsOverlap(rect, lots[i].rect));
      if (hit) add("V13", "TOWN_LOT_ON_ZONE", `layout.maps.${mapId}.roofs`, `${lots[i].siteId} 的房子压在 ${hit.zoneId} 上`);
    }
    const water = list(map.floors).filter((row) => row.material === "water").map((row) => row.rect);
    for (const { zoneId, rect } of zoneRects) {
      const wet = rectTiles(rect).filter((tile) => water.some((w) => inRect(tile, w)));
      if (wet.length === rectTiles(rect).length) add("V13", "TOWN_ZONE_UNDER_WATER", `layout.maps.${mapId}.zones.${zoneId}`, `区 ${zoneId} 整块在水里`);
    }
  }
}
