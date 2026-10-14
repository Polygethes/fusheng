import assert from "node:assert/strict";

import {
  attachCharacterAgentWorldOutcome,
  createCharacterAgentTurnSession,
  submitCharacterAgentCandidates,
  submitCharacterAgentChoiceAndRegulation,
  submitCharacterAgentExpressionPlan,
  submitCharacterAgentRealization,
  submitCharacterSubjectiveAppraisal,
} from "../src/server/simulation/characterAgentTurnProtocol.mjs";

const TURN = "turn:mountain-rescue:001";
const ACTOR = "character:field-medic:001";
const TARGET = "perceived_entity:injured-climber:001";
const EVIDENCE = "evidence:rockfall-and-injured-climber:001";
const DESIRE = "desire:keep-injured-person-alive:001";

let session = createCharacterAgentTurnSession({
  agentTurnId: TURN,
  characterId: ACTOR,
  worldProjection: {
    authority: "recipient-specific-world-projection",
    scene: {
      id: "scene:mountain-pass:storm",
      kind: "exposed-mountain-path",
      elapsedSeconds: 34,
      weather: "hail-and-wind",
    },
    evidence: [{
      evidenceId: EVIDENCE,
      modality: "sound-and-visual",
      content: "上方碎石仍在掉落，一名陌生攀登者倒在无遮蔽的坡面上。",
    }],
    perceivedCharacters: [{ id: TARGET, identityKnown: false, noticedFeatures: ["左腿不能负重", "意识尚清醒"] }],
    perceivedObjects: [{ id: "object:medical-bag:001", ownObject: true }],
    affordances: [
      { id: "affordance:rock-overhang", primitive: "move", label: "近处岩檐可暂避落石" },
      { id: "affordance:medical-bag", primitive: "interact", label: "本人携带的急救包" },
    ],
  },
  privateContext: {
    profile: {
      personality: { selfControl: 0.78, caution: 0.68, impulsivity: 0.24 },
      regulation: { practicedSkill: 0.82, roleDiscipline: 0.9 },
    },
    state: {
      mood: { valence: -0.12, arousal: 0.58 },
      body: { fatigue: 0.46, pain: 0.08 },
      feltSafety: 0.22,
      preparation: 0.72,
    },
    desires: [{ desireId: DESIRE, previousActivation: 0.64, cueMatch: 0.94, urgency: 0.9 }],
  },
});

session = submitCharacterSubjectiveAppraisal(session, {
  ownerAuthority: "character-agent",
  appraisalId: "appraisal:mountain-rescue:001",
  agentTurnId: TURN,
  eventId: "event:rockfall:001",
  noticedEvidenceIds: [EVIDENCE],
  interpretations: [{
    evidenceIds: [EVIDENCE],
    meaning: "伤者若继续留在坡面会再次被落石击中，但我直接冲过去也可能同时受困。",
    confidence: 0.9,
  }],
  beliefOperations: [],
  epistemicPositions: [],
  relevanceLinks: [{ sourceId: DESIRE, relation: "threatens", strength: 0.96, confidence: 0.9 }],
  desireGroundings: [{
    desireId: DESIRE,
    feltWant: "让眼前伤者活着离开落石线",
    terminalExperience: "伤者进入可避开继续落石的位置并得到救助",
    terminalContractAcknowledged: true,
    promotedCriteria: [],
    activationState: "active",
    activationEvidenceIds: [EVIDENCE],
    activationPsychologicalSourceIds: [],
    missingActivationConditions: [],
    immediatePull: 0.96,
    currentlyPerceivedPossible: 0.68,
    inhibitors: [{ kind: "harm", strength: 0.9, basisEvidenceIds: [EVIDENCE] }],
    acceptableTransformations: ["timing", "manner"],
    privateSummary: "可以先引导再接近，但不能把口令当成救援已经完成。",
  }],
  appraisalAxes: {
    selfRelevance: 0.9,
    goalCongruence: -0.72,
    novelty: 0.62,
    expectedness: -0.68,
    opportunityValue: 0.52,
    threat: 0.94,
    controllability: 0.44,
    changeability: 0.68,
    certaintyDelta: 0.66,
    normCompatibility: 0.86,
    selfImageCongruence: 0.78,
    publicExposure: 0.02,
    relationshipMeaning: { affiliation: 0.12, status: 0, trust: 0, rejection: 0, care: 0.74, betrayal: 0 },
  },
  uncertainty: 0.18,
  alternativesConsidered: ["先等落石停止", "先让伤者自行爬向岩檐", "冒险接近并拖离"],
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
});

