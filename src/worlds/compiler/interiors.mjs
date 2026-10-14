// Interior layout data shared with the town compiler.
import { expandRooms, expandLinks } from "./rooms.mjs";
import { rectTiles, tileKey, inRect, walkableTiles, findPath } from "../layoutGeometry.mjs";

const MIN_WIDTH = { bedroom: 3 };
const minWidth = (room) => (room.entry ? 8 : MIN_WIDTH[room.baseSuffix] || 4);

// Rooms as a tree hung from the entry room: each room's children sit in the
// row above it, inside its span, so every link is a door in the wall between.
export function layoutRoomTree(rooms, links, { mirror = false } = {}) {
  const entry = rooms.find((room) => room.entry) || rooms[0];
  const children = new Map(rooms.map((room) => [room.suffix, []]));
  const depth = new Map([[entry.suffix, 0]]);
  const queue = [entry.suffix];
  while (queue.length) {
    const cur = queue.shift();
    for (const [a, b] of links) {
      const next = a === cur ? b : b === cur ? a : null;
      if (next && !depth.has(next)) { depth.set(next, depth.get(cur) + 1); children.get(cur).push(next); queue.push(next); }
    }
  }
  for (const room of rooms) if (!depth.has(room.suffix)) { depth.set(room.suffix, 1); children.get(entry.suffix).push(room.suffix); }
  if (mirror) for (const list of children.values()) list.reverse();
  const bySuffix = new Map(rooms.map((room) => [room.suffix, room]));
  const width = new Map();
  const measure = (suffix) => {
    const kids = children.get(suffix);
    const kidsWidth = kids.reduce((sum, kid) => sum + measure(kid), 0) + Math.max(0, kids.length - 1);
    const w = Math.max(minWidth(bySuffix.get(suffix)), kidsWidth);
    width.set(suffix, w);
    return w;
  };
  const inner = measure(entry.suffix);
  const levels = Math.max(...depth.values());
  const upperH = levels <= 1 ? 4 : 3;
  const entryH = 4;
  const rows = 2 + levels * (upperH + 1) + entryH + 1;
  const cols = inner + 2;
  const rects = new Map();
  const place = (suffix, x, w) => {
    const d = depth.get(suffix);
    const y = d === 0 ? rows - 1 - entryH : 2 + (levels - d) * (upperH + 1);
    const h = d === 0 ? entryH : upperH;
    rects.set(suffix, [x, y, w, h]);
    let cx = x;
    const kids = children.get(suffix);
    kids.forEach((kid, i) => {
      // The last child takes whatever is left of the parent's span.
      const kw = i === kids.length - 1 ? x + w - cx : width.get(kid);
      place(kid, cx, kw);
      cx += kw + 1;
    });
  };
  place(entry.suffix, 1, inner);
  return { cols, rows, rects, depth, children, entry: entry.suffix, levels, upperH };
}

// Furniture for fixed catalog objects; the object is drawn by this prop.
const FIXTURE_PROPS = Object.freeze({
  stove: { kind: "stove", w: 2, h: 1, fire: true }, large_stove: { kind: "stove", w: 2, h: 1, fire: true }, furnace: { kind: "stove", w: 2, h: 1, fire: true },
  water_jar: { kind: "water-jar", w: 1, h: 1 }, counter: { kind: "counter", w: 2, h: 1 }, medicine_cabinet: { kind: "cabinet", w: 1, h: 1, label: "药柜" },
  bed: { kind: "sickbed", w: 1, h: 2 }, lectern: { kind: "desk", w: 1, h: 1 }, bookshelf: { kind: "shelf", w: 2, h: 1 }, goods_shelf: { kind: "shelf", w: 2, h: 1 },
  grain_bin: { kind: "wine-jars", w: 1, h: 1 }, millstone: { kind: "chopping-block", w: 1, h: 1 }, anvil: { kind: "chopping-block", w: 1, h: 1 },
  mail_box: { kind: "cabinet", w: 1, h: 1 }, incense_burner: { kind: "shrine", w: 2, h: 1 },
});
// A little furniture by room kind so rooms read at a glance (only where it fits).
const ROOM_FURNITURE = Object.freeze({
  hall: [{ kind: "table", w: 2, h: 1 }, { kind: "bench", w: 2, h: 1 }], main_hall: [{ kind: "rug", w: 2, h: 1, walk: true }],
  bedroom: [{ kind: "bed", w: 1, h: 2 }], room_1: [{ kind: "bed", w: 1, h: 2 }], ward: [{ kind: "stool", w: 1, h: 1 }],
  classroom: [{ kind: "desk", w: 1, h: 1 }, { kind: "desk", w: 1, h: 1 }], study: [{ kind: "desk", w: 1, h: 1 }],
  barn: [{ kind: "woodpile", w: 1.5, h: 1 }], storage: [{ kind: "wine-jars", w: 1, h: 1 }], side_room: [{ kind: "bench", w: 2, h: 1 }],
});

