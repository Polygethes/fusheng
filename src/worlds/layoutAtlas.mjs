// The observer draws every map of a layout on one canvas: the exterior at the
// origin, each interior packed below it. Coordinates are shifted, never
// re-scaled, so tiles.js, objects.js and the director work unchanged; the
// camera shows one map's rectangle at a time. A v1 layout is its own atlas.
import { inRect, findPath } from "./layoutGeometry.mjs";

export const EXTERIOR = "exterior";
const GAP = 2;

export function flattenLayout(layout) {
  if (!layout || layout.layoutVersion !== 2) {
    const zones = Object.keys(layout?.zones || {});
    return { layout, version: 1, maps: { [EXTERIOR]: { rect: [0, 0, layout?.grid?.cols || 0, layout?.grid?.rows || 0], label: "" } },
      mapOfZone: Object.fromEntries(zones.map((id) => [id, EXTERIOR])), portals: [] };
  }
  const exterior = layout.maps[EXTERIOR];
  const width = exterior.grid.cols;
  const origins = { [EXTERIOR]: [0, 0] };
  let x = 0, y = exterior.grid.rows + GAP, rowHeight = 0;
  for (const id of Object.keys(layout.maps).filter((key) => key !== EXTERIOR).sort()) {
    const { cols, rows } = layout.maps[id].grid;
    if (x > 0 && x + cols > width) { x = 0; y += rowHeight + GAP; rowHeight = 0; }
    origins[id] = [x, y];
    x += cols + GAP;
    rowHeight = Math.max(rowHeight, rows);
  }
  const ids = Object.keys(origins);
  const out = {
    grid: { cols: Math.max(...ids.map((id) => origins[id][0] + layout.maps[id].grid.cols)), rows: Math.max(...ids.map((id) => origins[id][1] + layout.maps[id].grid.rows)), tile: exterior.grid.tile || 16 },
    theme: exterior.theme, clockLabel: layout.clockLabel || exterior.clockLabel || "", dayCycle: true,
    zones: {}, floors: [], walls: [], doors: [], props: [], objects: {}, lights: [], spots: {}, blocked: [], roofs: [], ambient: {},
  };
  const maps = {};
  for (const id of ids) {
    const map = layout.maps[id];
    const [ox, oy] = origins[id];
    const rect = ([c, r, w, h]) => [c + ox, r + oy, w, h];
    const point = ([a, b, ...rest]) => [a + ox, b + oy, ...rest];
    maps[id] = { rect: [ox, oy, map.grid.cols, map.grid.rows], label: map.label || "", siteId: map.siteId || null };
    for (const [zoneId, zone] of Object.entries(map.zones || {})) out.zones[zoneId] = { ...zone, rects: (zone.rects || []).map(rect) };
    for (const row of map.floors || []) out.floors.push({ ...row, rect: rect(row.rect) });
    for (const row of map.walls || []) out.walls.push({ ...row, rect: rect(row.rect), ...(row.posts ? { posts: row.posts.map((p) => p + ox) } : {}) });
    for (const row of map.doors || []) out.doors.push({ ...row, tiles: (row.tiles || []).map(point) });
    for (const row of map.props || []) out.props.push({ ...row, at: point(row.at) });
    for (const [objectId, spec] of Object.entries(map.objects || {})) out.objects[objectId] = { ...spec, ...(spec.at ? { at: point(spec.at) } : {}) };
    for (const row of map.lights || []) out.lights.push({ ...row, at: point(row.at) });
    for (const [zoneId, spots] of Object.entries(map.spots || {})) out.spots[zoneId] = spots.map(point);
    for (const [c0, r0, c1, r1] of map.blocked || []) out.blocked.push([c0 + ox, r0 + oy, c1 + ox, r1 + oy]);
    for (const row of map.roofs || []) out.roofs.push({ ...row, rect: rect(row.rect) });
    for (const [kind, rects] of Object.entries(map.ambient || {})) {
      if (Array.isArray(rects)) out.ambient[kind] = [...(out.ambient[kind] || []), ...rects.map(rect)];
      else if (id === EXTERIOR) out.ambient[kind] = rects;
    }
  }
  const at = (mapId, tile) => [tile[0] + origins[mapId][0], tile[1] + origins[mapId][1]];
  const portals = (layout.portals || []).map((row) => ({
    siteId: row.siteId,
    exterior: { mapId: EXTERIOR, zoneId: row.exteriorZoneId, tile: at(EXTERIOR, row.exteriorDoorTile) },
    interior: { mapId: row.interiorMapId, zoneId: row.interiorZoneId, tile: at(row.interiorMapId, row.interiorDoorTile) },
  }));
  return { layout: out, version: 2, maps, mapOfZone: { ...layout.zoneMap }, portals };
}

export function mapAtTile(atlas, tile) {
  return Object.entries(atlas.maps).find(([, map]) => inRect(tile, map.rect))?.[0] || null;
}

/**
 * Tiles to walk from one atlas tile to another. Crossing between maps goes
 * through a portal: walk to this side's door, then `{ jump: true }` marks the
 * first tile on the other map. null when no route exists.
 */
export function routeTiles(atlas, walkable, from, to) {
  const fromMap = mapAtTile(atlas, from), toMap = mapAtTile(atlas, to);
  // Every route is a list of { tile, jump? } steps, on one map or across several.
  if (fromMap === toMap) return findPath(walkable, from, to)?.map((tile) => ({ tile })) ?? null;
  const hops = [];
  let here = from, map = fromMap;
  const side = (portal, mapId) => (portal.exterior.mapId === mapId ? portal.exterior : portal.interior.mapId === mapId ? portal.interior : null);
  // At most two portals: interior → exterior → another interior.
  for (let guard = 0; guard < 3 && map !== toMap; guard += 1) {
    const portal = atlas.portals.find((row) => side(row, map) && (side(row, toMap) || map !== EXTERIOR))
      || atlas.portals.find((row) => side(row, map));
    if (!portal) return null;
    const exit = side(portal, map);
    const enter = exit === portal.exterior ? portal.interior : portal.exterior;
    const walk = findPath(walkable, here, exit.tile);
    if (!walk) return null;
    hops.push(...walk.map((tile) => ({ tile })), { tile: enter.tile, jump: true });
    here = enter.tile; map = enter.mapId;
  }
  if (map !== toMap) return null;
  const last = findPath(walkable, here, to);
  if (!last) return null;
  return [...hops, ...last.map((tile) => ({ tile }))];
}
