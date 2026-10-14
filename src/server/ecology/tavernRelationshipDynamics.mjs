export const TAVERN_RELATIONSHIP_DYNAMICS_VERSION = 2;

export const TAVERN_RELATIONSHIP_METRICS = Object.freeze([
  "love",
  "attraction",
  "resentment",
  "fear",
  "dependence",
  "power",
  "shame",
  "jealousy",
  "protection",
  "revenge",
  "deception",
  "wantsToBeSeen",
  "wantsToPossess",
  "wantsToEscape",
  "wantsToDestroy",
]);

const RELATIONSHIP_APPRAISAL_MODES = Object.freeze(["none", "provisional", "retained"]);
const RELATIONSHIP_APPRAISAL_DIRECTIONS = Object.freeze(["increase", "decrease"]);
const RELATIONSHIP_APPRAISAL_STRENGTHS = Object.freeze(["low", "medium", "high"]);
const RELATIONSHIP_APPRAISAL_DELTA = Object.freeze({ low: 1, medium: 3, high: 6 });

export const tavernCharacterRelationshipAppraisalSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["phase", "targetCharacterId", "sourceImpactIds", "changeMode", "dimensionChanges", "reason"],
  properties: {
    phase: { type: "string", enum: ["pending_perception_appraisal"] },
    targetCharacterId: { type: "string", description: "本人正在形成关系判断的对象；没有关系更新时可为空" },
    sourceImpactIds: {
      type: "array",
      maxItems: 8,
      items: { type: "string" },
      description: "只引用本人本轮确实感知或记住的 impact id",
    },
    changeMode: {
      type: "string",
      enum: [...RELATIONSHIP_APPRAISAL_MODES],
      description: "none 不改变；provisional 只进入本人暂时印象；retained 才改变持久关系维度",
    },
    dimensionChanges: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["metric", "direction", "strengthBand"],
        properties: {
          metric: { type: "string", enum: [...TAVERN_RELATIONSHIP_METRICS] },
          direction: { type: "string", enum: [...RELATIONSHIP_APPRAISAL_DIRECTIONS] },
          strengthBand: { type: "string", enum: [...RELATIONSHIP_APPRAISAL_STRENGTHS] },
        },
      },
    },
    reason: { type: "string", description: "只属于本人的关系解释；不作为公开台词" },
  },
});

const OUTCOME_KIND_ALIASES = Object.freeze({
  nonverbal_protection: "protect",
  protection: "protect",
  protected: "protect",
  assistance: "assist",
  assisted: "assist",
  help: "assist",
  commitment_fulfilled: "fulfill",
  fulfilled: "fulfill",
  betrayal: "betray",
  betrayed: "betray",
  coercion: "coerce",
  coerced: "coerce",
  ignored: "ignore",
  ignored_direct_request: "ignore",
});

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, clone(nested)]));
  }
  return value;
}

function clamp(value, min = 0, max = 100) {
  const numeric = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(numeric) ? numeric : 0));
}

function text(value = "") {
  return String(value || "").trim();
}

function unique(values = []) {
  return [...new Set((values || []).map(text).filter(Boolean))];
}

export function noOpTavernCharacterRelationshipAppraisal() {
  return {
    phase: "pending_perception_appraisal",
    targetCharacterId: "",
    sourceImpactIds: [],
    changeMode: "none",
    dimensionChanges: [],
    reason: "",
  };
}

