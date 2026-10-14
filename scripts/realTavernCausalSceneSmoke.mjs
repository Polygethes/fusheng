import assert from "node:assert/strict";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { playWithOpenAIPipeline } from "../src/server/pipeline/openaiPipeline.mjs";
import { tavernVisitPurposeSpeechIsConcrete } from "../src/server/pipeline/tavernCausalEconomy.mjs";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
state.ui.timeGrain = "scene";
state.ui.engineMode = "openai";
const ids = {
  mother: "char_xyy_xiemu",
  father: "char_xyy_xieheng",
  son: "char_xyy_xiezenshi",
  guest: "char_xyy_luozhao",
};
const guest = state.characters.find((character) => character.id === ids.guest);
guest.lifeState.present = true;
guest.lifeState.situationalRole = "来店食客";
state.tavernState.activeVisits = [{
  id: "real_causal_visit",
  visitorId: ids.guest,
  visitorName: guest.name,
  situationalRole: "来店食客",
  purpose: "淋雨后进店要一碗热饭，并问今晚能否歇脚",
  kind: "meal_and_lodging",
  expectedHostIds: [ids.mother],
  requestedService: "lodging_meal",
  paymentMode: "cash",
  completionCondition: "酒馆明确回应饭食、房间和价钱",
  purposeStatus: "undisclosed",
  declaredPurpose: "",
  businessStatus: "not_required",
  purposeAction: "当面询问热饭、房间和价钱",
  purposeZoneIds: ["hall", "counter"],
  allowedZoneIds: ["threshold", "hall", "counter"],
  carriedObjectLabel: "被雨打湿的包袱",
  arrivalCue: "抱着被雨打湿的包袱站在门槛内",
  stage: "waiting",
  hostId: "",
}];

const progress = [];
const startedAt = Date.now();
const draft = await playWithOpenAIPipeline(state, {
  pipelineMode: "live",
  // Keep this paid smoke focused on the complete visitor/host chain. Family
  // initiative and bystander target locking have separate deterministic tests.
  characterIds: [ids.mother, ids.guest],
  positions: {
    [ids.mother]: "counter",
    [ids.guest]: "threshold",
  },
  seedImpacts: [{
    id: "real-causal-guest-own-need",
    sourceCharacterId: "world:rain-and-hunger",
    sourceZoneId: "threshold",
    type: "need",
    modality: "memory",
    intensity: 100,
    radius: 0,
    directedTargetId: ids.guest,
    content: "洛照的衣袖和包袱都被雨打湿了；他自己知道要先向掌柜问热饭和今晚歇脚。",
    topic: "洛照本人当前需求",
  }],
  maxSteps: 12,
  onProgress(event) { progress.push(structuredClone(event)); },
});

