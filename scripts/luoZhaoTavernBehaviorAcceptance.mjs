import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";

import {
  CODEX_TRUSTED_TAVERN_AGENT_PURPOSE,
  auditCodexTrustedTavernAgentInput,
  buildCodexTrustedTavernAgentDecisionSchema,
  buildCodexTrustedTavernAgentInvocation,
  buildCodexTrustedTavernAgentPrompt,
  runTavernCausalAgentWithCodex,
} from "../src/server/ecology/codexTrustedTavernAgentChannel.mjs";
import {
  normalizeTavernCharacterDecision,
  runTavernCausalScene,
  updateRuntimeConversationLocks,
} from "../src/server/pipeline/tavernCausalScene.mjs";
import {
  applyTavernCausalAffordance,
  listTavernCausalAffordances,
  tavernCausalMaterialFacts,
} from "../src/server/pipeline/tavernCausalEconomy.mjs";
import { evaluateCharacterExchangeIntegrity } from "../src/server/simulation/characterExchangeIntegrity.mjs";
import {
  LUO_ZHAO_BEHAVIOR_ACCEPTANCE_IDS,
  buildLuoZhaoTavernBehaviorAcceptanceFixture,
} from "./fixtures/luoZhaoTavernBehaviorAcceptanceFixture.mjs";

const ids = LUO_ZHAO_BEHAVIOR_ACCEPTANCE_IDS;

function noOpContinuity(input, candidateId) {
  const desireIds = Object.keys(input.agent?.privateState?.ecologyState?.desires || {});
  return {
    phase: "pending_world_resolution",
    choiceSignificance: "ordinary",
    actionMemory: { mode: "none", content: "", basisIds: [] },
    desireContinuity: desireIds.map((desireId) => ({
      desireId,
      status: "unaffected",
      pressureDirection: "stable",
      strengthBand: "low",
      settlementCondition: "action_committed",
      reason: "结构 dry-run 不声明人物心理发生变化。",
      basisIds: [desireId, candidateId],
    })),
    dynamicStateContinuity: [],
    selfNarrative: {
      mode: "none",
      proposedClaim: "",
      replacesClaimIds: [],
      significanceBand: "low",
      permanenceBand: "low",
      basisIds: [],
      consolidationStatus: "not_applicable",
    },
  };
}

function noOpRelationshipAppraisal() {
  return {
    phase: "pending_perception_appraisal",
    targetCharacterId: "",
    sourceImpactIds: [],
    changeMode: "none",
    dimensionChanges: [],
    reason: "",
  };
}

function unresolvedPerceivedCharacterId(input) {
  return input.perceivedCharacters.find((row) => row.identityKnown === false)?.id || "";
}

function baseDecision(input, candidate) {
  return {
    candidateId: candidate.candidateId,
    actionType: "pass",
    speechAct: "none",
    speechFunctions: [],
    targetCharacterId: candidate.targetCharacterId || "",
    speech: "",
    visibleAction: "",
    moveToZoneId: "",
    vocalMode: "conversational",
    affordanceId: "",
    informationSourceImpactId: "",
    commitmentAction: "none",
    commitmentTopic: "",
    decisionValue: "none",
    semanticFrameId: candidate.semanticFrame?.id || "",
    semanticRoleBindings: candidate.semanticFrame?.roles || {},
    privateReason: "结构 dry-run 只检查运行边界，不作为人物行为答案。",
    relationshipAppraisal: noOpRelationshipAppraisal(),
    postChoiceContinuity: noOpContinuity(input, candidate.candidateId),
  };
}

function dryRunEnterHall(input) {
  const candidate = input.privateActionCandidates.find((row) => (
    row.feasible
    && row.realization?.affordanceId?.startsWith("enter_self_directed_visit:")
  ));
  assert.ok(candidate, "Luo Zhao must own the feasible choice to enter the public hall");
  return {
    ...baseDecision(input, candidate),
    actionType: "move",
    moveToZoneId: "hall",
    affordanceId: candidate.realization.affordanceId,
    targetCharacterId: "",
    privateReason: "测试专用移动只验证门槛与堂前的连续空间，不作为洛照的预测行动。",
  };
}

function dryRunGuestQuestion(input) {
  const visitorHandle = unresolvedPerceivedCharacterId(input);
  const candidate = input.privateActionCandidates.find((row) => (
    row.feasible
    && (!row.targetCharacterId || row.targetCharacterId === visitorHandle)
    && (row.realization?.allowedSpeechActs || []).includes("ask")
  ));
  assert.ok(candidate, "Xie Zhenshi must have a feasible, non-scripted option to address the arrived visitor");
  return {
    ...baseDecision(input, candidate),
    actionType: "speak",
    speechAct: "ask",
    targetCharacterId: visitorHandle,
    speech: "姑娘，堂前有座。你是来吃饭，还是找人？",
    privateReason: "测试专用问句只验证第二位 Agent 的行动能够成为第一位 Agent 的真实输入。",
  };
}

function dryRunStrangerReply(input) {
  const strangerHandle = unresolvedPerceivedCharacterId(input);
  const candidate = input.privateActionCandidates.find((row) => (
    row.feasible
    && row.targetCharacterId === strangerHandle
    && row.realization?.mode === "respond"
  ));
  assert.ok(candidate, "Luo Zhao must receive a feasible response candidate caused by Xie Zhenshi's committed turn");
  return {
    ...baseDecision(input, candidate),
    actionType: "speak",
    speechAct: "answer",
    targetCharacterId: strangerHandle,
    speech: "找人。",
    privateReason: "测试专用短答只验证承接关系，不作为洛照的预测台词。",
  };
}

function schemaCompletePass(input) {
  const candidate = input.privateActionCandidates.find((row) => (
    row.feasible && !row.realization?.affordanceId
  ));
  assert.ok(candidate);
  return baseDecision(input, candidate);
}

