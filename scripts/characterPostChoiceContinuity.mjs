import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  createCharacterAgentMemoryState,
  encodeCharacterPerception,
} from "../src/engine/characterAgentMemory.js";
import {
  CHARACTER_POST_CHOICE_CONTINUITY_VERSION,
  settleCharacterPostChoiceContinuity,
  validateCharacterPostChoiceContinuityProposal,
} from "../src/server/simulation/characterPostChoiceContinuity.mjs";

const ACTOR = "actor_generic_17";
const DRIVE = "desire_earn_recognized_place";
const PRESSURE = "status_failure_pressure";
const CANDIDATE = "candidate_refuse_compromising_exchange";
const AFFORDANCE = "affordance_refuse_compromising_exchange";
const ACTION = "action_refuse_compromising_exchange";

function clone(value) {
  return structuredClone(value);
}

function baseMemory() {
  return createCharacterAgentMemoryState(ACTOR, {
    selfNarrative: {
      currentClaims: [{
        id: "self-claim:ambition-before-boundary",
        claim: "只要机会足够重要，我最终会让步。",
        confidence: 0.7,
      }],
      versions: [],
    },
  });
}

function memoryWithCommittedSelfAction() {
  return encodeCharacterPerception(baseMemory(), {
    impact: {
      id: `self-impact:${ACTION}`,
      objectiveEventId: ACTION,
      sourceCharacterId: ACTOR,
      type: "speech",
      modality: "self_action",
      content: "人物拒绝了会越过自身边界的交换。",
      topic: "有代价的拒绝",
      semanticFrame: {
        id: "frame:generic:costly-refusal",
        kind: "major_choice",
        predicate: "refuse_compromising_exchange",
        topicId: "recognized_place_exchange",
        roles: { actor: ACTOR },
        importance: 0.9,
      },
      provenance: {
        kind: "self_action",
        sourceActionId: ACTION,
        speakerCharacterId: ACTOR,
      },
    },
    delivery: {
      id: `self-delivery:${ACTION}`,
      impactId: `self-impact:${ACTION}`,
      objectiveEventId: ACTION,
      recipientId: ACTOR,
      sourceCharacterId: ACTOR,
      modality: "self_action",
      content: "人物拒绝了会越过自身边界的交换。",
      topic: "有代价的拒绝",
      directed: true,
      receivedIntensity: 100,
      personalRelevance: 70,
      impactScore: 170,
      semanticFrame: {
        id: "frame:generic:costly-refusal",
        kind: "major_choice",
        predicate: "refuse_compromising_exchange",
        topicId: "recognized_place_exchange",
        roles: { actor: ACTOR },
        importance: 0.9,
      },
      provenance: {
        kind: "self_action",
        sourceActionId: ACTION,
        speakerCharacterId: ACTOR,
      },
    },
    nowSeconds: 120,
    locationId: "scene_generic_3",
    zoneId: "private_room",
    desireIds: [DRIVE],
  });
}

function baseEcology() {
  return {
    characterId: ACTOR,
    elapsedSeconds: 120,
    desires: {
      [DRIVE]: {
        desireId: DRIVE,
        strength: 0.82,
        satisfaction: 0,
        frustration: 0.28,
        urgency: 0.61,
        cue: 0.4,
        cueActivation: 0.4,
        lastSatisfiedAtSecond: null,
        lastBlockedAtSecond: null,
      },
    },
    currentIntention: {
      intentionId: `intention:${DRIVE}`,
      sourceKind: "desire",
      sourceId: DRIVE,
      driveId: DRIVE,
    },
  };
}

