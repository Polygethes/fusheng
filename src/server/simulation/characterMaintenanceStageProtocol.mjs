import { createCharacterTurnExecution } from "./characterTurnExecution.mjs";
import { prepareCharacterStageSubmission } from "./characterStageSubmission.mjs";

const SAFE_REPAIR_ISSUES = Object.freeze({
  CHARACTER_DAY_PLAN_SUBMISSION_INVALID: Object.freeze({
    path: "submission",
    message: "Submit one complete day-plan object for the current Character and stage.",
  }),
  CHARACTER_DAY_PLAN_FIELD_FORBIDDEN: Object.freeze({
    path: "submission",
    message: "Remove fields that claim identity, action, speech, or world-write authority.",
  }),
  CHARACTER_DAY_PLAN_BLOCK_COUNT_INVALID: Object.freeze({
    path: "submission.planBlocks",
    message: "Use the minimum and maximum block counts in the current submissionContract.",
  }),
  CHARACTER_DAY_PLAN_BLOCK_TOO_LONG: Object.freeze({
    path: "submission.planBlocks[]",
    message: "Keep each near-term block within submissionContract.maxBlockSeconds. Do not stretch a short activity to fill the horizon.",
  }),
  CHARACTER_DAY_PLAN_TIME_INVALID: Object.freeze({
    path: "submission.planBlocks[].relativeStartSeconds",
    message: "Each block needs finite non-negative times with its start before its end.",
  }),
  CHARACTER_DAY_PLAN_TIME_OUT_OF_HORIZON: Object.freeze({
    path: "submission.planBlocks[]",
    message: "Keep every block inside the supplied private planning horizon.",
  }),
  CHARACTER_DAY_PLAN_BLOCKS_OVERLAP: Object.freeze({
    path: "submission.planBlocks",
    message: "Day-plan blocks cannot overlap.",
  }),
  CHARACTER_DAY_PLAN_AUTHORITY_INVALID: Object.freeze({
    path: "submission.ownerAuthority",
    message: "Use character-agent authority for this private plan.",
  }),
  CHARACTER_DAY_PLAN_BLOCK_INVALID: Object.freeze({
    path: "submission.planBlocks[]",
    message: "Each block needs an activity, private purpose, and owned source references.",
  }),
  CHARACTER_DAY_PLAN_SOURCE_NOT_OWNED: Object.freeze({
    path: "submission.planBlocks[].sourceIds",
    message: "Use only source ids allowed by this stage's reference contract.",
  }),
  CHARACTER_DAY_PLAN_ZONE_NOT_ALLOWED: Object.freeze({
    path: "submission.planBlocks[].desiredZoneHandle",
    message: "Use an allowed zone handle or leave the handle empty.",
  }),
  CHARACTER_REFLECTION_AUTHORITY_INVALID: Object.freeze({
    path: "submission.ownerAuthority",
    message: "Use character-agent authority for this private reflection.",
  }),
  CHARACTER_REFLECTION_WORLD_WRITE_FORBIDDEN: Object.freeze({
    path: "submission",
    message: "Remove action, speech, relationship, or world-write fields from private reflection.",
  }),
  CHARACTER_REFLECTION_INSIGHT_LIMIT_EXCEEDED: Object.freeze({
    path: "submission.insights",
    message: "Submit at most five private insights.",
  }),
  CHARACTER_REFLECTION_PROPOSITION_REQUIRED: Object.freeze({
    path: "submission.insights[].proposition",
    message: "Each submitted insight needs a proposition.",
  }),
  CHARACTER_REFLECTION_SOURCE_NOT_OWNED: Object.freeze({
    path: "submission.insights[].sourceMemoryIds",
    message: "Use only source memory ids allowed by this reflection opportunity.",
  }),
});

