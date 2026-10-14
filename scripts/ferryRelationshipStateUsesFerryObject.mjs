import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";
import { buildObservationEvents } from "../src/ui/render.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道执律剑修、邪派使者、妖医、镜灵、龙裔和鬼修都被中立城规矩暂时压住。",
});

const shen = state.characters.find((item) => item.id === "char_xianxia_shenheng");
const lu = state.characters.find((item) => item.id === "char_xianxia_luqingluo");
const market = state.locations.find((item) => item.name === "无咎市");
const ferry = state.locations.find((item) => item.name === "归墟渡");
assert.ok(shen && lu && market && ferry, "fixture should expose xianxia characters and locations");

const marketDialogue = {
  source: "agent-dialogue-relationship",
  relationshipSource: "agent-exchange",
  sharedObject: "妖丹盒",
  eventOutcome: "鹿青萝把妖丹盒压在案台边，袖口露着血痕的人往后缩了一步。",
  finalTurn: "妖丹盒不动，伤者也不动；规矩等人喘过气再进来。",
  followupTurn: "妖丹盒留了3轮，谁要收场，先看人还能不能站稳。",
  dialogueTurnCount: 5,
  dialogueTurns: [
    { speakerId: shen.id, speakerName: shen.name, targetId: lu.id, targetName: lu.name, line: "妖丹盒留在案台，证据没有退。", turnRole: "claim" },
    { speakerId: lu.id, speakerName: lu.name, targetId: shen.id, targetName: shen.name, line: "妖丹盒不动，伤者也不动。", turnRole: "response" },
  ],
  locationId: market.id,
  locationName: market.name,
  relationshipDialogueAct: {
    kind: "protect",
    reason: "鹿青萝用庇护把人和证物绑在一起。",
  },
};

state.relationships = [{
  fromCharacterId: shen.id,
  toCharacterId: lu.id,
  resentment: 35,
  wantsToBeSeen: 18,
  power: 12,
  unspoken: "沈珩还想把市场上的证物带回审讯流程。",
  misreading: "沈珩把鹿青萝的庇护听成拖延审案。",
  lastDialogue: marketDialogue,
  dialogueHistory: [marketDialogue, marketDialogue],
}, {
  fromCharacterId: lu.id,
  toCharacterId: shen.id,
  protection: 40,
  fear: 12,
  wantsToEscape: 12,
  unspoken: "鹿青萝不愿让伤者被当成价码。",
  misreading: "鹿青萝把沈珩的证据要求听成要拖人。",
  lastDialogue: marketDialogue,
  dialogueHistory: [marketDialogue, marketDialogue],
}];

state.characterMemories = [];
state.ui = {
  ...state.ui,
  activeTab: "observe",
  engineMode: "mock",
  focusMode: "focused",
  timeGrain: "scene",
  selectedLocationId: ferry.id,
  activeCharacterIds: [shen.id, lu.id],
};

const draft = playNext(state);
const events = buildObservationEvents(draft, state);
const visibleText = [
  draft.sceneText,
  ...(draft.agentOutputs || []).map((output) => output.visibleAction),
  ...events.flatMap((event) => [
    event.text,
    ...(event.beats || []).map((beat) => beat.text),
  ]),
].filter(Boolean).join("\n");

assert.doesNotMatch(
  visibleText,
  /把妖丹盒|妖丹盒压在水线|妖丹盒留在水线|妖丹盒不离水线|妖丹盒推到两人中间|妖丹盒压到湿冷/,
  `ferry scene should not physically move the market prop as the current stage object, got:\n${visibleText}`,
);
assert.doesNotMatch(
  visibleText,
  /账册|账页|摊主|案台|伤者/,
  `ferry scene dialogue should use ferry witness surfaces and protected-person wording, got:\n${visibleText}`,
);

assert.match(
  visibleText,
  /渡令|水线|湿冷的石阶/,
  `ferry scene should materialize relationship pressure through ferry objects, got:\n${visibleText}`,
);

console.log("ferryRelationshipStateUsesFerryObject:test passed", {
  sceneText: draft.sceneText,
});
