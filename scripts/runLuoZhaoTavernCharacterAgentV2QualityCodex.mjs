import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  acceptedTavernCharacterAgentV2ReplayCalls,
  auditCodexTrustedTavernCharacterAgentV2Input,
  rebaseCodexTrustedTavernCharacterAgentV2StageOutput,
  runTavernCharacterAgentV2StageWithCodex,
  TAVERN_CHARACTER_AGENT_V2_STAGE_PHASES,
  TAVERN_CHARACTER_AGENT_V2_STAGES_PER_ACTIVATION,
} from "../src/server/ecology/codexTrustedTavernCharacterAgentV2Channel.mjs";
import { runTavernCausalScene } from "../src/server/pipeline/tavernCausalScene.mjs";
import { CHARACTER_AGENT_TURN_PROTOCOL_VERSION } from "../src/server/simulation/characterAgentTurnProtocol.mjs";
import { auditCharacterAgentWorldContinuity } from "../src/server/simulation/characterQualityAudit.mjs";
import {
  LUO_ZHAO_V2_QUALITY_IDS,
  buildLuoZhaoTavernCharacterAgentV2QualityFixture,
} from "./fixtures/luoZhaoTavernCharacterAgentV2QualityFixture.mjs";

const fixture = buildLuoZhaoTavernCharacterAgentV2QualityFixture();
const requestedModel = String(process.env.GTOWN_TRUSTED_MODEL || "gpt-5.6-sol").trim();
const requestedReasoningEffort = String(process.env.GTOWN_TRUSTED_REASONING_EFFORT || "medium").trim();
const requestedDecisionLimit = Number.parseInt(
  String(process.env.GTOWN_V2_QUALITY_DECISION_LIMIT || "2"),
  10,
);
if (!Number.isInteger(requestedDecisionLimit)
  || requestedDecisionLimit < 2
  || requestedDecisionLimit > 8
  || requestedDecisionLimit % 2 !== 0) {
  throw new RangeError("GTOWN_V2_QUALITY_DECISION_LIMIT 必须是 2、4、6 或 8。每两个 Agent 激活构成一个完整交互回合。");
}
const decisionLimit = requestedDecisionLimit;
const interactionRoundLimit = decisionLimit / 2;
const hardRequestLimit = decisionLimit * TAVERN_CHARACTER_AGENT_V2_STAGES_PER_ACTIVATION;
const qualityGate = decisionLimit > 2
  ? "luozhao-character-agent-v2-continuous-quality-cell"
  : "luozhao-character-agent-v2-two-activation-quality-cell";
const stageCalls = [];
const activationEvents = [];
const startedAt = Date.now();
const qualityReportPath = path.resolve(
  process.env.GTOWN_V2_QUALITY_REPORT_PATH
    || path.join(os.tmpdir(), "gtown-luozhao-character-agent-v2-quality-latest.json"),
);
const resumeReportPath = String(process.env.GTOWN_V2_QUALITY_RESUME_REPORT || "").trim()
  || (process.env.GTOWN_V2_QUALITY_RESUME_LATEST === "1" ? qualityReportPath : "");
const resumeReport = resumeReportPath
  ? JSON.parse(await fs.readFile(path.resolve(resumeReportPath), "utf8"))
  : null;
const replayOnly = process.env.GTOWN_V2_QUALITY_REPLAY_ONLY === "1";
const resumeStageCalls = acceptedTavernCharacterAgentV2ReplayCalls(resumeReport || {});
const replayableStageCalls = resumeStageCalls
  .filter((call) => (
    call?.inputAudit?.valid
    && call?.input?.schemaVersion === CHARACTER_AGENT_TURN_PROTOCOL_VERSION
    && call?.output
    && call?.stage?.model === requestedModel
  ))
  .slice(0, hardRequestLimit);
let replayedStageCount = 0;
let remoteRequestCount = 0;
const previousRemoteRequestCount = Number(
  resumeReport?.trustedExecution?.lifetimeRemoteRequestCount
    ?? resumeReport?.lifetimeRemoteRequestCount
    ?? resumeReport?.trustedExecution?.remoteRequestCount
    ?? resumeReport?.remoteRequestCount
    ?? 0,
);

