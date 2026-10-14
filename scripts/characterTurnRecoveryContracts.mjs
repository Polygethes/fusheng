import assert from "node:assert/strict";
import { runTavernCharacterAgentTurnV2 } from "../src/server/pipeline/tavernCharacterAgentV2.mjs";
import { createTavernV27FixtureStageRunner } from "../src/server/pipeline/tavernV27FixtureStage.mjs";
import { createWorldCommitCoordinator } from "../src/server/simulation/worldCommitCoordinator.mjs";
import { createWorldActionRegistry } from "../src/server/simulation/worldActionRegistry.mjs";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { createTavernWorldRuntimeV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { runCharacterMaintenanceStage } from "../src/server/simulation/characterMaintenanceStageProtocol.mjs";
import { reconcileSettledTurnRecords, summarizeSettledSimulation } from "../src/server/simulation/settledSimulationReport.mjs";

const input = { agentTurnId: "agent-turn:recovery:1", submissionMode: "atomic", agent: { id: "recovery", name: "测试人物" }, scene: { id: "test", zoneId: "hall" } };
const fixture = createTavernV27FixtureStageRunner({ planForTurn: () => ({ intention: "歇息", primitive: "rest", visibleAction: "歇息。", utterance: "", texture: [], privateBasis: "本人歇息。" }) });
let executionCheckpoint = null;
const seen = [];
await assert.rejects(runTavernCharacterAgentTurnV2(input, { characterAgentCallMode: "three-call", maxStageProtocolRepairs: 2,
  onExecutionCheckpoint: state => { executionCheckpoint = structuredClone(state); },
  runStage: async (stageInput, options) => {
    seen.push(options.stage);
    if (options.stage === "agent_turn_commit") throw Object.assign(new Error("connection lost before response"), { code: "SIMULATED_DISCONNECT" });
    return fixture(stageInput, options);
  },
}), { code: "SIMULATED_DISCONNECT" });
assert.equal(executionCheckpoint?.acceptedStages?.length, 2, "accepted appraisal and choice must survive an expression-stage disconnect");
const before = structuredClone(executionCheckpoint);
const resumed = await runTavernCharacterAgentTurnV2(input, { characterAgentCallMode: "three-call", maxStageProtocolRepairs: 2,
  executionCheckpoint, onExecutionCheckpoint: state => { executionCheckpoint = structuredClone(state); },
  runStage: async (stageInput, options) => { seen.push(options.stage); return fixture(stageInput, options); },
});
assert.equal(resumed.session.finalDecision.actionAttempt.primitive, "rest");
assert.deepEqual(seen, ["subjective_appraisal_and_candidates", "agent_choice_and_regulation", "agent_turn_commit", "agent_turn_commit"]);
assert.equal(executionCheckpoint.callCount, 4, "a disconnected request is not erased from the lifetime budget");
assert.deepEqual(executionCheckpoint.acceptedStages.slice(0, 2), before.acceptedStages);

let invalidCalls = 0, rejectedCheckpoint;
const invalid = { characterAgentCallMode: "three-call", maxStageProtocolRepairs: 2,
  onExecutionCheckpoint: state => { rejectedCheckpoint = structuredClone(state); },
  runStage: async () => { invalidCalls += 1; return { nonsense: true }; },
};
await assert.rejects(runTavernCharacterAgentTurnV2({ ...input, agentTurnId: "agent-turn:invalid:1" }, invalid), { code: "CHARACTER_MODEL_SUSPENDED" });
assert.equal(invalidCalls, 3, "an always-invalid model gets the first request and exactly two repairs");
await assert.rejects(runTavernCharacterAgentTurnV2({ ...input, agentTurnId: "agent-turn:invalid:1" }, { ...invalid, executionCheckpoint: rejectedCheckpoint }), { code: "CHARACTER_MODEL_SUSPENDED" });
assert.equal(invalidCalls, 3, "resuming cannot reset a spent repair budget");

const world = { worldId: "world:recovery", entities: { a: { id: "a", kind: "character", present: true, placeId: "inn", zoneId: "hall" } }, places: { inn: { topology: { zones: { hall: {} }, edges: [] } } } };
const coordinator = createWorldCommitCoordinator({ worldId: world.worldId, initialWorldState: world, actionRegistry: createWorldActionRegistry() });
const attempt = { attemptId: "same-key", actorId: "a", primitive: "rest", payload: {} };
const first = await coordinator.submitActionAttempt(attempt);
assert.deepEqual(await coordinator.submitActionAttempt(attempt), first);
await assert.rejects(coordinator.submitActionAttempt({ ...attempt, primitive: "speak", payload: { utterance: "换一个行动" } }), { code: "WORLD_ACTION_IDEMPOTENCY_CONFLICT" });
const restored = createWorldCommitCoordinator({ worldId: world.worldId, checkpoint: coordinator.checkpoint(), actionRegistry: createWorldActionRegistry() });
assert.deepEqual(await restored.submitActionAttempt(attempt), first);
await assert.rejects(restored.submitActionAttempt({ ...attempt, actorId: "b" }), { code: "WORLD_ACTION_IDEMPOTENCY_CONFLICT" });
assert.equal(restored.journal.events.length, 1);

const XIE = "char_xyy_xiezenshi", ZHOU = "char_xyy_zhoumin";
const seed = buildPlayableWorldFromSetup({ setupWorldPrompt: "逍遥游，望梯酒馆", setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚" });
for (const faultPhase of ["world_attempt_prepared", "world_outcome_committed"]) {
  let saved, crashed = false, calls = 0;
  const instance = createTavernWorldRuntimeV27(seed, { characterIds: [XIE, ZHOU], positions: { [XIE]: "hall", [ZHOU]: "hall" },
    runStage: async (...args) => { calls += 1; return fixture(...args); },
    async onExecutionCheckpoint(event) {
      saved = await instance.runtime.checkpoint();
      if (event.phase === faultPhase && !crashed) { crashed = true; throw Object.assign(new Error("simulated process exit"), { code: "SIMULATED_CRASH" }); }
    },
  });
  await instance.runtime.enqueueWake(XIE, { wakeId: `crash:${faultPhase}`, kind: "opportunity_window", evidence: [], evidenceIds: [] });
  await assert.rejects(instance.runtime.runNext(), { code: "SIMULATED_CRASH" });
  assert.equal(calls, 3);
  const recovered = createTavernWorldRuntimeV27(seed, { checkpoint: saved, characterIds: [XIE, ZHOU], runStage: () => assert.fail("an accepted turn must resume its outbox without another model call") });
  const turn = await recovered.runtime.runNext({ characterId: XIE });
  assert.equal(turn.outcome.status, "success");
  assert.equal(recovered.coordinator.journal.events.filter(row => row.type === "action_resolved").length, 1);
  assert.equal(recovered.runtime.actors.get(XIE).turnSequence, 1);
  assert.equal(recovered.runtime.actors.get(XIE).pendingTurn, null);
  assert.equal((await recovered.runtime.checkpoint()).completedTurnRecords.length, 1);
  const recoveredCheckpoint = await recovered.runtime.checkpoint();
  const recoveredReport = reconcileSettledTurnRecords(recoveredCheckpoint, []);
  assert.equal(recoveredReport.length, 1, "a completed world turn can rebuild a missing outer report row");
  assert.equal(recoveredReport[0].outcome.status, "success");
  assert.equal(reconcileSettledTurnRecords(recoveredCheckpoint, recoveredReport).length, 1);
  assert.equal(summarizeSettledSimulation({ checkpoint: recoveredCheckpoint, turns: recoveredReport, requestedTurns: 1 }).stopReason, "turn_limit_reached");
  for (const runtime of [instance.runtime, recovered.runtime]) for (const actor of runtime.actors.values()) await actor.close();
}

let maintenanceCheckpoint, maintenanceCalls = 0;
const maintenanceInput = { agentTurnId: "maintenance:1", phase: "awaiting_character_day_planning", characterId: "a", submissionContract: { ownerAuthority: "character-agent" } };
const maintenanceOptions = { stageInput: maintenanceInput, stage: "character_day_planning", maxStageProtocolRepairs: 2,
  runStage: async () => { maintenanceCalls++; return {}; },
  settle: () => { throw Object.assign(new Error("bad owner"), { code: "CHARACTER_DAY_PLAN_AUTHORITY_INVALID" }); },
  executionOptions: { onCheckpoint: value => { maintenanceCheckpoint = structuredClone(value); } } };
await assert.rejects(runCharacterMaintenanceStage(maintenanceOptions), { code: "CHARACTER_MODEL_SUSPENDED" });
assert.equal(maintenanceCalls, 3);
await assert.rejects(runCharacterMaintenanceStage({ ...maintenanceOptions, executionOptions: { ...maintenanceOptions.executionOptions, checkpoint: maintenanceCheckpoint } }), { code: "CHARACTER_MODEL_SUSPENDED" });
assert.equal(maintenanceCalls, 3, "maintenance-stage budgets survive restart too");

const waitFixture = createTavernV27FixtureStageRunner({ planForTurn: () => ({ intention: "等十分钟再决定", primitive: "wait", utterance: "", visibleAction: "", texture: [], privateBasis: "本人选择期限。",
  waitCondition: { condition: "deadline", maximumSeconds: 600, interruptOnDirectSpeech: true } }) });
const waitInstance = createTavernWorldRuntimeV27(seed, { characterIds: [XIE], runStage: waitFixture });
await waitInstance.runtime.enqueueWake(XIE, { wakeId: "wait", kind: "opportunity_window" });
const waitTurn = await waitInstance.runtime.runNext();
assert.equal(waitTurn?.outcome?.primitive, "wait", "the production three-call bridge retains the Character's wait condition");
assert.equal(waitTurn.outcome.status, "success");
for (const actor of waitInstance.runtime.actors.values()) await actor.close();
console.log("Character recovery contracts passed: frozen accepted decisions, persisted budgets, finite invalid model, durable idempotency conflict rejection.");