session = submitCharacterAgentCandidates(session, [{
  originAuthority: "character-agent",
  candidateId: "candidate:call-and-guide-to-cover",
  intention: "先用明确口令让仍清醒的伤者向岩檐移动，同时自己寻找安全接近线",
  attemptPrimitive: "speak",
  targetHandle: TARGET,
  perceivedPrerequisites: [EVIDENCE],
  domains: ["duty", "body"],
  expectedEffects: [{ sourceId: DESIRE, direction: "advance", magnitude: 0.5, confidence: 0.72 }],
  desireRelations: [{ desireId: DESIRE, relation: "enable", terminalConditionMatch: 0.62, counterfactualResult: "伤者开始向安全处移动，但尚未确认脱险", preservesNonSubstitutableConditions: true, confidence: 0.72 }],
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
  sharedActivity: { operation: "none", activityId: "", kind: "", participantIds: [], requestedZoneId: "", response: "none", boundaries: { intensity: "", propertyProtection: false, harmLimit: "", note: "" } },
  factorInputs: { informationGain: 0.32, valueAndSelfImage: 0.84, bodyCost: 0.12, threatAndNormCost: 0.28, uncertaintyCost: 0.18 },
  timingIntent: "immediate",
  disclosureNeed: "full",
  uncertainty: 0.22,
}, {
  originAuthority: "character-agent",
  candidateId: "candidate:cross-slope-and-drag",
  intention: "立刻穿过坡面把伤者拖到岩檐下",
  attemptPrimitive: "move",
  targetHandle: TARGET,
  perceivedPrerequisites: [EVIDENCE],
  domains: ["duty", "body"],
  expectedEffects: [{ sourceId: DESIRE, direction: "advance", magnitude: 0.9, confidence: 0.55 }],
  desireRelations: [{ desireId: DESIRE, relation: "direct_contact", terminalConditionMatch: 0.88, counterfactualResult: "本人接触伤者并尝试将其拖入岩檐", preservesNonSubstitutableConditions: true, confidence: 0.55 }],
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
  sharedActivity: { operation: "none", activityId: "", kind: "", participantIds: [], requestedZoneId: "", response: "none", boundaries: { intensity: "", propertyProtection: false, harmLimit: "", note: "" } },
  factorInputs: { informationGain: 0.1, valueAndSelfImage: 0.88, bodyCost: 0.62, threatAndNormCost: 0.82, uncertaintyCost: 0.36 },
  timingIntent: "immediate",
  disclosureNeed: "none",
  uncertainty: 0.42,
}]);

assert.equal(session.candidateEvaluation.selection, null);
session = submitCharacterAgentChoiceAndRegulation(session, {
  ownerAuthority: "character-agent",
  agentTurnId: TURN,
  selectedCandidateId: "candidate:call-and-guide-to-cover",
  regulationChoice: {
    ownerAuthority: "character-agent",
    regulationChoiceId: "regulation:mountain-rescue:001",
    agentTurnId: TURN,
    strategies: [{ strategy: "tolerate", targetEmotionIds: ["fear", "wariness"], effort: 0.56, contextFit: 0.82 }],
    intendedPublicEffect: "让声音保持清楚，不把自己的紧张传给伤者",
    acceptedCosts: ["继续承担警觉负荷"],
  },
  goalPreservation: {
    preservedDesireIds: [DESIRE],
    transformedDimensions: ["timing", "manner"],
    terminalExperiencePreserved: true,
    acceptedDelay: false,
    acceptedResidualFrustration: 0.28,
    privateBasis: "先让伤者移动是在为真实脱险创造条件，不把喊话本身当成救援完成。",
  },
  automaticCommunicationImpulse: {
    ownerAuthority: "character-agent",
    impulseId: "impulse:mountain-rescue:001",
    mode: "speech",
    triggerEvidenceIds: [EVIDENCE],
    discourseAnchorIds: [],
    motiveSourceIds: [DESIRE],
    perceivedTurnDemand: "让仍清醒的伤者立刻离开落石线",
    feltTendency: "先把唯一安全方向喊清楚",
    urgency: 0.96,
    disclosurePressure: 0.92,
    inhibitionPressure: 0.08,
    conflict: { present: false, opposingSourceIds: [], description: "" },
  },
  continuationIntentions: [],
  privateDecisionBasis: "直接冲过去更快，但此刻先让仍清醒的人离开落石线，能避免两个人一起受困。",
});

