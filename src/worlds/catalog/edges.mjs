// Standard town topology edge parameters (specification §7.1)
// Note: Unreachable/opaque modalities are intentionally omitted (not Infinity) for clean JSON round-tripping.

export const ROOM_ROOM = Object.freeze({
  move: 1,
  sound: 1.25,
  visual: 1.5,
  conversation: true,
});

export const ROOM_DOOR = Object.freeze({
  move: 1,
  sound: 2,
  // visual omitted (屋里屋外互相看不见)
});

export function STREET_STREET(len = 1) {
  return Object.freeze({
    move: Math.max(1, Math.min(3, len)),
    sound: 1.5,
    visual: 1,
  });
}

export function TO_WILD(len = 3) {
  return Object.freeze({
    move: Math.max(3, Math.min(6, len)),
    // sound omitted (荒野林野隔音)
    visual: 2.5,
  });
}

export const EDGES = Object.freeze({
  ROOM_ROOM,
  ROOM_DOOR,
  STREET_STREET,
  TO_WILD,
});
