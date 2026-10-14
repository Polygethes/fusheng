export const CHARACTER_LIFE_CONTINUITY_VERSION = "character-life-continuity-v1";
export const CHARACTER_DAY_PLAN_VERSION = "character-day-plan-v1";

const CHARACTER_DAY_PLAN_HORIZON_SECONDS = 24 * 60 * 60;
const CHARACTER_DAY_PLAN_MIN_BLOCKS = 5;
const CHARACTER_DAY_PLAN_MAX_BLOCKS = 8;
const CHARACTER_DAY_PLAN_SUBMISSION_FIELDS = new Set(["ownerAuthority", "planBlocks"]);
const CHARACTER_DAY_PLAN_BLOCK_FIELDS = new Set([
  "relativeStartSeconds",
  "relativeEndSeconds",
  "activityType",
  "desiredZoneHandle",
  "privatePurpose",
  "sourceIds",
]);

function clone(value) {
  if (value === undefined) return undefined;
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function clean(value = "") {
  return String(value ?? "").trim();
}

function stablePart(value = "") {
  return clean(value).replace(/[^\p{L}\p{N}:._=-]+/gu, "_") || "unknown";
}

function unique(values = []) {
  return [...new Set((values || []).map(clean).filter(Boolean))];
}

function fail(code, message, evidence = {}) {
  const error = new Error(message);
  error.code = code;
  error.evidence = clone(evidence);
  return error;
}

function assertOnlyFields(value, allowedFields, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw fail("CHARACTER_DAY_PLAN_SUBMISSION_INVALID", "Character day-plan input must be an object.", { path });
  }
  const forbiddenFields = Object.keys(value).filter((field) => !allowedFields.has(field));
  if (forbiddenFields.length) {
    throw fail(
      "CHARACTER_DAY_PLAN_FIELD_FORBIDDEN",
      "A coarse Character day plan cannot submit identities, primitives, speech, actions, or world results.",
      { path, forbiddenFields },
    );
  }
}

function assertDayPlanOwner(ownerCharacterId, currentLifePlanState = null) {
  const owner = clean(ownerCharacterId);
  if (!owner) {
    throw fail("CHARACTER_DAY_PLAN_OWNER_REQUIRED", "Character day-plan state requires an owner.");
  }
  const claimedOwner = clean(currentLifePlanState?.ownerCharacterId);
  if (claimedOwner && claimedOwner !== owner) {
    throw fail(
      "CHARACTER_DAY_PLAN_OWNER_MISMATCH",
      "A Character cannot revise another Character's private day plan.",
      { ownerCharacterId: owner, claimedOwnerCharacterId: claimedOwner },
    );
  }
  return owner;
}

