import assert from "node:assert/strict";

import {
  CHARACTER_EPISTEMIC_ACTION_MODES,
  CHARACTER_EPISTEMIC_DOMAINS,
  CHARACTER_EPISTEMIC_WORKING_STANCES,
  computeCharacterEpistemicActionAssessment,
  validateAgentGeneratedCandidates,
  validateCharacterSubjectiveAppraisal,
} from "../src/server/simulation/characterPsychologyTools.mjs";
import {
  tavernCharacterCandidatesV2Schema,
  tavernCharacterSubjectiveAppraisalV2Schema,
  tavernCharacterTurnCommitV2Schema,
  tavernCharacterAgentV2OutputSchemaForStage,
} from "../src/server/pipeline/tavernCharacterAgentV2.mjs";
import {
  buildCharacterAgentStageInput,
  createCharacterAgentTurnSession,
  expandRetainedEpistemicPositions,
  submitCharacterSubjectiveAppraisal,
} from "../src/server/simulation/characterAgentTurnProtocol.mjs";
import { getCharacterPsychologyAnchor } from "../src/server/ecology/characterPsychologyAnchor.mjs";
import { createTavernV27FixtureStageRunner } from "../src/server/pipeline/tavernV27FixtureStage.mjs";

const TURN = "agent-turn:epistemic-action:1";
const ACTOR = "character:epistemic-owner";
const TARGET = "perceived_entity:claimed-guide";
const EVIDENCE = "evidence:claimed-guide:self-identification";
const DESIRE = "desire:reach-shelter";
const IDENTITY_POSITION = "epistemic-position:claimed-guide-identity";
const ABILITY_POSITION = "epistemic-position:claimed-guide-ability";

assert.ok(CHARACTER_EPISTEMIC_DOMAINS.includes("identity"));
assert.ok(CHARACTER_EPISTEMIC_DOMAINS.includes("ability"));
assert.ok(CHARACTER_EPISTEMIC_WORKING_STANCES.includes("provisional_for_reversible_action"));
assert.ok(CHARACTER_EPISTEMIC_ACTION_MODES.includes("verify_while_acting"));
assert.ok(CHARACTER_EPISTEMIC_ACTION_MODES.includes("verify_before_acting"));

const luozhaoFoundation = getCharacterPsychologyAnchor("char_xyy_luozhao", {
  sceneId: "scene_xyy_wangti_tavern",
});
assert.equal(
  luozhaoFoundation.stablePsychology.dispositions.directEvidencePreference.scope,
  "martial-ability-and-unidentified-visual-recognition",
  "Luo Zhao's demand for first-hand evidence must not become a global identity-verification gate",
);
assert.match(
  luozhaoFoundation.epistemics.beliefUpdatePolicy.identityRecognitionRule,
  /暂时按该身份.*可逆.*边行动边验证/,
  "her runtime foundation must permit a revisable working identity for reversible action",
);
assert.ok(
  luozhaoFoundation.speechPolicy.forbiddenRegisters.includes("引用二手剑术评价作为自己的能力结论"),
  "the prohibition should stay scoped to second-hand martial conclusions",
);
assert.ok(
  !luozhaoFoundation.speechPolicy.forbiddenRegisters.includes("引用传闻作结论"),
  "the old global hearsay prohibition would incorrectly suppress domain-specific provisional judgment",
);

const appraisalSchema = tavernCharacterSubjectiveAppraisalV2Schema;
assert.ok(
  appraisalSchema.required.includes("epistemicPositions"),
  "subjective appraisal must distinguish domain-specific belief from a working stance",
);
const positionSchema = appraisalSchema.properties.epistemicPositions.items;
const POSITION_DETAIL_FIELDS = [
  "proposition", "confidence", "status", "workingStance", "relianceScope",
  "basisEvidenceIds", "basisPsychologicalSourceIds", "privateReason",
];
// Identity of a position is always required on the wire. The detail fields are
// schema-optional purely so an unchanged position can be carried by id instead
// of restated verbatim; a position that is NOT carried must still state all of
// them, which is enforced at runtime and asserted below.
for (const field of ["positionId", "domain", "subjectHandle"]) {
  assert.ok(positionSchema.required.includes(field), `epistemic position needs ${field}`);
}
for (const field of POSITION_DETAIL_FIELDS) {
  assert.ok(positionSchema.properties[field], `epistemic position must still declare ${field}`);
  assert.ok(
    positionSchema.optionalProperties.includes(field),
    `${field} may be omitted only through the carried-unchanged path`,
  );
}
assert.ok(
  positionSchema.properties.carriedUnchanged,
  "an unchanged position must have an explicit way to say so",
);

