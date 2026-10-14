import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵、散修和城中执法者都被中立城规矩暂时压住。",
});

state.ui.timeGrain = "day";
state.ui.focusMode = "ambient";
state.ui.activeTab = "observe";

const draft = playNext(state);
const tick = (draft.periodSimulation?.ticks || []).find((item) => item.locationName === "四方法契门");
const idByName = Object.fromEntries(state.characters.map((character) => [character.name, character.id]));
const outputs = tick?.agentOutputs || [];
const yanOutput = outputs.find((output) => output.characterId === idByName.阎无咎);
const luOutput = outputs.find((output) => output.characterId === idByName.鹿青萝);
const protectedExchange = (tick?.sceneInteraction?.agentExchanges || []).find((exchange) => (
  exchange.responseOutputId === yanOutput?.outputId
  && exchange.eventOutcome?.includes("护住鹿青萝")
));
const interjection = (protectedExchange?.dialogueTurns || []).find((turn) => (
  turn.speakerId === idByName.鹿青萝 && turn.turnRole === "third_party_interjection"
));

assert.ok(yanOutput && luOutput, "fixture should contain Yan Wugui and Lu Qingluo agent outputs in the same tick");
assert.ok(protectedExchange, "fixture should contain the exchange where Yan Wugui protects Lu Qingluo");
assert.ok(interjection, "the protected third-party agent should speak inside the exchange that acts on her");
assert.equal(
  protectedExchange.thirdPartyOutputId,
  luOutput.outputId,
  "the interjection should trace back to Lu Qingluo's independently generated agent output",
);
assert.match(
  interjection.line || "",
  /庇护牌|伤者|药炉|救命|人命|医坊/,
  `Lu Qingluo's interjection should preserve her own medical/protection stake, got:\n${interjection.line}`,
);
assert.equal(
  protectedExchange.dialogueDecision?.thirdPartyMove,
  "interject",
  "the exchange should record that a third agent chose to enter the conversation",
);

console.log("thirdPartyAgentInterjectsInProtectedExchange:test passed", {
  yan: yanOutput.visibleAction,
  lu: luOutput.visibleAction,
  interjection,
});
