import assert from "node:assert/strict";
import test from "node:test";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { createTavernWorldRuntimeV27, projectTavernSituationV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { initialExecutionControl, recordExecutionProgress } from "../src/server/simulation/characterExecutionControl.mjs";
import { createLocalCharacterRuntimePort } from "../src/server/simulation/characterRuntimePort.mjs";
import { createCharacterSessionActor } from "../src/server/simulation/characterSessionActor.mjs";
import { createWorldActionRegistry } from "../src/server/simulation/worldActionRegistry.mjs";
import { createWorldCommitCoordinator } from "../src/server/simulation/worldCommitCoordinator.mjs";
import { createCharacterWorldRuntime } from "../src/server/simulation/characterWorldRuntime.mjs";

const XIE = "char_xyy_xiezenshi", LUO = "char_xyy_luozhao";
const WOOD = "tavern_resource_unprocessed_firewood", STACK = "tavern_resource_sheltered_firewood";
const VAT = "tavern_resource_water_vat", AXE = "tavern_tool_wood_axe";
function create() {
  const seed = buildPlayableWorldFromSetup({ setupWorldPrompt: "逍遥游，望梯酒馆", setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚" });
  return createTavernWorldRuntimeV27(seed, { characterIds: [XIE, LUO], pacingMode: "scene",
    positions: { [XIE]: "courtyard", [LUO]: "hall" }, runStage() { throw new Error("No model calls in this regression"); } });
}
const close = instance => Promise.all([...instance.runtime.actors.values()].map(actor => actor.close()));

test("archived chop prose cannot turn contact success into work completion feedback", async () => {
  const instance = create();
  let sequence = 0;
  const submit = (primitive, payload) => instance.coordinator.submitActionAttempt({ attemptId: `grounding:${++sequence}`,
    actorId: XIE, primitive, payload });
  const project = () => projectTavernSituationV27({ worldState: instance.coordinator.worldState, characterId: XIE });
  const work = operation => {
    const offer = project().availableAffordances.find(row => row.operation === operation && row.workTemplateId === "split_firewood_bundles");
    assert.ok(offer);
    return submit("use_affordance", { capabilityBinding: project().recipientPrivateBindings.affordanceBindingByHandle[offer.id] });
  };
  const receipt = outcome => outcome.deliveries.find(row => row.eventKind === "own_action_result");
  try {
    const contact = await submit("handle", { objectId: WOOD, operation: "interact", visibleAction: "这一捆柴已经劈好了。" });
    assert.equal(contact.status, "success");
    assert.match(receipt(contact).content, /仅.*触碰/);
    assert.match(receipt(contact).content, /未.*开始.*工作|没有.*启动.*工作/);
    assert.deepEqual(receipt(contact).semanticFrame.actionResult.resourceChanges, []);
    assert.equal(receipt(contact).semanticFrame.actionResult.workCompleted, false);
    assert.equal(instance.coordinator.worldState.objects[STACK].state.processedBundles, 0);
    await submit("handle", { objectId: AXE, operation: "take" });
    const started = await work("start_work_unit");
    assert.equal(receipt(started).semanticFrame.actionResult.workStarted, true);
    assert.equal(receipt(started).semanticFrame.actionResult.workCompleted, false);
    assert.match(receipt(started).content, /尚未完成/);
    await instance.coordinator.advanceWorldProcesses({ allowTimeAdvance: true });
    const finished = await work("finish_work_unit");
    assert.equal(receipt(finished).semanticFrame.actionResult.workCompleted, true);
    assert.ok(receipt(finished).semanticFrame.actionResult.resourceChanges.some(row => row.objectId === STACK
      && row.field === "processedBundles" && row.before === 0 && row.after === 1));
    assert.equal(instance.coordinator.worldState.objects[STACK].state.processedBundles, 1);
  } finally { await close(instance); }
});

test("nearby resource observations expose water and wood, never remote or hidden state", async () => {
  const instance = create();
  try {
    const world = structuredClone(instance.coordinator.worldState);
    const project = () => projectTavernSituationV27({ worldState: world, characterId: XIE });
    assert.equal(project().perceivedObjects.find(row => row.id === STACK)?.observableState?.processedBundles, 0);
    assert.equal(project().perceivedObjects.find(row => row.id === VAT)?.observableState?.fill, undefined);
    world.entities[XIE].zoneId = "stove";
    assert.equal(project().perceivedObjects.find(row => row.id === VAT)?.observableState?.fill, 0.55);
    world.objects[VAT].state.secret = "hidden-ledger";
    assert.ok(!JSON.stringify(project().perceivedObjects).includes("hidden-ledger"));
    world.objects[VAT].state.contents = "sealed-letter-contents";
    assert.ok(!JSON.stringify(project().perceivedObjects).includes("sealed-letter-contents"), "a visible object is not permission to read arbitrary contents");
    world.objects[VAT].presentation = { exposure: "concealed", publiclyVisible: false };
    assert.ok(!project().perceivedObjects.some(row => row.id === VAT));
  } finally { await close(instance); }
});

test("new background speech does not erase an alternating passive cycle", () => {
  const actor = { characterId: "a", executionControl: initialExecutionControl(), privateState: {} };
  for (let i = 0; i < 8; i++) recordExecutionProgress(actor, {
    agentTurnId: `idle:${i}`, privateResult: { turnKind: "action" },
    wake: { evidence: [{ eventKind: "speech", sourceCharacterId: "b", content: `another remark ${i}` }] },
    actionAttempt: { primitive: ["observe", "listen", "rest"][i % 3], payload: {} },
    outcome: { status: "success", resolvedEffects: [], failedEffects: [] },
  }, { beforeMaterial: "same", afterMaterial: "same", nowSeconds: i * 10, repeatedWaitReviewLimit: 2 });
  assert.equal(actor.executionControl.reviewPending, true);
  assert.ok(actor.executionControl.passiveRevisits >= 3);
});

test("live delivery routing preserves the review across chatter and gives direct speech one response opportunity", async () => {
  let cycle = 0, line = 0, target = "c";
  const passive = createCharacterSessionActor({ characterId: "a", runtimePort: createLocalCharacterRuntimePort({ async runTurn(input) {
    const reflection = input.wake.kind === "reflection_due";
    return { characterId: "a", agentTurnId: input.agentTurnId,
      privateResult: { turnKind: reflection ? "reflection" : "action" },
      privateStatePatch: reflection ? { reflectionState: { pendingOpportunity: null } } : {},
      actionAttempt: reflection ? null : { primitive: ["observe", "listen", "rest"][cycle++ % 3], payload: {} } };
  } }) });
  const speaker = createCharacterSessionActor({ characterId: "b", runtimePort: createLocalCharacterRuntimePort({ async runTurn(input) {
    return { characterId: "b", agentTurnId: input.agentTurnId, privateStatePatch: {}, privateResult: { turnKind: "action" },
      actionAttempt: { primitive: "speak", payload: { targetCharacterId: target, utterance: `第${++line}句话。`,
        bodyActions: [{ kind: "nod", direction: "forward", amplitude: "small", speed: "normal" }] } } };
  } }) });
  const respondent = createCharacterSessionActor({ characterId: "c", runtimePort: createLocalCharacterRuntimePort({ async runTurn(input) {
    return { characterId: "c", agentTurnId: input.agentTurnId, privateStatePatch: {}, privateResult: { turnKind: "action" },
      actionAttempt: { primitive: "speak", payload: { targetCharacterId: "b", utterance: `应答第${line}句话。` } } };
  } }) });
  const coordinator = createWorldCommitCoordinator({ worldId: "chatter", actionRegistry: createWorldActionRegistry(), initialWorldState: {
    timePolicy: { mode: "scene", repeatedWaitReviewLimit: 2 },
    entities: Object.fromEntries(["a", "b", "c"].map(id => [id, { id, kind: "character", present: true, placeId: "inn", zoneId: "hall" }])),
    places: { inn: { topology: { zones: { hall: {} }, edges: [] } } },
  } });
  const runtime = createCharacterWorldRuntime({ coordinator, actors: [passive, speaker, respondent],
    situationProjector: ({ worldState, characterId, wake }) => ({ authority: "recipient-specific-world-projection",
      recipientCharacterId: characterId, nowSeconds: worldState.nowSeconds, evidence: wake.evidence || [] }) });
  async function say() {
    await runtime.enqueueWake("b", { wakeId: `say:${line}`, kind: "opportunity_window" });
    await runtime.runNext({ characterId: "b" });
    await runtime.runNext({ characterId: "c" });
  }
  try {
    for (let i = 0; i < 12 && passive.executionControl.status !== "stalled"; i++) { await say(); await runtime.runNext({ characterId: "a" }); }
    assert.equal(passive.executionControl.status, "stalled", JSON.stringify({ cycle, control: passive.executionControl }));
    assert.equal(passive.executionControl.reviewCompleted, true);
    await say();
    assert.equal(passive.executionControl.status, "stalled", "background speech plus a nod cannot clear physical stagnation");
    const revisits = passive.executionControl.passiveRevisits;
    target = "a";
    await say();
    assert.equal(passive.executionControl.status, "active", "a new direct address gives a real response opportunity");
    assert.equal(passive.executionControl.passiveRevisits, revisits, "being addressed does not complete one's own work");
    await runtime.runNext({ characterId: "a" });
    assert.equal(passive.executionControl.status, "stalled", "choosing the same passive cycle again must not erase the completed review");
  } finally { await passive.close(); await speaker.close(); await respondent.close(); }
});
