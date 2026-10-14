import assert from "node:assert/strict";
import { createLocalCharacterRuntimePort } from "../src/server/simulation/characterRuntimePort.mjs";
import { createCharacterSessionActor } from "../src/server/simulation/characterSessionActor.mjs";
import { createWorldActionRegistry } from "../src/server/simulation/worldActionRegistry.mjs";
import { createWorldCommitCoordinator } from "../src/server/simulation/worldCommitCoordinator.mjs";
import { createCharacterWorldRuntime } from "../src/server/simulation/characterWorldRuntime.mjs";
import { initialExecutionControl, materialStateDigest, promoteDueMaintenance, recordExecutionProgress, recordMaintenanceOpportunity, waitMatchesWake } from "../src/server/simulation/characterExecutionControl.mjs";

const world = { worldId: "control", nowSeconds: 0, entities: { a: { id: "a", kind: "character", present: true, placeId: "inn", zoneId: "hall" } }, places: { inn: { topology: { zones: { hall: {} }, edges: [] } } } };
const waitCondition = { condition: "deadline", maximumSeconds: 600, interruptOnDirectSpeech: true };
const coordinator = createWorldCommitCoordinator({ worldId: world.worldId, initialWorldState: world, actionRegistry: createWorldActionRegistry() });
const registered = await coordinator.submitActionAttempt({ attemptId: "wait-probe", actorId: "a", primitive: "wait", payload: { waitCondition } });
assert.equal(registered.status, "success", "a selected wait must register a condition, not poll the model");
assert.equal(registered.resolvedEffects.find(row => row.kind === "actor_wait_registered").deadlineSeconds, 600);
assert.ok(registered.deliveries.every(row => row.eventKind === "own_action_result"), "waiting only returns its owner's receipt and does not broadcast an invented posture");
const invalid = await coordinator.submitActionAttempt({ attemptId: "bad-wait", actorId: "a", primitive: "wait", payload: {} });
assert.equal(invalid.status, "failed");
assert.ok(invalid.failedEffects.some(row => row.code === "WAIT_CONDITION_INVALID"));

let calls = 0;
const actor = createCharacterSessionActor({ characterId: "a", runtimePort: createLocalCharacterRuntimePort({
  async runTurn(input) { assert.equal(runtime.executionStatus.status, "running", "an active Character turn is not an idle world"); calls += 1; return { characterId: "a", agentTurnId: input.agentTurnId, privateStatePatch: {}, privateResult: {},
    actionAttempt: calls === 1 ? { primitive: "wait", payload: { waitCondition } } : null }; },
}) });
const runtime = createCharacterWorldRuntime({ coordinator, actors: [actor], situationProjector: ({ characterId, worldVersion, wake }) => ({ authority: "recipient-specific-world-projection", recipientCharacterId: characterId, worldVersion, evidence: wake.evidence || [] }) });
await runtime.enqueueWake("a", { wakeId: "start", kind: "opportunity_window" });
await runtime.runNext();
assert.equal(calls, 1);
assert.equal(actor.executionControl.waiting.deadlineSeconds, 600);
await runtime.runNext({ notAfterSeconds: 100 });
assert.equal(calls, 1, "the executor makes no model call before a selected deadline");
assert.equal(coordinator.worldState.nowSeconds, 100);
await runtime.runNext({ notAfterSeconds: 100 });
assert.equal(calls, 1, "re-entering at the requested boundary cannot wake a later deadline");
assert.equal(coordinator.worldState.nowSeconds, 100, "a reached time boundary must not advance to the next wait deadline");
const boundaryRun = await runtime.runUntilWorldTime({ targetSeconds: 600 });
assert.equal(boundaryRun.reachedTarget, true);
assert.equal(calls, 1, "time limits pause before new decisions at the boundary, without draining or reordering them");
assert.deepEqual((await runtime.checkpoint()).readyQueue, ["a"], "due work survives the requested time boundary in its original queue");
await runtime.runNext();
assert.equal(calls, 2);
assert.equal(coordinator.worldState.nowSeconds, 600);
assert.equal(actor.executionControl.waiting, null);
await actor.close();
assert.equal(waitMatchesWake({ ...waitCondition, condition: "target_speech", targetCharacterId: "b", processIds: [] }, { evidence: [{ eventKind: "speech", directed: false, sourceCharacterId: "c" }] }), false);
assert.equal(waitMatchesWake(waitCondition, { evidence: [{ eventKind: "speech", directed: true, sourceCharacterId: "b" }] }), true);
assert.equal(waitMatchesWake({ ...waitCondition, interruptOnDirectSpeech: false }, { evidence: [{ eventKind: "speech", directed: true }] }), false);
assert.equal(waitMatchesWake({ ...waitCondition, registeredByAttemptId: "new-wait" }, { kind: "wait_deadline", wakeId: "wake:wait:old-wait" }), false,
  "an expired previous wait must not interrupt a newly registered wait");