function dryRunQuietContinuation(input) {
  if (input.agent.id === ids.luo && input.scene.zoneId === "threshold") {
    return dryRunEnterHall(input);
  }
  const preferredCandidate = input.agent.id === ids.luo
    ? input.privateActionCandidates.find((row) => row.feasible && row.actionKind === "observe")
    : input.privateActionCandidates.find((row) => (
      row.feasible && String(row.driveId || row.candidateId || "").includes("continue_observing_verified_high_skill")
    ));
  const candidate = preferredCandidate || input.privateActionCandidates.find((row) => (
    row.feasible && !row.realization?.affordanceId
  ));
  assert.ok(candidate, `the open-visit clock probe needs a feasible quiet action for ${input.agent.id}`);
  const targetCharacterId = candidate.targetCharacterId || unresolvedPerceivedCharacterId(input);
  const activationEvidenceId = input.activation?.evidenceId || "";
  return {
    ...baseDecision(input, candidate),
    actionType: "act",
    targetCharacterId,
    visibleAction: input.agent.id === ids.luo
      ? "来客安静地重新看了一眼堂前人的站姿。"
      : "堂前人放慢手上的动作，留意了一眼来客。",
    cognitiveAppraisal: {
      noticedEvidenceIds: activationEvidenceId ? [activationEvidenceId] : [],
      interpretations: activationEvidenceId ? [{
        evidenceIds: [activationEvidenceId],
        meaning: "对方刚才的公开动作进入了本人这一轮判断。",
        confidenceBand: "medium",
      }] : [],
      beliefOperations: [],
      entityModelUpdates: [],
      locationBeliefUpdates: [],
      sourceKnowledgeBeliefUpdates: [],
      threadAppraisals: [],
    },
    privateReason: "测试专用静默动作只验证每次新世界动作都能推动连续时钟，不作为人物行为答案。",
  };
}

const fixture = buildLuoZhaoTavernBehaviorAcceptanceFixture();
const capturedInputs = [];
let guestQuestionIssued = false;
let strangerReplyIssued = false;
const dryScene = await runTavernCausalScene(fixture.state, {
  characterIds: fixture.characterIds,
  positions: fixture.positions,
  seedImpacts: fixture.seedImpacts,
  slotContext: fixture.slotContext,
  maxSteps: 4,
  maxLocalFollowupSteps: 1,
  minimumActivationScore: 0,
  async runAgent(input) {
    capturedInputs.push(structuredClone(input));
    const hasLiveResponse = input.privateActionCandidates.some((row) => (
      row.feasible
      && row.realization?.mode === "respond"
    ));
    if (input.agent.id === ids.luo && input.scene.zoneId === "threshold") {
      return { decision: dryRunEnterHall(input) };
    }
    if (input.agent.id === ids.xieZhenshi && !guestQuestionIssued) {
      guestQuestionIssued = true;
      return { decision: dryRunGuestQuestion(input) };
    }
    if (input.agent.id === ids.luo && hasLiveResponse && !strangerReplyIssued) {
      strangerReplyIssued = true;
      return { decision: dryRunStrangerReply(input) };
    }
    // The harness owns this bounded probe. Once both intended turns happened,
    // it must choose silence explicitly instead of relying on the engine to gag
    // another physically possible question or answer.
    return { decision: schemaCompletePass(input) };
  },
});

assert.ok(
  capturedInputs.length >= 3 && capturedInputs.length <= 5,
  `movement, reception, and reply may include bounded no-action scheduling turns: ${JSON.stringify(
    capturedInputs.map((input) => ({ characterId: input.agent.id, zoneId: input.scene.zoneId, activation: input.activation })),
  )}`,
);
assert.equal(capturedInputs[0].agent.id, ids.luo, "Luo Zhao's owned arrival and information purpose may activate her without scripting an answer");
assert.deepEqual(
  new Set(capturedInputs.map((input) => input.agent.id)),
  new Set(fixture.characterIds),
  JSON.stringify(dryScene.decisions.map((row) => ({
    characterId: row.characterId,
    candidateId: row.candidateId,
    actionType: row.decision?.actionType,
    speechAct: row.decision?.speechAct,
    semanticViolations: row.decision?.semanticViolations,
  })), null, 2),
);
const luoInputs = capturedInputs.filter((input) => input.agent.id === ids.luo);
const luoInput = luoInputs[0];
const luoReplyInput = luoInputs.find((input) => input.privateActionCandidates.some((row) => (
  row.feasible
  && row.realization?.mode === "respond"
)));
const xieInput = capturedInputs.find((input) => input.agent.id === ids.xieZhenshi);
assert.ok(luoInput && luoReplyInput && xieInput, JSON.stringify({
  inputs: capturedInputs.map((input) => ({
    characterId: input.agent.id,
    zoneId: input.scene.zoneId,
    activation: input.activation,
    responseCandidates: input.privateActionCandidates.filter((row) => row.realization?.mode === "respond").map((row) => ({
      candidateId: row.candidateId,
      feasible: row.feasible,
      targetCharacterId: row.targetCharacterId,
    })),
  })),
  decisions: dryScene.decisions.map((row) => ({
    characterId: row.characterId,
    candidateId: row.candidateId,
    actionType: row.decision?.actionType,
    speechAct: row.decision?.speechAct,
    speech: row.decision?.speech,
    semanticViolations: row.decision?.semanticViolations,
  })),
}, null, 2));

