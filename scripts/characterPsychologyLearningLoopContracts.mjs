import assert from "node:assert/strict";

import {
  advanceCharacterPsychologyCarryover,
  computeCharacterPsychologySnapshot,
  computeCharacterRegulationOutcome,
  evaluateCharacterAgentCandidates,
  reconcileCharacterPerceivedOutcome,
} from "../src/server/simulation/characterPsychologyTools.mjs";
import { selectNextCausalAgent } from "../src/server/pipeline/tavernCausalScene.mjs";

const DESIRE = "desire:generic:verify-target";
const TARGET = "perceived_entity:target";
const FIRST_TURN = "agent-turn:generic:learning:1";
const SECOND_TURN = "agent-turn:generic:learning:2";

const relationshipMeaning = {
  affiliation: 0,
  status: 0,
  trust: 0,
  rejection: 0,
  care: 0,
  betrayal: 0,
};

function subjectiveAppraisal({ agentTurnId, prior = null, noticedEvidenceIds = [] } = {}) {
  return {
    ownerAuthority: "character-agent",
    appraisalId: `appraisal:${agentTurnId}`,
    agentTurnId,
    eventId: `event:${agentTurnId}`,
    noticedEvidenceIds,
    interpretations: [],
    beliefOperations: [],
    relevanceLinks: [{ sourceId: DESIRE, relation: "still-unresolved", strength: 0.72, confidence: 0.8 }],
    appraisalAxes: {
      selfRelevance: 0.72,
      goalCongruence: prior ? -0.08 : 0.42,
      novelty: prior ? 0.02 : 0.48,
      expectedness: prior ? 0.68 : -0.18,
      opportunityValue: 0.58,
      threat: 0.08,
      controllability: 0.66,
      changeability: 0.62,
      certaintyDelta: prior ? 0.02 : 0.36,
      normCompatibility: 0.5,
      selfImageCongruence: 0.34,
      publicExposure: 0.28,
      relationshipMeaning,
    },
    uncertainty: prior ? 0.52 : 0.44,
    alternativesConsidered: [],
    priorActionOutcomeAppraisal: prior || {
      ownerAuthority: "character-agent",
      sourceAgentTurnId: "",
      status: "no_prior_action",
      noticedOutcomeEvidenceIds: [],
      perceivedInformationGain: 0,
      perceivedGoalProgress: 0,
      perceivedCost: 0,
      unexpectedness: 0,
      stillUnresolved: false,
      summary: "",
    },
  };
}

function profile(overrides = {}) {
  return {
    personality: { selfControl: 0.7, persistence: 0.76 },
    regulation: { practicedSkill: 0.68 },
    behaviorLearning: {
      noGainThreshold: 0.14,
      goalProgressThreshold: 0.08,
      feedbackLearningRate: 0.8,
      repetitionSensitivity: 0.82,
      predictionErrorSensitivity: 0.86,
      persistenceInsulation: 0.68,
      compulsiveRepetitionBias: 0,
      continuationCommitmentWeight: 0.72,
      ...overrides,
    },
  };
}

const state = {
  mood: { valence: 0, arousal: 0.34 },
  body: { fatigue: 0.12, pain: 0 },
  feltSafety: 0.7,
  preparation: 0.5,
};
const desires = [{
  desireId: DESIRE,
  previousActivation: 0.62,
  retention: 0.94,
  cueMatch: 0.3,
  urgency: 0.34,
  frustration: 0.16,
}];
const observeCandidate = {
  originAuthority: "character-agent",
  candidateId: "candidate:observe-again",
  intention: "继续用同一种方式观察目标",
  attemptPrimitive: "observe",
  targetHandle: TARGET,
  perceivedPrerequisites: [],
  expectedEffects: [{ sourceId: DESIRE, direction: "advance", magnitude: 0.48, confidence: 0.72 }],
  factorInputs: {
    emotionCompatibility: 0.7,
    valueAndSelfImage: 0.72,
    relationshipMeaning: 0,
    informationGain: 0.82,
    habitAndIntentionContinuity: 0.78,
    bodyCost: 0.02,
    threatAndNormCost: 0.04,
    exposureAndRelationshipRisk: 0.04,
    opportunityAndSwitchingCost: 0.08,
    uncertaintyCost: 0.24,
  },
  timingIntent: "now",
  disclosureNeed: "none",
  uncertainty: 0.28,
};
const askCandidate = {
  ...structuredClone(observeCandidate),
  candidateId: "candidate:ask-next",
  intention: "换一种方式向目标取得回应",
  attemptPrimitive: "speak",
  factorInputs: {
    ...structuredClone(observeCandidate.factorInputs),
    informationGain: 0.64,
    habitAndIntentionContinuity: 0.42,
    exposureAndRelationshipRisk: 0.26,
  },
};

