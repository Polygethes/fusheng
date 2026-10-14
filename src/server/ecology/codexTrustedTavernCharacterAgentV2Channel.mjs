import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  CODEX_TRUSTED_BLIND_PROBE_CHANNEL,
  CODEX_TRUSTED_BLIND_PROBE_MODEL,
  CODEX_TRUSTED_BLIND_PROBE_REASONING_EFFORT,
  assertCodexTrustedChannelPurpose,
  assertCodexTrustedReasoningEffort,
  buildCodexTrustedPersistentStructuredInvocation,
  buildCodexTrustedStructuredInvocation,
  executeCodexTrustedBlindProbeInvocation,
  sanitizeCodexTrustedBlindProbeEnvironment,
} from "./codexTrustedBlindProbeChannel.mjs";
import {
  tavernCharacterAgentV2OutputSchemaForStage,
  tavernCharacterAgentV2SystemPrompt,
  tavernCharacterAgentV2UserPrompt,
} from "../pipeline/tavernCharacterAgentV2.mjs";
import {
  CHARACTER_AGENT_REFERENCE_CONTRACT_VERSION,
  characterAgentOwnedPsychologicalSourceIds,
} from "../simulation/characterAgentTurnProtocol.mjs";
import { projectSelectedActionForExpression } from "../simulation/characterSharedContext.mjs";
import { buildCodexStrictOutputSchema as strictOutputSchema, restoreCodexOptionalFields } from "./codexStructuredOutputSchema.mjs";

export const CODEX_TRUSTED_TAVERN_CHARACTER_AGENT_V2_PURPOSE = "tavern-character-agent-behavior-acceptance";

export const TAVERN_CHARACTER_AGENT_V2_STAGE_PHASES = Object.freeze([
  "awaiting_subjective_appraisal",
  "awaiting_agent_candidates",
  "awaiting_agent_choice_and_regulation",
  "awaiting_agent_expression_planning",
  "awaiting_agent_realization",
]);
export const TAVERN_CHARACTER_AGENT_V2_STAGES_PER_ACTIVATION = TAVERN_CHARACTER_AGENT_V2_STAGE_PHASES.length;
export const TAVERN_CHARACTER_AGENT_V2_ATOMIC_STAGE_PHASES = Object.freeze([
  "awaiting_subjective_appraisal",
  "awaiting_agent_candidates",
  "awaiting_agent_choice_and_regulation",
  "awaiting_agent_turn_commit",
]);
export const TAVERN_CHARACTER_AGENT_V2_ATOMIC_STAGES_PER_ACTIVATION =
  TAVERN_CHARACTER_AGENT_V2_ATOMIC_STAGE_PHASES.length;
export const TAVERN_CHARACTER_AGENT_V2_TWO_CALL_STAGE_PHASES = Object.freeze([
  "awaiting_subjective_appraisal_and_candidates",
  "awaiting_agent_choice_and_turn_commit",
]);
export const TAVERN_CHARACTER_AGENT_V2_TWO_CALL_STAGES_PER_ACTIVATION =
  TAVERN_CHARACTER_AGENT_V2_TWO_CALL_STAGE_PHASES.length;

/**
 * Return only stage outputs that reached protocol acceptance.
 *
 * New reports carry an explicit accepted flag.  Legacy failure reports do not;
 * because the staged protocol is strictly sequential, every completed call
 * before the final failing call necessarily passed before the next phase could
 * start.  The final call stays excluded rather than being silently replayed.
 */
export function acceptedTavernCharacterAgentV2ReplayCalls(report = {}) {
  const calls = Array.isArray(report.fullStageAttempts)
    ? report.fullStageAttempts
    : Array.isArray(report.stageCalls) ? report.stageCalls : [];
  const completedReport = ["author_review_required", "system_audit_failed"].includes(report.status);
  return calls.filter((call, index) => {
    if (call?.accepted === true) return true;
    if (call?.accepted === false) return false;
    if (completedReport) return true;
    return report.status === "execution_failed" && index < calls.length - 1;
  });
}

const STAGE_DEFINITIONS = Object.freeze({
  awaiting_character_day_planning: Object.freeze({
    stage: "character_day_planning",
    outputKey: "dayPlan",
  }),
  awaiting_character_reflection: Object.freeze({
    stage: "character_reflection",
    outputKey: "reflection",
  }),
  awaiting_subjective_appraisal: Object.freeze({
    stage: "subjective_appraisal",
    outputKey: "appraisal",
  }),
  awaiting_subjective_appraisal_and_candidates: Object.freeze({
    stage: "subjective_appraisal_and_candidates",
    outputKey: "appraisalAndCandidates",
  }),
  awaiting_agent_candidates: Object.freeze({
    stage: "agent_candidates",
    outputKey: "candidates",
  }),
  awaiting_agent_turn_commit: Object.freeze({
    stage: "agent_turn_commit",
    outputKey: "turnCommit",
  }),
  awaiting_agent_choice_and_regulation: Object.freeze({
    stage: "agent_choice_and_regulation",
    outputKey: "choice",
  }),
  awaiting_agent_choice_and_turn_commit: Object.freeze({
    stage: "agent_choice_and_turn_commit",
    outputKey: "choiceAndTurnCommit",
  }),
  awaiting_agent_expression_planning: Object.freeze({
    stage: "agent_expression_planning",
    outputKey: "expressionPlan",
  }),
  awaiting_agent_realization: Object.freeze({
    stage: "agent_realization",
    outputKey: "realization",
  }),
});

