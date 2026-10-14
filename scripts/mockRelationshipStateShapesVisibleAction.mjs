import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道执律剑修、邪派使者、妖医、镜灵、龙裔和鬼修都被中立城规矩暂时压住。",
});

const healer = state.characters.find((item) => item.name === "鹿青萝");
const sword = state.characters.find((item) => item.name === "沈珩");
const clinic = state.locations.find((item) => /万灵|医坊|药炉/.test(`${item.id} ${item.name} ${item.subtext}`)) || state.locations[0];

assert.ok(healer && sword && clinic, "fixture should include 鹿青萝、沈珩 and a clinic-like place");

const lastDialogue = {
  source: "agent-dialogue-relationship",
  relationshipSource: "agent-exchange",
  sharedObject: "庇护牌",
  locationId: clinic.id,
  locationName: clinic.name,
  eventOutcome: "鹿青萝把庇护牌压到药炉旁，沈珩没有把伤者交给照骨司。",
  finalTurn: "你可以等封条，伤者不能等。",
  followupTurn: "你可以等封条，伤者不能等。",
  dialogueTurnCount: 4,
  relationshipDialogueAct: {
    kind: "protect",
    reason: "鹿青萝把庇护牌重新命名为救命和保护的边界。",
  },
  dialogueTurns: [
    { speakerId: healer.id, speakerName: healer.name, targetId: sword.id, targetName: sword.name, line: "药炉前先救命，庇护牌不交给照骨司。", turnRole: "claim" },
    { speakerId: sword.id, speakerName: sword.name, targetId: healer.id, targetName: healer.name, line: "庇护不能把证据吞掉。", turnRole: "response" },
    { speakerId: healer.id, speakerName: healer.name, targetId: sword.id, targetName: sword.name, line: "你可以等封条，伤者不能等。", turnRole: "counter" },
  ],
};

state.relationships = [
  {
    id: "rel_mock_relationship_state_visible",
    projectId: state.project.id,
    branchId: state.project.activeBranchId,
    fromCharacterId: healer.id,
    toCharacterId: sword.id,
    love: 10,
    attraction: 0,
    resentment: 18,
    fear: 18,
    dependence: 22,
    power: 28,
    shame: 12,
    jealousy: 0,
    protection: 48,
    revenge: 0,
    deception: 8,
    wantsToBeSeen: 18,
    wantsToEscape: 8,
    misreading: "鹿青萝把沈珩的扣押听成要把伤者交给审判。",
    unspoken: "救命的边界不该被照骨司夺走。",
    lastDialogue,
    dialogueHistory: [lastDialogue],
  },
];
state.characterMemories = [];
state.characterPlans = [];
state.ui.activeCharacterIds = [healer.id, sword.id];
state.ui.selectedLocationId = clinic.id;
state.ui.timeGrain = "scene";
state.ui.focusMode = "focused";
state.ui.engineMode = "mock";

const draft = playNext(state);
const healerOutput = (draft.agentOutputs || []).find((output) => output.characterId === healer.id);
const visibleText = `${healerOutput?.visibleAction || ""}\n${draft.sceneText || ""}`;
const actionOnly = String(healerOutput?.visibleAction || "")
  .replace(/[^。！？…]*?说：“[^”]*”[。！？…]?/g, "")
  .trim();

assert.ok(healerOutput, "mock draft should include 鹿青萝 agent output");
assert.match(
  healerOutput.visibleAction || "",
  /庇护牌/,
  `mock visible action should keep the shared object, got:\n${healerOutput.visibleAction}`,
);
assert.match(
  actionOnly,
  /伤者|药炉/,
  `mock visible action should turn relationshipState into observable non-dialogue stakes, got:\n${healerOutput.visibleAction}`,
);
assert.doesNotMatch(
  visibleText,
  /关系状态|下一步|后台|private|simulation|actionCandidate|currentConstraint/,
  `mock observation must not expose backend relationship state language:\n${visibleText}`,
);

console.log("mockRelationshipStateShapesVisibleAction:test passed", {
  visibleAction: healerOutput.visibleAction,
  actionOnly,
  sceneTextExcerpt: String(draft.sceneText || "").split("\n").slice(-3).join("\n"),
});

const bargainState = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道执律剑修、邪派使者、妖医、镜灵、龙裔和鬼修都被中立城规矩暂时压住。",
});
const yan = bargainState.characters.find((item) => item.name === "阎无咎");
const lu = bargainState.characters.find((item) => item.name === "鹿青萝");
const market = bargainState.locations.find((item) => /无咎市|市|案台|账/.test(`${item.id} ${item.name} ${item.subtext}`)) || bargainState.locations[0];
const bargainDialogue = {
  source: "agent-dialogue-relationship",
  relationshipSource: "agent-exchange",
  sharedObject: "灵契",
  locationId: market.id,
  locationName: market.name,
  eventOutcome: "阎无咎把灵契压到账册边，没有让摊主落笔。",
  finalTurn: "灵契先别进账，旧案价码还没说完。",
  followupTurn: "灵契先别进账，旧案价码还没说完。",
  dialogueTurnCount: 4,
  relationshipDialogueAct: {
    kind: "bargain",
    reason: "阎无咎把灵契重新命名为旧案和价码的筹码。",
  },
  dialogueTurns: [],
};
bargainState.relationships = [
  {
    id: "rel_mock_relationship_state_bargain_visible",
    projectId: bargainState.project.id,
    branchId: bargainState.project.activeBranchId,
    fromCharacterId: yan.id,
    toCharacterId: lu.id,
    love: 10,
    attraction: 0,
    resentment: 20,
    fear: 20,
    dependence: 10,
    power: 40,
    shame: 15,
    jealousy: 0,
    protection: 10,
    revenge: 10,
    deception: 35,
    wantsToBeSeen: 18,
    wantsToEscape: 12,
    misreading: "阎无咎把鹿青萝的庇护听成要让旧案失价。",
    unspoken: "旧案价码还没有结清。",
    lastDialogue: bargainDialogue,
    dialogueHistory: [bargainDialogue],
  },
];
bargainState.characterMemories = [];
bargainState.characterPlans = [];
bargainState.ui.activeCharacterIds = [yan.id, lu.id];
bargainState.ui.selectedLocationId = market.id;
bargainState.ui.timeGrain = "scene";
bargainState.ui.focusMode = "focused";
bargainState.ui.engineMode = "mock";

const bargainDraft = playNext(bargainState);
const yanOutput = (bargainDraft.agentOutputs || []).find((output) => output.characterId === yan.id);
const yanActionOnly = String(yanOutput?.visibleAction || "")
  .replace(/[^。！？…]*?说：“[^”]*”[。！？…]?/g, "")
  .trim();

assert.ok(yanOutput, "mock draft should include 阎无咎 agent output");
assert.match(
  yanActionOnly,
  /账册|进账|落笔/,
  `bargain relationshipState should become an observable market procedure, got:\n${yanOutput.visibleAction}`,
);
assert.doesNotMatch(
  `${yanOutput.visibleAction}\n${bargainDraft.sceneText || ""}`,
  /关系状态|下一步|后台|private|simulation|actionCandidate|currentConstraint/,
  "bargain observation must not expose backend relationship-state language",
);
