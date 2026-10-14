import { validateCharacterFoundation } from "./validatedCharacterAnchorRuntime.mjs";
import { callOpenAIJson } from "../pipeline/responseClient.mjs";
import {
  characterPostChoiceContinuityProposalSchema,
  validateCharacterPostChoiceContinuityProposal,
} from "../simulation/characterPostChoiceContinuity.mjs";
import {
  auditEmbodiedSpatialChoiceInput,
  buildEmbodiedSpatialChoiceTool,
} from "../simulation/embodiedSpatialChoice.mjs";
import {
  auditSituatedServiceChoiceInput,
  buildSituatedServiceChoiceTool,
} from "../simulation/situatedServiceChoice.mjs";

const AUTHORING_ONLY_KEYS = new Set([
  "actionPolicy",
  "authorCorrection",
  "authorReview",
  "calibrationEvidence",
  "calibrationScenarios",
  "candidateFamilies",
  "expectedAction",
  "expectedOutcome",
  "holdoutAnswer",
  "holdouts",
  "prediction",
  "validation",
]);

const EVIDENCE_SEEKING_FUTURE_MODES = new Set([
  "observe",
  "ask",
  "seek_evidence",
  "approach",
  "wait_for_condition",
]);
const GENERIC_PSYCHOLOGY_FACTOR_IDS = Object.freeze([
  "desireFit",
  "identityFit",
  "evidenceGain",
  "relationshipCare",
  "bodyFit",
  "opportunity",
  "exposureCost",
  "uncertaintyRisk",
  "normCost",
  "switchingCost",
  "competenceFit",
  "informationAccess",
  "spatialControl",
  "equipmentControl",
  "proceduralFluency",
  "trafficInterference",
  "needRelief",
  "hungerRelief",
  "thirstRelief",
  "stayLegitimacy",
  "informationCover",
  "priceCost",
  "priceBurden",
  "qualityFit",
  "liquiditySafety",
  "resourceObligation",
  "statusMismatch",
  "wasteRisk",
  "interactionExposure",
  "serviceDelay",
  "socialAttentionRisk",
]);

export const CHARACTER_FOUNDATION_PROBE_PRIMITIVES = Object.freeze([
  Object.freeze({ id: "observe", meaning: "观察本人确实能感知的人、物或变化；不凭观察自动得到隐藏事实", targetMode: "optional", allowsSpeech: false }),
  Object.freeze({ id: "ask", meaning: "向当前可感知的人提出一个问题", targetMode: "required", allowsSpeech: true }),
  Object.freeze({ id: "request", meaning: "向当前可感知的人提出服务或行动请求；请求本身不等于对方接受、交付或结算", targetMode: "required", allowsSpeech: true, requiresAffordance: true }),
  Object.freeze({ id: "inform", meaning: "向当前可感知的人主动说明、拒绝或表明边界", targetMode: "required", allowsSpeech: true }),
  Object.freeze({ id: "interact", meaning: "通过世界提供的可供性操作本人当前可触及的人或物；不因操作自动转移所有权、取得隐藏信息或完成未验证事务", targetMode: "none", allowsSpeech: false, requiresAffordance: true }),
  Object.freeze({ id: "continue", meaning: "继续本人已经在做的可行事务", targetMode: "none", allowsSpeech: false }),
  Object.freeze({ id: "wait", meaning: "保留未完成意图并等待新的客观条件；等待不等于满足欲望", targetMode: "none", allowsSpeech: false }),
  Object.freeze({ id: "move", meaning: "沿世界提供的相邻路线移动一次", targetMode: "none", allowsSpeech: false, requiresAffordance: true }),
  Object.freeze({ id: "leave", meaning: "沿世界提供的离场路线离开；未完成目标仍保留", targetMode: "none", allowsSpeech: false, requiresAffordance: true }),
  Object.freeze({ id: "pass", meaning: "本次不提交公开动作，但保留真实心理状态和未来意图", targetMode: "none", allowsSpeech: false }),
]);

const PRIMITIVE_BY_ID = new Map(CHARACTER_FOUNDATION_PROBE_PRIMITIVES.map((row) => [row.id, row]));

export const characterFoundationProbeDecisionSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "perceivedFacts",
    "candidateComparison",
    "chosenCandidateId",
    "epistemicUpdate",
    "relationshipUpdate",
    "action",
    "futureIntention",
    "memoryWrite",
    "postChoiceContinuity",
    "memoryRetrieval",
    "expectedWorldConsequences",
    "factorLedger",
    "privateReason",
  ],
  properties: {
    perceivedFacts: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "status", "summary", "basisIds"],
        properties: {
          id: {
            type: "string",
            description: "外部事实、感知事件或本人记忆必须逐字复制输入中的 canonical id；只有人物新推断可使用 inference:* id。",
          },
          status: { type: "string", enum: ["objective", "firsthand_memory", "sourced_report", "inference"] },
          summary: { type: "string" },
          basisIds: {
            type: "array",
            minItems: 1,
            maxItems: 6,
            description: "逐字引用输入中的 objective fact、perceived event 或 owned episode id；外部输入行至少包含自身 id，inference 行列出全部直接依据。",
            items: { type: "string" },
          },
        },
      },
    },
    candidateComparison: {
      type: "array",
      minItems: 2,
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["candidateId", "primitiveId", "targetCharacterId", "affordanceId", "feasible", "attemptable", "reason"],
        properties: {
          candidateId: { type: "string" },
          primitiveId: { type: "string", enum: CHARACTER_FOUNDATION_PROBE_PRIMITIVES.map((row) => row.id) },
          targetCharacterId: {
            type: "string",
            description: "仅 primitive.targetMode=required/optional 且候选确实作用于该人物时填写；targetMode=none 必须为空。请求者或事件来源不会自动成为动作对象。",
          },
          affordanceId: { type: "string" },
          feasible: { type: "boolean" },
          attemptable: { type: "boolean" },
          reason: { type: "string" },
        },
      },
    },
    chosenCandidateId: { type: "string" },
    epistemicUpdate: {
      type: "object",
      additionalProperties: false,
      required: ["sourceEventId", "classification", "claimAcceptedAsFact", "confidenceBand", "evidenceBasisIds"],
      properties: {
        sourceEventId: { type: "string" },
        classification: { type: "string", enum: ["objective_fact", "sourced_report", "personal_inference", "rejected_noise"] },
        claimAcceptedAsFact: { type: "boolean" },
        confidenceBand: { type: "string", enum: ["very_low", "low", "medium", "high"] },
        evidenceBasisIds: { type: "array", items: { type: "string" } },
      },
    },
    relationshipUpdate: {
      type: "object",
      additionalProperties: false,
      required: ["targetCharacterId", "change", "durable", "evidenceBasisIds"],
      properties: {
        targetCharacterId: {
          type: "string",
          description: "必须与所选候选完全一致；primitive.targetMode=none 时为空，物件对象由 affordanceId 表达。",
        },
        change: { type: "string", enum: ["none", "provisional_doubt", "care_up", "care_down", "obligation_up", "obligation_down", "trust_up", "trust_down", "mixed"] },
        durable: { type: "boolean" },
        evidenceBasisIds: { type: "array", items: { type: "string" } },
      },
    },
    action: {
      type: "object",
      additionalProperties: false,
      required: ["primitiveId", "targetCharacterId", "affordanceId", "speechAct", "speech", "visibleAction"],
      properties: {
        primitiveId: { type: "string", enum: CHARACTER_FOUNDATION_PROBE_PRIMITIVES.map((row) => row.id) },
        targetCharacterId: {
          type: "string",
          description: "只有未来意图确实针对当前可感知人物时填写；观察环境、等待线索或继续一般事务时为空。",
        },
        affordanceId: { type: "string" },
        speechAct: { type: "string", enum: ["none", "ask", "request", "inform", "answer", "refuse", "offer"] },
        speech: { type: "string" },
        visibleAction: { type: "string" },
      },
    },
    futureIntention: {
      type: "object",
      additionalProperties: false,
      required: ["mode", "targetCharacterId", "triggerCondition", "knowledgeLimit"],
      properties: {
        mode: { type: "string", enum: ["none", "observe", "ask", "seek_evidence", "approach", "wait_for_condition", "leave"] },
        targetCharacterId: { type: "string" },
        triggerCondition: { type: "string" },
        knowledgeLimit: {
          type: "string",
          enum: ["no_new_knowledge_yet", "depends_on_future_evidence", "not_applicable"],
          description: "observe、ask、seek_evidence、approach、wait_for_condition 等未来取证意图必须使用 depends_on_future_evidence。",
        },
      },
    },
    memoryWrite: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "sourceEventId", "proposition", "confidenceBand"],
      properties: {
        kind: { type: "string", enum: ["none", "sourced_report", "firsthand_episode", "belief_update", "commitment"] },
        sourceEventId: { type: "string" },
        proposition: { type: "string" },
        confidenceBand: { type: "string", enum: ["very_low", "low", "medium", "high"] },
      },
    },
    postChoiceContinuity: characterPostChoiceContinuityProposalSchema,
    memoryRetrieval: {
      type: "object",
      additionalProperties: false,
      required: ["episodeIds", "influence"],
      properties: {
        episodeIds: { type: "array", items: { type: "string" } },
        influence: { type: "string" },
      },
    },
    expectedWorldConsequences: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "certainty", "description", "basisIds"],
        properties: {
          kind: { type: "string", enum: ["visible_action", "speech_heard", "position_change", "service_request_opened", "social_attention", "report_stored", "relationship_tension", "future_opportunity", "none"] },
          certainty: { type: "string", enum: ["direct", "probable", "conditional"] },
          description: { type: "string" },
          basisIds: { type: "array", items: { type: "string" } },
        },
      },
    },
    factorLedger: {
      type: "object",
      additionalProperties: false,
      required: ["chosen", "rejectedAlternative"],
      properties: {
        chosen: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["factorId", "direction", "strengthBand", "basisIds"],
            properties: {
              factorId: { type: "string", description: "使用通用心理公式维度，或逐字使用输入中的 foundation/dynamic 参数 id 或 path。" },
              direction: { type: "string", enum: ["supports", "opposes"] },
              strengthBand: { type: "string", enum: ["low", "medium", "high"] },
              basisIds: { type: "array", minItems: 1, items: { type: "string" } },
            },
          },
        },
        rejectedAlternative: {
          type: "object",
          additionalProperties: false,
          required: ["primitiveId", "reason", "factors"],
          properties: {
            primitiveId: { type: "string", enum: CHARACTER_FOUNDATION_PROBE_PRIMITIVES.map((row) => row.id) },
            reason: { type: "string" },
            factors: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["factorId", "direction", "strengthBand", "basisIds"],
                properties: {
                  factorId: { type: "string", description: "使用通用心理公式维度，或逐字使用输入中的 foundation/dynamic 参数 id 或 path。" },
                  direction: { type: "string", enum: ["supports", "opposes"] },
                  strengthBand: { type: "string", enum: ["low", "medium", "high"] },
                  basisIds: { type: "array", minItems: 1, items: { type: "string" } },
                },
              },
            },
          },
        },
      },
    },
    privateReason: { type: "string" },
  },
});

