const nodes = Object.freeze({
  threshold: Object.freeze({ id: "threshold", x: 23.2, y: 84, zoneId: "threshold" }),
  entry: Object.freeze({ id: "entry", x: 29.5, y: 79, zoneId: "hall" }),
  threshold_bench_a: Object.freeze({ id: "threshold_bench_a", x: 26, y: 77.4, zoneId: "hall" }),
  threshold_bench_b: Object.freeze({ id: "threshold_bench_b", x: 31, y: 78.4, zoneId: "hall" }),
  hall_south_west: Object.freeze({ id: "hall_south_west", x: 37, y: 77, zoneId: "hall" }),
  hall_south_center: Object.freeze({ id: "hall_south_center", x: 47, y: 77, zoneId: "hall" }),
  hall_south_east: Object.freeze({ id: "hall_south_east", x: 64.8, y: 77, zoneId: "hall" }),
  west_south: Object.freeze({ id: "west_south", x: 21.5, y: 72, zoneId: "hall" }),
  hall_west: Object.freeze({ id: "hall_west", x: 20.5, y: 57, zoneId: "hall" }),
  side_table_west_south: Object.freeze({ id: "side_table_west_south", x: 20.8, y: 47, zoneId: "hall" }),
  side_table_west_north: Object.freeze({ id: "side_table_west_north", x: 20.8, y: 41, zoneId: "hall" }),
  upper_west: Object.freeze({ id: "upper_west", x: 20.8, y: 31.5, zoneId: "hall" }),
  hall_center: Object.freeze({ id: "hall_center", x: 45.5, y: 70, zoneId: "hall" }),
  hall_mid: Object.freeze({ id: "hall_mid", x: 45.5, y: 58, zoneId: "hall" }),
  hall_north_gate: Object.freeze({ id: "hall_north_gate", x: 44, y: 42, zoneId: "hall" }),
  hall_north: Object.freeze({ id: "hall_north", x: 42, y: 29, zoneId: "hall" }),
  counter_front: Object.freeze({ id: "counter_front", x: 47, y: 51.5, zoneId: "counter" }),
  counter_wait: Object.freeze({ id: "counter_wait", x: 45.5, y: 47.5, zoneId: "counter" }),
  counter_service_passage: Object.freeze({ id: "counter_service_passage", x: 69.5, y: 51.2, zoneId: "counter" }),
  hall_near_counter_west: Object.freeze({ id: "hall_near_counter_west", x: 44, y: 51.5, zoneId: "hall" }),
  hall_near_counter_south: Object.freeze({ id: "hall_near_counter_south", x: 48, y: 54, zoneId: "hall" }),
  center_table_west: Object.freeze({ id: "center_table_west", x: 50, y: 60.5, zoneId: "hall" }),
  center_table_north: Object.freeze({ id: "center_table_north", x: 58, y: 51.2, zoneId: "hall" }),
  center_table_south: Object.freeze({ id: "center_table_south", x: 58, y: 71.5, zoneId: "hall" }),
  center_table_east: Object.freeze({ id: "center_table_east", x: 66, y: 61, zoneId: "hall" }),
  back_door: Object.freeze({ id: "back_door", x: 36.5, y: 23, zoneId: "courtyard" }),
  courtyard: Object.freeze({ id: "courtyard", x: 36.5, y: 15, zoneId: "courtyard" }),
  east_bypass: Object.freeze({ id: "east_bypass", x: 68.5, y: 74, zoneId: "hall" }),
  stairs_hall_portal: Object.freeze({ id: "stairs_hall_portal", x: 69.5, y: 69.5, zoneId: "hall" }),
  stairs_corridor: Object.freeze({ id: "stairs_corridor", x: 70, y: 55, zoneId: "stairs" }),
  kitchen_entry: Object.freeze({ id: "kitchen_entry", x: 70.5, y: 68.5, zoneId: "stove" }),
  stove_front: Object.freeze({ id: "stove_front", x: 71.5, y: 57.5, zoneId: "stove" }),
  stairs_base: Object.freeze({ id: "stairs_base", x: 71.5, y: 47.5, zoneId: "stairs" }),
  stairs_low: Object.freeze({ id: "stairs_low", x: 73, y: 40, zoneId: "stairs" }),
  stairs_mid: Object.freeze({ id: "stairs_mid", x: 74.5, y: 32, zoneId: "stairs" }),
  stairs_high: Object.freeze({ id: "stairs_high", x: 74, y: 24, zoneId: "stairs" }),
  stairs_top: Object.freeze({ id: "stairs_top", x: 71.5, y: 17, zoneId: "guest_room" }),
  guest_room: Object.freeze({ id: "guest_room", x: 66.5, y: 15.5, zoneId: "guest_room" }),
});

