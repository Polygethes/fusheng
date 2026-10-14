import assert from "node:assert/strict";
import { characterAgent, playNext } from "../src/engine/mockEngine.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道执律剑修沈珩、邪派血河楼使者阎无咎都被中立城规矩暂时压住。",
});

const shen = state.characters.find((character) => character.name === "沈珩");
const yan = state.characters.find((character) => character.name === "阎无咎");
const gate = state.locations.find((location) => location.id === "loc_xianxia_contract_gate" || /法契|契门|界石/.test(location.name || ""));

assert.ok(shen && yan && gate, "fixture should expose 沈珩、阎无咎 and contract gate");

const lastDialogue = {
  source: "agent-dialogue-relationship",
  relationshipSource: "agent-exchange",
  sharedObject: "灵契",
  locationId: gate.id,
  locationName: gate.name,
  eventOutcome: "沈珩把价码和旧案分开说到界石面前，阎无咎没能把话收回暗账。",
  finalTurn: "价码和旧案分开说。",
  followupTurn: "价码和旧案分开说。",
  dialogueTurnCount: 4,
  relationshipDialogueAct: {
    kind: "bargain",
    reason: "沈珩把阎无咎的价码拆成旧案和证据。",
    deltas: { deception: 3, power: 1 },
  },
};

state.relationships = [
  {
    id: "rel_yan_shen_dark_ledger",
    projectId: state.project.id,
    fromCharacterId: yan.id,
    toCharacterId: shen.id,
    love: 0,
    attraction: 0,
    resentment: 28,
    fear: 24,
    dependence: 0,
    power: 32,
    shame: 18,
    jealousy: 0,
    protection: 0,
    revenge: 0,
    deception: 42,
    wantsToBeSeen: 24,
    wantsToEscape: 34,
    misreading: "阎无咎把沈珩的见证听成旧案被迫开价。",
    unspoken: "暗账已经被迫露到界石前。",
    lastDialogue,
    dialogueHistory: [lastDialogue],
  },
];
state.characterMemories = [];
state.characterPlans = [];
state.townStateLedger = [];
state.ui.activeCharacterIds = [yan.id, shen.id];
state.ui.selectedLocationId = gate.id;

const output = characterAgent({
  state,
  character: yan,
  activeCharacters: [yan, shen],
  location: gate,
});

assert.match(
  output.visibleAction,
  /暗账|收回暗账|没能收回/,
  `next visible action should carry the previous outcome into the body/stage action, got:\n${output.visibleAction}`,
);
assert.ok(
  !/价码到了，旧案自然开口/.test(output.visibleAction) || /暗账|没能收回/.test(output.visibleAction),
  `stale defense slogan cannot be the only relationship behavior after the dark-ledger outcome, got:\n${output.visibleAction}`,
);

state.ui.engineMode = "mock";
state.ui.timeGrain = "scene";
state.ui.focusMode = "location";
const draft = playNext(state);
const runtimeVisibleAction = (draft.agentOutputs || [])
  .find((agentOutput) => agentOutput.characterId === yan.id)
  ?.visibleAction || "";

assert.match(
  runtimeVisibleAction,
  /暗账|收回暗账|没能收回/,
  `runtime playNext path should preserve the previous outcome after private simulation enrichment, got:\n${runtimeVisibleAction}`,
);
assert.ok(!/。”。/.test(runtimeVisibleAction), `runtime visible action should not double-punctuate quoted speech, got:\n${runtimeVisibleAction}`);

console.log("relationshipOutcomeShapesNextVisibleAction:test passed", {
  visibleAction: output.visibleAction,
  runtimeVisibleAction,
});