function consequentialProposal() {
  return {
    phase: "pending_world_resolution",
    choiceSignificance: "consequential",
    actionMemory: {
      mode: "encode_if_committed",
      content: "我拒绝了一条能推进目标、却要求我越过自身边界的交换。",
      basisIds: [CANDIDATE],
    },
    desireContinuity: [{
      desireId: DRIVE,
      status: "remains_unresolved",
      pressureDirection: "increase",
      strengthBand: "medium",
      settlementCondition: "action_committed",
      reason: "拒绝守住了边界，却没有得到真正想要的结果。",
      basisIds: [DRIVE, CANDIDATE],
    }],
    dynamicStateContinuity: [{
      stateId: PRESSURE,
      direction: "increase",
      strengthBand: "medium",
      settlementCondition: "action_committed",
      linkedDesireId: "",
      reason: "真实机会已经失去，失败压力仍在。",
      basisIds: [PRESSURE, CANDIDATE],
    }],
    selfNarrative: {
      mode: "revision_candidate",
      proposedClaim: "即使机会很重要，我也可能拒绝越过自己的边界。",
      replacesClaimIds: ["self-claim:ambition-before-boundary"],
      significanceBand: "high",
      permanenceBand: "high",
      basisIds: [CANDIDATE],
      consolidationStatus: "pending_committed_owned_episode",
    },
  };
}

const proposal = consequentialProposal();
const proposalValidation = validateCharacterPostChoiceContinuityProposal(proposal, {
  chosenCandidateId: CANDIDATE,
  knownBasisIds: [CANDIDATE, DRIVE, PRESSURE],
  desireIds: [DRIVE],
  dynamicStateIds: [PRESSURE],
  ownedSelfClaimIds: ["self-claim:ambition-before-boundary"],
  requiredDesireIds: [DRIVE],
});
assert.equal(proposalValidation.valid, true, JSON.stringify(proposalValidation.errors));

const affordanceBoundActionMemory = clone(proposal);
affordanceBoundActionMemory.actionMemory.basisIds = [AFFORDANCE];
assert.equal(
  validateCharacterPostChoiceContinuityProposal(affordanceBoundActionMemory, {
    chosenCandidateId: CANDIDATE,
    chosenActionBasisIds: [AFFORDANCE],
    knownBasisIds: [CANDIDATE, AFFORDANCE, DRIVE, PRESSURE],
    desireIds: [DRIVE],
    dynamicStateIds: [PRESSURE],
    ownedSelfClaimIds: ["self-claim:ambition-before-boundary"],
    requiredDesireIds: [DRIVE],
  }).valid,
  true,
  "an action memory may bind to the exact affordance of the chosen action without copying the private candidate id",
);

const unrelatedActionMemoryBasis = clone(proposal);
unrelatedActionMemoryBasis.actionMemory.basisIds = ["affordance_other_action"];
assert.ok(
  validateCharacterPostChoiceContinuityProposal(unrelatedActionMemoryBasis, {
    chosenCandidateId: CANDIDATE,
    chosenActionBasisIds: [AFFORDANCE],
    knownBasisIds: [CANDIDATE, AFFORDANCE, "affordance_other_action", DRIVE, PRESSURE],
    desireIds: [DRIVE],
    dynamicStateIds: [PRESSURE],
    ownedSelfClaimIds: ["self-claim:ambition-before-boundary"],
    requiredDesireIds: [DRIVE],
  }).errors.some((entry) => entry.code === "CONTINUITY_ACTION_MEMORY_CHOICE_BASIS_MISSING"),
  "an unrelated affordance must not bind action memory to the chosen action",
);

const premature = clone(proposal);
premature.phase = "committed";
assert.ok(
  validateCharacterPostChoiceContinuityProposal(premature, {
    chosenCandidateId: CANDIDATE,
    knownBasisIds: [CANDIDATE, DRIVE, PRESSURE],
    desireIds: [DRIVE],
    dynamicStateIds: [PRESSURE],
  }).errors.some((entry) => entry.code === "CONTINUITY_PHASE_NOT_PENDING"),
  "the Character Agent may only propose continuity before the world resolves the action",
);

const unknownDesire = clone(proposal);
unknownDesire.desireContinuity[0].desireId = "desire_invented_for_this_answer";
assert.ok(
  validateCharacterPostChoiceContinuityProposal(unknownDesire, {
    chosenCandidateId: CANDIDATE,
    knownBasisIds: [CANDIDATE, DRIVE, PRESSURE, "desire_invented_for_this_answer"],
    desireIds: [DRIVE],
    dynamicStateIds: [PRESSURE],
  }).errors.some((entry) => entry.code === "CONTINUITY_DESIRE_UNKNOWN"),
  "a continuity proposal may not invent a new desire to justify this answer",
);

