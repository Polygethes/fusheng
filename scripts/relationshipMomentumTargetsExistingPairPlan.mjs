import assert from "node:assert/strict";
import { buildUpdateBundle } from "../src/engine/stateUpdater.js";
import { buildIntentPlan } from "../src/state/intentPlanner.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵、散修和城中执法者都被中立城规矩暂时压住。",
});

const shen = state.characters.find((item) => item.id === "char_xianxia_shenheng");
const yan = state.characters.find((item) => item.id === "char_xianxia_yanwujie");
const aoji = state.characters.find((item) => item.id === "char_xianxia_aoji");
assert.ok(shen && yan && aoji, "test characters should exist");

const unrelatedPlan = buildIntentPlan(state, shen, {
  id: "plan_shen_vs_yan",
  targetCharacterId: yan.id,
  mode: "wait",
  currentTactic: "wait",
  pressure: 70,
  heat: 68,
  risk: 44,
  progress: 12,
  source: "test-unrelated",
});

const pairPlan = buildIntentPlan(state, shen, {
  id: "plan_shen_vs_aoji",
  targetCharacterId: aoji.id,
  mode: "wait",
  currentTactic: "wait",
  pressure: 32,
  heat: 36,
  risk: 28,
  progress: 6,
  source: "test-pair",
});

state.characterPlans = [unrelatedPlan, pairPlan];

const draft = {
  id: "draft_pair_specific_relationship_momentum",
  projectId: state.project.id,
  branchId: "branch_main",
  participantIds: [shen.id, aoji.id],
  locationId: "loc_xianxia_ferry",
  agentOutputs: [],
  relationshipShift: [{
    generatedFrom: "agent-dialogue-relationship",
    fromCharacterId: shen.id,
    toCharacterId: aoji.id,
    deltas: { resentment: 5, wantsToBeSeen: 4 },
    sharedObject: "渡令",
    finalTurn: "渡令先留岸上。",
    followupTurn: "你刚才问的是城规，现在渡令先别换手。",
    dialogueTurnCount: 4,
    eventOutcome: "渡令被压回湿冷的石阶。",
    relationshipMomentum: {
      historyCount: 3,
      objects: ["渡令"],
      latestTurn: "你刚才问的是城规，现在渡令先别换手。",
      reason: "连续3轮围绕渡令没结清，关系变化必须改写沈珩对敖霁的下一步。",
    },
  }],
  irreversibleTraces: [],
};

const bundle = buildUpdateBundle(draft, state);
const patches = bundle.characterPlans || [];
const unrelatedPatch = patches.find((plan) => plan.id === unrelatedPlan.id);
const pairPatch = patches.find((plan) => plan.id === pairPlan.id);

assert.equal(unrelatedPatch, undefined, "relationship momentum should not retarget an unrelated plan for another character pair");
assert.ok(pairPatch, "relationship momentum should update the existing plan for this character pair");
assert.equal(pairPatch.targetCharacterId, aoji.id, "pair plan should remain aimed at the relationship target");
assert.equal(pairPatch.currentTactic, "punish", "repeated resentment toward this target should turn this pair plan into punishment");
assert.doesNotMatch(
  pairPatch.shortTerm || "",
  /关系变化来自|未结清|连续\d+\s*轮|不再按单次互动计算|关系回流/,
  "pair plan should not leak backend momentum wording",
);
assert.match(
  pairPatch.shortTerm || "",
  /沈珩|敖霁|渡令|下一步|逼问|水线/,
  "pair plan should remain targeted while becoming a concrete dramatic action",
);

console.log("relationshipMomentumTargetsExistingPairPlan:test passed", {
  patchedPlanId: pairPatch.id,
  tactic: pairPatch.currentTactic,
  untouchedPlanId: unrelatedPlan.id,
});