export function interiorVariant(templateId) {
  return templateId.endsWith("_b") ? "mirror" : "plain";
}

const EARTH_ROOMS = new Set(["kitchen", "forge", "storage", "barn", "mill_room"]);
const HALL_ROOMS = new Set(["hall", "main_hall", "lobby", "front", "shop", "classroom"]);
const neighbours = ([x, y]) => [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];

export function buildInterior({ site, def, residentCount, objects = [], variant, seed }) {
  const rooms = expandRooms(def, residentCount);
  const links = expandLinks(def, rooms);
  const tree = layoutRoomTree(rooms, links, { mirror: variant === "mirror" });
  const zoneOf = (suffix) => `${site.id}__${suffix}`;
  const entryZoneId = zoneOf(tree.entry);
  const entryRect = tree.rects.get(tree.entry);
  const frontDoorTile = [entryRect[0] + Math.floor(entryRect[2] / 2), tree.rows - 1];
  const map = {
    label: site.name, siteId: site.id, grid: { cols: tree.cols, rows: tree.rows, tile: 16 }, theme: "dusk", ambient: {},
    zones: {}, floors: [], walls: [], doors: [], props: [], objects: {}, blocked: [], spots: {}, lights: [],
  };
  for (const room of rooms) {
    const rect = tree.rects.get(room.suffix);
    map.zones[zoneOf(room.suffix)] = { label: room.label, rects: [rect] };
    map.floors.push({ rect, material: EARTH_ROOMS.has(room.baseSuffix) ? "earth" : "wood" });
  }

  // The supplied room tree leaves wall space between every pair of rows.
  const roomRects = [...tree.rects.values()];
  const posts = [...new Set([0, tree.cols - 1, ...roomRects.flatMap(([x, , w]) => [x - 1, x + w])])].sort((a, b) => a - b);
  map.walls.push(
    { rect: [0, 0, tree.cols, 2], style: "interior-back", posts },
    { rect: [0, 2, 1, tree.rows - 2], style: "top", edge: "r" },
    { rect: [tree.cols - 1, 2, 1, tree.rows - 2], style: "top", edge: "l" },
    { rect: [1, tree.rows - 1, tree.cols - 2, 1], style: "top", edge: "t" },
  );

  const doorOpenings = [];
  for (const [a, b] of links) {
    const child = tree.depth.get(a) > tree.depth.get(b) ? a : b;
    const [x, y, w, h] = tree.rects.get(child);
    const doorTile = [x + Math.floor(w / 2), y + h];
    doorOpenings.push({ between: [zoneOf(a), zoneOf(b)], tile: doorTile, childRoom: child });
    map.doors.push({ between: [zoneOf(a), zoneOf(b)], tiles: [doorTile], style: "opening" });
    const childBase = rooms.find((r) => r.suffix === child)?.baseSuffix;
    map.floors.push({ rect: [doorTile[0], doorTile[1], 1, 1], material: EARTH_ROOMS.has(childBase) ? "earth" : "wood" });
  }
  map.doors.push({ between: [entryZoneId, null], tiles: [frontDoorTile], style: "door", front: true });

  const openingTiles = new Set(doorOpenings.map((o) => tileKey(o.tile)));
  const isRoomOrOpening = (x, y) => openingTiles.has(`${x},${y}`) || roomRects.some((rect) => inRect([x, y], rect));

  // Partition walls and blanks:
  // Identify remaining unused cells in [1..cols-2] x [2..rows-2]
  // Group into connected components or rects
  const unused = new Set();
  for (let y = 2; y < tree.rows - 1; y += 1) {
    for (let x = 1; x < tree.cols - 1; x += 1) {
      if (!isRoomOrOpening(x, y)) unused.add(`${x},${y}`);
    }
  }

  // Find maximal rectangles or runs in unused cells:
  while (unused.size > 0) {
    // Pick the top-left available unused cell
    let minX = Infinity, minY = Infinity;
    for (const key of unused) {
      const [ux, uy] = key.split(",").map(Number);
      if (uy < minY || (uy === minY && ux < minX)) {
        minX = ux; minY = uy;
      }
    }
    // Find width of this continuous unused segment along minY
    let w = 0;
    while (unused.has(`${minX + w},${minY}`)) w += 1;
    // Find height: see how many rows below can share the exact same width w
    let h = 1;
    while (true) {
      const nextY = minY + h;
      let fullRow = true;
      for (let i = 0; i < w; i += 1) {
        if (!unused.has(`${minX + i},${nextY}`)) {
          fullRow = false;
          break;
        }
      }
      if (!fullRow) break;
      h += 1;
    }

    // Remove rect from unused
    for (let dy = 0; dy < h; dy += 1) {
      for (let dx = 0; dx < w; dx += 1) {
        unused.delete(`${minX + dx},${minY + dy}`);
      }
    }

    // Determine style:
    // 1. 上下两排房间之间 1 行高的缝：一条 w×1 的 partition（横梁）
    // 2. 同一排相邻房间之间 1 列宽的缝：一条 1×h 的 partition。h > w 时 tiles.js 会画成竖柱
    // 3. 其余空白（两个方向都大于 1 格的块）：用 top 样式（实心墙顶）
    if (h === 1 && w > 1) {
      map.walls.push({ rect: [minX, minY, w, 1], style: "partition" });
    } else if (w === 1 && h >= 1) {
      map.walls.push({ rect: [minX, minY, 1, h], style: "partition" });
    } else {
      map.walls.push({ rect: [minX, minY, w, h], style: "top" });
    }
  }

  // Door approaches stay clear. Each candidate must also leave the room's
  // remaining floor connected, so furniture cannot cut off a doorway or spot.
  const furnitureTiles = new Set();
  const objectTiles = new Set();
  for (const room of rooms) {
    const zoneId = zoneOf(room.suffix);
    const rect = tree.rects.get(room.suffix);
    const [rx, ry, rw, rh] = rect;
    const tiles = rectTiles(rect).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    const roomDoors = map.doors.filter((door) => door.between.includes(zoneId));
    const approaches = new Set(roomDoors.flatMap((door) => door.tiles.flatMap(neighbours).filter((tile) => inRect(tile, rect)).map(tileKey)));
    const furniture = [];
    const roomObjects = objects.filter((object) => {
      const roomSuffix = object.room || def.objects?.find((row) => row.slug === object.slug)?.room;
      return roomSuffix ? rooms.find((row) => row.baseSuffix === roomSuffix)?.suffix === room.suffix : room.entry;
    });
    const hasSixSpots = (extraTiles) => tiles.filter((tile) => !furnitureTiles.has(tileKey(tile)) && !objectTiles.has(tileKey(tile)) && !extraTiles.has(tileKey(tile))).length >= 6;
    const place = (spec, { furniture: isFurniture = false, required = false } = {}) => {
      const w = Math.ceil(spec.w || 1), h = Math.ceil(spec.h || 1);
      for (const [x, y] of tiles) {
        if (x + w > rx + rw || y + h > ry + rh) continue;
        const footprint = rectTiles([x, y, w, h]);
        const keys = new Set(footprint.map(tileKey));
        if (footprint.some((tile) => approaches.has(tileKey(tile)) || furnitureTiles.has(tileKey(tile)) || objectTiles.has(tileKey(tile)))) continue;
        if (isFurniture && furniture.some(([fx, fy, fw, fh]) => x < fx + fw + 1 && fx - 1 < x + w && y < fy + fh + 1 && fy - 1 < y + h)) continue;
        if (!hasSixSpots(keys)) continue;
        if (isFurniture && !spec.walk) {
          const free = new Set(tiles.filter((tile) => !keys.has(tileKey(tile)) && !map.blocked.some(([x0, y0, x1, y1]) => tile[0] >= x0 && tile[0] <= x1 && tile[1] >= y0 && tile[1] <= y1)).map(tileKey));
          const first = tiles.find((tile) => free.has(tileKey(tile)));
          if (!first || tiles.some((tile) => free.has(tileKey(tile)) && !findPath(free, first, tile))) continue;
        }
        if (isFurniture) {
          furniture.push([x, y, w, h]);
          for (const key of keys) furnitureTiles.add(key);
          map.props.push({ ...spec, at: [x, y], zoneId });
          if (!spec.walk) map.blocked.push([x, y, x + w - 1, y + h - 1]);
          if (spec.fire) map.lights.push({ at: [x + spec.w / 2, y + 0.5], r: 34, color: "#ff8a30", flicker: true });
        } else for (const key of keys) objectTiles.add(key);
        return [x, y];
      }
      if (required) throw new Error(`INTERIOR_NO_ROOM: ${site.id}/${room.suffix} cannot fit ${spec.kind || "object"}`);
      return null;
    };
    const fixed = roomObjects.filter((object) => object.slug && !object.portable);
    for (const object of fixed) {
      const spec = FIXTURE_PROPS[object.slug];
      if (!spec) throw new Error(`INTERIOR_UNKNOWN_FIXTURE: ${object.slug}`);
      const at = place(spec, { furniture: true, required: true });
      objectTiles.add(tileKey(at));
      map.objects[object.id] = { zoneId, at: at.map((n) => n + 0.2), drawer: "fixture" };
    }
    // Keep room furniture only if all remaining icons still fit afterwards.
    const icons = roomObjects.filter((object) => !fixed.includes(object));
    for (const spec of ROOM_FURNITURE[room.baseSuffix] || []) {
      const checkpoint = { props: map.props.length, blocked: map.blocked.length, furniture: furniture.length, tiles: new Set(furnitureTiles) };
      if (!place(spec, { furniture: true })) continue;
      const freeIcons = tiles.filter((tile) => !approaches.has(tileKey(tile)) && !furnitureTiles.has(tileKey(tile)) && !objectTiles.has(tileKey(tile))).length;
      const freeSpots = tiles.filter((tile) => !furnitureTiles.has(tileKey(tile)) && !objectTiles.has(tileKey(tile))).length;
      if (freeIcons < icons.length || freeSpots - icons.length < 6) {
        map.props.length = checkpoint.props; map.blocked.length = checkpoint.blocked; furniture.length = checkpoint.furniture;
        furnitureTiles.clear(); for (const key of checkpoint.tiles) furnitureTiles.add(key);
      }
    }
    for (const object of icons) {
      const at = place({ w: 1, h: 1 }, { required: true });
      map.objects[object.id] = { zoneId, at: at.map((n) => n + 0.2) };
    }
    if (HALL_ROOMS.has(room.baseSuffix)) map.lights.push({ at: [rx + rw / 2, ry + 0.5], r: 30, color: "#ffe0a8" });
  }

  const walkable = walkableTiles(map);
  const doorTiles = new Set(map.doors.flatMap((door) => door.tiles.map(tileKey)));
  for (const room of rooms) {
    const zoneId = zoneOf(room.suffix);
    const free = rectTiles(tree.rects.get(room.suffix))
      .filter((tile) => walkable.has(tileKey(tile)) && !furnitureTiles.has(tileKey(tile)) && !objectTiles.has(tileKey(tile)) && !doorTiles.has(tileKey(tile)))
      .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    const count = Math.min(8, free.length);
    if (count < 6) throw new Error(`INTERIOR_TOO_FEW_SPOTS: ${zoneId}`);
    map.spots[zoneId] = Array.from({ length: count }, (_, i) => free[Math.floor(i * (free.length - 1) / (count - 1))]);
  }
  return { mapId: `interior:${site.id}`, entryZoneId, frontDoorTile, map };
}
