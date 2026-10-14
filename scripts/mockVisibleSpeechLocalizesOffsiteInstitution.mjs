import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道执律剑修、邪派使者、妖医、镜灵、龙裔和鬼修都被中立城规矩暂时压住。",
});

const lu = state.characters.find((character) => character.name === "鹿青萝");
const shen = state.characters.find((character) => character.name === "沈珩");
const market = state.locations.find((location) => /无咎市|市|案台|账/.test(`${location.id} ${location.name} ${location.subtext}`)) || state.locations[0];

assert.ok(lu && shen && market, "fixture should include 鹿青萝、沈珩 and 无咎市");

lu.defenseLanguage = ["进了医坊，先救命，后审案。"];
lu.agentProfile = {
  ...(lu.agentProfile || {}),
  leverageObject: "庇护牌",
  dialogueMoves: ["进了医坊，先救命，后审案。"],
};
lu.actionVerbs = { ...(lu.actionVerbs || {}), visible: ["诊脉"] };

state.relationships = [];
state.characterMemories = [];
state.characterPlans = [];
state.ui.timeGrain = "scene";
state.ui.focusMode = "focused";
state.ui.activeTab = "observe";
state.ui.engineMode = "mock";
state.ui.selectedLocationId = market.id;
state.ui.activeCharacterIds = [lu.id, shen.id];

const draft = playNext(state);
const luOutput = (draft.agentOutputs || []).find((output) => output.characterId === lu.id);
const visibleText = `${luOutput?.visibleAction || ""}\n${draft.sceneText || ""}`;

assert.ok(luOutput, "draft should include 鹿青萝 output");
assert.doesNotMatch(
  visibleText,
  /进了医坊|药炉前|留在药炉旁|诊床/,
  `mock visible action and observer prose should not move clinic speech into ${market.name}, got:\n${visibleText}`,
);
assert.match(
  visibleText,
  /庇护牌|案台|人|救命|先救/,
  `localized healer speech should keep protection stakes on the current market surface, got:\n${visibleText}`,
);

console.log("mockVisibleSpeechLocalizesOffsiteInstitution:test passed", {
  visibleAction: luOutput.visibleAction,
  sceneText: draft.sceneText,
});
