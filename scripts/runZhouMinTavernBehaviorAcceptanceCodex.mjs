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
  ZHOU_MIN_BEHAVIOR_ACCEPTANCE_IDS,
  buildZhouMinTavernBehaviorAcceptanceFixture,
} from "./fixtures/zhouMinTavernBehaviorAcceptanceFixture.mjs";

function candidateSummary(candidate = {}, chosenCandidateId = "") {
  return {
    candidateId: candidate.candidateId || "",
    chosen: candidate.candidateId === chosenCandidateId,
    feasible: Boolean(candidate.feasible),
    activationScore: Number(candidate.activationScore || 0),
    driveId: candidate.driveId || "",
    actionKind: candidate.actionKind || "",
    targetCharacterId: candidate.targetCharacterId || "",
    label: candidate.label || "",
    blockedBy: candidate.blockedBy || [],
    expressionMode: candidate.expressionStrategy?.mode || "",
    realizationMode: candidate.realization?.mode || "",
    speechRealization: candidate.speechRealization || null,
    affordanceId: candidate.realization?.affordanceId || "",
  };
}

function diagnosticText(value = "", maxLength = 12000) {
  const text = String(value || "");
  return text.length <= maxLength ? text : text.slice(text.length - maxLength);
}

function agentInputSummary(input = {}, chosenCandidateId = "") {
  const desireId = input.agent?.id === ZHOU_MIN_BEHAVIOR_ACCEPTANCE_IDS.zhou
    ? "desire_zhoumin_become_inner_court_disciple"
    : "";
  return {
    characterId: input.agent?.id || "",
    characterName: input.agent?.name || "",
    sceneRole: input.agent?.privateState?.sceneRole || null,
    body: input.agent?.privateState?.ecologyState?.body || null,
    affect: input.agent?.privateState?.ecologyState?.affect || null,
    coreDesire: desireId
      ? input.agent?.psychologyAnchor?.desires?.find((row) => row.id === desireId) || null
      : input.agent?.psychologyAnchor?.desires || [],
    currentDesireState: desireId
      ? input.agent?.privateState?.ecologyState?.desires?.[desireId] || null
      : input.agent?.privateState?.ecologyState?.desires || {},
    relationshipContext: input.agent?.relationshipContext || [],
    retrievedMemory: input.agent?.memoryContext || null,
    activation: input.activation || null,
    perceivedImpacts: input.perceivedImpacts || [],
    perceivedCharacters: input.perceivedCharacters || [],
    materialFacts: input.materialFacts || [],
    availableAffordances: input.availableAffordances || [],
    candidates: (input.privateActionCandidates || [])
      .map((candidate) => candidateSummary(candidate, chosenCandidateId))
      .sort((left, right) => right.activationScore - left.activationScore),
  };
}

const fixture = buildZhouMinTavernBehaviorAcceptanceFixture();
const modelCalls = [];
const startedAt = Date.now();

