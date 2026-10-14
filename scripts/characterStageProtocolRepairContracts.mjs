import assert from "node:assert/strict";

import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { createTavernV27FixtureStageRunner } from "../src/server/pipeline/tavernV27FixtureStage.mjs";
import { createTavernWorldRuntimeV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";

const XIE_ZHENSHI = "char_xyy_xiezenshi";
const LUO_ZHAO = "char_xyy_luozhao";

function seedState() {
  return buildPlayableWorldFromSetup({
    setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
    setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
  });
}

function invalidAuthorityResult(valid = {}) {
  const merged = structuredClone(valid.appraisalAndCandidates || {});
  return {
    ...structuredClone(valid),
    appraisalAndCandidates: {
      ...merged,
      appraisal: {
        ...structuredClone(merged.appraisal || {}),
        ownerAuthority: "world",
      },
    },
  };
}

function invalidAtomicCommitResult(valid = {}) {
  return {
    ...structuredClone(valid),
    turnCommit: {
      ...structuredClone(valid.turnCommit || {}),
      privateExpressionTrace: {
        ...structuredClone(valid.turnCommit?.privateExpressionTrace || {}),
        releasedMeaning: "旧表达规划字段不得在原子提交中自我认证",
      },
    },
  };
}

const fixture = createTavernV27FixtureStageRunner();
const calls = [];
const repairingRuntime = createTavernWorldRuntimeV27(seedState(), {
  positions: { [XIE_ZHENSHI]: "hall", [LUO_ZHAO]: "hall" },
  maxStageProtocolRepairs: 1,
  async runStage(input, options) {
    calls.push({ input: structuredClone(input), stage: options.stage });
    const valid = await fixture(input, options);
    if (options.stage === "subjective_appraisal_and_candidates" && !input.protocolRepairFeedback) {
      return invalidAuthorityResult(valid);
    }
    return valid;
  },
});

await repairingRuntime.runtime.enqueueWake(XIE_ZHENSHI, {
  wakeId: "wake:stage-repair:valid-after-one-repair",
  kind: "opportunity_window",
  evidenceIds: [],
  evidence: [],
});
const repairedTurn = await repairingRuntime.runtime.runNext({ characterId: XIE_ZHENSHI });
assert.equal(repairedTurn.outcome.status, "success");
assert.deepEqual(calls.map((row) => row.stage), [
  "subjective_appraisal_and_candidates",
  "subjective_appraisal_and_candidates",
  "agent_choice_and_regulation",
  "agent_turn_commit",
], "one rejected merged appraisal plus the accepted stages of the same turn must be visible");
assert.equal(calls.length, 4);
assert.equal(calls[0].input.agentTurnId, calls[1].input.agentTurnId);
assert.equal(calls[1].input.protocolRepairFeedback.attempt, 1);
assert.equal(calls[1].input.protocolRepairFeedback.phase, "awaiting_subjective_appraisal_and_candidates");
assert.ok(calls[1].input.protocolRepairFeedback.violations.some((row) => (
  row.code === "STAGE_OUTPUT_ENUM" && row.path === "output.appraisal.ownerAuthority"
)), "a world-owned appraisal must be rejected at its own path so the Character can repair it");
assert.equal(repairingRuntime.coordinator.journal.events.length, 1);

const alwaysInvalidFixture = createTavernV27FixtureStageRunner();
let invalidCallCount = 0;
const stoppingRuntime = createTavernWorldRuntimeV27(seedState(), {
  positions: { [XIE_ZHENSHI]: "hall", [LUO_ZHAO]: "hall" },
  maxStageProtocolRepairs: 1,
  async runStage(input, options) {
    invalidCallCount += 1;
    return invalidAuthorityResult(await alwaysInvalidFixture(input, options));
  },
});
await stoppingRuntime.runtime.enqueueWake(XIE_ZHENSHI, {
  wakeId: "wake:stage-repair:still-invalid",
  kind: "opportunity_window",
  evidenceIds: [],
  evidence: [],
});
await assert.rejects(stoppingRuntime.runtime.runNext({ characterId: XIE_ZHENSHI }), { code: "SIMULATION_PARTICIPANT_UNAVAILABLE" });
assert.equal(invalidCallCount, 2, "one failed repair must stop without a third model call");
assert.equal(stoppingRuntime.runtime.executionStatus.status, "suspended_model_error");
assert.equal(stoppingRuntime.runtime.executionStatus.actors[0].characterId, XIE_ZHENSHI);
assert.equal(stoppingRuntime.runtime.executionStatus.actors[0].reason.code, "CHARACTER_MODEL_SUSPENDED");
assert.equal(stoppingRuntime.runtime.executionStatus.actors[0].reason.agentTurnId, `agent-turn:${XIE_ZHENSHI}:1`);
assert.equal(stoppingRuntime.coordinator.journal.events.length, 0, "protocol repair may not fabricate a world event");

const expressionFixture = createTavernV27FixtureStageRunner();
const expressionCalls = [];
const expressionRepairRuntime = createTavernWorldRuntimeV27(seedState(), {
  positions: { [XIE_ZHENSHI]: "hall", [LUO_ZHAO]: "hall" },
  maxStageProtocolRepairs: 1,
  async runStage(input, options) {
    expressionCalls.push({ input: structuredClone(input), stage: options.stage });
    const valid = await expressionFixture(input, options);
    if (options.stage === "agent_turn_commit" && !input.protocolRepairFeedback) {
      return invalidAtomicCommitResult(valid);
    }
    return valid;
  },
});
await expressionRepairRuntime.runtime.enqueueWake(XIE_ZHENSHI, {
  wakeId: "wake:stage-repair:expression-valid-after-repair",
  kind: "opportunity_window",
  evidenceIds: [],
  evidence: [],
});
const expressionRepairedTurn = await expressionRepairRuntime.runtime.runNext({ characterId: XIE_ZHENSHI });
assert.equal(expressionRepairedTurn.outcome.status, "success");
assert.equal(expressionCalls.length, 4, "one rejected atomic commit plus the accepted stages and its repair must be visible");
assert.equal(expressionCalls[2].stage, "agent_turn_commit");
assert.equal(expressionCalls[3].stage, "agent_turn_commit");
assert.ok(expressionCalls[3].input.protocolRepairFeedback.violations.some((row) => (
  row.code === "STAGE_OUTPUT_UNKNOWN_FIELD" && row.path === "output.privateExpressionTrace.releasedMeaning"
)), "a legacy expression-planning field cannot self-certify inside the atomic commit");
assert.equal(expressionRepairRuntime.coordinator.journal.events.length, 1);

const sharedBudgetFixture = createTavernV27FixtureStageRunner();
let sharedBudgetCallCount = 0;
const sharedBudgetRejections = [];
const sharedBudgetRuntime = createTavernWorldRuntimeV27(seedState(), {
  positions: { [XIE_ZHENSHI]: "hall", [LUO_ZHAO]: "hall" },
  maxStageProtocolRepairs: 1,
  onStageRejected(event) {
    sharedBudgetRejections.push({ stage: event.stage, repairAttempt: event.repairAttempt });
  },
  async runStage(input, options) {
    sharedBudgetCallCount += 1;
    const valid = await sharedBudgetFixture(input, options);
    if (options.stage === "subjective_appraisal_and_candidates" && !input.protocolRepairFeedback) {
      return invalidAuthorityResult(valid);
    }
    if (options.stage === "agent_turn_commit") {
      return invalidAtomicCommitResult(valid);
    }
    return valid;
  },
});
await sharedBudgetRuntime.runtime.enqueueWake(XIE_ZHENSHI, {
  wakeId: "wake:stage-repair:one-budget-for-full-turn",
  kind: "opportunity_window",
  evidenceIds: [],
  evidence: [],
});
await assert.rejects(sharedBudgetRuntime.runtime.runNext({ characterId: XIE_ZHENSHI }), { code: "SIMULATION_PARTICIPANT_UNAVAILABLE" });
assert.deepEqual(sharedBudgetRejections, [
  { stage: "subjective_appraisal_and_candidates", repairAttempt: 1 },
  { stage: "agent_turn_commit", repairAttempt: 2 },
], "the rejected atomic commit must be reported beyond the shared budget instead of being repaired again");
assert.equal(sharedBudgetCallCount, 4, "a repair used by appraisal must not be available again at atomic commit");
assert.equal(sharedBudgetRuntime.runtime.executionStatus.status, "suspended_model_error");
assert.equal(sharedBudgetRuntime.coordinator.journal.events.length, 0);

const laterStageFixture = createTavernV27FixtureStageRunner();
const laterStageRuntime = createTavernWorldRuntimeV27(seedState(), {
  positions: { [XIE_ZHENSHI]: "hall", [LUO_ZHAO]: "hall" },
  maxStageProtocolRepairs: 1,
  async runStage(input, options) {
    if (options.stage === "agent_choice_and_regulation") {
      const error = new Error("Synthetic provider failure after appraisal.");
      error.code = "SYNTHETIC_PROVIDER_FAILURE";
      throw error;
    }
    return laterStageFixture(input, options);
  },
});
await laterStageRuntime.runtime.enqueueWake(XIE_ZHENSHI, {
  wakeId: "wake:stage-repair:later-stage-diagnostic",
  kind: "opportunity_window",
  evidenceIds: [],
  evidence: [],
});
await assert.rejects(
  laterStageRuntime.runtime.runNext({ characterId: XIE_ZHENSHI }),
  (error) => (
    error?.code === "SYNTHETIC_PROVIDER_FAILURE"
    && error?.failedPhase === "awaiting_agent_choice_and_regulation"
    && error?.failedStage === "agent_choice_and_regulation"
    && error?.characterId === XIE_ZHENSHI
    && error?.agentTurnId === "agent-turn:char_xyy_xiezenshi:1"
  ),
);
assert.equal(laterStageRuntime.coordinator.journal.events.length, 0);

const PRIVATE_SOURCE_SECRET = "PRIVATE_SOURCE_SECRET";
const safeRepairFixture = createTavernV27FixtureStageRunner();
const safeRepairInputs = [];
const safeRejectedEvents = [];
const safeRepairRuntime = createTavernWorldRuntimeV27(seedState(), {
  positions: { [XIE_ZHENSHI]: "hall", [LUO_ZHAO]: "hall" },
  maxStageProtocolRepairs: 1,
  onStageRejected(event) {
    safeRejectedEvents.push(structuredClone(event));
  },
  async runStage(input, options) {
    safeRepairInputs.push(structuredClone(input));
    const valid = await safeRepairFixture(input, options);
    if (options.stage === "agent_choice_and_regulation" && !input.protocolRepairFeedback) {
      valid.choice.automaticCommunicationImpulse.motiveSourceIds = [PRIVATE_SOURCE_SECRET];
    }
    return valid;
  },
});
await safeRepairRuntime.runtime.enqueueWake(XIE_ZHENSHI, {
  wakeId: "wake:stage-repair:sanitize-private-reference",
  kind: "opportunity_window",
  evidenceIds: [],
  evidence: [],
});
const safeRepairedTurn = await safeRepairRuntime.runtime.runNext({ characterId: XIE_ZHENSHI });
assert.equal(safeRepairedTurn.outcome.status, "success");
const repairedChoiceInput = safeRepairInputs.find((input) => (
  input.phase === "awaiting_agent_choice_and_regulation" && input.protocolRepairFeedback
));
assert.ok(repairedChoiceInput);
for (const exposed of [repairedChoiceInput.protocolRepairFeedback, ...safeRejectedEvents]) {
  const serialized = JSON.stringify(exposed);
  assert.equal(serialized.includes(PRIVATE_SOURCE_SECRET), false,
    "provider repair input and rejection callbacks must not echo private source ids");
  assert.equal(serialized.includes("Unknown private motive source"), false,
    "provider repair input and rejection callbacks must not echo raw validator messages");
  assert.ok(exposed.issues?.every((row) => (
    row.code && row.path && row.message === "Revise the submitted value at this path to satisfy the current stage schema and owned-reference contract."
  )) || exposed.violations?.every((row) => (
    row.code && row.path && row.message === "Revise the submitted value at this path to satisfy the current stage schema and owned-reference contract."
  )));
}

// Reproduce the feasibility label returned by the real sol/medium run. The
// repair must explain the contract without echoing private validator evidence.
let feasibilityFeedback;
const feasibilityFixture = createTavernV27FixtureStageRunner();
const feasibilityRuntime = createTavernWorldRuntimeV27(seedState(), {
  positions: { [XIE_ZHENSHI]: "hall", [LUO_ZHAO]: "threshold" },
  maxStageProtocolRepairs: 1,
  async runStage(input, options) {
    if (input.protocolRepairFeedback) {
      feasibilityFeedback = input.protocolRepairFeedback;
      throw Object.assign(new Error("Captured repair input"), { code: "TEST_REPAIR_CAPTURED" });
    }
    const valid = await feasibilityFixture(input, options);
    if (options.stage === "subjective_appraisal_and_candidates") {
      const surface = input.worldProjection.actionFeasibilities.find(row => (
        row.bindingKind === "object" && !(row.knownPrerequisiteOptions || []).length
      ));
      assert.ok(surface, "the repro needs a directly manipulable object without prerequisite steps");
      const candidate = valid.appraisalAndCandidates.candidates.candidates[0];
      candidate.attemptPrimitive = "interact";
      candidate.targetHandle = surface.targetHandle;
      candidate.actionBinding = { kind: "object", objectId: surface.targetHandle };
      candidate.feasibilityHandling = {
        surfaceId: surface.feasibilityId, relationToGoal: "prerequisite_step", stance: "follow",
        privateReason: "检查随身物件，为后续行动做准备。",
      };
    }
    return valid;
  },
});
await feasibilityRuntime.runtime.enqueueWake(LUO_ZHAO, {
  wakeId: "wake:stage-repair:real-feasibility-label", kind: "opportunity_window", evidenceIds: [], evidence: [],
});
await assert.rejects(feasibilityRuntime.runtime.runNext({ characterId: LUO_ZHAO }), { code: "TEST_REPAIR_CAPTURED" });
const feasibilityViolation = feasibilityFeedback.violations.find(row => (
  row.code === "AGENT_CANDIDATE_PREREQUISITE_STEP_MISMATCH"
));
assert.ok(feasibilityViolation);
assert.match(feasibilityViolation.message, /knownPrerequisiteOptions/,
  "the Character must be told which existing contract its prerequisite claim violated");
assert.equal(feasibilityRuntime.coordinator.journal.events.length, 0);

console.log(JSON.stringify({
  status: "all-passed",
  checks: {
    sameCharacterRepairsSameStage: true,
    validatorOnlyReturnsViolations: true,
    repairDoesNotWriteWorld: true,
    oneFailedRepairStops: true,
    atomicTurnCommitCanUseTurnRepair: true,
    oneRepairBudgetIsSharedAcrossTurn: true,
    everyStageFailureCarriesSafeLocation: true,
    privateProtocolEvidenceNeverEchoesToProviderOrCallback: true,
  },
}, null, 2));
