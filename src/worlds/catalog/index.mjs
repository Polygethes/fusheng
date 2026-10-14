// Catalog index and town time policy constants
import { SITE_TYPES } from "./siteTypes.mjs";
import { SKILLS } from "./skills.mjs";
import { APPEARANCE_STYLES, COLOR_PALETTES } from "./appearance.mjs";
import { EDGES, ROOM_ROOM, ROOM_DOOR, STREET_STREET, TO_WILD } from "./edges.mjs";

export { SITE_TYPES, SKILLS, APPEARANCE_STYLES, COLOR_PALETTES, EDGES, ROOM_ROOM, ROOM_DOOR, STREET_STREET, TO_WILD };

// The town clock (spec §9.5), in the keys the runtime reads (the same keys as
// 借星's sceneTimePolicy). Passing glances and people walking by are seen but
// wake nobody; speech, handing things over and anything aimed at a person do.
export const TOWN_TIME_POLICY = Object.freeze({
  observationSeconds: 30,
  listeningSeconds: 30,
  moveSeconds: 20,
  speechCharactersPerSecond: 4,
  speechPauseSeconds: 6,
  defaultRestSeconds: 300,
  reflectionMinIntervalSeconds: 1800,
  ambientGesturesWake: false,
  bystanderMovementWakes: false,
});
