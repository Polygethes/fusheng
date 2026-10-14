import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道执律剑修、邪派使者、妖医、镜灵、龙裔和鬼修都被中立城规矩暂时压住。",
});

state.ui.timeGrain = "scene";
state.ui.focusMode = "location";
state.ui.activeTab = "observe";
state.ui.selectedLocationId = "loc_xianxia_market";
state.ui.activeCharacterIds = ["char_xianxia_shenheng", "char_xianxia_yanwujie"];

const draft = playNext(state);
const exchange = (draft.sceneInteraction?.agentExchanges || [])[0];
assert.ok(exchange, "focused market scene should produce an agent exchange");
assert.equal(exchange.sharedObject, "妖丹盒", "market exchange should be anchored to the market object");

const firstLine = exchange.dialogueTurns?.[0]?.line || "";
const allDialogue = (exchange.dialogueTurns || []).map((turn) => turn.line).join(" ");

assert.match(
  firstLine,
  /妖丹盒|案台|价码|旧案|魔印|符|账册/,
  `opening line should be grounded in current market stakes, got: ${firstLine}`,
);
assert.notEqual(
  firstLine,
  "让照骨司先验。",
  "opening line should not be a bare reusable defense slogan",
);
assert.match(
  allDialogue,
  /价码|旧案|魔印|符|账册/,
  `market dialogue should expose the envoy's trading stake, got: ${allDialogue}`,
);
assert.doesNotMatch(
  allDialogue,
  /(?:灵契|妖丹盒|照骨镜|渡令|庇护牌|符)(?:慢慢|轻轻|重重)/,
  `object names should not absorb action adverbs, got: ${allDialogue}`,
);
assert.doesNotMatch(
  draft.sceneText,
  /妖丹盒[^。]*界石|妖丹盒[^。]*灵痕/,
  `market visible action should not move the market object to the contract gate, got:\n${draft.sceneText}`,
);

console.log("focusedMarketDialogueGroundedInCurrentStakes:test passed", {
  firstLine,
  allDialogue,
});
