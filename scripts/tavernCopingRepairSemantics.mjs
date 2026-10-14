import assert from "node:assert/strict";

import { createInitialEcologyState, validateEcologyState } from "../src/server/ecology/tavernEcologyState.mjs";
import { getTavernEcologyProfile } from "../src/server/ecology/tavernEcologyProfile.mjs";
import {
  advanceTavernEcologyTime,
  appraiseTavernPerceivedEvent,
} from "../src/server/ecology/tavernEventAppraisal.mjs";
import { appraiseTavernAgentEcology } from "../src/server/pipeline/tavernEcologyRuntime.mjs";

const ACTOR = "char_xyy_xiemu";
const PEER = "char_xyy_zhoumin";
const profile = getTavernEcologyProfile(ACTOR);

function perceivedEvent({ id, content, outcomeValence = 0, threat = 0, repairOpportunity = 0 }) {
  const impact = {
    id,
    sourceCharacterId: PEER,
    type: "speech",
    modality: "sound",
    content,
    committed: true,
    outcomeValence,
    threat,
    repairOpportunity,
  };
  return {
    impact,
    delivery: {
      impactId: id,
      recipientId: ACTOR,
      sourceCharacterId: PEER,
      directed: true,
      receivedIntensity: 78,
      content,
    },
  };
}

const closeSafeRelationship = {
  closeness: 0.86,
  trust: 0.9,
  tension: 0.04,
  resentment: 0.02,
  fear: 0.01,
};

const neutralCoordination = appraiseTavernPerceivedEvent({
  profile,
  ecologyState: createInitialEcologyState(profile, { observableAtStage: true }),
  ...perceivedEvent({
    id: "impact:repair-semantics:neutral-coordination",
    content: "药先放在柜台，等能验收的人回来再说。",
  }),
  relationship: closeSafeRelationship,
});

assert.equal(neutralCoordination.applied, true);
assert.notEqual(
  neutralCoordination.copingBias.dominant,
  "repair",
  "closeness and trust alone must not invent a relationship rupture to repair",
);
assert.equal(
  Number(neutralCoordination.copingBias.repairNeed || 0),
  0,
  "neutral coordination in a safe relationship must carry no repair need",
);

const actualRupture = appraiseTavernPerceivedEvent({
  profile,
  ecologyState: createInitialEcologyState(profile, { observableAtStage: true }),
  ...perceivedEvent({
    id: "impact:repair-semantics:actual-rupture",
    content: "方才是我失信。你若肯听，我想把这件事说清。",
    outcomeValence: -0.5,
    threat: 0.22,
    repairOpportunity: 0.85,
  }),
  relationship: {
    closeness: 0.82,
    trust: 0.72,
    tension: 0.48,
    resentment: 0.16,
    fear: 0.04,
  },
});

assert.ok(actualRupture.copingBias.repairNeed >= 0.45, "verified strain plus an opening must create repair need");
assert.ok(
  actualRupture.copingBias.repair > neutralCoordination.copingBias.repair,
  "actual rupture evidence must raise repair coping above neutral coordination",
);
assert.equal(validateEcologyState(actualRupture.nextState, profile).valid, true, "repair need must remain valid private ecology state");

const decayedRupture = advanceTavernEcologyTime({
  profile,
  ecologyState: actualRupture.nextState,
  elapsedSeconds: 1800,
});
assert.ok(
  Math.abs(decayedRupture.copingBiases.repairNeed - actualRupture.copingBias.repairNeed / 2) < 1e-5,
  "repair need must decay instead of becoming a permanent relationship fact",
);

function responseCandidate(ecology) {
  return ecology.candidates.find((candidate) => candidate.id.includes("repair-semantics:followup"));
}

function runtimeResponse(ecologyState) {
  return appraiseTavernAgentEcology({
    character: { id: ACTOR, name: "测试人物甲", lifeState: { present: true }, ecologyState },
    runtime: {
      elapsedSeconds: 30,
      macroDay: 1,
      macroTick: 1,
      step: 0,
      slotContext: { slotId: "repair-semantics", slotLabel: "午后" },
      actions: [],
      commitments: [],
      requestLocks: [],
    },
    actor: { present: true, zoneId: "hall" },
    pendingImpacts: [{
      impactId: "impact:repair-semantics:followup",
      sourceCharacterId: PEER,
      directed: true,
      directedTargetId: ACTOR,
      type: "speech",
      modality: "sound",
      impactScore: 82,
      content: "你愿意现在谈谈吗？",
      topic: "当前谈话",
      provenance: { kind: "firsthand", sourceActionId: "action:repair-semantics:followup" },
    }],
    visibleCharacterIds: [PEER],
    availableAffordances: [],
    recentOwnActions: [],
    relationships: [{
      fromCharacterId: ACTOR,
      toCharacterId: PEER,
      dependence: 78,
      protection: 72,
      love: 68,
      resentment: 2,
      fear: 1,
      shame: 2,
      deception: 0,
    }],
  });
}

const safeResponse = responseCandidate(runtimeResponse(
  createInitialEcologyState(profile, {
    observableAtStage: true,
    affect: { valence: 0.3, arousal: 0.15, dominance: 0.25 },
  }),
));
assert.ok(safeResponse, "safe close-peer request must compile a response candidate");
assert.notEqual(
  safeResponse.expressionStrategy.mode,
  "relationship-repair",
  "ordinary close-peer coordination must not be rendered as relationship repair",
);
if (safeResponse.expressionStrategy.mode === "direct-engagement") {
  assert.equal(safeResponse.expressionStrategy.warmth, "warm", "safe closeness may warm direct engagement without calling it repair");
}

const ruptureResponse = responseCandidate(runtimeResponse(actualRupture.nextState));
assert.ok(ruptureResponse, "a strained close-peer request must compile a response candidate");
assert.equal(
  ruptureResponse.expressionStrategy.mode,
  "relationship-repair",
  `real repair need must remain available as a distinct expression strategy: ${JSON.stringify({ eventCoping: actualRupture.copingBias, runtimeCoping: ruptureResponse.copingBias })}`,
);

console.log("tavernCopingRepairSemantics:test passed", {
  neutralDominant: neutralCoordination.copingBias.dominant,
  neutralRepairNeed: neutralCoordination.copingBias.repairNeed,
  ruptureDominant: actualRupture.copingBias.dominant,
  ruptureRepairNeed: actualRupture.copingBias.repairNeed,
  decayedRepairNeed: decayedRupture.copingBiases.repairNeed,
  safeExpression: safeResponse.expressionStrategy,
  ruptureExpression: ruptureResponse.expressionStrategy,
});