assert.equal(waitMatchesWake({ ...waitCondition, registeredByAttemptId: "new-wait" }, { kind: "wait_deadline", wakeId: "wake:wait:new-wait" }), true);
actor.mailbox = [{ kind: "wait_deadline", wakeId: "wake:wait:old-wait" }];
actor.prunePendingWakes({ activeWaitAttemptId: "new-wait" });
assert.equal(actor.mailbox.length, 0);
assert.ok(actor.privateJournal.some(row => row.kind === "wake_discarded" && row.reason === "settled_or_superseded_wait"));

const reflection = { wakeId: "reflection", kind: "reflection_due" };
actor.mailbox = [{ wakeId: "external", kind: "world_evidence" }, reflection];
for (let i = 1; i <= 3; i++) {
  promoteDueMaintenance(actor);
  assert.equal(actor.mailbox[0].wakeId, "external");
  recordMaintenanceOpportunity(actor, { agentTurnId: `fairness:${i}`, wake: actor.mailbox[0] });
}
promoteDueMaintenance(actor);
assert.equal(actor.mailbox[0].wakeId, "reflection", "a due reflection gets its opportunity after three ordinary decisions");
actor.mailbox = [{ wakeId: "urgent", urgent: true }, reflection];
promoteDueMaintenance(actor);
assert.equal(actor.mailbox[0].wakeId, "urgent");
assert.ok(actor.executionControl.urgentBlocks > 0);

const seen = [];
const loopActor = createCharacterSessionActor({ characterId: "a", runtimePort: createLocalCharacterRuntimePort({
  async runTurn(input) {
    const reflectionTurn = input.wake.kind === "reflection_due";
    seen.push(reflectionTurn ? "reflection" : "observe");
    return { characterId: "a", agentTurnId: input.agentTurnId, privateResult: { turnKind: reflectionTurn ? "reflection" : "action" },
      privateStatePatch: reflectionTurn ? { reflectionState: { pendingOpportunity: null } } : { ecologyState: { characterPsychologyV2State: { continuationIntentions: [{ intentionId: "look-again", status: "active", triggerType: "own_action_settled" }] } } },
      actionAttempt: reflectionTurn ? null : { primitive: "observe", payload: { targetKind: "place", targetId: "hall" } } };
  },
}) });
const loopCoordinator = createWorldCommitCoordinator({ worldId: world.worldId, initialWorldState: world, actionRegistry: createWorldActionRegistry() });
const loopRuntime = createCharacterWorldRuntime({ coordinator: loopCoordinator, actors: [loopActor], situationProjector: () => ({ authority: "recipient-specific-world-projection", recipientCharacterId: "a", evidence: [] }) });
await loopRuntime.enqueueWake("a", { wakeId: "start-loop", kind: "opportunity_window" });
const turns = await loopRuntime.runUntilIdle({ maxTurns: 20 });
assert.deepEqual(seen, ["observe", "observe", "observe", "reflection", "observe"]);
assert.equal(turns.length, 5);
assert.equal(loopActor.executionControl.status, "stalled");
assert.equal(loopRuntime.executionStatus.status, "stalled");
assert.equal((await loopRuntime.checkpoint()).actors[0].executionControl.status, "stalled");
await loopActor.close();

