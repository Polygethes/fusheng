import assert from "node:assert/strict";

import {
  acceptedTavernCharacterAgentV2ReplayCalls,
  auditCodexTrustedTavernCharacterAgentV2Input,
  buildCodexTrustedTavernCharacterAgentV2Invocation,
  buildCodexTrustedTavernCharacterAgentV2Prompt,
  rebaseCodexTrustedTavernCharacterAgentV2StageOutput,
  TAVERN_CHARACTER_AGENT_V2_STAGE_PHASES,
  TAVERN_CHARACTER_AGENT_V2_STAGES_PER_ACTIVATION,
  tavernCharacterAgentV2StageDefinition,
} from "../src/server/ecology/codexTrustedTavernCharacterAgentV2Channel.mjs";
import { runTavernCausalScene } from "../src/server/pipeline/tavernCausalScene.mjs";
import { buildLuoZhaoTavernCharacterAgentV2QualityFixture } from "./fixtures/luoZhaoTavernCharacterAgentV2QualityFixture.mjs";

const fixture = buildLuoZhaoTavernCharacterAgentV2QualityFixture();
assert.equal(TAVERN_CHARACTER_AGENT_V2_STAGES_PER_ACTIVATION, 5);
assert.deepEqual(TAVERN_CHARACTER_AGENT_V2_STAGE_PHASES, [
  "awaiting_subjective_appraisal",
  "awaiting_agent_candidates",
  "awaiting_agent_choice_and_regulation",
  "awaiting_agent_expression_planning",
  "awaiting_agent_realization",
]);
let stageInput = null;
try {
  await runTavernCausalScene(fixture.state, {
    characterIds: fixture.characterIds,
    positions: fixture.positions,
    seedImpacts: fixture.seedImpacts,
    slotContext: fixture.slotContext,
    maxSteps: 1,
    maxLocalFollowupSteps: 0,
    minimumActivationScore: 0,
    characterAgentProtocolVersion: 2,
    async runAgentV2Stage(input) {
      stageInput = structuredClone(input);
      const error = new Error("stage input captured");
      error.code = "V2_STAGE_INPUT_CAPTURED";
      throw error;
    },
  });
} catch (error) {
  if (error?.code !== "V2_STAGE_INPUT_CAPTURED") throw error;
}

assert.ok(stageInput);
assert.equal(stageInput.phase, "awaiting_subjective_appraisal");
assert.equal(stageInput.characterId, "char_xyy_luozhao");
const audit = auditCodexTrustedTavernCharacterAgentV2Input(stageInput);
assert.equal(audit.valid, true, JSON.stringify(audit.errors, null, 2));
assert.equal(audit.legacyAuthorityAbsent, true);
const trustedStageDefinition = tavernCharacterAgentV2StageDefinition(stageInput.phase, stageInput);
assert.ok(trustedStageDefinition);
assert.deepEqual(
  trustedStageDefinition.schema.properties.relevanceLinks.items.properties.sourceId.enum,
  stageInput.referenceContract.ownedPsychologicalSourceIds,
);
assert.deepEqual(
  trustedStageDefinition.schema.properties.priorActionOutcomeAppraisal.properties.noticedOutcomeEvidenceIds.items.enum,
  stageInput.referenceContract.perceivedEvidenceIds,
);
assert.equal(stageInput.worldProjection.evidence[0].sourceEntityHandle, "char_xyy_xiezenshi");
assert.equal(stageInput.worldProjection.perceivedCharacters[0].identityKnown, true);
assert.equal(stageInput.worldProjection.perceivedCharacters[0].name, "谢真石");
assert.equal(stageInput.privateContext.priorActionOutcomeContext.hasPendingAgentAction, false);
assert.equal(stageInput.privateContext.priorActionOutcomeContext.requiredStatusWhenNoPendingAgentAction, "no_prior_action");
assert.match(stageInput.privateContext.desires[0].label, /亲自验证.*谢真石.*极限/u);
assert.equal(stageInput.privateContext.desires[0].satisfactionCondition.type, "valid_firsthand_exchange");
assert.ok(stageInput.privateContext.desires[0].nonSubstitutableConditions.some((row) => /单独演示/u.test(row)));
const capableCriterion = stageInput.privateContext.desires[0].criterionLedger.find((row) => (
  row.authoredPath === "satisfactionCondition.criteria.targetCapableToRespond"
));
assert.ok(capableCriterion);
assert.equal(capableCriterion.defaultCandidateRole, "terminal_evaluation_only");
assert.ok(stageInput.referenceContract.ownedDesireCriterionIds.includes(capableCriterion.criterionId));
assert.ok(
  trustedStageDefinition.schema.properties.desireGroundings.items.properties.promotedCriteria
    .items.properties.criterionId.enum.includes(capableCriterion.criterionId),
);
assert.equal(
  Object.hasOwn(trustedStageDefinition.schema.properties.desireGroundings.items.properties, "satisfactionCriteriaRead"),
  false,
);
assert.deepEqual(stageInput.worldProjection.socialContext.thirdPartyObserverIds, []);
assert.equal(stageInput.worldProjection.socialContext.audienceExposure, 0);
assert.equal(Object.hasOwn(stageInput.worldProjection.socialContext, "venueNormPressure"), false);
assert.equal(stageInput.worldProjection.socialContext.interpretationAuthority, "character-agent");
assert.ok(Array.isArray(stageInput.worldProjection.socialContext.socialFacts));
assert.ok(stageInput.privateContext.profile.behaviorLearning.predictionErrorSensitivity > 0.9);
assert.ok(stageInput.privateContext.profile.behaviorLearning.persistenceInsulation > 0.85);
assert.equal(JSON.stringify(stageInput.worldProjection.materialFacts).includes("personalOpenLoops"), false);
assert.equal(JSON.stringify(stageInput.worldProjection.materialFacts).includes("亲自验证自己"), false);