const edges = Object.freeze([
  ["threshold", "entry"],
  ["entry", "threshold_bench_a"],
  ["entry", "threshold_bench_b"],
  ["entry", "hall_south_west"],
  ["hall_south_west", "hall_south_center"],
  ["hall_south_west", "west_south"],
  ["west_south", "hall_west"],
  ["hall_west", "side_table_west_south"],
  ["side_table_west_south", "side_table_west_north"],
  ["side_table_west_north", "upper_west"],
  ["upper_west", "hall_north"],
  ["hall_south_center", "hall_center"],
  ["hall_center", "hall_mid"],
  ["hall_center", "center_table_west"],
  ["hall_center", "center_table_south"],
  ["center_table_south", "hall_south_east"],
  ["hall_mid", "counter_front"],
  ["hall_mid", "counter_wait"],
  ["hall_mid", "hall_near_counter_west"],
  ["hall_mid", "hall_near_counter_south"],
  ["hall_near_counter_west", "center_table_north"],
  ["counter_front", "counter_wait"],
  ["counter_front", "counter_service_passage"],
  ["counter_service_passage", "stove_front"],
  ["hall_mid", "hall_north_gate"],
  ["hall_north_gate", "hall_north"],
  ["hall_north", "back_door"],
  ["back_door", "courtyard"],
  ["hall_south_center", "hall_south_east"],
  ["hall_south_east", "east_bypass"],
  ["east_bypass", "stairs_hall_portal"],
  ["stairs_hall_portal", "stairs_corridor"],
  ["stairs_corridor", "stairs_base"],
  ["east_bypass", "kitchen_entry"],
  ["kitchen_entry", "center_table_east"],
  ["kitchen_entry", "stove_front"],
  ["stove_front", "stairs_base"],
  ["stairs_base", "stairs_low"],
  ["stairs_low", "stairs_mid"],
  ["stairs_mid", "stairs_high"],
  ["stairs_high", "stairs_top"],
  ["stairs_top", "guest_room"],
]);

const rectangle = (id, x1, y1, x2, y2) => Object.freeze({
  id,
  polygon: Object.freeze([
    Object.freeze({ x: x1, y: y1 }),
    Object.freeze({ x: x2, y: y1 }),
    Object.freeze({ x: x2, y: y2 }),
    Object.freeze({ x: x1, y: y2 }),
  ]),
});

const obstacles = Object.freeze([
  rectangle("side-table", 23.5, 34, 34.5, 49.8),
  rectangle("hall-table-west", 30, 51, 42.5, 67),
  rectangle("hall-table-east", 52, 52, 64.5, 69),
  rectangle("service-counter", 49, 32, 68.5, 50),
  rectangle("kitchen-fixtures", 75, 39, 88, 69.5),
  rectangle("back-cupboard", 21.5, 17, 27, 29),
]);

const zoneAnchors = Object.freeze({
  threshold: Object.freeze(["threshold"]),
  hall: Object.freeze(["hall_south_center", "hall_mid", "hall_south_west"]),
  counter: Object.freeze(["counter_front", "counter_wait"]),
  stove: Object.freeze(["stove_front", "kitchen_entry"]),
  courtyard: Object.freeze(["courtyard", "back_door"]),
  stairs: Object.freeze(["stairs_base", "stairs_low"]),
  guest_room: Object.freeze(["guest_room", "stairs_top"]),
});