function validateDayPlanSchedule(planBlocks = [], horizonSeconds = CHARACTER_DAY_PLAN_HORIZON_SECONDS, { minBlocks = CHARACTER_DAY_PLAN_MIN_BLOCKS, maxBlocks = CHARACTER_DAY_PLAN_MAX_BLOCKS, maxBlockSeconds = horizonSeconds } = {}) {
  if (!Array.isArray(planBlocks)
    || planBlocks.length < minBlocks
    || planBlocks.length > maxBlocks) {
    throw fail(
      "CHARACTER_DAY_PLAN_BLOCK_COUNT_INVALID",
      `This private plan requires ${minBlocks} to ${maxBlocks} blocks.`,
      { blockCount: Array.isArray(planBlocks) ? planBlocks.length : null },
    );
  }
  const horizon = Number(horizonSeconds);
  if (!Number.isFinite(horizon) || horizon <= 0 || horizon > CHARACTER_DAY_PLAN_HORIZON_SECONDS) {
    throw fail(
      "CHARACTER_DAY_PLAN_HORIZON_INVALID",
      "A Character day plan horizon must be positive and no longer than 24 hours.",
      { horizonSeconds },
    );
  }
  const ordered = planBlocks.map((block, index) => {
    const relativeStartSeconds = block?.relativeStartSeconds;
    const relativeEndSeconds = block?.relativeEndSeconds;
    if (typeof relativeStartSeconds !== "number"
      || typeof relativeEndSeconds !== "number"
      || !Number.isFinite(relativeStartSeconds)
      || !Number.isFinite(relativeEndSeconds)
      || relativeStartSeconds < 0
      || relativeEndSeconds <= relativeStartSeconds) {
      throw fail(
        "CHARACTER_DAY_PLAN_TIME_INVALID",
        "Every day-plan block needs a finite non-negative start before its end.",
        { index, relativeStartSeconds, relativeEndSeconds },
      );
    }
    if (relativeStartSeconds >= horizon || relativeEndSeconds > horizon) {
      throw fail(
        "CHARACTER_DAY_PLAN_TIME_OUT_OF_HORIZON",
        "Every day-plan block must stay inside the private planning horizon.",
        { index, relativeStartSeconds, relativeEndSeconds, horizonSeconds: horizon },
      );
    }
    if (relativeEndSeconds - relativeStartSeconds > maxBlockSeconds) {
      throw fail("CHARACTER_DAY_PLAN_BLOCK_TOO_LONG", "Keep this near-term block within the supplied duration limit; long-term intentions need not occupy the current scene.", { index, maxBlockSeconds });
    }
    return {
      source: block,
      inputIndex: index,
      relativeStartSeconds,
      relativeEndSeconds,
    };
  }).sort((left, right) => (
    left.relativeStartSeconds - right.relativeStartSeconds
    || left.relativeEndSeconds - right.relativeEndSeconds
    || left.inputIndex - right.inputIndex
  ));
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index].relativeStartSeconds < ordered[index - 1].relativeEndSeconds) {
      throw fail(
        "CHARACTER_DAY_PLAN_BLOCKS_OVERLAP",
        "Character day-plan blocks may not overlap.",
        { previousInputIndex: ordered[index - 1].inputIndex, inputIndex: ordered[index].inputIndex },
      );
    }
  }
  return { horizon, ordered };
}

function finiteNonNegative(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : Math.max(0, Number(fallback || 0));
}

function planStepRevision(source = {}) {
  const explicit = source.revision ?? source.planRevision ?? source.scheduleRevision;
  if (explicit != null && clean(explicit)) return clean(explicit);
  return `deferral-${Math.floor(finiteNonNegative(source.deferrals))}`;
}

function planStepReferenceId({ ownerCharacterId = "", planStepId = "", revision = "", dueAtSeconds = 0 } = {}) {
  return [
    "character-plan-step",
    encodeURIComponent(clean(ownerCharacterId)),
    encodeURIComponent(clean(planStepId)),
    `revision=${encodeURIComponent(clean(revision))}`,
    `due=${finiteNonNegative(dueAtSeconds)}`,
  ].join(":");
}

/**
 * Settle one coarse day-plan submission into server-owned private state.
 * The Character supplies purposes and broad activities; stable identities,
 * revisions, absolute deadlines, and lifecycle status stay server-owned.
 */
