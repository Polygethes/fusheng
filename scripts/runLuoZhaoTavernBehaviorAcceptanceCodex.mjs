import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  auditCodexTrustedTavernAgentInput,
  runTavernCausalAgentWithCodex,
} from "../src/server/ecology/codexTrustedTavernAgentChannel.mjs";
import { runTavernCausalScene } from "../src/server/pipeline/tavernCausalScene.mjs";
import { evaluateCharacterExchangeIntegrity } from "../src/server/simulation/characterExchangeIntegrity.mjs";
import {
  LUO_ZHAO_BEHAVIOR_ACCEPTANCE_IDS,
  buildLuoZhaoTavernBehaviorAcceptanceFixture,
} from "./fixtures/luoZhaoTavernBehaviorAcceptanceFixture.mjs";

const ids = LUO_ZHAO_BEHAVIOR_ACCEPTANCE_IDS;
const requestedTrustedModel = String(process.env.GTOWN_TRUSTED_MODEL || "").trim();
const requestedTrustedReasoningEffort = String(process.env.GTOWN_TRUSTED_REASONING_EFFORT || "").trim();
const hardRequestLimit = 30;

function diagnosticText(value = "", maxLength = 12000) {
  const source = String(value || "");
  return source.length <= maxLength ? source : source.slice(source.length - maxLength);
}

function candidateSummary(candidate = {}, chosenCandidateId = "") {
  return {
    candidateId: candidate.candidateId || "",
    chosen: candidate.candidateId === chosenCandidateId,
    feasible: Boolean(candidate.feasible),
    activationScore: Number(candidate.activationScore || 0),
    priorityTier: Number(candidate.priorityTier || 0),
    driveId: candidate.driveId || "",
    actionKind: candidate.actionKind || "",
    targetCharacterId: candidate.targetCharacterId || "",
    label: candidate.label || "",
    blockedBy: candidate.blockedBy || [],
    expressionMode: candidate.expressionStrategy?.mode || "",
    realizationMode: candidate.realization?.mode || "",
    allowedSpeechActs: candidate.realization?.allowedSpeechActs || [],
    speechRealization: candidate.speechRealization || null,
    affordanceId: candidate.realization?.affordanceId || "",
  };
}

function agentInputSummary(input = {}, chosenCandidateId = "") {
  const coreDesireId = input.agent?.id === ids.luo
    ? (input.agent?.psychologyAnchor?.desires || []).find((row) => (
      String(row.id || "").startsWith("desire_luozhao_test_own_limit_against_")
    ))?.id || ""
    : "";
  return {
    characterId: input.agent?.id || "",
    characterName: input.agent?.name || "",
    scene: input.scene || null,
    sceneRole: input.agent?.privateState?.sceneRole || null,
    body: input.agent?.privateState?.ecologyState?.body || null,
    affect: input.agent?.privateState?.ecologyState?.affect || null,
    coreDesire: coreDesireId
      ? input.agent?.psychologyAnchor?.desires?.find((row) => row.id === coreDesireId) || null
      : input.agent?.psychologyAnchor?.desires || [],
    currentDesireState: coreDesireId
      ? input.agent?.privateState?.ecologyState?.desires?.[coreDesireId] || null
      : input.agent?.privateState?.ecologyState?.desires || {},
    knowledgeBoundary: input.agent?.privateState?.sceneRole?.knowledgeBoundary || null,
    relationshipContext: input.agent?.relationshipContext || [],
    retrievedMemory: input.agent?.memoryContext || null,
    activation: input.activation || null,
    perceivedImpacts: input.perceivedImpacts || [],
    perceivedCharacters: input.perceivedCharacters || [],
    materialFacts: input.materialFacts || [],
    availableAffordances: input.availableAffordances || [],
    candidates: (input.privateActionCandidates || [])
      .map((candidate) => candidateSummary(candidate, chosenCandidateId))
      .sort((left, right) => right.priorityTier - left.priorityTier || right.activationScore - left.activationScore),
  };
}