const positionHotspots = Object.freeze({
  "position:tavern-hall-side-wall-table": Object.freeze(["side_table_west_south", "side_table_west_north"]),
  "position:tavern-hall-center-table": Object.freeze(["center_table_west", "center_table_north", "center_table_south", "center_table_east"]),
  "position:tavern-hall-near-counter": Object.freeze(["hall_near_counter_west", "hall_near_counter_south"]),
  "position:tavern-hall-near-threshold-bench": Object.freeze(["threshold_bench_a", "threshold_bench_b"]),
  "position:tavern-hall-entry-standing": Object.freeze(["entry"]),
  "position:tavern-hall-courtyard-approach": Object.freeze(["hall_north"]),
  "position:tavern-courtyard-inside": Object.freeze(["courtyard"]),
  "position:tavern-threshold-standing": Object.freeze(["threshold"]),
});

const patrolPairs = Object.freeze({
  hall: Object.freeze([
    Object.freeze(["hall_south_west", "hall_mid"]),
    Object.freeze(["hall_west", "hall_north"]),
    Object.freeze(["hall_south_center", "center_table_west"]),
  ]),
  counter: Object.freeze([Object.freeze(["counter_front", "counter_wait"])]),
  stove: Object.freeze([Object.freeze(["kitchen_entry", "stove_front"])]),
  courtyard: Object.freeze([Object.freeze(["back_door", "courtyard"])]),
  stairs: Object.freeze([Object.freeze(["stairs_base", "stairs_low"])]),
  guest_room: Object.freeze([Object.freeze(["stairs_top", "guest_room"])]),
});

export const TAVERN_NAVIGATION_MAP = Object.freeze({
  projection: "three-quarter-top-down",
  coordinateSpace: Object.freeze({ width: 100, height: 100, origin: "top-left" }),
  nodes,
  edges,
  obstacles,
  zoneAnchors,
  positionHotspots,
});

export const TAVERN_ZONE_EDGES = Object.freeze([
  Object.freeze(["threshold", "hall"]),
  Object.freeze(["hall", "counter"]),
  Object.freeze(["counter", "stove"]),
  Object.freeze(["hall", "courtyard"]),
  Object.freeze(["hall", "stairs"]),
  Object.freeze(["stairs", "guest_room"]),
]);

function clean(value = "") {
  return String(value ?? "").trim();
}

function stableIndex(seed = "", length = 1) {
  const size = Math.max(1, Number(length) || 1);
  const hash = [...clean(seed)].reduce((total, character) => (
    (total * 33 + (character.codePointAt(0) || 0)) >>> 0
  ), 5381);
  return hash % size;
}

function distance(left, right) {
  return Math.hypot(Number(right.x) - Number(left.x), Number(right.y) - Number(left.y));
}

function nodeIdForZone(zoneId = "hall", seed = "", slot = null) {
  const candidates = zoneAnchors[clean(zoneId)] || zoneAnchors.hall;
  const index = slot !== null && slot !== undefined && Number.isFinite(Number(slot))
    ? Math.max(0, Number(slot) || 0) % candidates.length
    : stableIndex(seed, candidates.length);
  return candidates[index];
}

function nodeIdForPosition(positionId = "", seed = "", slot = null) {
  const candidates = positionHotspots[clean(positionId)];
  if (!candidates?.length) return "";
  const index = slot !== null && slot !== undefined && Number.isFinite(Number(slot))
    ? Math.max(0, Number(slot) || 0) % candidates.length
    : stableIndex(seed, candidates.length);
  return candidates[index];
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    const crosses = (currentPoint.y > point.y) !== (previousPoint.y > point.y)
      && point.x < ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y))
        / ((previousPoint.y - currentPoint.y) || Number.EPSILON) + currentPoint.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function orientation(a, b, c) {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(value) < 1e-8) return 0;
  return value > 0 ? 1 : 2;
}

function onSegment(a, b, c) {
  return b.x <= Math.max(a.x, c.x) + 1e-8
    && b.x + 1e-8 >= Math.min(a.x, c.x)
    && b.y <= Math.max(a.y, c.y) + 1e-8
    && b.y + 1e-8 >= Math.min(a.y, c.y);
}

