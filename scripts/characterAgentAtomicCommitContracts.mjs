import assert from "node:assert/strict";

import {
  bridgeTavernCharacterAgentV2ResultForWorld,
  createTavernCharacterAgentV2Session,
  TAVERN_CHARACTER_AGENT_V2_VERSION,
  tavernCharacterAgentV2OutputSchemaForStage,
  tavernCharacterAgentV2SystemPrompt,
} from "../src/server/pipeline/tavernCharacterAgentV2.mjs";
import {
  attachCharacterAgentWorldOutcome,
  buildCharacterAgentStageInput,
  CHARACTER_AGENT_SUBMISSION_MODES,
  createCharacterAgentTurnSession,
  submitCharacterAgentCandidates,
  submitCharacterAgentChoiceAndRegulation,
  submitCharacterAgentTurnCommit,
  submitCharacterSubjectiveAppraisal,
} from "../src/server/simulation/characterAgentTurnProtocol.mjs";
import { createTavernV27FixtureStageRunner } from "../src/server/pipeline/tavernV27FixtureStage.mjs";

const ACTOR = "character:atomic:actor";
const TARGET = "perceived_entity:atomic:visitor";
const EVIDENCE = "evidence:atomic:visitor-arrived";
const DESIRE = "desire:atomic:understand-visitor";
const ROLE = "酒馆当值店伙";
const STANDING = "谢家酒馆中可以招呼来客的人";
const CURRENT_INTENTION = "守着堂前，同时弄清陌生来客的来意";
const CURRENT_ACTIVITY = "activity:atomic:watch-hall";
const OWN_COMMITMENT = "commitment:atomic:watch-front-room";
const RECENT_ACTION = "action:atomic:set-cups";
const CURRENT_RESPONSIBILITIES = {
  authority: "character-private-role-and-duty-grounding",
  acceptedRoleIds: ["household_worker"],
  activeDutyContracts: [],
  objectiveOpportunityCues: [{
    cueId: "responsibility-cue:service:atomic-visitor",
    kind: "role-relevant-service-opportunity",
    recipientEntityHandle: TARGET,
    supportingAffordanceIds: ["affordance:serve-tea"],
    requiredResponse: false,
  }],
  selection: { authority: "character-agent", selectedCandidateId: null },
};

function clone(value) {
  return structuredClone(value);
}

function assertStrictSchemaValue(schema = {}, value, path = "turnCommit") {
  if (schema.type === "object") {
    assert.ok(value && typeof value === "object" && !Array.isArray(value), `${path} must be an object`);
    for (const field of schema.required || []) {
      assert.equal(Object.hasOwn(value, field), true, `${path} is missing required field ${field}`);
    }
    if (schema.additionalProperties === false) {
      for (const field of Object.keys(value)) {
        assert.equal(Object.hasOwn(schema.properties || {}, field), true, `${path}.${field} is forbidden by the strict schema`);
      }
    }
    for (const [field, child] of Object.entries(value)) {
      if (schema.properties?.[field]) assertStrictSchemaValue(schema.properties[field], child, `${path}.${field}`);
    }
  } else if (schema.type === "array") {
    assert.ok(Array.isArray(value), `${path} must be an array`);
    value.forEach((row, index) => assertStrictSchemaValue(schema.items || {}, row, `${path}[${index}]`));
  } else if (schema.type === "string") assert.equal(typeof value, "string", `${path} must be a string`);
  else if (schema.type === "number") assert.equal(typeof value, "number", `${path} must be a number`);
  if (schema.enum) assert.ok(schema.enum.includes(value), `${path} must use one of its schema enum values`);
}

