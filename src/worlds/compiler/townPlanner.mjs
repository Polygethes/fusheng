// Deterministic exterior geometry. Rooms belong to separate interior maps.
import { createRng } from "./rng.mjs";
import { inRect, rectTiles, rectsOverlap, rectsTouch, tileKey, walkableTiles } from "../layoutGeometry.mjs";

const STREET = 2;
const PLAZA = [10, 8];
const SEGMENT = 10;
const BAND = 14;
const GAP = 1;
const DIRECTIONS = ["north", "east", "south", "west"];
const LAND_TYPES = { river: ["river_bank", "bridge", "pond"], forest: ["forest"], hills: ["hill", "array_eye"], fields: ["field"] };
const NUMERALS = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

function noRoom(label) {
  const error = new Error(`PLANNER_NO_ROOM: ${label}`);
  error.code = "PLANNER_NO_ROOM";
  throw error;
}

/** Buildings determine the tier; every random choice uses the supplied seed. */
export function planTown(blueprint, { catalog, seed = 1 }) {
  const rng = createRng(seed);
  const sites = blueprint.town?.sites || [];
  const buildings = sites.filter((site) => catalog[site.type]?.kind === "building");
  const outdoors = sites.filter((site) => catalog[site.type]?.kind === "outdoor");
  const [cols, rows] = buildings.length <= 6 ? [64, 48] : buildings.length <= 12 ? [96, 64] : [128, 96];
  const square = outdoors.find((site) => site.type === "square");
  const plazaZoneId = square ? `${square.id}__center` : "street_plaza";
  const plan = { plazaZoneId, streets: [], streetLinks: [], frontOf: {}, outdoorEntry: {}, lots: {} };
  const map = { grid: { cols, rows, tile: 16 }, theme: "day", zones: {}, floors: [{ rect: [0, 0, cols, rows], material: "grass" }], walls: [], doors: [], props: [], spots: {}, blocked: [], roofs: [], ambient: { birds: [] }, lights: [] };
  const occupied = new Set();
  const inside = ([x, y, w, h], bounds = [0, 0, cols, rows]) => w > 0 && h > 0 && x >= bounds[0] && y >= bounds[1] && x + w <= bounds[0] + bounds[2] && y + h <= bounds[1] + bounds[3];
  const canPlace = (rect, bounds) => inside(rect, bounds) && rectTiles(rect).every((tile) => !occupied.has(tileKey(tile)));
  const occupy = (rect, label) => {
    if (!canPlace(rect)) noRoom(label);
    for (const tile of rectTiles(rect)) occupied.add(tileKey(tile));
  };
  const addZone = (id, rect, material) => {
    occupy(rect, id);
    (map.zones[id] ||= { rects: [] }).rects.push(rect);
    map.floors.push({ rect, material });
  };
  const zoneIds = (site) => catalog[site.type].zones.map((zone) => `${site.id}__${zone.suffix}`);

  // Explicit directions take priority. Unspecified land takes the first free
  // side, then shares a side; each side reserves one 14-tile-deep band.
  const lands = Object.entries(LAND_TYPES).filter(([land, types]) => blueprint.town?.terrain?.[land] || outdoors.some((site) => types.includes(site.type)))
    .map(([land, types]) => ({ land, types, side: blueprint.town?.terrain?.[land] || null }));
  for (const land of lands) if (!land.side) land.side = DIRECTIONS.find((side) => !lands.some((other) => other.side === side)) || lands[0].side;
  const hasBand = (side) => lands.some((land) => land.side === side);
  const core = [hasBand("west") ? BAND : 0, hasBand("north") ? BAND : 0,
    cols - (hasBand("west") ? BAND : 0) - (hasBand("east") ? BAND : 0),
    rows - (hasBand("north") ? BAND : 0) - (hasBand("south") ? BAND : 0)];
  const [cx, cy, cw, ch] = core;
  const sideBand = {
    north: [0, 0, cols, BAND], south: [0, rows - BAND, cols, BAND],
    west: [0, cy, BAND, ch], east: [cols - BAND, cy, BAND, ch],
  };
  for (const side of DIRECTIONS) {
    const sharing = lands.filter((land) => land.side === side);
    const horizontal = side === "north" || side === "south";
    sharing.forEach((land, i) => {
      const rect = [...sideBand[side]];
      const axis = horizontal ? 0 : 1;
      const extent = horizontal ? 2 : 3;
      const from = Math.floor(rect[extent] * i / sharing.length);
      const to = Math.floor(rect[extent] * (i + 1) / sharing.length);
      rect[axis] += from;
      rect[extent] = to - from;
      land.rect = rect;
      map.floors.push({ rect, material: { river: "grass", forest: "meadow", hills: "hill", fields: "grass" }[land.land] });
    });
  }

  const px = cx + Math.floor((cw - PLAZA[0]) / 2) + Math.floor(rng() * 5) - 2;
  const py = cy + Math.floor((ch - PLAZA[1]) / 2) + Math.floor(rng() * 5) - 2;
  const plaza = [px, py, ...PLAZA];
  if (square) {
    addZone(plazaZoneId, [px, py, PLAZA[0] - 3, PLAZA[1]], "stone");
    addZone(`${square.id}__edge`, [px + PLAZA[0] - 3, py, 3, PLAZA[1]], "stone");
    plan.outdoorEntry[square.id] = plazaZoneId;
  } else addZone(plazaZoneId, plaza, "stone");
  const sx = px + Math.floor((PLAZA[0] - STREET) / 2);
  const sy = py + Math.floor((PLAZA[1] - STREET) / 2);
  const arms = [
    { side: "west", label: "西", rect: [cx, sy, px - cx, STREET], reverse: true },
    { side: "east", label: "东", rect: [px + PLAZA[0], sy, cx + cw - px - PLAZA[0], STREET] },
    { side: "north", label: "北", rect: [sx, cy, STREET, py - cy], reverse: true },
    { side: "south", label: "南", rect: [sx, py + PLAZA[1], STREET, cy + ch - py - PLAZA[1]] },
  ];

  // A town gate owns the last three street tiles, so it is reserved before
  // segmenting. This avoids a one/two-tile street segment with too few spots.
  const roads = outdoors.filter((site) => site.type === "road_out");
  const gateArms = [...arms].sort((a, b) => Number(hasBand(a.side)) - Number(hasBand(b.side)) || Math.max(b.rect[2], b.rect[3]) - Math.max(a.rect[2], a.rect[3]));
  roads.forEach((site, i) => {
    const arm = gateArms[i % gateArms.length];
    const horizontal = arm.side === "west" || arm.side === "east";
    const axis = horizontal ? 0 : 1;
    const extent = horizontal ? 2 : 3;
    if (arm.rect[extent] < 6) noRoom(site.id);
    const gate = [...arm.rect];
    gate[extent] = 3;
    if (!arm.reverse) gate[axis] += arm.rect[extent] - 3;
    else arm.rect[axis] += 3;
    arm.rect[extent] -= 3;
    addZone(zoneIds(site)[0], gate, "dirt");
    arm.gate = zoneIds(site)[0];
    arm.gateSite = site.id;
  });
  for (const arm of arms) {
    const horizontal = arm.side === "west" || arm.side === "east";
    const axis = horizontal ? 0 : 1;
    const extent = horizontal ? 2 : 3;
    const length = arm.rect[extent];
    const count = Math.ceil(length / SEGMENT);
    let used = 0;
    let previous = square && arm.side === "east" ? `${square.id}__edge` : plazaZoneId;
    arm.ids = [];
    for (let i = 0; i < count; i += 1) {
      const size = Math.ceil((length - used) / (count - i));
      const rect = [...arm.rect];
      rect[extent] = size;
      rect[axis] += arm.reverse ? length - used - size : used;
      const id = `street_${plan.streets.length + 1}`;
      addZone(id, rect, "dirt");
      plan.streets.push({ id, label: `${arm.label}街${NUMERALS[i] || i + 1}段`, length: 1 });
      plan.streetLinks.push([previous, id]);
      arm.ids.push(id);
      previous = id;
      used += size;
    }
    arm.endZone = arm.gate || arm.ids.at(-1);
    if (arm.gateSite) plan.outdoorEntry[arm.gateSite] = arm.ids.at(-1);
  }

  // Small town sites touch the plaza without covering its cross streets.
  // Search its perimeter before houses consume those near-plaza positions.
  for (const site of outdoors.filter((row) => ["well", "market", "street", "square"].includes(row.type) && row !== square)) {
    const [w, h] = site.type === "well" ? [3, 3] : site.type === "market" ? [6, 4] : [6, 4];
    const candidates = [];
    const westFirst = site.type === "well";
    const sides = westFirst ? ["west", "east", "north", "south"] : ["east", "west", "south", "north"];
    for (const side of sides) {
      if (side === "west" || side === "east") for (let y = py; y < py + PLAZA[1]; y += 1) candidates.push([side === "west" ? px - w : px + PLAZA[0], y, w, h]);
      else for (let x = px; x < px + PLAZA[0]; x += 1) candidates.push([x, side === "north" ? py - h : py + PLAZA[1], w, h]);
    }
    const rect = candidates.find((candidate) => canPlace(candidate, core));
    if (!rect) noRoom(site.id);
    const entry = Object.entries(map.zones).find(([, zone]) => zone.rects.some((other) => rectsTouch(rect, other)))?.[0];
    const ids = zoneIds(site);
    // Additional squares still have both catalog zones.
    if (ids.length === 2) {
      addZone(ids[0], [rect[0], rect[1], w - 3, h], "stone");
      addZone(ids[1], [rect[0] + w - 3, rect[1], 3, h], "stone");
    } else addZone(ids[0], rect, site.type === "well" ? "stone" : "dirt");
    plan.outdoorEntry[site.id] = entry;
  }

  const homes = buildings.filter((site) => ["home", "farmhouse"].includes(site.type));
  for (let i = homes.length - 1; i > 0; i -= 1) { const j = Math.floor(rng() * (i + 1)); [homes[i], homes[j]] = [homes[j], homes[i]]; }
  const ordered = [...buildings.filter((site) => !homes.includes(site)), ...homes];
  // west-north, west-south, east-north, east-south,
  // north-west, north-east, south-west, south-east.
  const lanes = [
    { side: "west", upper: true }, { side: "west", upper: false },
    { side: "east", upper: true }, { side: "east", upper: false },
    { side: "north", upper: true }, { side: "north", upper: false },
    { side: "south", upper: true }, { side: "south", upper: false },
  ].map((lane) => ({ ...lane, cursor: 0 }));
  let laneIndex = Math.floor(rng() * lanes.length);
  for (const site of ordered) {
    const [fw, fh] = catalog[site.type].footprint;
    let placed = false;
    for (let attempt = 0; attempt < lanes.length; attempt += 1) {
      const index = (laneIndex + attempt) % lanes.length;
      const lane = lanes[index];
      const horizontal = lane.side === "west" || lane.side === "east";
      const [w, h] = horizontal ? [fw, fh] : [fh, fw];
      const maximum = horizontal ? cw : ch;
      for (let offset = lane.cursor; offset < maximum; offset += 1) {
        const rect = horizontal
          ? [lane.side === "west" ? px - offset - w : px + PLAZA[0] + offset, lane.upper ? sy - h : sy + STREET, w, h]
          : [lane.upper ? sx - w : sx + STREET, lane.side === "north" ? py - offset - h : py + PLAZA[1] + offset, w, h];
        if (!inside(rect, core)) break;
        if (!canPlace(rect)) continue;
        const padded = [rect[0] - GAP, rect[1] - GAP, w + GAP * 2, h + GAP * 2];
        if (Object.values(plan.lots).some((lot) => rectsOverlap(padded, lot.rect))) continue;
        const doorTile = horizontal ? [rect[0] + Math.floor(w / 2), lane.upper ? sy - 1 : sy + STREET]
          : [lane.upper ? sx - 1 : sx + STREET, rect[1] + Math.floor(h / 2)];
        const outside = horizontal ? [doorTile[0], lane.upper ? sy : sy + STREET - 1] : [lane.upper ? sx : sx + STREET - 1, doorTile[1]];
        const street = plan.streets.find((row) => map.zones[row.id].rects.some((r) => inRect(outside, r)));
        if (!street) continue;
        occupy(rect, site.id);
        plan.lots[site.id] = { rect, doorTile };
        plan.frontOf[site.id] = street.id;
        map.roofs.push({ siteId: site.id, rect, label: site.name });
        map.doors.push({ between: [street.id, site.id], tiles: [doorTile], style: "door" });
        lane.cursor = offset + (horizontal ? w : h) + GAP;
        laneIndex = (index + 1) % lanes.length;
        placed = true;
        break;
      }
      if (placed) break;
    }
    if (!placed) noRoom(site.id);
  }

  // Local coordinates are tangent to a band (u), then outward from the core
  // (v). This makes all four directions use the same placement rules.
  const bandRect = (side, u, v, w, h) => {
    if (side === "north") return [u, cy - v - h, w, h];
    if (side === "south") return [u, cy + ch + v, w, h];
    if (side === "west") return [cx - v - h, u, h, w];
    return [cx + cw + v, u, h, w];
  };
  // Approach paths stay on the first three dry shore tiles. They connect
  // a main entry inside its own terrain partition to the preceding zone.
  // Their cells belong to the new entry, never to two overlapping zones.
  const connectShore = (side, fromId, entryId) => {
    const fromRects = map.zones[fromId].rects;
    const entryRects = map.zones[entryId].rects;
    if (fromRects.some((a) => entryRects.some((b) => rectsTouch(a, b)))) return;
    const horizontal = side === "north" || side === "south";
    const bounds = sideBand[side];
    const shore = bandRect(side, bounds[horizontal ? 0 : 1], 0, bounds[horizontal ? 2 : 3], 3);
    const offsets = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const prev = new Map();
    const queue = [];
    for (const tile of fromRects.flatMap(rectTiles)) for (const [dx, dy] of offsets) {
      const next = [tile[0] + dx, tile[1] + dy];
      const key = tileKey(next);
      if (inRect(next, shore) && !occupied.has(key) && !prev.has(key)) { prev.set(key, null); queue.push(next); }
    }
    let last = null;
    for (let head = 0; head < queue.length; head += 1) {
      const tile = queue[head];
      if (offsets.some(([dx, dy]) => entryRects.some((rect) => inRect([tile[0] + dx, tile[1] + dy], rect)))) { last = tile; break; }
      for (const [dx, dy] of offsets) {
        const next = [tile[0] + dx, tile[1] + dy];
        const key = tileKey(next);
        if (!inRect(next, shore) || occupied.has(key) || prev.has(key)) continue;
        prev.set(key, tile); queue.push(next);
      }
    }
    if (!last) noRoom(`${entryId} shore approach`);
    const path = [];
    for (let tile = last; tile; tile = prev.get(tileKey(tile))) path.unshift(tile);
    for (const tile of path) addZone(entryId, [...tile, 1, 1], "path");
  };
  for (const side of DIRECTIONS) {
    const sharing = lands.filter((land) => land.side === side);
    if (!sharing.length) continue;
    const arm = arms.find((row) => row.side === side);
    const horizontal = side === "north" || side === "south";
    let previous = arm.endZone;
    const river = sharing.find((land) => land.land === "river");
    const waterOffset = river ? 4 + Math.floor(rng() * 2) : 0;
    for (const land of sharing) {
      const low = land.rect[horizontal ? 0 : 1];
      const high = low + land.rect[horizontal ? 2 : 3];
      for (const site of outdoors.filter((row) => land.types.includes(row.type))) {
        const ids = zoneIds(site);
        const depth = site.type === "bridge" ? waterOffset + 4 : 4;
        const span = site.type === "bridge" ? 3 : 6;
        const previousRect = map.zones[previous].rects[0];
        const tangent = horizontal ? previousRect[0] : previousRect[1];
        const previousSpan = horizontal ? previousRect[2] : previousRect[3];
        const first = previous === arm.endZone;
        // Prefer direct neighbors; shared sides may need a shore approach.
        // A one-tile margin keeps water on both sides of a bridge's deck.
        const margin = site.type === "bridge" ? 1 : 0;
        const anchor = Math.max(low + margin, Math.min(high - span - margin, tangent - Math.floor((span - STREET) / 2)));
        const starts = first ? [anchor] : [tangent + previousSpan, tangent - span, anchor];
        for (let u = low + margin; u <= high - span - margin; u += 1) starts.push(u);
        let entry;
        let deep;
        for (const u of new Set(starts)) {
          const candidate = bandRect(side, u, 0, span, depth);
          const deeper = ids.length > 1
            ? [-2, -1, 0, 1, 2].map((shift) => bandRect(side, u + shift, 4, 8, 5)).find((rect) => canPlace(rect, land.rect) && rectsTouch(candidate, rect))
            : null;
          if (u >= low + margin && u + span <= high - margin && canPlace(candidate, land.rect) && (ids.length === 1 || deeper)) { entry = candidate; deep = deeper; break; }
        }
        if (!entry) noRoom(site.id);
        addZone(ids[0], entry, site.type === "bridge" ? "stone" : "path");
        connectShore(side, previous, ids[0]);
        plan.outdoorEntry[site.id] = previous;
        if (deep) addZone(ids[1], deep, site.type === "field" ? "herbs" : ["hill", "array_eye"].includes(site.type) ? "hill" : "meadow");
        previous = ids[0];
        if (site.type === "pond") {
          const u = horizontal ? entry[0] : entry[1];
          const water = bandRect(side, u, 5, 4, 3);
          if (!canPlace(water, land.rect)) noRoom(`${site.id} water`);
          occupy(water, `${site.id} water`); map.floors.push({ rect: water, material: "water" });
        }
      }
    }
    // The river channel is three tiles deep, 4–5 tiles from the core. Each
    // bridge owns a three-wide crossing inside this exact river partition.
    if (river) {
      const low = river.rect[horizontal ? 0 : 1];
      const high = low + river.rect[horizontal ? 2 : 3];
      let run = null;
      for (let u = low; u <= high; u += 1) {
        const rect = bandRect(side, u, waterOffset, 1, 3);
        const clear = u < high && canPlace(rect, river.rect);
        if (clear && run === null) run = u;
        if (!clear && run !== null) {
          const water = bandRect(side, run, waterOffset, u - run, 3);
          occupy(water, "river water"); map.floors.push({ rect: water, material: "water" }); run = null;
        }
      }
    }
  }

  // Decorative footprints are reserved too, so trees, walls and lanterns
  // cannot hide a standing tile, doorway or roof.
  const decorate = (rect, prop) => {
    if (!canPlace(rect)) return;
    occupy(rect, prop.kind);
    map.props.push({ ...prop, at: rect.slice(0, 2), w: rect[2], h: rect[3] });
    if (prop.kind === "lantern") {
      map.lights.push({ at: [rect[0] + 0.5, rect[1] + 0.5], r: 30, color: "#ffd890" });
    }
  };
  for (const land of lands) {
    const [x, y, w, h] = land.rect;
    if (land.land === "forest" || land.land === "river") for (let row = y + 1; row + 3 <= y + h; row += 5) for (let col = x + 1; col + 2 <= x + w; col += 5) {
      if (rng() < 0.7) decorate([col, row, 2, 3], { kind: land.land === "forest" ? "tree" : "willow" });
    }
  }
  for (const site of outdoors.filter((row) => row.type === "field")) {
    const crop = map.zones[`${site.id}__crop`].rects[0];
    const [x, y, w, h] = crop;
    for (const rect of [[x - 1, y - 1, w + 2, 1], [x - 1, y + h, w + 2, 1], [x - 1, y, 1, h], [x + w, y, 1, h]]) {
      // Split around existing zones; no fence closes the entry-to-crop edge.
      for (const tile of rectTiles(rect)) {
        const cell = [...tile, 1, 1];
        if (canPlace(cell)) { occupy(cell, "field fence"); map.walls.push({ rect: cell, style: "fence-wood" }); }
      }
    }
  }
  for (const [x, y] of [[px - 1, py - 1], [px + PLAZA[0], py - 1], [px - 1, py + PLAZA[1]], [px + PLAZA[0], py + PLAZA[1]]]) decorate([x, y, 1, 1], { kind: "lantern" });
  for (const site of buildings.filter((site) => !["home", "farmhouse"].includes(site.type))) {
    const lot = plan.lots[site.id];
    if (lot?.doorTile) {
      map.lights.push({ at: [lot.doorTile[0] + 0.5, lot.doorTile[1] + 0.5], r: 30, color: "#ffd890" });
    }
  }
  map.ambient.birds.push([Math.floor(rng() * 5), 2, cols - 5], [Math.floor(rng() * 5), Math.floor(rows / 3), cols - 5]);
  const walkable = walkableTiles(map);
  for (const [id, zone] of Object.entries(map.zones)) {
    const tiles = zone.rects.flatMap(rectTiles).filter((tile) => walkable.has(tileKey(tile))).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    if (tiles.length < 6) noRoom(`${id} standing spots`);
    map.spots[id] = Array.from({ length: Math.min(8, tiles.length) }, (_, i) => tiles[Math.floor(i * tiles.length / Math.min(8, tiles.length))]);
  }
  return { ...plan, map };
}
