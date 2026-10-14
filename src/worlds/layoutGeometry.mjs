// Tile geometry shared by the world validator (server) and the pixel observer
// (browser). One definition of "walkable" keeps the checker and the stage
// from disagreeing about where people can stand and walk.
export const tileKey = ([x, y]) => `${x},${y}`;

export function rectTiles([c0, r0, w, h]) {
  const out = [];
  for (let x = c0; x < c0 + w; x += 1) for (let y = r0; y < r0 + h; y += 1) out.push([x, y]);
  return out;
}

export const inRect = ([x, y], [c0, r0, w, h]) => x >= c0 && x < c0 + w && y >= r0 && y < r0 + h;
export const rectsOverlap = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];

// Which edge of a building's rect its door is on, found by tile, not by id.
export function doorOnEdge(rect, doors) {
  const [c, r, w, h] = rect;
  for (const door of doors || []) for (const tile of door.tiles || []) {
    if (!inRect(tile, rect)) continue;
    const [x, y] = tile;
    const edge = y === r + h - 1 ? "bottom" : y === r ? "top" : x === c ? "left" : x === c + w - 1 ? "right" : null;
    if (edge) return { edge, tile };
  }
  return null;
}

/** Two rects share part of an edge (a corner alone does not count). */
export function rectsTouch(a, b) {
  const xs = a[0] < b[0] + b[2] && b[0] < a[0] + a[2];
  const ys = a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
  return (ys && (a[0] + a[2] === b[0] || b[0] + b[2] === a[0])) || (xs && (a[1] + a[3] === b[1] || b[1] + b[3] === a[1]));
}

/** Zone rects and door tiles, minus walls, water and blocked ranges; doors always stay walkable. */
export function walkableTiles(map = {}) {
  const walkable = new Set();
  const doorTiles = new Set((map.doors || []).flatMap((door) => (door.tiles || []).map(tileKey)));
  for (const zone of Object.values(map.zones || {})) for (const rect of zone.rects || []) for (const tile of rectTiles(rect)) walkable.add(tileKey(tile));
  for (const key of doorTiles) walkable.add(key);
  const remove = (c0, r0, c1, r1) => {
    for (let x = c0; x <= c1; x += 1) for (let y = r0; y <= r1; y += 1) if (!doorTiles.has(`${x},${y}`)) walkable.delete(`${x},${y}`);
  };
  for (const wall of map.walls || []) { const [c0, r0, w, h] = wall.rect; remove(c0, r0, c0 + w - 1, r0 + h - 1); }
  for (const floor of map.floors || []) if (floor.material === "water") { const [c0, r0, w, h] = floor.rect; remove(c0, r0, c0 + w - 1, r0 + h - 1); }
  for (const [c0, r0, c1, r1] of map.blocked || []) remove(c0, r0, c1, r1);
  return walkable;
}

/** Shortest 4-way path over walkable tiles; the start tile is not included. null when unreachable. */
export function findPath(walkable, from, to) {
  if (!walkable.has(tileKey(to))) return null;
  if (tileKey(from) === tileKey(to)) return [];
  const prev = new Map([[tileKey(from), null]]);
  const queue = [from];
  for (let head = 0; head < queue.length; head += 1) {
    const cur = queue[head];
    if (cur[0] === to[0] && cur[1] === to[1]) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = [cur[0] + dx, cur[1] + dy];
      if (!walkable.has(tileKey(next)) || prev.has(tileKey(next))) continue;
      prev.set(tileKey(next), cur);
      queue.push(next);
    }
  }
  if (!prev.has(tileKey(to))) return null;
  const out = [];
  for (let cur = to; cur && tileKey(cur) !== tileKey(from); cur = prev.get(tileKey(cur))) out.unshift(cur);
  return out;
}
