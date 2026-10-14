import assert from "node:assert/strict";
import { normalizeSceneInteraction } from "../src/server/pipeline/sceneInteractionSimulator.mjs";

const privateSimulations = [
  {
    characterId: "char_lu",
    characterName: "鹿青萝",
    targetCharacterId: "char_ao",
    targetCharacterName: "敖霁",
    agentProfile: {
      leverageObject: "庇护牌",
      dialogueMoves: ["药炉前不问正邪。", "你先站到灯下。"],
    },
    defensiveMask: "药炉前不问正邪。",
  },
  {
    characterId: "char_ao",
    characterName: "敖霁",
    targetCharacterId: "char_lu",
    targetCharacterName: "鹿青萝",
    agentProfile: {
      leverageObject: "渡令",
      dialogueMoves: ["水阵拦的是破禁，不是人。", "我只守这一段水路。"],
    },
    defensiveMask: "水阵拦的是破禁，不是人。",
  },
];

const normalized = normalizeSceneInteraction({}, privateSimulations, { perCharacter: [] });
const exchange = normalized.agentExchanges[0] || {};
const outcome = exchange.eventOutcome || "";
const text = normalized.sceneText || "";

assert.ok(outcome, "fallback should produce an event outcome");
assert.match(outcome, /鹿青萝|敖霁/, `event outcome should name the characters, got: ${outcome}`);
assert.match(outcome, /庇护牌/, `event outcome should name the concrete shared object, got: ${outcome}`);
assert.match(outcome, /推|压|停|留|收|手|身前|旁边/, `event outcome should describe visible staging, got: ${outcome}`);
assert.doesNotMatch(
  outcome,
  /这件物|原来的方向|下一步|绕不开/,
  `event outcome should not fall back to abstract template language, got: ${outcome}`,
);
assert.doesNotMatch(
  text,
  /这件物|原来的方向|下一步|绕不开/,
  `sceneText should not expose abstract fallback language, got: ${text}`,
);

console.log("modelSceneFallbackConcreteOutcome:test passed", {
  outcome,
  sceneText: text,
});