function createSession(agentTurnId, submissionMode) {
  return createCharacterAgentTurnSession({
    agentTurnId,
    characterId: ACTOR,
    submissionMode,
    worldProjection: {
      authority: "recipient-specific-world-projection",
      scene: { id: "scene:atomic:tavern", locationName: "望梯酒馆", zoneId: "hall", zoneLabel: "堂前", elapsedSeconds: 24 },
      evidence: [{ evidenceId: EVIDENCE, modality: "visual", feature: "一名陌生来客停在近前" }],
      perceivedCharacters: [{ id: TARGET, identityKnown: false }],
      discourseContext: { anchorIds: [] },
      ongoingOwnActivities: [{ activityId: CURRENT_ACTIVITY, description: "在堂前照看来客", status: "active" }],
      ownCommitments: [{ id: OWN_COMMITMENT, description: "当值时照看堂前" }],
      recentOwnActions: [{ actionId: RECENT_ACTION, actionType: "arrange_cups", settled: true }],
      currentResponsibilities: CURRENT_RESPONSIBILITIES,
    },
    privateContext: {
      profile: {
        personality: { selfControl: 0.72 },
        regulation: { practicedSkill: 0.68, strategySkills: { suppress: 0.66 } },
      },
      state: { mood: { valence: 0, arousal: 0.3 }, body: { fatigue: 0.2 }, feltSafety: 0.62 },
      desires: [{ desireId: DESIRE, previousActivation: 0.48, cueMatch: 0.7, urgency: 0.28 }],
      relationships: [{ otherCharacterId: TARGET, label: "陌生来客", publicPressure: { closeness: 0.08, tension: 0.14 } }],
      psychologyAnchor: {
        competenceModel: {
          perceptualCompetences: [{
            id: "competence:front-room-reading",
            domain: "tavern-front-room-observation",
            qualitativeLevel: "trained-routine",
            perceptualPriorities: ["来客是否正在等人招呼"],
          }],
          proceduralCompetences: [{
            id: "competence:ordinary-hosting",
            domain: "ordinary-tavern-hosting",
            qualitativeLevel: "trained-routine",
            proceduralKnowledge: ["已交付的东西不必再次询问"],
          }],
        },
      },
      voiceContract: {
        languageUse: {
          defaultPublicLanguage: "zh-Hans",
          availablePublicLanguages: ["zh-Hans"],
        },
        personalityVoice: {
          attentionPriorities: ["眼前来客与手边正在经办的事"],
          appraisalHabits: ["先分清自己看见了什么"],
          emotionalLeakage: ["好奇会先从起声与停顿漏出"],
        },
        voiceFormation: {
          parameterModel: {
            base: { directness: 0.58, compression: 0.54, warmth: 0.36, reserve: 0.62, formality: 0.32, emotionalLeakage: 0.3 },
            pressure: { directness: 0.06, compression: 0.08, warmth: -0.04, reserve: 0.08, formality: 0, emotionalLeakage: 0.12 },
            closeness: { directness: 0.02, compression: 0.04, warmth: 0.1, reserve: -0.08, formality: -0.04, emotionalLeakage: 0.04 },
            fatigue: { directness: 0, compression: 0.1, warmth: -0.04, reserve: 0.06, formality: 0, emotionalLeakage: 0.08 },
          },
        },
        relationshipRegisters: {
          stranger: { distance: "疏远", adjustment: "保持低披露和寻常礼数" },
          prospectiveOpponent: { distance: "平等审视", adjustment: "语气直接但不预写挑战" },
        },
        driftRisks: ["PHASE91_NEGATIVE_RULE_MUST_NOT_REACH_WORDING"],
      },
      expressionProtocol: {
        authority: "runtime-expression-interface",
        publicDescriptionLanguage: "zh-Hans",
      },
      livedSituation: {
        role: ROLE,
        standing: STANDING,
        currentIntention: CURRENT_INTENTION,
        currentActivities: [{ activityId: CURRENT_ACTIVITY, description: "在堂前照看来客", status: "active" }],
        ownCommitments: [{ id: OWN_COMMITMENT, description: "当值时照看堂前" }],
        recentOwnActions: [{ actionId: RECENT_ACTION, actionType: "arrange_cups", settled: true }],
        currentResponsibilities: CURRENT_RESPONSIBILITIES,
      },
    },
  });
}