const firstAppraisal = subjectiveAppraisal({ agentTurnId: FIRST_TURN });
const firstFeedback = reconcileCharacterPerceivedOutcome({
  appraisal: firstAppraisal,
  previous: {},
  profile: profile(),
  worldProjection: { scene: { characterElapsedSeconds: 10 }, evidence: [] },
});
const firstSnapshot = computeCharacterPsychologySnapshot({
  agentTurnId: FIRST_TURN,
  appraisal: firstAppraisal,
  profile: profile(),
  state,
  desires,
  outcomeFeedback: firstFeedback,
});
const firstEvaluation = evaluateCharacterAgentCandidates({
  agentTurnId: FIRST_TURN,
  candidates: [observeCandidate, askCandidate],
  snapshot: firstSnapshot,
  profile: profile(),
  state,
  outcomeFeedback: firstFeedback,
});
assert.equal(firstEvaluation.selection, null);
const firstRegulation = computeCharacterRegulationOutcome({
  agentTurnId: FIRST_TURN,
  snapshot: firstSnapshot,
  profile: profile(),
  state,
  regulationChoice: {
    ownerAuthority: "character-agent",
    regulationChoiceId: "regulation:learning:1",
    strategies: [],
  },
});
const firstObserveEvaluation = firstEvaluation.evaluations.find((row) => row.candidateId === observeCandidate.candidateId);
const carryover = advanceCharacterPsychologyCarryover({
  previous: {},
  snapshot: firstSnapshot,
  regulationOutcome: firstRegulation,
  profile: profile(),
  objectiveOutcome: { authority: "world-resolution", outcomeId: "world:learning:1", status: "success", committed: true },
  selectedCandidate: observeCandidate,
  selectedEvaluation: firstObserveEvaluation,
  agentChoice: {
    continuationIntentions: [{
      ownerAuthority: "character-agent",
      intentionId: "intention:change-means-after-wait",
      triggerType: "elapsed_without_progress",
      intendedPrimitive: "speak",
      targetHandle: TARGET,
      linkedSourceIds: [DESIRE],
      minimumDelaySeconds: 5,
      triggerThreshold: 1,
      maxDeferrals: 2,
      privatePurpose: "若观察没有推进，就换一种手段。",
    }],
  },
  worldTimeSeconds: 10,
});
assert.equal(carryover.pendingActionForecast.predictedInformationGain, 0.82);
assert.equal(carryover.continuationIntentions.length, 1);

const secondAppraisal = subjectiveAppraisal({
  agentTurnId: SECOND_TURN,
  prior: {
    ownerAuthority: "character-agent",
    sourceAgentTurnId: FIRST_TURN,
    status: "perceived",
    noticedOutcomeEvidenceIds: [],
    perceivedInformationGain: 0.02,
    perceivedGoalProgress: 0,
    perceivedCost: 0.04,
    unexpectedness: 0.36,
    stillUnresolved: true,
    summary: "我看了，但没有得到足以改变判断的新东西。",
  },
});
const prematureDelayFeedback = reconcileCharacterPerceivedOutcome({
  appraisal: secondAppraisal,
  previous: {
    ...structuredClone(carryover),
    continuationIntentions: carryover.continuationIntentions.map((row) => ({
      ...row,
      triggerThreshold: 0.5,
    })),
  },
  profile: profile(),
  worldProjection: { scene: { characterElapsedSeconds: 12.5 }, evidence: [] },
});
assert.equal(
  prematureDelayFeedback.maturedContinuationIntentions.length,
  0,
  "minimumDelaySeconds is a hard earliest boundary; a low generic trigger threshold may not consume the plan halfway",
);
assert.equal(prematureDelayFeedback.continuationIntentions[0].reason, "authored_delay_not_elapsed");
const secondFeedback = reconcileCharacterPerceivedOutcome({
  appraisal: secondAppraisal,
  previous: carryover,
  profile: profile(),
  worldProjection: { scene: { characterElapsedSeconds: 20 }, evidence: [] },
});
assert.equal(secondFeedback.noGain, true);
assert.equal(secondFeedback.informationPredictionError, -0.8);
assert.equal(secondFeedback.elapsedWithoutProgressSeconds, 10);
assert.ok(secondFeedback.stagnationPressure > 0);
assert.ok(secondFeedback.opportunityDecayPressure > 0);
assert.equal(secondFeedback.maturedContinuationIntentions[0].intentionId, "intention:change-means-after-wait");
const secondState = { ...state, priorRegulationCarryover: carryover };
const secondSnapshot = computeCharacterPsychologySnapshot({
  agentTurnId: SECOND_TURN,
  appraisal: secondAppraisal,
  profile: profile(),
  state: secondState,
  desires,
  outcomeFeedback: secondFeedback,
});
const learnedEvaluation = evaluateCharacterAgentCandidates({
  agentTurnId: SECOND_TURN,
  candidates: [observeCandidate, askCandidate],
  snapshot: secondSnapshot,
  profile: profile(),
  state: secondState,
  outcomeFeedback: secondFeedback,
});
const unlearnedEvaluation = evaluateCharacterAgentCandidates({
  agentTurnId: SECOND_TURN,
  candidates: [observeCandidate, askCandidate],
  snapshot: secondSnapshot,
  profile: profile(),
  state,
  outcomeFeedback: {},
});
const learnedObserve = learnedEvaluation.evaluations.find((row) => row.candidateId === observeCandidate.candidateId);
const unlearnedObserve = unlearnedEvaluation.evaluations.find((row) => row.candidateId === observeCandidate.candidateId);
const learnedAsk = learnedEvaluation.evaluations.find((row) => row.candidateId === askCandidate.candidateId);
assert.ok(learnedObserve.expectedUtility < unlearnedObserve.expectedUtility, "no-gain prediction error must lower the repeated means without erasing the desire");
assert.ok(learnedAsk.learningTrace.continuationIntentionMaturity > 0, "an authored and matured short-term intention may increase a matching candidate tendency");
assert.equal(learnedEvaluation.selection, null, "learning modifiers must still leave choice to the Character Agent");
assert.ok(secondSnapshot.desireActivations[0].value >= firstSnapshot.desireActivations[0].value * 0.75, "means fatigue must not erase persistent desire activation");