const candidateSchema = tavernCharacterCandidatesV2Schema.properties.candidates.items;
assert.ok(
  candidateSchema.required.includes("epistemicHandling"),
  "each candidate must say how this character would act around relevant uncertainty",
);
for (const field of [
  "positionIds", "mode", "errorIfWrong", "actionReversibility",
  "learningDuringAction", "delayCost", "privateReason",
]) assert.ok(candidateSchema.properties.epistemicHandling.required.includes(field));

const privateTraceSchema = tavernCharacterTurnCommitV2Schema.properties.privateExpressionTrace;
assert.ok(
  privateTraceSchema.required.includes("affectiveInfluence"),
  "the same Character Agent must privately decide where live affect goes before public realization",
);
assert.ok(
  privateTraceSchema.properties.affectiveInfluence.properties.mode.enum.includes("contained_privately"),
  "concealed affect must remain legal without forced public micro-acting",
);
assert.ok(
  privateTraceSchema.properties.affectiveInfluence.properties.mode.enum.includes("shape_wording"),
  "emotion may shape wording without requiring a body delta",
);

const session = createCharacterAgentTurnSession({
  agentTurnId: TURN,
  characterId: ACTOR,
  submissionMode: "atomic",
  worldProjection: {
    authority: "recipient-specific-world-projection",
    evidence: [{ evidenceId: EVIDENCE, modality: "sound", feature: "陌生人自称是熟悉山路的向导" }],
    perceivedCharacters: [{ id: TARGET, identityKnown: false }],
  },
  privateContext: {
    profile: {},
    state: {},
    desires: [{ desireId: DESIRE, terminalExperience: "本人抵达避雨处" }],
  },
});
const stageInput = buildCharacterAgentStageInput(session);
assert.equal(stageInput.referenceContract.criterionSemantics.currentConcernBlocksAction, false);
assert.equal(stageInput.referenceContract.criterionSemantics.characterMayActWithUncertainty, true);

const positions = [
  {
    positionId: IDENTITY_POSITION,
    domain: "identity",
    subjectHandle: TARGET,
    proposition: "眼前人可能就是附近居民所说的向导",
    confidence: 0.72,
    status: "provisional",
    workingStance: "provisional_for_reversible_action",
    relianceScope: "ordinary_reversible",
    basisEvidenceIds: [EVIDENCE],
    basisPsychologicalSourceIds: [],
    privateReason: "自称足以让我暂时与他交涉，但不是最终身份结论。",
  },
  {
    positionId: ABILITY_POSITION,
    domain: "ability",
    subjectHandle: TARGET,
    proposition: "此人确实有能力带我穿过山路",
    confidence: 0.28,
    status: "suspended",
    workingStance: "withhold_final_judgment",
    relianceScope: "none",
    basisEvidenceIds: [EVIDENCE],
    basisPsychologicalSourceIds: [],
    privateReason: "自称不能证明带路能力。",
  },
];

const verifyWhileActing = {
  positionIds: [IDENTITY_POSITION, ABILITY_POSITION],
  mode: "verify_while_acting",
  errorIfWrong: 0.46,
  actionReversibility: 0.9,
  learningDuringAction: 0.84,
  delayCost: 0.72,
  privateReason: "先走可随时折返的一小段，并用沿途判断继续验证。",
};
const verifyFirst = {
  positionIds: [IDENTITY_POSITION, ABILITY_POSITION],
  mode: "verify_before_acting",
  errorIfWrong: 0.46,
  actionReversibility: 0.9,
  learningDuringAction: 0.12,
  delayCost: 0.72,
  privateReason: "先停下索取更多证明。",
};

const whileAssessment = computeCharacterEpistemicActionAssessment({
  epistemicPositions: positions,
  epistemicHandling: verifyWhileActing,
});
const firstAssessment = computeCharacterEpistemicActionAssessment({
  epistemicPositions: positions,
  epistemicHandling: verifyFirst,
});
assert.equal(whileAssessment.authority, "character-private-psychology-tool");
assert.equal(whileAssessment.selection, null);
assert.ok(whileAssessment.learningValue > firstAssessment.learningValue);
assert.ok(whileAssessment.delayCost < firstAssessment.delayCost);
assert.ok(whileAssessment.epistemicRisk >= 0);
assert.ok(firstAssessment.epistemicRisk >= 0);