const FORBIDDEN_KEYS = new Set([
  "acceptedLines",
  "actionPolicy",
  "anchorPayload",
  "authorCorrection",
  "calibrationEvidence",
  "candidateFamilies",
  "expectedAction",
  "expressionStrategy",
  "holdout",
  "holdouts",
  "interviewLog",
  "privateActionCandidates",
]);

const FORBIDDEN_TEXT = Object.freeze([
  "/Users/",
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
  "CHARACTER_TOWN_API_KEY",
  "calibration-evidence.json",
  "holdouts.md",
]);

const MAINTENANCE_STAGE_PHASES = new Set([
  "awaiting_character_day_planning",
  "awaiting_character_reflection",
]);

function issue(code, pathName, message) {
  return { code, path: pathName, message };
}

function identifierLike(value = "") {
  const text = String(value || "");
  return text.length > 2 && text.length < 500 && (
    text.includes(":")
    || text.includes("/")
    || /^[a-z0-9]+(?:[_-][a-z0-9]+)+$/iu.test(text)
  );
}

function addAlignedIdentifierMapping(mappings, previousValue, currentValue) {
  const previous = String(previousValue || "");
  const current = String(currentValue || "");
  if (!previous || !current || previous === current || !identifierLike(previous) || !identifierLike(current)) return;
  mappings.set(previous, current);

  let prefixLength = 0;
  while (prefixLength < previous.length && prefixLength < current.length
    && previous[prefixLength] === current[prefixLength]) prefixLength += 1;
  let suffixLength = 0;
  while (suffixLength < previous.length - prefixLength && suffixLength < current.length - prefixLength
    && previous[previous.length - 1 - suffixLength] === current[current.length - 1 - suffixLength]) suffixLength += 1;
  const previousCore = previous.slice(prefixLength, previous.length - suffixLength);
  const currentCore = current.slice(prefixLength, current.length - suffixLength);
  if (previousCore.length >= 4 && currentCore.length >= 4) mappings.set(previousCore, currentCore);
}

function collectAlignedIdentifierMappings(previous, current, mappings, seen = new Set()) {
  if (typeof previous === "string" && typeof current === "string") {
    addAlignedIdentifierMapping(mappings, previous, current);
    return;
  }
  if (!previous || !current || typeof previous !== "object" || typeof current !== "object") return;
  if (seen.has(previous)) return;
  seen.add(previous);
  if (Array.isArray(previous) && Array.isArray(current)) {
    const length = Math.min(previous.length, current.length);
    for (let index = 0; index < length; index += 1) {
      collectAlignedIdentifierMappings(previous[index], current[index], mappings, seen);
    }
    return;
  }
  if (Array.isArray(previous) || Array.isArray(current)) return;
  for (const key of Object.keys(previous)) {
    if (Object.prototype.hasOwnProperty.call(current, key)) {
      collectAlignedIdentifierMappings(previous[key], current[key], mappings, seen);
    }
  }
}

function replaceMappedIdentifiers(value, replacements) {
  if (typeof value === "string") {
    return replacements.reduce((result, [previous, current]) => result.split(previous).join(current), value);
  }
  if (Array.isArray(value)) return value.map((row) => replaceMappedIdentifiers(row, replacements));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .map(([key, row]) => [key, replaceMappedIdentifiers(row, replacements)]));
}

/** Rebase an already accepted remote stage output onto an equivalent rebuilt scene input. */
export function rebaseCodexTrustedTavernCharacterAgentV2StageOutput({
  previousInput = {},
  currentInput = {},
  previousOutput = {},
} = {}) {
  const mappings = new Map();
  collectAlignedIdentifierMappings(previousInput, currentInput, mappings);
  const replacements = [...mappings.entries()].sort((left, right) => right[0].length - left[0].length);
  return {
    output: replaceMappedIdentifiers(structuredClone(previousOutput), replacements),
    replacements: replacements.map(([previous, current]) => ({ previous, current })),
  };
}

function visit(value, pathName, errors, seen = new Set()) {
  if (value == null) return;
  if (typeof value === "string") {
    for (const forbidden of FORBIDDEN_TEXT) {
      if (value.includes(forbidden)) {
        errors.push(issue(
          "FORBIDDEN_V2_STAGE_TEXT",
          pathName,
          `Character Agent v2 隔离输入含本地路径、密钥名或作者证据引用：${forbidden}`,
        ));
      }
    }
    return;
  }
  if (typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((child, index) => visit(child, `${pathName}[${index}]`, errors, seen));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${pathName}.${key}`;
    if (FORBIDDEN_KEYS.has(key)) {
      errors.push(issue(
        "FORBIDDEN_V2_STAGE_FIELD",
        childPath,
        `Character Agent v2 不得读取旧候选、作者答案或校准证据字段 ${key}`,
      ));
    }
    visit(child, childPath, errors, seen);
  }
}

function visitMaintenanceOwnerClaims(value, ownerCharacterId, pathName, errors, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((child, index) => (
      visitMaintenanceOwnerClaims(child, ownerCharacterId, `${pathName}[${index}]`, errors, seen)
    ));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${pathName}.${key}`;
    if (key === "ownerCharacterId" && String(child || "").trim() !== ownerCharacterId) {
      errors.push(issue(
        "V2_MAINTENANCE_OWNER_MISMATCH",
        childPath,
        "私有维护阶段只能包含当前人物本人拥有的投影",
      ));
    }
    visitMaintenanceOwnerClaims(child, ownerCharacterId, childPath, errors, seen);
  }
}