const compulsiveEvaluation = evaluateCharacterAgentCandidates({
  agentTurnId: SECOND_TURN,
  candidates: [observeCandidate],
  snapshot: secondSnapshot,
  profile: profile({ compulsiveRepetitionBias: 1 }),
  state: secondState,
  outcomeFeedback: secondFeedback,
});
assert.ok(
  compulsiveEvaluation.evaluations[0].learningTrace.repetitionWithoutGain
    < learnedObserve.learningTrace.repetitionWithoutGain,
  "the same no-gain history must affect personalities with different repetition bias differently",
);

const firstRepeatedObservationAppraisal = subjectiveAppraisal({
  agentTurnId: "agent-turn:generic:novelty:1",
  prior: {
    ownerAuthority: "character-agent",
    sourceAgentTurnId: "agent-turn:generic:observe-source:1",
    status: "perceived",
    noticedOutcomeEvidenceIds: ["evidence:observation:same:1"],
    perceivedInformationGain: 0.8,
    perceivedGoalProgress: 0,
    perceivedCost: 0.01,
    unexpectedness: 0.05,
    stillUnresolved: true,
    summary: "我看见了目标手边同一件东西。",
  },
});
const repeatedObservationProjection = (evidenceId, featureText) => ({
  scene: { characterElapsedSeconds: 25 },
  evidence: [{
    evidenceId,
    sourceEntityHandle: TARGET,
    eventKind: "observation_result",
    semanticFrame: {
      observationResult: {
        attentionTags: ["weapon"],
        observableFeatures: [{ kind: "held_object", text: featureText, domainTags: ["weapon"] }],
      },
    },
  }],
});
const firstNoveltyFeedback = reconcileCharacterPerceivedOutcome({
  appraisal: firstRepeatedObservationAppraisal,
  previous: {
    pendingActionForecast: {
      sourceAgentTurnId: "agent-turn:generic:observe-source:1",
      sourceCandidateId: "candidate:observe-source:1",
      semanticSignature: "observe|target|weapon|desire|none",
      predictedInformationGain: 0.8,
      predictedGoalProgress: 0.1,
    },
    actionLearningHistory: [],
  },
  profile: profile(),
  worldProjection: repeatedObservationProjection("evidence:observation:same:1", "身上可见一柄入鞘长剑"),
});
assert.equal(firstNoveltyFeedback.evidenceNoveltyRatio, 1);
assert.equal(firstNoveltyFeedback.perceivedInformationGain, 0.8);