function appraisal(agentTurnId) {
  return {
    ownerAuthority: "character-agent",
    appraisalId: `appraisal:${agentTurnId}`,
    agentTurnId,
    eventId: "event:atomic:visitor-arrival",
    noticedEvidenceIds: [EVIDENCE],
    interpretations: [{ evidenceIds: [EVIDENCE], meaning: "来客似乎在等人开口", confidence: 0.64 }],
    beliefOperations: [],
    epistemicPositions: [],
    relevanceLinks: [{ sourceId: DESIRE, relation: "advances", strength: 0.72, confidence: 0.64 }],
    desireGroundings: [{
      desireId: DESIRE,
      feltWant: "弄清来客为何停在这里",
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
      privateSummary: "可以询问，也可以继续观察。",
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
    alternativesConsidered: ["普通来客", "另有来意"],
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
}

function candidates() {
  return [{
    originAuthority: "character-agent",
    candidateId: "candidate:atomic:ask",
    intention: "向来客问一句，给对方开口的机会",
    attemptPrimitive: "speak",
    targetHandle: TARGET,
    actionBinding: { kind: "character", targetCharacterId: TARGET },
    perceivedPrerequisites: [EVIDENCE],
    domains: ["social"],
    expectedEffects: [{ sourceId: DESIRE, direction: "advance", magnitude: 0.62, confidence: 0.64 }],
    desireRelations: [{
      desireId: DESIRE,
      relation: "probe",
      terminalConditionMatch: 0.42,
      counterfactualResult: "取得来客本人的一句回应",
      preservesNonSubstitutableConditions: true,
      confidence: 0.64,
    }],
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
    sharedActivity: {
      operation: "none",
      activityId: "",
      kind: "",
      participantIds: [],
      requestedZoneId: "",
      response: "none",
      boundaries: { intensity: "", propertyProtection: false, harmLimit: "", note: "" },
    },
    factorInputs: { informationGain: 0.7, valueAndSelfImage: 0.48, exposureAndRelationshipRisk: 0.32 },
    timingIntent: "now",
    uncertainty: 0.38,
  }];
}

function privateChoice(agentTurnId) {
  return {
    ownerAuthority: "character-agent",
    agentTurnId,
    selectedCandidateId: "candidate:atomic:ask",
    regulationChoice: {
      ownerAuthority: "character-agent",
      regulationChoiceId: `regulation:${agentTurnId}`,
      agentTurnId,
      strategies: [{ strategy: "suppress", targetEmotionIds: ["curiosity"], effort: 0.42, contextFit: 0.68 }],
      acceptedCosts: ["控制消耗"],
    },
    goalPreservation: {
      preservedDesireIds: [DESIRE],
      transformedDimensions: ["disclosure", "manner"],
      terminalExperiencePreserved: true,
      acceptedDelay: false,
      acceptedResidualFrustration: 0.12,
      privateBasis: "只改变开口方式，不拿回答本身冒充完整判断。",
    },
    automaticCommunicationImpulse: {
      ownerAuthority: "character-agent",
      impulseId: `impulse:${agentTurnId}`,
      mode: "speech",
      triggerEvidenceIds: [EVIDENCE],
      discourseAnchorIds: [],
      motiveSourceIds: [DESIRE],
      perceivedTurnDemand: "是否给面前的来客一个开口入口",
      feltTendency: "直接问一句",
      urgency: 0.44,
      disclosurePressure: 0.32,
      inhibitionPressure: 0.46,
      conflict: { present: false, opposingSourceIds: [], description: "" },
    },
    continuationIntentions: [],
    privateDecisionBasis: "眼前只有模糊来意，问一句比替对方猜测更合适。",
  };
}

function atomicCommit(agentTurnId, { postTurnDisposition = "keep_resumable" } = {}) {
  return {
    ownerAuthority: "character-agent",
    agentTurnId,
    conversationAnchorSelection: {
      anchorHandle: "",
      mode: "none",
      targetParticipantHandle: "",
      postTurnDisposition,
    },
    privateExpressionTrace: {
      affectiveInfluence: {
        sourceEmotionIds: ["curiosity"],
        mode: "contained_privately",
        primaryChannelId: "gaze",
        privateBasis: "好奇仍在，但这次只让它推动开口，不另外制造身体表演。",
      },
    },
    actionAttempt: {
      primitive: "speak",
      objectId: "",
      targetCharacterId: TARGET,
      destinationId: "",
      positionId: "",
      affordanceId: "",
    },
    publicExpression: {
      mode: "speech",
      audienceCharacterIds: [TARGET],
      timing: "standalone",
      utterance: {
        literalSpeech: "客官，找谁？",
        vocalMode: "conversational",
      },
      bodyDelta: "",
      affectiveDeltas: [],
    },
  };
}

assert.deepEqual(CHARACTER_AGENT_SUBMISSION_MODES, ["staged", "atomic"]);

const mapped = createTavernCharacterAgentV2Session({
  agentTurnId: "turn:atomic:mapping",
  submissionMode: "atomic",
  scene: { id: "scene:atomic:mapping", locationName: "望梯酒馆", zoneId: "hall", zoneLabel: "堂前" },
  agent: {
    id: ACTOR,
    role: ROLE,
    standing: STANDING,
    currentIntention: CURRENT_INTENTION,
    privateState: { ecologyProfile: {}, ecologyState: { body: { fatigue: 0.2 }, desires: {} } },
    psychologyAnchor: {},
    relationshipContext: [],
    voiceContract: {},
    memoryContext: {},
  },
  ongoingOwnActivities: [{ activityId: CURRENT_ACTIVITY, description: "在堂前照看来客", status: "active" }],
  ownCommitments: [{ id: OWN_COMMITMENT, description: "当值时照看堂前" }],
  recentOwnActions: [{ actionId: RECENT_ACTION, actionType: "arrange_cups", settled: true }],
});
const mappedFirstInput = buildCharacterAgentStageInput(mapped);
assert.equal(mappedFirstInput.situationalGrounding.role, ROLE);
assert.equal(mappedFirstInput.situationalGrounding.standing, STANDING);
assert.equal(mappedFirstInput.situationalGrounding.currentIntention, CURRENT_INTENTION);
assert.equal(mappedFirstInput.situationalGrounding.currentActivities[0].activityId, CURRENT_ACTIVITY);
assert.equal(mappedFirstInput.privateContext.livedSituation.role, ROLE, "upstream role must survive session mapping");
assert.equal(mappedFirstInput.privateContext.livedSituation.currentIntention, CURRENT_INTENTION, "upstream purpose must survive session mapping");

const stagedTurnId = "turn:atomic-contract:staged";
let staged = createSession(stagedTurnId);
staged = submitCharacterSubjectiveAppraisal(staged, appraisal(stagedTurnId));
staged = submitCharacterAgentCandidates(staged, candidates());
assert.equal(staged.submissionMode, "staged", "legacy sessions remain staged by default");
assert.equal(staged.phase, "awaiting_agent_choice_and_regulation", "legacy staged progression remains unchanged");

const atomicTurnId = "turn:atomic-contract:atomic";
let atomic = createSession(atomicTurnId, "atomic");
const appraisalInput = buildCharacterAgentStageInput(atomic);
assert.equal(appraisalInput.situationalGrounding.currentIntention, CURRENT_INTENTION);
assert.equal(appraisalInput.situationalGrounding.scene.locationName, "望梯酒馆");
assert.equal(appraisalInput.situationalGrounding.role, ROLE);
const appraisalOutputSchema = tavernCharacterAgentV2OutputSchemaForStage(appraisalInput);
assert.deepEqual(
  appraisalOutputSchema.properties.entityModelUpdates.items.properties.hypotheses
    .items.properties.basisEvidenceIds.items.enum,
  [EVIDENCE],
  "nested private entity hypotheses must be structurally bound to evidence delivered to this Character Agent",
);
const appraisalWithUnownedNestedEvidence = appraisal(atomicTurnId);
appraisalWithUnownedNestedEvidence.entityModelUpdates = [{
  perceivedEntityHandle: TARGET,
  noticedEvidenceIds: [EVIDENCE],
  hypotheses: [{
    hypothesisId: "hypothesis:atomic:typo",
    proposition: "把一个拼错的 delivery 当成证据",
    operation: "adopt",
    confidenceBand: "low",
    basisEvidenceIds: ["evidence:not-owned-by-this-character"],
  }],
  identityCandidates: [],
  affectiveResponse: { label: "留意", valence: 0, arousal: 0.2 },
  attentionPriority: 0.5,
}];
assert.throws(
  () => submitCharacterSubjectiveAppraisal(createSession(atomicTurnId, "atomic"), appraisalWithUnownedNestedEvidence),
  (error) => error.code === "CHARACTER_AGENT_APPRAISAL_REJECTED"
    && error.issues.some((row) => row.code === "CHARACTER_AGENT_APPRAISAL_EVIDENCE_UNKNOWN"),
  "unowned nested evidence must be rejected in appraisal, before the private reducer and later model stages run",
);
atomic = submitCharacterSubjectiveAppraisal(atomic, appraisal(atomicTurnId));
atomic = submitCharacterAgentCandidates(atomic, candidates());
assert.equal(atomic.submissionMode, "atomic");
assert.equal(atomic.phase, "awaiting_agent_choice_and_regulation");
atomic = submitCharacterAgentChoiceAndRegulation(atomic, privateChoice(atomicTurnId));
assert.equal(atomic.phase, "awaiting_agent_turn_commit");
assert.equal(atomic.regulationOutcome.selection, null, "math reports regulation residue but never selects");
const commitInput = buildCharacterAgentStageInput(atomic);
assert.equal(commitInput.requestedOutput, "character_turn_commit_only");
assert.equal(commitInput.expressionMoment.authority, "character-owned-expression-moment");
assert.equal(commitInput.agentChoice, undefined, "the wording stage must not receive the private Agent choice ledger");
assert.equal(commitInput.impulseGroundingSurface, undefined, "the wording stage must not receive a recitable automatic impulse");
assert.equal(commitInput.referenceContract, undefined, "backend reference ledgers must stop before the expression moment");
assert.equal(commitInput.situationalGrounding, undefined, "the old mixed grounding surface must not duplicate the lived expression moment");
assert.equal(commitInput.worldSurface, undefined);
assert.equal(commitInput.voiceSurface, undefined);
assert.equal(commitInput.regulationSurface, undefined);
assert.equal(commitInput.communicationNeedSurface, undefined);
assert.equal(commitInput.affectiveContext, undefined);
assert.equal(commitInput.affectiveExpressionSurface, undefined);
for (const terminalAuditField of [
  "intention", "perceivedPrerequisites", "desireRelations", "criterionUses", "disclosureNeed", "goalPreservation",
]) {
  assert.equal(
    Object.hasOwn(commitInput.expressionMoment.lockedAction, terminalAuditField),
    false,
    `${terminalAuditField} must stop before the atomic wording stage`,
  );
}
assert.equal(commitInput.regulatedExpressionPlan, undefined, "atomic input has no separate expression plan to recite");
assert.equal(commitInput.expressionMoment.livedContinuity.currentActivities[0].activityId, CURRENT_ACTIVITY);
assert.equal(commitInput.expressionMoment.livedContinuity.currentIntention, CURRENT_INTENTION);
assert.equal(commitInput.expressionMoment.livedContinuity.currentResponsibilities.acceptedRoleIds[0], "household_worker");
assert.equal(commitInput.expressionMoment.livedContinuity.currentResponsibilities.selection.selectedCandidateId, null);
assert.equal(commitInput.expressionMoment.livedContinuity.ownCommitments[0].id, OWN_COMMITMENT);
assert.equal(commitInput.expressionMoment.livedContinuity.recentOwnActions[0].actionId, RECENT_ACTION);
assert.equal(commitInput.expressionMoment.relationshipExperience.otherCharacterId, TARGET);
assert.equal(commitInput.expressionMoment.livedContinuity.bodyState.fatigue, 0.2);
assert.equal(commitInput.expressionMoment.lockedAction.primitive, "speak");
assert.equal(commitInput.expressionMoment.lockedAction.targetCharacterId, TARGET);
assert.equal(commitInput.expressionMoment.innerContinuity.activeWants[0].feltWant, "弄清来客为何停在这里");
assert.equal(commitInput.expressionMoment.innerContinuity.preRegulationImpulse.feltTendency, "直接问一句");
assert.equal(commitInput.expressionMoment.voiceDelivery.relationshipRegister.registerId, "stranger");
assert.ok(commitInput.expressionMoment.voiceDelivery.relationshipRegister.adjustmentTags.includes("low_disclosure"));
assert.equal(commitInput.cognitiveAttention, undefined, "upstream cognitive prose must not be replayed as wording material");
assert.equal(commitInput.roleSkill, undefined, "upstream role-skill prose must not be replayed as wording material");
assert.equal(commitInput.emotionalRegulation, undefined, "raw regulation rules must not be replayed as wording material");
assert.equal(commitInput.voiceContract, undefined, "atomic wording must not receive the old mixed voice contract");
assert.equal(commitInput.affectiveVoiceTool, undefined, "atomic wording must not receive a second voice-pressure surface");
assert.equal(commitInput.speechHabitSurface, undefined, "atomic wording must not receive a speech-habit self-certification checklist");
assert.equal(JSON.stringify(commitInput.expressionMoment.voiceDelivery).includes(CURRENT_INTENTION), false, "lived purpose must not leak into voice style");
assert.equal(JSON.stringify(commitInput.expressionMoment.voiceDelivery).includes(ROLE), false, "role responsibility must not leak into voice style");
assert.equal(
  JSON.stringify(commitInput).includes(candidates()[0].intention),
  false,
  "the candidate's free-text rationale must stop before literal realization",
);
assert.equal(
  JSON.stringify(commitInput).includes(privateChoice(atomicTurnId).privateDecisionBasis),
  false,
  "private decision prose must stop before literal realization",
);
assert.equal(
  JSON.stringify(commitInput).includes("PHASE91_NEGATIVE_RULE_MUST_NOT_REACH_WORDING"),
  false,
  "negative author rules must not become wording material",
);
assert.equal(JSON.stringify(commitInput).includes("selected_action_core"), false, "backend topic labels must not enter the expression moment");
assert.equal(Object.hasOwn(commitInput.expressionMoment.voiceDelivery.wording, "driftAvoidances"), false);
assert.equal(Object.hasOwn(commitInput.expressionMoment.voiceDelivery.rhythm, "authoredTendency"), false);

const remoteDesireTurnId = "turn:atomic-contract:remote-desire";
let remoteDesireSession = createSession(remoteDesireTurnId, "atomic");
const remoteDesireAppraisal = appraisal(remoteDesireTurnId);
remoteDesireAppraisal.relevanceLinks[0].strength = 0.18;
remoteDesireSession = submitCharacterSubjectiveAppraisal(remoteDesireSession, remoteDesireAppraisal);
remoteDesireSession = submitCharacterAgentCandidates(remoteDesireSession, candidates());
remoteDesireSession = submitCharacterAgentChoiceAndRegulation(remoteDesireSession, privateChoice(remoteDesireTurnId));
const remoteDesireCommitInput = buildCharacterAgentStageInput(remoteDesireSession);
assert.deepEqual(
  remoteDesireCommitInput.expressionMoment.innerContinuity.activeWants,
  [],
  "a durable but weakly scene-relevant desire must not leak into ordinary wording as if this moment were about it",
);

const atomicOutputSchema = tavernCharacterAgentV2OutputSchemaForStage(commitInput);
const atomicSystemPrompt = tavernCharacterAgentV2SystemPrompt(commitInput);
assert.equal(atomicSystemPrompt.includes("communicationFocus"), false);
assert.equal(atomicSystemPrompt.includes("relevanceLinks.sourceId"), false);
assert.equal(atomicSystemPrompt.includes("selected_action_core"), false);
assert.match(atomicSystemPrompt, /不要追求把信息交代完整/u);
assert.match(atomicSystemPrompt, /回答完对方刚问的内容就已经自然把话轮交还/u);
assert.match(atomicSystemPrompt, /禁止把“有限披露、维持交换、拉回方向/u);
assert.match(atomicSystemPrompt, /未知时用来人、对方、此人等中性指代/u);

const candidateSystemPrompt = tavernCharacterAgentV2SystemPrompt({ phase: "awaiting_agent_candidates" });
assert.match(candidateSystemPrompt, /候选的真实来源不只有长期欲望/u);
assert.match(candidateSystemPrompt, /角色与职责、承诺，以及眼前实际出现的机会/u);
assert.match(candidateSystemPrompt, /desireRelations 只诚实说明候选与欲望的关系/u);
assert.match(candidateSystemPrompt, /不得仅因它与长期欲望无关而从候选中消失/u);
const choiceSystemPrompt = tavernCharacterAgentV2SystemPrompt({ phase: "awaiting_agent_choice_and_regulation" });
assert.match(choiceSystemPrompt, /只能在各自声明的 scope/u);
assert.match(choiceSystemPrompt, /害怕公开自身身体弱点，不等于害怕普通自报姓名/u);
assert.match(choiceSystemPrompt, /motiveSourceIds 可以为空/u);
assert.match(choiceSystemPrompt, /性别或关系没有在当前感知与本人记忆中明确给出/u);
assert.deepEqual(atomicOutputSchema.properties.privateExpressionTrace.required, ["affectiveInfluence"]);
assert.deepEqual(
  atomicOutputSchema.properties.conversationAnchorSelection.properties.postTurnDisposition.enum,
  ["no_thread", "keep_resumable", "close_for_self"],
  "the atomic schema must expose a bounded Character-owned post-turn choice",
);
for (const preGenerationSpeechLabel of [
  "interactionMove", "disclosure", "epistemicRelation", "threadDisposition", "communicationFocus",
]) {
  assert.equal(
    Object.hasOwn(atomicOutputSchema.properties.privateExpressionTrace.properties, preGenerationSpeechLabel),
    false,
    `${preGenerationSpeechLabel} must not classify or narrow speech before literal generation`,
  );
}
assert.deepEqual(
  atomicOutputSchema.properties.publicExpression.properties.utterance.required,
  ["literalSpeech", "vocalMode"],
);
assert.equal(Object.hasOwn(atomicOutputSchema.properties.publicExpression.properties.utterance.properties, "speechAct"), false);
assert.equal(Object.hasOwn(atomicOutputSchema.properties.publicExpression.properties.utterance.properties, "speechFunctions"), false);
const schemaFixture = createTavernV27FixtureStageRunner({
  planForTurn: () => ({
    intention: "问清眼前来客找谁",
    primitive: "speak",
    targetId: TARGET,
    utterance: "客官，找谁？",
    visibleAction: "",
    texture: [],
    privateBasis: "先回应眼前的人。",
  }),
});
const schemaFixtureCommit = await schemaFixture(commitInput, { stage: "agent_turn_commit" });
assertStrictSchemaValue(atomicOutputSchema, schemaFixtureCommit.turnCommit);
assert.deepEqual(
  Object.keys(schemaFixtureCommit.turnCommit.publicExpression.utterance).sort(),
  ["literalSpeech", "vocalMode"],
  "the real atomic fixture must be admissible under the same strict schema sent to structured-output providers",
);
for (const removedChecklistField of [
  "appliedVoiceParameters", "realizedSpeechHabitIds", "emotionHandling",
  "intentionalDepartureReason", "relationshipRegister",
]) {
  assert.equal(
    Object.hasOwn(atomicOutputSchema.properties.privateExpressionTrace.properties, removedChecklistField),
    false,
    `atomic model output must not self-certify ${removedChecklistField}`,
  );
}
assert.ok(atomicOutputSchema.properties.publicExpression.required.includes("bodyDelta"));
assert.ok(atomicOutputSchema.properties.publicExpression.required.includes("affectiveDeltas"));
assert.equal(atomicOutputSchema.properties.privateExpressionTrace.properties.affectiveInfluence.required.includes("primaryChannelId"), false, "the model need not copy an already frozen channel when no public leakage is selected");
const boundAttemptSchema = atomicOutputSchema.properties.actionAttempt.properties;
assert.deepEqual(boundAttemptSchema.targetCharacterId.enum, [TARGET]);
for (const nonCharacterAnchor of ["objectId", "destinationId", "positionId", "affordanceId"]) {
  assert.deepEqual(
    boundAttemptSchema[nonCharacterAnchor].enum,
    [""],
    `a locked character binding must make ${nonCharacterAnchor} structurally empty`,
  );
}
const liveAffectiveSchema = atomicOutputSchema.properties.privateExpressionTrace.properties.affectiveInfluence.properties;
assert.equal(liveAffectiveSchema.sourceEmotionIds.minItems, undefined, "frozen live emotion ids need not be transcribed by the model; its handling mode still acknowledges the affect");
assert.equal(liveAffectiveSchema.primaryChannelId.enum.includes(""), false, "material residual affect cannot use an empty real channel");
assert.equal(liveAffectiveSchema.mode.enum.includes("no_live_influence"), false, "material residual affect cannot be declared absent");
assert.ok(commitInput.expressionMoment.innerContinuity.affectiveResidue.possibleLeakageChannels.length > 0);
assert.ok(
  atomicOutputSchema.properties.actionAttempt.required.includes("positionId"),
  "atomic action attempts must preserve a selected occupiable position in its own typed field",
);
assert.ok(
  Object.hasOwn(atomicOutputSchema.properties.actionAttempt.properties, "positionId"),
  "the provider schema must expose positionId instead of overloading affordanceId",
);
assert.equal(
  atomicOutputSchema.properties.publicExpression.required.includes("embodiedIntent"),
  false,
  "ordinary atomic speech must not be forced to invent posture and gesture fields",
);
assert.equal(
  Object.hasOwn(atomicOutputSchema.properties.publicExpression.properties, "observableAffectiveTexture"),
  false,
  "the atomic surface should ask only for affective changes, not a standing texture checklist",
);

const leaked = atomicCommit(atomicTurnId);
leaked.publicExpression.privateDecisionBasis = "人物的私密选择理由";
assert.throws(
  () => submitCharacterAgentTurnCommit(atomic, leaked),
  (error) => error.code === "CHARACTER_AGENT_TURN_COMMIT_REJECTED"
    && error.issues.some((row) => row.code === "CHARACTER_AGENT_PUBLIC_EXPRESSION_PRIVATE_FIELD"),
  "private decision material may not be placed in PublicExpression",
);

const rebound = atomicCommit(atomicTurnId);
rebound.actionAttempt.targetCharacterId = "perceived_entity:someone-else";
assert.throws(
  () => submitCharacterAgentTurnCommit(atomic, rebound),
  (error) => error.code === "CHARACTER_AGENT_TURN_COMMIT_REJECTED"
    && error.issues.some((row) => row.code === "CHARACTER_AGENT_REALIZATION_BINDING_BROKEN"),
  "an atomic commit cannot rebind the chosen action",
);

const selfClassifiedSpeech = atomicCommit(atomicTurnId);
selfClassifiedSpeech.publicExpression.utterance.speechAct = "ask";
selfClassifiedSpeech.publicExpression.utterance.speechFunctions = ["ask"];
assert.throws(
  () => submitCharacterAgentTurnCommit(atomic, selfClassifiedSpeech),
  (error) => error.code === "CHARACTER_AGENT_TURN_COMMIT_REJECTED"
    && error.issues.some((row) => row.code === "CHARACTER_AGENT_PUBLIC_SPEECH_SEMANTICS_SELF_CLASSIFICATION_FORBIDDEN"),
  "the direct protocol validator must reject fields that the strict provider schema also forbids",
);

const accepted = submitCharacterAgentTurnCommit(atomic, atomicCommit(atomicTurnId));
assert.equal(accepted.phase, "ready_for_world_resolution");
assert.equal(accepted.regulationOutcome.selection, null, "the private mathematics still never selects the action");
assert.equal(accepted.finalDecision.selectedCandidateId, "candidate:atomic:ask");
assert.equal(accepted.finalDecision.utterance.literalSpeech, "客官，找谁？");
assert.equal(accepted.finalDecision.utterance.speechAct, "ask",
  "the server must classify the generated literal question instead of defaulting every real line to inform");
assert.equal(accepted.finalDecision.actionAttempt.targetCharacterId, TARGET);
assert.equal(accepted.finalDecision.communicationPlan.threadDisposition, "keep_resumable");
assert.deepEqual(accepted.finalDecision.realizedSpeechHabitIds, [], "atomic compatibility state must not claim model-certified habits");
assert.deepEqual(accepted.finalDecision.emotionHandling, [], "atomic compatibility state must not claim a model-authored channel checklist");
assert.deepEqual(
  accepted.finalDecision.speechRealizationPlan.propositionalPayload,
  [],
  "an atomic commit does not recreate a released-meaning checklist behind the literal line",
);
assert.equal(accepted.publicCommit.actionAttempt.targetCharacterId, TARGET);
assert.equal(accepted.publicCommit.publicExpression.utterance.literalSpeech, "客官，找谁？");
assert.equal(accepted.publicCommit.publicExpression.bodyDelta, "");
assert.deepEqual(accepted.publicCommit.publicExpression.affectiveDeltas, []);
assert.equal(JSON.stringify(accepted.publicCommit).includes("眼前只有模糊来意"), false);

const closeCommit = atomicCommit(atomicTurnId, { postTurnDisposition: "close_for_self" });
closeCommit.publicExpression.utterance.literalSpeech = "明日还来吗？";
const closeAccepted = submitCharacterAgentTurnCommit(atomic, closeCommit);
assert.equal(closeAccepted.finalDecision.communicationPlan.threadDisposition, "close_for_self");
assert.equal(
  JSON.stringify(closeAccepted.publicCommit).includes("close_for_self"),
  false,
  "the Character's private post-turn disposition must not cross the public world boundary",
);
const farewellButKeep = atomicCommit(atomicTurnId, { postTurnDisposition: "keep_resumable" });
farewellButKeep.publicExpression.utterance.literalSpeech = "改日再聊。";
assert.equal(
  submitCharacterAgentTurnCommit(atomic, farewellButKeep).finalDecision.communicationPlan.threadDisposition,
  "keep_resumable",
  "the server must preserve the Character's bounded choice instead of guessing closure from farewell wording",
);
const missingDisposition = atomicCommit(atomicTurnId);
delete missingDisposition.conversationAnchorSelection.postTurnDisposition;
assert.throws(
  () => submitCharacterAgentTurnCommit(atomic, missingDisposition),
  (error) => error.code === "CHARACTER_AGENT_TURN_COMMIT_REJECTED"
    && error.issues.some((row) => row.code === "CHARACTER_AGENT_CONVERSATION_DISPOSITION_INVALID"),
);
const silentKeepsThread = atomicCommit(atomicTurnId);
silentKeepsThread.publicExpression.mode = "silence";
silentKeepsThread.publicExpression.audienceCharacterIds = [];
silentKeepsThread.publicExpression.timing = "silence";
silentKeepsThread.publicExpression.utterance.literalSpeech = "";
silentKeepsThread.actionAttempt.primitive = "none";
const silentSession = clone(atomic);
silentSession.generatedCandidates[0].attemptPrimitive = "none";
assert.throws(
  () => submitCharacterAgentTurnCommit(silentSession, silentKeepsThread),
  (error) => error.code === "CHARACTER_AGENT_TURN_COMMIT_REJECTED"
    && error.issues.some((row) => row.code === "CHARACTER_AGENT_CONVERSATION_DISPOSITION_WITHOUT_SPEECH"),
);

const impossibleLanguageDrift = atomicCommit(atomicTurnId);
impossibleLanguageDrift.publicExpression.utterance.literalSpeech = "Who are you looking for?";
assert.throws(
  () => submitCharacterAgentTurnCommit(atomic, impossibleLanguageDrift),
  (error) => error.code === "CHARACTER_AGENT_TURN_COMMIT_REJECTED"
    && error.issues.some((row) => row.code === "CHARACTER_AGENT_PUBLIC_LANGUAGE_UNAVAILABLE"),
  "atomic realization must not silently switch into a language absent from this Character's voice capability",
);

const impossibleBodyLanguageDrift = atomicCommit(atomicTurnId);
impossibleBodyLanguageDrift.actionAttempt.primitive = "gesture";
impossibleBodyLanguageDrift.publicExpression.mode = "nonverbal";
impossibleBodyLanguageDrift.publicExpression.utterance.literalSpeech = "";
impossibleBodyLanguageDrift.publicExpression.bodyDelta = "I raise one hand and step aside.";
const bodyLanguageSession = clone(atomic);
bodyLanguageSession.generatedCandidates[0].attemptPrimitive = "gesture";
assert.throws(
  () => submitCharacterAgentTurnCommit(bodyLanguageSession, impossibleBodyLanguageDrift),
  (error) => error.code === "CHARACTER_AGENT_TURN_COMMIT_REJECTED"
    && error.issues.some((row) => row.code === "CHARACTER_AGENT_PUBLIC_DESCRIPTION_LANGUAGE_MISMATCH")
    && !error.issues.some((row) => row.code === "CHARACTER_AGENT_PUBLIC_LANGUAGE_UNAVAILABLE"),
  "visible action descriptions use the runtime protocol language rather than pretending the body speaks a Character language",
);

const mismatchedPublicLeak = atomicCommit(atomicTurnId);
mismatchedPublicLeak.privateExpressionTrace.affectiveInfluence.mode = "leak_publicly";
mismatchedPublicLeak.privateExpressionTrace.affectiveInfluence.primaryChannelId = "gaze";
mismatchedPublicLeak.publicExpression.mode = "mixed";
mismatchedPublicLeak.publicExpression.affectiveDeltas = [{
  channel: "voiceOnset",
  modality: "sound",
  feature: "开口比平时快了半拍",
}];
assert.throws(
  () => submitCharacterAgentTurnCommit(atomic, mismatchedPublicLeak),
  (error) => error.code === "CHARACTER_AGENT_TURN_COMMIT_REJECTED"
    && error.issues.some((row) => row.code === "CHARACTER_AGENT_PUBLIC_AFFECTIVE_CHANNEL_MISMATCH"),
  "the world-facing affective delta must come from the channel this Character chose to let leak",
);

const containedButPublic = atomicCommit(atomicTurnId);
containedButPublic.publicExpression.mode = "mixed";
containedButPublic.publicExpression.affectiveDeltas = [{
  channel: "gaze",
  modality: "vision",
  feature: "目光在来客身上多停了一瞬",
}];
assert.throws(
  () => submitCharacterAgentTurnCommit(atomic, containedButPublic),
  (error) => error.code === "CHARACTER_AGENT_TURN_COMMIT_REJECTED"
    && error.issues.some((row) => row.code === "CHARACTER_AGENT_PUBLIC_AFFECTIVE_LEAK_NOT_CHOSEN"),
  "private containment cannot silently publish an affective delta",
);

const unsupportedLeak = atomicCommit(atomicTurnId);
unsupportedLeak.privateExpressionTrace.affectiveInfluence = { mode: "leak_publicly", privateBasis: "表达本人此刻的感受。" };
unsupportedLeak.publicExpression.mode = "mixed";
unsupportedLeak.publicExpression.affectiveDeltas = [{ cue: "hand_tense", channel: "handTension", modality: "visual", feature: "手指收紧。" }];
const noHandPressure = clone(atomic);
noHandPressure.regulationOutcome.channelLeakagePressures.handTension = 0;
assert.throws(() => submitCharacterAgentTurnCommit(noHandPressure, unsupportedLeak), error =>
  error.code === "CHARACTER_AGENT_TURN_COMMIT_REJECTED" && error.issues.some(row => row.code === "CHARACTER_AGENT_AFFECTIVE_CHANNEL_NOT_LIVE"),
  "omitting redundant private ids cannot bypass the frozen pressure check on a public cue");

const containedWithoutChannels = atomicCommit(atomicTurnId);
containedWithoutChannels.privateExpressionTrace.affectiveInfluence = { mode: "contained_privately", privateBasis: "仍然有感受，但此刻没有显露出来。" };
const noChannels = clone(atomic);
noChannels.regulationOutcome.channelLeakagePressures = {};
assert.equal(submitCharacterAgentTurnCommit(noChannels, containedWithoutChannels).phase, "ready_for_world_resolution");
const noChannelsInput = clone(commitInput);
noChannelsInput.expressionMoment.innerContinuity.affectiveResidue.possibleLeakageChannels = [];
const noChannelsSchema = tavernCharacterAgentV2OutputSchemaForStage(noChannelsInput);
assert.equal(noChannelsSchema.properties.publicExpression.properties.affectiveDeltas.maxItems, 0);
assert.ok(noChannelsSchema.properties.privateExpressionTrace.properties.affectiveInfluence.properties.mode.enum.includes("contained_privately"));

const deliberatelyExpansive = atomicCommit(atomicTurnId);
deliberatelyExpansive.publicExpression.utterance.literalSpeech = "我今天偏要把自己知道的、猜的和没把握的全说给你听。";
const expansiveAccepted = submitCharacterAgentTurnCommit(atomic, deliberatelyExpansive);
assert.equal(
  expansiveAccepted.publicCommit.publicExpression.utterance.literalSpeech,
  deliberatelyExpansive.publicExpression.utterance.literalSpeech,
  "the protocol must preserve deliberately expansive wording without a pre-generation focus censor",
);

const bridged = bridgeTavernCharacterAgentV2ResultForWorld({
  protocolVersion: TAVERN_CHARACTER_AGENT_V2_VERSION,
  session: accepted,
  stageInputs: [commitInput],
});
assert.equal(bridged.rawDecision.visibleAction, "", "unchanged posture and held objects stay silent at the world boundary");
assert.deepEqual(bridged.rawDecision.observableAffectiveTexture, []);

const emptyGesture = atomicCommit(atomicTurnId);
emptyGesture.conversationAnchorSelection.postTurnDisposition = "no_thread";
emptyGesture.actionAttempt.primitive = "gesture";
emptyGesture.publicExpression.mode = "nonverbal";
emptyGesture.publicExpression.audienceCharacterIds = [];
emptyGesture.publicExpression.timing = "during_action";
emptyGesture.publicExpression.utterance.literalSpeech = "";
const gestureSession = clone(atomic);
gestureSession.generatedCandidates[0].attemptPrimitive = "gesture";
assert.throws(
  () => submitCharacterAgentTurnCommit(gestureSession, emptyGesture),
  (error) => error.code === "CHARACTER_AGENT_TURN_COMMIT_REJECTED"
    && error.issues.some((row) => row.code === "PHYSICAL_EXPRESSION_REQUIRED"),
  "a gesture cannot use sparse expression to become an empty bodily action",
);
const visibleGesture = clone(emptyGesture);
visibleGesture.publicExpression.bodyDelta = "人物抬手示意对方稍候。";
visibleGesture.publicExpression.bodyActions = [{ kind: "raise_hand", direction: "forward", amplitude: "small", speed: "normal" }];
const acceptedGesture = submitCharacterAgentTurnCommit(gestureSession, visibleGesture);
assert.equal(acceptedGesture.finalDecision.embodiedIntent.intendedGesture, "人物抬手示意对方稍候。");

const worldInput = buildCharacterAgentStageInput(accepted);
assert.equal(worldInput.requestedOutput, "world_resolution_only");
assert.equal(worldInput.finalDecision, undefined, "the atomic world boundary receives no private final-decision ledger");
assert.deepEqual(worldInput.publicCommit, accepted.publicCommit);

const resolved = attachCharacterAgentWorldOutcome(accepted, {
  authority: "world-resolution",
  outcomeId: "outcome:atomic:1",
  actionAttemptId: "action-attempt:atomic:1",
  status: "success",
});
assert.equal(resolved.phase, "world_resolved");
assert.equal(resolved.worldOutcome.outcomeId, "outcome:atomic:1");

console.log("character agent atomic commit contracts passed");
