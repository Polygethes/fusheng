import assert from "node:assert/strict";
import { createLocalCharacterRuntimePort } from "../src/server/simulation/characterRuntimePort.mjs";
import { createCharacterSessionActor } from "../src/server/simulation/characterSessionActor.mjs";
import { createWorldActionRegistry } from "../src/server/simulation/worldActionRegistry.mjs";
import { createWorldCommitCoordinator } from "../src/server/simulation/worldCommitCoordinator.mjs";
import { createCharacterWorldRuntime } from "../src/server/simulation/characterWorldRuntime.mjs";

const events = [];
const actor = createCharacterSessionActor({ characterId: "a", runtimePort: createLocalCharacterRuntimePort({ async runTurn(input) {
  const reflection = input.wake.kind === "reflection_due";
  events.push({ kind: reflection ? "reflection" : "wait", at: input.worldProjection.nowSeconds });
  return { characterId: "a", agentTurnId: input.agentTurnId, privateResult: { turnKind: reflection ? "reflection" : "action" },
    privateStatePatch: reflection ? { reflectionState: { pendingOpportunity: null } } : {},
    actionAttempt: reflection ? null : { primitive: "wait", payload: { targetCharacterId: "b", waitCondition: { condition: "target_speech", maximumSeconds: 300, interruptOnDirectSpeech: true } } } };
} }) });
const coordinator = createWorldCommitCoordinator({ worldId: "wait-loop", initialWorldState: { worldId: "wait-loop", nowSeconds: 0,
  timePolicy: { mode: "scene", repeatedWaitReviewLimit: 2 },
  temporalAgenda: [{ id: "notice", label: "已知时限", placeId: "inn", status: "pending", warningAtSeconds: 1000, dueAtSeconds: 1200, conditions: [] }],
  entities: { a: { id: "a", kind: "character", present: true, placeId: "inn", zoneId: "hall" }, b: { id: "b", kind: "character", present: true, placeId: "inn", zoneId: "hall" } },
  places: { inn: { topology: { zones: { hall: {} }, edges: [] } } } }, actionRegistry: createWorldActionRegistry() });
const runtime = createCharacterWorldRuntime({ coordinator, actors: [actor], situationProjector: ({ characterId, worldState, wake }) => ({
  authority: "recipient-specific-world-projection", recipientCharacterId: characterId, nowSeconds: worldState.nowSeconds, evidence: wake.evidence || [] }) });
await runtime.enqueueWake("a", { kind: "opportunity_window", wakeId: "start" });
await runtime.runUntilIdle({ maxTurns: 5 });
assert.ok(events.some(row => row.kind === "reflection"), "expired waits must earn a private review instead of clearing their loop count");
assert.equal(actor.executionControl.status, "stalled", "repeating the same unsatisfied wait after review cannot consume the remaining turn budget");
assert.ok(events.length <= 6, JSON.stringify(events));
assert.equal(events.filter(row => row.kind === "wait")[1].at, 300, "quiet waiting advances by minutes without polling");
const resumed = await runtime.runNext();
assert.ok(resumed, "an actual scheduled world event reawakens a stalled Character");
assert.equal(actor.executionControl.status, "active");
assert.equal(coordinator.worldState.nowSeconds, 1000);
assert.equal(actor.executionControl.resumedFrom.code, "REPEATED_WAIT_WITHOUT_CHANGE");
const oldNotice = coordinator.journal.events.find(row => row.type === "world_deadline_warning").publicPayload;
actor.executionControl.status = "stalled";
actor.executionControl.reason = { code: "REPEATED_WAIT_WITHOUT_CHANGE" };
const replayRuntime = createCharacterWorldRuntime({ coordinator: {
  get worldState() { return coordinator.worldState; }, get journal() { return coordinator.journal; },
  submitActionAttempt: attempt => coordinator.submitActionAttempt(attempt),
  advanceWorldProcesses: async () => structuredClone(oldNotice),
  advanceWorldTemporalAgenda: async () => null,
}, actors: [actor], receiptLedger: runtime.receiptLedger, situationProjector: () => ({}) });
assert.equal(await replayRuntime.runNext({ notAfterSeconds: 1000 }), null);
assert.equal(actor.executionControl.status, "stalled", "replaying an old deadline cannot create another recovery opportunity");
await actor.close();
let cycleIndex = 0;
const cycleTurns = [];
const cycleActor = createCharacterSessionActor({ characterId: "a", runtimePort: createLocalCharacterRuntimePort({ async runTurn(input) {
  const reflection = input.wake.kind === "reflection_due";
  const primitive = reflection ? "reflection" : ["observe", "listen", "rest"][cycleIndex++ % 3];
  cycleTurns.push(primitive);
  return { characterId: "a", agentTurnId: input.agentTurnId, privateResult: { turnKind: reflection ? "reflection" : "action" },
    privateStatePatch: reflection ? { reflectionState: { pendingOpportunity: null } } : { ecologyState: { characterPsychologyV2State: {
      continuationIntentions: [{ intentionId: "continue", status: "active", triggerType: "own_action_settled" }] } } },
    actionAttempt: reflection ? null : { primitive, payload: {} } };
} }) });
const cycleWorld = coordinator.checkpoint().worldState;
cycleWorld.temporalAgenda = [];
const cycleCoordinator = createWorldCommitCoordinator({ worldId: "wait-loop", initialWorldState: cycleWorld, actionRegistry: createWorldActionRegistry() });
const cycleRuntime = createCharacterWorldRuntime({ coordinator: cycleCoordinator, actors: [cycleActor], situationProjector: ({ worldState }) => ({ authority: "recipient-specific-world-projection", recipientCharacterId: "a", nowSeconds: worldState.nowSeconds, evidence: [] }) });
await cycleRuntime.enqueueWake("a", { wakeId: "cycle", kind: "opportunity_window" });
await cycleRuntime.runUntilIdle({ maxTurns: 15 });
assert.equal(cycleActor.executionControl.status, "stalled", "alternating look/listen/rest cannot evade the progress review");
assert.equal(cycleActor.executionControl.reason.code, "PASSIVE_CYCLE_WITHOUT_CHANGE");
assert.ok(cycleTurns.includes("reflection"));
assert.ok(cycleTurns.length <= 8, JSON.stringify(cycleTurns));
await cycleActor.close();
console.log("Repeated wait: minute-scale jumps, review and bounded stop passed.");