const reviewScenario = {
  ...structuredClone(fixture.reviewScenario),
  purpose: decisionLimit > 2
    ? "连续检验 Character Agent v2 是否让同一场景中的情绪、欲望、克制、观察与人物嗓音随真实后果继续发展"
    : fixture.reviewScenario.purpose,
  targetAgentActivations: decisionLimit,
  targetInteractionRounds: interactionRoundLimit,
  stagesPerActivation: TAVERN_CHARACTER_AGENT_V2_STAGES_PER_ACTIVATION,
  hardRemoteRequestLimit: hardRequestLimit,
  acceptedStageOutputsEligibleForReplay: replayableStageCalls.length,
  freshRemoteRequestBudget: hardRequestLimit - replayableStageCalls.length,
};

function diagnosticText(value = "", maxLength = 12000) {
  const source = String(value || "");
  return source.length <= maxLength ? source : source.slice(source.length - maxLength);
}

function characterName(characterId = "") {
  return fixture.state.characters.find((row) => row.id === characterId)?.name || characterId;
}

function stageOutput(result = {}, phase = "") {
  if (phase === "awaiting_subjective_appraisal") return result.appraisal || null;
  if (phase === "awaiting_agent_candidates") return result.candidates || null;
  if (phase === "awaiting_agent_choice_and_regulation") return result.choice || null;
  if (phase === "awaiting_agent_expression_planning") return result.expressionPlan || null;
  if (phase === "awaiting_agent_realization") return result.realization || null;
  return null;
}

function stageResult(output = {}, phase = "", stage = null) {
  if (phase === "awaiting_subjective_appraisal") return { appraisal: output, stage };
  if (phase === "awaiting_agent_candidates") return { candidates: output, stage };
  if (phase === "awaiting_agent_choice_and_regulation") return { choice: output, stage };
  if (phase === "awaiting_agent_expression_planning") return { expressionPlan: output, stage };
  if (phase === "awaiting_agent_realization") return { realization: output, stage };
  return { stage };
}

function summarizeDecision(trace = {}) {
  const decision = trace.decision || {};
  const psychology = trace.privatePsychology || {};
  return {
    step: trace.step,
    characterId: trace.characterId,
    characterName: characterName(trace.characterId),
    agentTurnId: trace.characterAgentTurnId || "",
    sourceImpactId: trace.sourceImpactId || "",
    selectedCandidateId: psychology.agentChoice?.selectedCandidateId || trace.candidateId || "",
    privateDecisionBasis: psychology.agentChoice?.privateDecisionBasis || decision.privateReason || "",
    appraisal: psychology.subjectiveAppraisal || null,
    psychologySnapshot: psychology.psychologySnapshot || null,
    candidateEvaluation: psychology.candidateEvaluation || null,
    regulationOutcome: psychology.regulationOutcome || null,
    publicDecision: {
      actionType: decision.actionType || "pass",
      targetCharacterId: decision.targetCharacterId || "",
      targetCharacterName: characterName(decision.targetCharacterId || ""),
      speechAct: decision.speechAct || "none",
      speech: decision.speech || "",
      visibleAction: decision.visibleAction || "",
      communicationPlan: decision.communicationPlan || null,
      speechRealizationPlan: decision.speechRealizationPlan || null,
      embodiedIntent: decision.embodiedIntent || null,
      semanticViolations: decision.semanticViolations || [],
    },
    worldOutcome: trace.characterAgentV2WorldOutcome || null,
  };
}

async function writeFailureReport(error) {
  const reportPath = qualityReportPath;
  const report = {
    gate: qualityGate,
    status: "execution_failed",
    authorAcceptance: "pending",
    elapsedMs: Date.now() - startedAt,
    model: requestedModel,
    reasoningEffort: requestedReasoningEffort,
    hardRequestLimit,
    stagesPerAgentActivation: TAVERN_CHARACTER_AGENT_V2_STAGES_PER_ACTIVATION,
    protocolVersion: CHARACTER_AGENT_TURN_PROTOCOL_VERSION,
    remoteRequestCount,
    previousRemoteRequestCount,
    lifetimeRemoteRequestCount: previousRemoteRequestCount + remoteRequestCount,
    replayedAcceptedRemoteRequestCount: replayedStageCount,
    cumulativeRemoteRequestCount: remoteRequestCount + replayedStageCount,
    scenario: reviewScenario,
    activationEvents,
    stageCalls,
    error: {
      code: error?.code || "LUO_ZHAO_CHARACTER_AGENT_V2_QUALITY_FAILED",
      message: error?.message || String(error),
      exitCode: error?.exitCode ?? null,
      stdout: diagnosticText(error?.stdout),
      stderr: diagnosticText(error?.stderr),
      issues: error?.issues || [],
    },
  };
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return { report, reportPath };
}

