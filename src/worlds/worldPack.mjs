import { createHash } from "node:crypto";

/**
 * A world pack is pure data describing one simulated stage: its place and
 * topology, cast, objects, work, social rules, deadlines, unresolved
 * mysteries, report metrics and pixel layout. The runtime reads worlds only
 * through packs, so a second world never needs tavern constants.
 */
export const WORLD_PACK_SCHEMA_VERSION = 1;
export const REQUIRED_SECTIONS = Object.freeze([
  "meta", "stage", "clock", "cast", "relationships", "relationshipMetrics", "objects",
  "positions", "work", "social", "agenda", "mysteries", "report", "layout",
]);

function fault(code, message) {
  return Object.assign(new Error(message), { code });
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function defineWorldPack(pack = {}) {
  for (const section of REQUIRED_SECTIONS) {
    if (pack[section] === undefined || pack[section] === null) {
      throw fault("WORLD_PACK_SECTION_MISSING", `World pack is missing required section: ${section}.`);
    }
  }
  if (!/^[a-z0-9_-]+$/u.test(String(pack.meta.id || ""))) {
    throw fault("WORLD_PACK_ID_INVALID", "World pack meta.id must be a lowercase identifier.");
  }
  return deepFreeze(structuredClone({ schemaVersion: WORLD_PACK_SCHEMA_VERSION, ...pack }));
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

export function worldPackDigest(pack = {}) {
  return createHash("sha256").update(JSON.stringify(stable(pack))).digest("hex");
}
