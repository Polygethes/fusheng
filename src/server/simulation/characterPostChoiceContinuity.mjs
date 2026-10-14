import {
  normalizeCharacterAgentMemoryState,
  reviseCharacterSelfNarrative,
} from "../../engine/characterAgentMemory.js";

export const CHARACTER_POST_CHOICE_CONTINUITY_VERSION = 1;

const CHOICE_SIGNIFICANCE = new Set(["ordinary", "meaningful", "consequential"]);
const MEMORY_MODES = new Set(["none", "encode_if_committed"]);
const DESIRE_STATUSES = new Set([
  "unaffected",
  "remains_unresolved",
  "progress_if_verified",
  "resolve_if_verified",
]);
const DIRECTIONS = new Set(["decrease", "stable", "increase"]);
const STRENGTH_BANDS = new Set(["low", "medium", "high"]);
const DESIRE_SETTLEMENT_CONDITIONS = new Set(["action_committed", "verified_progress", "verified_resolution"]);
const DYNAMIC_SETTLEMENT_CONDITIONS = new Set([
  "action_committed",
  "verified_desire_progress",
  "verified_desire_resolution",
]);
const SELF_NARRATIVE_MODES = new Set([
  "none",
  "reinforcement_candidate",
  "conflict_candidate",
  "revision_candidate",
]);

const PRESSURE_DELTA = Object.freeze({ low: 0.025, medium: 0.06, high: 0.1 });
const DYNAMIC_DELTA = Object.freeze({ low: 0.03, medium: 0.07, high: 0.12 });
const SIGNIFICANCE_VALUE = Object.freeze({ low: 0.38, medium: 0.62, high: 0.86 });

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

export const characterPostChoiceContinuityProposalSchema = deepFreeze({
  type: "object",
  additionalProperties: false,
  required: [
    "phase",
    "choiceSignificance",
    "actionMemory",
    "desireContinuity",
    "dynamicStateContinuity",
    "selfNarrative",
  ],
  properties: {
    phase: { type: "string", enum: ["pending_world_resolution"] },
    choiceSignificance: { type: "string", enum: [...CHOICE_SIGNIFICANCE] },
    actionMemory: {
      type: "object",
      additionalProperties: false,
      required: ["mode", "content", "basisIds"],
      properties: {
        mode: { type: "string", enum: [...MEMORY_MODES] },
        content: { type: "string" },
        basisIds: {
          type: "array",
          maxItems: 8,
          description: "请求行动记忆时，必须引用所选 candidate id；若所选行动具有唯一世界 affordance，也可引用该 affordance id 作为同一行动的客观依据。",
          items: { type: "string" },
        },
      },
    },
    desireContinuity: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["desireId", "status", "pressureDirection", "strengthBand", "settlementCondition", "reason", "basisIds"],
        properties: {
          desireId: { type: "string" },
          status: { type: "string", enum: [...DESIRE_STATUSES] },
          pressureDirection: { type: "string", enum: [...DIRECTIONS] },
          strengthBand: { type: "string", enum: [...STRENGTH_BANDS] },
          settlementCondition: { type: "string", enum: [...DESIRE_SETTLEMENT_CONDITIONS] },
          reason: { type: "string" },
          basisIds: { type: "array", minItems: 1, maxItems: 8, items: { type: "string" } },
        },
      },
    },
    dynamicStateContinuity: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["stateId", "direction", "strengthBand", "settlementCondition", "linkedDesireId", "reason", "basisIds"],
        properties: {
          stateId: { type: "string" },
          direction: { type: "string", enum: [...DIRECTIONS] },
          strengthBand: { type: "string", enum: [...STRENGTH_BANDS] },
          settlementCondition: { type: "string", enum: [...DYNAMIC_SETTLEMENT_CONDITIONS] },
          linkedDesireId: { type: "string" },
          reason: { type: "string" },
          basisIds: { type: "array", minItems: 1, maxItems: 8, items: { type: "string" } },
        },
      },
    },
    selfNarrative: {
      type: "object",
      additionalProperties: false,
      required: [
        "mode",
        "proposedClaim",
        "replacesClaimIds",
        "significanceBand",
        "permanenceBand",
        "basisIds",
        "consolidationStatus",
      ],
      properties: {
        mode: {
          type: "string",
          enum: [...SELF_NARRATIVE_MODES],
          description: "none 表示本轮没有身份叙事候选，此时 proposedClaim、replacesClaimIds、basisIds 必须为空且 consolidationStatus 为 not_applicable。",
        },
        proposedClaim: { type: "string" },
        replacesClaimIds: { type: "array", maxItems: 8, items: { type: "string" } },
        significanceBand: { type: "string", enum: [...STRENGTH_BANDS] },
        permanenceBand: { type: "string", enum: [...STRENGTH_BANDS] },
        basisIds: {
          type: "array",
          maxItems: 8,
          description: "仅非 none 的身份叙事候选可携带依据；none 必须使用空数组。",
          items: { type: "string" },
        },
        consolidationStatus: {
          type: "string",
          enum: ["not_applicable", "pending_committed_owned_episode"],
        },
      },
    },
  },
});

