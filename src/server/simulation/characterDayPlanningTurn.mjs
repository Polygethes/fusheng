import { characterTimePolicy } from "./characterTimePolicy.mjs";
import { settleCharacterDayPlan } from "./characterLifeContinuity.mjs";
import { runCharacterMaintenanceStage } from "./characterMaintenanceStageProtocol.mjs";

export const CHARACTER_DAY_PLANNING_TURN_VERSION = "character-day-planning-turn-v1";
export const CHARACTER_DAY_PLANNING_HORIZON_SECONDS = 86_400;
const CHARACTER_DAY_PLANNING_BODY_NEEDS = Object.freeze([
  "hunger",
  "thirst",
  "fatigue",
  "pain",
  "stamina",
]);

function clone(value) {
  if (value === undefined) return undefined;
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function clean(value = "") {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

function unique(values = []) {
  return [...new Set((values || []).map(clean).filter(Boolean))];
}

function nonNegativeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : Math.max(0, Number(fallback || 0));
}

function boundedUnit(value, fallback = 0) {
  const number = Number(value);
  const resolved = Number.isFinite(number) ? number : Number(fallback || 0);
  return Math.round(Math.max(0, Math.min(1, resolved)) * 1e6) / 1e6;
}

function bodyNeedBand(metric, value) {
  if (metric === "stamina") {
    if (value <= 0.2) return "depleted";
    if (value <= 0.45) return "low";
    if (value <= 0.75) return "moderate";
    return "high";
  }
  if (value < 0.25) return "low";
  if (value < 0.5) return "moderate";
  if (value < 0.75) return "high";
  return "urgent";
}

function bodyNeedSourceHandle(ownerCharacterId, metric) {
  return `character-private-body-need:${encodeURIComponent(ownerCharacterId)}:${metric}`;
}

function projectCurrentBodyNeeds(ecologyState = {}, ownerCharacterId = "") {
  const body = ecologyState?.body || ecologyState?.bodyState || {};
  const fatigue = boundedUnit(body.fatigue ?? body.exertion, 0);
  const values = {
    hunger: boundedUnit(body.hunger, 0),
    thirst: boundedUnit(body.thirst, 0),
    fatigue,
    pain: boundedUnit(body.pain, 0),
    stamina: boundedUnit(body.stamina ?? body.energy, 1 - fatigue),
  };
  return {
    authority: "character-private-day-planning-body-needs-projection",
    ownerCharacterId,
    ...Object.fromEntries(CHARACTER_DAY_PLANNING_BODY_NEEDS.map((metric) => [
      metric,
      {
        value: values[metric],
        band: bodyNeedBand(metric, values[metric]),
        sourceHandle: bodyNeedSourceHandle(ownerCharacterId, metric),
      },
    ])),
  };
}

function fail(code, message, evidence = {}) {
  const error = new Error(message);
  error.code = code;
  error.evidence = clone(evidence);
  return error;
}

function assertClaimedOwner(ownerCharacterId, claimedOwnerCharacterId, field) {
  const claimed = clean(claimedOwnerCharacterId);
  if (claimed && claimed !== ownerCharacterId) {
    throw fail(
      "CHARACTER_DAY_PLANNING_OWNER_MISMATCH",
      "A private day-planning turn cannot read another Character's state.",
      { field, ownerCharacterId, claimedOwnerCharacterId: claimed },
    );
  }
}

function assertOwnedRows(ownerCharacterId, rows = [], field = "rows") {
  (rows || []).forEach((row, index) => {
    assertClaimedOwner(ownerCharacterId, row?.ownerCharacterId, `${field}[${index}].ownerCharacterId`);
  });
}

function assertOwnedPlanningInputs(ownerCharacterId, privateState = {}) {
  if (!ownerCharacterId) {
    throw fail(
      "CHARACTER_DAY_PLANNING_OWNER_REQUIRED",
      "A private day-planning turn requires its owning Character id.",
    );
  }
  assertClaimedOwner(ownerCharacterId, privateState.ownerCharacterId, "privateState.ownerCharacterId");
  assertClaimedOwner(
    ownerCharacterId,
    privateState.memoryContext?.ownerCharacterId,
    "privateState.memoryContext.ownerCharacterId",
  );
  assertOwnedRows(ownerCharacterId, privateState.memoryContext?.episodes, "privateState.memoryContext.episodes");
  assertOwnedRows(ownerCharacterId, privateState.memoryContext?.beliefs, "privateState.memoryContext.beliefs");
  for (const collection of ["currentClaims", "pendingCandidates", "versions"]) {
    assertOwnedRows(
      ownerCharacterId,
      privateState.memoryContext?.selfNarrative?.[collection],
      `privateState.memoryContext.selfNarrative.${collection}`,
    );
  }
  assertClaimedOwner(
    ownerCharacterId,
    privateState.currentResponsibilities?.ownerCharacterId,
    "privateState.currentResponsibilities.ownerCharacterId",
  );
  assertOwnedRows(
    ownerCharacterId,
    privateState.currentResponsibilities?.activeDutyContracts,
    "privateState.currentResponsibilities.activeDutyContracts",
  );
  assertOwnedRows(ownerCharacterId, privateState.ownCommitments, "privateState.ownCommitments");
  assertOwnedRows(ownerCharacterId, privateState.currentActivities, "privateState.currentActivities");
}

function rowId(row = {}) {
  return clean(
    row.id
    || row.sourceId
    || row.claimId
    || row.dutyId
    || row.commitmentId
    || row.activityId
    || row.processId,
  );
}

function projectMemoryAndBeliefs(memoryContext = {}, ownerCharacterId = "") {
  return {
    authority: "character-private-day-planning-memory-projection",
    ownerCharacterId,
    episodes: clone((memoryContext.episodes || []).slice(-48)),
    beliefs: clone((memoryContext.beliefs || []).slice(-48)),
  };
}

function projectSelfNarrative(memoryContext = {}, ownerCharacterId = "") {
  const selfNarrative = memoryContext.selfNarrative || {};
  return {
    authority: "character-private-day-planning-self-narrative-projection",
    ownerCharacterId,
    currentClaims: clone((selfNarrative.currentClaims || []).slice(-24)),
    pendingCandidates: clone((selfNarrative.pendingCandidates || []).slice(-16)),
    versions: clone((selfNarrative.versions || []).slice(-16)),
  };
}

function projectResponsibilities(responsibilities = {}, ownerCharacterId = "") {
  return {
    authority: "character-private-day-planning-responsibility-projection",
    ownerCharacterId,
    acceptedRoleIds: unique(responsibilities.acceptedRoleIds || []),
    activeDutyContracts: clone((responsibilities.activeDutyContracts || []).slice(-24)),
  };
}

function projectOwnedRows(rows = [], ownerCharacterId = "", authority = "") {
  return {
    authority,
    ownerCharacterId,
    items: clone((rows || []).slice(-24)),
  };
}

function ownedPlanningSourceIds(privateContext = {}) {
  return unique([
    ...(privateContext.memoryAndBeliefs.episodes || []).map(rowId),
    ...(privateContext.memoryAndBeliefs.beliefs || []).map(rowId),
    ...(privateContext.selfNarrative.currentClaims || []).map(rowId),
    ...(privateContext.selfNarrative.pendingCandidates || []).map(rowId),
    ...(privateContext.selfNarrative.versions || []).map(rowId),
    ...(privateContext.responsibilities.acceptedRoleIds || []),
    ...(privateContext.responsibilities.activeDutyContracts || []).map(rowId),
    ...(privateContext.commitments.items || []).map(rowId),
    ...(privateContext.currentActivities.items || []).map(rowId),
    ...CHARACTER_DAY_PLANNING_BODY_NEEDS.map((metric) => (
      privateContext.currentBodyNeeds?.[metric]?.sourceHandle
    )),
  ]);
}

function dayPlanningStageInput({
  ownerCharacterId,
  agentTurnId,
  privateState,
  nowSeconds,
  availableZoneHandles,
  timePolicy,
  temporalContext,
}) {
  const privateContext = {
    memoryAndBeliefs: projectMemoryAndBeliefs(privateState.memoryContext || {}, ownerCharacterId),
    selfNarrative: projectSelfNarrative(privateState.memoryContext || {}, ownerCharacterId),
    responsibilities: projectResponsibilities(privateState.currentResponsibilities || {}, ownerCharacterId),
    commitments: projectOwnedRows(
      privateState.ownCommitments || [],
      ownerCharacterId,
      "character-private-day-planning-commitment-projection",
    ),
    currentActivities: projectOwnedRows(
      privateState.currentActivities || [],
      ownerCharacterId,
      "character-private-day-planning-current-activity-projection",
    ),
    currentBodyNeeds: projectCurrentBodyNeeds(privateState.ecologyState || {}, ownerCharacterId),
  };
  const ownedSourceIds = ownedPlanningSourceIds(privateContext);
  const allowedZoneHandles = unique(availableZoneHandles);
  return {
    schemaVersion: CHARACTER_DAY_PLANNING_TURN_VERSION,
    authority: "character-private-day-planning-stage-input",
    phase: "awaiting_character_day_planning",
    stage: "character_day_planning",
    characterId: ownerCharacterId,
    agentTurnId: clean(agentTurnId),
    ownerCharacterId,
    nowSeconds,
    horizon: {
      startAtSeconds: nowSeconds,
      endAtSeconds: nowSeconds + timePolicy.planningHorizonSeconds,
      durationSeconds: timePolicy.planningHorizonSeconds,
      granularity: timePolicy.mode === "scene" ? "near_term_blocks" : "rough_blocks",
    },
    temporalContext: clone(temporalContext || {}),
    privateContext,
    referenceContract: {
      ownerCharacterId,
      ownedSourceIds,
      allowedZoneHandles,
    },
    submissionContract: {
      ownerAuthority: "character-agent",
      minPlanBlocks: timePolicy.minPlanBlocks,
      maxPlanBlocks: timePolicy.maxPlanBlocks,
      maxBlockSeconds: timePolicy.maxBlockSeconds,
      relativeHorizonSeconds: timePolicy.planningHorizonSeconds,
      allowedSourceIds: clone(ownedSourceIds),
      allowedZoneHandles: clone(allowedZoneHandles),
      forbiddenOutputAuthority: ["world", "action", "speech"],
      selection: null,
    },
  };
}

/**
 * Give one Character a private opportunity to plan within the current time policy.
 * The provider proposes rough blocks; characterLifeContinuity remains the sole
 * validator and write authority for the resulting private life plan.
 */
export async function runCharacterDayPlanningTurn({
  ownerCharacterId = "",
  agentTurnId = "",
  privateState = {},
  nowSeconds = 0,
  availableZoneHandles = [],
  timePolicy = characterTimePolicy(),
  temporalContext = {},
  runStage,
  signal,
  maxStageProtocolRepairs = 0,
  onStageAccepted,
  onStageRejected,
  executionOptions,
} = {}) {
  const owner = clean(ownerCharacterId);
  const now = nonNegativeNumber(nowSeconds);
  assertOwnedPlanningInputs(owner, privateState);
  if (typeof runStage !== "function") {
    throw fail(
      "CHARACTER_DAY_PLANNING_STAGE_REQUIRED",
      "A private day-planning turn requires an injected runStage function.",
    );
  }

  const stageInput = dayPlanningStageInput({
    ownerCharacterId: owner,
    agentTurnId,
    privateState,
    nowSeconds: now,
    availableZoneHandles,
    timePolicy: characterTimePolicy(timePolicy.mode),
    temporalContext,
  });
  const execution = await runCharacterMaintenanceStage({
    stageInput,
    stage: "character_day_planning",
    runStage,
    signal,
    maxStageProtocolRepairs,
    onStageAccepted,
    onStageRejected,
    executionOptions,
    settle(stageResult) {
      const submission = stageResult?.dayPlan || stageResult?.submission || stageResult;
      return settleCharacterDayPlan({
        ownerCharacterId: owner,
        currentLifePlanState: clone(privateState.lifePlanState || null),
        submission: clone(submission || {}),
        ownedSourceIds: clone(stageInput.referenceContract.ownedSourceIds),
        allowedZoneHandles: clone(stageInput.referenceContract.allowedZoneHandles),
        nowSeconds: now,
        horizonSeconds: stageInput.horizon.durationSeconds,
        minBlocks: stageInput.submissionContract.minPlanBlocks,
        maxBlocks: stageInput.submissionContract.maxPlanBlocks,
        maxBlockSeconds: stageInput.submissionContract.maxBlockSeconds,
      });
    },
  });
  const settled = execution.settled;

  return {
    schemaVersion: CHARACTER_DAY_PLANNING_TURN_VERSION,
    authority: "character-private-day-planning-turn",
    ownerCharacterId: owner,
    privateStatePatch: {
      lifePlanState: clone(settled.lifePlanState),
    },
    actionAttempt: null,
    worldChanged: false,
    stages: clone(execution.stages),
    protocolRepairCount: execution.protocolRepairCount,
  };
}