session = submitCharacterAgentExpressionPlan(session, {
    ownerAuthority: "character-agent",
    sourceImpulseId: "impulse:mountain-rescue:001",
    impulseTransformation: { treatment: "express", privateBasis: "危险迫近，调节只稳住声音，不削弱警告。" },
    mode: "mixed",
    actionIntent: "先用清楚的声音指出安全方向，再沿可行路线接近",
    communicationPlan: {
      goal: "inform",
      tactic: "direct",
      disclosure: "full",
      epistemicRelation: "believes",
      intendedAudienceCharacterIds: [TARGET],
      desiredEffect: "让伤者立即朝岩檐移动",
      threadDisposition: "open_new",
      epistemicActionCandidateId: "",
      presuppositionStance: "not_applicable",
      epistemicBasisEvidenceIds: [EVIDENCE],
      subtext: "危险逼近，没有解释时间",
    },
    speechMoment: {
      currentTurnDemand: "让仍清醒的伤者立刻离开落石线",
      regulatedOpeningMove: "先把唯一安全方向喊清楚",
      minimumPublicDelta: "要求伤者向左侧岩檐移动",
      listenerCanRespondAfterDelta: true,
      expansionFunction: "warn",
      expansionPurpose: "明确危险迫近，阻止伤者停留或选错方向",
      deferredOrImplied: ["本人对落石路线的完整推断"],
      sharedContext: { anchorIds: [], treatment: "not_applicable", reopeningPurpose: "" },
    },
    nonverbalUndertone: "危险逼近，声音必须让人立刻行动",
    privacyBoundary: "本人对落石路线的完整推断留在私下",
    relationshipStance: "对处于危险中的陌生人承担临时指引",
    timing: "before_action",
    turnYield: "hold",
});

session = submitCharacterAgentRealization(session, {
  ownerAuthority: "character-agent",
  agentTurnId: TURN,
  emotionHandling: [{ channel: "voiceOnset", handling: "masked", basis: "先呼出一口气再喊出短口令" }],
  surfaceRealization: {
    timing: "before_action",
    affectiveTexture: [{ cue: "voice_loud", channel: "volume", modality: "sound", feature: "声音比平时更响、更清楚" }],
    relationshipRegister: "危急时对陌生人的明确指引",
    appliedVoiceParameters: { directness: 0.96, compression: 0.92, warmth: 0.24, reserve: 0.08, formality: 0.08, emotionalLeakage: 0.48 },
    intentionalDepartureReason: "危险迫使声音比平时更响",
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
  embodiedIntent: { automaticReaction: "身体先伏低避开碎石", chosenRegulation: "稳住呼吸", intendedGesture: "指向左侧岩檐并开始沿安全线移动" },
  utterance: { literalSpeech: "往左！岩檐下面！", vocalMode: "call_out" },
  actionAttempt: { primitive: "speak", objectId: "", targetCharacterId: TARGET, destinationId: "", affordanceId: "" },
});

assert.equal(session.finalDecision.selectedCandidateId, "candidate:call-and-guide-to-cover");
assert.equal(session.finalDecision.utterance.literalSpeech, "往左！岩檐下面！");
session = attachCharacterAgentWorldOutcome(session, {
  authority: "world-resolution",
  outcomeId: "outcome:mountain-rescue:001",
  status: "partial",
  perceptibleConsequences: ["伤者听见口令并开始拖着左腿向岩檐移动"],
});
assert.equal(session.phase, "world_resolved");
assert.equal(session.worldOutcome.status, "partial");
assert.equal(JSON.stringify(session).includes("tavern"), false, "the generic protocol must not require tavern-specific state");

console.log(JSON.stringify({
  status: "passed",
  scene: "non-tavern-mountain-rescue",
  checks: {
    genericWorldProjectionAccepted: true,
    characterAppraisalPrecedesPsychology: true,
    characterGeneratesSituationSpecificCandidates: true,
    mathematicsDoesNotSelect: true,
    characterOwnsRegulationAndLiteralSpeech: true,
    worldOutcomeRemainsSeparate: true,
  },
}, null, 2));
