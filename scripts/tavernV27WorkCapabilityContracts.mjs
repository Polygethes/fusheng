import assert from "node:assert/strict";

import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import {
  createTavernWorldRuntimeV27,
  projectTavernSituationV27,
} from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";

const XIE = "char_xyy_xiezenshi";
const LUO = "char_xyy_luozhao";
const AXE = "tavern_tool_wood_axe";
const WET_FIREWOOD = "tavern_resource_unprocessed_firewood";
const SHELTERED_FIREWOOD = "tavern_resource_sheltered_firewood";

const sourceState = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
const instance = createTavernWorldRuntimeV27(sourceState, {
  characterIds: [XIE, LUO],
  positions: { [XIE]: "courtyard", [LUO]: "hall" },
  worldId: "world:test:v27-work-capability",
});

function projection(characterId, wake = {}) {
  return projectTavernSituationV27({
    worldState: instance.coordinator.worldState,
    worldVersion: instance.coordinator.journal.worldVersion,
    characterId,
    wake,
  });
}

async function submit(actorId, primitive, payload) {
  const version = instance.coordinator.journal.worldVersion;
  return instance.coordinator.submitActionAttempt({
    attemptId: `attempt:test:work:${version + 1}`,
    actorId,
    primitive,
    expectedWorldVersion: version,
    payload,
  });
}

const initial = projection(XIE);
const blockedStart = initial.availableAffordances.find((row) => (
  row.kind === "work_operation"
  && row.operation === "start_work_unit"
  && row.workTemplateId === "split_firewood_bundles"
));
assert.ok(blockedStart, "the world projects a real work possibility from scene data");
assert.equal(blockedStart.currentlyExecutable, false, "a visible job is not silently executable without its tool");
assert.match(blockedStart.id, /^perceived_affordance:/);
assert.equal(Object.hasOwn(blockedStart, "resourceEffects"), false, "private server settlement values do not leak into the character surface");

const blockedBinding = initial.recipientPrivateBindings.affordanceBindingByHandle[blockedStart.id];
const failedWithoutTool = await submit(XIE, "use_affordance", {
  affordanceId: blockedBinding.canonicalAffordanceId,
  capabilityBinding: blockedBinding,
  visibleAction: "谢真石伸手去动湿柴。",
});
assert.equal(failedWithoutTool.status, "failed");
assert.ok(failedWithoutTool.failedEffects.some((row) => row.code === "WORK_REQUIRED_TOOL_NOT_HELD"));

await submit(XIE, "handle", {
  objectId: AXE,
  operation: "take",
  visibleAction: "谢真石拿起劈柴斧。",
});

const withTool = projection(XIE);
const executableStart = withTool.availableAffordances.find((row) => (
  row.kind === "work_operation"
  && row.operation === "start_work_unit"
  && row.workTemplateId === "split_firewood_bundles"
));
assert.equal(executableStart.currentlyExecutable, true);
const startBinding = withTool.recipientPrivateBindings.affordanceBindingByHandle[executableStart.id];
const bundlesBefore = Number(instance.coordinator.worldState.objects[WET_FIREWOOD].state.unprocessedBundles);
const processedBefore = Number(instance.coordinator.worldState.objects[SHELTERED_FIREWOOD].state.processedBundles);
const startedAtSeconds = instance.coordinator.worldState.nowSeconds;
const started = await submit(XIE, "use_affordance", {
  affordanceId: startBinding.canonicalAffordanceId,
  capabilityBinding: startBinding,
  visibleAction: "谢真石拣出一束湿柴，落斧劈了下去。",
});
assert.equal(started.status, "success");
assert.equal(Object.hasOwn(started, "selectedAction"), false, "the world does not choose what the character does next");
let process = instance.coordinator.worldState.processes.find((row) => row.kind === "work_unit");
assert.equal(process.status, "active");
assert.equal(process.metadata.workTemplateId, "split_firewood_bundles");
assert.equal(Number(instance.coordinator.worldState.objects[WET_FIREWOOD].state.unprocessedBundles), bundlesBefore, "resources change only after objective completion");