function perceivedIdentityRows(calls = []) {
  return calls
    .filter((call) => call.characterId === ids.luo)
    .map((call) => {
      const perceived = (call.input?.perceivedCharacters || []).find((row) => row.identityKnown === false) || null;
      const known = (call.input?.agent?.psychologyAnchor?.epistemics?.knownEntities || []).find((row) => (
        row.knowsName === true && row.recognizesIdentity !== true
      )) || null;
      const desire = (call.input?.agent?.psychologyAnchor?.desires || []).find((row) => (
        String(row.id || "").startsWith("desire_luozhao_test_own_limit_against_")
      )) || null;
      return {
        callIndex: call.callIndex,
        repairAttempt: call.repairAttempt,
        zoneId: call.input?.scene?.zoneId || "",
        identityKnown: perceived?.identityKnown ?? null,
        exposedName: perceived?.name || "",
        perceivedEntityId: perceived?.id || "",
        knownHearsayEntityId: known?.entityId || "",
        desiredTargetEntityId: desire?.target?.id || "",
        referentsDistinct: Boolean(
          perceived?.id
          && known?.entityId
          && perceived.id !== known.entityId
          && desire?.target?.id === known.entityId
        ),
        relationshipContextPresent: (call.input?.agent?.relationshipContext || [])
          .some((row) => row.otherCharacterId === ids.xieZhenshi),
        hearsayActorIds: call.input?.agent?.privateState?.sceneRole?.knowledgeBoundary?.hearsayActorIds || [],
        identityUnknownActorIds: call.input?.agent?.privateState?.sceneRole?.knowledgeBoundary?.identityUnknownActorIds || [],
      };
    });
}

