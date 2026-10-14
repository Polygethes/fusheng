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
const market = state.locations.find((location) => /无咎市|市|案台|账/.test(`${location.id} ${location.name} ${location.subtext}`)) || state.locations[0];

assert.ok(shen && yan && lu && market, "fixture should include 沈珩、阎无咎、鹿青萝 and 无咎市");

const protectDialogue = {
  source: "agent-dialogue-relationship",
  relationshipSource: "agent-exchange",
  sharedObject: "妖丹盒",
  locationId: market.id,
  locationName: market.name,
  eventOutcome: "鹿青萝把庇护牌压在案台边，迫使阎无咎先回答人会不会被带走；这一步在两人之间形成保护债。",
  finalTurn: "妖丹盒压在案台边，先护住人；妖丹盒不能被写成价码。",
  followupTurn: "妖丹盒压在案台边，先护住人；妖丹盒不能被写成价码。",
  dialogueTurnCount: 5,
  relationshipDialogueAct: {
    kind: "protect",
    reason: "阎无咎把妖丹盒重新命名为救命和保护的边界。",
  },
  dialogueTurns: [
    { speakerId: yan.id, speakerName: yan.name, targetId: lu.id, targetName: lu.name, line: "旧案要开口，人不能跟着妖丹盒被拖走。", turnRole: "claim" },
    { speakerId: lu.id, speakerName: lu.name, targetId: yan.id, targetName: yan.name, line: "药炉前不问正邪。", turnRole: "response" },
  ],
};

state.relationships = [
  {
    id: "rel_yan_lu_protect_current_source",
    projectId: state.project.id,
    branchId: state.project.activeBranchId,
    fromCharacterId: yan.id,
    toCharacterId: lu.id,
    love: 10,
    attraction: 0,
    resentment: 18,
    fear: 28,
    dependence: 30,
    power: 48,
    shame: 12,
    jealousy: 0,
    protection: 70,
    revenge: 0,
    deception: 20,
    wantsToBeSeen: 18,
    wantsToEscape: 8,
    misreading: "阎无咎把鹿青萝的庇护听成自己必须替伤者挡下一句。",
    unspoken: "人不能跟着妖丹盒被拖走。",
    lastDialogue: protectDialogue,
    dialogueHistory: [protectDialogue, protectDialogue],
  },
];
state.characterMemories = [];
state.characterPlans = [];
state.ui.timeGrain = "scene";
state.ui.focusMode = "focused";
state.ui.activeTab = "observe";
state.ui.engineMode = "mock";
state.ui.selectedLocationId = market.id;
state.ui.activeCharacterIds = [shen.id, yan.id, lu.id];

const draft = playNext(state);
const yanOutput = (draft.agentOutputs || []).find((output) => output.characterId === yan.id);

assert.ok(yanOutput, "draft should include 阎无咎 output");
assert.equal(yanOutput.targetCharacterId, shen.id, "阎无咎 should be connected as the responder to 沈珩 in the current exchange");
assert.ok(yanOutput.relationshipState, "fixture should give 阎无咎 a prior relationship state with 鹿青萝");
assert.match(
  yanOutput.visibleAction || "",
  /沈珩/,
  `when retargeted into the current exchange, visible action should face the current source 沈珩, got:\n${yanOutput.visibleAction}`,
);
assert.doesNotMatch(
  yanOutput.visibleAction || "",
  /挡住鹿青萝|鹿青萝看向伤者/,
  `prior relationship state must not leave a direct action aimed at the old target after retargeting, got:\n${yanOutput.visibleAction}`,
);
assert.doesNotMatch(
  yanOutput.visibleAction || "",
  /边边|旁旁|前前/,
  `retargeted relationship-state action should not expose mechanical surface duplication, got:\n${yanOutput.visibleAction}`,
);

console.log("relationshipStateResponderUsesCurrentSource:test passed", {
  visibleAction: yanOutput.visibleAction,
  targetCharacterId: yanOutput.targetCharacterId,
  relationshipState: yanOutput.relationshipState,
});
