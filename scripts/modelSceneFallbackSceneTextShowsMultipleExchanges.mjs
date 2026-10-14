import assert from "node:assert/strict";
import { normalizeSceneInteraction } from "../src/server/pipeline/sceneInteractionSimulator.mjs";

const privateSimulations = [
  {
    characterId: "char_shen",
    characterName: "沈珩",
    targetCharacterId: "char_yan",
    targetCharacterName: "阎无咎",
    agentProfile: {
      leverageObject: "灵契",
      dialogueMoves: ["按城法扣契，不按宗门私仇。", "剑可以停，证据不能走。"],
    },
    defensiveMask: "按城法扣契，不按宗门私仇。",
  },
  {
    characterId: "char_yan",
    characterName: "阎无咎",
    targetCharacterId: "char_shen",
    targetCharacterName: "沈珩",
    agentProfile: {
      leverageObject: "魔印",
      dialogueMoves: ["我押的是灵契，不是命。", "价码到了，旧案自然开口。"],
    },
    defensiveMask: "我押的是灵契，不是命。",
  },
  {
    characterId: "char_lu",
    characterName: "鹿青萝",
    targetCharacterId: "char_ao",
    targetCharacterName: "敖霁",
    agentProfile: {
      leverageObject: "庇护牌",
      dialogueMoves: ["药炉前不问正邪。", "庇护牌先留在医坊。"],
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
      dialogueMoves: ["水阵拦的是破禁，不是人。", "渡令不替谁认罪。"],
    },
    defensiveMask: "水阵拦的是破禁，不是人。",
  },
];

const normalized = normalizeSceneInteraction({}, privateSimulations, { perCharacter: [] });
const text = normalized.sceneText || "";

assert.equal(normalized.agentExchanges.length, 2, "fallback should create two pair-level exchanges");
assert.match(text, /沈珩|阎无咎/, `sceneText should include the first exchange, got: ${text}`);
assert.match(text, /鹿青萝|敖霁/, `sceneText should include the second exchange instead of hiding it, got: ${text}`);
assert.match(text, /灵契/, `sceneText should name the first exchange object, got: ${text}`);
assert.match(text, /庇护牌|渡令/, `sceneText should name the second exchange object, got: ${text}`);
assert.ok(
  text.indexOf("鹿青萝") > text.indexOf("阎无咎") || text.indexOf("敖霁") > text.indexOf("阎无咎"),
  "sceneText should read as multiple observable beats, not a single hidden exchange",
);

console.log("modelSceneFallbackSceneTextShowsMultipleExchanges:test passed", {
  exchanges: normalized.agentExchanges.length,
  sceneText: text,
});