const perceivedXie = luoInput.perceivedCharacters.find((row) => row.identityKnown === false);
const knownXie = luoInput.agent.psychologyAnchor.epistemics.knownEntities.find((row) => (
  row.knowsName === true && row.recognizesIdentity === false
));
const projectedCoreDesire = luoInput.agent.psychologyAnchor.desires.find((row) => (
  String(row.id || "").startsWith("desire_luozhao_test_own_limit_against_known_slug:")
));
assert.equal(perceivedXie?.identityKnown, false);
assert.equal(perceivedXie?.name, "");
assert.ok(perceivedXie?.id.startsWith("perceived_entity:"));
assert.ok(knownXie?.entityId.startsWith("known_entity:"));
assert.notEqual(knownXie.entityId, perceivedXie.id);
assert.equal(projectedCoreDesire?.target?.id, knownXie.entityId);
assert.equal(projectedCoreDesire?.target?.label, "谢真石");
assert.match(luoInput.agent.currentIntention, /谢真石/u);
assert.doesNotMatch(luoInput.agent.currentIntention, /酒馆帮工/u);
assert.equal(luoInput.agent.relationshipContext.some((row) => row.otherCharacterId === ids.xieZhenshi), false);
assert.equal(luoInput.agent.privateState.sceneRole.knowledgeBoundary.identityUnknownActorIds.includes(knownXie.entityId), true);
assert.equal(luoInput.agent.privateState.sceneRole.knowledgeBoundary.hearsayActorIds.includes(knownXie.entityId), true);
assert.equal(luoInput.agent.privateState.sceneRole.knowledgeBoundary.identityUnknownActorIds.includes(perceivedXie.id), false);
assert.equal(luoInput.agent.privateState.sceneRole.knowledgeBoundary.hearsayActorIds.includes(perceivedXie.id), false);
assert.equal(luoInput.identityReferenceContract.mergeAuthority, "character-agent-cognitive-appraisal");
assert.equal(JSON.stringify(luoInput).includes(ids.xieZhenshi), false);
assert.equal(JSON.stringify(luoInput).includes("xiezenshi"), false);
const projectedDesireCandidate = luoInput.privateActionCandidates.find((row) => (
  row.driveId === projectedCoreDesire?.id && row.actionKind === "pursue_desired_state"
));
assert.ok(projectedDesireCandidate);
assert.equal(projectedDesireCandidate.realization?.commitmentTopic, "谢真石");
assert.equal(
  projectedDesireCandidate.ownDecisionFactors?.desirePressure?.desireId,
  projectedCoreDesire.id,
);
assert.equal(
  projectedDesireCandidate.ownDecisionFactors?.desirePressure?.want,
  `${projectedCoreDesire.desiredState.verb}${projectedCoreDesire.desiredState.object}`,
);
assert.doesNotMatch(
  JSON.stringify({
    commitmentTopic: projectedDesireCandidate.realization?.commitmentTopic,
    desirePressure: projectedDesireCandidate.ownDecisionFactors?.desirePressure,
  }),
  /酒馆帮工|perceived_slug:/u,
);
const luoResponseCandidate = luoReplyInput.privateActionCandidates.find((row) => (
  row.feasible
  && row.targetCharacterId === unresolvedPerceivedCharacterId(luoReplyInput)
  && row.realization?.mode === "respond"
));
assert.ok(luoResponseCandidate);
const supportedQuestionIds = new Set(luoReplyInput.epistemicDecisionSupport.evaluations
  .filter((row) => row.primitive.startsWith("ask_"))
  .map((row) => row.candidateId));
assert.ok(supportedQuestionIds.size >= 4);
const ownedClaimBelief = luoReplyInput.epistemicBeliefState.claimBeliefs.find((row) => /传闻/u.test(row.claimSummary));
assert.ok(ownedClaimBelief, "Luo Zhao's owned hearsay must enter her epistemic tool");
assert.match(ownedClaimBelief.claimSummary, /传闻/u);
assert.doesNotMatch(ownedClaimBelief.claimSummary, /九层塔/u, "the runtime must not invent a specific rumor not present in owned memory");
const askClaimReaction = luoReplyInput.epistemicDecisionSupport.evaluations.find((row) => (
  row.primitive === "ask_claim_reaction"
));
assert.ok(askClaimReaction, "owned hearsay must create a direct reaction-probe option");
assert.equal(askClaimReaction.ownedClaimReference.beliefId, ownedClaimBelief.beliefId);
const claimCandidate = luoReplyInput.privateActionCandidates.find((row) => (
  row.actionKind === "ask_claim_reaction"
));
assert.ok(claimCandidate);
assert.equal(claimCandidate.realization.ownedClaimReference.beliefId, ownedClaimBelief.beliefId);
assert.equal(Object.hasOwn(claimCandidate.realization, "speech"), false, "owned rumor support must not prewrite Luo Zhao's question");
assert.deepEqual(
  new Set((luoResponseCandidate.realization?.epistemicQuestionOptions || []).map((row) => row.candidateId)),
  supportedQuestionIds,
  "a response that may introduce a new information question must carry the same owned-belief costs as explicit epistemic actions",
);

assert.ok(luoReplyInput.serviceChoice, "the live tavern input must expose ordinary service choice after entry");
assert.deepEqual(
  new Set(luoReplyInput.serviceChoice.offers.map((row) => row.id)),
  new Set(["hot_water", "tea", "house_tea_pot", "fine_cloud_tea_pot", "meal", "meat_meal"]),
);
assert.equal(luoReplyInput.serviceChoice.economicContext.wallet.amount, 24);
assert.equal(luoReplyInput.serviceChoice.economicContext.wallet.sourceId, "yuheng_visit_travel_allowance");
assert.equal(luoReplyInput.serviceChoice.economicContext.access.institutionalSupport, true);
assert.deepEqual(luoReplyInput.serviceChoice.economicContext.consumptionPreferences.qualitySensitivity, [0.66, 0.84]);
assert.deepEqual(luoReplyInput.serviceChoice.economicContext.consumptionPreferences.statusDisplayDrive, [0.02, 0.14]);
const liveTeaOffers = luoReplyInput.serviceChoice.offers.filter((row) => row.category === "tea");
assert.equal(liveTeaOffers.length, 4);
assert.equal(liveTeaOffers.find((row) => row.id === "fine_cloud_tea_pot")?.price.amount, 6);
assert.equal(liveTeaOffers.find((row) => row.id === "fine_cloud_tea_pot")?.qualityTier, "fine");
assert.ok(liveTeaOffers.every((row) => !Object.hasOwn(row, "preferred") && !Object.hasOwn(row, "score")));
assert.equal(luoReplyInput.serviceChoice.tableUseNorm.sitWithoutOrderingPhysicallyPossible, true);
assert.equal(luoReplyInput.serviceChoice.tableUseNorm.operatorResponseRequiresOwnAction, true);
assert.equal(luoReplyInput.serviceChoice.guestPositionOptions.length, 4);
assert.equal(luoReplyInput.serviceChoiceTool.choiceAuthority, "character-agent");
const requestTeaAffordance = luoReplyInput.availableAffordances.find((row) => (
  row.type === "request_service" && row.offeringId === "tea"
));
assert.ok(requestTeaAffordance, "tea must be a real live-world request rather than blind-probe-only data");
assert.equal(requestTeaAffordance.requiresSpeech, true);
assert.ok(luoReplyInput.privateActionCandidates.some((row) => (
  row.realization?.affordanceId === requestTeaAffordance.id
  && row.actionKind === "request_situated_service"
  && row.ownDecisionFactors.serviceAppraisal.informationCover > 0
)));
assert.equal(luoReplyInput.availableAffordances.filter((row) => row.type === "take_guest_seat").length, 4);

