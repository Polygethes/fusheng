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
  id: "plan_shen_yan_unrelated_output",
  targetCharacterId: yan.id,
  mode: "wait",
  currentTactic: "wait",
  progress: 9,
  pressure: 52,
  source: "test-unrelated",
});

const referencedPlan = buildIntentPlan(state, shen, {
  id: "plan_shen_aoji_referenced_output",
  targetCharacterId: aoji.id,
  mode: "punish",
  currentTactic: "punish",
  progress: 11,
  pressure: 58,
  source: "test-referenced",
});

state.characterPlans = [unrelatedPlan, referencedPlan];

const draft = {
  id: "draft_agent_output_referenced_plan",
  projectId: state.project.id,
  branchId: "branch_main",
  participantIds: [shen.id, aoji.id],
  locationId: "loc_xianxia_ferry",
  agentOutputs: [{
    characterId: shen.id,
    targetCharacterId: aoji.id,
    planId: referencedPlan.id,
    tone: "惩罚",
    visibleAction: "沈珩扣住敖霁面前的渡令，另一只手拦住敖霁。沈珩说：“渡令先别走。”",
    hiddenAction: "沈珩把上一轮没结清的话转成逼问。",
    defenseAction: "把逼近命名为城规。",
    selfDeceptionSentence: "我只是按城规办事。",
    wantsFromOthers: "希望敖霁迟疑并继续解释。",
    desiredEmotionalResponse: "迟疑、受伤、继续等待解释",
    possibleEvidenceLeft: "归墟渡留下：渡令被扣在石阶上",
  }],
  relationshipShift: [],
  irreversibleTraces: [],
};

const bundle = buildUpdateBundle(draft, state);
const patches = bundle.characterPlans || [];
const unrelatedPatch = patches.find((plan) => plan.id === unrelatedPlan.id);
const referencedPatch = patches.find((plan) => plan.id === referencedPlan.id);

assert.equal(unrelatedPatch, undefined, "an agent output with planId should not advance the first unrelated plan");
assert.ok(referencedPatch, "an agent output with planId should advance the referenced plan");
assert.equal(referencedPatch.targetCharacterId, aoji.id, "referenced plan should keep its target");
assert.ok(Number(referencedPatch.progress || 0) > referencedPlan.progress, "referenced plan should make progress");
assert.equal(referencedPatch.lastPlanResult, "执行了自主计划");

console.log("agentOutputAdvancesReferencedPlan:test passed", {
  patchedPlanId: referencedPatch.id,
  progress: referencedPatch.progress,
  untouchedPlanId: unrelatedPlan.id,
});