export function validateTavernCharacterRelationshipAppraisal(proposal = {}, context = {}) {
  const errors = [];
  const perceivedCharacterIds = new Set(context.perceivedCharacterIds || []);
  const perceivedImpactIds = new Set(context.perceivedImpactIds || []);
  const impactsById = new Map((context.perceivedImpacts || []).map((impact) => [impact.impactId || impact.id, impact]));
  const targetCharacterId = text(proposal.targetCharacterId);
  const sourceImpactIds = unique(proposal.sourceImpactIds || []);
  const changes = Array.isArray(proposal.dimensionChanges) ? proposal.dimensionChanges : [];
  if (proposal.phase !== "pending_perception_appraisal") {
    errors.push({ code: "RELATIONSHIP_APPRAISAL_PHASE_INVALID", field: "relationshipAppraisal.phase", message: "人物只能提交等待关系结算的主观评价。" });
  }
  if (!RELATIONSHIP_APPRAISAL_MODES.includes(proposal.changeMode)) {
    errors.push({ code: "RELATIONSHIP_APPRAISAL_MODE_INVALID", field: "relationshipAppraisal.changeMode", message: "未知的关系评价保留方式。" });
  }
  if (targetCharacterId && !perceivedCharacterIds.has(targetCharacterId)) {
    errors.push({ code: "RELATIONSHIP_APPRAISAL_TARGET_NOT_PERCEIVED", field: "relationshipAppraisal.targetCharacterId", message: "人物不能在本轮评价一个既未感知也不在关系上下文中的对象。" });
  }
  for (const sourceImpactId of sourceImpactIds) {
    if (!perceivedImpactIds.has(sourceImpactId)) {
      errors.push({ code: "RELATIONSHIP_APPRAISAL_SOURCE_UNKNOWN", field: "relationshipAppraisal.sourceImpactIds", message: `关系评价引用了本人未感知的影响 ${sourceImpactId}。` });
    }
  }
  if (proposal.changeMode === "none" && changes.length) {
    errors.push({ code: "RELATIONSHIP_APPRAISAL_NONE_WITH_CHANGES", field: "relationshipAppraisal.dimensionChanges", message: "changeMode=none 时不能同时声明关系变化。" });
  }
  if (proposal.changeMode !== "none" && (!targetCharacterId || !sourceImpactIds.length || !changes.length)) {
    errors.push({ code: "RELATIONSHIP_APPRAISAL_EVIDENCE_REQUIRED", field: "relationshipAppraisal", message: "暂时或持久关系评价必须有对象、本人感知来源和具体维度。" });
  }
  const seenMetrics = new Set();
  for (const [index, change] of changes.entries()) {
    if (!TAVERN_RELATIONSHIP_METRICS.includes(change?.metric)) {
      errors.push({ code: "RELATIONSHIP_APPRAISAL_METRIC_INVALID", field: `relationshipAppraisal.dimensionChanges[${index}].metric`, message: "关系评价使用了运行层不存在的维度。" });
    }
    if (seenMetrics.has(change?.metric)) {
      errors.push({ code: "RELATIONSHIP_APPRAISAL_METRIC_DUPLICATE", field: `relationshipAppraisal.dimensionChanges[${index}].metric`, message: "同一关系维度一轮只能更新一次。" });
    }
    seenMetrics.add(change?.metric);
    if (!RELATIONSHIP_APPRAISAL_DIRECTIONS.includes(change?.direction)) {
      errors.push({ code: "RELATIONSHIP_APPRAISAL_DIRECTION_INVALID", field: `relationshipAppraisal.dimensionChanges[${index}].direction`, message: "未知的关系变化方向。" });
    }
    if (!RELATIONSHIP_APPRAISAL_STRENGTHS.includes(change?.strengthBand)) {
      errors.push({ code: "RELATIONSHIP_APPRAISAL_STRENGTH_INVALID", field: `relationshipAppraisal.dimensionChanges[${index}].strengthBand`, message: "未知的关系变化强度。" });
    }
  }
  if (proposal.changeMode === "retained") {
    const hasFirsthandTargetEvidence = sourceImpactIds.some((sourceImpactId) => {
      const impact = impactsById.get(sourceImpactId) || {};
      const provenanceKind = text(impact.provenance?.kind).toLowerCase();
      const roleIds = Object.values(impact.semanticFrame?.roles || {});
      return (impact.sourceCharacterId === targetCharacterId || roleIds.includes(targetCharacterId))
        && !["gossip", "reported", "sourced_report"].includes(provenanceKind);
    });
    if (!hasFirsthandTargetEvidence) {
      errors.push({ code: "RELATIONSHIP_APPRAISAL_RETAINED_WITHOUT_FIRSTHAND_EVIDENCE", field: "relationshipAppraisal.changeMode", message: "持久关系变化至少需要一项本人直接感知、且确实关于该对象的证据。" });
    }
  }
  return { valid: errors.length === 0, errors };
}

