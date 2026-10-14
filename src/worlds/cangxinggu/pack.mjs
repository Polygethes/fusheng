// 借星 · 雨夜入谷: the whole of 藏星谷 on the rainy night a refugee couple
// carries their newborn in through a gap in the hills. The valley is a town
// blueprint compiled at load; the 借星 documents (../jiexing/beacon) are its
// setting, not its storyline.
import fs from "node:fs";
import { compileBlueprint } from "../compiler/index.mjs";
import { defineWorldPack } from "../worldPack.mjs";

const blueprint = JSON.parse(fs.readFileSync(new URL("./blueprint.json", import.meta.url), "utf8"));
const { pack } = compileBlueprint(blueprint);

// The night opens in the rain, the stream already up and the ground muddy.
export default defineWorldPack({
  ...pack,
  stage: {
    ...pack.stage,
    perceptionEnvironment: { ...pack.stage.perceptionEnvironment, weather: "rain", light: 0.35, ambientNoise: 0.45 },
    environment: { levels: { stream: 0.45, ground: 0.5 } },
  },
});