// Structural transaction exercise only: the harness selects one among several
// neutral service and position options to prove the world can settle it. This
// is not a predicted Luo Zhao choice, position or utterance.
const serviceState = structuredClone(fixture.state);
serviceState.tavernState = structuredClone(dryScene.tavernState);
for (const patch of dryScene.characterPatches) {
  const character = serviceState.characters.find((row) => row.id === patch.id);
  if (!character) continue;
  character.lifeState = structuredClone(patch.lifeState);
  character.ecologyState = structuredClone(patch.ecologyState);
}
const serviceRuntime = structuredClone(dryScene.privateSceneRuntime);
const liveLuoAffordances = listTavernCausalAffordances(serviceState, serviceRuntime, ids.luo, [ids.xieZhenshi]);
const structuralSeat = liveLuoAffordances.find((row) => row.type === "take_guest_seat");
const structuralTeaRequest = liveLuoAffordances.find((row) => row.type === "request_service" && row.offeringId === "tea");
assert.ok(structuralSeat && structuralTeaRequest);
const seatResult = applyTavernCausalAffordance(serviceState, serviceRuntime, {
  id: "test:luozhao:choose-one-neutral-seat",
  actorId: ids.luo,
  speech: "",
  visibleAction: "",
}, structuralSeat, [ids.xieZhenshi]);
assert.ok(seatResult);
assert.equal(serviceState.tavernState.activeVisits[0].seatingPositionId, structuralSeat.seatingPositionId);
assert.equal(serviceState.tavernState.objectLedger.objects.luozhao_sword.holderActorId, ids.luo);
assert.equal(serviceState.tavernState.objectLedger.objects.luozhao_sword.attachment.active, true);
const requestResult = applyTavernCausalAffordance(serviceState, serviceRuntime, {
  id: "test:luozhao:request-tea",
  actorId: ids.luo,
  speech: "来一碗茶。",
  visibleAction: "",
}, structuralTeaRequest, [ids.xieZhenshi]);
assert.ok(requestResult);
const requestedVisit = serviceState.tavernState.activeVisits[0];
assert.equal(requestedVisit.requestedService, "tea");
assert.equal(requestedVisit.serviceRequestStatus, "requested");
assert.equal(requestedVisit.serviceStatus, "pending");
assert.equal(requestedVisit.paymentStatus, "unpaid");
assert.equal(requestedVisit.purposeStatus, "undisclosed", "ordering tea must not auto-disclose or finish the private information purpose");
const xiePublicTransactionFacts = tavernCausalMaterialFacts(
  serviceState,
  serviceRuntime,
  ids.xieZhenshi,
  [ids.luo],
  [],
);
assert.equal(xiePublicTransactionFacts[0]?.requestedService, "tea", "the person who received the order must know the public tea request");
assert.equal(xiePublicTransactionFacts[0]?.serviceRequestStatus, "requested");
assert.equal(xiePublicTransactionFacts[0]?.purpose, "尚未说明", "a public tea order must not disclose Luo Zhao's separate private purpose");
assert.equal(xiePublicTransactionFacts[0]?.purposeAction, "");
assert.deepEqual(xiePublicTransactionFacts[0]?.purposeZoneIds, []);
assert.deepEqual(xiePublicTransactionFacts[0]?.objectiveSummary, {});
let xieAfterRequest = listTavernCausalAffordances(serviceState, serviceRuntime, ids.xieZhenshi, [ids.luo]);
assert.equal(xieAfterRequest.some((row) => row.type === "serve_guest"), false, "a request must not expose an instant-serve action");
for (let step = 0; step < 4 && !xieAfterRequest.some((row) => row.type === "start_service_preparation"); step += 1) {
  const approach = xieAfterRequest.find((row) => row.type === "approach_service_station" || row.type === "approach_service_vessel");
  assert.ok(approach, "the operator must be able to reach the vessel and preparation station");
  assert.ok(applyTavernCausalAffordance(serviceState, serviceRuntime, {
    id: `test:xiezenshi:approach-tea-station:${step}`,
    actorId: ids.xieZhenshi,
    speech: "",
    visibleAction: "",
    moveToZoneId: approach.moveToZoneId,
  }, approach, [ids.luo]));
  serviceRuntime.agents[ids.xieZhenshi].zoneId = approach.moveToZoneId;
  xieAfterRequest = listTavernCausalAffordances(serviceState, serviceRuntime, ids.xieZhenshi, []);
}
const startTeaPreparation = xieAfterRequest.find((row) => row.type === "start_service_preparation");
assert.ok(startTeaPreparation);
const startResult = applyTavernCausalAffordance(serviceState, serviceRuntime, {
  id: "test:xiezenshi:start-requested-tea",
  actorId: ids.xieZhenshi,
  speech: "",
  visibleAction: "",
  moveToZoneId: startTeaPreparation.moveToZoneId,
}, startTeaPreparation, [ids.luo]);
assert.ok(startResult);
serviceRuntime.agents[ids.xieZhenshi].zoneId = startTeaPreparation.moveToZoneId || serviceRuntime.agents[ids.xieZhenshi].zoneId;
assert.equal(requestedVisit.serviceStatus, "preparing");
assert.equal(requestedVisit.servicePreparationStatus, "preparing");
const teaProcess = serviceState.tavernState.serviceProcesses.find((row) => row.subjectId === requestedVisit.id);
assert.ok(teaProcess);
assert.ok(teaProcess.durationSeconds > 0);
assert.equal(listTavernCausalAffordances(serviceState, serviceRuntime, ids.xieZhenshi, []).some((row) => row.type === "serve_guest"), false);
serviceRuntime.elapsedSeconds += teaProcess.durationSeconds;
const finishTea = listTavernCausalAffordances(serviceState, serviceRuntime, ids.xieZhenshi, []).find((row) => row.type === "finish_service_preparation");
assert.ok(finishTea, "elapsed world time should expose a finish action rather than auto-delivery");
assert.ok(applyTavernCausalAffordance(serviceState, serviceRuntime, {
  id: "test:xiezenshi:finish-requested-tea",
  actorId: ids.xieZhenshi,
  speech: "",
  visibleAction: "",
}, finishTea, []));
assert.equal(requestedVisit.serviceStatus, "prepared");
let deliveryAffordances = listTavernCausalAffordances(serviceState, serviceRuntime, ids.xieZhenshi, []);
for (let step = 0; step < 4 && !deliveryAffordances.some((row) => row.type === "serve_guest"); step += 1) {
  const carryTea = deliveryAffordances.find((row) => row.type === "approach_service_delivery");
  assert.ok(carryTea);
  assert.ok(applyTavernCausalAffordance(serviceState, serviceRuntime, {
    id: `test:xiezenshi:carry-requested-tea:${step}`,
    actorId: ids.xieZhenshi,
    speech: "",
    visibleAction: "",
    moveToZoneId: carryTea.moveToZoneId,
  }, carryTea, []));
  serviceRuntime.agents[ids.xieZhenshi].zoneId = carryTea.moveToZoneId;
  deliveryAffordances = listTavernCausalAffordances(serviceState, serviceRuntime, ids.xieZhenshi, [ids.luo]);
}
const structuralServeTea = deliveryAffordances.find((row) => row.type === "serve_guest" && row.targetCharacterId === ids.luo);
assert.ok(structuralServeTea);
const serveResult = applyTavernCausalAffordance(serviceState, serviceRuntime, {
  id: "test:xiezenshi:serve-prepared-tea",
  actorId: ids.xieZhenshi,
  speech: "",
  visibleAction: "",
}, structuralServeTea, [ids.luo]);
assert.ok(serveResult);
assert.equal(requestedVisit.serviceStatus, "served");
assert.equal(requestedVisit.serviceConsumptionStatus, "pending");
const luoAfterService = listTavernCausalAffordances(serviceState, serviceRuntime, ids.luo, [ids.xieZhenshi]);
assert.ok(luoAfterService.some((row) => row.type === "consume_service" && row.offeringId === "tea"));
assert.ok(luoAfterService.some((row) => row.type === "pay_cash"));
assert.equal(requestedVisit.personalOpenLoops.some((row) => ["open", "deferred"].includes(row.status)), true);
assert.doesNotMatch(
  JSON.stringify({
    semanticFrame: luoResponseCandidate.semanticFrame,
    commitmentTopic: luoResponseCandidate.realization?.commitmentTopic,
  }),
  /desire_xiezenshi|本人亲眼确认真正高明且可能有助于自身剑术问题的展示/u,
  "Xie's unspoken desire must not become Luo Zhao's response topic",
);
const askCurrentPresence = luoReplyInput.epistemicDecisionSupport.evaluations.find((row) => (
  row.primitive === "ask_current_presence"
));
assert.ok(askCurrentPresence);
const accountedQuestion = normalizeTavernCharacterDecision({
  ...dryRunStrangerReply(luoReplyInput),
  speechAct: "ask",
  speech: "找人。谢真石在这里吗？",
  communicationPlan: {
    goal: "obtain_information",
    tactic: "direct",
    disclosure: "full",
    epistemicRelation: "uncertain",
    intendedAudienceCharacterIds: [unresolvedPerceivedCharacterId(luoReplyInput)],
    desiredEffect: "确认目标是否在场",
    threadDisposition: "open_new",
    epistemicActionCandidateId: askCurrentPresence.candidateId,
    presuppositionStance: "uncertain",
    epistemicBasisEvidenceIds: [],
  },
}, luoReplyInput, fixture.state, dryScene.privateSceneRuntime);
assert.equal(accountedQuestion.actionType, "speak", "weak presuppositions do not censor what a person may say");
assert.equal(accountedQuestion.epistemicQuestionAudit.status, "accounted");
assert.equal(accountedQuestion.epistemicQuestionAudit.selectedPrimitive, "ask_current_presence");
assert.ok(accountedQuestion.epistemicQuestionAudit.presupposition?.mismatch > 0);
assert.deepEqual(accountedQuestion.epistemicDiagnostics, []);
const answerAndQuestion = normalizeTavernCharacterDecision({
  ...dryRunStrangerReply(luoReplyInput),
  speechAct: "ask",
  speechFunctions: ["answer", "ask"],
  speech: "找人。听说这里有个叫谢真石的——是你吗？",
  communicationPlan: {
    goal: "obtain_information",
    tactic: "counter_question",
    disclosure: "partial",
    epistemicRelation: "uncertain",
    intendedAudienceCharacterIds: [unresolvedPerceivedCharacterId(luoReplyInput)],
    desiredEffect: "先回答来意，再确认眼前人的身份",
    threadDisposition: "counter",
    epistemicActionCandidateId: askCurrentPresence.candidateId,
    presuppositionStance: "uncertain",
    epistemicBasisEvidenceIds: [],
  },
}, luoReplyInput, fixture.state, dryScene.privateSceneRuntime);
assert.deepEqual(
  answerAndQuestion.speechFunctions,
  ["answer", "ask"],
  "the Character Agent can declare that one utterance answers the preceding purpose question and opens its own identity question",
);
assert.deepEqual(
  answerAndQuestion.epistemicDiagnostics,
  [],
  "epistemic accounting must inspect the literal compound utterance instead of rejecting it by its primary speechAct",
);