try {
  const scene = await runTavernCausalScene(fixture.state, {
    characterIds: fixture.characterIds,
    positions: fixture.positions,
    seedImpacts: fixture.seedImpacts,
    slotContext: fixture.slotContext,
    maxSteps: 2,
    maxLocalFollowupSteps: 1,
    minimumActivationScore: 0,
    async runAgent(input, options) {
      const audit = auditCodexTrustedTavernAgentInput(input);
      const call = {
        callIndex: modelCalls.length + 1,
        characterId: input.agent?.id || "",
        characterName: input.agent?.name || "",
        repairAttempt: Boolean(input.repairFeedback),
        inputAudit: audit,
        input: structuredClone(input),
        rawDecision: null,
        stage: null,
      };
      modelCalls.push(call);
      try {
        const result = await runTavernCausalAgentWithCodex(input, options);
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

  const firstInputsByCharacter = new Map();
  for (const call of modelCalls) {
    if (!firstInputsByCharacter.has(call.characterId)) firstInputsByCharacter.set(call.characterId, call.input);
  }
  const finalDecisionByCharacter = new Map();
  for (const decision of scene.decisions) finalDecisionByCharacter.set(decision.characterId, decision);
  const zhouPatch = scene.characterPatches.find((row) => row.id === ZHOU_MIN_BEHAVIOR_ACCEPTANCE_IDS.zhou) || null;
  const desireId = "desire_zhoumin_become_inner_court_disciple";
  const executionIntegrity = evaluateCharacterExchangeIntegrity({
    requiredCharacterIds: fixture.characterIds,
    decisions: scene.decisions,
    actions: scene.actions,
    stopReason: scene.stopReason,
    unresolvedRequests: scene.unresolvedRequests,
  });
  const privateProposalDiagnostics = scene.actions.flatMap((action) => (
    (action.privateProposalDiagnostics || []).map((diagnostic) => ({
      actionId: action.id,
      actorId: action.actorId,
      candidateId: action.candidateId,
      ...diagnostic,
    }))
  ));
  const readyForAuthorReview = executionIntegrity.complete && privateProposalDiagnostics.length === 0;

  const report = {
    gate: "zhoumin-gate8-real-tavern-behavior",
    status: readyForAuthorReview ? "author_review_required" : "execution_incomplete",
    authorAcceptance: readyForAuthorReview ? "pending" : "not_applicable",
    elapsedMs: Date.now() - startedAt,
    scenario: fixture.reviewScenario,
    trustedExecution: {
      remoteRequestCount: modelCalls.length,
      calls: modelCalls.map((call) => ({
        callIndex: call.callIndex,
        characterId: call.characterId,
        characterName: call.characterName,
        repairAttempt: call.repairAttempt,
        inputAuditPassed: call.inputAudit.valid,
        inputAuditErrors: call.inputAudit.errors,
        provider: call.stage?.provider || "",
        channel: call.stage?.channel || "",
        model: call.stage?.model || "",
        isolation: call.stage?.isolation || "",
        elapsedMs: call.stage?.elapsedMs || 0,
      })),
    },
    executionIntegrity: {
      ...executionIntegrity,
      privateProposalAuditPassed: privateProposalDiagnostics.length === 0,
      privateProposalDiagnostics,
    },
    characterAgentInputs: [...firstInputsByCharacter.entries()].map(([characterId, input]) => agentInputSummary(
      input,
      finalDecisionByCharacter.get(characterId)?.candidateId || "",
    )),
    rawModelAttempts: modelCalls.map((call) => ({
      callIndex: call.callIndex,
      repairAttempt: call.repairAttempt,
      decision: call.rawDecision,
    })),
    normalizedCharacterChoices: scene.decisions,
    worldResolution: {
      stopReason: scene.stopReason,
      committedActions: scene.actions,
      impacts: scene.actions.flatMap((action) => action.impactFactors || []),
      deliveries: scene.deliveries.filter((delivery) => scene.actions.some((action) => (
        (action.impactFactors || []).some((impact) => impact.id === delivery.impactId)
      ))),
      relationshipShifts: scene.relationshipShifts,
      settledDesireState: zhouPatch?.ecologyState?.desires?.[desireId] || null,
      ownedMemoryTail: (zhouPatch?.agentMemory?.episodes || []).slice(-3),
      selfNarrative: zhouPatch?.agentMemory?.selfNarrative || null,
    },
    authorReviewQuestions: readyForAuthorReview ? [
      "谢真石的第一句话或沉默是否由他的 Agent 从现场与自身状态长出来，而不是测试夹具预写？",
      "周珉是否真正承接了谢真石本轮实际说出或做出的事，而不是回答一条预设台词？",
      "两人的句式、称呼、停顿、信息省略和直白程度是否像一起长大的朋友，而不是目的清单或通用模型腔？",
      "人物关系是否只改变表达方式，没有替任何一方消灭自己的欲望或预写关系结果？",
    ] : [],
    promotionRule: "只有作者明确接受本次真实互动，且后果层通用问题修复完成，才允许把周珉 behaviorAcceptance 从 pending 改为 passed。",
  };
  const reportPath = path.resolve(process.env.GTOWN_GATE8_REPORT_PATH || path.join(os.tmpdir(), "gtown-zhoumin-gate8-latest.json"));
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
    worldResolution: {
      stopReason: report.worldResolution.stopReason,
      committedActions: report.worldResolution.committedActions.map((action) => ({
        id: action.id,
        actorId: action.actorId,
        targetCharacterId: action.targetCharacterId,
        speechAct: action.speechAct,
        speech: action.speech,
        visibleAction: action.visibleAction,
        sourceThreadId: action.sourceThreadId,
      })),
    },
  }, null, 2));
  if (!readyForAuthorReview) process.exitCode = 2;
} catch (error) {
  console.error(JSON.stringify({
    gate: "zhoumin-gate8-real-tavern-behavior",
    status: "execution_failed",
    authorAcceptance: "pending",
    code: error?.code || "ZHOU_MIN_TAVERN_BEHAVIOR_ACCEPTANCE_FAILED",
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
