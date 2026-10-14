import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道执律剑修、邪派使者、妖医、镜灵、龙裔和鬼修都被中立城规矩暂时压住。",
});

const shen = state.characters.find((character) => character.name === "沈珩");
const yan = state.characters.find((character) => character.name === "阎无咎");
const lu = state.characters.find((character) => character.name === "鹿青萝");
const market = state.locations.find((location) => location.name === "无咎市");
const ferry = state.locations.find((location) => location.name === "归墟渡");
assert.ok(shen && yan && lu && market && ferry, "fixture should expose characters and locations");

const marketDialogue = {
  source: "agent-dialogue-relationship",
  relationshipSource: "agent-exchange",
  sharedObject: "妖丹盒",
  locationId: market.id,
  locationName: market.name,
  eventOutcome: "鹿青萝把妖丹盒压在案台边，迫使阎无咎先回答人会不会被带走。",
  finalTurn: "妖丹盒压在案台边，先护住人；妖丹盒不能被写成价码。",
  followupTurn: "妖丹盒留了3轮，谁要收场，先看人还能不能站稳。",
  dialogueTurnCount: 5,
  relationshipDialogueAct: {
    kind: "protect",
    reason: "阎无咎把妖丹盒重新命名为保护边界。",
  },
};

state.relationships = [{
  id: "rel_yan_lu_market_protect_retarget_ferry",
  projectId: state.project.id,
  branchId: state.project.activeBranchId,
  fromCharacterId: yan.id,
  toCharacterId: lu.id,
  protection: 80,
  fear: 25,
  power: 35,
  wantsToEscape: 12,
  misreading: "阎无咎把鹿青萝的庇护听成自己必须替伤者挡下一句。",
  unspoken: "人不能跟着妖丹盒被拖走。",
  lastDialogue: marketDialogue,
  dialogueHistory: [marketDialogue, marketDialogue],
}];

state.characterMemories = [];
state.characterPlans = [];
state.ui = {
  ...state.ui,
  activeTab: "observe",
  engineMode: "mock",
  focusMode: "focused",
  timeGrain: "scene",
  selectedLocationId: ferry.id,
  activeCharacterIds: [shen.id, yan.id, lu.id],
};

const draft = playNext(state);
const yanOutput = (draft.agentOutputs || []).find((output) => output.characterId === yan.id);
assert.ok(yanOutput, "draft should include 阎无咎 output");
assert.equal(yanOutput.targetCharacterId, shen.id, "阎无咎 should be retargeted to the current source 沈珩");
assert.match(
  yanOutput.visibleAction || "",
  /沈珩/,
  `retargeted action should face the current source, got:\n${yanOutput.visibleAction}`,
);
assert.doesNotMatch(
  yanOutput.visibleAction || "",
  /妖丹盒|案台|账册|摊主/,
  `retargeted relationship-state action should not carry market objects into the ferry, got:\n${yanOutput.visibleAction}`,
);
assert.match(
  yanOutput.visibleAction || "",
  /渡令|水线|石阶/,
  `retargeted relationship-state action should use ferry objects, got:\n${yanOutput.visibleAction}`,
);

console.log("retargetedRelationshipStateLocalizesCurrentObject:test passed", {
  visibleAction: yanOutput.visibleAction,
});