function segmentsIntersect(a, b, c, d) {
  const first = orientation(a, b, c);
  const second = orientation(a, b, d);
  const third = orientation(c, d, a);
  const fourth = orientation(c, d, b);
  if (first !== second && third !== fourth) return true;
  if (first === 0 && onSegment(a, c, b)) return true;
  if (second === 0 && onSegment(a, d, b)) return true;
  if (third === 0 && onSegment(c, a, d)) return true;
  return fourth === 0 && onSegment(c, b, d);
}

export function isWalkableTavernPoint(point = {}) {
  const x = Number(point.x);
  const y = Number(point.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 100 || y < 0 || y > 100) return false;
  return !obstacles.some((obstacle) => pointInPolygon({ x, y }, obstacle.polygon));
}

export function doesTavernSegmentCrossObstacle(left = {}, right = {}) {
  if (!isWalkableTavernPoint(left) || !isWalkableTavernPoint(right)) return true;
  return obstacles.some((obstacle) => obstacle.polygon.some((point, index) => (
    segmentsIntersect(left, right, point, obstacle.polygon[(index + 1) % obstacle.polygon.length])
  )));
}

const adjacency = new Map(Object.keys(nodes).map((nodeId) => [nodeId, []]));
for (const [leftId, rightId] of edges) {
  const left = nodes[leftId];
  const right = nodes[rightId];
  if (!left || !right) continue;
  const cost = distance(left, right);
  adjacency.get(leftId).push({ nodeId: rightId, cost });
  adjacency.get(rightId).push({ nodeId: leftId, cost });
}
for (const neighbours of adjacency.values()) {
  neighbours.sort((left, right) => left.nodeId.localeCompare(right.nodeId));
}

export function tavernZonePath(fromZoneId = "hall", toZoneId = "hall") {
  const start = clean(fromZoneId);
  const target = clean(toZoneId);
  if (!start || !target) return [];
  if (start === target) return [start];
  const neighbours = new Map();
  for (const [left, right] of TAVERN_ZONE_EDGES) {
    if (!neighbours.has(left)) neighbours.set(left, []);
    if (!neighbours.has(right)) neighbours.set(right, []);
    neighbours.get(left).push(right);
    neighbours.get(right).push(left);
  }
  const queue = [start];
  const previous = new Map();
  const visited = new Set([start]);
  while (queue.length) {
    const zoneId = queue.shift();
    for (const next of (neighbours.get(zoneId) || []).slice().sort()) {
      if (visited.has(next)) continue;
      visited.add(next);
      previous.set(next, zoneId);
      if (next === target) {
        const route = [target];
        while (route[0] !== start) route.unshift(previous.get(route[0]));
        return route;
      }
      queue.push(next);
    }
  }
  return [];
}

export function findTavernPath(startNodeId = "", endNodeId = "", {
  reservedNodeIds = [],
  allowedZoneIds = [],
} = {}) {
  const startId = clean(startNodeId);
  const endId = clean(endNodeId);
  if (!nodes[startId] || !nodes[endId]) return [];
  if (startId === endId) return [{ ...nodes[startId], nodeId: startId }];
  const reserved = new Set((reservedNodeIds || []).map(clean).filter(Boolean));
  const allowedZones = new Set((allowedZoneIds || []).map(clean).filter(Boolean));
  reserved.delete(startId);
  reserved.delete(endId);
  const costs = new Map([[startId, 0]]);
  const previous = new Map();
  const open = new Set([startId]);

  while (open.size) {
    const currentId = [...open].sort((left, right) => {
      const costDelta = (costs.get(left) || Infinity) - (costs.get(right) || Infinity);
      return costDelta || left.localeCompare(right);
    })[0];
    open.delete(currentId);
    if (currentId === endId) break;
    for (const neighbour of adjacency.get(currentId) || []) {
      if (reserved.has(neighbour.nodeId)) continue;
      if (allowedZones.size && !allowedZones.has(nodes[neighbour.nodeId]?.zoneId)) continue;
      const nextCost = (costs.get(currentId) || 0) + neighbour.cost;
      if (nextCost + 1e-8 >= (costs.get(neighbour.nodeId) ?? Infinity)) continue;
      costs.set(neighbour.nodeId, nextCost);
      previous.set(neighbour.nodeId, currentId);
      open.add(neighbour.nodeId);
    }
  }

  if (!previous.has(endId)) return [];
  const nodeIds = [endId];
  while (nodeIds[0] !== startId) nodeIds.unshift(previous.get(nodeIds[0]));
  return nodeIds.map((nodeId) => ({ ...nodes[nodeId], nodeId }));
}