export function settleCharacterDayPlan({
  ownerCharacterId = "",
  currentLifePlanState = null,
  submission = {},
  ownedSourceIds = [],
  allowedZoneHandles = null,
  nowSeconds = 0,
  horizonSeconds = CHARACTER_DAY_PLAN_HORIZON_SECONDS,
  minBlocks = CHARACTER_DAY_PLAN_MIN_BLOCKS,
  maxBlocks = CHARACTER_DAY_PLAN_MAX_BLOCKS,
  maxBlockSeconds = horizonSeconds,
} = {}) {
  const owner = assertDayPlanOwner(ownerCharacterId, currentLifePlanState);
  assertOnlyFields(submission, CHARACTER_DAY_PLAN_SUBMISSION_FIELDS, "submission");
  if (clean(submission.ownerAuthority) !== "character-agent") {
    throw fail(
      "CHARACTER_DAY_PLAN_AUTHORITY_INVALID",
      "Only the Character Agent may author its private coarse day plan.",
    );
  }
  const anchorAtSeconds = finiteNonNegative(nowSeconds);
  const planBlocks = Array.isArray(submission?.planBlocks) ? submission.planBlocks : [];
  const { horizon, ordered } = validateDayPlanSchedule(planBlocks, horizonSeconds, { minBlocks, maxBlocks, maxBlockSeconds });
  const currentRevision = Math.max(0, Math.floor(Number(currentLifePlanState?.revision || 0)));
  const revision = currentRevision + 1;
  const planId = clean(currentLifePlanState?.planId)
    || `character-day-plan:${stablePart(owner)}:anchor=${stablePart(anchorAtSeconds)}`;
  const knownSources = new Set(unique(ownedSourceIds));
  const knownZones = allowedZoneHandles == null ? null : new Set(unique(allowedZoneHandles));
  const steps = ordered.map(({ source: block, relativeStartSeconds, relativeEndSeconds }, index) => {
    assertOnlyFields(block, CHARACTER_DAY_PLAN_BLOCK_FIELDS, `submission.planBlocks[${index}]`);
    const hasValidContentTypes = typeof block?.activityType === "string"
      && typeof block?.desiredZoneHandle === "string"
      && typeof block?.privatePurpose === "string"
      && Array.isArray(block?.sourceIds)
      && block.sourceIds.every((sourceId) => typeof sourceId === "string");
    const activityType = clean(block?.activityType);
    const desiredZoneHandle = clean(block?.desiredZoneHandle);
    const privatePurpose = clean(block?.privatePurpose);
    const sourceIds = unique(block?.sourceIds);
    if (!hasValidContentTypes || !activityType || !privatePurpose || !sourceIds.length) {
      throw fail(
        "CHARACTER_DAY_PLAN_BLOCK_INVALID",
        "Every coarse day-plan block needs an activity, private purpose, and owned sources.",
        { index },
      );
    }
    const unownedSourceIds = sourceIds.filter((sourceId) => !knownSources.has(sourceId));
    if (unownedSourceIds.length) {
      throw fail(
        "CHARACTER_DAY_PLAN_SOURCE_NOT_OWNED",
        "A Character day-plan block may cite only that Character's owned private sources.",
        { index, unownedSourceIds },
      );
    }
    if (desiredZoneHandle && knownZones && !knownZones.has(desiredZoneHandle)) {
      throw fail(
        "CHARACTER_DAY_PLAN_ZONE_NOT_ALLOWED",
        "A Character day-plan block must use an allowed zone handle.",
        { index, desiredZoneHandle },
      );
    }
    return {
      schemaVersion: CHARACTER_DAY_PLAN_VERSION,
      authority: "character-agent-owned-day-plan-step",
      ownerCharacterId: owner,
      planId,
      planStepId: `${planId}:step:${String(index + 1).padStart(2, "0")}`,
      revision,
      status: "planned",
      relativeStartSeconds,
      relativeEndSeconds,
      dueAtSeconds: anchorAtSeconds + relativeStartSeconds,
      endsAtSeconds: anchorAtSeconds + relativeEndSeconds,
      activityType,
      desiredZoneHandle,
      privatePurpose,
      sourceIds,
      decisionAuthority: "character-agent",
      selection: null,
    };
  });
  const lifePlanState = {
    schemaVersion: CHARACTER_DAY_PLAN_VERSION,
    authority: "character-private-life-plan-state",
    ownerCharacterId: owner,
    planId,
    revision,
    status: "active",
    anchorAtSeconds,
    horizonSeconds: horizon,
    horizonEndsAtSeconds: anchorAtSeconds + horizon,
    steps,
    lastSettledAtSeconds: anchorAtSeconds,
  };
  return {
    schemaVersion: CHARACTER_DAY_PLAN_VERSION,
    ownerCharacterId: owner,
    lifePlanState: clone(lifePlanState),
    worldChanged: false,
  };
}

export function checkpointCharacterLifePlanState(lifePlanState = null) {
  return lifePlanState == null ? null : clone(lifePlanState);
}

/**
 * Consume exactly one due coarse block as a private thought opportunity.
 * This lifecycle transition records that the block was considered; it does
 * not choose an embodied method, public speech, or a world result.
 */