function candidate(epistemicHandling) {
  return {
    originAuthority: "character-agent",
    candidateId: "candidate:follow-reversibly",
    intention: "先同行一小段，并保留折返余地",
    attemptPrimitive: "move",
    targetHandle: TARGET,
    actionBinding: {
      kind: "none",
      targetCharacterId: "",
      objectId: "",
      destinationId: "",
      positionId: "",
      affordanceId: "",
    },
    perceivedPrerequisites: [EVIDENCE],
    domains: ["travel", "identity", "ability"],
    expectedEffects: [{ sourceId: DESIRE, direction: "advance", magnitude: 0.54, confidence: 0.48 }],
    desireRelations: [{
      desireId: DESIRE,
      relation: "probe",
      terminalConditionMatch: 0.2,
      counterfactualResult: "只推进一段可撤回的路程，不把自称当成最终能力结论。",
      preservesNonSubstitutableConditions: true,
      confidence: 0.68,
    }],
    criterionUses: [],
    epistemicHandling,
    sharedActivity: {
      operation: "none",
      activityId: "",
      kind: "",
      participantIds: [],
      requestedZoneId: "",
      response: "none",
      boundaries: { intensity: "", propertyProtection: false, harmLimit: "", note: "" },
    },
    factorInputs: {
      emotionCompatibility: 0.5,
      valueAndSelfImage: 0.5,
      relationshipMeaning: 0,
      informationGain: 0.62,
      habitAndIntentionContinuity: 0.5,
      bodyCost: 0.1,
      threatAndNormCost: 0.2,
      exposureAndRelationshipRisk: 0.2,
      opportunityAndSwitchingCost: 0.1,
      uncertaintyCost: 0.4,
    },
    timingIntent: "当前仍可折返时",
    disclosureNeed: "无需宣布已经相信对方",
    uncertainty: 0.5,
  };
}

const validationContext = {
  knownEvidenceIds: [EVIDENCE],
  knownTargetHandles: [TARGET],
  knownSourceIds: [DESIRE],
  knownDesireIds: [DESIRE],
  knownEpistemicPositionIds: positions.map((row) => row.positionId),
  requireDesireRelations: true,
  requireCriterionUses: true,
  requireEpistemicHandling: true,
};
assert.equal(validateAgentGeneratedCandidates([candidate(verifyWhileActing)], validationContext).valid, true);

const silentDrop = validateCharacterSubjectiveAppraisal({
  epistemicPositions: [],
}, {
  requireEpistemicPositions: true,
  knownTargetHandles: [TARGET],
  priorEpistemicPositions: positions,
});
assert.ok(
  silentDrop.errors.some((row) => row.code === "SUBJECTIVE_EPISTEMIC_POSITION_SILENTLY_DROPPED"),
  "a Character must retain, revise, settle, or reject a still-relevant working belief instead of erasing it with an empty appraisal",
);

const carriedSession = createCharacterAgentTurnSession({
  agentTurnId: "agent-turn:epistemic-carryover:2",
  characterId: ACTOR,
  submissionMode: "atomic",
  worldProjection: {
    authority: "recipient-specific-world-projection",
    evidence: [{ evidenceId: EVIDENCE, modality: "sound", feature: "向导仍在眼前" }],
    perceivedCharacters: [{ id: TARGET, identityKnown: false }],
  },
  privateContext: {
    profile: {},
    state: { priorRegulationCarryover: { epistemicPositions: positions } },
    desires: [{ desireId: DESIRE, terminalExperience: "本人抵达避雨处" }],
  },
});
const carriedInput = buildCharacterAgentStageInput(carriedSession);
const carriedSchema = tavernCharacterAgentV2OutputSchemaForStage(carriedInput);
assert.equal(
  carriedSchema.properties.epistemicPositions.minItems,
  undefined,
  "an explicitly retained state may have an empty change list",
);
const delta = expandRetainedEpistemicPositions({
  epistemicPositionUpdateMode: "retain_unmentioned", epistemicPositions: [],
}, positions, [TARGET]);
assert.deepEqual(delta.epistemicPositions, positions.map(row => ({ ...row, basisEvidenceIds: [] })));
assert.equal(expandRetainedEpistemicPositions({
  epistemicPositionUpdateMode: "retain_unmentioned", epistemicPositions: [],
}, positions, []).epistemicPositions.length, 0, "retention cannot reintroduce unprojected targets");
const changedPosition = { ...positions[0], confidence: 0.11, status: "suspended", basisEvidenceIds: [] };
const changedDelta = expandRetainedEpistemicPositions({
  epistemicPositionUpdateMode: "retain_unmentioned", epistemicPositions: [changedPosition],
}, positions, [TARGET]);
assert.deepEqual(changedDelta.epistemicPositions[0], changedPosition, "the Character's revision wins over retained state");
assert.equal(changedDelta.epistemicPositions.length, positions.length);

// A carried position occupies its slot with three fields and is hydrated back to
// the full prior position, so every downstream consumer still sees a complete list.
const carriedExpansion = expandRetainedEpistemicPositions(
  {
    epistemicPositions: [{
      positionId: positions[0].positionId,
      domain: positions[0].domain,
      subjectHandle: positions[0].subjectHandle,
      carriedUnchanged: true,
    }],
  },
  positions,
);
assert.deepEqual(
  carriedExpansion.epistemicPositions[0],
  { ...positions[0], basisEvidenceIds: [] },
  "a carried position keeps its belief while making no new evidence claim",
);
assert.ok(
  !("carriedUnchanged" in carriedExpansion.epistemicPositions[0]),
  "the wire-only carried marker must not leak into stored working memory",
);