export function tavernCharacterAgentV2StageDefinition(phase = "", stageInput = {}) {
  const normalizedPhase = String(phase || "").trim();
  const definition = STAGE_DEFINITIONS[normalizedPhase] || null;
  if (!definition) return null;
  return {
    ...definition,
    schema: tavernCharacterAgentV2OutputSchemaForStage({ ...stageInput, phase: normalizedPhase }),
  };
}

export function auditCodexTrustedTavernCharacterAgentV2Input(stageInput = {}) {
  const errors = [];
  const definition = tavernCharacterAgentV2StageDefinition(stageInput.phase, stageInput);
  const maintenancePhase = MAINTENANCE_STAGE_PHASES.has(stageInput.phase);
  const rawContextPhases = new Set([
    "awaiting_subjective_appraisal",
    "awaiting_agent_candidates",
    "awaiting_subjective_appraisal_and_candidates",
  ]);
  const rawContextRequired = rawContextPhases.has(stageInput.phase);
  if (!definition) {
    errors.push(issue("V2_STAGE_PHASE_INVALID", "stageInput.phase", `不支持的 Character Agent v2 阶段：${stageInput.phase || "(empty)"}`));
  }
  if (!String(stageInput.characterId || "").trim()) {
    errors.push(issue("V2_STAGE_CHARACTER_REQUIRED", "stageInput.characterId", "缺少当前人物 id"));
  }
  if (!String(stageInput.agentTurnId || "").trim()) {
    errors.push(issue("V2_STAGE_TURN_REQUIRED", "stageInput.agentTurnId", "缺少同一人物逻辑回合 id"));
  }
  if (maintenancePhase) {
    const characterId = String(stageInput.characterId || "").trim();
    const expectedAuthority = stageInput.phase === "awaiting_character_day_planning"
      ? "character-private-day-planning-stage-input"
      : "character-private-reflection-stage-input";
    if (stageInput.authority !== expectedAuthority) {
      errors.push(issue(
        "V2_MAINTENANCE_PRIVATE_AUTHORITY_REQUIRED",
        "stageInput.authority",
        `私有维护阶段必须使用 ${expectedAuthority} authority`,
      ));
    }
    if (String(stageInput.ownerCharacterId || "").trim() !== characterId) {
      errors.push(issue(
        "V2_MAINTENANCE_OWNER_MISMATCH",
        "stageInput.ownerCharacterId",
        "私有维护阶段必须属于当前人物",
      ));
    }
    if (!stageInput.privateContext || typeof stageInput.privateContext !== "object"
      || Array.isArray(stageInput.privateContext)) {
      errors.push(issue(
        "V2_MAINTENANCE_PRIVATE_CONTEXT_REQUIRED",
        "stageInput.privateContext",
        "私有维护阶段缺少当前人物的受界定私有投影",
      ));
    }
    if (stageInput.phase === "awaiting_character_day_planning") {
      if (String(stageInput.referenceContract?.ownerCharacterId || "").trim() !== characterId) {
        errors.push(issue(
          "V2_DAY_PLANNING_REFERENCE_OWNER_REQUIRED",
          "stageInput.referenceContract.ownerCharacterId",
          "日计划引用合同必须属于当前人物",
        ));
      }
    } else if (stageInput.privateContext?.authority !== "character-private-reflection-context-projection") {
      errors.push(issue(
        "V2_REFLECTION_PRIVATE_CONTEXT_AUTHORITY_REQUIRED",
        "stageInput.privateContext.authority",
        "反思阶段只能读取受界定的本人私有反思投影",
      ));
    }
    if (stageInput.submissionContract?.ownerAuthority !== "character-agent") {
      errors.push(issue(
        "V2_MAINTENANCE_SUBMISSION_AUTHORITY_REQUIRED",
        "stageInput.submissionContract.ownerAuthority",
        "私有维护输出必须保留 Character Agent 决策权",
      ));
    }
    visitMaintenanceOwnerClaims(stageInput, characterId, "stageInput", errors);
  }
  if (rawContextRequired && stageInput.worldProjection?.authority !== "recipient-specific-world-projection") {
    errors.push(issue(
      "V2_RECIPIENT_WORLD_PROJECTION_REQUIRED",
      "stageInput.worldProjection.authority",
      "v2 人物只能读取面向本人的世界投影",
    ));
  }
  if (rawContextRequired && (!stageInput.privateContext || typeof stageInput.privateContext !== "object")) {
    errors.push(issue("V2_PRIVATE_CONTEXT_REQUIRED", "stageInput.privateContext", "缺少人物本人私有心理上下文"));
  }
  if (stageInput.phase === "awaiting_agent_expression_planning") {
    if (stageInput.preverbalGroundingSurface?.authority !== "character-private-preverbal-grounding-surface") {
      errors.push(issue(
        "V2_EXPRESSION_GROUNDING_SURFACE_REQUIRED",
        "stageInput.preverbalGroundingSurface.authority",
        "表达规划阶段必须读取同一人物的言前事实、关系、身体、声音与记忆表面",
      ));
    }
    if (stageInput.regulationSurface?.authority !== "character-private-regulation-surface") {
      errors.push(issue(
        "V2_EXPRESSION_REGULATION_SURFACE_REQUIRED",
        "stageInput.regulationSurface.authority",
        "表达规划阶段必须发生在心理调节结果之后",
      ));
    }
    if (stageInput.automaticCommunicationImpulse?.ownerAuthority !== "character-agent") {
      errors.push(issue(
        "V2_EXPRESSION_AUTOMATIC_IMPULSE_REQUIRED",
        "stageInput.automaticCommunicationImpulse.ownerAuthority",
        "表达规划阶段只能处理同一人物自己形成的自动语言冲动",
      ));
    }
    for (const forbiddenKey of ["worldProjection", "privateContext", "subjectiveAppraisal", "psychologySnapshot", "generatedCandidates", "candidateEvaluation", "agentChoice"]) {
      if (Object.prototype.hasOwnProperty.call(stageInput, forbiddenKey)) {
        errors.push(issue(
          "V2_EXPRESSION_RAW_LEDGER_FORBIDDEN",
          `stageInput.${forbiddenKey}`,
          `表达规划阶段不得重新读取 ${forbiddenKey}；它只能使用受界定的言前表面、调节结果与自动冲动`,
        ));
      }
    }
  }
  if (stageInput.phase === "awaiting_agent_turn_commit") {
    if (stageInput.worldSurface?.authority !== "recipient-specific-realization-surface") {
      errors.push(issue(
        "V2_ATOMIC_COMMIT_WORLD_SURFACE_REQUIRED",
        "stageInput.worldSurface.authority",
        "原子提交阶段必须读取面向本人的眼前表面",
      ));
    }
    if (stageInput.regulationSurface?.authority !== "character-private-regulation-surface") {
      errors.push(issue(
        "V2_ATOMIC_COMMIT_REGULATION_REQUIRED",
        "stageInput.regulationSurface.authority",
        "原子提交必须发生在同一人物取得心理调节结果之后",
      ));
    }
    if (!stageInput.agentChoice || typeof stageInput.agentChoice !== "object") {
      errors.push(issue("V2_ATOMIC_COMMIT_CHOICE_REQUIRED", "stageInput.agentChoice", "原子提交缺少同一人物已完成的选择"));
    }
    if (!stageInput.selectedAction || typeof stageInput.selectedAction !== "object") {
      errors.push(issue("V2_ATOMIC_COMMIT_ACTION_REQUIRED", "stageInput.selectedAction", "原子提交缺少已经锁定的动作"));
    }
    if (!stageInput.voiceContract || typeof stageInput.voiceContract !== "object") {
      errors.push(issue("V2_ATOMIC_COMMIT_VOICE_REQUIRED", "stageInput.voiceContract", "原子提交缺少人物自己的声音底座"));
    }
    for (const forbiddenKey of ["regulatedExpressionPlan", "publicStance", "releasedMeaning", "intendedEffect"]) {
      if (Object.prototype.hasOwnProperty.call(stageInput, forbiddenKey)) {
        errors.push(issue(
          "V2_ATOMIC_COMMIT_MIDDLEWARE_FORBIDDEN",
          `stageInput.${forbiddenKey}`,
          `原子提交不得重建独立的表达翻译中间件 ${forbiddenKey}`,
        ));
      }
    }
  }
  if (stageInput.phase === "awaiting_subjective_appraisal_and_candidates"
    && stageInput.requestedOutput !== "subjective_appraisal_and_character_candidates") {
    errors.push(issue(
      "V2_TWO_CALL_APPRAISAL_CANDIDATES_OUTPUT_INVALID",
      "stageInput.requestedOutput",
      "两调用第一阶段必须请求同一人物的 appraisal 与 candidates",
    ));
  }
  if (stageInput.phase === "awaiting_agent_choice_and_turn_commit") {
    if (stageInput.requestedOutput !== "character_choice_regulation_and_turn_commit") {
      errors.push(issue(
        "V2_TWO_CALL_CHOICE_COMMIT_OUTPUT_INVALID",
        "stageInput.requestedOutput",
        "两调用第二阶段必须请求同一人物的 choice 与 turnCommit",
      ));
    }
    if (stageInput.candidateEvaluation?.authority !== "character-private-psychology-tool"
      || stageInput.candidateEvaluation?.selection !== null) {
      errors.push(issue(
        "V2_TWO_CALL_CANDIDATE_MATH_REQUIRED",
        "stageInput.candidateEvaluation",
        "两调用第二阶段必须读取本地候选数学，且数学不得预选",
      ));
    }
    if (!Array.isArray(stageInput.candidateCommitContexts)
      || stageInput.candidateCommitContexts.length !== (stageInput.generatedCandidates || []).length) {
      errors.push(issue(
        "V2_TWO_CALL_CANDIDATE_COMMIT_CONTEXTS_REQUIRED",
        "stageInput.candidateCommitContexts",
        "每个本人候选都必须有一个受界定的公开提交现场",
      ));
    }
    const generatedCandidates = Array.isArray(stageInput.generatedCandidates)
      ? stageInput.generatedCandidates
      : [];
    const contexts = Array.isArray(stageInput.candidateCommitContexts)
      ? stageInput.candidateCommitContexts
      : [];
    const candidateById = new Map(generatedCandidates.map((candidate) => [
      String(candidate?.candidateId || "").trim(),
      candidate,
    ]));
    const contextIds = contexts.map((context) => String(context?.candidateId || "").trim());
    if (contextIds.some((candidateId) => !candidateId)
      || new Set(contextIds).size !== contextIds.length
      || contextIds.some((candidateId) => !candidateById.has(candidateId))
      || contextIds.length !== candidateById.size) {
      errors.push(issue(
        "V2_TWO_CALL_CANDIDATE_CONTEXT_IDENTITY_INVALID",
        "stageInput.candidateCommitContexts",
        "候选提交现场必须与本人候选 id 一一对应，且不得重复、遗漏或伪造",
      ));
    }
    for (const context of contexts) {
      const candidateId = String(context?.candidateId || "").trim();
      const candidate = candidateById.get(candidateId);
      if (!candidate) continue;
      const expectedAction = projectSelectedActionForExpression({
        candidateId,
        attemptPrimitive: String(candidate?.attemptPrimitive || "").trim(),
        targetHandle: String(candidate?.targetHandle || "").trim(),
        actionBinding: structuredClone(candidate?.actionBinding || null),
        domains: [...new Set((candidate?.domains || []).map((value) => String(value || "").trim()).filter(Boolean))],
        sharedActivity: structuredClone(candidate?.sharedActivity || null),
        timingIntent: String(candidate?.timingIntent || "").trim(),
      });
      if (!isDeepStrictEqual(context?.selectedAction, expectedAction)) {
        errors.push(issue(
          "V2_TWO_CALL_CANDIDATE_CONTEXT_ACTION_MISMATCH",
          "stageInput.candidateCommitContexts.selectedAction",
          `候选 ${candidateId} 的提交现场必须锁定该候选自己的动作身份`,
        ));
      }
      const expectedLockedAction = {
        primitive: String(expectedAction.attemptPrimitive || "").trim(),
        targetCharacterId: String(expectedAction.targetHandle || "").trim(),
        actionBinding: structuredClone(expectedAction.actionBinding || null),
        sharedActivity: structuredClone(expectedAction.sharedActivity || null),
        timingIntent: String(expectedAction.timingIntent || "").trim(),
      };
      if (!isDeepStrictEqual(context?.expressionMoment?.lockedAction, expectedLockedAction)) {
        errors.push(issue(
          "V2_TWO_CALL_CANDIDATE_CONTEXT_LOCK_MISMATCH",
          "stageInput.candidateCommitContexts.expressionMoment.lockedAction",
          `候选 ${candidateId} 的表达现场不得改写已锁定动作`,
        ));
      }
    }
    if (stageInput.worldSurface?.authority !== "recipient-specific-realization-surface") {
      errors.push(issue(
        "V2_TWO_CALL_WORLD_SURFACE_REQUIRED",
        "stageInput.worldSurface.authority",
        "两调用公开提交只能读取面向本人的世界表面",
      ));
    }
    if (!stageInput.voiceContract || typeof stageInput.voiceContract !== "object") {
      errors.push(issue(
        "V2_TWO_CALL_VOICE_REQUIRED",
        "stageInput.voiceContract",
        "两调用公开提交缺少人物自己的声音底座",
      ));
    }
    for (const context of stageInput.candidateCommitContexts || []) {
      if (context?.expressionMoment?.authority !== "character-owned-expression-moment") {
        errors.push(issue(
          "V2_TWO_CALL_EXPRESSION_MOMENT_REQUIRED",
          "stageInput.candidateCommitContexts",
          "候选提交现场必须属于同一个 Character Agent",
        ));
        break;
      }
    }
  }
  if (stageInput.phase === "awaiting_agent_realization") {
    if (stageInput.worldSurface?.authority !== "recipient-specific-realization-surface") {
      errors.push(issue(
        "V2_REALIZATION_SURFACE_REQUIRED",
        "stageInput.worldSurface.authority",
        "最终措辞阶段只能读取面向本人的眼前表面，不得重新读取完整世界与心理账",
      ));
    }
    if (!stageInput.voiceContract || typeof stageInput.voiceContract !== "object") {
      errors.push(issue("V2_REALIZATION_VOICE_REQUIRED", "stageInput.voiceContract", "最终措辞阶段缺少人物自己的声音底座"));
    }
    if (!stageInput.regulatedExpressionPlan || typeof stageInput.regulatedExpressionPlan !== "object") {
      errors.push(issue("V2_REALIZATION_EXPRESSION_PLAN_REQUIRED", "stageInput.regulatedExpressionPlan", "最终措辞阶段缺少调节后的表达计划"));
    }
    for (const forbiddenKey of [
      "worldProjection", "privateContext", "subjectiveAppraisal", "psychologySnapshot", "agentChoice", "regulationOutcome",
      "automaticCommunicationImpulse", "preverbalGroundingSurface", "affectiveContext",
    ]) {
      if (Object.prototype.hasOwnProperty.call(stageInput, forbiddenKey)) {
        errors.push(issue(
          "V2_REALIZATION_PRIVATE_LEDGER_FORBIDDEN",
          `stageInput.${forbiddenKey}`,
          `最终措辞阶段不得重新读取 ${forbiddenKey}；它只能实现人物已经调节完成的表达计划`,
        ));
      }
    }
  }
  if (!maintenancePhase && (stageInput.referenceContract?.schemaVersion !== CHARACTER_AGENT_REFERENCE_CONTRACT_VERSION
    || stageInput.referenceContract?.authority !== "character-agent-reference-contract")) {
    errors.push(issue(
      "V2_REFERENCE_CONTRACT_REQUIRED",
      "stageInput.referenceContract",
      "缺少当前人物可验证的引用命名空间合同",
    ));
  } else if (!maintenancePhase && stageInput.privateContext && typeof stageInput.privateContext === "object") {
    const expectedSourceIds = characterAgentOwnedPsychologicalSourceIds(stageInput.privateContext).sort();
    const declaredSourceIds = [...new Set((stageInput.referenceContract.ownedPsychologicalSourceIds || [])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean))].sort();
    if (JSON.stringify(expectedSourceIds) !== JSON.stringify(declaredSourceIds)) {
      errors.push(issue(
        "V2_REFERENCE_CONTRACT_SOURCE_MISMATCH",
        "stageInput.referenceContract.ownedPsychologicalSourceIds",
        "引用合同必须精确列出人物本人拥有的欲望、价值、自我认识、关系与记忆来源",
      ));
    }
  } else if (!maintenancePhase) {
    const declaredSourceIds = new Set((stageInput.referenceContract.ownedPsychologicalSourceIds || [])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean));
    const referencedSourceIds = [
      ...(stageInput.subjectiveAppraisal?.relevanceLinks || []).map((row) => row?.sourceId),
      ...(stageInput.generatedCandidates || []).flatMap((candidate) => (
        (candidate?.expectedEffects || []).map((effect) => effect?.sourceId)
      )),
    ].map((value) => String(value ?? "").trim()).filter(Boolean);
    for (const sourceId of referencedSourceIds) {
      if (!declaredSourceIds.has(sourceId)) {
        errors.push(issue(
          "V2_REFERENCE_CONTRACT_UNDECLARED_SOURCE",
          "stageInput.referenceContract.ownedPsychologicalSourceIds",
          `阶段输入引用了合同之外的私人心理来源 ${sourceId}`,
        ));
      }
    }
  }
  visit(stageInput, "stageInput", errors);
  const serializedBytes = Buffer.byteLength(JSON.stringify(stageInput));
  if (serializedBytes > 750_000) {
    errors.push(issue(
      "V2_STAGE_INPUT_TOO_LARGE",
      "stageInput",
      `隔离输入 ${serializedBytes} bytes，超过 750000 bytes 上限`,
    ));
  }
  return {
    valid: errors.length === 0,
    errors,
    phase: stageInput.phase || "",
    stage: definition?.stage || "",
    characterId: stageInput.characterId || "",
    agentTurnId: stageInput.agentTurnId || "",
    serializedBytes,
    legacyAuthorityAbsent: !JSON.stringify(stageInput).includes("privateActionCandidates")
      && !JSON.stringify(stageInput).includes("expressionStrategy"),
  };
}