const forecastWithoutEvidenceGate = clone(proposal);
forecastWithoutEvidenceGate.desireContinuity[0].status = "progress_if_verified";
forecastWithoutEvidenceGate.desireContinuity[0].settlementCondition = "action_committed";
assert.ok(
  validateCharacterPostChoiceContinuityProposal(forecastWithoutEvidenceGate, {
    chosenCandidateId: CANDIDATE,
    knownBasisIds: [CANDIDATE, DRIVE, PRESSURE],
    desireIds: [DRIVE],
    dynamicStateIds: [PRESSURE],
    ownedSelfClaimIds: ["self-claim:ambition-before-boundary"],
  }).errors.some((entry) => entry.code === "CONTINUITY_PROGRESS_WITHOUT_VERIFICATION"),
  "a projected benefit may not settle merely because the attempt itself committed",
);

const stableLinkedState = clone(proposal);
stableLinkedState.dynamicStateContinuity[0] = {
  ...stableLinkedState.dynamicStateContinuity[0],
  direction: "stable",
  settlementCondition: "action_committed",
  linkedDesireId: DRIVE,
  reason: "这次行动没有改变与目标相关的失败压力。",
};
assert.equal(
  validateCharacterPostChoiceContinuityProposal(stableLinkedState, {
    chosenCandidateId: CANDIDATE,
    knownBasisIds: [CANDIDATE, DRIVE, PRESSURE],
    desireIds: [DRIVE],
    dynamicStateIds: [PRESSURE],
    ownedSelfClaimIds: ["self-claim:ambition-before-boundary"],
    requiredDesireIds: [DRIVE],
  }).valid,
  true,
  "a stable dynamic-state row may cite the owned desire that explains why it remains unchanged",
);

const changingLinkedWithoutEvidenceGate = clone(stableLinkedState);
changingLinkedWithoutEvidenceGate.dynamicStateContinuity[0].direction = "increase";
assert.ok(
  validateCharacterPostChoiceContinuityProposal(changingLinkedWithoutEvidenceGate, {
    chosenCandidateId: CANDIDATE,
    knownBasisIds: [CANDIDATE, DRIVE, PRESSURE],
    desireIds: [DRIVE],
    dynamicStateIds: [PRESSURE],
    ownedSelfClaimIds: ["self-claim:ambition-before-boundary"],
    requiredDesireIds: [DRIVE],
  }).errors.some((entry) => entry.code === "CONTINUITY_DYNAMIC_LINK_UNNEEDED"),
  "a changing desire-dependent state must still wait for verified desire evidence",
);

const stableUnknownLinkedDesire = clone(stableLinkedState);
stableUnknownLinkedDesire.dynamicStateContinuity[0].linkedDesireId = "desire_not_owned";
assert.ok(
  validateCharacterPostChoiceContinuityProposal(stableUnknownLinkedDesire, {
    chosenCandidateId: CANDIDATE,
    knownBasisIds: [CANDIDATE, DRIVE, PRESSURE],
    desireIds: [DRIVE],
    dynamicStateIds: [PRESSURE],
    ownedSelfClaimIds: ["self-claim:ambition-before-boundary"],
    requiredDesireIds: [DRIVE],
  }).errors.some((entry) => entry.code === "CONTINUITY_DYNAMIC_LINKED_DESIRE_UNKNOWN"),
  "descriptive continuity may only cite a desire actually owned by this character",
);