assert.equal(draft.pipelineMeta.mode, "model-tavern-causal-scene");
assert.ok(draft.pipelineMeta.stages.some((stage) => String(stage.name || "").startsWith("TavernCausalAgent:") && stage.provider === "openai"));
assert.ok(!draft.pipelineMeta.stages.some((stage) => /AffordanceProbe|ActivityWitness|ValidatedReplay/.test(stage.name || "")));
assert.ok(draft.causalScene.activations.length >= 1);
assert.ok(draft.causalScene.actions.length >= 1);
assert.ok(draft.causalScene.impacts.length >= 1);
assert.ok(draft.causalScene.deliveries.some((delivery) => delivery.recipientId === ids.mother), "the manager must physically perceive the waiting guest");
const declaredPurposeAction = draft.causalScene.actions.find((action) => action.affordanceType === "declare_visit_purpose");
if (!declaredPurposeAction?.speech) {
  console.log("real tavern purpose diagnostic", {
    stopReason: draft.causalScene.stopReason,
    actions: draft.causalScene.actions.map((action) => ({
      actor: action.actorName,
      type: action.affordanceType,
      visibleAction: action.visibleAction,
      speech: action.speech,
    })),
    stages: draft.pipelineMeta.stages.filter((stage) => String(stage.name || "").startsWith("TavernCausalAgent:")),
    visit: (draft.updateBundle.tavernState.activeVisits || []).find((visit) => visit.id === "real_causal_visit") || null,
  });
}
assert.ok(declaredPurposeAction?.speech, "an undisclosed visitor must state a concrete purpose before the visit can advance");
assert.ok(
  tavernVisitPurposeSpeechIsConcrete(state.tavernState.activeVisits[0], declaredPurposeAction.speech),
  `visit declaration must name the actual need, received: ${declaredPurposeAction.speech || "<silent>"}`,
);
assert.ok(
  draft.causalScene.actions.every((action) => action.affordanceType !== "declare_visit_purpose" || Boolean(action.speech)),
  "a rejected or silent purpose declaration must not leave a canonical movement in the public scene",
);
const committedAffordanceTypes = draft.causalScene.actions.map((action) => action.affordanceType).filter(Boolean);
const requiredVisitAffordances = ["receive_guest", "assign_lodging", "serve_guest"];
if (requiredVisitAffordances.some((type) => !committedAffordanceTypes.includes(type))
  || !committedAffordanceTypes.some((type) => ["pay_cash", "settle_cash"].includes(type))) {
  console.log("real tavern visit diagnostic", {
    stopReason: draft.causalScene.stopReason,
    committedAffordanceTypes,
    actions: draft.causalScene.actions.map((action) => ({
      actor: action.actorName,
      type: action.affordanceType,
      visibleAction: action.visibleAction,
      speech: action.speech,
    })),
    visit: (draft.updateBundle.tavernState.activeVisits || []).find((visit) => visit.id === "real_causal_visit") || null,
  });
}
assert.ok(committedAffordanceTypes.includes("receive_guest"), "the manager must receive the disclosed need in person");
assert.ok(committedAffordanceTypes.includes("assign_lodging"), "the room and key must be assigned by the lodging state machine");
assert.ok(committedAffordanceTypes.includes("serve_guest"), "the meal must be handed over by the service state machine");
assert.ok(committedAffordanceTypes.some((type) => ["pay_cash", "settle_cash"].includes(type)), "cash must be settled by the payment state machine");
const committedVisit = (draft.updateBundle.tavernState.activeVisits || []).find((visit) => visit.id === "real_causal_visit");
assert.equal(committedVisit?.stage, "completed", `the focused visit must close all material work, received: ${JSON.stringify(committedVisit)}`);
assert.equal(draft.causalScene.macroTimeAdvanced, false);
assert.equal(draft.updateBundle.tavernState.day, state.tavernState.day);
assert.equal(draft.updateBundle.tavernState.tick, state.tavernState.tick);
assert.ok(!JSON.stringify({
  novelText: draft.novelText,
  actions: draft.causalScene?.actions,
  impacts: draft.causalScene?.impacts,
  deliveries: draft.causalScene?.deliveries,
  updateBundle: draft.updateBundle,
}).includes("privateReason"), "private Agent reasons must stay out of world facts and Agent-readable state");
assert.ok((draft.observerPsychology || []).every((entry) => entry.visibility === "observer-only"));
assert.doesNotMatch(draft.novelText, /银(?:子|两)?|钱银/, "the model must not replace the authoritative copper-coin price with silver");
assert.doesNotMatch(draft.novelText, /螺丝(?:钉)?|电灯|玻璃窗/, "premodern tavern actions must not introduce modern hardware");
assert.doesNotMatch(draft.novelText, /接下了这次来意|能正面回应的位置|合不合口味|满意就好|掌灶/, "real prose must not regress to scheduler narration, invented titles, or generic service talk");
assert.doesNotMatch(
  draft.novelText,
  /(?:饭|茶).{0,10}(?:马上|这就|待会儿|一会儿|等下|稍后|就).{0,8}(?:来|端|送|好|热|盛|煮|上)/,
  "a reception line must not create an untracked promise that food or tea is about to arrive",
);
for (const action of draft.causalScene.actions.filter((item) => item.speech)) {
  if (/^(?:这位)?客官[，,：:\s]/.test(action.speech)) {
    assert.equal(state.characters.find((character) => character.id === action.targetCharacterId)?.lifeProfile?.simulationTier, "visitor", "客官称谓必须指向真实访客");
  }
  if (/^(?:谢)?掌柜[，,：:\s]/.test(action.speech)) assert.equal(action.targetCharacterId, ids.mother, "掌柜称谓必须指向谢母");
  if (/^(?:谢|酒馆)?东家[，,：:\s]/.test(action.speech)) assert.equal(action.targetCharacterId, ids.father, "东家称谓必须指向谢恒");
}
assert.ok(draft.causalScene.actions.every((action) => (
  !/(?:把|将|端着).{0,16}(?:热饭|饭碗|热茶|茶碗).{0,16}(?:交到|递给|端到|放到|放在).{0,8}(?:面前|桌上|手中)/.test(action.visibleAction || "")
  || ["serve_guest", "verify_and_serve_work_meal"].includes(action.affordanceType)
)), "a visible meal handoff must be backed by the serving state machine");
assert.ok(draft.causalScene.actions.every((action) => (
  !/(?:数出|取出|摸出|掏出|拿出).{0,14}(?:铜钱|钱).{0,16}(?:放在|放到|递给|交给|推给|推到|推过去)/.test(action.visibleAction || "")
  || ["pay_cash", "settle_cash"].includes(action.affordanceType)
)), "a visible cash handoff must be backed by the payment state machine");
assert.ok(draft.causalScene.actions.every((action) => (
  !/(?:铜钱|房饭钱|饭钱|茶钱).{0,16}(?:收进|收入|收下|点清).{0,8}(?:钱箱|柜台|手中)?/.test(action.visibleAction || "")
  || ["pay_cash", "settle_cash"].includes(action.affordanceType)
)), "cash already settled by the payment state machine must not be collected a second time");
assert.ok(draft.causalScene.actions.every((action) => !action.moveToZoneId || Boolean(action.visibleAction)), "every committed movement must remain visible in the public scene");
assert.ok(progress.some((event) => event.type === "causal_agent_activated"));
assert.ok(progress.some((event) => event.type === "impact_delivered"));
assert.ok(progress.some((event) => event.type === "action" || event.type === "dialogue"));
const causalRelationshipShifts = (draft.updateBundle.relationships || [])
  .filter((shift) => shift.generatedFrom === "character-agent-owned-appraisal");