const legacyFailedReplayPrefix = acceptedTavernCharacterAgentV2ReplayCalls({
  status: "execution_failed",
  error: { code: "CHARACTER_AGENT_APPRAISAL_REJECTED" },
  stageCalls: [
    { callIndex: 1, output: { ok: 1 } },
    { callIndex: 2, output: { ok: 2 } },
    { callIndex: 3, output: { invalid: true } },
  ],
});
assert.deepEqual(legacyFailedReplayPrefix.map((row) => row.callIndex), [1, 2]);
assert.deepEqual(acceptedTavernCharacterAgentV2ReplayCalls({
  status: "execution_failed",
  stageCalls: [
    { callIndex: 1, accepted: true, output: { ok: 1 } },
    { callIndex: 2, accepted: false, output: { invalid: true } },
  ],
}).map((row) => row.callIndex), [1]);

const choiceStageInput = {
  schemaVersion: stageInput.schemaVersion,
  agentTurnId: stageInput.agentTurnId,
  characterId: stageInput.characterId,
  phase: "awaiting_agent_choice_and_regulation",
  choiceAuthority: stageInput.choiceAuthority,
  referenceContract: stageInput.referenceContract,
  subjectiveAppraisal: {
    relevanceLinks: [{ sourceId: stageInput.referenceContract.ownedPsychologicalSourceIds[0] }],
  },
  generatedCandidates: [{
    candidateId: "candidate:trusted-stage-audit",
    expectedEffects: [{ sourceId: stageInput.referenceContract.ownedPsychologicalSourceIds[0] }],
  }],
  candidateEvaluation: { selection: null },
  impulseGroundingSurface: { authority: "character-private-preverbal-grounding-surface" },
  requestedOutput: "selected_candidate_regulation_and_automatic_impulse_only",
};
const choiceStageAudit = auditCodexTrustedTavernCharacterAgentV2Input(choiceStageInput);
assert.equal(choiceStageAudit.valid, true, JSON.stringify(choiceStageAudit.errors, null, 2));
const choiceStageDefinition = tavernCharacterAgentV2StageDefinition(choiceStageInput.phase, choiceStageInput);
assert.deepEqual(
  choiceStageDefinition.schema.properties.continuationIntentions.items.properties.linkedSourceIds.items.enum,
  stageInput.referenceContract.ownedPsychologicalSourceIds,
);
const tamperedChoiceStageAudit = auditCodexTrustedTavernCharacterAgentV2Input({
  ...structuredClone(choiceStageInput),
  generatedCandidates: [{
    candidateId: "candidate:trusted-stage-audit",
    expectedEffects: [{ sourceId: "world:obligation:not-private" }],
  }],
});
assert.equal(tamperedChoiceStageAudit.valid, false);
assert.ok(tamperedChoiceStageAudit.errors.some((row) => row.code === "V2_REFERENCE_CONTRACT_UNDECLARED_SOURCE"));

