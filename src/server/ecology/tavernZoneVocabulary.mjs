/**
 * The single canonical vocabulary for tavern zones.
 *
 * Topology, ecology profiles, institution data and world settlement all speak
 * canonical English zone ids; Chinese labels and aliases exist only for
 * display and for resolving free text back onto an id. This module removes
 * the old dual-track state where ecology data used display labels ("后院")
 * as ids while the topology used canonical ids ("courtyard").
 */

export const TAVERN_ZONE_VOCABULARY = Object.freeze({
  threshold: Object.freeze({ label: "门槛", aliases: Object.freeze(["门口", "门边"]) }),
  hall: Object.freeze({ label: "堂前", aliases: Object.freeze(["堂内", "桌边"]) }),
  counter: Object.freeze({ label: "柜台", aliases: Object.freeze(["账台"]) }),
  stove: Object.freeze({ label: "灶边", aliases: Object.freeze(["灶台"]) }),
  courtyard: Object.freeze({ label: "后院", aliases: Object.freeze(["院子", "院中"]) }),
  stairs: Object.freeze({ label: "楼梯口", aliases: Object.freeze(["楼梯"]) }),
  guest_room: Object.freeze({ label: "楼上客房", aliases: Object.freeze(["客房", "房内", "房中"]) }),
});

function clean(value = "") {
  return String(value ?? "").trim();
}

const ZONE_ID_BY_NAME = new Map();
for (const [zoneId, zone] of Object.entries(TAVERN_ZONE_VOCABULARY)) {
  ZONE_ID_BY_NAME.set(zoneId, zoneId);
  ZONE_ID_BY_NAME.set(zone.label, zoneId);
  for (const alias of zone.aliases) ZONE_ID_BY_NAME.set(alias, zoneId);
}

/**
 * Resolve an id, display label or alias onto the canonical tavern zone id.
 * Values that belong to other locations (or are unknown) pass through
 * unchanged so this resolver is safe to apply defensively.
 */
export function resolveTavernZoneId(value = "") {
  const name = clean(value);
  return ZONE_ID_BY_NAME.get(name) || name;
}

/** Human-readable label for a canonical zone id; unknown ids render as themselves. */
export function tavernZoneLabel(zoneId = "") {
  const id = clean(zoneId);
  return TAVERN_ZONE_VOCABULARY[id]?.label || id;
}