try {
  const scene = await runTavernCausalScene(fixture.state, {
    characterIds: fixture.characterIds,
    positions: fixture.positions,
    seedImpacts: fixture.seedImpacts,
    slotContext: fixture.slotContext,
    characterAgentProtocolVersion: 2,
    maxSteps: decisionLimit,
    maxLocalFollowupSteps: 0,
    maxSceneSeconds: 5 * 60,
    minimumActivationScore: 0,
    async runAgentV2Stage(stageInput, { signal } = {}) {
      if (stageCalls.length >= hardRequestLimit) {
        const error = new RangeError(`Character Agent v2 远程阶段调用达到硬上限 ${hardRequestLimit}，已停止。`);
        error.code = "TAVERN_CHARACTER_AGENT_V2_REMOTE_LIMIT_REACHED";
        throw error;
      }
      const audit = auditCodexTrustedTavernCharacterAgentV2Input(stageInput);
      const call = {
        callIndex: stageCalls.length + 1,
        characterId: stageInput.characterId || "",
        characterName: characterName(stageInput.characterId || ""),
        agentTurnId: stageInput.agentTurnId || "",
        phase: stageInput.phase || "",
        inputAudit: audit,
        input: structuredClone(stageInput),
        output: null,
        stage: null,
        accepted: false,
        executionMode: "pending",
      };
      stageCalls.push(call);
      if (!audit.valid) {
        const error = new TypeError(audit.errors.map((row) => `${row.code}@${row.path}: ${row.message}`).join("\n"));
        error.code = "INVALID_TAVERN_CHARACTER_AGENT_V2_QUALITY_INPUT";
        error.issues = audit.errors;
        throw error;
      }
      const replayCall = replayableStageCalls[replayedStageCount] || null;
      if (replayCall) {
        if (replayCall.characterId !== call.characterId || replayCall.phase !== call.phase) {
          const error = new Error(
            `质量测试检查点与当前阶段不一致：expected ${replayCall.characterId}/${replayCall.phase}, received ${call.characterId}/${call.phase}`,
          );
          error.code = "TAVERN_CHARACTER_AGENT_V2_RESUME_STAGE_MISMATCH";
          throw error;
        }
        const rebased = rebaseCodexTrustedTavernCharacterAgentV2StageOutput({
          previousInput: replayCall.input,
          currentInput: stageInput,
          previousOutput: replayCall.output,
        });
        call.output = structuredClone(rebased.output);
        call.stage = {
          ...structuredClone(replayCall.stage),
          elapsedMs: 0,
          isolation: "accepted-remote-output-replayed-into-equivalent-scene",
          replayed: true,
        };
        call.executionMode = "replayed-accepted-remote-output";
        call.replay = {
          sourceCallIndex: replayCall.callIndex,
          sourceAgentTurnId: replayCall.agentTurnId,
          replacementCount: rebased.replacements.length,
        };
        replayedStageCount += 1;
        return stageResult(call.output, stageInput.phase, call.stage);
      }
      if (replayOnly) {
        const error = new Error(`已重放 ${replayedStageCount} 个有效远程阶段，下一阶段 ${call.phase} 可以继续远程执行。`);
        error.code = "TAVERN_CHARACTER_AGENT_V2_REPLAY_CHECKPOINT_READY";
        throw error;
      }
      const remoteBudget = hardRequestLimit - replayableStageCalls.length;
      if (remoteRequestCount >= remoteBudget) {
        const error = new RangeError(`Character Agent v2 本次剩余远程调用达到上限 ${remoteBudget}，已停止。`);
        error.code = "TAVERN_CHARACTER_AGENT_V2_REMOTE_LIMIT_REACHED";
        throw error;
      }
      try {
        remoteRequestCount += 1;
        call.executionMode = "remote";
        const result = await runTavernCharacterAgentV2StageWithCodex(stageInput, {
          signal,
          model: requestedModel,
          reasoningEffort: requestedReasoningEffort,
        });
        call.output = structuredClone(stageOutput(result, stageInput.phase));
        call.stage = structuredClone(result.stage || null);
        return result;
      } catch (error) {
        call.error = {
          code: error?.code || "CODEX_TRUSTED_TAVERN_CHARACTER_AGENT_V2_STAGE_FAILED",
          message: error?.message || String(error),
          exitCode: error?.exitCode ?? null,
          stdout: diagnosticText(error?.stdout),
          stderr: diagnosticText(error?.stderr),
          issues: error?.issues || [],
        };
        throw error;
      }
    },
    async onEvent(event) {
      if (event.type === "causal_agent_activated") activationEvents.push(structuredClone(event));
    },
    async onAgentV2StageAccepted({ agentTurnId, phase } = {}) {
      const call = [...stageCalls].reverse().find((row) => (
        row.agentTurnId === agentTurnId && row.phase === phase
      ));
      if (!call) {
        const error = new Error(`找不到已通过协议验收的阶段记录：${agentTurnId}/${phase}`);
        error.code = "TAVERN_CHARACTER_AGENT_V2_ACCEPTED_STAGE_RECORD_MISSING";
        throw error;
      }
      call.accepted = true;
    },
  });

  const expectedPhases = TAVERN_CHARACTER_AGENT_V2_STAGE_PHASES;
  const callsByTurn = new Map();
  for (const call of stageCalls) {
    if (!callsByTurn.has(call.agentTurnId)) callsByTurn.set(call.agentTurnId, []);
    callsByTurn.get(call.agentTurnId).push(call);
  }
  const turnStageIntegrity = [...callsByTurn.values()].every((calls) => (
    JSON.stringify(calls.map((row) => row.phase)) === JSON.stringify(expectedPhases)
  ));
  const structuralComplete = scene.decisions.length === decisionLimit
    && stageCalls.length === hardRequestLimit
    && callsByTurn.size === decisionLimit
    && turnStageIntegrity
    && stageCalls.every((row) => row.inputAudit?.valid && row.stage?.model === requestedModel);
  const semanticViolations = scene.decisions.flatMap((trace) => (
    (trace.decision?.semanticViolations || []).map((violation) => ({
      characterId: trace.characterId,
      agentTurnId: trace.characterAgentTurnId,
      ...violation,
    }))
  ));
  const worldContinuityAudit = auditCharacterAgentWorldContinuity({ actions: scene.actions });
  const readyForAuthorReview = structuralComplete
    && semanticViolations.length === 0
    && worldContinuityAudit.valid;
  const decisionSummaries = scene.decisions.map(summarizeDecision);
  const visibleExchange = scene.actions.map((action) => ({
    actionId: action.id,
    actorId: action.actorId,
    actorName: characterName(action.actorId),
    targetCharacterId: action.targetCharacterId || "",
    targetCharacterName: characterName(action.targetCharacterId || ""),
    actionType: action.actionType,
    speechAct: action.speechAct,
    speech: action.speech,
    visibleAction: action.visibleAction,
    observableAffectiveTexture: structuredClone(action.observableAffectiveTexture || []),
    fromZoneId: action.fromZoneId,
    toZoneId: action.toZoneId,
    worldResolution: action.worldResolution || null,
  }));
  const report = {
    gate: qualityGate,
    status: readyForAuthorReview ? "author_review_required" : "system_audit_failed",
    authorAcceptance: readyForAuthorReview ? "pending" : "not_applicable",
    elapsedMs: Date.now() - startedAt,
    scenario: reviewScenario,
    trustedExecution: {
      model: requestedModel,
      reasoningEffort: requestedReasoningEffort,
      remoteRequestCount,
      previousRemoteRequestCount,
      lifetimeRemoteRequestCount: previousRemoteRequestCount + remoteRequestCount,
      replayedAcceptedRemoteRequestCount: replayedStageCount,
      cumulativeRemoteRequestCount: remoteRequestCount + replayedStageCount,
      hardRequestLimit,
      stagesPerAgentActivation: TAVERN_CHARACTER_AGENT_V2_STAGES_PER_ACTIVATION,
      protocolVersion: CHARACTER_AGENT_TURN_PROTOCOL_VERSION,
      retries: resumeReport ? 1 : 0,
      calls: stageCalls.map((call) => ({
        callIndex: call.callIndex,
        characterId: call.characterId,
        characterName: call.characterName,
        agentTurnId: call.agentTurnId,
        phase: call.phase,
        inputBytes: call.inputAudit.serializedBytes,
        inputAuditPassed: call.inputAudit.valid,
        provider: call.stage?.provider || "",
        channel: call.stage?.channel || "",
        model: call.stage?.model || "",
        reasoningEffort: call.stage?.reasoningEffort || "",
        isolation: call.stage?.isolation || "",
        elapsedMs: call.stage?.elapsedMs || 0,
        executionMode: call.executionMode,
        accepted: call.accepted === true,
        replay: call.replay || null,
      })),
    },
    structuralAudit: {
      structuralComplete,
      decisions: scene.decisions.length,
      distinctAgentTurns: callsByTurn.size,
      turnStageIntegrity,
      semanticViolations,
      worldContinuityAudit,
      stopReason: scene.stopReason,
    },
    activationEvents,
    visibleExchange,
    decisionSummaries,
    fullStageAttempts: stageCalls,
    worldResolution: {
      actions: scene.actions,
      impacts: scene.actions.flatMap((action) => action.impactFactors || []),
      deliveries: scene.deliveries,
      relationshipShifts: scene.relationshipShifts,
      characterPatches: scene.characterPatches,
    },
    authorReviewQuestions: readyForAuthorReview ? [
      "洛照认出谢真石并看见他送茶时，惊喜、兴奋或克制是否先成为她自己的理解与身体/言语质感，而不是后台总结？",
      "洛照是否始终把亲自进入有效攻防当作终点；观察、询问、换地点或等待若被选择，是否仍被本人理解为试探、使能或延期而非已经满足？",
      "谢真石若被她的剑与态度吸引，是否按自己的武者性格、身体状态和酒馆职责作反应，而不是把未知对手自动改造成单方表演者？",
      "只有两名直接参与者时，系统是否避免凭空制造观众羞耻，同时仍保留桌椅、热茶、场所规矩与后院许可这些独立现实成本？",
      "若出现交手或换地点提议，是否由一人提出、另一人的 Agent 自行接受／拒绝／反提条件，再由世界结算路线；没有替对方同意？",
      "两人的话是否像此刻自然说出口，而不是宣读目的、心理报告或规则？",
      "送茶、热度、位置、佩剑与同一连续时刻是否保持一致？",
    ] : [],
    promotionRule: "本测试是非正史隔离质量单元；结构通过不等于人物质量通过，只有作者可以接受或拒绝可见互动。",
  };
  const reportPath = qualityReportPath;
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    gate: report.gate,
    status: report.status,
    authorAcceptance: report.authorAcceptance,
    reportPath,
    elapsedMs: report.elapsedMs,
    trustedExecution: report.trustedExecution,
    structuralAudit: report.structuralAudit,
    visibleExchange: report.visibleExchange,
    decisionSummaries: report.decisionSummaries.map((row) => ({
      step: row.step,
      characterId: row.characterId,
      characterName: row.characterName,
      selectedCandidateId: row.selectedCandidateId,
      privateDecisionBasis: row.privateDecisionBasis,
      appraisalAxes: row.appraisal?.appraisalAxes || null,
      emotionState: row.psychologySnapshot?.emotionState || null,
      regulationChoice: row.regulationOutcome?.chosenRegulation || row.regulationOutcome || null,
      publicDecision: row.publicDecision,
    })),
  }, null, 2));
  if (!readyForAuthorReview) process.exitCode = 2;
} catch (error) {
  const { report, reportPath } = await writeFailureReport(error);
  console.error(JSON.stringify({
    gate: report.gate,
    status: report.status,
    authorAcceptance: report.authorAcceptance,
    reportPath,
    elapsedMs: report.elapsedMs,
    model: report.model,
    reasoningEffort: report.reasoningEffort,
    hardRequestLimit: report.hardRequestLimit,
    remoteRequestCount: report.remoteRequestCount,
    activationEvents: report.activationEvents,
    calls: report.stageCalls.map((call) => ({
      callIndex: call.callIndex,
      characterId: call.characterId,
      agentTurnId: call.agentTurnId,
      phase: call.phase,
      inputAuditPassed: call.inputAudit?.valid || false,
      stage: call.stage,
      error: call.error || null,
    })),
    error: report.error,
  }, null, 2));
  process.exitCode = 1;
}