export function tavernAnchorFor({ zoneId = "hall", positionId = "", actorId = "", slot = 0 } = {}) {
  const seed = `${clean(actorId)}:${Math.max(0, Number(slot) || 0)}`;
  const nodeId = nodeIdForPosition(positionId, seed, slot) || nodeIdForZone(zoneId, seed, slot);
  return { ...nodes[nodeId], nodeId };
}

export function planTavernRoute({
  fromZoneId = "hall",
  toZoneId = "hall",
  positionId = "",
  actorId = "",
  slot = 0,
  reservedNodeIds = [],
} = {}) {
  const seed = `${clean(actorId)}:${Math.max(0, Number(slot) || 0)}`;
  const startId = nodeIdForZone(fromZoneId, seed, slot);
  const endId = nodeIdForPosition(positionId, seed, slot) || nodeIdForZone(toZoneId, seed, slot);
  const allowedZoneIds = tavernZonePath(fromZoneId, toZoneId);
  const path = findTavernPath(startId, endId, { reservedNodeIds, allowedZoneIds });
  return path.length ? path : [{ ...nodes[startId], nodeId: startId }];
}

export function buildTavernPatrolRoute({ zoneId = "hall", actorId = "", startNodeId = "" } = {}) {
  const pairs = patrolPairs[clean(zoneId)] || [];
  if (!pairs.length) return [];
  const pair = pairs[stableIndex(actorId, pairs.length)];
  const startId = nodes[clean(startNodeId)] ? clean(startNodeId) : pair[0];
  const targetId = pair.find((nodeId) => nodeId !== startId) || pair[1];
  const outward = findTavernPath(startId, targetId);
  if (outward.length < 2) return [];
  return [...outward, ...outward.slice(0, -1).reverse()];
}

export function tavernRouteLength(route = []) {
  return (Array.isArray(route) ? route : []).slice(1).reduce((total, point, index) => (
    total + distance(route[index], point)
  ), 0);
}

export function serializeTavernRoute(route = []) {
  return (Array.isArray(route) ? route : [])
    .filter((point) => Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y)))
    .map((point) => `${Number(point.x).toFixed(2)},${Number(point.y).toFixed(2)}`)
    .join(";");
}

export function parseTavernRoute(value = "") {
  return clean(value).split(";").map((pair) => {
    const [x, y] = pair.split(",").map(Number);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }).filter(Boolean);
}

export function validateTavernNavigationMap() {
  const errors = [];
  for (const [nodeId, point] of Object.entries(nodes)) {
    if (!isWalkableTavernPoint(point)) errors.push(`node ${nodeId} is not walkable`);
  }
  for (const [leftId, rightId] of edges) {
    if (!nodes[leftId] || !nodes[rightId]) {
      errors.push(`edge ${leftId}:${rightId} references a missing node`);
    } else if (doesTavernSegmentCrossObstacle(nodes[leftId], nodes[rightId])) {
      errors.push(`edge ${leftId}:${rightId} crosses an obstacle`);
    }
  }
  for (const [zoneId, anchors] of Object.entries(zoneAnchors)) {
    if (!anchors.length || anchors.some((nodeId) => !nodes[nodeId])) errors.push(`zone ${zoneId} has an invalid anchor`);
  }
  for (const [positionId, hotspots] of Object.entries(positionHotspots)) {
    if (!hotspots.length || hotspots.some((nodeId) => !nodes[nodeId])) errors.push(`position ${positionId} has an invalid hotspot`);
  }
  return { valid: errors.length === 0, errors };
}