const compoundThreadRuntime = {
  step: 3,
  elapsedSeconds: 30,
  actions: [{
    id: "action:xie:ask-purpose",
    actorId: ids.xieZhenshi,
    targetCharacterId: ids.luo,
    speech: "你想打听什么？",
    speechAct: "ask",
    speechFunctions: ["ask"],
    sourceThreadId: "thread:compound-answer-and-question",
    slotId: "day-1-dawn",
    slotLabel: "清晨",
  }],
  requestLocks: [{
    id: "lock:xie-to-luo",
    threadId: "thread:compound-answer-and-question",
    requesterId: ids.xieZhenshi,
    responderId: ids.luo,
    topic: "来意",
    status: "awaiting",
    latestActionId: "action:xie:ask-purpose",
    attempts: 0,
  }],
  participantThreadStates: {},
};
const compoundTurn = {
  id: "action:luo:answer-and-ask",
  actorId: ids.luo,
  targetCharacterId: ids.xieZhenshi,
  speech: "谢真石。有人提过他的剑，我没见过。你怎么看？",
  speechAct: "ask",
  speechFunctions: ["answer", "ask"],
  sourceThreadId: "thread:compound-answer-and-question",
  responseToTurnId: "action:older-turn",
  responseSourceLine: "更早的一句，不是本轮直接来源。",
  responseSourceSlotId: "",
  responseSourceSlotLabel: "",
  threadDisposition: "open_new",
  communicationPlanAuthority: "character-agent",
  communicationPlan: {
    goal: "obtain_information",
    tactic: "direct",
    threadDisposition: "open_new",
  },
  publicTopic: "谢真石的剑",
};
updateRuntimeConversationLocks(compoundThreadRuntime, compoundTurn);
assert.equal(compoundTurn.responseToTurnId, "action:xie:ask-purpose");
assert.equal(compoundTurn.responseSourceLine, "你想打听什么？");
assert.equal(compoundThreadRuntime.requestLocks.find((lock) => lock.id === "lock:xie-to-luo")?.status, "resolved");
assert.equal(compoundThreadRuntime.requestLocks.find((lock) => (
  lock.requesterId === ids.luo && lock.responderId === ids.xieZhenshi
))?.status, "awaiting");
const unaccountedQuestion = normalizeTavernCharacterDecision({
  ...dryRunStrangerReply(luoReplyInput),
  speechAct: "ask",
  speech: "找人。谢真石在这里吗？",
  communicationPlan: {
    goal: "obtain_information",
    tactic: "direct",
    disclosure: "full",
    epistemicRelation: "uncertain",
    intendedAudienceCharacterIds: [unresolvedPerceivedCharacterId(luoReplyInput)],
    desiredEffect: "确认目标是否在场",
    threadDisposition: "open_new",
    epistemicActionCandidateId: "",
    presuppositionStance: "not_applicable",
    epistemicBasisEvidenceIds: [],
  },
}, luoReplyInput, fixture.state, dryScene.privateSceneRuntime);
assert.equal(unaccountedQuestion.actionType, "speak", "an unexplained question remains a real utterance rather than being deleted");
assert.ok(unaccountedQuestion.epistemicDiagnostics.some((row) => (
  row.code === "QUESTION_EPISTEMIC_ACCOUNTING_MISSING"
)));