function gateProjectionAuditErrors(input = {}) {
  const errors = [];
  if (input.agent?.id === ids.luo) {
    const perceived = (input.perceivedCharacters || []).find((row) => row.identityKnown === false) || null;
    const known = (input.agent?.psychologyAnchor?.epistemics?.knownEntities || []).find((row) => (
      row.knowsName === true && row.recognizesIdentity !== true
    )) || null;
    const desire = (input.agent?.psychologyAnchor?.desires || []).find((row) => (
      String(row.id || "").startsWith("desire_luozhao_test_own_limit_against_")
    )) || null;
    if (!known?.entityId?.startsWith("known_entity:")) {
      errors.push({
        code: "KNOWN_HEARSAY_ENTITY_HANDLE_MISSING",
        path: "input.agent.psychologyAnchor.epistemics.knownEntities",
        message: "洛照知道姓名但尚未认出本人的目标没有独立 known_entity 句柄",
      });
    }
    if (!perceived?.id?.startsWith("perceived_entity:")) {
      errors.push({
        code: "CURRENT_PERCEIVED_ENTITY_HANDLE_MISSING",
        path: "input.perceivedCharacters",
        message: "洛照眼前尚未认出的少年没有独立 perceived_entity 句柄",
      });
    }
    if (known?.entityId && perceived?.id && known.entityId === perceived.id) {
      errors.push({
        code: "HEARSAY_AND_CURRENT_PERSON_COLLAPSED",
        path: "input.agent.psychologyAnchor.epistemics.knownEntities|input.perceivedCharacters",
        message: "传闻中的谢真石与眼前未认出的酒馆帮工被错误投影成同一实体",
      });
    }
    if (desire?.target?.id !== known?.entityId || desire?.target?.id === perceived?.id) {
      errors.push({
        code: "DESIRE_TARGET_BOUND_TO_UNRECOGNIZED_STRANGER",
        path: "input.agent.psychologyAnchor.desires",
        message: "洛照的长期欲望必须指向传闻中的已知人物，不能提前绑定眼前陌生人",
      });
    }
    const runtimeDesire = (input.agent?.privateState?.ecologyProfile?.desires || []).find((row) => (
      row.id === desire?.id
    )) || null;
    const desireCandidate = (input.privateActionCandidates || []).find((row) => (
      row.driveId === desire?.id && row.actionKind === "pursue_desired_state"
    )) || null;
    const expectedWant = runtimeDesire
      ? `${runtimeDesire.desiredState?.verb || "想"}${runtimeDesire.desiredState?.object || runtimeDesire.target?.label || "推进自己的目标"}`
        .replace(/\s+/g, " ")
        .trim()
      : "";
    if (!desireCandidate
      || desireCandidate.ownDecisionFactors?.desirePressure?.desireId !== desire?.id
      || desireCandidate.desire !== expectedWant
      || desireCandidate.ownDecisionFactors?.desirePressure?.want !== desireCandidate.desire) {
      errors.push({
        code: "LUO_DESIRE_PRESSURE_REFERENT_DRIFT",
        path: "input.privateActionCandidates",
        message: "洛照主欲望候选的心理压力没有继续指向传闻中的谢真石",
      });
    }
    if (desireCandidate?.realization?.commitmentTopic !== "谢真石") {
      errors.push({
        code: "LUO_DESIRE_TOPIC_BOUND_TO_CURRENT_STRANGER",
        path: "input.privateActionCandidates[].realization.commitmentTopic",
        message: "洛照主欲望候选的语义主题被错误绑定为眼前尚未认出的酒馆帮工",
      });
    }
  }
  if (input.agent?.id !== ids.xieZhenshi) return errors;
  const sensorySurface = JSON.stringify({
    activation: input.activation,
    perceivedImpacts: input.perceivedImpacts,
    materialFacts: input.materialFacts,
    perceivedObjects: input.perceivedObjects,
  });
  if (/拜帖|玉衡宗|luozhao_yuheng_visit_letter/u.test(sensorySurface)) {
    errors.push({
      code: "HIDDEN_VISIT_OBJECT_LEAK",
      path: "input.perceivedImpacts|materialFacts|perceivedObjects",
      message: "洛照未取出、未展示的拜帖进入了谢真石的感知材料",
    });
  }
  if ((input.materialFacts || []).length !== 1) {
    errors.push({
      code: "OFFSCENE_VISIT_FACT_LEAK",
      path: "input.materialFacts",
      message: "双 Agent 隔离场景包含不在场人物的来访事务",
    });
  }
  const visitFact = input.materialFacts?.[0] || null;
  const privatePurposeProjection = visitFact ? {
    purpose: visitFact.purpose,
    purposeStatus: visitFact.purposeStatus,
    purposeAction: visitFact.purposeAction,
    purposeZoneIds: visitFact.purposeZoneIds,
    personalOpenLoops: visitFact.personalOpenLoops,
    objectiveSummary: visitFact.objectiveSummary,
  } : null;
  if (visitFact && (
    visitFact.purpose !== "尚未说明"
    || visitFact.purposeStatus !== "undisclosed"
    || Boolean(visitFact.purposeAction)
    || (visitFact.purposeZoneIds || []).length > 0
    || (visitFact.personalOpenLoops || []).length > 0
    || Object.keys(visitFact.objectiveSummary || {}).length > 0
  )) {
    errors.push({
      code: "UNDISCLOSED_VISIT_INTENT_LEAK",
      path: "input.materialFacts[0]",
      message: "洛照可以公开点茶而继续隐藏私人寻人目的；服务交易不能把未公开来意、个人循环或目的路线投影给谢真石",
      evidence: privatePurposeProjection,
    });
  }
  const noticedWornSword = (input.perceivedObjects || []).some((object) => (
    object.ownObject === false && object.label === "一柄带鞘长剑"
  ));
  const arrivalCueClaimsSword = /一柄带鞘长剑/u.test(visitFact?.arrivalCue || "");
  if (noticedWornSword !== arrivalCueClaimsSword) {
    errors.push({
      code: "OBJECT_ATTENTION_PROJECTION_DIVERGENCE",
      path: "input.materialFacts[0].arrivalCue|input.perceivedObjects",
      message: "人物未注意到的佩带物被事务摘要偷渡，或已注意物件未进入感知物件表",
    });
  }
  return errors;
}