const secondRepeatedObservationAppraisal = subjectiveAppraisal({
  agentTurnId: "agent-turn:generic:novelty:2",
  prior: {
    ...structuredClone(firstRepeatedObservationAppraisal.priorActionOutcomeAppraisal),
    sourceAgentTurnId: "agent-turn:generic:observe-source:2",
    noticedOutcomeEvidenceIds: ["evidence:observation:same:2"],
  },
});
const repeatedNoveltyFeedback = reconcileCharacterPerceivedOutcome({
  appraisal: secondRepeatedObservationAppraisal,
  previous: {
    pendingActionForecast: {
      sourceAgentTurnId: "agent-turn:generic:observe-source:2",
      sourceCandidateId: "candidate:observe-source:2",
      semanticSignature: "observe|target|weapon|desire|none",
      predictedInformationGain: 0.8,
      predictedGoalProgress: 0.1,
    },
    actionLearningHistory: [{
      sourceAgentTurnId: firstNoveltyFeedback.sourceAgentTurnId,
      semanticSignature: firstNoveltyFeedback.semanticSignature,
      noGain: false,
      noticedOutcomeFeatureSignatures: firstNoveltyFeedback.noticedOutcomeFeatureSignatures,
    }],
  },
  profile: profile(),
  worldProjection: repeatedObservationProjection("evidence:observation:same:2", "身上可见一柄入鞘长剑"),
});
assert.equal(repeatedNoveltyFeedback.reportedPerceivedInformationGain, 0.8);
assert.equal(repeatedNoveltyFeedback.evidenceNoveltyRatio, 0);
assert.ok(repeatedNoveltyFeedback.perceivedInformationGain < 0.14);
assert.equal(repeatedNoveltyFeedback.noGain, true);

const stableMeansA = {
  ...structuredClone(observeCandidate),
  domains: ["weapon", "observation"],
  expectedEffects: [{ sourceId: "belief:temporary:first", direction: "probe", magnitude: 0.2, confidence: 0.8 }],
};
const stableMeansB = {
  ...structuredClone(stableMeansA),
  candidateId: "candidate:observe-paraphrased",
  intention: "换一种说法继续观察同一个目标",
  expectedEffects: [{ sourceId: "belief:temporary:second", direction: "probe", magnitude: 0.2, confidence: 0.8 }],
};
const stableMeansEvaluation = evaluateCharacterAgentCandidates({
  agentTurnId: SECOND_TURN,
  candidates: [stableMeansA, stableMeansB],
  snapshot: secondSnapshot,
  profile: profile(),
  state,
  outcomeFeedback: {},
});
assert.equal(
  stableMeansEvaluation.evaluations[0].learningTrace.semanticSignature,
  stableMeansEvaluation.evaluations[1].learningTrace.semanticSignature,
  "paraphrase and transient belief ids must not disguise the same behavioral means",
);

function wakeRuntime({ inbox = [], psychologyState = null, elapsedSeconds = 0 } = {}) {
  return {
    elapsedSeconds,
    lastActorId: "",
    actions: [],
    impacts: [],
    requestLocks: [],
    agents: {
      actor: {
        characterId: "actor",
        present: true,
        hasActed: true,
        intrinsicPressure: 0,
        cooldownUntilSeconds: 0,
        inbox,
        ecologySceneStartSeconds: 0,
        ecologyState: psychologyState ? { characterPsychologyV2State: psychologyState } : null,
      },
    },
  };
}
const emptyWorldState = { characters: [], relationships: [], tavernState: { activeVisits: [], institution: { guestPositions: [] } } };
assert.equal(
  selectNextCausalAgent(wakeRuntime(), { minimumScore: 0, state: emptyWorldState }),
  null,
  "a zero threshold may not fabricate an activation without impact, duty, desire pressure or an authored mature intention",
);
const impactWake = selectNextCausalAgent(wakeRuntime({
  inbox: [{
    id: "delivery:learning:1",
    impactId: "impact:learning:1",
    processedAtStep: null,
    noticedProjection: true,
    impactScore: 12,
    directed: true,
    sourceCharacterId: "target",
  }],
}), { minimumScore: 0, state: emptyWorldState });
assert.equal(impactWake.wakeBasis.kind, "external-impact");
const intentionWake = selectNextCausalAgent(wakeRuntime({
  elapsedSeconds: 10,
  psychologyState: {
    internalWakePressure: 0.1,
    continuationIntentions: [{
      intentionId: "intention:wake-after-delay",
      triggerType: "elapsed_without_progress",
      minimumDelaySeconds: 5,
      createdAtCharacterSeconds: 0,
      status: "active",
    }],
  },
}), { minimumScore: 34, state: emptyWorldState });
assert.equal(intentionWake.wakeBasis.kind, "continuation-intention");

console.log(JSON.stringify({
  status: "passed",
  checks: {
    agentOwnedPredictionRecorded: true,
    perceivedOutcomeReconciled: true,
    predictionErrorCalibratesRepeatedMeans: true,
    persistentDesireNotErased: true,
    personalityChangesRepetitionCost: true,
    repeatedEvidenceNoveltyCalibratesSelfReport: true,
    stableMeansSignatureIgnoresTransientBeliefIds: true,
    elapsedStagnationAndOpportunityPressureRemainNonSelecting: true,
    authoredContinuationIntentionMatures: true,
    mathematicsStillDoesNotSelect: true,
    noCauseNoWake: true,
    externalImpactWakes: true,
    internalPlanCanWake: true,
  },
}, null, 2));