function invalidInputError(audit) {
  const error = new TypeError(audit.errors.map((entry) => `${entry.code}@${entry.path}: ${entry.message}`).join("\n"));
  error.code = "INVALID_TAVERN_CHARACTER_AGENT_V2_STAGE_INPUT";
  error.issues = audit.errors;
  return error;
}

export function buildCodexTrustedTavernCharacterAgentV2Prompt(stageInput = {}) {
  const audit = auditCodexTrustedTavernCharacterAgentV2Input(stageInput);
  if (!audit.valid) throw invalidInputError(audit);
  return `<character_agent_v2_contract>\n${tavernCharacterAgentV2SystemPrompt(stageInput)}\n</character_agent_v2_contract>\n\n<isolated_character_stage_input>\n${tavernCharacterAgentV2UserPrompt(stageInput)}\n</isolated_character_stage_input>\n\n不要调用任何工具、命令、文件、网络、记忆或其他 Agent。不要读取当前输入以外的项目资料。只作为同一个人物完成当前阶段；最终只输出符合指定 schema 的 JSON。`;
}

export function buildCodexTrustedTavernCharacterAgentV2Invocation({
  stageInput,
  tempDirectory,
  schemaPath,
  outputPath,
  model = CODEX_TRUSTED_BLIND_PROBE_MODEL,
  reasoningEffort = CODEX_TRUSTED_BLIND_PROBE_REASONING_EFFORT,
  environment = sanitizeCodexTrustedBlindProbeEnvironment(),
} = {}) {
  return buildCodexTrustedStructuredInvocation({
    purpose: CODEX_TRUSTED_TAVERN_CHARACTER_AGENT_V2_PURPOSE,
    prompt: buildCodexTrustedTavernCharacterAgentV2Prompt(stageInput),
    tempDirectory,
    schemaPath,
    outputPath,
    model,
    reasoningEffort,
    environment,
  });
}