const expressionStageInput = {
  schemaVersion: stageInput.schemaVersion,
  agentTurnId: stageInput.agentTurnId,
  characterId: stageInput.characterId,
  phase: "awaiting_agent_expression_planning",
  choiceAuthority: stageInput.choiceAuthority,
  referenceContract: stageInput.referenceContract,
  selectedAction: { candidateId: "candidate:trusted-stage-audit", attemptPrimitive: "speak", targetHandle: "char_xyy_xiezenshi" },
  automaticCommunicationImpulse: {
    ownerAuthority: "character-agent",
    impulseId: "impulse:trusted-stage-audit",
    mode: "speech",
  },
  regulationSurface: { authority: "character-private-regulation-surface", channelLeakagePressures: {} },
  affectiveContext: { authority: "character-private-affective-context" },
  preverbalGroundingSurface: { authority: "character-private-preverbal-grounding-surface" },
  requestedOutput: "regulated_expression_plan_only",
};
const expressionStageAudit = auditCodexTrustedTavernCharacterAgentV2Input(expressionStageInput);
assert.equal(expressionStageAudit.valid, true, JSON.stringify(expressionStageAudit.errors, null, 2));
const expressionStageDefinition = tavernCharacterAgentV2StageDefinition(expressionStageInput.phase, expressionStageInput);
assert.equal(expressionStageDefinition.stage, "agent_expression_planning");
assert.equal(expressionStageDefinition.outputKey, "expressionPlan");
assert.ok(expressionStageDefinition.schema.required.includes("sourceImpulseId"));
assert.ok(expressionStageDefinition.schema.required.includes("impulseTransformation"));

const realizationStageInput = {
  schemaVersion: stageInput.schemaVersion,
  agentTurnId: stageInput.agentTurnId,
  characterId: stageInput.characterId,
  phase: "awaiting_agent_realization",
  choiceAuthority: stageInput.choiceAuthority,
  referenceContract: stageInput.referenceContract,
  worldSurface: { authority: "recipient-specific-realization-surface", scene: {}, evidence: [] },
  selectedAction: { candidateId: "candidate:trusted-stage-audit", attemptPrimitive: "speak", targetHandle: "char_xyy_xiezenshi" },
  regulatedExpressionPlan: {
    ownerAuthority: "character-agent",
    sourceImpulseId: "impulse:trusted-stage-audit",
    impulseTransformation: {
      treatment: "blend",
      privateBasis: "承认剑术兴趣，但不把完整判断过程交给对方。",
    },
    mode: "speech",
    actionIntent: "回答眼前问题",
    publicStance: {
      interactionMove: "answer",
      releasedMeaning: "想亲眼见识他的剑",
      audienceCharacterIds: ["char_xyy_xiezenshi"],
      disclosure: "partial",
      epistemicRelation: "believes",
      intendedEffect: "让对方明白兴趣落在剑上",
      threadDisposition: "settle",
      sharedContextAnchorIds: [],
      sharedContextTreatment: "not_applicable",
    },
    nonverbalUndertone: "认真从注意里漏出",
    privateRemainderPresent: true,
    relationshipStance: "潜在对手之间的平等审视",
    timing: "standalone",
    turnYield: "yield",
  },
  regulationSurface: { authority: "character-private-regulation-surface", channelLeakagePressures: {} },
  voiceContract: { characterId: stageInput.characterId },
  requestedOutput: "character_realization_only",
};
const realizationStageAudit = auditCodexTrustedTavernCharacterAgentV2Input(realizationStageInput);
assert.equal(realizationStageAudit.valid, true, JSON.stringify(realizationStageAudit.errors, null, 2));
const realizationStageDefinition = tavernCharacterAgentV2StageDefinition(realizationStageInput.phase, realizationStageInput);
assert.equal(
  Object.prototype.hasOwnProperty.call(realizationStageDefinition.schema.properties.surfaceRealization.properties, "selfCheck"),
  false,
  "the trusted output schema must not ask the model to grade its own dialogue like a form",
);
assert.equal(realizationStageInput.regulatedExpressionPlan.publicStance.releasedMeaning, "想亲眼见识他的剑");
assert.equal(Object.prototype.hasOwnProperty.call(realizationStageInput.regulatedExpressionPlan, "publicMeaning"), false);

const rebasedStage = rebaseCodexTrustedTavernCharacterAgentV2StageOutput({
  previousInput: {
    agentTurnId: "agent-turn:tavern_causal_scene_old123:0:char_xyy_luozhao",
    worldProjection: { evidence: [{ evidenceId: "noticed:delivery:impact_delivery_old123:1" }] },
  },
  currentInput: {
    agentTurnId: "agent-turn:tavern_causal_scene_new456:0:char_xyy_luozhao",
    worldProjection: { evidence: [{ evidenceId: "noticed:delivery:impact_delivery_new456:1" }] },
  },
  previousOutput: {
    agentTurnId: "agent-turn:tavern_causal_scene_old123:0:char_xyy_luozhao",
    appraisalId: "appraisal:char_xyy_luozhao:impact_delivery_old123:1",
    noticedEvidenceIds: ["noticed:delivery:impact_delivery_old123:1"],
  },
});
assert.equal(rebasedStage.output.agentTurnId, "agent-turn:tavern_causal_scene_new456:0:char_xyy_luozhao");
assert.equal(rebasedStage.output.appraisalId, "appraisal:char_xyy_luozhao:impact_delivery_new456:1");
assert.deepEqual(rebasedStage.output.noticedEvidenceIds, ["noticed:delivery:impact_delivery_new456:1"]);