const memoryBefore = baseMemory();
const ecologyBefore = baseEcology();
const dynamicBefore = { [PRESSURE]: 0.74 };
const rejectedByWorld = settleCharacterPostChoiceContinuity({
  characterId: ACTOR,
  proposal,
  action: { id: ACTION, actorId: ACTOR, committed: false },
  worldOutcome: { committed: false, significance: 0.95, evidenceIds: [] },
  memoryState: memoryBefore,
  ecologyState: ecologyBefore,
  dynamicState: dynamicBefore,
  nowSeconds: 140,
});
assert.equal(rejectedByWorld.status, "not_committed");
assert.deepEqual(rejectedByWorld.memoryState, memoryBefore, "an uncommitted action must not write memory or identity");
assert.deepEqual(rejectedByWorld.ecologyState, ecologyBefore, "an uncommitted action must not change desire pressure");
assert.deepEqual(rejectedByWorld.dynamicState, dynamicBefore, "an uncommitted action must not change dynamic psychology");

const invalidPhaseSettlement = settleCharacterPostChoiceContinuity({
  characterId: ACTOR,
  proposal: premature,
  action: { id: ACTION, actorId: ACTOR, committed: true, candidateId: CANDIDATE },
  worldOutcome: { committed: true, significance: 0.95, evidenceIds: [ACTION] },
  memoryState: memoryWithCommittedSelfAction(),
  ecologyState: ecologyBefore,
  dynamicState: dynamicBefore,
  nowSeconds: 140,
  validationContext: {
    knownBasisIds: [CANDIDATE, DRIVE, PRESSURE],
  },
});
assert.equal(invalidPhaseSettlement.status, "invalid_proposal");
assert.deepEqual(invalidPhaseSettlement.ecologyState, ecologyBefore,
  "the settlement boundary must reject an invalid proposal even if its caller forgot pre-validation");
assert.deepEqual(invalidPhaseSettlement.dynamicState, dynamicBefore);

const committedMemory = memoryWithCommittedSelfAction();
const committed = settleCharacterPostChoiceContinuity({
  characterId: ACTOR,
  proposal,
  action: { id: ACTION, actorId: ACTOR, committed: true },
  worldOutcome: {
    committed: true,
    significance: 0.9,
    evidenceIds: [ACTION, "outcome:opportunity-expired"],
  },
  memoryState: committedMemory,
  ecologyState: ecologyBefore,
  dynamicState: dynamicBefore,
  nowSeconds: 140,
});
assert.equal(committed.schemaVersion, CHARACTER_POST_CHOICE_CONTINUITY_VERSION);
assert.equal(committed.status, "settled");
assert.equal(committed.actionMemory.committed, true);
assert.equal(committed.ecologyState.desires[DRIVE].satisfaction, 0,
  "a costly refusal must not pretend the still-unmet desire was satisfied");
assert.ok(committed.ecologyState.desires[DRIVE].frustration > ecologyBefore.desires[DRIVE].frustration,
  "an unresolved desire may carry increased frustration into the next turn");
assert.ok(committed.ecologyState.desires[DRIVE].urgency > ecologyBefore.desires[DRIVE].urgency,
  "the shared psychology tool must preserve changed pressure after the action");
assert.ok(committed.dynamicState[PRESSURE] > dynamicBefore[PRESSURE]);
assert.equal(committed.memoryState.selfNarrative.versions.length, 1,
  "a world-confirmed consequential choice with an owned episode may revise self-narrative");
assert.equal(
  committed.memoryState.selfNarrative.versions[0].previousClaims[0].claim,
  "只要机会足够重要，我最终会让步。",
  "identity revision must preserve the earlier self-understanding as history",
);
assert.equal(
  committed.memoryState.selfNarrative.currentClaims[0].claim,
  "即使机会很重要，我也可能拒绝越过自己的边界。",
);

const missingOwnedEpisode = settleCharacterPostChoiceContinuity({
  characterId: ACTOR,
  proposal,
  action: { id: ACTION, actorId: ACTOR, committed: true },
  worldOutcome: { committed: true, significance: 0.9, evidenceIds: [ACTION] },
  memoryState: memoryBefore,
  ecologyState: ecologyBefore,
  dynamicState: dynamicBefore,
  nowSeconds: 140,
});
assert.equal(missingOwnedEpisode.memoryState.selfNarrative.versions.length, 0,
  "a consequential label without a personally owned action episode must not rewrite identity");
