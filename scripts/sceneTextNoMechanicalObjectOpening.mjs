import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道执律剑修、邪派使者、妖医、镜灵、龙裔、鬼修、城中执法者闻夏都被中立城规矩暂时压住。",
});

const teahouse = state.locations.find((location) => location.id === "loc_xianxia_teahouse" || location.name === "停剑茶楼");
const shen = state.characters.find((character) => character.name === "沈珩");
const wenxia = state.characters.find((character) => character.name === "闻夏");

state.ui.timeGrain = "scene";
state.ui.focusMode = "location";
state.ui.selectedLocationId = teahouse.id;
state.ui.activeCharacterIds = [shen.id, wenxia.id];

const draft = playNext(state);
const sceneText = draft.sceneText || "";
const openingLines = sceneText.split("\n").slice(0, 3).join("\n");

assert.doesNotMatch(
  openingLines,
  /(灵契|停剑令|妖丹盒|照骨镜|渡令|庇护牌|魂灯)(?:被破|被推到明处|被扣到明处)/,
  `scene opening should not summarize object state mechanically, got:\n${openingLines}`,
);
assert.doesNotMatch(
  sceneText,
  /被破。[^。！？\n]*(?:被推到明处|被扣到明处)/,
  `scene text should not stitch likelyEvents into a duplicated object-state sentence, got:\n${sceneText}`,
);
assert.match(sceneText, /沈珩.*闻夏|闻夏.*沈珩/, "scene should still keep the human exchange visible");

console.log("sceneTextNoMechanicalObjectOpening:test passed", {
  openingLines,
});