function clone(value) {
  if (value === undefined) return undefined;
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function clean(value = "") {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

function safeRepairIssue(error = {}) {
  const code = clean(error?.code);
  const definition = SAFE_REPAIR_ISSUES[code];
  if (!definition) return null;
  return {
    code,
    path: definition.path,
    message: definition.message,
  };
}

function annotateStageFailure(error, {
  stageInput,
  stage,
  protocolRepairAttempts = 0,
} = {}) {
  if (!error || typeof error !== "object") return error;
  error.failedPhase = clean(stageInput?.phase);
  error.failedStage = clean(stage);
  error.characterId = clean(stageInput?.characterId);
  error.agentTurnId = clean(stageInput?.agentTurnId);
  error.protocolRepairAttempts = Math.max(0, Math.floor(Number(protocolRepairAttempts || 0)));
  return error;
}

function repairFeedback(issue, { stageInput, stage, attempt } = {}) {
  return {
    authority: "character-agent-protocol-validator",
    operation: "same-character-same-stage-rewrite",
    attempt,
    phase: clean(stageInput?.phase),
    stage: clean(stage),
    violations: [clone(issue)],
    rule: "Rewrite the complete current-stage output yourself. Fix only the listed protocol or owned-reference violation; do not advance stages or add action, speech, world facts, plans, or insights on the validator's behalf.",
  };
}

/**
 * Run one Character-owned maintenance stage and settle its private output.
 *
 * This is the only protocol-repair loop used by day planning and reflection.
 * Settlement remains injected so each domain keeps its own validation and
 * private write authority. Repair feedback is assembled exclusively from a
 * closed safe-message table; rejected private output and error evidence never
 * cross into callbacks or the next provider request.
 */
export async function runCharacterMaintenanceStage({
  stageInput = {},
  stage = "",
  runStage,
  settle,
  signal,
  maxStageProtocolRepairs = 0,
  onStageAccepted,
  onStageRejected,
  executionOptions,
} = {}) {
  if (typeof runStage !== "function") throw new TypeError("runStage must be a function.");
  if (typeof settle !== "function") throw new TypeError("settle must be a function.");

  const journal = executionOptions ? createCharacterTurnExecution({ input: stageInput,
    protocolVersion: "character-maintenance-v2", checkpoint: executionOptions.checkpoint,
    maxRepairs: maxStageProtocolRepairs, onCheckpoint: executionOptions.onCheckpoint }) : null;
  const baseInput = journal?.initialInput || clone(stageInput || {});
  const fixedStage = clean(stage || baseInput.stage);
  const repairLimit = Math.max(0, Math.min(2, Math.floor(Number(maxStageProtocolRepairs || 0))));
  const stages = [];
  let protocolRepairCount = journal?.repairAttempts || 0;
  let feedback = journal?.repairFeedback || null;
  const accepted = journal?.acceptedStage(fixedStage);
  if (accepted) return { settled: clone(accepted.session.settled), stages: accepted.resultStage ? [clone(accepted.resultStage)] : [], protocolRepairCount };

  while (true) {
    let invocationInput = feedback
      ? { ...clone(baseInput), protocolRepairFeedback: clone(feedback) }
      : clone(baseInput);
    let stageResult;
    try {
      if (journal) invocationInput = await journal.prepareStage(fixedStage, invocationInput, executionOptions.schemaForInput?.(baseInput) || baseInput.submissionContract);
      if (journal?.hasPendingResponse) stageResult = journal.pendingResponse;
      else {
        if (journal) await journal.beforeModelCall();
        const invocationOptions = { signal, stage: fixedStage,
          ownerCharacterId: clean(baseInput.ownerCharacterId || baseInput.characterId), protocolRepairAttempt: protocolRepairCount };
        if (journal) Object.defineProperty(invocationOptions, "onResponseReceived", { value: response => journal.receiveResponse(response) });
        stageResult = await runStage(clone(invocationInput), invocationOptions);
        if (journal) await journal.receiveResponse(stageResult);
      }
    } catch (error) {
      throw annotateStageFailure(error, {
        stageInput: invocationInput,
        stage: fixedStage,
        protocolRepairAttempts: protocolRepairCount,
      });
    }
    if (stageResult?.stage) stages.push(clone(stageResult.stage));

    let settled;
    try {
      if (journal && executionOptions.schemaForInput) {
        const key = { character_day_planning: "dayPlan", character_reflection: "reflection" }[fixedStage];
        const output = stageResult?.[key] ?? stageResult?.submission ?? stageResult;
        const checked = prepareCharacterStageSubmission(baseInput, output, executionOptions.schemaForInput(baseInput));
        if (!checked.valid) throw Object.assign(new Error("Maintenance output violates its frozen schema."), { code: "CHARACTER_STAGE_OUTPUT_INVALID", issues: checked.issues });
        stageResult = stageResult?.[key] ? { ...stageResult, [key]: checked.output } : checked.output;
      }
      settled = await settle(stageResult, clone(invocationInput));
    } catch (error) {
      const issue = safeRepairIssue(error);
      if (journal) {
        if (!issue && error.code !== "CHARACTER_STAGE_OUTPUT_INVALID") throw error;
        const issues = issue ? [clone(issue)] : clone(error.issues || []);
        feedback = repairFeedback(issues[0], { stageInput: baseInput, stage: fixedStage, attempt: journal.repairAttempts + 1 });
        if (onStageRejected) await onStageRejected({ stage: fixedStage, phase: baseInput.phase, agentTurnId: baseInput.agentTurnId,
          characterId: baseInput.characterId || baseInput.ownerCharacterId, repairAttempt: journal.repairAttempts + 1, issues });
        await journal.rejectStage({ issues }, feedback);
        protocolRepairCount = journal.repairAttempts;
        continue;
      }
      const mayRepair = issue && protocolRepairCount < repairLimit;
      if (mayRepair) protocolRepairCount += 1;
      if (typeof onStageRejected === "function") {
        await onStageRejected({
          stage: fixedStage,
          phase: clean(baseInput.phase),
          agentTurnId: clean(baseInput.agentTurnId),
          characterId: clean(baseInput.characterId || baseInput.ownerCharacterId),
          repairAttempt: protocolRepairCount,
          issues: issue ? [clone(issue)] : [],
        });
      }
      if (!mayRepair) {
        throw annotateStageFailure(error, {
          stageInput: invocationInput,
          stage: fixedStage,
          protocolRepairAttempts: protocolRepairCount,
        });
      }
      feedback = repairFeedback(issue, {
        stageInput: baseInput,
        stage: fixedStage,
        attempt: protocolRepairCount,
      });
      continue;
    }

    if (journal) await journal.acceptStage(fixedStage, { phase: "ready_for_world_resolution", settled }, stageResult);
    if (typeof onStageAccepted === "function") {
      await onStageAccepted({
        stage: fixedStage,
        phase: clean(baseInput.phase),
        agentTurnId: clean(baseInput.agentTurnId),
        characterId: clean(baseInput.characterId || baseInput.ownerCharacterId),
      });
    }
    return {
      settled,
      stages: clone(stages),
      protocolRepairCount,
    };
  }
}
