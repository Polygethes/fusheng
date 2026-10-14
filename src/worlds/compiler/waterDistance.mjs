// Tiles from open water for each zone of a compiled town: exterior zones by
// the nearest water tile (Chebyshev distance), a building's rooms one more than
// the street outside its door. Towns with no water on the map get nothing.
export function waterDistances(layout = {}) {
  const exterior = layout.maps?.exterior;
  if (!exterior) return {};
  const water = [];
  for (const floor of exterior.floors || []) if (floor.material === "water") {
    const [x, y, w, h] = floor.rect; for (let i = 0; i < w; i += 1) for (let j = 0; j < h; j += 1) water.push([x + i, y + j]);
  }
  if (!water.length) return {};
  const nearest = (tx, ty) => Math.min(...water.map(([x, y]) => Math.max(Math.abs(x - tx), Math.abs(y - ty))));
  const out = {};
  for (const [zoneId, zone] of Object.entries(exterior.zones || {})) {
    let best = Infinity;
    for (const [x, y, w, h] of zone.rects || []) for (let i = 0; i < w; i += 1) for (let j = 0; j < h; j += 1) best = Math.min(best, nearest(x + i, y + j));
    if (Number.isFinite(best)) out[zoneId] = best;
  }
  for (const portal of layout.portals || []) {
    const outside = out[portal.exteriorZoneId];
    if (!Number.isFinite(outside)) continue;
    const map = layout.maps?.[portal.interiorMapId];
    for (const zoneId of Object.keys(map?.zones || {})) out[zoneId] = outside + 1;
  }
  return out;
}