export function considerCharacterDayPlanStep({
  ownerCharacterId = "",
  lifePlanState = null,
  planStepId = "",
  nowSeconds = 0,
} = {}) {
  const owner = assertDayPlanOwner(ownerCharacterId, lifePlanState);
  const now = Number(nowSeconds);
  if (!Number.isFinite(now) || now < 0) {
    throw fail("CHARACTER_DAY_PLAN_CONSIDERATION_TIME_INVALID", "Day-plan consideration requires a valid private clock.");
  }
  const requestedPlanStepId = clean(planStepId);
  const nextState = checkpointCharacterLifePlanState(lifePlanState);
  const stepIndex = (nextState?.steps || []).findIndex((row) => clean(row?.planStepId) === requestedPlanStepId);
  if (stepIndex < 0) {
    throw fail(
      "CHARACTER_DAY_PLAN_STEP_UNKNOWN",
      "Day-plan consideration must name one step in the Character's current plan.",
      { planStepId: requestedPlanStepId },
    );
  }
  const step = nextState.steps[stepIndex];
  if (clean(step.ownerCharacterId) !== owner || clean(step.planId) !== clean(nextState.planId)) {
    throw fail(
      "CHARACTER_DAY_PLAN_OWNER_MISMATCH",
      "A Character cannot consider a day-plan step owned by someone else.",
      { planStepId: requestedPlanStepId },
    );
  }
  if (clean(step.status) !== "planned") {
    throw fail(
      clean(step.status) === "considered"
        ? "CHARACTER_DAY_PLAN_STEP_ALREADY_CONSIDERED"
        : "CHARACTER_DAY_PLAN_STEP_NOT_PLANNED",
      "A day-plan block grants at most one due thought opportunity.",
      { planStepId: requestedPlanStepId, status: clean(step.status) },
    );
  }
  if (finiteNonNegative(step.dueAtSeconds) > now) {
    throw fail(
      "CHARACTER_DAY_PLAN_STEP_NOT_DUE",
      "A Character cannot consume a future day-plan block early.",
      { planStepId: requestedPlanStepId, dueAtSeconds: step.dueAtSeconds, nowSeconds: now },
    );
  }
  nextState.steps[stepIndex] = {
    ...step,
    status: "considered",
    consideredAtSeconds: now,
    selection: null,
  };
  nextState.lastConsideredAtSeconds = now;
  const consideration = {
    schemaVersion: CHARACTER_DAY_PLAN_VERSION,
    authority: "character-private-day-plan-consideration",
    ownerCharacterId: owner,
    planId: clean(nextState.planId),
    planStepId: requestedPlanStepId,
    revision: Math.max(1, Math.floor(Number(step.revision || nextState.revision || 1))),
    consideredAtSeconds: now,
    activityType: clean(step.activityType),
    desiredZoneHandle: clean(step.desiredZoneHandle),
    privatePurpose: clean(step.privatePurpose),
    sourceIds: unique(step.sourceIds),
    decisionAuthority: "character-agent",
    selection: null,
  };
  return {
    schemaVersion: CHARACTER_DAY_PLAN_VERSION,
    ownerCharacterId: owner,
    lifePlanState: clone(nextState),
    consideration,
    worldChanged: false,
  };
}

/**
 * Project the existing Character-Agent-owned timed continuations as private
 * plan steps. This module owns neither the plan content nor the next action;
 * it only exposes when the same Character asked to reconsider something.
 */