// The relaxation is strictly scoped: anything not carried must still be complete.
assert.throws(
  () => expandRetainedEpistemicPositions(
    {
      epistemicPositions: [
        { ...positions[0], carriedUnchanged: true },
        { positionId: "epistemic-position:partial", domain: positions[1].domain, subjectHandle: positions[1].subjectHandle },
      ],
    },
    positions,
  ),
  (error) => (error.issues || error.details?.issues || []).some((row) => row.code === "CHARACTER_AGENT_EPISTEMIC_POSITION_INCOMPLETE"),
  "a position that is not carried unchanged must still state every field",
);

assert.throws(
  () => expandRetainedEpistemicPositions(
    { epistemicPositions: [{ positionId: "epistemic-position:never-seen", domain: positions[0].domain, subjectHandle: positions[0].subjectHandle, carriedUnchanged: true }] },
    positions,
  ),
  (error) => (error.issues || error.details?.issues || []).some((row) => row.code === "CHARACTER_AGENT_EPISTEMIC_POSITION_CARRIED_UNKNOWN"),
  "a Character may not invent a carried position that was never held",
);

const fixtureStage = createTavernV27FixtureStageRunner({
  planForTurn: () => ({ primitive: "none", utterance: "", visibleAction: "" }),
});
const fixtureCarryover = await fixtureStage(carriedInput, { stage: "subjective_appraisal" });
assert.deepEqual(
  fixtureCarryover.appraisal.epistemicPositions.map((row) => `${row.domain}::${row.subjectHandle}`),
  positions.map((row) => `${row.domain}::${row.subjectHandle}`),
  "the deterministic fixture must retain still-perceived working beliefs instead of simulating amnesia during checkpoint recovery",
);
assert.ok(
  fixtureCarryover.appraisal.epistemicPositions.every((row) => row.basisEvidenceIds.length === 0),
  "retention must not pretend that old evidence was newly perceived in the current appraisal",
);

const unknownPosition = structuredClone(verifyWhileActing);
// Real persistent-model repro: the next turn receives different evidence while
// explicitly retaining an old position. Historical evidence is not new notice.
const laterSession = createCharacterAgentTurnSession({
  agentTurnId: "agent-turn:epistemic-carryover:3", characterId: ACTOR, submissionMode: "atomic",
  worldProjection: {
    ...structuredClone(carriedSession.worldProjection),
    evidence: [{ evidenceId: "evidence:guide:new-action", modality: "visual", feature: "向导迈出一步" }],
  },
  privateContext: structuredClone(carriedSession.privateContext),
});
const laterAppraisal = (await fixtureStage(buildCharacterAgentStageInput(laterSession), { stage: "subjective_appraisal" })).appraisal;
laterAppraisal.epistemicPositions = positions.map(({ positionId, domain, subjectHandle }) => ({
  positionId, domain, subjectHandle, carriedUnchanged: true,
}));
let laterAccepted;
assert.doesNotThrow(() => { laterAccepted = submitCharacterSubjectiveAppraisal(laterSession, laterAppraisal); },
  "retaining owned knowledge must not reclassify historical evidence as a new observation");
assert.deepEqual(laterAccepted.subjectiveAppraisal.epistemicPositions.map(row => row.basisEvidenceIds), [[], []]);
assert.equal(laterAccepted.subjectiveAppraisal.noticedEvidenceIds.includes(EVIDENCE), false);
const forgedCarry = structuredClone(laterAppraisal);
forgedCarry.epistemicPositions[0].basisEvidenceIds = ["evidence:never-delivered"];
assert.throws(() => submitCharacterSubjectiveAppraisal(laterSession, forgedCarry), error => (
  error.issues?.some(row => row.code === "CHARACTER_AGENT_APPRAISAL_EVIDENCE_UNKNOWN")
), "an explicitly submitted evidence reference still needs current delivery and notice");

unknownPosition.positionIds = ["epistemic-position:not-owned"];
assert.ok(
  validateAgentGeneratedCandidates([candidate(unknownPosition)], validationContext)
    .errors.some((row) => row.code === "AGENT_CANDIDATE_EPISTEMIC_POSITION_UNKNOWN"),
  "a candidate may only rely on this Character Agent's own current epistemic positions",
);

console.log("characterEpistemicActionContracts:test passed", {
  domains: ["identity", "ability"],
  workingStance: "provisional_for_reversible_action",
  actionMode: "verify_while_acting",
  selectionAuthority: whileAssessment.selection,
});
