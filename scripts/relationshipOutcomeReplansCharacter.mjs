import assert from "node:assert/strict";
import { buildUpdateBundle } from "../src/engine/stateUpdater.js";
import { buildIntentPlan } from "../src/state/intentPlanner.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道执律剑修沈珩、邪派血河楼使者阎无咎都被中立城规矩暂时压住。",
});

const shen = state.characters.find((character) => character.name === "沈珩");
const yan = state.characters.find((character) => character.name === "阎无咎");
const gate = state.locations.find((location) => location.id === "loc_xianxia_contract_gate" || /法契|契门|界石/.test(location.name || ""));

assert.ok(shen && yan && gate, "fixture should expose 沈珩、阎无咎 and contract gate");

const existingPlan = buildIntentPlan(state, yan, {
  id: "plan_yan_hide_old_case",
  targetCharacterId: shen.id,
  mode: "wait",
  currentTactic: "wait",
  pressure: 35,
  heat: 35,
  risk: 25,
  progress: 5,
  source: "test",
});
state.characterPlans = [existingPlan];

const draft = {
  id: "draft_dark_ledger_replans",
  projectId: state.project.id,
  branchId: "branch_main",
  participantIds: [yan.id, shen.id],
  locationId: gate.id,
  agentOutputs: [],
  irreversibleTraces: [],
  relationshipShift: [
    {
      generatedFrom: "agent-dialogue-relationship",
      relationshipSource: "agent-exchange",
      fromCharacterId: yan.id,
      toCharacterId: shen.id,
      deltas: { deception: 3, power: 1 },
      sharedObject: "灵契",
      locationId: gate.id,
      locationName: gate.name,
      eventOutcome: "沈珩把价码和旧案分开说到界石面前，阎无咎没能把话收回暗账。",
      finalTurn: "价码和旧案分开说。",
      followupTurn: "价码和旧案分开说。",
      dialogueTurnCount: 4,
      misreading: "阎无咎把沈珩的见证听成旧案被迫开价。",
      unspoken: "暗账已经被迫露到界石前。",
      relationshipDialogueAct: {
        kind: "bargain",
        reason: "阎无咎把灵契改成交易筹码。",
        deltas: { deception: 3, power: 1 },
      },
    },
  ],
};

const bundle = buildUpdateBundle(draft, state);
const planPatch = (bundle.characterPlans || []).find((plan) => plan.id === existingPlan.id || plan.characterId === yan.id);

assert.ok(planPatch, "relationship outcome should replan the affected character");
assert.equal(planPatch.currentTactic, "hide_evidence", "dark ledger exposure should push the next tactic toward hiding evidence");

const planText = [
  planPatch.shortTerm,
  planPatch.immediateObjective,
  planPatch.hiddenObjective,
  planPatch.planLog?.[0]?.line,
].filter(Boolean).join(" ");

assert.match(
  planText,
  /暗账|收回暗账|没能.*收回/,
  `plan should carry the visible outcome, not only the spoken line, got:\n${planText}`,
);
assert.doesNotMatch(
  planText,
  /灵契、界石|拿到灵契、界石|把灵契、界石/,
  `plan should not treat witness infrastructure as a movable object, got:\n${planText}`,
);

console.log("relationshipOutcomeReplansCharacter:test passed", {
  tactic: planPatch.currentTactic,
  planText,
});