// --- an identical failed attempt keeps its own count: bystander chatter cannot clear it ---
const material = materialStateDigest(world, "a");
const failedMoveTurn = (step, destinationId = "hall") => ({
  agentTurnId: `turn:failed-move:${step}`,
  privateResult: { turnKind: "action" },
  wake: { evidence: [{ eventKind: "speech", sourceCharacterId: "b", content: `旁人第 ${step} 次闲聊`, directed: false }] },
  actionAttempt: { primitive: "move", payload: { destinationId } },
  outcome: { status: "failed", resolvedEffects: [], failedEffects: [{ code: "MOVEMENT_DESTINATION_IS_CURRENT_ZONE" }] },
});
const failureActor = { characterId: "a", mailbox: [], privateState: {}, executionControl: initialExecutionControl() };
for (let step = 1; step <= 4; step++) {
  recordExecutionProgress(failureActor, failedMoveTurn(step),
    { beforeMaterial: material, afterMaterial: material, nowSeconds: step * 10, repeatedWaitReviewLimit: 3 });
}
assert.equal(failureActor.executionControl.repeatedCount, 3, "fresh unrelated dialogue must not zero an identical failed attempt");
assert.equal(failureActor.executionControl.failureRevisits, 3);
assert.equal(failureActor.executionControl.status, "active", "the first repeated failure asks the Character to review, it does not stall them");
assert.equal(failureActor.executionControl.reviewPending, true);
assert.match(failureActor.privateState.reflectionState.pendingOpportunity.executionReviewReason, /连续失败 4 次/u);
assert.match(failureActor.privateState.reflectionState.pendingOpportunity.executionReviewReason, /MOVEMENT_DESTINATION_IS_CURRENT_ZONE/u);
recordExecutionProgress(failureActor, { agentTurnId: "turn:failed-move:review", privateResult: { turnKind: "reflection" } },
  { beforeMaterial: material, afterMaterial: material, nowSeconds: 50 });
assert.equal(failureActor.executionControl.reviewCompleted, true);
recordExecutionProgress(failureActor, failedMoveTurn(5),
  { beforeMaterial: material, afterMaterial: material, nowSeconds: 60, repeatedWaitReviewLimit: 3 });
assert.equal(failureActor.executionControl.status, "stalled", "repeating the same failure after a completed review is a stall");
assert.equal(failureActor.executionControl.reason.code, "REPEATED_FAILURE_WITHOUT_CHANGE");
assert.deepEqual(failureActor.executionControl.reason.failureCodes, ["MOVEMENT_DESTINATION_IS_CURRENT_ZONE"]);
recordExecutionProgress(failureActor, failedMoveTurn(6),
  { beforeMaterial: material, afterMaterial: `${material}:firewood-stored`, nowSeconds: 70, repeatedWaitReviewLimit: 3 });
assert.equal(failureActor.executionControl.failureRevisits, 0, "only a changed fact clears the failure record");
assert.deepEqual(failureActor.executionControl.failureHistory, []);

const variedActor = { characterId: "a", mailbox: [], privateState: {}, executionControl: initialExecutionControl() };
for (const [index, destinationId] of ["hall", "hall", "counter", "stove"].entries()) {
  recordExecutionProgress(variedActor, failedMoveTurn(index + 1, destinationId),
    { beforeMaterial: material, afterMaterial: material, nowSeconds: index * 10, repeatedWaitReviewLimit: 3 });
}
assert.equal(variedActor.executionControl.failureRevisits, 0, "a changed attempt starts a new count instead of inheriting the old one");
assert.equal(variedActor.executionControl.reviewPending, false);

console.log("Character execution controls: wait registers once, deadline wakes once, missing conditions fail, identical failures keep their own count.");