export function characterOwnedTimedPlanSteps(privateState = {}) {
  const ownerCharacterId = clean(privateState.ownerCharacterId);
  const intentions = privateState.ecologyState?.characterPsychologyV2State?.continuationIntentions || [];
  const continuationSteps = intentions
    .filter((row) => clean(row?.ownerAuthority) === "character-agent")
    .filter((row) => clean(row?.status || "active") === "active")
    .filter((row) => clean(row?.triggerType) === "elapsed_without_progress")
    .filter((row) => clean(row?.intentionId) && finiteNonNegative(row?.minimumDelaySeconds) > 0)
    .map((row) => {
      const createdAtSeconds = finiteNonNegative(row.createdAtCharacterSeconds);
      const minimumDelaySeconds = finiteNonNegative(row.minimumDelaySeconds);
      const dueAtSeconds = createdAtSeconds + minimumDelaySeconds;
      const revision = planStepRevision(row);
      return {
        schemaVersion: 1,
        authority: "character-agent-owned-plan-step",
        ownerCharacterId,
        planStepId: clean(row.intentionId),
        revision,
        referenceId: planStepReferenceId({
          ownerCharacterId,
          planStepId: row.intentionId,
          revision,
          dueAtSeconds,
        }),
        status: "active",
        dueAtSeconds,
        createdAtSeconds,
        minimumDelaySeconds,
        intendedPrimitive: clean(row.intendedPrimitive),
        targetHandle: clean(row.targetHandle),
        sourceIds: unique(row.linkedSourceIds || []),
        privatePurpose: clean(row.privatePurpose),
        deferrals: finiteNonNegative(row.deferrals),
        maxDeferrals: finiteNonNegative(row.maxDeferrals),
        decisionAuthority: "character-agent",
        allowedReconsiderations: ["continue", "reschedule", "change_method", "abandon", "no_action"],
      };
    });
  const lifePlanState = privateState.lifePlanState || {};
  const dayPlanSteps = clean(lifePlanState.ownerCharacterId) === ownerCharacterId
    && clean(lifePlanState.status || "active") === "active"
    ? (lifePlanState.steps || [])
      .filter((row) => clean(row?.ownerCharacterId) === ownerCharacterId)
      .filter((row) => clean(row?.status) === "planned")
      .filter((row) => clean(row?.planStepId))
      .map((row) => {
        const planStepId = clean(row.planStepId);
        const revision = clean(row.revision ?? lifePlanState.revision);
        const dueAtSeconds = finiteNonNegative(
          row.dueAtSeconds,
          finiteNonNegative(lifePlanState.anchorAtSeconds) + finiteNonNegative(row.relativeStartSeconds),
        );
        return {
          schemaVersion: 1,
          authority: "character-agent-owned-plan-step",
          planKind: "day-plan",
          ownerCharacterId,
          planId: clean(row.planId || lifePlanState.planId),
          planStepId,
          revision,
          referenceId: planStepReferenceId({
            ownerCharacterId,
            planStepId,
            revision,
            dueAtSeconds,
          }),
          status: "planned",
          dueAtSeconds,
          endsAtSeconds: finiteNonNegative(row.endsAtSeconds),
          createdAtSeconds: finiteNonNegative(lifePlanState.anchorAtSeconds),
          minimumDelaySeconds: finiteNonNegative(row.relativeStartSeconds),
          relativeStartSeconds: finiteNonNegative(row.relativeStartSeconds),
          relativeEndSeconds: finiteNonNegative(row.relativeEndSeconds),
          activityType: clean(row.activityType),
          desiredZoneHandle: clean(row.desiredZoneHandle),
          sourceIds: unique(row.sourceIds),
          privatePurpose: clean(row.privatePurpose),
          decisionAuthority: "character-agent",
          allowedReconsiderations: ["continue", "reschedule", "change_method", "abandon", "no_action"],
          selection: null,
        };
      })
    : [];
  return [...continuationSteps, ...dayPlanSteps];
}

export function dueCharacterOwnedPlanSteps(privateState = {}, nowSeconds = 0) {
  const now = finiteNonNegative(nowSeconds);
  return characterOwnedTimedPlanSteps(privateState)
    .filter((row) => row.dueAtSeconds <= now)
    .sort((left, right) => left.dueAtSeconds - right.dueAtSeconds || left.planStepId.localeCompare(right.planStepId));
}

export function nextCharacterOwnedPlanDueAtSeconds(privateState = {}, nowSeconds = 0) {
  const now = finiteNonNegative(nowSeconds);
  const dueTimes = characterOwnedTimedPlanSteps(privateState).map((row) => Math.max(now, row.dueAtSeconds));
  return dueTimes.length ? Math.min(...dueTimes) : null;
}

export function projectCharacterLifeContinuityForOwner(privateState = {}, {
  nowSeconds = 0,
  planStepIds = [],
} = {}) {
  const requested = new Set(unique(planStepIds));
  const steps = characterOwnedTimedPlanSteps(privateState);
  const dayPlan = clean(privateState.lifePlanState?.ownerCharacterId) === clean(privateState.ownerCharacterId)
    ? privateState.lifePlanState : null;
  return {
    schemaVersion: CHARACTER_LIFE_CONTINUITY_VERSION,
    authority: "character-private-life-continuity-projection",
    ownerCharacterId: clean(privateState.ownerCharacterId),
    nowSeconds: finiteNonNegative(nowSeconds),
    dayPlanHorizonEndsAtSeconds: dayPlan && Number.isFinite(Number(dayPlan.horizonEndsAtSeconds))
      ? Number(dayPlan.horizonEndsAtSeconds) : null,
    activePlanSteps: steps.map((row) => clone(row)),
    duePlanSteps: steps.filter((row) => requested.has(row.planStepId)).map((row) => clone(row)),
    selection: null,
    rule: "A due plan step grants this Character another thought opportunity. The Character may continue, reschedule, change method, abandon it, or do nothing; no action is preselected.",
  };
}
