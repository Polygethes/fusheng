// Rooms of a building as topology and interiors both see them: perResidents
// rooms repeat (bedroom_1, bedroom_2…), and links expand "bedroom*" patterns.
export function expandRooms(def, residentCount) {
  const rooms = [];
  for (const room of def.rooms || []) {
    if (room.perResidents) {
      const needed = Math.max(1, Math.ceil(Math.max(1, residentCount) / room.perResidents));
      for (let i = 1; i <= needed; i += 1) rooms.push({ suffix: `${room.suffix}_${i}`, baseSuffix: room.suffix, label: `${room.label}${needed > 1 ? i : ""}`, entry: Boolean(room.entry) });
    } else rooms.push({ suffix: room.suffix, baseSuffix: room.suffix, label: room.label, entry: Boolean(room.entry) });
  }
  return rooms;
}
const matches = (pattern, room) => (pattern.endsWith("*") ? room.baseSuffix === pattern.slice(0, -1) : room.suffix === pattern || room.baseSuffix === pattern);
export function expandLinks(def, rooms) {
  const out = [];
  for (const [a, b] of def.links || []) for (const x of rooms.filter((r) => matches(a, r))) for (const y of rooms.filter((r) => matches(b, r))) {
    if (x.suffix !== y.suffix && !out.some(([p, q]) => (p === x.suffix && q === y.suffix) || (p === y.suffix && q === x.suffix))) out.push([x.suffix, y.suffix]);
  }
  return out;
}
