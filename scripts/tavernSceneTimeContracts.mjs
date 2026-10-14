import assert from "node:assert/strict";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { createTavernWorldRuntimeV27, projectTavernSituationV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { runCharacterDayPlanningTurn } from "../src/server/simulation/characterDayPlanningTurn.mjs";
import { tavernCharacterAgentV2OutputSchemaForStage } from "../src/server/pipeline/tavernCharacterAgentV2.mjs";
import { resolveWorldTemporalAgenda, temporalDeadlineDeliveries, projectWorldTemporalContext } from "../src/server/simulation/worldTemporalAgenda.mjs";
import { createWorldCommitCoordinator } from "../src/server/simulation/worldCommitCoordinator.mjs";
import { createWorldActionRegistry } from "../src/server/simulation/worldActionRegistry.mjs";
import { createCharacterWorldRuntime } from "../src/server/simulation/characterWorldRuntime.mjs";
import { createCharacterSessionActor } from "../src/server/simulation/characterSessionActor.mjs";
import { createLocalCharacterRuntimePort } from "../src/server/simulation/characterRuntimePort.mjs";

const XIE = "char_xyy_xiezenshi", MOTHER = "char_xyy_xiemu";
const seed = buildPlayableWorldFromSetup({ setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。", setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。" });
const instance = createTavernWorldRuntimeV27(seed, { pacingMode: "scene" });
assert.ok(instance.characterIds.includes(MOTHER), "a scene containing a medicine delivery must actually run its recipient");
const state = () => instance.coordinator.worldState;
assert.equal(state().timePolicy.mode, "scene");
let observedInput;
const plan = await runCharacterDayPlanningTurn({ ownerCharacterId: "owner", agentTurnId: "scene-plan",
  privateState: { ownerCharacterId: "owner", ownCommitments: [{ id: "task", description: "把手边的东西交给对方" }] },
  timePolicy: state().timePolicy, nowSeconds: 0, availableZoneHandles: ["hall"],
  runStage: async input => {
    observedInput = input;
    const schema = tavernCharacterAgentV2OutputSchemaForStage(input);
    assert.equal(schema.properties.planBlocks.minItems, 1);
    assert.equal(input.horizon.durationSeconds, 1800);
    assert.equal(input.submissionContract.maxBlockSeconds, 300);
    return { dayPlan: { ownerAuthority: "character-agent", planBlocks: [{ relativeStartSeconds: 0, relativeEndSeconds: 60,
      activityType: "交付", desiredZoneHandle: "hall", privatePurpose: "把答应的事情办妥", sourceIds: ["task"] }] } };
  } });
assert.equal(plan.privateStatePatch.lifePlanState.horizonEndsAtSeconds, 1800);
await assert.rejects(runCharacterDayPlanningTurn({ ownerCharacterId: "owner", privateState: { ownerCharacterId: "owner", ownCommitments: [{ id: "task" }] },
  timePolicy: state().timePolicy, runStage: async () => ({ dayPlan: { ownerAuthority: "character-agent", planBlocks: [{ relativeStartSeconds: 0, relativeEndSeconds: 1200,
    activityType: "入座观察", desiredZoneHandle: "", privatePurpose: "先看看", sourceIds: ["task"] }] } }) }), { code: "CHARACTER_DAY_PLAN_BLOCK_TOO_LONG" });
assert.ok(observedInput.horizon.granularity.includes("near_term"));
const projection = projectTavernSituationV27({ worldState: state(), characterId: XIE });
assert.equal(projection.temporalContext.deadlines[0].remainingSeconds, 900);
const readyWorld = state();
readyWorld.objects.tavern_resource_sheltered_firewood.state.processedBundles = 2;
readyWorld.objects.tavern_resource_water_vat.state.fill = 1;
readyWorld.nowSeconds = 500;
readyWorld.temporalAgenda = resolveWorldTemporalAgenda(readyWorld).agenda;
assert.equal(readyWorld.temporalAgenda[0].status, "pending", "readiness is not finalized before the deadline");
assert.equal(projectWorldTemporalContext(readyWorld, readyWorld.entities[XIE], []).deadlines[0].knownCompletion, null,
  "hidden resource completion cannot leak through a temporal notice");
const quietCoordinator = createWorldCommitCoordinator({ worldId: readyWorld.worldId, initialWorldState: readyWorld, actionRegistry: createWorldActionRegistry() });
const quietRuntime = createCharacterWorldRuntime({ coordinator: quietCoordinator, actors: [], situationProjector: () => ({}) });
const quietRun = await quietRuntime.runUntilWorldTime({ targetSeconds: 900, maxTurns: 2 });
assert.equal(quietRun.reachedTarget, true, "a boundary without recipients cannot hide a later scheduled deadline");
assert.equal(quietCoordinator.worldState.temporalAgenda[0].status, "fulfilled");
const lateCheck = structuredClone(readyWorld);
lateCheck.nowSeconds = 920;
assert.equal(resolveWorldTemporalAgenda(lateCheck).agenda[0].status, "fulfilled", "work already done before the deadline is not late merely because a long action ended later");
const depleted = structuredClone(readyWorld);
depleted.nowSeconds = 650;
depleted.objects.tavern_resource_water_vat.state.fill = 0.2;
depleted.temporalAgenda = resolveWorldTemporalAgenda(depleted).agenda;
depleted.nowSeconds = 900;
const missed = resolveWorldTemporalAgenda(depleted);
assert.equal(missed.agenda[0].status, "overdue", "using resources before opening invalidates earlier readiness");
depleted.temporalAgenda = missed.agenda;
depleted.nowSeconds = 960;
depleted.objects.tavern_resource_water_vat.state.fill = 1;
const completedLate = resolveWorldTemporalAgenda(depleted);
assert.equal(completedLate.agenda[0].status, "fulfilled_late");
assert.equal(completedLate.agenda[0].resolvedAtSeconds, 960);
assert.deepEqual(temporalDeadlineDeliveries(depleted, completedLate.changes[0], "completion"), [],
  "completion of resources creates no omniscient announcement");
const simultaneousWorld = state();
simultaneousWorld.processes = [{ id: "work-at-warning", kind: "work_unit", ownerActorId: XIE, status: "active",
  durationSeconds: 600, startedAtSeconds: 0, activeStartedAtSeconds: 0, readyAtSeconds: 600 }];
const simultaneousCoordinator = createWorldCommitCoordinator({ worldId: simultaneousWorld.worldId, initialWorldState: simultaneousWorld, actionRegistry: createWorldActionRegistry() });
const simultaneousActor = createCharacterSessionActor({ characterId: XIE, runtimePort: createLocalCharacterRuntimePort({ async runTurn(input) {
  assert.equal(input.worldProjection.nowSeconds, 600);
  assert.equal(input.worldProjection.deadlineWarned, true, "a simultaneous deadline is settled before the process owner's next thought");
  return { characterId: XIE, agentTurnId: input.agentTurnId, privateResult: {}, privateStatePatch: {}, actionAttempt: null };
} }) });
const simultaneousRuntime = createCharacterWorldRuntime({ coordinator: simultaneousCoordinator, actors: [simultaneousActor],
  situationProjector: ({ worldState, wake }) => ({ authority: "recipient-specific-world-projection", recipientCharacterId: XIE,
    nowSeconds: worldState.nowSeconds, deadlineWarned: worldState.temporalAgenda[0].warned, evidence: wake.evidence }) });
assert.ok(await simultaneousRuntime.runNext());
await simultaneousActor.close();
const warning = await instance.coordinator.advanceWorldClockTo({ targetSeconds: 3600 });
assert.equal(state().nowSeconds, 600, "idle time must stop at the first world deadline warning");
assert.ok(warning.deliveries.some(row => row.recipientCharacterId === XIE && row.eventKind === "world_deadline_warning"));
await instance.coordinator.advanceWorldClockTo({ targetSeconds: 3600 });
assert.equal(state().nowSeconds, 900, "the due event cannot be skipped by a large clock jump");
assert.equal(state().temporalAgenda[0].status, "overdue");
assert.equal(state().places.loc_xyy_tavern.openingReadiness.status, "delayed");
assert.equal(state().objects.tavern_resource_water_vat.state.fill, 0.55, "a deadline cannot invent completed work");
const checkpoint = await instance.runtime.checkpoint();
const restored = createTavernWorldRuntimeV27(seed, { checkpoint });
assert.equal(restored.coordinator.worldState.timePolicy.mode, "scene");
assert.deepEqual(restored.characterIds, instance.characterIds, "restore keeps the scene's actual cast");
const countBefore = restored.coordinator.journal.events.filter(row => row.type === "world_deadline_due").length;
await restored.coordinator.advanceWorldClockTo({ targetSeconds: 1000 });
assert.equal(restored.coordinator.journal.events.filter(row => row.type === "world_deadline_due").length, countBefore, "restoring never repeats a deadline consequence");
const samples = createTavernWorldRuntimeV27(seed, { pacingMode: "scene", openingAfterSeconds: 3600 });
let actionNumber = 0;
const action = (primitive, payload = {}) => samples.coordinator.submitActionAttempt({ actorId: XIE, primitive, payload, attemptId: `clock-sample:${++actionNumber}` });
assert.equal((await action("rest")).durationSeconds, 120);
assert.equal((await action("speak", { utterance: "这句话按照长度计时。" })).durationSeconds, 3);
assert.equal((await action("observe")).durationSeconds, 5);
assert.equal((await action("listen")).durationSeconds, 10);
await samples.coordinator.advanceWorldClockTo({ targetSeconds: 3595 });
await samples.coordinator.advanceWorldClockTo({ targetSeconds: 3595 });
assert.equal((await action("rest")).durationSeconds, 5, "a passive segment ends at the next objective boundary instead of hiding it");
for (const x of [instance, restored, samples]) for (const actor of x.runtime.actors.values()) await actor.close();
console.log("Scene timing: short plans, real recipient, first-boundary clock, objective overdue state and restore passed.");