function clone(value) {
  if (value === undefined) return undefined;
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function clean(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function clamp01(value, fallback = 0) {
  const number = Number(value);
  return Math.max(0, Math.min(1, Number.isFinite(number) ? number : fallback));
}

function unique(values = []) {
  return [...new Set((values || []).map(clean).filter(Boolean))];
}

function asSet(value) {
  if (value instanceof Set) return new Set([...value].map(clean).filter(Boolean));
  return new Set((value || []).map(clean).filter(Boolean));
}

function issue(code, path, message, evidence = undefined) {
  return { code, path, message, ...(evidence === undefined ? {} : { evidence }) };
}

function validateBasisIds(rows, knownBasisIds, errors, pathPrefix) {
  rows.forEach((row, index) => {
    const basisIds = unique(row?.basisIds || []);
    if (!basisIds.length) {
      errors.push(issue("CONTINUITY_BASIS_MISSING", `${pathPrefix}[${index}].basisIds`, "A continuity update needs at least one owned or perceived basis."));
    }
    for (const basisId of basisIds) {
      if (knownBasisIds.size && !knownBasisIds.has(basisId)) {
        errors.push(issue("CONTINUITY_BASIS_UNKNOWN", `${pathPrefix}[${index}].basisIds`, `Unknown continuity basis ${basisId}.`));
      }
    }
  });
}

/**
 * Validates a Character Agent's qualitative post-choice proposal. The proposal
 * is not a state mutation: the world must still commit and resolve the action.
 */
export function validateCharacterPostChoiceContinuityProposal(proposal = {}, context = {}) {
  const errors = [];
  const chosenCandidateId = clean(context.chosenCandidateId);
  const chosenActionBasisIds = asSet(context.chosenActionBasisIds);
  const knownBasisIds = asSet(context.knownBasisIds);
  if (chosenCandidateId) {
    knownBasisIds.add(chosenCandidateId);
    chosenActionBasisIds.add(chosenCandidateId);
  }
  for (const basisId of chosenActionBasisIds) knownBasisIds.add(basisId);
  const desireIds = asSet(context.desireIds);
  const dynamicStateIds = asSet(context.dynamicStateIds);
  const ownedSelfClaimIds = asSet(context.ownedSelfClaimIds);
  const requiredDesireIds = asSet(context.requiredDesireIds);

  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) {
    return { valid: false, errors: [issue("CONTINUITY_PROPOSAL_MISSING", "postChoiceContinuity", "Post-choice continuity must be an object.")] };
  }
  if (proposal.phase !== "pending_world_resolution") {
    errors.push(issue("CONTINUITY_PHASE_NOT_PENDING", "phase", "A Character Agent can only propose changes before world resolution."));
  }
  if (!CHOICE_SIGNIFICANCE.has(proposal.choiceSignificance)) {
    errors.push(issue("CONTINUITY_SIGNIFICANCE_INVALID", "choiceSignificance", "Unknown choice significance band."));
  }

  const memory = proposal.actionMemory || {};
  if (!MEMORY_MODES.has(memory.mode)) {
    errors.push(issue("CONTINUITY_MEMORY_MODE_INVALID", "actionMemory.mode", "Unknown action-memory mode."));
  }
  if (["meaningful", "consequential"].includes(proposal.choiceSignificance) && memory.mode !== "encode_if_committed") {
    errors.push(issue("CONTINUITY_MEANINGFUL_CHOICE_MEMORY_MISSING", "actionMemory.mode", "A meaningful choice must request encoding if the action commits."));
  }
  if (memory.mode === "encode_if_committed") {
    if (!clean(memory.content)) errors.push(issue("CONTINUITY_ACTION_MEMORY_EMPTY", "actionMemory.content", "Requested action memory needs content."));
    const memoryBasisIds = new Set((memory.basisIds || []).map(clean).filter(Boolean));
    if (chosenCandidateId && ![...chosenActionBasisIds].some((basisId) => memoryBasisIds.has(basisId))) {
      errors.push(issue(
        "CONTINUITY_ACTION_MEMORY_CHOICE_BASIS_MISSING",
        "actionMemory.basisIds",
        "Action memory must cite the chosen candidate or its unique chosen affordance.",
      ));
    }
    validateBasisIds([memory], knownBasisIds, errors, "actionMemory");
  }

  const desires = Array.isArray(proposal.desireContinuity) ? proposal.desireContinuity : [];
  if (!desires.length) errors.push(issue("CONTINUITY_DESIRE_ROWS_MISSING", "desireContinuity", "At least one owned desire must be accounted for."));
  const seenDesires = new Set();
  for (const [index, row] of desires.entries()) {
    const path = `desireContinuity[${index}]`;
    const desireId = clean(row.desireId);
    if (!desireIds.has(desireId)) errors.push(issue("CONTINUITY_DESIRE_UNKNOWN", `${path}.desireId`, `Unknown desire ${desireId}.`));
    if (seenDesires.has(desireId)) errors.push(issue("CONTINUITY_DESIRE_DUPLICATE", `${path}.desireId`, `Desire ${desireId} appears more than once.`));
    seenDesires.add(desireId);
    if (!DESIRE_STATUSES.has(row.status)) errors.push(issue("CONTINUITY_DESIRE_STATUS_INVALID", `${path}.status`, "Unknown desire-continuity status."));
    if (!DIRECTIONS.has(row.pressureDirection)) errors.push(issue("CONTINUITY_DIRECTION_INVALID", `${path}.pressureDirection`, "Unknown pressure direction."));
    if (!STRENGTH_BANDS.has(row.strengthBand)) errors.push(issue("CONTINUITY_STRENGTH_INVALID", `${path}.strengthBand`, "Unknown pressure strength band."));
    if (!DESIRE_SETTLEMENT_CONDITIONS.has(row.settlementCondition)) {
      errors.push(issue("CONTINUITY_SETTLEMENT_CONDITION_INVALID", `${path}.settlementCondition`, "Unknown desire settlement condition."));
    }
    if (row.status === "progress_if_verified" && row.settlementCondition !== "verified_progress") {
      errors.push(issue("CONTINUITY_PROGRESS_WITHOUT_VERIFICATION", `${path}.settlementCondition`, "Projected progress must wait for verified progress evidence."));
    }
    if (row.status === "resolve_if_verified" && row.settlementCondition !== "verified_resolution") {
      errors.push(issue("CONTINUITY_RESOLUTION_WITHOUT_VERIFICATION", `${path}.settlementCondition`, "Projected resolution must wait for verified resolution evidence."));
    }
    if (!clean(row.reason)) errors.push(issue("CONTINUITY_REASON_MISSING", `${path}.reason`, "A desire update needs a private appraisal reason."));
  }
  validateBasisIds(desires, knownBasisIds, errors, "desireContinuity");
  for (const desireId of requiredDesireIds) {
    if (!seenDesires.has(desireId)) {
      errors.push(issue("CONTINUITY_ACTIVE_DESIRE_OMITTED", "desireContinuity", `Active desire ${desireId} was used in choice appraisal but omitted from continuity.`));
    }
  }

  const dynamicRows = Array.isArray(proposal.dynamicStateContinuity) ? proposal.dynamicStateContinuity : [];
  const seenStates = new Set();
  for (const [index, row] of dynamicRows.entries()) {
    const path = `dynamicStateContinuity[${index}]`;
    const stateId = clean(row.stateId);
    if (!dynamicStateIds.has(stateId)) errors.push(issue("CONTINUITY_DYNAMIC_STATE_UNKNOWN", `${path}.stateId`, `Unknown dynamic state ${stateId}.`));
    if (seenStates.has(stateId)) errors.push(issue("CONTINUITY_DYNAMIC_STATE_DUPLICATE", `${path}.stateId`, `Dynamic state ${stateId} appears more than once.`));
    seenStates.add(stateId);
    if (!DIRECTIONS.has(row.direction)) errors.push(issue("CONTINUITY_DIRECTION_INVALID", `${path}.direction`, "Unknown dynamic-state direction."));
    if (!STRENGTH_BANDS.has(row.strengthBand)) errors.push(issue("CONTINUITY_STRENGTH_INVALID", `${path}.strengthBand`, "Unknown dynamic-state strength band."));
    if (!DYNAMIC_SETTLEMENT_CONDITIONS.has(row.settlementCondition)) {
      errors.push(issue("CONTINUITY_SETTLEMENT_CONDITION_INVALID", `${path}.settlementCondition`, "Unknown dynamic-state settlement condition."));
    }
    const linkedDesireId = clean(row.linkedDesireId);
    if (linkedDesireId && !desireIds.has(linkedDesireId)) {
      errors.push(issue("CONTINUITY_DYNAMIC_LINKED_DESIRE_UNKNOWN", `${path}.linkedDesireId`, `Unknown linked desire ${linkedDesireId}.`));
    }
    // A stable row is descriptive continuity, not a state write.  It may cite
    // the owned desire that explains why this state remains unchanged.  Only a
    // changing row would let `action_committed` smuggle in a desire-dependent
    // update without waiting for verified desire evidence.
    if (
      row.settlementCondition === "action_committed"
      && row.direction !== "stable"
      && linkedDesireId
    ) {
      errors.push(issue("CONTINUITY_DYNAMIC_LINK_UNNEEDED", `${path}.linkedDesireId`, "A changing action-committed dynamic update must not hide a desire-evidence dependency."));
    }
    if (!clean(row.reason)) errors.push(issue("CONTINUITY_REASON_MISSING", `${path}.reason`, "A dynamic-state update needs a private appraisal reason."));
  }
  validateBasisIds(dynamicRows, knownBasisIds, errors, "dynamicStateContinuity");

  const narrative = proposal.selfNarrative || {};
  if (!SELF_NARRATIVE_MODES.has(narrative.mode)) {
    errors.push(issue("CONTINUITY_SELF_NARRATIVE_MODE_INVALID", "selfNarrative.mode", "Unknown self-narrative mode."));
  }
  if (proposal.choiceSignificance === "consequential" && narrative.mode === "none") {
    errors.push(issue("CONTINUITY_CONSEQUENTIAL_SELF_NARRATIVE_OMITTED", "selfNarrative.mode", "A consequential choice must at least propose reinforcement, conflict, or revision."));
  }
  if (narrative.mode === "none") {
    if (clean(narrative.proposedClaim) || (narrative.replacesClaimIds || []).length || (narrative.basisIds || []).length) {
      errors.push(issue("CONTINUITY_EMPTY_SELF_NARRATIVE_HAS_PAYLOAD", "selfNarrative", "A none self-narrative mode cannot carry a hidden identity update."));
    }
    if (narrative.consolidationStatus !== "not_applicable") {
      errors.push(issue("CONTINUITY_SELF_NARRATIVE_PHASE_INVALID", "selfNarrative.consolidationStatus", "No self-narrative update must be marked not_applicable."));
    }
  } else {
    if (!clean(narrative.proposedClaim)) errors.push(issue("CONTINUITY_SELF_NARRATIVE_CLAIM_MISSING", "selfNarrative.proposedClaim", "A self-narrative candidate needs a claim."));
    if (narrative.consolidationStatus !== "pending_committed_owned_episode") {
      errors.push(issue("CONTINUITY_SELF_NARRATIVE_PHASE_INVALID", "selfNarrative.consolidationStatus", "Identity effects must wait for a committed owned episode."));
    }
    if (chosenCandidateId && !(narrative.basisIds || []).map(clean).includes(chosenCandidateId)) {
      errors.push(issue("CONTINUITY_SELF_NARRATIVE_CHOICE_BASIS_MISSING", "selfNarrative.basisIds", "A self-narrative candidate must cite the chosen candidate."));
    }
    if (proposal.choiceSignificance === "ordinary") {
      errors.push(issue("CONTINUITY_ORDINARY_CHOICE_SELF_NARRATIVE", "selfNarrative.mode", "An ordinary choice cannot propose an identity rewrite."));
    }
    if (narrative.mode === "revision_candidate" && proposal.choiceSignificance !== "consequential") {
      errors.push(issue("CONTINUITY_REVISION_NOT_CONSEQUENTIAL", "selfNarrative.mode", "Revision requires a consequential choice proposal."));
    }
    for (const claimId of unique(narrative.replacesClaimIds || [])) {
      if (!ownedSelfClaimIds.has(claimId)) {
        errors.push(issue("CONTINUITY_REPLACED_SELF_CLAIM_NOT_OWNED", "selfNarrative.replacesClaimIds", `Self claim ${claimId} is not owned by this character.`));
      }
    }
    validateBasisIds([narrative], knownBasisIds, errors, "selfNarrative");
  }
  return { valid: errors.length === 0, errors };
}

function findOwnedActionEpisode(memoryState, characterId, actionId) {
  return (memoryState.episodes || []).find((episode) => (
    clean(episode.ownerCharacterId) === characterId
    && clean(episode.source?.kind) === "self_action"
    && (
      clean(episode.objectiveEventId) === actionId
      || clean(episode.source?.sourceActionId) === actionId
    )
  )) || null;
}

function desireStateById(ecologyState, desireId) {
  if (Array.isArray(ecologyState.desires)) {
    return ecologyState.desires.find((row) => clean(row.desireId || row.id) === desireId) || null;
  }
  return ecologyState.desires?.[desireId] || null;
}

function ecologyDesireIds(ecologyState) {
  if (Array.isArray(ecologyState.desires)) {
    return ecologyState.desires.map((row) => clean(row?.desireId || row?.id)).filter(Boolean);
  }
  return Object.keys(ecologyState.desires || {});
}

function verifiedDesireEvidence(ecologyState, desireId) {
  return (ecologyState.lastOutcome?.satisfactionEvidence || []).filter((row) => (
    clean(row.driveId || row.desireId) === desireId
    && (row.conditionMet === true || row.fullySatisfied === true || Number(row.amount || 0) > 0)
  ));
}

function desireEvidenceState(ecologyState, desireId) {
  const desireState = desireStateById(ecologyState, desireId);
  const evidence = verifiedDesireEvidence(ecologyState, desireId);
  const resolved = Number(desireState?.satisfaction || 0) >= 1
    || evidence.some((item) => item.fullySatisfied === true);
  const progressed = resolved || evidence.some((item) => (
    item.conditionMet === true || Number(item.amount || 0) > 0
  ));
  return { desireState, evidence, progressed, resolved };
}

function desireSettlementConditionMet(condition, evidenceState) {
  if (condition === "action_committed") return true;
  if (condition === "verified_progress") return evidenceState.progressed;
  if (condition === "verified_resolution") return evidenceState.resolved;
  return false;
}

function dynamicSettlementConditionMet(row, ecologyState) {
  if (row.settlementCondition === "action_committed") return true;
  const evidenceState = desireEvidenceState(ecologyState, clean(row.linkedDesireId));
  if (row.settlementCondition === "verified_desire_progress") return evidenceState.progressed;
  if (row.settlementCondition === "verified_desire_resolution") return evidenceState.resolved;
  return false;
}

function applyPressure(row, desireState, nowSeconds) {
  const before = clone(desireState);
  if (row.status === "unaffected" || row.pressureDirection === "stable") {
    return { before, after: clone(desireState), delta: 0 };
  }
  const direction = row.pressureDirection === "increase" ? 1 : -1;
  const delta = direction * (PRESSURE_DELTA[row.strengthBand] || PRESSURE_DELTA.low);
  desireState.frustration = clamp01(Number(desireState.frustration || 0) + delta);
  desireState.urgency = clamp01(Number(desireState.urgency || 0) + delta * 0.5);
  const cueKey = Object.hasOwn(desireState, "cue") ? "cue" : Object.hasOwn(desireState, "cueActivation") ? "cueActivation" : "";
  if (cueKey) {
    desireState[cueKey] = clamp01(Number(desireState[cueKey] || 0) + delta * 0.25);
    if (Object.hasOwn(desireState, "cue") && Object.hasOwn(desireState, "cueActivation")) {
      desireState.cueActivation = desireState.cue;
    }
  }
  if (direction > 0) desireState.lastBlockedAtSecond = Math.max(0, Number(nowSeconds || 0));
  return { before, after: clone(desireState), delta };
}

function dynamicNumber(row) {
  if (typeof row === "number") return { value: row, field: null };
  if (row && typeof row === "object") {
    for (const field of ["value", "activation", "pressure", "level"]) {
      if (Number.isFinite(Number(row[field]))) return { value: Number(row[field]), field };
    }
  }
  return { value: NaN, field: null };
}

function appendPendingNarrative(memoryState, row) {
  const existing = memoryState.selfNarrative?.pendingCandidates || [];
  memoryState.selfNarrative = {
    ...(memoryState.selfNarrative || {}),
    pendingCandidates: [
      ...existing.filter((candidate) => candidate.id !== row.id),
      row,
    ].slice(-16),
  };
  return memoryState;
}

function reinforceOwnedClaim(memoryState, narrative, episode, nowSeconds) {
  const match = (memoryState.selfNarrative?.currentClaims || []).find((claim) => (
    clean(claim.claim) === clean(narrative.proposedClaim)
  ));
  if (!match) return false;
  match.confidence = clamp01(Number(match.confidence || 0.5) + (PRESSURE_DELTA[narrative.significanceBand] || 0.025));
  match.sourceEpisodeIds = unique([...(match.sourceEpisodeIds || []), episode.id]).slice(-12);
  match.lastReinforcedAtSeconds = Math.max(0, Number(nowSeconds || 0));
  memoryState.episodes = (memoryState.episodes || []).map((row) => row.id === episode.id ? {
    ...row,
    protected: true,
    importance: Math.max(Number(row.importance || 0), SIGNIFICANCE_VALUE[narrative.significanceBand] || 0.38),
  } : row);
  return true;
}

/**
 * Reconciles a private continuity proposal with a committed world result.
 * It never creates objective events or memories. The caller must first encode
 * the actor's actual self-action episode and apply objective world outcomes.
 */
export function settleCharacterPostChoiceContinuity({
  characterId: characterIdInput = "",
  proposal = {},
  action = {},
  worldOutcome = {},
  memoryState: memoryInput = {},
  ecologyState: ecologyInput = {},
  dynamicState: dynamicInput = {},
  nowSeconds = 0,
  validationContext = {},
} = {}) {
  const characterId = clean(characterIdInput || memoryInput.ownerCharacterId || action.actorId);
  const actionId = clean(action.id);
  const memoryState = clone(memoryInput || {});
  const ecologyState = clone(ecologyInput || {});
  const dynamicState = clone(dynamicInput || {});
  const errors = [];
  const committed = action.committed === true
    && worldOutcome.committed === true
    && actionId
    && clean(action.actorId) === characterId;

  const baseResult = {
    schemaVersion: CHARACTER_POST_CHOICE_CONTINUITY_VERSION,
    status: committed ? "settled" : "not_committed",
    actionMemory: { requested: proposal.actionMemory?.mode === "encode_if_committed", committed: false, episodeId: "" },
    desireSettlements: [],
    dynamicStateSettlements: [],
    selfNarrativeOutcome: { status: "unchanged", sourceEpisodeId: "" },
    memoryState,
    ecologyState,
    dynamicState,
    errors,
  };
  if (!committed) return baseResult;

  const proposalValidation = validateCharacterPostChoiceContinuityProposal(proposal, {
    chosenCandidateId: validationContext.chosenCandidateId || action.candidateId || action.ecologyCandidateId || "",
    knownBasisIds: validationContext.knownBasisIds || [],
    desireIds: ecologyDesireIds(ecologyState),
    dynamicStateIds: Object.keys(dynamicState || {}),
    ownedSelfClaimIds: (memoryState.selfNarrative?.currentClaims || []).map((row) => row?.id),
    requiredDesireIds: validationContext.requiredDesireIds || [],
  });
  if (!proposalValidation.valid) {
    baseResult.status = "invalid_proposal";
    errors.push(...proposalValidation.errors);
    return baseResult;
  }

  let nextMemory = normalizeCharacterAgentMemoryState(memoryState, characterId);
  const ownedActionEpisode = findOwnedActionEpisode(nextMemory, characterId, actionId);
  if (proposal.actionMemory?.mode === "encode_if_committed") {
    if (ownedActionEpisode) {
      baseResult.actionMemory = { requested: true, committed: true, episodeId: ownedActionEpisode.id };
    } else {
      errors.push(issue(
        "CONTINUITY_OWNED_ACTION_EPISODE_MISSING",
        "memoryState.episodes",
        "A committed choice cannot affect autobiographical identity until the actor owns its self-action episode.",
        { actionId, characterId },
      ));
    }
  }

  for (const row of proposal.desireContinuity || []) {
    const desireId = clean(row.desireId);
    const evidenceState = desireEvidenceState(ecologyState, desireId);
    const desireState = evidenceState.desireState;
    if (!desireState) {
      errors.push(issue("CONTINUITY_DESIRE_STATE_MISSING", `ecologyState.desires.${desireId}`, "The proposed desire has no persistent runtime state."));
      continue;
    }
    const evidence = evidenceState.evidence;
    const satisfied = evidenceState.resolved;
    if (satisfied) {
      if (row.status === "remains_unresolved") {
        errors.push(issue(
          "CONTINUITY_DESIRE_STATUS_OVERRIDDEN_BY_WORLD",
          `desireContinuity.${desireId}.status`,
          "Verified world resolution overrides a pre-action unresolved projection.",
          { desireId, evidenceIds: evidence.map((item) => item.evidenceId).filter(Boolean) },
        ));
      }
      baseResult.desireSettlements.push({
        desireId,
        proposedStatus: row.status,
        settledStatus: "satisfied_by_verified_world",
        pressureDelta: 0,
        settlementCondition: row.settlementCondition,
        settlementConditionMet: true,
        evidenceIds: evidence.map((item) => item.evidenceId).filter(Boolean),
      });
      continue;
    }
    const settlementConditionMet = desireSettlementConditionMet(row.settlementCondition, evidenceState);
    if (!settlementConditionMet) {
      baseResult.desireSettlements.push({
        desireId,
        proposedStatus: row.status,
        settledStatus: row.settlementCondition === "verified_resolution"
          ? "awaiting_verified_resolution"
          : "awaiting_verified_progress",
        pressureDelta: 0,
        settlementCondition: row.settlementCondition,
        settlementConditionMet: false,
        evidenceIds: evidence.map((item) => item.evidenceId).filter(Boolean),
      });
      continue;
    }
    const pressure = applyPressure(row, desireState, nowSeconds);
    baseResult.desireSettlements.push({
      desireId,
      proposedStatus: row.status,
      settledStatus: evidence.length ? "verified_partial_progress" : "unresolved",
      pressureDelta: pressure.delta,
      settlementCondition: row.settlementCondition,
      settlementConditionMet: true,
      before: pressure.before,
      after: pressure.after,
      evidenceIds: evidence.map((item) => item.evidenceId).filter(Boolean),
    });
  }

  for (const row of proposal.dynamicStateContinuity || []) {
    const stateId = clean(row.stateId);
    if (!Object.hasOwn(dynamicState, stateId)) {
      errors.push(issue("CONTINUITY_DYNAMIC_STATE_MISSING", `dynamicState.${stateId}`, "The proposed dynamic state is not present in runtime state."));
      continue;
    }
    const reading = dynamicNumber(dynamicState[stateId]);
    if (!Number.isFinite(reading.value)) {
      errors.push(issue("CONTINUITY_DYNAMIC_STATE_NOT_NUMERIC", `dynamicState.${stateId}`, "Dynamic continuity currently requires a bounded numeric state."));
      continue;
    }
    const settlementConditionMet = dynamicSettlementConditionMet(row, ecologyState);
    if (!settlementConditionMet) {
      baseResult.dynamicStateSettlements.push({
        stateId,
        before: reading.value,
        after: reading.value,
        delta: 0,
        settlementCondition: row.settlementCondition,
        settlementConditionMet: false,
      });
      continue;
    }
    const direction = row.direction === "increase" ? 1 : row.direction === "decrease" ? -1 : 0;
    const delta = direction * (DYNAMIC_DELTA[row.strengthBand] || DYNAMIC_DELTA.low);
    const after = clamp01(reading.value + delta);
    if (reading.field) dynamicState[stateId][reading.field] = after;
    else dynamicState[stateId] = after;
    baseResult.dynamicStateSettlements.push({
      stateId,
      before: reading.value,
      after,
      delta: after - reading.value,
      settlementCondition: row.settlementCondition,
      settlementConditionMet: true,
    });
  }

  const narrative = proposal.selfNarrative || {};
  if (narrative.mode !== "none") {
    if (!ownedActionEpisode) {
      if (!errors.some((entry) => entry.code === "CONTINUITY_OWNED_ACTION_EPISODE_MISSING")) {
        errors.push(issue(
          "CONTINUITY_OWNED_ACTION_EPISODE_MISSING",
          "memoryState.episodes",
          "A self-narrative effect requires a personally owned committed-action episode.",
          { actionId, characterId },
        ));
      }
      baseResult.selfNarrativeOutcome = { status: "blocked_missing_owned_episode", sourceEpisodeId: "" };
    } else if (narrative.mode === "reinforcement_candidate"
      && reinforceOwnedClaim(nextMemory, narrative, ownedActionEpisode, nowSeconds)) {
      baseResult.selfNarrativeOutcome = { status: "reinforced", sourceEpisodeId: ownedActionEpisode.id };
    } else if (
      narrative.mode === "revision_candidate"
      && proposal.choiceSignificance === "consequential"
      && clamp01(worldOutcome.significance) >= 0.68
    ) {
      const versionCount = nextMemory.selfNarrative?.versions?.length || 0;
      nextMemory = reviseCharacterSelfNarrative(nextMemory, {
        id: `self-revision:${characterId}:${actionId}`,
        confirmedChoice: true,
        significance: Math.min(
          clamp01(worldOutcome.significance),
          SIGNIFICANCE_VALUE[narrative.significanceBand] || SIGNIFICANCE_VALUE.low,
        ),
        permanence: SIGNIFICANCE_VALUE[narrative.permanenceBand] || SIGNIFICANCE_VALUE.low,
        claim: narrative.proposedClaim,
        replacesClaimIds: narrative.replacesClaimIds || [],
        semanticFrameId: ownedActionEpisode.semanticFrame?.id || "",
        sourceEpisodeIds: [ownedActionEpisode.id],
        reason: "A committed consequential choice contradicted or replaced an earlier self-understanding.",
        nowSeconds,
      });
      const revised = (nextMemory.selfNarrative?.versions?.length || 0) > versionCount;
      baseResult.selfNarrativeOutcome = {
        status: revised ? "revised" : "pending_threshold_or_duplicate",
        sourceEpisodeId: ownedActionEpisode.id,
      };
      if (!revised) {
        appendPendingNarrative(nextMemory, {
          id: `self-narrative-candidate:${characterId}:${actionId}`,
          mode: narrative.mode,
          claim: clean(narrative.proposedClaim),
          status: "pending_threshold_or_duplicate",
          proposedAtSeconds: Math.max(0, Number(nowSeconds || 0)),
          worldSignificance: clamp01(worldOutcome.significance),
          sourceEpisodeIds: [ownedActionEpisode.id],
          replacesClaimIds: unique(narrative.replacesClaimIds || []),
        });
      }
    } else {
      appendPendingNarrative(nextMemory, {
        id: `self-narrative-candidate:${characterId}:${actionId}`,
        mode: narrative.mode,
        claim: clean(narrative.proposedClaim),
        status: "pending_repetition_or_story_significance",
        proposedAtSeconds: Math.max(0, Number(nowSeconds || 0)),
        worldSignificance: clamp01(worldOutcome.significance),
        sourceEpisodeIds: [ownedActionEpisode.id],
        replacesClaimIds: unique(narrative.replacesClaimIds || []),
      });
      baseResult.selfNarrativeOutcome = {
        status: "pending_repetition_or_story_significance",
        sourceEpisodeId: ownedActionEpisode.id,
      };
    }
  }

  baseResult.memoryState = nextMemory;
  return baseResult;
}