const activeProjection = projection(XIE);
assert.equal(
  activeProjection.availableAffordances.some((row) => row.operation === "start_work_unit"),
  false,
  "an actor who is already doing continuous work must not be offered another start",
);
assert.equal(
  activeProjection.ownedWorldProcesses.some((row) => row.id && row.status === "active" && row.attentionMode === "continuous_work"),
  true,
  "the ongoing activity remains visible as the actor's current process",
);

await submit(XIE, "move", {
  destinationId: "hall",
  visibleAction: "谢真石放下手里的柴，回到堂前。",
});
process = instance.coordinator.worldState.processes.find((row) => row.id === process.id);
assert.equal(process.status, "interrupted", "leaving a continuous-work station objectively interrupts the process");
assert.equal(projection(XIE).availableAffordances.some((row) => row.operation === "start_work_unit"), false);

await submit(XIE, "move", {
  destinationId: "courtyard",
  visibleAction: "谢真石回到后院的柴堆旁。",
});
const interruptedProjection = projection(XIE);
const resume = interruptedProjection.availableAffordances.find((row) => row.operation === "resume_work_unit");
assert.ok(resume, "an interrupted owned process exposes a resume opportunity at its station");
assert.equal(resume.currentlyExecutable, true);
const resumeBinding = interruptedProjection.recipientPrivateBindings.affordanceBindingByHandle[resume.id];
const resumed = await submit(XIE, "use_affordance", {
  affordanceId: resumeBinding.canonicalAffordanceId,
  capabilityBinding: resumeBinding,
  visibleAction: "谢真石重新握稳斧柄，接着劈方才那束柴。",
});
assert.equal(resumed.status, "success");
process = instance.coordinator.worldState.processes.find((row) => row.id === process.id);
assert.equal(process.status, "active");

const readyEvent = await instance.coordinator.advanceWorldProcesses({ allowTimeAdvance: true });
assert.ok(readyEvent);
process = instance.coordinator.worldState.processes.find((row) => row.id === process.id);
assert.equal(process.status, "ready");

const readyProjection = projection(XIE, {
  processIds: [process.id],
  evidence: readyEvent.deliveries,
});
const finish = readyProjection.availableAffordances.find((row) => (
  row.kind === "work_operation"
  && row.operation === "finish_work_unit"
));
assert.ok(finish, "a ready work process returns a new decision opportunity to its owner");
assert.equal(readyProjection.ownedWorldProcesses.some((row) => row.kind === "work_unit" && row.status === "ready"), true);
const finishBinding = readyProjection.recipientPrivateBindings.affordanceBindingByHandle[finish.id];
const finished = await submit(XIE, "use_affordance", {
  affordanceId: finishBinding.canonicalAffordanceId,
  capabilityBinding: finishBinding,
  visibleAction: "谢真石把劈开的柴码到檐下。",
});
assert.equal(finished.status, "success");
process = instance.coordinator.worldState.processes.find((row) => row.id === process.id);
assert.equal(process.status, "completed");
assert.equal(Number(instance.coordinator.worldState.objects[WET_FIREWOOD].state.unprocessedBundles), bundlesBefore - 1);
assert.equal(Number(instance.coordinator.worldState.objects[SHELTERED_FIREWOOD].state.processedBundles), processedBefore + 1);
const bodyLoad = finished.resolvedEffects.find((row) => row.kind === "body_load_applied");
assert.ok(bodyLoad);
assert.ok(Number(bodyLoad.exertionDelta) > 0);
assert.ok(Number(bodyLoad.fatigueDelta) > 0);
assert.ok(instance.coordinator.worldState.nowSeconds - startedAtSeconds >= 42, "work cannot finish ahead of its physical duration");
const workSound = finished.deliveries.find(row => row.eventKind === "work_sound" && row.recipientCharacterId === LUO);
assert.ok(workSound, "the same completed wood process reaches listeners in the hall");
assert.equal(workSound.sourceProcessId, process.id);
assert.ok(finished.resolvedEffects.some(row => row.kind === "work_sound_emitted" && row.signalId === workSound.signalId));

console.log("tavernV27WorkCapabilityContracts:test passed", {
  workTemplateId: "split_firewood_bundles",
  processStages: ["active", "ready", "completed"],
  interruptionAndResume: true,
  resourceSettlement: "world-owned",
  actionSelectionAuthority: "character-agent",
});
