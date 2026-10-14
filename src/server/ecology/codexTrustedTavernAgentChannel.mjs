import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  CODEX_TRUSTED_BLIND_PROBE_CHANNEL,
  CODEX_TRUSTED_BLIND_PROBE_MODEL,
  CODEX_TRUSTED_BLIND_PROBE_REASONING_EFFORT,
  assertCodexTrustedChannelPurpose,
  buildCodexTrustedStructuredInvocation,
  executeCodexTrustedBlindProbeInvocation,
  sanitizeCodexTrustedBlindProbeEnvironment,
} from "./codexTrustedBlindProbeChannel.mjs";
import {
  tavernCausalAgentDecisionSchema,
  tavernCausalAgentSystemPrompt,
  tavernCausalAgentUserPrompt,
} from "../pipeline/tavernCausalScene.mjs";

export const CODEX_TRUSTED_TAVERN_AGENT_PURPOSE = "tavern-character-agent-behavior-acceptance";

const FORBIDDEN_INPUT_KEYS = new Set([
  "anchorPayload",
  "calibrationEvidence",
  "holdout",
  "holdouts",
  "interviewLog",
  "acceptedLines",
  "authorCorrection",
  "acceptanceNote",
  "userResult",
  "expectedAction",
  "actionPolicy",
  "candidateFamilies",
]);

const FORBIDDEN_INPUT_TEXT = Object.freeze([
  "/Users/",
  "anchor-payload.json",
  "calibration-evidence.json",
  "holdouts.md",
  "holdout_zhoumin",
  "calibration_zhoumin",
  "这名额我不要",
  "拿朋友的私事换",
  "听谁说的？",
]);

function issue(code, pathName, message) {
  return { code, path: pathName, message };
}