assert.ok(missingOwnedEpisode.errors.some((entry) => entry.code === "CONTINUITY_OWNED_ACTION_EPISODE_MISSING"));

const unverifiedProgressProposal = consequentialProposal();
unverifiedProgressProposal.desireContinuity[0] = {
  ...unverifiedProgressProposal.desireContinuity[0],
  status: "progress_if_verified",
  pressureDirection: "decrease",
  settlementCondition: "verified_progress",
  reason: "只有客观进展真正发生，推进压力才会下降。",
};
unverifiedProgressProposal.dynamicStateContinuity[0] = {
  ...unverifiedProgressProposal.dynamicStateContinuity[0],
  direction: "decrease",
  settlementCondition: "verified_desire_progress",
  linkedDesireId: DRIVE,
  reason: "只有同一欲望获得真实进展，失败压力才会下降。",
};
const noForecastAsOutcome = settleCharacterPostChoiceContinuity({
  characterId: ACTOR,
  proposal: unverifiedProgressProposal,
  action: { id: ACTION, actorId: ACTOR, committed: true },
  worldOutcome: { committed: true, significance: 0.9, evidenceIds: [ACTION] },
  memoryState: committedMemory,
  ecologyState: ecologyBefore,
  dynamicState: dynamicBefore,
  nowSeconds: 140,
});
assert.equal(
  noForecastAsOutcome.ecologyState.desires[DRIVE].frustration,
  ecologyBefore.desires[DRIVE].frustration,
  "a committed attempt without verified progress must not receive its forecast psychological payoff",
);
assert.equal(noForecastAsOutcome.dynamicState[PRESSURE], dynamicBefore[PRESSURE]);
assert.equal(noForecastAsOutcome.desireSettlements[0].settlementConditionMet, false);

const alreadySatisfiedEcology = baseEcology();
alreadySatisfiedEcology.desires[DRIVE].satisfaction = 1;
alreadySatisfiedEcology.desires[DRIVE].frustration = 0.05;
alreadySatisfiedEcology.desires[DRIVE].urgency = 0.08;
alreadySatisfiedEcology.lastOutcome = {
  status: "applied",
  satisfactionEvidence: [{
    driveId: DRIVE,
    evidenceId: "outcome:verified-resolution",
    conditionMet: true,
    fullySatisfied: true,
  }],
};
const worldEvidenceWins = settleCharacterPostChoiceContinuity({
  characterId: ACTOR,
  proposal,
  action: { id: ACTION, actorId: ACTOR, committed: true },
  worldOutcome: {
    committed: true,
    significance: 0.9,
    evidenceIds: [ACTION, "outcome:verified-resolution"],
  },
  memoryState: committedMemory,
  ecologyState: alreadySatisfiedEcology,
  dynamicState: dynamicBefore,
  nowSeconds: 140,
});
assert.equal(worldEvidenceWins.ecologyState.desires[DRIVE].satisfaction, 1);
assert.equal(worldEvidenceWins.ecologyState.desires[DRIVE].frustration, 0.05,
  "the Agent's pre-action projection may not override verified world resolution");
assert.ok(worldEvidenceWins.errors.some((entry) => entry.code === "CONTINUITY_DESIRE_STATUS_OVERRIDDEN_BY_WORLD"));

const genericSource = await readFile(
  new URL("../src/server/simulation/characterPostChoiceContinuity.mjs", import.meta.url),
  "utf8",
);
for (const forbidden of ["周珉", "谢真石", "酒馆", "char_xyy", "望梯"]) {
  assert.equal(genericSource.includes(forbidden), false, `generic continuity core contains story token ${forbidden}`);
}

console.log("characterPostChoiceContinuity:test passed", {
  schemaVersion: committed.schemaVersion,
  uncommittedWrites: 0,
  unresolvedDesirePreserved: true,
  ownedEpisodeRequired: true,
  verifiedWorldEvidenceWins: true,
});