const luoOwnedLetter = luoInput.perceivedObjects.find((object) => object.id === "luozhao_yuheng_visit_letter");
assert.equal(luoOwnedLetter?.ownObject, true);
assert.equal(luoOwnedLetter?.custody?.storageMode, "packed");
assert.equal(luoOwnedLetter?.custody?.inHand, false);
assert.equal(luoOwnedLetter?.presentation?.publiclyVisible, false);
assert.match(luoInput.materialFacts[0]?.arrivalCue || "", /拜帖/u, "the owner retains her own carried-object knowledge");

assert.equal(xieInput.materialFacts.length, 1, `off-scene visits must not enter another Agent's facts: ${JSON.stringify(xieInput.materialFacts)}`);
assert.equal(xieInput.materialFacts[0]?.purpose, "尚未说明");
assert.equal(xieInput.materialFacts[0]?.requestedService, "unknown");
assert.equal(xieInput.materialFacts[0]?.paymentMode, "unknown");
assert.equal(xieInput.materialFacts[0]?.stage, "present");
const xieSensorySurface = JSON.stringify({
  activation: xieInput.activation,
  perceivedImpacts: xieInput.perceivedImpacts,
  materialFacts: xieInput.materialFacts,
  perceivedObjects: xieInput.perceivedObjects,
});
assert.doesNotMatch(xieSensorySurface, /拜帖|玉衡宗|luozhao_yuheng_visit_letter/u, "a packed visit letter must not leak into another Agent's sensory surface");
const xieNoticedSword = xieInput.perceivedObjects.some((object) => (
  object.ownObject === false && object.label === "一柄带鞘长剑"
));
assert.equal(
  /一柄带鞘长剑/u.test(xieInput.materialFacts[0]?.arrivalCue || ""),
  xieNoticedSword,
  "a material visit summary must not bypass the Character's finite attention to reveal an unnoticed worn object",
);
const xieFactsWithoutNoticedSword = tavernCausalMaterialFacts(
  dryScene,
  dryScene.privateSceneRuntime,
  ids.xieZhenshi,
  [ids.luo],
  [],
);
assert.equal(xieFactsWithoutNoticedSword.length, 1);
assert.doesNotMatch(
  xieFactsWithoutNoticedSword[0]?.arrivalCue || "",
  /一柄带鞘长剑/u,
  "raw physical visibility must not be copied into observer knowledge after the attention layer omits the sword",
);
const xieFactsWithNoticedSword = tavernCausalMaterialFacts(
  dryScene,
  dryScene.privateSceneRuntime,
  ids.xieZhenshi,
  [ids.luo],
  ["luozhao_sword"],
);
assert.match(
  xieFactsWithNoticedSword[0]?.arrivalCue || "",
  /一柄带鞘长剑/u,
  "a sword actually selected by the observer's attention may enter that observer's material visit summary",
);

assert.equal(dryScene.actions.length, 3, JSON.stringify(dryScene.decisions.map((row) => ({
  characterId: row.characterId,
  candidateId: row.candidateId,
  actionType: row.decision?.actionType,
  speechAct: row.decision?.speechAct,
  hardCodes: (row.decision?.semanticViolations || []).map((violation) => violation.code),
}))));
const [entry, question, reply] = dryScene.actions;
assert.equal(entry.actorId, ids.luo);
assert.equal(entry.actionType, "move");
assert.equal(entry.moveToZoneId, "hall");
assert.equal(question.actorId, ids.xieZhenshi);
assert.equal(question.targetCharacterId, ids.luo);
assert.equal(question.speechAct, "ask");
assert.equal(reply.actorId, ids.luo);
assert.equal(reply.targetCharacterId, ids.xieZhenshi);