function visitInput(value, pathName, errors, seen = new Set()) {
  if (value == null) return;
  if (typeof value === "string") {
    for (const forbidden of FORBIDDEN_INPUT_TEXT) {
      if (value.includes(forbidden)) {
        errors.push(issue("FORBIDDEN_AUTHORING_TEXT", pathName, `运行输入含禁止的作者证据或本地路径：${forbidden}`));
      }
    }
    return;
  }
  if (typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((child, index) => visitInput(child, `${pathName}[${index}]`, errors, seen));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${pathName}.${key}`;
    if (FORBIDDEN_INPUT_KEYS.has(key)) {
      errors.push(issue("FORBIDDEN_AUTHORING_FIELD", childPath, `live Character Agent 不得读取 ${key}`));
    }
    visitInput(child, childPath, errors, seen);
  }
}

function desireText(desire = {}) {
  const desiredState = desire.desiredState || {};
  return `${desiredState.verb || "想"}${desiredState.object || desire.target?.label || "推进自己的目标"}`
    .replace(/\s+/g, " ")
    .trim();
}

function auditKnownTargetDesireSemantics(input = {}, errors = []) {
  const runtimeDesires = input.agent?.privateState?.ecologyProfile?.desires || [];
  const unresolvedRoles = [...new Set((input.perceivedCharacters || [])
    .filter((row) => row?.identityKnown === false)
    .map((row) => String(row.role || "").trim())
    .filter(Boolean))];
  for (const desire of runtimeDesires) {
    if (!String(desire?.target?.id || "").startsWith("known_entity:")) continue;
    const expectedWant = desireText(desire);
    const expectedTargetLabel = String(desire.target?.label || "").trim();
    const candidates = (input.privateActionCandidates || []).filter((candidate) => (
      candidate?.driveId === desire.id
    ));
    for (const candidate of candidates) {
      const candidatePath = `input.privateActionCandidates[${input.privateActionCandidates.indexOf(candidate)}]`;
      const pressure = candidate?.ownDecisionFactors?.desirePressure || {};
      if (pressure.desireId !== desire.id) {
        errors.push(issue(
          "DESIRE_PRESSURE_REFERENT_DRIFT",
          `${candidatePath}.ownDecisionFactors.desirePressure.desireId`,
          "欲望候选的心理压力引用了另一个感知对象，而不是人物记忆中的欲望目标。",
        ));
      }
      if (String(candidate.desire || "").trim() !== expectedWant
        || String(pressure.want || "").trim() !== String(candidate.desire || "").trim()) {
        errors.push(issue(
          "DESIRE_PRESSURE_SEMANTIC_DRIFT",
          `${candidatePath}.ownDecisionFactors.desirePressure.want`,
          "欲望候选的心理描述与人物底座中的欲望语义不一致。",
        ));
      }
      if (candidate.actionKind === "pursue_desired_state") {
        const expectedTopic = expectedTargetLabel || String(desire.desiredState?.object || "").trim() || "个人目标";
        const actualTopic = String(candidate.realization?.commitmentTopic || "").trim();
        if (actualTopic !== expectedTopic) {
          const boundToUnrecognizedRole = unresolvedRoles.some((role) => actualTopic === role || actualTopic.includes(role));
          errors.push(issue(
            boundToUnrecognizedRole
              ? "DESIRE_SEMANTIC_TOPIC_BOUND_TO_UNRECOGNIZED_STRANGER"
              : "DESIRE_SEMANTIC_TOPIC_DRIFT",
            `${candidatePath}.realization.commitmentTopic`,
            boundToUnrecognizedRole
              ? "人物的长期欲望被错误改写成了关于眼前未认出身份者的欲望。"
              : "欲望候选的行动主题与人物底座中的已知目标不一致。",
          ));
        }
      }
      const semanticFrameText = JSON.stringify(candidate.semanticFrame || null);
      if (semanticFrameText.includes("perceived_entity:")) {
        errors.push(issue(
          "DESIRE_SEMANTIC_FRAME_BOUND_TO_PERCEPTUAL_ENTITY",
          `${candidatePath}.semanticFrame`,
          "欲望的语义框架不得把记忆中的已知目标替换成眼前尚未确认的感知实体。",
        ));
      }
      const visibleActionHint = String(candidate.realization?.visibleActionHint || "");
      if (visibleActionHint && expectedTargetLabel
        && !visibleActionHint.includes(expectedTargetLabel)
        && unresolvedRoles.some((role) => visibleActionHint.includes(role))) {
        errors.push(issue(
          "DESIRE_VISIBLE_HINT_BOUND_TO_UNRECOGNIZED_STRANGER",
          `${candidatePath}.realization.visibleActionHint`,
          "欲望候选的动作提示把已知目标偷换成了眼前未认出的陌生人。",
        ));
      }
    }
  }
}

export function auditCodexTrustedTavernAgentInput(input = {}) {
  const errors = [];
  if (!input?.agent?.id) errors.push(issue("AGENT_ID_REQUIRED", "input.agent.id", "缺少当前人物 id"));
  if (!input?.scene?.id) errors.push(issue("SCENE_ID_REQUIRED", "input.scene.id", "缺少当前场景 id"));
  if (input?.agent?.psychologyAnchor?.runtimeSurface !== "character-foundation") {
    errors.push(issue(
      "CHARACTER_FOUNDATION_AUTHORITY_REQUIRED",
      "input.agent.psychologyAnchor.runtimeSurface",
      "真实行为样本必须来自 validated character foundation 运行面",
    ));
  }
  if (input?.agent?.privateState?.selfModel?.authority !== "validated-character-foundation-and-owned-memory-only") {
    errors.push(issue(
      "SINGLE_AGENT_AUTHORITY_REQUIRED",
      "input.agent.privateState.selfModel.authority",
      "人物心理必须只由 validated foundation 与本人记忆提供",
    ));
  }
  if (!Array.isArray(input.privateActionCandidates) || !input.privateActionCandidates.length) {
    errors.push(issue("ACTION_CANDIDATES_REQUIRED", "input.privateActionCandidates", "通用认知内核没有提供行动候选"));
  }
  for (const [index, candidate] of (input.privateActionCandidates || []).entries()) {
    const guidance = candidate?.ownDecisionFactors?.anchorGuidance;
    if (guidance && guidance.authority !== "generic-cognitive-core") {
      errors.push(issue(
        "GENERIC_COGNITIVE_CORE_REQUIRED",
        `input.privateActionCandidates[${index}].ownDecisionFactors.anchorGuidance.authority`,
        "人物候选不得由人物专属情境脚本生成",
      ));
    }
    const responseFromAnotherAction = Boolean(candidate?.realization?.responseSourceImpactId);
    if (responseFromAnotherAction && /(?:"|:)desire[_:]/u.test(JSON.stringify({
      semanticFrame: candidate.semanticFrame || null,
      commitmentTopic: candidate.realization?.commitmentTopic || "",
    }))) {
      errors.push(issue(
        "RECIPIENT_RESPONSE_PRIVATE_DESIRE_LEAK",
        `input.privateActionCandidates[${index}]`,
        "回应候选携带了上一人物没有公开表达的私人欲望 id 或语义主题。接收者只能收到实际话语和可见动作形成的公共语义。",
      ));
    }
    const mayAsk = (candidate?.realization?.allowedSpeechActs || []).includes("ask");
    const availableQuestionIds = new Set((input.epistemicDecisionSupport?.evaluations || [])
      .filter((row) => String(row?.primitive || "").startsWith("ask_"))
      .map((row) => row.candidateId));
    if (responseFromAnotherAction && mayAsk && availableQuestionIds.size) {
      const options = candidate?.realization?.epistemicQuestionOptions || [];
      const optionIds = new Set(options.map((row) => row?.candidateId).filter(Boolean));
      const missingCandidateIds = [...availableQuestionIds].filter((candidateId) => !optionIds.has(candidateId));
      if (missingCandidateIds.length) {
        errors.push(issue(
          "RESPONSE_EPISTEMIC_QUESTION_OPTIONS_MISSING",
          `input.privateActionCandidates[${index}].realization.epistemicQuestionOptions`,
          `回应候选允许人物另行提问，却没有携带同一套认识行动代价：${missingCandidateIds.join(", ")}`,
        ));
      }
    }
  }
  const unresolvedPerceivedIds = new Set((input.perceivedCharacters || [])
    .filter((row) => row?.identityKnown === false)
    .map((row) => row.id)
    .filter(Boolean));
  const hearsayEntityIds = new Set(
    input.agent?.privateState?.sceneRole?.knowledgeBoundary?.hearsayActorIds || [],
  );
  const collapsedReferentIds = [...hearsayEntityIds].filter((id) => unresolvedPerceivedIds.has(id));
  if (collapsedReferentIds.length) {
    errors.push(issue(
      "HEARSAY_AND_PERCEPTUAL_REFERENT_COLLAPSED",
      "input.agent.privateState.sceneRole.knowledgeBoundary.hearsayActorIds",
      `传闻中知道的人与眼前未认出的实体共用了同一指代：${collapsedReferentIds.join(", ")}`,
    ));
  }
  for (const [index, entity] of (input.agent?.psychologyAnchor?.epistemics?.knownEntities || []).entries()) {
    if (entity?.knowsName === true && entity?.recognizesIdentity !== true
      && !String(entity.entityId || "").startsWith("known_entity:")) {
      errors.push(issue(
        "KNOWN_UNRECOGNIZED_ENTITY_HANDLE_REQUIRED",
        `input.agent.psychologyAnchor.epistemics.knownEntities[${index}].entityId`,
        "只知道姓名但尚未认出本人的对象必须使用独立 known_entity 句柄，不能借用眼前感知实体。",
      ));
    }
  }
  auditKnownTargetDesireSemantics(input, errors);
  visitInput(input, "input", errors);
  return {
    valid: errors.length === 0,
    errors,
    boundary: {
      characterFoundationOnly: true,
      ownedMemoryOnly: true,
      authoringArtifactsForbidden: true,
      calibrationAndHoldoutsForbidden: true,
      finalChoiceOwner: "character-agent",
      worldRole: "validate-and-resolve-only",
    },
  };
}

function invalidInputError(audit) {
  const error = new TypeError(audit.errors.map((entry) => `${entry.code}@${entry.path}: ${entry.message}`).join("\n"));
  error.code = "INVALID_TRUSTED_TAVERN_AGENT_INPUT";
  error.issues = audit.errors;
  return error;
}

export function buildCodexTrustedTavernAgentPrompt(input = {}) {
  const audit = auditCodexTrustedTavernAgentInput(input);
  if (!audit.valid) throw invalidInputError(audit);
  return `<character_agent_contract>\n${tavernCausalAgentSystemPrompt(input)}\n</character_agent_contract>\n\n<live_tavern_agent_input>\n${tavernCausalAgentUserPrompt(input)}\n</live_tavern_agent_input>\n\n不要调用任何工具、命令、文件、网络、记忆或其他 Agent。只能作为当前这个人物，根据 live_tavern_agent_input 作出一次选择；最终只输出符合指定 schema 的 JSON。`;
}

function semanticRoleKeysForInput(input = {}) {
  return [...new Set((input.privateActionCandidates || []).flatMap((candidate) => (
    Object.keys(candidate?.semanticFrame?.roles || {})
  )))].sort();
}

function makeStrictOutputSchema(schema = {}) {
  if (!schema || typeof schema !== "object") return schema;
  const copy = structuredClone(schema);
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "object" && node.properties) {
      node.additionalProperties = false;
      const optional = new Set(node.optionalProperties || []);
      node.required = Object.keys(node.properties).filter((key) => !optional.has(key));
      delete node.optionalProperties;
      for (const child of Object.values(node.properties)) visit(child);
    }
    if (node.items) visit(node.items);
  };
  visit(copy);
  return copy;
}

export function buildCodexTrustedTavernAgentDecisionSchema(input = {}) {
  const schema = structuredClone(tavernCausalAgentDecisionSchema);
  const roleKeys = semanticRoleKeysForInput(input);
  schema.properties.semanticRoleBindings = {
    type: "object",
    additionalProperties: false,
    required: roleKeys,
    properties: Object.fromEntries(roleKeys.map((role) => [role, {
      type: "string",
      description: `候选语义角色 ${role}；当前候选没有该角色时为空字符串`,
    }])),
  };
  return makeStrictOutputSchema(schema);
}

export function buildCodexTrustedTavernAgentInvocation({
  input,
  tempDirectory,
  schemaPath,
  outputPath,
  model = CODEX_TRUSTED_BLIND_PROBE_MODEL,
  reasoningEffort = CODEX_TRUSTED_BLIND_PROBE_REASONING_EFFORT,
  environment = sanitizeCodexTrustedBlindProbeEnvironment(),
} = {}) {
  return buildCodexTrustedStructuredInvocation({
    purpose: CODEX_TRUSTED_TAVERN_AGENT_PURPOSE,
    prompt: buildCodexTrustedTavernAgentPrompt(input),
    tempDirectory,
    schemaPath,
    outputPath,
    model,
    reasoningEffort,
    environment,
  });
}

export async function runTavernCausalAgentWithCodex(input, {
  signal,
  model = CODEX_TRUSTED_BLIND_PROBE_MODEL,
  reasoningEffort = CODEX_TRUSTED_BLIND_PROBE_REASONING_EFFORT,
  tempRoot = os.tmpdir(),
  execute = executeCodexTrustedBlindProbeInvocation,
} = {}) {
  const audit = auditCodexTrustedTavernAgentInput(input);
  if (!audit.valid) throw invalidInputError(audit);
  assertCodexTrustedChannelPurpose(CODEX_TRUSTED_TAVERN_AGENT_PURPOSE, model);

  const startedAt = Date.now();
  const tempDirectory = await fs.promises.mkdtemp(path.join(tempRoot, "gtown-codex-tavern-agent-"));
  const schemaPath = path.join(tempDirectory, "decision.schema.json");
  const outputPath = path.join(tempDirectory, "decision.json");
  try {
    const outputSchema = buildCodexTrustedTavernAgentDecisionSchema(input);
    await fs.promises.writeFile(schemaPath, `${JSON.stringify(outputSchema, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    const invocation = buildCodexTrustedTavernAgentInvocation({
      input,
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
      parsed = JSON.parse(await fs.promises.readFile(outputPath, "utf8"));
    } catch (cause) {
      const error = new TypeError(`受信任 Codex 酒馆 Agent 没有生成可解析的结构化决定：${cause.message}`, { cause });
      error.code = "CODEX_TRUSTED_TAVERN_AGENT_INVALID_JSON";
      error.stderr = execution?.stderr || "";
      throw error;
    }
    return {
      decision: parsed,
      inputAudit: audit,
      stage: {
        name: `TavernCausalAgent:${input.agent?.name || input.agent?.id || "unknown"}`,
        provider: "openai",
        channel: CODEX_TRUSTED_BLIND_PROBE_CHANNEL.id,
        transport: CODEX_TRUSTED_BLIND_PROBE_CHANNEL.transport,
        authentication: CODEX_TRUSTED_BLIND_PROBE_CHANNEL.authentication,
        purpose: CODEX_TRUSTED_TAVERN_AGENT_PURPOSE,
        model,
        reasoningEffort,
        elapsedMs: Date.now() - startedAt,
        isolation: "ephemeral-no-tools-no-project-config",
        inputAuditPassed: true,
      },
    };
  } finally {
    await fs.promises.rm(tempDirectory, { recursive: true, force: true });
  }
}
