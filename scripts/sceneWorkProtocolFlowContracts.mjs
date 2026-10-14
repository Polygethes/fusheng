import assert from "node:assert/strict";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { createTavernWorldRuntimeV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { createTavernV27FixtureStageRunner } from "../src/server/pipeline/tavernV27FixtureStage.mjs";
import { tavernCharacterAgentV2OutputSchemaForStage } from "../src/server/pipeline/tavernCharacterAgentV2.mjs";
import { prepareCharacterStageSubmission } from "../src/server/simulation/characterStageSubmission.mjs";
import { buildV27RelayModelRequest } from "../src/server/pipeline/v27RelayModelRequest.mjs";
import { validateAgentGeneratedCandidates } from "../src/server/simulation/characterPsychologyTools.mjs";
import { buildCodexStrictOutputSchema } from "../src/server/ecology/codexStructuredOutputSchema.mjs";

function assertTypedProviderObjects(schema) {
  if (schema.properties) {
    assert.equal(schema.type, "object", "provider object branches must declare their type");
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(new Set(schema.required), new Set(Object.keys(schema.properties)));
    Object.values(schema.properties).forEach(assertTypedProviderObjects);
  }
  if (schema.items) assertTypedProviderObjects(schema.items);
  (schema.anyOf || []).forEach(assertTypedProviderObjects);
}

const XIE = "char_xyy_xiezenshi", ZHOU = "char_xyy_zhoumin", MOTHER = "char_xyy_xiemu";
const AXE = "tavern_tool_wood_axe", BUCKET = "tavern_tool_water_bucket";
const PARCEL = "tavern_delivery_medicine_parcel", MANIFEST = "tavern_delivery_manifest";
const seed = buildPlayableWorldFromSetup({ setupWorldPrompt: "逍遥游，望梯酒馆", setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚" });
let step, inputCount = 0, operationBindingChecked = false, latestStage;
const fixture = createTavernV27FixtureStageRunner({ planForTurn(input) {
  let affordanceId = "";
  if (step.operation) {
    const offer = input.worldProjection.affordances.find(row => row.operation === step.operation
      && (!step.template || row.workTemplateId === step.template) && (!step.acceptedObject || row.objectId === step.acceptedObject));
    assert.ok(offer, JSON.stringify(step));
    assert.equal(offer.attemptPrimitive, "use_affordance");
    assert.deepEqual(offer.actionBinding, { kind: "affordance", affordanceId: offer.id });
    affordanceId = offer.id;
  }
  return { ...step, primitive: step.operation ? "use_affordance" : step.primitive, affordanceId,
    intention: "本地固定操作回归", utterance: "", visibleAction: "", texture: [], privateBasis: "本测试明确选择这个物理操作。" };
} });
const instance = createTavernWorldRuntimeV27(seed, { pacingMode: "scene", characterIds: [XIE, ZHOU, MOTHER],
  positions: { [XIE]: "courtyard", [ZHOU]: "hall", [MOTHER]: "hall" },
  async runStage(input, options) {
    inputCount++;
    if (input.worldProjection?.temporalContext) latestStage = structuredClone(input);
    const result = await fixture(input, options);
    if (step.operation && options.stage === "subjective_appraisal_and_candidates" && !operationBindingChecked) {
      const wrong = structuredClone(result.appraisalAndCandidates);
      const candidate = wrong.candidates.candidates[0];
      candidate.attemptPrimitive = "interact";
      const schema = tavernCharacterAgentV2OutputSchemaForStage(input);
      assertTypedProviderObjects(buildCodexStrictOutputSchema(schema));
      assert.equal(prepareCharacterStageSubmission(input, wrong, schema).valid, false, "an operation id is not generic object contact");
      assert.ok(validateAgentGeneratedCandidates([candidate], { availableAffordances: input.worldProjection.affordances }).errors
        .some(row => row.code === "AGENT_CANDIDATE_CAPABILITY_PRIMITIVE_MISMATCH"), "domain validation also catches schema bypasses");
      candidate.attemptPrimitive = "use_affordance";
      candidate.actionBinding = { kind: "object", objectId: AXE };
      assert.equal(prepareCharacterStageSubmission(input, wrong, schema).valid, false);
      operationBindingChecked = true;
    }
    return result;
  } });
let actionTurns = 0, maintenanceTurns = 0;
async function act(actorId, next) {
  step = next;
  await instance.runtime.enqueueWake(actorId, { wakeId: `work-flow:${actionTurns}`, kind: "opportunity_window" });
  for (let retry = 0; retry < 6; retry++) {
    const turn = await instance.runtime.runNext({ characterId: actorId });
    assert.ok(turn, JSON.stringify(next));
    if (!turn.outcome) { maintenanceTurns++; continue; }
    assert.equal(turn.outcome.status, "success", JSON.stringify(turn.outcome.failedEffects));
    actionTurns++;
    return turn;
  }
  assert.fail("maintenance must not swallow the physical action opportunity");
}
async function work(template) {
  await act(XIE, { operation: "start_work_unit", template });
  await instance.coordinator.advanceWorldProcesses({ allowTimeAdvance: true });
  return act(XIE, { operation: "finish_work_unit", template });
}
try {
  await act(XIE, { primitive: "pickup", objectId: AXE });
  await work("split_firewood_bundles");
  await work("split_firewood_bundles");
  for (const destinationId of ["hall", "counter", "stove"]) await act(XIE, { primitive: "move", destinationId });
  await act(XIE, { primitive: "pickup", objectId: BUCKET });
  for (const destinationId of ["counter", "hall", "courtyard"]) await act(XIE, { primitive: "move", destinationId });
  await work("fill_water_bucket");
  for (const destinationId of ["hall", "counter", "stove"]) await act(XIE, { primitive: "move", destinationId });
  const filled = await work("refill_stove_water");
  assert.ok(filled.outcome.deliveries.find(row => row.eventKind === "own_action_result").semanticFrame.actionResult.resourceChanges
    .some(row => row.field === "fill" && row.before === 0.55 && row.after === 1));
  for (const objectId of [PARCEL, MANIFEST]) {
    await act(ZHOU, { primitive: "take_out", objectId });
    await act(ZHOU, { primitive: "place", objectId });
    const accepted = await act(MOTHER, { operation: "accept_delivery", acceptedObject: objectId });
    assert.equal(accepted.outcome.deliveries.find(row => row.eventKind === "own_action_result").semanticFrame.actionResult.deliveryAccepted, true);
  }
  const world = instance.coordinator.worldState;
  assert.equal(world.objects.tavern_resource_sheltered_firewood.state.processedBundles, 2);
  assert.equal(world.objects.tavern_resource_water_vat.state.fill, 1);
  for (const id of [PARCEL, MANIFEST]) assert.equal(world.objects[id].state.accepted, true);
  assert.ok(world.nowSeconds < 900, "the lawful work chain fits the actual preparation deadline");
  assert.equal(operationBindingChecked, true);
  const envelope = buildV27RelayModelRequest({ stageId: "test", stageInput: latestStage, schema: tavernCharacterAgentV2OutputSchemaForStage(latestStage) });
  for (const key of ["temporalContext", "ownTimeExperience", "observableState", "physicalActionRule", "physicalPrerequisites", "expectedDurationSeconds"]) {
    assert.ok(envelope.userPrompt.includes(key), `official relay presentation retains ${key}`);
  }
  console.log(JSON.stringify({ status: "pass", actionTurns, maintenanceTurns, simulatedSeconds: world.nowSeconds,
    processedWood: 2, vatFill: 1, deliveryAccepted: 2, fixedStageInvocations: inputCount, realModelCalls: 0 }));
} finally { for (const actor of instance.runtime.actors.values()) await actor.close(); }