const fixture = buildLuoZhaoTavernBehaviorAcceptanceFixture();
const modelCalls = [];
const startedAt = Date.now();

try {
  const scene = await runTavernCausalScene(fixture.state, {
    characterIds: fixture.characterIds,
    positions: fixture.positions,
    seedImpacts: fixture.seedImpacts,
    slotContext: fixture.slotContext,
    maxSteps: 8,
    maxLocalFollowupSteps: 2,
    minimumActivationScore: 0,
    async runAgent(input, options) {
      if (modelCalls.length >= hardRequestLimit) {
        const error = new RangeError(`洛照 Gate 8 远程请求达到硬上限 ${hardRequestLimit}，已停止继续发送。`);
        error.code = "LUO_GATE8_REMOTE_REQUEST_LIMIT_REACHED";
        throw error;
      }
      const genericAudit = auditCodexTrustedTavernAgentInput(input);
      const projectionErrors = gateProjectionAuditErrors(input);
      const audit = {
        ...genericAudit,
        valid: genericAudit.valid && projectionErrors.length === 0,
        errors: [...genericAudit.errors, ...projectionErrors],
      };
      const call = {
        callIndex: modelCalls.length + 1,
        characterId: input.agent?.id || "",
        characterName: input.agent?.name || "",
        repairAttempt: Boolean(input.repairFeedback),
        repairAttemptNumber: Number(input.repairFeedback?.attempt || 0),
        inputAudit: audit,
        input: structuredClone(input),
        rawDecision: null,
        stage: null,
      };
      modelCalls.push(call);
      try {
        if (!audit.valid) {
          const error = new TypeError(audit.errors.map((entry) => `${entry.code}@${entry.path}: ${entry.message}`).join("\n"));
          error.code = "INVALID_LUO_GATE8_PERCEPTION_PROJECTION";
          throw error;
        }
        const result = await runTavernCausalAgentWithCodex(input, {
          ...options,
          ...(requestedTrustedModel ? { model: requestedTrustedModel } : {}),
          ...(requestedTrustedReasoningEffort ? { reasoningEffort: requestedTrustedReasoningEffort } : {}),
        });
        call.rawDecision = structuredClone(result.decision);
        call.stage = structuredClone(result.stage);
        return result;
      } catch (error) {
        call.error = {
          code: error?.code || "CODEX_TRUSTED_TAVERN_AGENT_CALL_FAILED",
          message: error?.message || String(error),
          exitCode: error?.exitCode ?? null,
          stdout: diagnosticText(error?.stdout),
          stderr: diagnosticText(error?.stderr),
        };
        throw error;
      }
    },
  });

  const finalDecisionByCharacter = new Map();
  for (const decision of scene.decisions) finalDecisionByCharacter.set(decision.characterId, decision);
  const firstInputsByCharacter = new Map();
  for (const call of modelCalls) {
    if (!firstInputsByCharacter.has(call.characterId)) firstInputsByCharacter.set(call.characterId, call.input);
  }
  const executionIntegrity = evaluateCharacterExchangeIntegrity({
    requiredCharacterIds: fixture.characterIds,
    decisions: scene.decisions,
    actions: scene.actions,
    stopReason: scene.stopReason,
    unresolvedRequests: scene.unresolvedRequests,
  });
  const committedTurnTargetMet = scene.actions.length >= fixture.reviewScenario.targetCommittedAgentTurns;
  const epistemicDiagnostics = scene.actions.flatMap((action) => (
    (action.epistemicDiagnostics || []).map((diagnostic) => ({
      actionId: action.id,
      actorId: action.actorId,
      speech: action.speech,
      ...diagnostic,
    }))
  ));
  const privateProposalDiagnostics = scene.actions.flatMap((action) => (
    (action.privateProposalDiagnostics || []).map((diagnostic) => ({
      actionId: action.id,
      actorId: action.actorId,
      candidateId: action.candidateId,
      ...diagnostic,
    }))
  ));
  const structurallyComplete = executionIntegrity.complete && committedTurnTargetMet;
  const readyForAuthorReview = structurallyComplete
    && epistemicDiagnostics.length === 0
    && privateProposalDiagnostics.length === 0;
  const luoPatch = scene.characterPatches.find((row) => row.id === ids.luo) || null;
  const sword = scene.tavernState?.objectLedger?.objects?.luozhao_sword || null;
  const visitLetter = scene.tavernState?.objectLedger?.objects?.luozhao_yuheng_visit_letter || null;
  const carriedObjectIntegrity = Boolean(
    sword?.holderActorId === ids.luo
    && sword?.attachment?.active === true
    && sword?.state?.sheathed !== false
    && visitLetter?.holderActorId === ids.luo
    && visitLetter?.custody?.storageMode === "packed"
    && visitLetter?.custody?.inHand !== true
    && visitLetter?.presentation?.publiclyVisible !== true
  );
  const finalReadyForAuthorReview = readyForAuthorReview && carriedObjectIntegrity;
  const report = {
    gate: "luozhao-gate8-real-tavern-behavior",
    status: finalReadyForAuthorReview
      ? "author_review_required"
      : structurallyComplete ? "system_audit_failed" : "execution_incomplete",
    authorAcceptance: finalReadyForAuthorReview ? "pending" : "not_applicable",
    elapsedMs: Date.now() - startedAt,
    scenario: fixture.reviewScenario,
    trustedExecution: {
      remoteRequestCount: modelCalls.length,
      hardRequestLimit,
      calls: modelCalls.map((call) => ({
        callIndex: call.callIndex,
        characterId: call.characterId,
        characterName: call.characterName,
        repairAttempt: call.repairAttempt,
        repairAttemptNumber: call.repairAttemptNumber,
        inputAuditPassed: call.inputAudit.valid,
        inputAuditErrors: call.inputAudit.errors,
        provider: call.stage?.provider || "",
        channel: call.stage?.channel || "",
        model: call.stage?.model || "",
        reasoningEffort: call.stage?.reasoningEffort || "",
        isolation: call.stage?.isolation || "",
        elapsedMs: call.stage?.elapsedMs || 0,
      })),
    },
    executionIntegrity: {
      ...executionIntegrity,
      targetCommittedAgentTurns: fixture.reviewScenario.targetCommittedAgentTurns,
      actualCommittedAgentTurns: scene.actions.length,
      committedTurnTargetMet,
      epistemicQuestionAccountingPassed: epistemicDiagnostics.length === 0,
      privateProposalAuditPassed: privateProposalDiagnostics.length === 0,
      carriedObjectIntegrityPassed: carriedObjectIntegrity,
      epistemicDiagnostics,
      privateProposalDiagnostics,
    },
    agentInputSummaries: [...firstInputsByCharacter.entries()].map(([characterId, input]) => agentInputSummary(
      input,
      finalDecisionByCharacter.get(characterId)?.candidateId || "",
    )),
    fullAgentInputs: modelCalls.map((call) => ({
      callIndex: call.callIndex,
      repairAttempt: call.repairAttempt,
      characterId: call.characterId,
      input: call.input,
    })),
    rawModelAttempts: modelCalls.map((call) => ({
      callIndex: call.callIndex,
      repairAttempt: call.repairAttempt,
      characterId: call.characterId,
      decision: call.rawDecision,
    })),
    normalizedCharacterChoices: scene.decisions,
    identityBoundaryTrace: perceivedIdentityRows(modelCalls),
    worldResolution: {
      stopReason: scene.stopReason,
      committedActions: scene.actions,
      impacts: scene.actions.flatMap((action) => action.impactFactors || []),
      deliveries: scene.deliveries.filter((delivery) => scene.actions.some((action) => (
        (action.impactFactors || []).some((impact) => impact.id === delivery.impactId)
      ))),
      relationshipShifts: scene.relationshipShifts,
      epistemicQuestionAudits: scene.actions.map((action) => ({
        actionId: action.id,
        actorId: action.actorId,
        speech: action.speech,
        audit: action.epistemicQuestionAudit || null,
      })),
      carriedObjects: { sword, visitLetter },
      settledDesireState: luoPatch?.ecologyState?.desires?.desire_luozhao_test_own_limit_against_xiezenshi || null,
      ownedMemoryTail: (luoPatch?.agentMemory?.episodes || []).slice(-5),
      selfNarrative: luoPatch?.agentMemory?.selfNarrative || null,
    },
    authorReviewQuestions: finalReadyForAuthorReview ? [
      "洛照的入店、站位、停留、消费或离开是否来自她自己的 Agent，而不是酒馆替她安排？",
      "谢真石是否只把她的实际行动当成可回应机会，而没有因酒馆职责被强迫进入客服流程？",
      "两人的后续是否逐步承接前一人物真正做出的动作或话语，而不是各自宣读目的？",
      "洛照在没有证据前是否仍把眼前少年视为陌生人；若提到谢真石姓名，是否只是打听而非隔空认人？",
      "洛照的佩剑与拜帖是否持续遵守物件持有和位置事实？",
      "两人的句式、停顿、信息省略和行动节奏是否自然且具有各自个性？",
      "关系是否只有在人物本人对新证据作出评价时才变化，没有由世界层自动加亲密或敌意？",
    ] : [],
    promotionRule: "只有作者明确接受本次真实双 Agent 互动，才允许把洛照 behaviorAcceptance 从 pending 改为 passed。",
  };
  const reportPath = path.resolve(
    process.env.GTOWN_GATE8_REPORT_PATH || path.join(os.tmpdir(), "gtown-luozhao-gate8-latest.json"),
  );
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    gate: report.gate,
    status: report.status,
    authorAcceptance: report.authorAcceptance,
    elapsedMs: report.elapsedMs,
    reportPath,
    remoteRequestCount: report.trustedExecution.remoteRequestCount,
    calls: report.trustedExecution.calls,
    executionIntegrity: report.executionIntegrity,
    identityBoundaryTrace: report.identityBoundaryTrace,
    worldResolution: {
      stopReason: report.worldResolution.stopReason,
      carriedObjects: report.worldResolution.carriedObjects,
      committedActions: report.worldResolution.committedActions.map((action) => ({
        id: action.id,
        actorId: action.actorId,
        targetCharacterId: action.targetCharacterId,
        actionType: action.actionType,
        speechAct: action.speechAct,
        speech: action.speech,
        visibleAction: action.visibleAction,
        fromZoneId: action.fromZoneId,
        toZoneId: action.toZoneId,
        sourceThreadId: action.sourceThreadId,
        causalParentImpactId: action.causalParentImpactId,
      })),
    },
  }, null, 2));
  if (!finalReadyForAuthorReview) process.exitCode = 2;
} catch (error) {
  console.error(JSON.stringify({
    gate: "luozhao-gate8-real-tavern-behavior",
    status: "execution_failed",
    authorAcceptance: "pending",
    code: error?.code || "LUO_ZHAO_TAVERN_BEHAVIOR_ACCEPTANCE_FAILED",
    message: error?.message || String(error),
    exitCode: error?.exitCode ?? null,
    stdout: diagnosticText(error?.stdout),
    stderr: diagnosticText(error?.stderr),
    issues: error?.issues || [],
    remoteRequestCount: modelCalls.length,
    calls: modelCalls.map((call) => ({
      callIndex: call.callIndex,
      characterId: call.characterId,
      repairAttempt: call.repairAttempt,
      inputAuditPassed: call.inputAudit.valid,
      rawDecision: call.rawDecision,
      stage: call.stage,
      error: call.error || null,
    })),
  }, null, 2));
  process.exitCode = 1;
}