export function tavernRelationshipDeltasFromCharacterAppraisal(proposal = {}) {
  if (proposal.changeMode !== "retained") return {};
  return Object.fromEntries((proposal.dimensionChanges || []).map((change) => {
    const magnitude = RELATIONSHIP_APPRAISAL_DELTA[change.strengthBand] || 0;
    return [change.metric, change.direction === "decrease" ? -magnitude : magnitude];
  }).filter(([metric, delta]) => TAVERN_RELATIONSHIP_METRICS.includes(metric) && delta));
}

function relationshipsFrom(stateOrList) {
  if (Array.isArray(stateOrList)) return stateOrList;
  return Array.isArray(stateOrList?.relationships) ? stateOrList.relationships : [];
}

/**
 * A relationship is directional: `fromCharacterId` is the person whose stance
 * is stored, and `toCharacterId` is the person that stance is about. This
 * intentionally never falls back to the reverse record.
 */
export function getDirectedRelationship(stateOrList, fromCharacterId, toCharacterId) {
  return relationshipsFrom(stateOrList).find((relationship) => (
    relationship?.fromCharacterId === fromCharacterId
    && relationship?.toCharacterId === toCharacterId
  )) || null;
}

/** Apply one directional numeric delta without mutating the relationship. */
export function applyDirectionalRelationshipDelta(relationship = {}, delta = {}) {
  const next = clone(relationship || {});
  const source = delta?.deltas && typeof delta.deltas === "object" ? delta.deltas : delta;
  for (const metric of TAVERN_RELATIONSHIP_METRICS) {
    if (!Object.prototype.hasOwnProperty.call(source || {}, metric)) continue;
    next[metric] = clamp(Number(next[metric] || 0) + Number(source[metric] || 0));
  }
  return next;
}

function actionWasCommitted(action, outcome) {
  if (action?.committed === true || action?.executed === true || outcome?.applied === true) return true;
  const status = text(outcome?.status || action?.status).toLowerCase();
  return ["committed", "applied", "executed", "completed", "success", "succeeded"].includes(status);
}

function evidenceRecords(action, outcome) {
  return [
    ...(Array.isArray(action?.relationshipEvidence) ? action.relationshipEvidence : []),
    ...(Array.isArray(outcome?.relationshipEvidence) ? outcome.relationshipEvidence : []),
    ...(Array.isArray(outcome?.verifiedRelationshipOutcomes) ? outcome.verifiedRelationshipOutcomes : []),
  ].filter((entry) => entry && typeof entry === "object");
}

function normalizedOutcomeKind(evidence = {}) {
  const raw = text(evidence.kind || evidence.type || evidence.outcomeKind || evidence.effectKind).toLowerCase();
  return OUTCOME_KIND_ALIASES[raw] || raw || "explicit";
}

function evidenceMatchesAction(evidence, action) {
  const sourceActionId = text(evidence.sourceActionId);
  const actorId = text(evidence.actorCharacterId || evidence.sourceCharacterId);
  return evidence.verified === true
    && (!sourceActionId || sourceActionId === action.id)
    && (!actorId || actorId === action.actorId);
}

function explicitEvidenceDeltas(evidence = {}) {
  return Object.fromEntries(Object.entries(evidence.deltas || {}).filter(([metric, delta]) => (
    TAVERN_RELATIONSHIP_METRICS.includes(metric)
    && Number.isFinite(Number(delta))
    && Number(delta) !== 0
  )).map(([metric, delta]) => [metric, Number(delta)]));
}

function addDeltas(target, deltas) {
  for (const [metric, delta] of Object.entries(deltas || {})) {
    if (!TAVERN_RELATIONSHIP_METRICS.includes(metric) || !Number.isFinite(Number(delta))) continue;
    target[metric] = Number(((target[metric] || 0) + Number(delta)).toFixed(3));
  }
}