export function parseCodexTrustedConversationId(stdout = "") {
  for (const line of String(stdout || "").split(/\r?\n/u)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event?.type === "thread.started" && String(event.thread_id || "").trim()) {
        return String(event.thread_id).trim();
      }
    } catch {
      // Codex may include non-JSON diagnostics around JSONL events.  They do
      // not establish a provider conversation and are intentionally ignored.
    }
  }
  return "";
}

function characterModelSessionMismatchError(expected, received) {
  const error = new TypeError(`人物模型会话属于 ${expected}，不能由 ${received || "(empty)"} 使用`);
  error.code = "CHARACTER_MODEL_SESSION_CHARACTER_MISMATCH";
  error.expectedCharacterId = expected;
  error.receivedCharacterId = received || "";
  return error;
}

/**
 * A provider conversation belongs to exactly one Character.  Stages may be
 * structured for protocol auditing, but they are continuations of the same
 * model subject rather than fresh anonymous completions.
 */
export function createCodexTrustedTavernCharacterModelSession({
  characterId,
  checkpoint = null,
  model = CODEX_TRUSTED_BLIND_PROBE_MODEL,
  reasoningEffort = CODEX_TRUSTED_BLIND_PROBE_REASONING_EFFORT,
  tempRoot = os.tmpdir(),
  execute = executeCodexTrustedBlindProbeInvocation,
} = {}) {
  const ownerCharacterId = String(characterId || checkpoint?.characterId || "").trim();
  if (!ownerCharacterId) throw new TypeError("人物模型会话缺少 characterId");
  if (checkpoint?.characterId && checkpoint.characterId !== ownerCharacterId) {
    throw characterModelSessionMismatchError(ownerCharacterId, checkpoint.characterId);
  }
  assertCodexTrustedChannelPurpose(CODEX_TRUSTED_TAVERN_CHARACTER_AGENT_V2_PURPOSE, model);
  assertCodexTrustedReasoningEffort(model, reasoningEffort);

  let providerConversationId = String(checkpoint?.providerConversationId || "").trim();
  let acceptedStageCount = Number.isInteger(checkpoint?.acceptedStageCount)
    ? Math.max(0, checkpoint.acceptedStageCount)
    : 0;
  let tempDirectoryPromise = null;
  let closed = false;
  let running = false;

  const ensureTempDirectory = () => {
    if (!tempDirectoryPromise) {
      tempDirectoryPromise = fs.promises.mkdtemp(path.join(tempRoot, `gtown-character-model-${ownerCharacterId.replace(/[^a-z0-9_-]+/giu, "-")}-`));
    }
    return tempDirectoryPromise;
  };

  const session = {
    characterId: ownerCharacterId,
    async runStage(stageInput = {}, { signal } = {}) {
      if (closed) {
        const error = new Error("人物模型会话已经关闭");
        error.code = "CHARACTER_MODEL_SESSION_CLOSED";
        throw error;
      }
      const receivedCharacterId = String(stageInput.characterId || "").trim();
      if (receivedCharacterId !== ownerCharacterId) {
        throw characterModelSessionMismatchError(ownerCharacterId, receivedCharacterId);
      }
      if (running) {
        const error = new Error("同一人物模型会话不能并发运行两个阶段");
        error.code = "CHARACTER_MODEL_SESSION_BUSY";
        throw error;
      }

      const audit = auditCodexTrustedTavernCharacterAgentV2Input(stageInput);
      if (!audit.valid) throw invalidInputError(audit);
      const definition = tavernCharacterAgentV2StageDefinition(stageInput.phase, stageInput);
      running = true;
      const startedAt = Date.now();
      try {
        const tempDirectory = await ensureTempDirectory();
        const ordinal = acceptedStageCount + 1;
        const schemaPath = path.join(tempDirectory, `stage-${ordinal}.schema.json`);
        const outputPath = path.join(tempDirectory, `stage-${ordinal}.json`);
        await fs.promises.writeFile(schemaPath, `${JSON.stringify(strictOutputSchema(definition.schema), null, 2)}\n`, {
          encoding: "utf8",
          mode: 0o600,
        });
        const invocation = buildCodexTrustedPersistentStructuredInvocation({
          purpose: CODEX_TRUSTED_TAVERN_CHARACTER_AGENT_V2_PURPOSE,
          prompt: buildCodexTrustedTavernCharacterAgentV2Prompt(stageInput),
          providerConversationId,
          tempDirectory,
          schemaPath,
          outputPath,
          model,
          reasoningEffort,
          environment: sanitizeCodexTrustedBlindProbeEnvironment(),
        });
        const execution = await execute(invocation, { signal });
        if (!providerConversationId) {
          providerConversationId = parseCodexTrustedConversationId(execution?.stdout || "");
          if (!providerConversationId) {
            const error = new TypeError("持续 Codex 人物会话没有返回 thread.started conversation id");
            error.code = "CODEX_TRUSTED_CHARACTER_SESSION_ID_MISSING";
            throw error;
          }
        }
        let parsed;
        try {
          parsed = restoreCodexOptionalFields(JSON.parse(await fs.promises.readFile(outputPath, "utf8")), definition.schema);
        } catch (cause) {
          const error = new TypeError(`持续 Codex 人物阶段没有生成可解析 JSON：${cause.message}`, { cause });
          error.code = "CODEX_TRUSTED_TAVERN_CHARACTER_AGENT_V2_INVALID_JSON";
          error.stderr = execution?.stderr || "";
          throw error;
        }
        acceptedStageCount += 1;
        return {
          [definition.outputKey]: parsed,
          audit,
          stage: {
            name: `CodexTrustedTavernCharacterModelSession:${definition.stage}:${ownerCharacterId}`,
            phase: stageInput.phase,
            provider: CODEX_TRUSTED_BLIND_PROBE_CHANNEL.provider,
            channel: CODEX_TRUSTED_BLIND_PROBE_CHANNEL.id,
            transport: CODEX_TRUSTED_BLIND_PROBE_CHANNEL.transport,
            authentication: CODEX_TRUSTED_BLIND_PROBE_CHANNEL.authentication,
            model,
            reasoningEffort,
            elapsedMs: Date.now() - startedAt,
            isolation: "persistent-character-no-tools-no-project-config",
            sessionOperation: invocation.sessionOperation,
          },
        };
      } finally {
        running = false;
      }
    },
    checkpoint() {
      return {
        schemaVersion: "character-model-session/v1",
        characterId: ownerCharacterId,
        providerConversationId,
        acceptedStageCount,
        model,
        reasoningEffort,
      };
    },
    async close() {
      if (closed) return;
      closed = true;
      if (tempDirectoryPromise) {
        const tempDirectory = await tempDirectoryPromise;
        await fs.promises.rm(tempDirectory, { recursive: true, force: true });
      }
    },
  };
  return session;
}

