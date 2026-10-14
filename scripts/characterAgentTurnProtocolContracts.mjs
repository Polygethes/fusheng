import assert from "node:assert/strict";

import {
  attachCharacterAgentWorldOutcome,
  buildCharacterAgentStageInput,
  CHARACTER_AGENT_REFERENCE_CONTRACT_VERSION,
  CHARACTER_AGENT_TURN_PROTOCOL_VERSION,
  createCharacterAgentTurnSession,
  submitCharacterAgentCandidates,
  submitCharacterAgentChoiceAndRegulation,
  submitCharacterAgentExpressionPlan,
  submitCharacterAgentRealization,
  submitCharacterSubjectiveAppraisal,
} from "../src/server/simulation/characterAgentTurnProtocol.mjs";

const TURN = "turn:generic:protocol:1";
const ACTOR = "character:generic:1";
const EVIDENCE = "evidence:visitor:1";
const UNNOTICED_EVIDENCE = "evidence:background:unnoticed";
const TARGET = "perceived_entity:visitor:1";
const DESIRE = "desire:learn:1";
const WORLD_OBLIGATION = "complete_official_visit";

function noSharedActivity() {
  return {
    operation: "none", activityId: "", kind: "", participantIds: [], requestedZoneId: "", response: "none",
    boundaries: { intensity: "", propertyProtection: false, harmLimit: "", note: "" },
  };
}

function clone(value) {
  return structuredClone(value);
}

const session0 = createCharacterAgentTurnSession({
  agentTurnId: TURN,
  characterId: ACTOR,
  worldProjection: {
    authority: "recipient-specific-world-projection",
    evidence: [
      { evidenceId: EVIDENCE, modality: "visual", feature: "来客腰间佩剑，进门后先扫了一眼堂前" },
      { evidenceId: UNNOTICED_EVIDENCE, modality: "sound", feature: "远处有人放下茶碗" },
    ],
    perceivedCharacters: [{ id: TARGET, identityKnown: false }],
    affordances: [{ id: "affordance:continue-work", primitive: "interact" }],
    materialFacts: {
      institutionalEconomy: {
        obligations: [{ id: WORLD_OBLIGATION, description: "完成正式来访" }],
      },
    },
  },
  privateContext: {
    profile: {
      personality: { selfControl: 0.72 },
      regulation: { practicedSkill: 0.68, strategySkills: { suppress: 0.66 } },
    },
    state: { mood: { valence: 0, arousal: 0.3 }, body: { fatigue: 0.2 }, feltSafety: 0.62 },
    desires: [{ desireId: DESIRE, previousActivation: 0.48, cueMatch: 0.7, urgency: 0.28 }],
  },
});
assert.equal(session0.schemaVersion, CHARACTER_AGENT_TURN_PROTOCOL_VERSION);
assert.equal(session0.phase, "awaiting_subjective_appraisal");
const appraisalStageInput = buildCharacterAgentStageInput(session0);
assert.equal(appraisalStageInput.requestedOutput, "subjective_appraisal_only");
assert.equal(appraisalStageInput.referenceContract.schemaVersion, CHARACTER_AGENT_REFERENCE_CONTRACT_VERSION);
assert.deepEqual(appraisalStageInput.referenceContract.ownedPsychologicalSourceIds, [DESIRE]);
assert.equal(
  appraisalStageInput.referenceContract.fieldBindings["desireGroundings[].activationEvidenceIds[]"],
  "perceivedEvidenceIds",
);
assert.equal(
  appraisalStageInput.referenceContract.fieldBindings["desireGroundings[].activationPsychologicalSourceIds[]"],
  "ownedPsychologicalSourceIds",
);
assert.equal(
  appraisalStageInput.referenceContract.ownedPsychologicalSourceIds.includes(WORLD_OBLIGATION),
  false,
  "a visible world obligation must not become an owned psychological source",
);
assert.equal(
  JSON.stringify(appraisalStageInput.worldProjection).includes(WORLD_OBLIGATION),
  true,
  "the world obligation remains visible material for this Character Agent",
);

assert.throws(
  () => submitCharacterAgentCandidates(session0, []),
  (error) => error.code === "CHARACTER_AGENT_TURN_PHASE_VIOLATION",
  "candidates may not exist before this Character Agent appraises the event",
);