// A still-open visit may contain several new, committed nonverbal actions.
// Every new world action must permit the micro-clock to cross the next short
// cooldown once; an unchanged visit stage must not freeze the scene after the
// first cooldown advance. The explicit actions below are test mechanics only.
const quietContinuationCalls = [];
const quietContinuationScene = await runTavernCausalScene(fixture.state, {
  characterIds: fixture.characterIds,
  positions: fixture.positions,
  seedImpacts: fixture.seedImpacts,
  slotContext: fixture.slotContext,
  maxSteps: 6,
  maxLocalFollowupSteps: 0,
  minimumActivationScore: 0,
  async runAgent(input) {
    quietContinuationCalls.push(input.agent.id);
    return { decision: dryRunQuietContinuation(input) };
  },
});
assert.equal(
  quietContinuationScene.actions.length,
  6,
  `a new committed action must refresh bounded cooldown advancement during an open visit: ${JSON.stringify({
    calls: quietContinuationCalls,
    actions: quietContinuationScene.actions.map((action) => action.id),
    stopReason: quietContinuationScene.stopReason,
    elapsedSeconds: quietContinuationScene.sceneRuntime.elapsedSeconds,
  })}`,
);
assert.equal(quietContinuationScene.stopReason, "max-steps");
const quietContinuationIntegrity = evaluateCharacterExchangeIntegrity({
  requiredCharacterIds: fixture.characterIds,
  decisions: quietContinuationScene.decisions,
  actions: quietContinuationScene.actions,
});
assert.ok(
  quietContinuationIntegrity.causalPairs.length >= 1,
  `a noticed directed nonverbal action must retain causal provenance without requiring dialogue: ${JSON.stringify({
    issues: quietContinuationIntegrity.issues,
    actions: quietContinuationScene.actions.map((action) => ({
      actorId: action.actorId,
      targetCharacterId: action.targetCharacterId,
      causalParentImpactId: action.causalParentImpactId,
    })),
  })}`,
);
assert.equal(reply.speechAct, "answer");
assert.equal(reply.semanticFrame?.parentFrameId, question.publicSemanticFrame?.id);
assert.notEqual(
  question.publicSemanticFrame?.id,
  question.semanticFrame?.id,
  "the shared utterance frame must be distinct from the speaker's private desire/candidate frame",
);
assert.doesNotMatch(
  JSON.stringify(question.impactFactors || []),
  /desire_xiezenshi|本人亲眼确认真正高明且可能有助于自身剑术问题的展示/u,
  "the listener must receive only what Xie actually said, not the private desire that motivated it",
);
assert.equal(reply.sourceThreadId, question.sourceThreadId);
const falseRecognitionDecision = normalizeTavernCharacterDecision({
  ...dryRunStrangerReply(luoReplyInput),
  speech: "谢真石，你先回答我。",
}, luoReplyInput, fixture.state, dryScene.privateSceneRuntime);
assert.equal(
  falseRecognitionDecision.actionType,
  "speak",
  `guessing or deliberately using an unconfirmed name remains a real utterance: ${JSON.stringify({
    hard: falseRecognitionDecision.semanticViolations,
    claims: falseRecognitionDecision.claimAnnotations,
  })}`,
);
assert.ok(falseRecognitionDecision.claimAnnotations.some((violation) => (
  violation.code === "UNKNOWN_IDENTITY_USED_AS_CONFIRMED_ADDRESS"
)));
const knownEntityUsedAsPhysicalTarget = normalizeTavernCharacterDecision({
  ...dryRunStrangerReply(luoReplyInput),
  targetCharacterId: knownXie.entityId,
  communicationPlan: {
    goal: "inform",
    tactic: "direct",
    disclosure: "partial",
    epistemicRelation: "believes",
    intendedAudienceCharacterIds: [knownXie.entityId],
    desiredEffect: "把记忆中的人物当成眼前听者",
    threadDisposition: "settle",
  },
}, luoReplyInput, fixture.state, dryScene.privateSceneRuntime);
assert.equal(knownEntityUsedAsPhysicalTarget.actionType, "pass");
assert.ok(knownEntityUsedAsPhysicalTarget.semanticViolations.some((violation) => (
  violation.code === "COMMUNICATION_AUDIENCE_NOT_PERCEIVED"
)), JSON.stringify(knownEntityUsedAsPhysicalTarget.semanticViolations));
const integrity = evaluateCharacterExchangeIntegrity({
  requiredCharacterIds: fixture.characterIds,
  decisions: dryScene.decisions,
  actions: dryScene.actions,
});
assert.equal(integrity.complete, true, JSON.stringify(integrity.issues));

for (const input of capturedInputs) {
  const audit = auditCodexTrustedTavernAgentInput(input);
  assert.deepEqual(audit.errors, []);
  assert.equal(audit.valid, true);
  assert.equal(audit.boundary.finalChoiceOwner, "character-agent");
  for (const candidate of input.privateActionCandidates) {
    assert.equal(candidate.speechRealization?.authority, "generic-conversational-realization");
    assert.equal(candidate.speechRealization?.privateReasonIsNotSpeech, true);
  }
}

const contaminatedLuoInput = structuredClone(luoInput);
const contaminatedDesireCandidate = contaminatedLuoInput.privateActionCandidates.find((row) => (
  row.driveId === projectedCoreDesire.id && row.actionKind === "pursue_desired_state"
));
contaminatedDesireCandidate.realization.commitmentTopic = perceivedXie.role;
contaminatedDesireCandidate.ownDecisionFactors.desirePressure.desireId = projectedCoreDesire.id
  .replace("known_slug:", "perceived_slug:");
contaminatedDesireCandidate.ownDecisionFactors.desirePressure.want = `${projectedCoreDesire.desiredState.verb}${projectedCoreDesire.desiredState.object}`
  .replaceAll("谢真石", perceivedXie.role);
const contaminatedAudit = auditCodexTrustedTavernAgentInput(contaminatedLuoInput);
assert.equal(contaminatedAudit.valid, false);
assert.ok(contaminatedAudit.errors.some((row) => (
  row.code === "DESIRE_SEMANTIC_TOPIC_BOUND_TO_UNRECOGNIZED_STRANGER"
)));
assert.ok(contaminatedAudit.errors.some((row) => row.code === "DESIRE_PRESSURE_REFERENT_DRIFT"));
assert.ok(contaminatedAudit.errors.some((row) => row.code === "DESIRE_PRESSURE_SEMANTIC_DRIFT"));