assert.ok(
  !(draft.updateBundle.relationships || []).some((shift) => shift.generatedFrom === "causal-perceived-relationship-outcome"),
  "world-observed hospitality must not automatically write a recipient's relationship",
);
for (const shift of causalRelationshipShifts) {
  const action = draft.causalScene.actions.find((item) => item.id === shift.sourceActionId);
  const delivery = draft.causalScene.deliveries.find((item) => (
    item.impactId === shift.sourceImpactId
    && item.recipientId === shift.fromCharacterId
    && item.sourceCharacterId === shift.toCharacterId
  ));
  assert.equal(action?.actorId, shift.toCharacterId, "relationship direction must be recipient-to-actor");
  assert.ok(action?.impactFactors.some((impact) => impact.id === shift.sourceImpactId), "relationship evidence must belong to the committed action");
  assert.ok(delivery, "relationship evidence must have physically reached the relationship holder");
}

console.log("realTavernCausalScene:smoke passed", {
  model: draft.model,
  elapsedMs: Date.now() - startedAt,
  sceneSeconds: draft.causalScene.elapsedSeconds,
  stopReason: draft.causalScene.stopReason,
  relationshipShifts: causalRelationshipShifts.map((shift) => `${shift.fromCharacterId}->${shift.toCharacterId}`),
  activations: draft.causalScene.activations.map((item) => `${item.characterName}:${item.activationScore}`),
  actions: draft.causalScene.actions.map((action) => ({
    actor: action.actorName,
    zone: action.actorZoneId,
    action: action.visibleAction,
    speech: action.speech,
    reached: [...new Set(draft.causalScene.deliveries
      .filter((delivery) => action.impactFactors.some((impact) => impact.id === delivery.impactId))
      .map((delivery) => state.characters.find((character) => character.id === delivery.recipientId)?.name || delivery.recipientId))],
  })),
  prose: draft.novelText,
});