function deepClone(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function clean(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function issue(code, path, message) {
  return { code, path, message };
}

function walkAuthoringKeys(value, path = "input", errors = []) {
  if (!value || typeof value !== "object") return errors;
  if (Array.isArray(value)) {
    value.forEach((child, index) => walkAuthoringKeys(child, `${path}[${index}]`, errors));
    return errors;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (AUTHORING_ONLY_KEYS.has(key)) {
      errors.push(issue("PROBE_AUTHORING_SURFACE_LEAK", childPath, `盲测运行输入不得包含作者测试字段 ${key}`));
    }
    walkAuthoringKeys(child, childPath, errors);
  }
  return errors;
}

function perceivedEventById(input, eventId) {
  return (input.world?.perceivedEvents || []).find((row) => row.id === eventId) || null;
}

function eventIsUnverifiedReport(event = {}) {
  const sourceKind = clean(event.provenance?.kind).toLowerCase();
  return event.truthStatus !== "verified"
    || ["reported", "gossip", "hearsay", "rumor"].some((token) => sourceKind.includes(token));
}

function ownedEpisodeIsFirsthand(episode = {}) {
  const sourceLabels = [episode?.source?.kind, episode?.sourceType]
    .map((value) => clean(value).toLowerCase())
    .filter(Boolean);
  return sourceLabels.some((label) => (
    ["firsthand", "direct", "self_action"].includes(label)
    || label.startsWith("firsthand_")
    || label.startsWith("direct_")
    || label.startsWith("self_action_")
  ));
}

function evidenceContainsStrongSource(input, evidenceIds = []) {
  const ids = new Set(evidenceIds || []);
  if ((input.world?.objectiveFacts || []).some((row) => ids.has(row.id) && row.evidenceStrength === "strong")) return true;
  return (input.ownedMemory?.episodes || []).some((row) => (
    ids.has(row.id)
    && ownedEpisodeIsFirsthand(row)
    && row.semanticFrame?.predicate === "observe_relationship_malice"
  ));
}

function probeBasisIds(input = {}) {
  const ids = new Set();
  const add = (value) => {
    const normalized = clean(value);
    if (normalized) ids.add(normalized);
  };
  const addRows = (rows = []) => rows.forEach((row) => add(row?.id));
  add(input.character?.id);
  add(input.foundation?.characterId);
  addRows(input.foundation?.stablePsychology?.corePursuits || []);
  addRows(input.foundation?.stablePsychology?.selfThreats || []);
  for (const key of Object.keys(input.foundation?.stablePsychology?.dispositions || {})) {
    add(key);
    add(`foundation.stablePsychology.dispositions.${key}`);
  }
  for (const [group, rows] of Object.entries({
    perceptualCompetences: input.foundation?.competenceModel?.perceptualCompetences || [],
    proceduralCompetences: input.foundation?.competenceModel?.proceduralCompetences || [],
  })) {
    for (const [index, row] of rows.entries()) {
      add(row?.id);
      add(`foundation.competenceModel.${group}[${index}]`);
    }
  }
  addRows(input.foundation?.dynamicPsychology?.stateVariables || []);
  addRows(input.foundation?.desires || []);
  addRows(input.foundation?.inhibitors || []);
  for (const key of Object.keys(input.foundation?.epistemics?.sourceReliability || {})) {
    add(`foundation.epistemics.sourceReliability.${key}`);
  }
  for (const key of Object.keys(input.foundation?.epistemics?.beliefUpdatePolicy || {})) {
    add(`foundation.epistemics.beliefUpdatePolicy.${key}`);
  }
  for (const [index, row] of (input.foundation?.relationshipModel?.updateRules || []).entries()) {
    add(row?.id);
    add(`foundation.relationshipModel.updateRules[${index}]`);
  }
  for (const key of Object.keys(input.dynamicState || {})) {
    add(key);
    add(`dynamicState.${key}`);
  }
  for (const key of Object.keys(input.world?.atmosphere || {})) add(`world.atmosphere.${key}`);
  addRows(input.world?.objectiveFacts || []);
  addRows(input.world?.perceivedEvents || []);
  addRows(input.world?.perceivedCharacters || []);
  addRows(input.world?.ownedResources || []);
  addRows(input.world?.socialNorms || []);
  addRows(input.world?.availableAffordances || []);
  add(input.world?.spatialChoice?.currentPosition?.id);
  for (const [index, row] of (input.world?.spatialChoice?.positionOptions || []).entries()) {
    add(row?.id);
    add(`world.spatialChoice.positionOptions[${index}]`);
    for (const metricId of Object.keys(row?.metrics || {})) {
      add(`world.spatialChoice.positionOptions[${index}].metrics.${metricId}`);
    }
  }
  addRows(input.world?.spatialChoice?.carriedObjects || []);
  addRows(input.world?.serviceChoice?.ownedTender || []);
  addRows(input.world?.serviceChoice?.offers || []);
  const economicContext = input.world?.serviceChoice?.economicContext || {};
  add(economicContext.wallet?.sourceId);
  add("world.serviceChoice.economicContext.wallet");
  for (const row of economicContext.sources || []) add(row?.id);
  for (const row of economicContext.obligations || []) add(row?.id);
  for (const key of Object.keys(economicContext.consumptionPreferences || {})) {
    add(`world.serviceChoice.economicContext.consumptionPreferences.${key}`);
  }
  addRows(input.ownedMemory?.episodes || []);
  addRows(input.ownedMemory?.beliefs || []);
  addRows(input.ownedMemory?.commitments || []);
  for (const row of input.relationshipContext || []) {
    add(row.targetCharacterId);
    for (const evidenceId of row.directlyExperiencedEvidenceIds || []) add(evidenceId);
  }
  return ids;
}

function probeFactorDefinitions(input = {}) {
  const definitions = new Map(GENERIC_PSYCHOLOGY_FACTOR_IDS.map((id) => [id, new Set()]));
  const addParameterGroup = (values = []) => {
    const ids = values.map(clean).filter(Boolean);
    if (!ids.length) return;
    for (const id of ids) definitions.set(id, new Set(ids));
  };
  for (const row of input.foundation?.stablePsychology?.corePursuits || []) addParameterGroup([row?.id]);
  for (const row of input.foundation?.stablePsychology?.selfThreats || []) addParameterGroup([row?.id]);
  for (const key of Object.keys(input.foundation?.stablePsychology?.dispositions || {})) {
    addParameterGroup([key, `foundation.stablePsychology.dispositions.${key}`]);
  }
  for (const key of Object.keys(input.foundation?.materialEconomy?.consumptionPreferences || {})) {
    addParameterGroup([key, `foundation.materialEconomy.consumptionPreferences.${key}`]);
  }
  for (const [group, rows] of Object.entries({
    perceptualCompetences: input.foundation?.competenceModel?.perceptualCompetences || [],
    proceduralCompetences: input.foundation?.competenceModel?.proceduralCompetences || [],
  })) {
    for (const [index, row] of rows.entries()) {
      addParameterGroup([row?.id, `foundation.competenceModel.${group}[${index}]`]);
    }
  }
  for (const row of input.foundation?.dynamicPsychology?.stateVariables || []) addParameterGroup([row?.id]);
  for (const row of input.foundation?.desires || []) addParameterGroup([row?.id]);
  for (const row of input.foundation?.inhibitors || []) addParameterGroup([row?.id]);
  for (const key of Object.keys(input.foundation?.epistemics?.sourceReliability || {})) {
    addParameterGroup([key, `foundation.epistemics.sourceReliability.${key}`]);
  }
  for (const key of Object.keys(input.foundation?.epistemics?.beliefUpdatePolicy || {})) {
    addParameterGroup([key, `foundation.epistemics.beliefUpdatePolicy.${key}`]);
  }
  for (const [index, row] of (input.foundation?.relationshipModel?.updateRules || []).entries()) {
    addParameterGroup([row?.id, `foundation.relationshipModel.updateRules[${index}]`]);
  }
  for (const key of Object.keys(input.dynamicState || {})) {
    addParameterGroup([key, `dynamicState.${key}`]);
  }
  for (const key of Object.keys(input.world?.atmosphere || {})) {
    addParameterGroup([`world.atmosphere.${key}`]);
  }
  for (const key of Object.keys(input.world?.serviceChoice?.economicContext?.consumptionPreferences || {})) {
    addParameterGroup([
      key,
      `world.serviceChoice.economicContext.consumptionPreferences.${key}`,
    ]);
  }
  return definitions;
}

function factorRows(decision = {}) {
  return [
    ...(decision.factorLedger?.chosen || []),
    ...(decision.factorLedger?.rejectedAlternative?.factors || []),
  ];
}

function validateProjectionCompleteness(input = {}, decision = {}, errors = []) {
  const requiredObjects = [
    "epistemicUpdate",
    "relationshipUpdate",
    "action",
    "futureIntention",
    "memoryWrite",
    "postChoiceContinuity",
    "memoryRetrieval",
    "factorLedger",
  ];
  const requiredArrays = ["perceivedFacts", "candidateComparison", "expectedWorldConsequences"];
  const missing = [
    ...requiredObjects.filter((key) => !decision?.[key] || typeof decision[key] !== "object" || Array.isArray(decision[key])),
    ...requiredArrays.filter((key) => !Array.isArray(decision?.[key])),
    ...(!clean(decision?.chosenCandidateId) ? ["chosenCandidateId"] : []),
    ...(!clean(decision?.privateReason) ? ["privateReason"] : []),
  ];
  if (missing.length) {
    errors.push(issue("HOLDOUT_PROJECTION_INCOMPLETE", "decision", `未见投射缺少 Gate 6 审计字段：${missing.join(", ")}`));
    return;
  }

  if (decision.perceivedFacts.length === 0 || decision.candidateComparison.length < 2 || decision.expectedWorldConsequences.length === 0) {
    errors.push(issue("HOLDOUT_PROJECTION_INCOMPLETE", "decision", "未见投射至少需要一项感知事实、两个候选和一项预期世界后果"));
  }

  const perceivedSourceById = new Map();
  for (const row of input.world?.objectiveFacts || []) {
    perceivedSourceById.set(row.id, { expectedStatus: "objective", sourceKind: "objective_fact" });
  }
  for (const row of input.world?.perceivedEvents || []) {
    perceivedSourceById.set(row.id, {
      expectedStatus: eventIsUnverifiedReport(row) ? "sourced_report" : "objective",
      sourceKind: "perceived_event",
    });
  }
  for (const row of input.ownedMemory?.episodes || []) {
    perceivedSourceById.set(row.id, {
      expectedStatus: ownedEpisodeIsFirsthand(row) ? "firsthand_memory" : "sourced_report",
      sourceKind: "owned_episode",
    });
  }
  const perceivedFactIds = new Set();
  for (const [index, fact] of decision.perceivedFacts.entries()) {
    const path = `decision.perceivedFacts[${index}]`;
    const factId = clean(fact.id);
    const basisIds = (fact.basisIds || []).map(clean).filter(Boolean);
    if (!factId || perceivedFactIds.has(factId)) {
      errors.push(issue("PERCEIVED_FACT_ID_INVALID", `${path}.id`, "感知事实或推断 id 必须存在且互不重复"));
    }
    perceivedFactIds.add(factId);

    if (fact.status === "inference") {
      if (!factId.startsWith("inference:") || factId === "inference:") {
        errors.push(issue("PERCEIVED_INFERENCE_ID_INVALID", `${path}.id`, "人物推断必须使用非空的 inference:* id"));
      }
      if (perceivedSourceById.has(factId)) {
        errors.push(issue("PERCEIVED_INFERENCE_ID_COLLISION", `${path}.id`, "人物推断不得覆盖输入中的 canonical id"));
      }
      if (basisIds.length === 0) {
        errors.push(issue("PERCEIVED_INFERENCE_BASIS_MISSING", `${path}.basisIds`, "人物推断必须引用至少一项真实输入依据"));
      }
      for (const basisId of basisIds) {
        if (!perceivedSourceById.has(basisId)) {
          errors.push(issue("PERCEIVED_INFERENCE_BASIS_UNKNOWN", `${path}.basisIds`, `人物推断引用了输入中不存在的依据 ${basisId}`));
        }
      }
      continue;
    }

    const source = perceivedSourceById.get(factId);
    if (!source) {
      errors.push(issue("PERCEIVED_FACT_UNKNOWN", `${path}.id`, "外部事实、感知事件或本人记忆必须逐字引用输入中的 canonical id，不得另造别名"));
      continue;
    }
    if (fact.status !== source.expectedStatus) {
      errors.push(issue("PERCEIVED_FACT_STATUS_MISMATCH", path, `${source.sourceKind} 必须标为 ${source.expectedStatus}`));
    }
    if (!basisIds.includes(factId)) {
      errors.push(issue("PERCEIVED_FACT_SELF_BASIS_MISSING", `${path}.basisIds`, "外部输入行的 basisIds 必须至少包含它逐字复制的自身 canonical id"));
    }
    for (const basisId of basisIds) {
      if (!perceivedSourceById.has(basisId)) {
        errors.push(issue("PERCEIVED_FACT_BASIS_UNKNOWN", `${path}.basisIds`, `外部输入行引用了输入中不存在的依据 ${basisId}`));
      }
    }
  }

  const perceivedCharacterIds = new Set((input.world?.perceivedCharacters || []).map((row) => row.id));
  const affordanceById = new Map((input.world?.availableAffordances || []).map((row) => [row.id, row]));
  const candidateIds = new Set();
  for (const [index, candidate] of decision.candidateComparison.entries()) {
    const path = `decision.candidateComparison[${index}]`;
    if (!clean(candidate.candidateId) || candidateIds.has(candidate.candidateId)) {
      errors.push(issue("CANDIDATE_ID_INVALID", `${path}.candidateId`, "候选 id 必须存在且互不重复"));
    }
    candidateIds.add(candidate.candidateId);
    const primitive = PRIMITIVE_BY_ID.get(candidate.primitiveId);
    if (!primitive || !(input.universalActionPrimitives || []).some((row) => row.id === candidate.primitiveId)) {
      errors.push(issue("CANDIDATE_PRIMITIVE_UNKNOWN", `${path}.primitiveId`, "候选必须来自通用行动原语"));
    }
    if (candidate.targetCharacterId && !perceivedCharacterIds.has(candidate.targetCharacterId)) {
      errors.push(issue("CANDIDATE_TARGET_NOT_PERCEIVED", `${path}.targetCharacterId`, "候选对象不在人物可感知范围"));
    }
    if (primitive?.targetMode === "required" && !clean(candidate.targetCharacterId)) {
      errors.push(issue("CANDIDATE_TARGET_REQUIRED", `${path}.targetCharacterId`, "该候选原语需要当前可感知对象"));
    }
    if (primitive?.targetMode === "none" && clean(candidate.targetCharacterId)) {
      errors.push(issue("CANDIDATE_TARGET_FORBIDDEN", `${path}.targetCharacterId`, "该候选原语不绑定人物对象"));
    }
    const affordance = candidate.affordanceId ? affordanceById.get(candidate.affordanceId) : null;
    if (candidate.affordanceId && !affordance) {
      errors.push(issue("CANDIDATE_AFFORDANCE_UNKNOWN", `${path}.affordanceId`, "候选引用了世界未提供的 affordance"));
    }
    if (primitive?.requiresAffordance && !affordance) {
      errors.push(issue("CANDIDATE_AFFORDANCE_REQUIRED", `${path}.affordanceId`, "需要世界条件的候选必须引用真实 affordance"));
    }
    if (candidate.primitiveId === "move" && affordance && affordance.type !== "move") {
      errors.push(issue("CANDIDATE_AFFORDANCE_TYPE_MISMATCH", `${path}.affordanceId`, "move 候选必须使用 move affordance"));
    }
    if (candidate.primitiveId === "leave" && affordance && affordance.type !== "leave") {
      errors.push(issue("CANDIDATE_AFFORDANCE_TYPE_MISMATCH", `${path}.affordanceId`, "leave 候选必须使用 leave affordance"));
    }
    if (candidate.primitiveId === "request" && affordance && affordance.type !== "request_service") {
      errors.push(issue("CANDIDATE_AFFORDANCE_TYPE_MISMATCH", `${path}.affordanceId`, "request 服务候选必须使用 request_service affordance"));
    }
    if (candidate.primitiveId === "request"
      && affordance?.targetActorIds?.length
      && !affordance.targetActorIds.includes(candidate.targetCharacterId)) {
      errors.push(issue("CANDIDATE_SERVICE_TARGET_MISMATCH", `${path}.targetCharacterId`, "服务请求对象必须是该 affordance 声明的经手人"));
    }
  }

  const chosen = decision.candidateComparison.find((row) => row.candidateId === decision.chosenCandidateId) || null;
  if (!chosen) {
    errors.push(issue("CHOSEN_CANDIDATE_UNKNOWN", "decision.chosenCandidateId", "最终选择必须来自 candidateComparison"));
  } else {
    if (!chosen.feasible && !chosen.attemptable) {
      errors.push(issue("CHOSEN_CANDIDATE_BLOCKED", "decision.chosenCandidateId", "最终选择至少必须可行或可尝试"));
    }
    if (decision.action?.primitiveId !== chosen.primitiveId
      || clean(decision.action?.targetCharacterId) !== clean(chosen.targetCharacterId)
      || clean(decision.action?.affordanceId) !== clean(chosen.affordanceId)) {
      errors.push(issue("CHOSEN_ACTION_CANDIDATE_MISMATCH", "decision.action", "最终动作不得偷换已选择候选的原语、对象或 affordance"));
    }
  }

  const ownedEpisodeIds = new Set((input.ownedMemory?.episodes || []).map((row) => row.id));
  for (const episodeId of decision.memoryRetrieval?.episodeIds || []) {
    if (!ownedEpisodeIds.has(episodeId)) {
      errors.push(issue("MEMORY_RETRIEVAL_NOT_OWNED", "decision.memoryRetrieval.episodeIds", `人物试图提取不存在或不属于自己的记忆 ${episodeId}`));
    }
  }

  const knownBasisIds = probeBasisIds(input);
  for (const candidateId of candidateIds) knownBasisIds.add(candidateId);
  for (const [index, consequence] of decision.expectedWorldConsequences.entries()) {
    for (const basisId of consequence.basisIds || []) {
      if (!knownBasisIds.has(clean(basisId))) {
        errors.push(issue("CONSEQUENCE_BASIS_UNKNOWN", `decision.expectedWorldConsequences[${index}].basisIds`, `预期后果引用了输入中不存在的依据 ${basisId}`));
      }
    }
  }
}

export function auditCharacterFoundationProbeInput(input = {}) {
  const errors = walkAuthoringKeys(input);
  const foundationResult = validateCharacterFoundation(input.foundation);
  if (!foundationResult.valid) {
    errors.push(...foundationResult.errors.map((entry) => issue(
      `PROBE_${entry.code}`,
      `input.foundation.${entry.path}`,
      entry.message,
    )));
  }
  if (!clean(input.probeId)) errors.push(issue("PROBE_ID_MISSING", "input.probeId", "盲测输入缺少 probeId"));
  if (!clean(input.character?.id)) errors.push(issue("PROBE_CHARACTER_ID_MISSING", "input.character.id", "盲测输入缺少人物 id"));
  if (input.foundation?.characterId && input.character?.id !== input.foundation.characterId) {
    errors.push(issue("PROBE_CHARACTER_FOUNDATION_MISMATCH", "input.foundation.characterId", "人物 id 与 foundation 不一致"));
  }
  for (const [index, episode] of (input.ownedMemory?.episodes || []).entries()) {
    if (episode.ownerCharacterId && episode.ownerCharacterId !== input.character?.id) {
      errors.push(issue("PROBE_FOREIGN_MEMORY", `input.ownedMemory.episodes[${index}]`, "人物不得读取他人的自传记忆"));
    }
  }
  for (const [index, event] of (input.world?.perceivedEvents || []).entries()) {
    if (!clean(event.id)) errors.push(issue("PROBE_EVENT_ID_MISSING", `input.world.perceivedEvents[${index}].id`, "感知事件缺少 id"));
    if (!clean(event.truthStatus)) errors.push(issue("PROBE_EVENT_TRUTH_STATUS_MISSING", `input.world.perceivedEvents[${index}].truthStatus`, "感知事件必须声明 verified 或 unverified"));
  }
  const primitiveIds = input.universalActionPrimitives?.map((row) => row.id) || [];
  if (!primitiveIds.length || primitiveIds.some((id) => !PRIMITIVE_BY_ID.has(id))) {
    errors.push(issue("PROBE_PRIMITIVES_INVALID", "input.universalActionPrimitives", "盲测只能使用通用行动原语"));
  }
  if (input.world?.spatialChoice) {
    const spatialAudit = auditEmbodiedSpatialChoiceInput({
      actorId: input.character?.id,
      ...input.world.spatialChoice,
    });
    errors.push(...spatialAudit.errors.map((entry) => issue(
      `PROBE_${entry.code}`,
      entry.path.replace(/^input/u, "input.world.spatialChoice"),
      entry.message,
    )));
    const positionAffordances = new Set((input.world?.availableAffordances || [])
      .filter((row) => row?.type === "move" && clean(row?.destinationPositionId))
      .map((row) => clean(row.destinationPositionId)));
    for (const [optionIndex, option] of (input.world.spatialChoice.positionOptions || []).entries()) {
      if (option?.available === true && !positionAffordances.has(clean(option?.id))) {
        errors.push(issue(
          "PROBE_SPATIAL_AFFORDANCE_MISSING",
          "input.world.availableAffordances",
          `可用位置 ${clean(option?.id)} 缺少对应 move affordance`,
        ));
      }
      const worldEvidenceIds = new Set([
        ...(input.world?.objectiveFacts || []).map((row) => clean(row?.id)),
        ...(input.world?.perceivedEvents || []).map((row) => clean(row?.id)),
      ]);
      for (const evidenceId of option?.socialAccess?.evidenceIds || []) {
        if (!worldEvidenceIds.has(clean(evidenceId))) {
          errors.push(issue(
            "PROBE_SPATIAL_SOCIAL_ACCESS_EVIDENCE_UNKNOWN",
            `input.world.spatialChoice.positionOptions[${optionIndex}].socialAccess.evidenceIds`,
            `社会进入条件引用了人物当前没有获得的世界依据 ${clean(evidenceId)}`,
          ));
        }
      }
    }
  }
  if (input.world?.serviceChoice) {
    const serviceAudit = auditSituatedServiceChoiceInput({
      actorId: input.character?.id,
      ...input.world.serviceChoice,
    });
    errors.push(...serviceAudit.errors.map((entry) => issue(
      `PROBE_${entry.code}`,
      entry.path.replace(/^input/u, "input.world.serviceChoice"),
      entry.message,
    )));
    const requestOfferIds = new Set((input.world?.availableAffordances || [])
      .filter((row) => row?.type === "request_service")
      .map((row) => clean(row.offeringId)));
    for (const offer of input.world.serviceChoice.offers || []) {
      if (offer?.available === true && !requestOfferIds.has(clean(offer?.id))) {
        errors.push(issue(
          "PROBE_SERVICE_AFFORDANCE_MISSING",
          "input.world.availableAffordances",
          `可用服务 ${clean(offer?.id)} 缺少对应 request_service affordance`,
        ));
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

export function buildCharacterFoundationProbeInput({
  probeId,
  character,
  foundation,
  dynamicState = {},
  ownedMemory = { episodes: [], beliefs: [], commitments: [] },
  relationshipContext = [],
  world = {},
  universalActionPrimitives = CHARACTER_FOUNDATION_PROBE_PRIMITIVES,
} = {}) {
  const input = {
    schemaVersion: 1,
    runtimeSurface: "character-foundation-blind-probe",
    probeId: clean(probeId),
    character: deepClone(character || {}),
    foundation: deepClone(foundation || {}),
    dynamicState: deepClone(dynamicState || {}),
    ownedMemory: deepClone(ownedMemory || { episodes: [], beliefs: [], commitments: [] }),
    relationshipContext: deepClone(relationshipContext || []),
    world: deepClone(world || {}),
    universalActionPrimitives: deepClone(universalActionPrimitives || CHARACTER_FOUNDATION_PROBE_PRIMITIVES),
    psychologyTool: {
      role: "character-private-appraisal-not-world-command",
      qualitativeFormula: "U(a)=desireFit+identityFit+evidenceGain+relationshipCare+bodyFit+opportunity+competenceFit+informationAccess+spatialControl+equipmentControl+proceduralFluency+needRelief+qualityFit+stayLegitimacy+informationCover+liquiditySafety-exposureCost-trafficInterference-priceBurden-resourceObligation-statusMismatch-wasteRisk-interactionExposure-serviceDelay-socialAttentionRisk-uncertaintyRisk-normCost-switchingCost",
      weightSources: [
        "foundation.stablePsychology",
        "foundation.materialEconomy",
        "foundation.competenceModel",
        "foundation.dynamicPsychology",
        "foundation.desires",
        "foundation.inhibitors",
        "foundation.epistemics",
        "foundation.relationshipModel",
        "dynamicState",
      ],
      rule: "权重范围帮助本人比较行动，不替本人选择；未校准数值只作相对强弱，不能伪造精确概率。",
    },
    ...(world?.spatialChoice ? { spatialChoiceTool: buildEmbodiedSpatialChoiceTool() } : {}),
    ...(world?.serviceChoice ? { serviceChoiceTool: buildSituatedServiceChoiceTool() } : {}),
    choiceAuthority: {
      owner: "character-agent",
      worldRole: "objective-facts-perceived-events-affordances-feasibility-consequences",
      authorAcceptanceRequired: true,
    },
  };
  const audit = auditCharacterFoundationProbeInput(input);
  if (!audit.valid) {
    const error = new TypeError(audit.errors.map((entry) => `${entry.code}@${entry.path}: ${entry.message}`).join("\n"));
    error.code = "INVALID_CHARACTER_FOUNDATION_PROBE_INPUT";
    error.issues = audit.errors;
    throw error;
  }
  return deepFreeze(input);
}

export function validateCharacterFoundationProbeDecision(input = {}, decision = {}) {
  const errors = [];
  validateProjectionCompleteness(input, decision, errors);
  const chosenCandidate = (decision.candidateComparison || []).find(
    (row) => row.candidateId === decision.chosenCandidateId,
  ) || null;
  const continuityKnownBasisIds = probeBasisIds(input);
  for (const candidate of decision.candidateComparison || []) continuityKnownBasisIds.add(candidate.candidateId);
  const foundationDesireIds = new Set((input.foundation?.desires || []).map((row) => clean(row?.id)).filter(Boolean));
  const continuityValidation = validateCharacterPostChoiceContinuityProposal(
    decision.postChoiceContinuity,
    {
      chosenCandidateId: decision.chosenCandidateId,
      chosenActionBasisIds: [chosenCandidate?.affordanceId].filter(Boolean),
      knownBasisIds: continuityKnownBasisIds,
      desireIds: foundationDesireIds,
      dynamicStateIds: Object.keys(input.dynamicState || {}),
      ownedSelfClaimIds: (input.ownedMemory?.selfNarrative?.currentClaims || []).map((row) => row?.id),
      requiredDesireIds: factorRows(decision)
        .map((row) => clean(row?.factorId))
        .filter((factorId) => foundationDesireIds.has(factorId)),
    },
  );
  errors.push(...continuityValidation.errors.map((entry) => issue(
    entry.code,
    `decision.postChoiceContinuity.${entry.path}`,
    entry.message,
  )));
  const reportEvent = perceivedEventById(input, decision.epistemicUpdate?.sourceEventId);
  const sourceIsUnverifiedReport = reportEvent && eventIsUnverifiedReport(reportEvent);
  if (!reportEvent) {
    errors.push(issue("DECISION_SOURCE_EVENT_UNKNOWN", "decision.epistemicUpdate.sourceEventId", "认识更新必须引用本人确实感知的事件"));
  }
  if (sourceIsUnverifiedReport && (
    decision.epistemicUpdate?.classification === "objective_fact"
    || decision.epistemicUpdate?.claimAcceptedAsFact === true
  )) {
    errors.push(issue("UNVERIFIED_REPORT_PROMOTED", "decision.epistemicUpdate", "未经证实的转述只能作为带来源报告或推断，不能写成客观事实"));
  }

  const relationshipEvidenceIds = decision.relationshipUpdate?.evidenceBasisIds || [];
  if (decision.relationshipUpdate?.change === "provisional_doubt" && decision.relationshipUpdate?.durable === true) {
    errors.push(issue("PROVISIONAL_RELATIONSHIP_MARKED_DURABLE", "decision.relationshipUpdate", "暂时怀疑不能同时标记为持久关系变化"));
  }
  if (decision.relationshipUpdate?.durable === true
    && decision.relationshipUpdate?.change !== "none"
    && !evidenceContainsStrongSource(input, relationshipEvidenceIds)) {
    errors.push(issue("RELATIONSHIP_DELTA_WITHOUT_EVIDENCE", "decision.relationshipUpdate", "持久负向关系变化需要直接或强佐证证据"));
  }

  if (sourceIsUnverifiedReport && decision.memoryWrite?.kind === "firsthand_episode") {
    errors.push(issue("REPORTED_EVENT_WRITTEN_AS_FIRSTHAND", "decision.memoryWrite.kind", "转述经历不得写成本人目击事实"));
  }
  if (sourceIsUnverifiedReport && !["none", "sourced_report"].includes(decision.memoryWrite?.kind)) {
    errors.push(issue("REPORTED_EVENT_LOST_SOURCE", "decision.memoryWrite.kind", "当前记忆结构无法为普通 belief 保留完整转述来源，因此未经证实的转述只能写成 sourced_report 或不写入"));
  }
  if (decision.memoryWrite?.sourceEventId && decision.memoryWrite.sourceEventId !== decision.epistemicUpdate?.sourceEventId) {
    errors.push(issue("MEMORY_SOURCE_MISMATCH", "decision.memoryWrite.sourceEventId", "记忆写入来源必须与本轮认识更新一致"));
  }

  const primitive = PRIMITIVE_BY_ID.get(decision.action?.primitiveId);
  if (!primitive || !(input.universalActionPrimitives || []).some((row) => row.id === primitive.id)) {
    errors.push(issue("ACTION_PRIMITIVE_UNKNOWN", "decision.action.primitiveId", "人物选择了未提供的行动原语"));
  }
  const perceivedIds = new Set((input.world?.perceivedCharacters || []).map((row) => row.id));
  if (decision.action?.targetCharacterId && !perceivedIds.has(decision.action.targetCharacterId)) {
    errors.push(issue("ACTION_TARGET_NOT_PERCEIVED", "decision.action.targetCharacterId", "当下行为对象不在人物可感知范围"));
  }
  if (primitive?.targetMode === "required" && !clean(decision.action?.targetCharacterId)) {
    errors.push(issue("ACTION_TARGET_REQUIRED", "decision.action.targetCharacterId", "该行动原语需要一个当前可感知对象"));
  }
  if (primitive?.targetMode === "none" && clean(decision.action?.targetCharacterId)) {
    errors.push(issue("ACTION_TARGET_FORBIDDEN", "decision.action.targetCharacterId", "该行动原语不应凭空绑定对话对象"));
  }

  const availableAffordanceIds = new Set((input.world?.availableAffordances || []).map((row) => row.id));
  if (decision.action?.affordanceId && !availableAffordanceIds.has(decision.action.affordanceId)) {
    errors.push(issue("ACTION_AFFORDANCE_UNKNOWN", "decision.action.affordanceId", "人物使用了世界未提供的 affordance"));
  }
  if (primitive?.requiresAffordance && !clean(decision.action?.affordanceId)) {
    errors.push(issue("ACTION_AFFORDANCE_REQUIRED", "decision.action.affordanceId", "需要世界条件的行动必须引用世界提供的 affordance"));
  }
  if (primitive?.allowsSpeech === false && clean(decision.action?.speech)) {
    errors.push(issue("ACTION_SPEECH_FORBIDDEN", "decision.action.speech", "该无言原语不能附加台词"));
  }
  if (decision.action?.speechAct === "none" && clean(decision.action?.speech)) {
    errors.push(issue("ACTION_SPEECH_ACT_MISMATCH", "decision.action.speechAct", "有台词时 speechAct 不能为 none"));
  }
  if (decision.action?.speechAct !== "none" && !clean(decision.action?.speech)) {
    errors.push(issue("ACTION_EMPTY_SPEECH", "decision.action.speech", "选择说话时必须真正说出内容"));
  }
  if (decision.action?.primitiveId === "request" && decision.action?.speechAct !== "request") {
    errors.push(issue("ACTION_REQUEST_SPEECH_ACT_MISMATCH", "decision.action.speechAct", "服务请求必须明确标为 request，而不是自动服务或普通陈述"));
  }
  if (EVIDENCE_SEEKING_FUTURE_MODES.has(decision.futureIntention?.mode)
    && decision.futureIntention?.knowledgeLimit !== "depends_on_future_evidence") {
    errors.push(issue("FUTURE_KNOWLEDGE_LIMIT_INVALID", "decision.futureIntention.knowledgeLimit", "尚未执行的核实意图必须明确依赖未来证据，不能预支知识"));
  }
  const knownBasisIds = probeBasisIds(input);
  const factorDefinitions = probeFactorDefinitions(input);
  for (const candidate of decision.candidateComparison || []) knownBasisIds.add(candidate.candidateId);
  for (const [index, factor] of factorRows(decision).entries()) {
    const factorPath = `decision.factorLedger.factors[${index}]`;
    const factorId = clean(factor?.factorId);
    const basisIds = (factor?.basisIds || []).map(clean).filter(Boolean);
    const requiredParameterBasisIds = factorDefinitions.get(factorId);
    if (!requiredParameterBasisIds) {
      errors.push(issue("FACTOR_ID_UNKNOWN", `${factorPath}.factorId`, `因子 ${factorId || "<empty>"} 既不是通用心理维度，也不是输入中的人格或状态参数`));
    }
    if (basisIds.length === 0) {
      errors.push(issue("FACTOR_BASIS_MISSING", `${factorPath}.basisIds`, "每个因子必须引用至少一项真实输入依据"));
    }
    for (const basisId of basisIds) {
      if (!knownBasisIds.has(clean(basisId))) {
        errors.push(issue("FACTOR_BASIS_UNKNOWN", `${factorPath}.basisIds`, `因子账本引用了输入中不存在的依据 ${basisId}`));
      }
    }
    if (requiredParameterBasisIds?.size > 0
      && !basisIds.some((basisId) => requiredParameterBasisIds.has(basisId))) {
      errors.push(issue("FACTOR_PARAMETER_BASIS_MISSING", `${factorPath}.basisIds`, `人格或状态因子 ${factorId} 必须引用它自身的 foundation/dynamic id 或 path`));
    }
  }
  if (!clean(decision.privateReason)) {
    errors.push(issue("DECISION_PRIVATE_REASON_MISSING", "decision.privateReason", "人物必须给出仅供观察者审计的简短动机摘要"));
  }
  return { valid: errors.length === 0, errors };
}

export function characterFoundationProbeSystemPrompt(input = {}) {
  return `你是一个持续生活的人物 Agent「${input.character?.name || input.character?.id || "人物"}」，不是作者、裁判或测试答题器。

你只能使用本次输入中的 foundation、dynamicState、ownedMemory、relationshipContext、world 和 universalActionPrimitives。objectiveFacts 是世界已确认事实；perceivedEvents 只是本人确实接收到的事件，其中 reported/gossip/hearsay 与 truthStatus=unverified 的内容只能先作为带来源说法，不能自动变成事实。

决定原则：
- foundation 是人格、欲望、自我威胁、阻碍、认识习惯、语言功能和关系更新边界，不是情境答案或固定行动脚本。
- competenceModel 是人物已有的感知能力、程序性知识和执行熟练度：它影响本人容易注意什么、能形成哪些可行手段以及如何完成动作，但不创造欲望、不保证永不犯错，也不替本人选位置或行动。
- psychologyTool 是人物本人的心理工具：用相对权重比较欲望、身份、证据、关系、身体、机会、能力、空间、需要缓解、停留正当性、财富来源、实际钱包、价格负担、品质匹配、浪费风险、身份展示、互动暴露、服务等待、社会注意与切换代价；它不能替你决定，也不能假装未校准范围是精确概率。
- 先由你本人从通用行动原语和世界 affordance 形成可行手段，再选择一次当下行动。不要因为某项数学压力最高就假装别的可行选择不存在。
- 记忆必须属于本人并保留来源。别人说“听说”只证明对方说过，不证明转述内容为真；不能把 reported 记忆写成 firsthand。
- 关系可因怀疑产生暂时张力，但持久负向变化需要直接或强佐证证据。不要凭一句传闻抹掉既有第一手关系经验。
- world 只提供当前能做什么、不能做什么和物理后果。未来路线若尚未发生，只能写成有触发条件的意图，不能声称已经观察、问到或确认。
- action.targetCharacterId 必须来自 perceivedCharacters；移动、离场和服务请求必须引用 availableAffordances。可以请求服务、说话、观察、继续手头事务、等待、移动、离开或本次不公开行动；不需要为了回答测试而硬说话。
- 每个原语的 targetMode 是动作对象合同：required 必须填写当前可感知人物，optional 仅在动作确实针对该人物时填写，none 必须把 targetCharacterId 留空。提出请求的人、事件来源或受益者不会自动成为动作对象；interact 的物件由 affordanceId 表达，continue、move、leave、wait、pass 都不绑定人物。
- 若 world.spatialChoice 存在，位置是人物本轮行动而不是场景预设。世界只给出可用位置的视听、人流、暴露、活动空间与物件净空；你必须结合当前目的、性格、职业能力、身体状态和随身物件形成多个候选，再由自己选择。不得把某个位置当成世界推荐答案。
- spatialChoice 中 available=true 只表示当前至少能物理尝试移动，不等于合理、获准或值得选择。若 socialAccess 显示需要许可但尚未获得，保留该移动为可尝试候选，同时评价 normCost、暴露与可能后果；不要把可能的询问、警告或干预写成已经发生，其他人物仍需先感知再自行行动。
- 若 world.serviceChoice 存在，商品类别、份量、可感知品质、价格、库存、本人身体需要、实际钱包、财富来源、经济义务、消费倾向和占桌惯例都只是可评价条件。由你决定是否点单、点哪一档、询价、先选位置、暂不消费或离开；“最贵”本身既不是推荐答案，也不自动等于最适合。request 只产生待经营者回应的请求，不得直接写成已经端茶、吃饭、扣钱或结账；坐下不消费仍可尝试，经营者是否招呼必须由其之后感知并自行行动。
- carriedObjects 中 attachment.active=true 的物件仍贴附在人物身上。人物移动不会让它离身；解除附着、放置或转交必须分别有明确 affordance 和提交动作，不能在 visibleAction 中偷渡状态变化。
- futureIntention.targetCharacterId 只在未来意图确实针对当前可感知人物时填写；一般观察环境、等待未知线索或继续事务应留空。
- speech 只写真正说出口的话，visibleAction 只写别人能看到的身体动作。privateReason 和 factorLedger 只给观察者看，不对其他人物公开。
- 不要输出长篇思维过程；factorLedger 只列可审计的因子、方向、相对强度与输入依据。
- factorLedger.factorId 只能使用 user prompt 列出的 allowedFactorIds。它们包括通用心理、空间与服务维度，或输入中的人格/状态参数 id/path。人格参数作为 factorId 时，basisIds 必须同时引用该参数自身的 foundation id/path；状态参数同样必须引用自己的 dynamic id/path，不能只用现场事实冒充来源。
- perceivedFacts 中的 objective、firsthand_memory、sourced_report 行必须逐字复制输入里的 canonical id，并在 basisIds 至少重复该 id；不得另造 pf:、fact_alias: 等展示别名。人物自己的新结论才可标为 inference，使用非空的 inference:* id，并在 basisIds 逐项列出支撑它的真实输入 id。
- candidateComparison 至少给出两个由通用原语形成的可行或可尝试候选，再用 chosenCandidateId 选择其一。
- memoryRetrieval 只能引用 ownedMemory 中真实存在的 episode；expectedWorldConsequences 只写当前动作会直接造成、可能造成或仍取决于未来条件的后果，不得把未核实内容写成结果。
- postChoiceContinuity 只写人物对“如果本次动作被世界成功提交”之后心理连续性的定性提案，phase 必须是 pending_world_resolution；它不能提前写回状态，也不能把预想结果冒充已经发生。
- meaningful 或 consequential 选择必须请求在提交后编码本人的行动记忆；本轮使用过的基础欲望必须说明是未受影响、仍未满足、待证实进展或待证实解决。压住、拖延、拒绝某条手段都不自动满足欲望。
- 欲望与动态状态还必须声明 settlementCondition：动作本身造成的心理余波可等 action_committed；预期收益造成的变化必须等 verified_progress / verified_resolution 及其 linkedDesireId。动作做了不等于收益已经发生。
- dynamicStateContinuity 只能引用输入中已经存在的动态状态 id。selfNarrative 只能提出 none、强化、冲突或修订候选；重大修订仍须等待世界提交、客观后果显著度和本人拥有的 self_action episode，不能在选择前永久改写人格。
- selfNarrative.mode 为 none 时，proposedClaim 必须为空，replacesClaimIds 与 basisIds 必须是空数组，significanceBand 与 permanenceBand 使用 low，consolidationStatus 必须为 not_applicable；普通动作不得暗藏身份改写。
- futureIntention.mode 为 observe、ask、seek_evidence、approach 或 wait_for_condition 时，knowledgeLimit 必须是 depends_on_future_evidence；未来意图不得把尚未获得的知识写成已有知识。
- ownedMemory episode 的 source.kind 或 sourceType 若为 firsthand、direct、self_action 或相应前缀（如 firsthand_self_action），perceivedFacts.status 应为 firsthand_memory；带 reported、gossip、hearsay、rumor 来源的本人记忆才是 sourced_report。
- 这里只生成一次未见投射，不自动写回人物底座、正式记忆或关系。作者仍需决定是否接受。

只输出符合 schema 的 JSON。`;
}

export function characterFoundationProbeUserPrompt(input = {}) {
  const canonicalPerceivedFactIds = {
    objectiveFactIds: (input.world?.objectiveFacts || []).map((row) => row.id),
    perceivedEventIds: (input.world?.perceivedEvents || []).map((row) => row.id),
    ownedEpisodeIds: (input.ownedMemory?.episodes || []).map((row) => row.id),
  };
  const allowedFactorIds = [...probeFactorDefinitions(input).keys()];
  return `这是人物此刻拥有的全部输入：\n${JSON.stringify(input, null, 2)}\n\nperceivedFacts 可逐字引用的 canonical ids：\n${JSON.stringify(canonicalPerceivedFactIds, null, 2)}\n外部输入行不得改名；人物推断另用 inference:* 并引用上述 ids 作为 basisIds。\n\nfactorLedger 可用的 factorId：\n${JSON.stringify(allowedFactorIds, null, 2)}\n人格/状态参数作为 factorId 时，basisIds 还必须引用它自身的 id 或 path。\n\n请由人物本人完成一次选择。`;
}

export async function runCharacterFoundationBlindProbe(input, { signal, model } = {}) {
  const audit = auditCharacterFoundationProbeInput(input);
  if (!audit.valid) {
    const error = new TypeError(audit.errors.map((entry) => `${entry.code}@${entry.path}: ${entry.message}`).join("\n"));
    error.code = "INVALID_CHARACTER_FOUNDATION_PROBE_INPUT";
    error.issues = audit.errors;
    throw error;
  }
  const { parsed, meta } = await callOpenAIJson({
    system: characterFoundationProbeSystemPrompt(input),
    user: characterFoundationProbeUserPrompt(input),
    schema: characterFoundationProbeDecisionSchema,
    schemaName: "character_foundation_blind_probe_decision",
    schemaHintMode: "full",
    model,
    signal,
  });
  const decisionValidation = validateCharacterFoundationProbeDecision(input, parsed);
  if (!decisionValidation.valid) {
    const error = new TypeError(decisionValidation.errors.map((entry) => `${entry.code}@${entry.path}: ${entry.message}`).join("\n"));
    error.code = "CHARACTER_FOUNDATION_PROBE_DECISION_REJECTED";
    error.issues = decisionValidation.errors;
    error.decision = parsed;
    error.meta = meta;
    throw error;
  }
  return {
    probeId: input.probeId,
    characterId: input.character?.id || "",
    decision: parsed,
    audit,
    decisionValidation,
    meta,
    authorAcceptance: "pending",
  };
}