const contaminatedResponseInput = structuredClone(luoReplyInput);
const contaminatedResponseCandidate = contaminatedResponseInput.privateActionCandidates.find((row) => (
  row.realization?.mode === "respond"
));
contaminatedResponseCandidate.semanticFrame.object = {
  id: "desire:desire_xiezenshi_continue_observing_verified_high_skill:pursue",
  label: "本人亲眼确认真正高明且可能有助于自身剑术问题的展示",
};
const contaminatedResponseAudit = auditCodexTrustedTavernAgentInput(contaminatedResponseInput);
assert.equal(contaminatedResponseAudit.valid, false);
assert.ok(contaminatedResponseAudit.errors.some((row) => (
  row.code === "RECIPIENT_RESPONSE_PRIVATE_DESIRE_LEAK"
)));
const responseWithoutEpistemicOptions = structuredClone(luoReplyInput);
const responseWithoutOptionsCandidate = responseWithoutEpistemicOptions.privateActionCandidates.find((row) => (
  row.realization?.mode === "respond" && (row.realization?.allowedSpeechActs || []).includes("ask")
));
responseWithoutOptionsCandidate.realization.epistemicQuestionOptions = [];
const responseWithoutOptionsAudit = auditCodexTrustedTavernAgentInput(responseWithoutEpistemicOptions);
assert.equal(responseWithoutOptionsAudit.valid, false);
assert.ok(responseWithoutOptionsAudit.errors.some((row) => (
  row.code === "RESPONSE_EPISTEMIC_QUESTION_OPTIONS_MISSING"
)));

const prompt = buildCodexTrustedTavernAgentPrompt(luoInput);
for (const forbidden of [
  path.resolve(import.meta.dirname, "..", ".."),
  "anchor-payload.json",
  "calibration-evidence.json",
  "holdouts.md",
  "你打算一直装作没看见？",
  "好剑。",
  "我会再来",
  "粗焙山茶。",
  "堂前后院通道口外",
  "姑娘，堂前有座。你是来吃饭，还是找人？",
]) {
  assert.equal(prompt.includes(forbidden), false, `trusted tavern prompt leaked ${forbidden}`);
}
for (const neutralPosition of ["堂前侧墙空桌", "堂中空桌", "近柜台空位", "近门侧凳"]) {
  assert.ok(prompt.includes(neutralPosition), `trusted tavern prompt must expose neutral world position ${neutralPosition}`);
}
assert.equal(prompt.includes("preferredPositionId"), false);
assert.equal(prompt.includes("chosenPositionId"), false);
assert.equal(prompt.includes("desire_luozhao_test_own_limit_against_xiezenshi"), false);
assert.ok(prompt.includes("known_slug:"));
assert.ok(prompt.includes('"knownEntityPrefix": "known_entity:"'));
assert.ok(prompt.includes('"perceivedEntityPrefix": "perceived_entity:"'));
assert.ok(prompt.includes('"identityUnknownActorIds"'));
assert.ok(prompt.includes('"hearsayActorIds"'));
assert.ok(prompt.includes('"recognizesIdentity": false'));

const schema = buildCodexTrustedTavernAgentDecisionSchema(luoInput);
function assertStrictObjects(node, pathName = "$") {
  if (!node || typeof node !== "object") return;
  if (node.type === "object" && node.properties) {
    assert.equal(node.additionalProperties, false, `${pathName} must reject unknown fields`);
    assert.deepEqual(new Set(node.required || []), new Set(Object.keys(node.properties)));
    for (const [key, child] of Object.entries(node.properties)) assertStrictObjects(child, `${pathName}.${key}`);
  }
  if (node.items) assertStrictObjects(node.items, `${pathName}[]`);
}
assertStrictObjects(schema);

for (const [index, input] of capturedInputs.entries()) {
  const invocation = buildCodexTrustedTavernAgentInvocation({
    input,
    tempDirectory: `/private/tmp/gtown-luozhao-behavior-contract-${index}`,
    schemaPath: `/private/tmp/gtown-luozhao-behavior-contract-${index}/decision.schema.json`,
    outputPath: `/private/tmp/gtown-luozhao-behavior-contract-${index}/decision.json`,
  });
  assert.equal(invocation.purpose, CODEX_TRUSTED_TAVERN_AGENT_PURPOSE);
  assert.equal(invocation.command, "codex");
  assert.equal(invocation.stdin, buildCodexTrustedTavernAgentPrompt(input));
  assert.ok(invocation.args.includes("--ephemeral"));
  assert.ok(invocation.args.includes("--ignore-user-config"));

  const stubDecision = schemaCompletePass(input);
  const trustedResult = await runTavernCausalAgentWithCodex(input, {
    async execute(stubInvocation) {
      const outputIndex = stubInvocation.args.indexOf("--output-last-message");
      assert.notEqual(outputIndex, -1);
      await fs.writeFile(stubInvocation.args[outputIndex + 1], `${JSON.stringify(stubDecision)}\n`, "utf8");
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  });
  assert.deepEqual(trustedResult.decision, stubDecision);
  assert.equal(trustedResult.stage.provider, "openai");
  assert.equal(trustedResult.stage.inputAuditPassed, true);
}

const manifest = JSON.parse(await fs.readFile(
  new URL("../.codex/anchors/scene_xyy_wangti_tavern/characters/char_xyy_luozhao/manifest.json", import.meta.url),
  "utf8",
));
assert.equal(manifest.gates.runtimeMapping, "mapped");
assert.equal(manifest.gates.behaviorAcceptance, "pending");

console.log("luoZhaoTavernBehaviorAcceptance:test passed", {
  characterIds: capturedInputs.map((input) => input.agent.id),
  candidateCounts: Object.fromEntries(capturedInputs.map((input) => [input.agent.id, input.privateActionCandidates.length])),
  inputAuditPassed: true,
  remoteModelCalled: false,
  prewrittenDialogueInOutboundPrompt: false,
  identityStillUnknownAtReply: perceivedXie.identityKnown === false,
  causalExchangeComplete: integrity.complete,
  recordedBehaviorAcceptance: manifest.gates.behaviorAcceptance,
});
