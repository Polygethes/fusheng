import assert from "node:assert/strict";
import { buildUpdateBundle } from "../src/engine/stateUpdater.js";
import { buildIntentPlan } from "../src/state/intentPlanner.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵、散修和城中执法者都被中立城规矩暂时压住。",
});

const shen = state.characters.find((item) => item.id === "char_xianxia_shenheng");
const aoji = state.characters.find((item) => item.id === "char_xianxia_aoji");
assert.ok(shen && aoji, "test characters should exist");

const existingPlan = buildIntentPlan(state, shen, {
  id: "plan_shen_initial_wait",
  targetCharacterId: aoji.id,
  mode: "wait",
  currentTactic: "wait",
  pressure: 38,
  heat: 42,
  risk: 30,
  progress: 10,
  source: "test",
});
state.characterPlans = [existingPlan];

const draft = {
  id: "draft_relationship_momentum_replans",
  projectId: state.project.id,
  branchId: "branch_main",
  participantIds: [shen.id, aoji.id],
  locationId: "loc_xianxia_ferry",
  agentOutputs: [],
  relationshipShift: [{
    generatedFrom: "agent-dialogue-relationship",
    relationshipSource: "agent-exchange",
    fromCharacterId: shen.id,
    toCharacterId: aoji.id,
    deltas: { resentment: 5, wantsToBeSeen: 5, deception: 1 },
    sharedObject: "渡令",
    eventOutcome: "渡令被压回湿冷的石阶。",
    finalTurn: "人可以退，渡令不走。",
    followupTurn: "你刚才问的是城规，现在渡令先别换手。",
    dialogueTurnCount: 4,
    misreading: "沈珩把敖霁连续留物听成拖延。",
    unspoken: "沈珩知道这已经不是单次争执。",
    relationshipMomentum: {
      historyCount: 2,
      objects: ["铜铃", "渡令"],
      latestTurn: "你刚才问的是城规，现在渡令先别换手。",
      reason: "连续2轮围绕铜铃、渡令没结清，关系变化不再按单次互动计算。",
    },
  }],
  irreversibleTraces: [],
};

const bundle = buildUpdateBundle(draft, state);
const planPatch = (bundle.characterPlans || []).find((plan) => plan.characterId === shen.id);

assert.ok(planPatch, "relationship momentum should create or update the source character plan");
assert.equal(planPatch.targetCharacterId, aoji.id, "plan should stay locked to the relationship target");
assert.equal(planPatch.currentTactic, "punish", "resentment momentum should turn the next tactic into punishment");
assert.equal(planPatch.nextActionBias, "惩罚", "plan action bias should match the relationship-driven tactic");
assert.ok(Number(planPatch.pressure || 0) > existingPlan.pressure, "relationship momentum should increase plan pressure");
const planLanguage = `${planPatch.shortTerm || ""} ${planPatch.planLog?.[0]?.line || ""}`;
assert.doesNotMatch(
  planLanguage,
  /关系变化来自|未结清|连续\d+\s*轮|不再按单次互动计算|关系回流/,
  "relationship-shaped plan language should not expose backend momentum notes",
);
assert.match(
  planLanguage,
  /沈珩|敖霁|铜铃|渡令|下一步|逼问|水线/,
  "plan patch should turn repeated dialogue into a concrete dramatic next action",
);

console.log("relationshipMomentumReplansCharacter:test passed", {
  tactic: planPatch.currentTactic,
  pressure: planPatch.pressure,
  line: planPatch.planLog?.[0]?.line,
});
