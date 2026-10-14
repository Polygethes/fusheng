import assert from "node:assert/strict";

import { getTavernEcologyProfile } from "../src/server/ecology/tavernEcologyProfile.mjs";
import { createInitialEcologyState } from "../src/server/ecology/tavernEcologyState.mjs";
import { appraiseTavernAgentEcology } from "../src/server/pipeline/tavernEcologyRuntime.mjs";
import { runTavernCausalScene } from "../src/server/pipeline/tavernCausalScene.mjs";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const observerId = "char_contract_observer";
const entrantId = "char_contract_entrant";
const observationImpactId = "impact:contract:ordinary-entry";
const observerCharacter = {
  id: observerId,
  name: "观察者",
  lifeState: { present: true, activeGoal: "辨明刚进入同一空间的人是否与自己有关" },
};
const observerProfile = getTavernEcologyProfile(observerCharacter, {
  observationStageId: "loc_xyy_tavern",
  defaultZoneId: "hall",
});
const genericEcology = appraiseTavernAgentEcology({
  character: {
    ...observerCharacter,
    ecologyState: createInitialEcologyState(observerProfile, {
      locationId: "loc_xyy_tavern",
      zoneId: "hall",
      observableAtStage: true,
    }),
  },
  runtime: {
    elapsedSeconds: 0,
    step: 0,
    slotContext: { slotId: "agency-floor-contract", slotLabel: "清晨" },
    actions: [],
    commitments: [],
    requestLocks: [],
  },
  actor: { characterId: observerId, present: true, zoneId: "hall" },
  pendingImpacts: [{
    impactId: observationImpactId,
    sourceCharacterId: entrantId,
    directed: false,
    directedTargetId: "",
    type: "physical",
    modality: "visual",
    impactScore: 48,
    content: "另一人从门槛走进同一间堂前。",
    topic: "同场人物进入感知范围",
    provenance: { sourceActionId: "action:contract:ordinary-entry" },
  }],
  visibleCharacterIds: [entrantId],
  availableAffordances: [],
  recentOwnActions: [],
  relationships: [],
});
const socialOpportunity = genericEcology.candidates.find((candidate) => (
  candidate.id === `impact:${observationImpactId}:respond`
));
const socialEvaluation = genericEcology.appraisal.candidates.find((candidate) => (
  candidate.candidateId === socialOpportunity?.id
));
assert.ok(socialOpportunity, "ordinary co-presence must produce a generic interpersonal opportunity");
assert.equal(socialEvaluation?.feasible, true);
assert.equal(socialOpportunity.requiresResolution, false, "ordinary movement is not a forced response obligation");
assert.equal(socialOpportunity.realization.mode, "observe");
assert.equal(socialOpportunity.realization.allowSpeech, true);
assert.equal(socialOpportunity.realization.requireSpeech, false, "silence/pass must remain available without faking an answer");
assert.ok(socialOpportunity.realization.allowedSpeechActs.includes("ask"), "a grounded question must remain available");
assert.notEqual(
  socialOpportunity.expressionStrategy?.directness,
  "none",
  "an observation candidate that explicitly permits speech must not carry a contradictory forced-silence expression strategy",
);

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
const managerId = "char_xyy_xiemu";
const proprietorId = "char_xyy_xieheng";
for (const character of state.characters) {
  character.lifeState.present = [managerId, proprietorId].includes(character.id);
}
const activations = [];
const fairness = await runTavernCausalScene(state, {
  characterIds: [managerId, proprietorId],
  positions: {
    [managerId]: "counter",
    [proprietorId]: "hall",
  },
  seedImpacts: [{
    id: "impact:contract:door-knock",
    sourceCharacterId: "world:tavern-door",
    sourceZoneId: "threshold",
    type: "physical",
    modality: "sound",
    intensity: 88,
    radius: 3,
    content: "门板从外面响了两下。",
    topic: "门口出现未明动静",
  }],
  minimumActivationScore: 0,
  maxSteps: 2,
  async runAgent(input) {
    activations.push(input.agent.id);
    const candidate = input.privateActionCandidates.find((row) => row.feasible);
    assert.ok(candidate);
    return { decision: {
      candidateId: candidate.candidateId,
      actionType: "pass",
      speechAct: "none",
      targetCharacterId: "",
      speech: "",
      visibleAction: "",
      moveToZoneId: "",
      affordanceId: "",
      informationSourceImpactId: "",
      commitmentAction: "none",
      commitmentTopic: "",
      privateReason: "合同测试：本人此刻不行动。",
    } };
  },
});
assert.equal(activations.length, 2);
assert.notEqual(activations[0], activations[1], "a voluntary pass must yield the scheduling floor to another feasible present Agent");
assert.equal(fairness.actions.length, 0);

console.log("tavernCausalAgencyFloor:test passed", {
  ordinaryCoPresenceIsOptional: socialOpportunity.requiresResolution === false,
  availableSocialModes: socialOpportunity.realization.allowedSpeechActs,
  activationOrder: activations,
  noForcedActionCommitted: fairness.actions.length === 0,
});
