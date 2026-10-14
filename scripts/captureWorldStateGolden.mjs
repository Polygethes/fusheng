// Captures the tavern v2.7 world state exactly as the pre-world-pack runtime
// builds it. The world-pack refactor must reproduce these bytes (apart from
// the new worldPackMeta field), so run this only against the legacy code.
//
//   node scripts/captureWorldStateGolden.mjs
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { buildTavernWorldStateV27, TAVERN_V27_DEFAULT_CHARACTER_IDS } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { TAVERN_SCENE_CHARACTER_IDS, TAVERN_SCENE_POSITIONS } from "../src/server/pipeline/tavernSceneConfiguration.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const GOLDEN_PATH = path.join(root, "scripts/fixtures/xiaoyaoyou-world-state-golden.json");

export function xiaoyaoyouSeed() {
  return buildPlayableWorldFromSetup({
    setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
    setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
  });
}

export function sortedJson(value) {
  if (Array.isArray(value)) return value.map(sortedJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedJson(value[key])]));
  }
  return value;
}

export function goldenCases(build = buildTavernWorldStateV27) {
  const state = xiaoyaoyouSeed();
  return {
    scene: build(state, {
      characterIds: TAVERN_SCENE_CHARACTER_IDS,
      positions: TAVERN_SCENE_POSITIONS,
      worldId: "world:golden:scene",
      pacingMode: "scene",
      openingAfterSeconds: 900,
    }),
    day: build(state, {
      characterIds: TAVERN_V27_DEFAULT_CHARACTER_IDS,
      worldId: "world:golden:day",
    }),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await mkdir(path.dirname(GOLDEN_PATH), { recursive: true });
  await writeFile(GOLDEN_PATH, `${JSON.stringify(sortedJson(goldenCases()), null, 1)}\n`);
  console.log(`golden written: ${GOLDEN_PATH}`);
}