const prompt = buildCodexTrustedTavernCharacterAgentV2Prompt(stageInput);
for (const forbidden of [
  "/Users/",
  "privateActionCandidates",
  "expressionStrategy",
  "calibrationEvidence",
  "holdouts.md",
  "expectedAction",
]) {
  assert.equal(prompt.includes(forbidden), false, `trusted v2 prompt leaked ${forbidden}`);
}
assert.ok(prompt.includes("<character_agent_v2_contract>"));
assert.ok(prompt.includes("<isolated_character_stage_input>"));
assert.ok(prompt.includes("referenceContract.ownedPsychologicalSourceIds"));

const invocation = buildCodexTrustedTavernCharacterAgentV2Invocation({
  stageInput,
  tempDirectory: "/private/tmp/gtown-v2-channel-contract",
  schemaPath: "/private/tmp/gtown-v2-channel-contract/stage.schema.json",
  outputPath: "/private/tmp/gtown-v2-channel-contract/stage.json",
  model: "gpt-5.6-sol",
  reasoningEffort: "medium",
  environment: { PATH: "/usr/bin:/bin" },
});
assert.equal(invocation.command, "codex");
assert.equal(invocation.model, "gpt-5.6-sol");
assert.equal(invocation.reasoningEffort, "medium");
assert.equal(invocation.purpose, "tavern-character-agent-behavior-acceptance");
assert.ok(invocation.args.includes("--ephemeral"));
assert.ok(invocation.args.includes("--ignore-user-config"));
assert.ok(invocation.args.includes("--ignore-rules"));
assert.ok(invocation.args.includes("--skip-git-repo-check"));
for (const feature of ["shell_tool", "unified_exec", "web_search", "apps", "hooks", "memories", "multi_agent", "remote_plugin", "goals"]) {
  const disabled = invocation.args.some((value, index) => value === "--disable" && invocation.args[index + 1] === feature);
  assert.equal(disabled, true, `trusted v2 channel did not disable ${feature}`);
}

const lunaMediumInvocation = buildCodexTrustedTavernCharacterAgentV2Invocation({
  stageInput,
  tempDirectory: "/private/tmp/gtown-v2-channel-contract-luna-medium",
  schemaPath: "/private/tmp/gtown-v2-channel-contract-luna-medium/stage.schema.json",
  outputPath: "/private/tmp/gtown-v2-channel-contract-luna-medium/stage.json",
  model: "gpt-5.6-luna",
  reasoningEffort: "medium",
  environment: { PATH: "/usr/bin:/bin" },
});
assert.equal(lunaMediumInvocation.model, "gpt-5.6-luna");
assert.equal(lunaMediumInvocation.reasoningEffort, "medium");
assert.equal(lunaMediumInvocation.purpose, "tavern-character-agent-behavior-acceptance");

console.log(JSON.stringify({
  status: "passed",
  characterId: stageInput.characterId,
  phase: stageInput.phase,
  serializedBytes: audit.serializedBytes,
  model: invocation.model,
  reasoningEffort: invocation.reasoningEffort,
  checks: {
    recipientSpecificWorldProjection: true,
    privatePsychologyIncluded: true,
    legacyCandidatesAbsent: true,
    authorEvidenceAbsent: true,
    projectPathsAbsent: true,
    projectEnvironmentNotRequired: true,
    toolsAndMemoryDisabled: true,
    privateSourceNamespaceExplicit: true,
    privateSourceSchemaBound: true,
    subjectiveOutcomeEvidenceSchemaBound: true,
    characterDispositionWeightsCompiled: true,
    terminalDesireAndProxyBoundaryIncluded: true,
    actualAudienceSeparatedFromVenueNorm: true,
    continuationIntentionSourcesBound: true,
    fiveStageBudgetManifestSharedWithQualityRunner: true,
    postRegulationExpressionStageAudited: true,
    realizationUsesPublicStanceNotPropositionChecklist: true,
    realizationDoesNotDependOnModelSelfAudit: true,
  },
}, null, 2));
