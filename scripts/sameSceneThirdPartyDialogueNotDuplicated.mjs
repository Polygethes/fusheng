import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵、散修和城中执法者都被中立城规矩暂时压住。",
});

const lu = state.characters.find((character) => character.name === "鹿青萝");
lu.currentState = { ...lu.currentState, protectionImpulse: 95, revengeImpulse: 0, rage: 10 };
lu.defenseLanguage = ["庇护牌先护住人，后问案。"];
lu.agentProfile = { ...lu.agentProfile, dialogueMoves: ["庇护牌先护住人，后问案。"] };
lu.actionLines = { ...lu.actionLines, defense: "庇护牌先护住人，后问案。" };

state.ui.timeGrain = "day";
state.ui.focusMode = "ambient";
state.ui.activeTab = "observe";

const draft = playNext(state);
const tick = (draft.periodSimulation?.ticks || []).find((item) => item.locationName === "四方法契门");
const exchanges = tick?.sceneInteraction?.agentExchanges || [];
const interjection = exchanges.flatMap((exchange) => exchange.dialogueTurns || [])
  .find((turn) => turn.speakerId === lu.id && turn.generatedBy === "character-agent");
const normalizedLine = String(interjection?.line || "").replace(/[。！？…]+$/g, "").trim();
const occurrences = exchanges.flatMap((exchange) => exchange.dialogueTurns || [])
  .filter((turn) => String(turn.line || "").replace(/[。！？…]+$/g, "").trim() === normalizedLine);
const containingTurns = exchanges.flatMap((exchange) => exchange.dialogueTurns || [])
  .filter((turn) => turn !== interjection)
  .filter((turn) => String(turn.line || "").replace(/[。！？…]+$/g, "").trim().includes(normalizedLine));

assert.ok(interjection && normalizedLine, "the third character should enter through its own character-agent turn");
assert.equal(
  occurrences.length,
  1,
  `a third character agent must not repeat the same generated line in two exchanges of one scene, got:\n${JSON.stringify(occurrences, null, 2)}`,
);
assert.equal(
  containingTurns.length,
  0,
  `the interjection must not be copied as a complete clause inside another turn, got:\n${JSON.stringify(containingTurns, null, 2)}`,
);

console.log("sameSceneThirdPartyDialogueNotDuplicated:test passed", {
  interjection: interjection.line,
  allLines: exchanges.flatMap((exchange) => exchange.dialogueTurns || []).map((turn) => turn.line),
});