function addShift(byDirection, {
  fromCharacterId,
  toCharacterId,
  deltas,
  sourceActionId,
  sourceOutcomeId = "",
  evidenceId = "",
  rule,
}) {
  if (!fromCharacterId || !toCharacterId || fromCharacterId === toCharacterId) return;
  const key = `${fromCharacterId}->${toCharacterId}`;
  const shift = byDirection.get(key) || {
    fromCharacterId,
    toCharacterId,
    deltas: {},
    sourceActionId,
    sourceOutcomeId,
    evidenceIds: [],
    rules: [],
    provenance: { sourceActionId, sourceOutcomeId },
  };
  addDeltas(shift.deltas, deltas);
  if (evidenceId && !shift.evidenceIds.includes(evidenceId)) shift.evidenceIds.push(evidenceId);
  if (rule && !shift.rules.includes(rule)) shift.rules.push(rule);
  byDirection.set(key, shift);
}

/**
 * Converts a recipient Character Agent's verified appraisal into a directional
 * relationship shift. Physical delivery is only evidence available to that
 * person; speech acts and world outcomes never choose the person's feeling.
 */
export function deriveRelationshipDeltas({ action = {}, outcome = {} } = {}) {
  const actorId = text(action.actorId || action.characterId);
  const targetId = text(action.targetCharacterId || action.targetId);
  const committed = Boolean(actorId && actionWasCommitted(action, outcome));
  const byDirection = new Map();
  const appliedRules = [];
  const rejectedEvidence = [];

  if (committed) {
    for (const evidence of evidenceRecords(action, outcome)) {
      if (evidence.authority !== "recipient-character-agent") {
        rejectedEvidence.push({ id: evidence.id || "", reason: "recipient-character-agent-appraisal-required" });
        continue;
      }
      const kind = normalizedOutcomeKind(evidence);
      if (!evidenceMatchesAction(evidence, action)) {
        rejectedEvidence.push({ id: evidence.id || "", reason: "unverified-or-wrong-source" });
        continue;
      }
      const observerId = text(
        evidence.observerCharacterId
        || evidence.recipientCharacterId
        || evidence.targetCharacterId
        || action.targetCharacterId,
      );
      const sourceActorId = text(evidence.actorCharacterId || evidence.sourceCharacterId || actorId);
      const witnessed = (evidence.witnessedByCharacterIds || outcome.receivedByCharacterIds || []);
      if (!observerId || !sourceActorId || (witnessed.length && !witnessed.includes(observerId))) {
        rejectedEvidence.push({ id: evidence.id || "", reason: "recipient-did-not-receive-evidence" });
        continue;
      }
      const deltas = explicitEvidenceDeltas(evidence);
      if (!Object.keys(deltas).length) {
        rejectedEvidence.push({ id: evidence.id || "", reason: "character-appraisal-deltas-missing" });
        continue;
      }
      addShift(byDirection, {
        fromCharacterId: observerId,
        toCharacterId: sourceActorId,
        deltas,
        sourceActionId: action.id || "",
        sourceOutcomeId: outcome.id || "",
        evidenceId: evidence.id || "",
        rule: `character-appraisal:${kind}`,
      });
      appliedRules.push(`character-appraisal:${kind}`);
    }
  }

  const shifts = [...byDirection.values()];
  return {
    shifts,
    observerTrace: {
      schemaVersion: 1,
      dynamicsVersion: TAVERN_RELATIONSHIP_DYNAMICS_VERSION,
      visibility: "observer-only",
      excludedFromAgentMemory: true,
      sourceActionId: action.id || "",
      sourceOutcomeId: outcome.id || "",
      committed,
      actorCharacterId: actorId,
      targetCharacterId: targetId,
      appliedRules,
      rejectedEvidence,
      directionsChanged: shifts.map((shift) => `${shift.fromCharacterId}->${shift.toCharacterId}`),
    },
  };
}