export async function runTavernCharacterAgentV2StageWithCodex(stageInput = {}, {
  signal,
  model = CODEX_TRUSTED_BLIND_PROBE_MODEL,
  reasoningEffort = CODEX_TRUSTED_BLIND_PROBE_REASONING_EFFORT,
  tempRoot = os.tmpdir(),
  execute = executeCodexTrustedBlindProbeInvocation,
} = {}) {
  const audit = auditCodexTrustedTavernCharacterAgentV2Input(stageInput);
  if (!audit.valid) throw invalidInputError(audit);
  const definition = tavernCharacterAgentV2StageDefinition(stageInput.phase, stageInput);
  assertCodexTrustedChannelPurpose(CODEX_TRUSTED_TAVERN_CHARACTER_AGENT_V2_PURPOSE, model);
  assertCodexTrustedReasoningEffort(model, reasoningEffort);

  const startedAt = Date.now();
  const tempDirectory = await fs.promises.mkdtemp(path.join(tempRoot, "gtown-codex-tavern-agent-v2-"));
  const schemaPath = path.join(tempDirectory, "stage.schema.json");
  const outputPath = path.join(tempDirectory, "stage.json");
  try {
    await fs.promises.writeFile(schemaPath, `${JSON.stringify(strictOutputSchema(definition.schema), null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    const invocation = buildCodexTrustedTavernCharacterAgentV2Invocation({
      stageInput,
      tempDirectory,
      schemaPath,
      outputPath,
      model,
      reasoningEffort,
      environment: sanitizeCodexTrustedBlindProbeEnvironment(),
    });
    const execution = await execute(invocation, { signal });
    let parsed;
    try {
      parsed = restoreCodexOptionalFields(JSON.parse(await fs.promises.readFile(outputPath, "utf8")), definition.schema);
    } catch (cause) {
      const error = new TypeError(`受信任 Codex v2 阶段没有生成可解析 JSON：${cause.message}`, { cause });
      error.code = "CODEX_TRUSTED_TAVERN_CHARACTER_AGENT_V2_INVALID_JSON";
      error.stderr = execution?.stderr || "";
      throw error;
    }
    return {
      [definition.outputKey]: parsed,
      audit,
      stage: {
        name: `CodexTrustedTavernCharacterAgentV2:${definition.stage}:${stageInput.characterId}`,
        phase: stageInput.phase,
        provider: CODEX_TRUSTED_BLIND_PROBE_CHANNEL.provider,
        channel: CODEX_TRUSTED_BLIND_PROBE_CHANNEL.id,
        transport: CODEX_TRUSTED_BLIND_PROBE_CHANNEL.transport,
        authentication: CODEX_TRUSTED_BLIND_PROBE_CHANNEL.authentication,
        model,
        reasoningEffort,
        elapsedMs: Date.now() - startedAt,
        isolation: "ephemeral-no-tools-no-project-config",
      },
    };
  } finally {
    await fs.promises.rm(tempDirectory, { recursive: true, force: true });
  }
}