const appraisal = {
  ownerAuthority: "character-agent",
  appraisalId: "appraisal:protocol:1",
  agentTurnId: TURN,
  eventId: "event:visitor-arrival",
  noticedEvidenceIds: [EVIDENCE],
  interpretations: [{ evidenceIds: [EVIDENCE], meaning: "这名来客可能值得继续观察", confidence: 0.64 }],
  beliefOperations: [],
  epistemicPositions: [],
  relevanceLinks: [{ sourceId: DESIRE, relation: "advances", strength: 0.72, confidence: 0.64 }],
  desireGroundings: [{
    desireId: DESIRE,
    feltWant: "弄清这名来客是否值得继续留意",
    terminalExperience: "本人取得足够的第一手判断",
    terminalContractAcknowledged: true,
    promotedCriteria: [],
    activationState: "active",
    activationEvidenceIds: [EVIDENCE],
    activationPsychologicalSourceIds: [],
    missingActivationConditions: [],
    immediatePull: 0.62,
    currentlyPerceivedPossible: 0.58,
    inhibitors: [],
    acceptableTransformations: ["timing", "disclosure", "manner"],
    privateSummary: "观察和询问都只是取得判断的不同路径。",
  }],
  appraisalAxes: {
    selfRelevance: 0.58,
    goalCongruence: 0.48,
    novelty: 0.52,
    expectedness: -0.2,
    opportunityValue: 0.6,
    threat: 0.18,
    controllability: 0.6,
    changeability: 0.62,
    certaintyDelta: 0.3,
    normCompatibility: 0.4,
    selfImageCongruence: 0.1,
    publicExposure: 0.55,
    relationshipMeaning: {},
  },
  uncertainty: 0.42,
  alternativesConsidered: ["普通旅客", "需要继续观察的人"],
  priorActionOutcomeAppraisal: {
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
const beforeAppraisal = clone(session0);
assert.throws(
  () => submitCharacterSubjectiveAppraisal(session0, {
    ...clone(appraisal),
    relevanceLinks: [{ sourceId: WORLD_OBLIGATION, relation: "advances", strength: 0.5, confidence: 0.6 }],
  }),
  (error) => error.code === "CHARACTER_AGENT_APPRAISAL_REJECTED"
    && error.issues.some((row) => row.code === "SUBJECTIVE_APPRAISAL_SOURCE_UNKNOWN"),
  "world ids may influence appraisal but may not masquerade as private psychological sources",
);
const session1 = submitCharacterSubjectiveAppraisal(session0, appraisal);
assert.deepEqual(session0, beforeAppraisal, "protocol transitions must not mutate prior session state");
assert.equal(session1.phase, "awaiting_agent_candidates");
assert.equal(session1.psychologySnapshot.authority, "character-private-psychology-tool");
const candidateStageInput = buildCharacterAgentStageInput(session1);
assert.equal(candidateStageInput.requestedOutput, "character_generated_candidates_only");
assert.deepEqual(candidateStageInput.referenceContract.perceivedEvidenceIds, [EVIDENCE]);
assert.equal(
  JSON.stringify(candidateStageInput.worldProjection).includes(UNNOTICED_EVIDENCE),
  false,
  "after subjective appraisal, later stages must not receive delivered evidence this Character Agent did not notice",
);

const candidates = [{
  originAuthority: "character-agent",
  candidateId: "candidate:quiet-observation",
  intention: "不暴露目的，继续观察来客",
  attemptPrimitive: "observe",
  targetHandle: TARGET,
  perceivedPrerequisites: [EVIDENCE],
  domains: ["social"],
  expectedEffects: [{ sourceId: DESIRE, direction: "advance", magnitude: 0.35, confidence: 0.68 }],
  desireRelations: [{ desireId: DESIRE, relation: "probe", terminalConditionMatch: 0.28, counterfactualResult: "多取得一项来客特征", preservesNonSubstitutableConditions: false, confidence: 0.68 }],
  criterionUses: [],
  epistemicHandling: {
    positionIds: [],
    mode: "not_relevant",
    errorIfWrong: 0,
    actionReversibility: 1,
    learningDuringAction: 0,
    delayCost: 0,
    privateReason: "",
  },
  sharedActivity: noSharedActivity(),
  factorInputs: { informationGain: 0.42, valueAndSelfImage: 0.62, uncertaintyCost: 0.28 },
  timingIntent: "now",
  disclosureNeed: "none",
  uncertainty: 0.32,
}, {
  originAuthority: "character-agent",
  candidateId: "candidate:direct-question",
  intention: "用一个问题直接试探来客目的",
  attemptPrimitive: "speak",
  targetHandle: TARGET,
  perceivedPrerequisites: [EVIDENCE],
  domains: ["social"],
  expectedEffects: [{ sourceId: DESIRE, direction: "advance", magnitude: 0.72, confidence: 0.58 }],
  desireRelations: [{ desireId: DESIRE, relation: "probe", terminalConditionMatch: 0.48, counterfactualResult: "取得来客的直接回应", preservesNonSubstitutableConditions: false, confidence: 0.58 }],
  criterionUses: [],
  epistemicHandling: {
    positionIds: [],
    mode: "not_relevant",
    errorIfWrong: 0,
    actionReversibility: 1,
    learningDuringAction: 0,
    delayCost: 0,
    privateReason: "",
  },
  sharedActivity: noSharedActivity(),
  factorInputs: { informationGain: 0.78, valueAndSelfImage: 0.48, exposureAndRelationshipRisk: 0.48, uncertaintyCost: 0.4 },
  timingIntent: "now",
  disclosureNeed: "partial",
  uncertainty: 0.44,
}];
const candidateWithWorldSource = clone(candidates);
candidateWithWorldSource[0].expectedEffects[0].sourceId = WORLD_OBLIGATION;
assert.throws(
  () => submitCharacterAgentCandidates(session1, candidateWithWorldSource),
  (error) => error.code === "CHARACTER_AGENT_CANDIDATES_REJECTED"
    && error.issues.some((row) => row.code === "AGENT_CANDIDATE_EFFECT_SOURCE_UNKNOWN"),
  "candidate effects must cite this character's owned psychological sources",
);
const candidateUsingUnnoticedEvidence = clone(candidates);
candidateUsingUnnoticedEvidence[0].perceivedPrerequisites = [UNNOTICED_EVIDENCE];
assert.throws(
  () => submitCharacterAgentCandidates(session1, candidateUsingUnnoticedEvidence),
  (error) => error.code === "CHARACTER_AGENT_CANDIDATES_REJECTED"
    && error.issues.some((row) => row.code === "AGENT_CANDIDATE_EVIDENCE_UNKNOWN"),
  "a later-stage candidate may not use evidence this Character Agent left unnoticed",
);
const projectedCandidateStageInput = buildCharacterAgentStageInput(session1);
assert.equal(
  projectedCandidateStageInput.privateContext.psychologyAnchor,
  undefined,
  "candidate generation receives a stage-specific projection instead of a second full foundation copy",
);
assert.equal(projectedCandidateStageInput.privateContext.authority, "character-private-candidate-context-projection");
const session2 = submitCharacterAgentCandidates(session1, candidates);
assert.equal(session2.phase, "awaiting_agent_choice_and_regulation");
assert.equal(session2.candidateEvaluation.selection, null);
const choiceStageInput = buildCharacterAgentStageInput(session2);
assert.equal(choiceStageInput.requestedOutput, "selected_candidate_regulation_and_automatic_impulse_only");
assert.equal(
  choiceStageInput.subjectiveAppraisal.interpretations,
  undefined,
  "choice receives pressures and unresolved positions without another full interpretation-prose copy",
);
assert.equal(
  choiceStageInput.subjectiveAppraisal.authority,
  "character-private-choice-relevant-appraisal-projection",
);

const predictedTop = session2.candidateEvaluation.evaluations
  .slice()
  .sort((left, right) => right.predictedTendencyProbability - left.predictedTendencyProbability)[0].candidateId;
const selected = candidates.map((row) => row.candidateId).find((id) => id !== predictedTop);
const choice = {
  ownerAuthority: "character-agent",
  agentTurnId: TURN,
  selectedCandidateId: selected,
  regulationChoice: {
    ownerAuthority: "character-agent",
    regulationChoiceId: "regulation:protocol:1",
    agentTurnId: TURN,
    strategies: [{ strategy: "suppress", targetEmotionIds: ["curiosity", "anticipation"], effort: 0.58, contextFit: 0.64 }],
    intendedPublicEffect: "暂时不暴露注意焦点",
    acceptedCosts: ["控制消耗"],
  },
  goalPreservation: {
    preservedDesireIds: [],
    transformedDimensions: ["disclosure", "manner"],
    terminalExperiencePreserved: false,
    acceptedDelay: false,
    acceptedResidualFrustration: 0.2,
    privateBasis: "本轮只取得局部证据，不把试探说成已经完成判断。",
  },
  automaticCommunicationImpulse: {
    ownerAuthority: "character-agent",
    impulseId: "impulse:protocol:1",
    mode: selected === "candidate:direct-question" ? "speech" : "silence",
    triggerEvidenceIds: [EVIDENCE],
    discourseAnchorIds: [],
    motiveSourceIds: [DESIRE],
    perceivedTurnDemand: selected === "candidate:direct-question" ? "是否向陌生来客打开一个回答入口" : "是否继续保持沉默观察",
    feltTendency: selected === "candidate:direct-question" ? "直接问来处" : "不说，继续手边动作",
    urgency: 0.48,
    disclosurePressure: selected === "candidate:direct-question" ? 0.42 : 0.08,
    inhibitionPressure: 0.62,
    conflict: { present: true, opposingSourceIds: [DESIRE], description: "好奇推动询问，谨慎又要求少暴露。" },
  },
  continuationIntentions: [],
  privateDecisionBasis: "当前宁可承担较低的信息收益，也不完全服从数学预测。",
};

const regulatedExpressionPlan = {
  ownerAuthority: "character-agent",
  sourceImpulseId: "impulse:protocol:1",
  impulseTransformation: { treatment: "mask", privateBasis: "保留询问或观察方向，但压低暴露程度。" },
  mode: selected === "candidate:direct-question" ? "mixed" : "nonverbal",
  actionIntent: selected === "candidate:direct-question" ? "维持手边动作，向来客抛出一个可回答的问题" : "继续手边动作，只让短暂注意被看见",
  communicationPlan: {
    goal: selected === "candidate:direct-question" ? "obtain_information" : "conceal",
    tactic: selected === "candidate:direct-question" ? "direct" : "silence",
    disclosure: selected === "candidate:direct-question" ? "partial" : "withhold",
    epistemicRelation: selected === "candidate:direct-question" ? "uncertain" : "not_applicable",
    intendedAudienceCharacterIds: selected === "candidate:direct-question" ? [TARGET] : [],
    desiredEffect: selected === "candidate:direct-question" ? "给来客一个回应入口" : "不公开自己的注意焦点",
    threadDisposition: selected === "candidate:direct-question" ? "open_new" : "none",
    epistemicActionCandidateId: "",
    presuppositionStance: "not_applicable",
    epistemicBasisEvidenceIds: [EVIDENCE],
    subtext: "注意已经发生，但判断仍留在本人这里",
  },
  speechMoment: {
    currentTurnDemand: selected === "candidate:direct-question" ? "是否向陌生来客打开一个回答入口" : "是否继续保持沉默观察",
    regulatedOpeningMove: selected === "candidate:direct-question" ? "直接问来处" : "不说，继续手边动作",
    minimumPublicDelta: selected === "candidate:direct-question" ? "询问来处" : "",
    listenerCanRespondAfterDelta: selected === "candidate:direct-question",
    expansionFunction: selected === "candidate:direct-question" ? "none" : "not_applicable",
    expansionPurpose: "",
    deferredOrImplied: ["本人正在留意来客", "判断来客的具体原因"],
    sharedContext: { anchorIds: [], treatment: "not_applicable", reopeningPurpose: "" },
  },
  nonverbalUndertone: "注意已经发生，但判断仍留在本人这里",
  privacyBoundary: "判断来客的具体原因仍属私下",
  relationshipStance: "对陌生来客保持距离",
  timing: "during_action",
  turnYield: selected === "candidate:direct-question" ? "yield" : "not_applicable",
};

const unrelatedCandidate = {
  ...clone(candidates[0]),
  candidateId: "candidate:continue-unrelated-duty",
  intention: "先处理与这条欲望无关的眼前职责，欲望本身仍留待以后",
  desireRelations: [{
    desireId: DESIRE,
    relation: "unrelated",
    terminalConditionMatch: 0,
    counterfactualResult: "职责完成不推进这条欲望，也不拿职责冒充本人想要的经验",
    preservesNonSubstitutableConditions: true,
    confidence: 0.94,
  }],
};
const unrelatedSession = submitCharacterAgentCandidates(session1, [unrelatedCandidate]);
const unrelatedChoice = {
  ...clone(choice),
  selectedCandidateId: unrelatedCandidate.candidateId,
  goalPreservation: {
    ...clone(choice.goalPreservation),
    preservedDesireIds: [DESIRE],
    terminalExperiencePreserved: true,
    acceptedDelay: true,
    privateBasis: "本轮职责与这条欲望无关，但人物没有放弃它，也没有拿职责替换它。",
  },
};
assert.doesNotThrow(
  () => submitCharacterAgentChoiceAndRegulation(unrelatedSession, unrelatedChoice),
  "an unrelated present action may leave a character's terminal desire intact",
);

const substituteCandidate = {
  ...clone(candidates[0]),
  candidateId: "candidate:cheap-substitute",
  intention: "用旁观所得冒充本人真正想要的第一手经验",
  desireRelations: [{
    desireId: DESIRE,
    relation: "substitute",
    terminalConditionMatch: 0,
    counterfactualResult: "只得到代理信息，却把它当成终局经验",
    preservesNonSubstitutableConditions: true,
    confidence: 0.96,
  }],
};
const substituteSession = submitCharacterAgentCandidates(session1, [substituteCandidate]);
const substituteChoice = {
  ...clone(choice),
  selectedCandidateId: substituteCandidate.candidateId,
  goalPreservation: {
    ...clone(choice.goalPreservation),
    preservedDesireIds: [DESIRE],
    terminalExperiencePreserved: true,
    privateBasis: "错误地声称代理目标保留了终局经验。",
  },
};
assert.throws(
  () => submitCharacterAgentChoiceAndRegulation(substituteSession, substituteChoice),
  (error) => error.code === "CHARACTER_AGENT_CHOICE_REJECTED"
    && error.issues.some((row) => row.code === "CHARACTER_AGENT_GOAL_PRESERVATION_CONTRADICTION"),
  "a cheap substitute must still be rejected as terminal-experience preserving",
);

const session3 = submitCharacterAgentChoiceAndRegulation(session2, choice);
assert.equal(session3.phase, "awaiting_agent_expression_planning");
assert.equal(session3.agentChoice.selectedCandidateId, selected, "the protocol must preserve a non-maximum Agent choice");
assert.equal(session3.regulationOutcome.selection, null);
assert.equal(buildCharacterAgentStageInput(session3).requestedOutput, "regulated_expression_plan_only");
const selectedIntention = candidates.find((row) => row.candidateId === selected).intention;
assert.equal(
  buildCharacterAgentStageInput(session3).selectedAction.intention,
  selectedIntention,
  "expression planning receives the chosen candidate's own free-text intention",
);
const session4 = submitCharacterAgentExpressionPlan(session3, regulatedExpressionPlan);
assert.equal(session4.phase, "awaiting_agent_realization");
assert.equal(buildCharacterAgentStageInput(session4).requestedOutput, "character_realization_only");
assert.equal(
  buildCharacterAgentStageInput(session4).selectedAction.intention,
  undefined,
  "the raw candidate brief stops before wording; realization inherits the locked primitive, binding and the plan's actionIntent",
);
assert.equal(
  buildCharacterAgentStageInput(session4).selectedAction.attemptPrimitive,
  candidates.find((row) => row.candidateId === selected).attemptPrimitive,
  "the locked action identity still reaches realization",
);

const literalSpeech = selected === "candidate:direct-question" ? "客官，从哪儿来？" : "";
const requiredEmotionHandling = Object.entries(session4.regulationOutcome.channelLeakagePressures || {})
  .filter(([, value]) => Number(value) >= 0.6)
  .map(([channel]) => ({ channel, handling: "masked", basis: "本人继续消耗控制力，不让这个高残余通道直接外显" }));
const realization = {
  ownerAuthority: "character-agent",
  agentTurnId: TURN,
  emotionHandling: [
    ...requiredEmotionHandling,
    ...(!requiredEmotionHandling.some((row) => row.channel === "attentionLock")
      ? [{ channel: "attentionLock", handling: "masked", basis: "把目光重新落回手边物件" }]
      : []),
  ],
  surfaceRealization: {
    timing: "during_action",
    affectiveTexture: [{ cue: "gaze_lowered", channel: "gaze", modality: "visual", feature: "目光垂下。" }],
    relationshipRegister: "对陌生来客保持距离",
    appliedVoiceParameters: { directness: 0.52, compression: 0.58, warmth: 0.22, reserve: 0.68, formality: 0.36, emotionalLeakage: 0.28 },
    intentionalDepartureReason: "",
    selfCheck: {
      addsPrivateExplanation: false,
      interchangeableAcrossCharacters: false,
      repeatsVisibleAction: false,
      leavesListenerRoom: true,
      translatesPlanItemByItem: false,
      spellsOutDeferredOrImplied: false,
      extraExplanationHasChosenActionFunction: true,
      reopensSettledContextWithoutChosenPurpose: false,
      soundsLikeFormResponse: false,
      copiesBackendCategoryLanguage: false,
    },
  },
  embodiedIntent: {
    automaticReaction: "注意力短暂被佩剑吸引",
    chosenRegulation: "把注意力收回手边",
    intendedGesture: "继续原先手里的动作",
  },
  utterance: { literalSpeech, vocalMode: "conversational" },
  actionAttempt: {
    primitive: selected === "candidate:direct-question" ? "speak" : "observe",
    objectId: "",
    targetCharacterId: TARGET,
    destinationId: "",
    affordanceId: "",
  },
};
const forcedHighLeakageSession = {
  ...clone(session4),
  regulationOutcome: {
    ...clone(session4.regulationOutcome),
    channelLeakagePressures: { ...clone(session4.regulationOutcome.channelLeakagePressures), gaze: 0.92 },
  },
};
assert.throws(
  () => submitCharacterAgentRealization(forcedHighLeakageSession, { ...clone(realization), emotionHandling: [] }),
  (error) => error.code === "CHARACTER_AGENT_REALIZATION_CONTRACT_REJECTED"
    && error.issues.some((row) => row.code === "CHARACTER_AGENT_HIGH_LEAKAGE_UNHANDLED"),
  "the tool may expose high leakage pressure, but this Character Agent must decide how that channel is handled",
);
const session5 = submitCharacterAgentRealization(session4, realization);
assert.equal(session5.phase, "ready_for_world_resolution");
assert.equal(session5.finalDecision.utterance.literalSpeech, literalSpeech, "the protocol must preserve the Agent's literal speech exactly");
assert.equal(session5.finalDecision.communicationPlan.goal, literalSpeech ? "obtain_information" : "conceal", "communication strategy must come from the regulated expression stage rather than be replanned while wording");
assert.equal(buildCharacterAgentStageInput(session5).requestedOutput, "world_resolution_only");

assert.throws(
  () => attachCharacterAgentWorldOutcome(session5, { authority: "character-agent", outcomeId: "bad", success: true }),
  (error) => error.code === "CHARACTER_AGENT_WORLD_OUTCOME_AUTHORITY_INVALID",
  "the Character Agent may not resolve its own action",
);

const session6 = attachCharacterAgentWorldOutcome(session5, {
  authority: "world-resolution",
  outcomeId: "outcome:protocol:1",
  status: "committed",
  perceptibleConsequences: [],
});
assert.equal(session6.phase, "world_resolved");
assert.equal(session6.worldOutcome.status, "committed");
assert.deepEqual(session6.psychologySnapshot, session5.psychologySnapshot, "world resolution must not fabricate a new private psychology snapshot");

// --- physically reachable zones and neutral guest positions are legitimate action targets ---
const SPATIAL_TURN = "turn:generic:protocol:spatial";
const ZONE_TARGET = "courtyard";
const POSITION_TARGET = "position:tavern-hall-side-wall-table";
const spatialSession0 = createCharacterAgentTurnSession({
  agentTurnId: SPATIAL_TURN,
  characterId: ACTOR,
  worldProjection: {
    authority: "recipient-specific-world-projection",
    scene: { zoneId: "hall" },
    evidence: [{ evidenceId: EVIDENCE, modality: "visual", feature: "来客腰间佩剑，进门后先扫了一眼堂前" }],
    perceivedCharacters: [{ id: TARGET, identityKnown: false }],
    reachableZones: [{ id: ZONE_TARGET, physicalAccess: { physicallyAttemptable: true } }],
    institution: {
      guestPositions: [{ id: POSITION_TARGET, label: "堂前侧墙空桌", zoneId: "hall", capacity: 2 }],
    },
  },
  privateContext: clone(session0.privateContext),
});
const spatialReference = buildCharacterAgentStageInput(spatialSession0).referenceContract;
assert.ok(
  spatialReference.perceivedTargetHandles.includes(ZONE_TARGET),
  "a physically reachable zone is a world target this character may bind an action to",
);
assert.ok(
  spatialReference.perceivedTargetHandles.includes(POSITION_TARGET),
  "a neutral occupiable guest position is a world target this character may bind an action to",
);
const spatialSession1 = submitCharacterSubjectiveAppraisal(spatialSession0, {
  ...clone(appraisal),
  appraisalId: "appraisal:protocol:spatial",
  agentTurnId: SPATIAL_TURN,
});
const zoneCandidate = {
  ...clone(candidates[0]),
  candidateId: "candidate:move-to-courtyard",
  intention: "离开堂前，往后院去",
  attemptPrimitive: "move",
  targetHandle: ZONE_TARGET,
  actionBinding: {
    kind: "place",
    targetCharacterId: "",
    objectId: "",
    destinationId: ZONE_TARGET,
    positionId: "",
    affordanceId: "",
  },
};
const positionCandidate = {
  ...clone(candidates[0]),
  candidateId: "candidate:take-side-wall-table",
  intention: "先不回应，去侧墙空桌坐下观察",
  attemptPrimitive: "use_affordance",
  targetHandle: POSITION_TARGET,
};
assert.doesNotThrow(
  () => submitCharacterAgentCandidates(spatialSession1, [zoneCandidate, positionCandidate]),
  "candidates binding a reachable zone or a guest position must not be rejected as unknown targets",
);
assert.throws(
  () => submitCharacterAgentCandidates(spatialSession1, [{
    ...clone(candidates[0]),
    candidateId: "candidate:unknown-place",
    targetHandle: "zone:never-perceived",
  }]),
  (error) => error.code === "CHARACTER_AGENT_CANDIDATES_REJECTED"
    && error.issues.some((row) => row.code === "AGENT_CANDIDATE_TARGET_UNKNOWN"),
  "a target outside the perceived world is still rejected",
);

// --- the candidate stage binds its action to one concrete world anchor ---
function positionBinding() {
  return {
    kind: "position",
    targetCharacterId: "",
    objectId: "",
    destinationId: "",
    positionId: POSITION_TARGET,
    affordanceId: "",
  };
}
const boundPositionCandidate = {
  ...clone(positionCandidate),
  actionBinding: positionBinding(),
};
assert.throws(
  () => submitCharacterAgentCandidates(spatialSession1, [{
    ...clone(boundPositionCandidate),
    actionBinding: { ...positionBinding(), positionId: "" },
  }]),
  (error) => error.code === "CHARACTER_AGENT_CANDIDATES_REJECTED"
    && error.issues.some((row) => row.code === "AGENT_CANDIDATE_BINDING_INCOMPLETE"),
  "a typed binding must name the concrete anchor its kind requires",
);
assert.throws(
  () => submitCharacterAgentCandidates(spatialSession1, [{
    ...clone(boundPositionCandidate),
    actionBinding: { ...positionBinding(), positionId: "position:never-perceived" },
  }]),
  (error) => error.code === "CHARACTER_AGENT_CANDIDATES_REJECTED"
    && error.issues.some((row) => row.code === "AGENT_CANDIDATE_BINDING_TARGET_UNKNOWN"),
  "a typed binding may only reference anchors this character actually perceives",
);
assert.throws(
  () => submitCharacterAgentCandidates(spatialSession1, [{
    ...clone(boundPositionCandidate),
    actionBinding: { ...positionBinding(), destinationId: ZONE_TARGET },
  }]),
  (error) => error.code === "CHARACTER_AGENT_CANDIDATES_REJECTED"
    && error.issues.some((row) => row.code === "AGENT_CANDIDATE_BINDING_AMBIGUOUS"),
  "a typed binding names exactly one anchor so realization cannot pick a different one",
);

// --- move must carry a concrete spatial destination; the world never infers one ---
function moveBinding(overrides = {}) {
  return {
    kind: "place",
    targetCharacterId: "",
    objectId: "",
    destinationId: ZONE_TARGET,
    positionId: "",
    affordanceId: "",
    ...overrides,
  };
}
assert.throws(
  () => submitCharacterAgentCandidates(spatialSession1, [{
    ...clone(zoneCandidate),
    candidateId: "candidate:move-without-binding",
    actionBinding: undefined,
  }]),
  (error) => error.code === "CHARACTER_AGENT_CANDIDATES_REJECTED"
    && error.issues.some((row) => row.code === "AGENT_CANDIDATE_MOVE_DESTINATION_REQUIRED"),
  "a move without a destination binding can only settle as MOVEMENT_ZONE_UNKNOWN and is rejected up front",
);
assert.throws(
  () => submitCharacterAgentCandidates(spatialSession1, [{
    ...clone(zoneCandidate),
    candidateId: "candidate:move-bound-to-person",
    actionBinding: moveBinding({ kind: "character", targetCharacterId: TARGET, destinationId: "" }),
  }]),
  (error) => error.code === "CHARACTER_AGENT_CANDIDATES_REJECTED"
    && error.issues.some((row) => row.code === "AGENT_CANDIDATE_MOVE_DESTINATION_REQUIRED"),
  "a person is not a destination; move bound to a character with an empty destinationId is rejected up front",
);
assert.throws(
  () => submitCharacterAgentCandidates(spatialSession1, [{
    ...clone(zoneCandidate),
    candidateId: "candidate:move-into-current-zone",
    targetHandle: "hall",
    actionBinding: moveBinding({ destinationId: "hall" }),
  }]),
  (error) => error.code === "CHARACTER_AGENT_CANDIDATES_REJECTED"
    && error.issues.some((row) => row.code === "AGENT_CANDIDATE_MOVE_DESTINATION_IS_CURRENT_ZONE"
      && /leave/u.test(row.message || "")),
  "moving into the zone already occupied is rejected and the feedback names the leave primitive",
);
assert.doesNotThrow(
  () => submitCharacterAgentCandidates(spatialSession1, [{
    ...clone(zoneCandidate),
    candidateId: "candidate:move-to-position",
    actionBinding: positionBinding(),
  }]),
  "a move bound to a concrete occupiable position keeps its structured route",
);

// --- after choice, the action identity is locked: realization may shape it but not replace it ---
const boundSession2 = submitCharacterAgentCandidates(spatialSession1, [boundPositionCandidate]);
const boundChoice = {
  ...clone(choice),
  agentTurnId: SPATIAL_TURN,
  selectedCandidateId: boundPositionCandidate.candidateId,
  regulationChoice: { ...clone(choice.regulationChoice), agentTurnId: SPATIAL_TURN },
  automaticCommunicationImpulse: {
    ...clone(choice.automaticCommunicationImpulse),
    mode: "nonverbal",
    perceivedTurnDemand: "是否先落座再决定回应",
    feltTendency: "先不说话，找一个能观察的位置",
    disclosurePressure: 0.08,
  },
  goalPreservation: {
    ...clone(choice.goalPreservation),
    privateBasis: "先取位置再观察，不把落座当成judgment完成。",
  },
};
const boundSession3 = submitCharacterAgentChoiceAndRegulation(boundSession2, boundChoice);
assert.deepEqual(
  buildCharacterAgentStageInput(boundSession3).selectedAction.actionBinding,
  positionBinding(),
  "the locked binding travels with the selection into expression planning",
);
const boundExpressionPlan = {
  ...clone(regulatedExpressionPlan),
  mode: "nonverbal",
  actionIntent: "走向侧墙空桌坐下",
  communicationPlan: {
    ...clone(regulatedExpressionPlan.communicationPlan),
    goal: "conceal",
    tactic: "silence",
    disclosure: "withhold",
    epistemicRelation: "not_applicable",
    intendedAudienceCharacterIds: [],
    desiredEffect: "不公开自己的注意焦点",
    threadDisposition: "none",
  },
  speechMoment: {
    ...clone(regulatedExpressionPlan.speechMoment),
    currentTurnDemand: "是否先落座再决定回应",
    regulatedOpeningMove: "不说，先落座",
    minimumPublicDelta: "",
    listenerCanRespondAfterDelta: false,
    expansionFunction: "not_applicable",
  },
  timing: "during_action",
  turnYield: "not_applicable",
};
const boundSession4 = submitCharacterAgentExpressionPlan(boundSession3, boundExpressionPlan);
const boundEmotionHandling = Object.entries(boundSession4.regulationOutcome.channelLeakagePressures || {})
  .filter(([, value]) => Number(value) >= 0.6)
  .map(([channel]) => ({ channel, handling: "masked", basis: "落座前继续压住这个通道" }));
function boundRealization(actionAttempt) {
  return {
    ...clone(realization),
    agentTurnId: SPATIAL_TURN,
    emotionHandling: [
      ...clone(boundEmotionHandling),
      ...(!boundEmotionHandling.some((row) => row.channel === "attentionLock")
        ? [{ channel: "attentionLock", handling: "masked", basis: "目光不停在任何人身上" }]
        : []),
    ],
    utterance: { literalSpeech: "", vocalMode: "conversational" },
    actionAttempt,
  };
}
assert.throws(
  () => submitCharacterAgentRealization(boundSession4, boundRealization({
    primitive: "pickup",
    objectId: "object:wiping-cloth",
    targetCharacterId: "",
    destinationId: "",
    positionId: "",
    affordanceId: "",
  })),
  (error) => error.code === "CHARACTER_AGENT_REALIZATION_CONTRACT_REJECTED"
    && error.issues.some((row) => row.code === "CHARACTER_AGENT_REALIZATION_ACTION_SUBSTITUTED"),
  "realization may not replace the chosen action with a different one",
);
assert.throws(
  () => submitCharacterAgentRealization(boundSession4, boundRealization({
    primitive: "use_affordance",
    objectId: "",
    targetCharacterId: "",
    destinationId: "",
    positionId: "position:tavern-hall-center-table",
    affordanceId: "",
  })),
  (error) => error.code === "CHARACTER_AGENT_REALIZATION_CONTRACT_REJECTED"
    && error.issues.some((row) => row.code === "CHARACTER_AGENT_REALIZATION_BINDING_BROKEN"),
  "realization may not rebind the chosen action to a different world anchor",
);
const boundSession5 = submitCharacterAgentRealization(boundSession4, boundRealization({
  primitive: "use_affordance",
  objectId: "",
  targetCharacterId: "",
  destinationId: "",
  positionId: POSITION_TARGET,
  affordanceId: "",
}));
assert.equal(boundSession5.phase, "ready_for_world_resolution");
assert.equal(boundSession5.finalDecision.actionAttempt.positionId, POSITION_TARGET);
assert.equal(boundSession5.finalDecision.actionAttempt.affordanceId, "");

console.log(JSON.stringify({
  version: CHARACTER_AGENT_TURN_PROTOCOL_VERSION,
  status: "passed",
  checks: {
    causalStageOrder: true,
    sameAgentAuthority: true,
    appraisalBeforePsychology: true,
    agentCandidatesBeforeEvaluation: true,
    evaluationDoesNotSelect: true,
    nonMaximumAgentChoicePreserved: true,
    unrelatedActionMayRetainDesire: true,
    proxySubstitutionStillRejected: true,
    regulationBeforeExpressionPlanning: true,
    expressionPlanningBeforeRealization: true,
    highLeakageRequiresAgentOwnedHandling: true,
    literalSpeechPreserved: true,
    worldResolutionSeparated: true,
    immutableTransitions: true,
    explicitReferenceNamespace: true,
    worldSourceCollisionRejected: true,
    reachableZonesAndGuestPositionsAreLegalTargets: true,
    chosenIntentionShapesExpressionButStopsBeforeWording: true,
    candidateActionBindingValidated: true,
    realizationCannotSubstituteOrRebindChosenAction: true,
  },
}, null, 2));
