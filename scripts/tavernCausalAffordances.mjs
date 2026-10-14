import assert from "node:assert/strict";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import {
  listTavernCausalAffordances,
  runTavernCausalScene,
} from "../src/server/pipeline/tavernCausalScene.mjs";
import {
  prepareTavernCausalSlot,
  TAVERN_CAUSAL_DAY_SLOTS,
} from "../src/server/pipeline/tavernCausalEconomy.mjs";

// Keep generated action/impact identifiers stable so the scheduler's
// deterministic tie-breaks exercise the same causal path on every run.
let randomState = 0x59ca11fe;
Math.random = () => {
  randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
  return randomState / 0x100000000;
};

const baseState = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
const state = prepareTavernCausalSlot(baseState, {
  day: 1,
  slot: TAVERN_CAUSAL_DAY_SLOTS.find((item) => item.id === "dawn"),
}).state;
state.ui.timeGrain = "scene";
state.ui.engineMode = "openai";

const mother = "char_xyy_xiemu";
const father = "char_xyy_xieheng";
const chen = "char_xyy_chenyan";
const luo = "char_xyy_luozhao";
const mealBefore = state.tavernState.stock.meals;
state.characters.find((character) => character.id === mother).lifeState.present = true;
state.characters.find((character) => character.id === chen).lifeState.present = true;
state.tavernState.activeVisits = [{
  id: "visit_work_meal_red",
  visitorId: chen,
  visitorName: "陈砚",
  situationalRole: "以工换饭的熟客",
  purpose: "做一段堂前杂务换一碗热饭",
  purposeStatus: "declared",
  purposeDisclosureStatus: "declared",
  purposeDeclaredByActionId: "fixture:work-meal-purpose",
  kind: "work_exchange",
  expectedHostIds: [mother, "char_xyy_xiezenshi"],
  requestedService: "work_meal",
  paymentMode: "work_exchange",
  completionCondition: "掌柜或店伙验过杂务，热饭送到，交换两清",
  stage: "waiting",
  hostId: "",
  workStatus: "unassigned",
  serviceStatus: "pending",
  paymentStatus: "unsettled",
  arrivedDay: 1,
  arrivedSlot: "清晨",
}];

const inputs = [];
const result = await runTavernCausalScene(state, {
  characterIds: [mother, chen],
  positions: { [mother]: "hall", [chen]: "hall" },
  maxSteps: 48,
  minimumActivationScore: 20,
  async runAgent(input) {
    inputs.push(structuredClone(input));
    const choose = (type) => input.availableAffordances.find((item) => item.type === type);
    const selected = [
      "receive_guest",
      "assign_work",
      "accept_work",
      "perform_work",
      "submit_work",
      "verify_work",
      "approach_service_vessel",
      "approach_service_station",
      "start_service_preparation",
      "finish_service_preparation",
      "approach_service_delivery",
      "serve_work_meal",
      "consume_service",
    ].map(choose).find(Boolean);
    if (selected) {
      const selectedCandidate = input.privateActionCandidates.find((candidate) => (
        candidate.feasible && candidate.realization?.affordanceId === selected.id
      ));
      assert.ok(selectedCandidate, `missing private candidate for affordance ${selected.type}`);
      const realizationByType = {
        receive_guest: {
          speechAct: "inform",
          speech: "陈砚，我知道你今日仍是做杂务换饭。",
        },
        assign_work: {
          speechAct: "offer",
          speech: "陈砚，把堂前这两张空桌收净，我验过便给你一碗热饭。",
        },
        accept_work: {
          speechAct: "answer",
          speech: "成，就照这两张桌子的标准做，验过换一碗饭。",
        },
        submit_work: {
          speechAct: "inform",
          speech: "堂前两张桌已经收净，请您按两项标准验收。",
        },
      };
      const realization = realizationByType[selected.type] || {
        speechAct: "none",
        speech: "",
      };
      return { decision: {
        candidateId: selectedCandidate.candidateId,
        actionType: selected.actionType,
        speechAct: realization.speechAct,
        targetCharacterId: selected.targetCharacterId,
        speech: realization.speech,
        visibleAction: "",
        moveToZoneId: selected.moveToZoneId || "",
        affordanceId: selected.id,
        informationSourceImpactId: "",
        commitmentAction: "none",
        commitmentTopic: "",
        privateReason: "按眼下已经发生的经营事实继续。",
      } };
    }
    const workFact = input.materialFacts.find((fact) => fact.visitId === "visit_work_meal_red");
    if (input.agent.id === chen && workFact?.stage === "received" && workFact.workStatus === "unassigned") {
      const candidate = input.privateActionCandidates.find((row) => row.feasible && row.targetCharacterId === mother);
      assert.ok(candidate);
      return { decision: {
        candidateId: candidate.candidateId,
        actionType: "speak",
        speechAct: "ask",
        targetCharacterId: mother,
        speech: "婶娘，堂前两张桌还没说定；您指哪两张，我做完请您验。",
        visibleAction: "",
        moveToZoneId: "",
        affordanceId: "",
        informationSourceImpactId: "",
        commitmentAction: "open",
        commitmentTopic: "以工换饭的具体工作",
        privateReason: "已经被接待，但具体工作尚未提出，必须当面问清范围。",
      } };
    }
    if (input.agent.id === chen && workFact?.workStatus === "verified" && workFact.serviceStatus === "pending") {
      const candidate = input.privateActionCandidates.find((row) => row.feasible && row.targetCharacterId === mother);
      if (candidate) {
        return { decision: {
          candidateId: candidate.candidateId,
          actionType: "speak",
          speechAct: "ask",
          targetCharacterId: mother,
          speech: "婶娘，桌子既验过了，说定的那碗饭劳您端来。",
          visibleAction: "",
          moveToZoneId: "",
          affordanceId: "",
          informationSourceImpactId: "",
          commitmentAction: "open",
          commitmentTopic: "以工换饭的热饭报酬",
          privateReason: "工作已经验收，但报酬尚未交付；只有经手人在可交流范围内时才开口催问。",
        } };
      }
    }
    const candidate = input.privateActionCandidates.find((row) => row.feasible && !row.realization?.affordanceId)
      || input.privateActionCandidates.find((row) => row.feasible);
    return { decision: {
      candidateId: candidate?.candidateId || "",
      actionType: "pass",
      speechAct: "none",
      targetCharacterId: "",
      speech: "",
      visibleAction: "",
      moveToZoneId: "",
      affordanceId: "",
      informationSourceImpactId: "",
      commitmentAction: "none",
      commitmentTopic: "",
      privateReason: "当前没有新的未结事务。",
    } };
  },
});

const visit = result.tavernState.activeVisits.find((item) => item.id === "visit_work_meal_red");
if (visit.stage !== "completed") {
  console.error("work lifecycle diagnostic", JSON.stringify({
    stopReason: result.stopReason,
    actions: result.actions.map((action) => ({
      actorId: action.actorId,
      type: action.affordanceType || action.actionType,
      speech: action.speech,
      materialConsequence: action.materialConsequence,
    })),
    stage: visit.stage,
    workStatus: visit.workStatus,
    executionStatus: visit.workExchange?.execution?.status,
    verificationStatus: visit.workExchange?.verification?.status,
    compensationStatus: visit.workExchange?.compensation?.status,
    serviceStatus: visit.serviceStatus,
    serviceConsumptionStatus: visit.serviceConsumptionStatus,
  }, null, 2));
}
assert.equal(visit.stage, "completed", "work-for-meal must reach one authoritative completed state");
assert.equal(visit.workStatus, "verified");
assert.equal(visit.serviceStatus, "served");
assert.equal(visit.serviceConsumptionStatus, "consumed", "delivery alone is not completion; the worker must actually eat");
assert.equal(visit.paymentStatus, "work_settled");
assert.equal(result.tavernState.stock.meals, mealBefore - 1, "the served meal must be consumed exactly once");
assert.equal(result.tavernState.ledger.filter((entry) => entry.visitId === visit.id).length, 1, "one exchange creates one ledger entry");
const requiredWorkUnits = Number(visit.workExchange?.execution?.requiredUnits || 0);
assert.ok(requiredWorkUnits > 0, "the work contract must require concrete execution units");
const completedWorkOrder = result.tavernState.workOrders.find((item) => item.id === visit.workExchange?.workOrderId);
assert.equal(completedWorkOrder?.completedUnits, requiredWorkUnits, "execution must satisfy every required unit exactly once");
const materialActionTypes = result.actions
  .filter((action) => action.affordanceId)
  .map((action) => action.affordanceType);
const requiredCausalStages = [
  "receive_guest",
  "assign_work",
  "accept_work",
  ...Array.from({ length: requiredWorkUnits }, () => "perform_work"),
  "submit_work",
  "verify_work",
  "start_service_preparation",
  "finish_service_preparation",
  "serve_work_meal",
  "consume_service",
];
let previousStageIndex = -1;
for (const stage of requiredCausalStages) {
  const stageIndex = materialActionTypes.indexOf(stage, previousStageIndex + 1);
  assert.ok(stageIndex > previousStageIndex, `${stage} must occur once the preceding causal stage is complete`);
  previousStageIndex = stageIndex;
}
assert.ok(
  materialActionTypes.some((type) => type === "approach_service_vessel" || type === "approach_service_station"),
  "meal preparation must require a physical approach to its vessel or work station",
);
assert.ok(
  materialActionTypes.includes("approach_service_delivery"),
  "the prepared meal must be physically carried back before it can be served",
);
const consumedVessel = result.tavernState.objectLedger.objects[visit.servedObjectIds[0]];
assert.equal(consumedVessel?.state?.contents, "empty", "consume_service must empty the physical serving vessel");
assert.equal(consumedVessel?.holderActorId || "", "", "the emptied vessel must not remain invisibly held");
assert.ok(result.actions.every((action) => action.affordanceId || !action.materialConsequence), "material consequences require a validated affordance");
assert.ok(inputs.some((input) => input.materialFacts.some((fact) => fact.stage === "received")), "later Agents receive committed public material facts");

const finalAffordances = listTavernCausalAffordances(
  { ...state, tavernState: result.tavernState },
  result.privateSceneRuntime,
  mother,
);
assert.ok(!finalAffordances.some((item) => item.visitId === visit.id), "completed work cannot be assigned, served, or settled a second time");

const contradictionProbe = await runTavernCausalScene({
  ...state,
  tavernState: result.tavernState,
}, {
  characterIds: [mother, chen],
  positions: { [mother]: "hall", [chen]: "hall" },
  seedImpacts: [{
    sourceCharacterId: "world:contradiction-probe",
    sourceZoneId: "hall",
    type: "institution",
    modality: "sound",
    intensity: 90,
    radius: 0,
    directedTargetId: mother,
    content: "核对刚刚已经结清的以工换饭。",
  }],
  maxSteps: 1,
  minimumActivationScore: 20,
  async runAgent(input) {
    const candidate = input.privateActionCandidates.find((row) => row.feasible && row.targetCharacterId === chen)
      || input.privateActionCandidates.find((row) => row.feasible);
    return { decision: {
      candidateId: candidate?.candidateId || "",
      actionType: "speak",
      speechAct: "ask",
      targetCharacterId: chen,
      speech: "陈砚，你今天的饭已经吃了还是还没端？",
      visibleAction: "谢母抬眼看向陈砚",
      moveToZoneId: "",
      affordanceId: "",
      informationSourceImpactId: "",
      commitmentAction: "none",
      commitmentTopic: "",
      privateReason: "故意探测矛盾问句。",
    } };
  },
});
const repeatedMealQuestion = contradictionProbe.actions.find((action) => action.speech === "陈砚，你今天的饭已经吃了还是还没端？");
assert.ok(repeatedMealQuestion, "forgetting, doubting, or deliberately re-asking a settled material fact remains a public utterance");
assert.ok(
  contradictionProbe.decisions[0].decision.claimAnnotations.some((row) => row.code === "RESOLVED_MATERIAL_FACT_QUESTIONED_AGAIN"),
  "the world records the conflict as a claim annotation instead of censoring the speaker",
);
const settledWorkVisit = [
  ...(contradictionProbe.tavernState.activeVisits || []),
  ...(contradictionProbe.tavernState.visits || []),
].find((row) => row.id === visit.id);
assert.equal(settledWorkVisit?.serviceStatus, "served", "the repeated question must not undo the authoritative meal delivery");
assert.equal(settledWorkVisit?.serviceConsumptionStatus, "consumed", "the repeated question must not undo the already consumed meal");

const lodgingState = structuredClone(state);
lodgingState.characters.find((character) => character.id === mother).lifeState.present = true;
lodgingState.characters.find((character) => character.id === luo).lifeState.present = true;
lodgingState.tavernState.activeVisits = [{
  id: "visit_lodging_key_red",
  visitorId: luo,
  visitorName: "洛照",
  purpose: "住一晚等接引，并在堂前吃一顿热饭",
  purposeStatus: "declared",
  purposeDisclosureStatus: "declared",
  purposeDeclaredByActionId: "fixture:lodging-purpose",
  kind: "lodging",
  expectedHostIds: [mother],
  requestedService: "lodging_meal",
  paymentMode: "cash",
  stage: "served",
  hostId: mother,
  serviceStatus: "served",
  lodgingStatus: "pending",
  deliveryStatus: "not_required",
  workStatus: "not_required",
  paymentStatus: "unpaid",
}];
const lodgingResult = await runTavernCausalScene(lodgingState, {
  characterIds: [mother, luo],
  positions: { [mother]: "hall", [luo]: "hall" },
  seedImpacts: [{
    sourceCharacterId: "world:lodging-key",
    sourceZoneId: "hall",
    type: "institution",
    modality: "sound",
    intensity: 90,
    radius: 0,
    directedTargetId: mother,
    content: "客房钥匙还没有交给住客。",
  }],
  maxSteps: 1,
  minimumActivationScore: 20,
  async runAgent(input) {
    assert.ok(input.availableAffordances.some((item) => item.type === "assign_lodging"));
    assert.ok(!input.availableAffordances.some((item) => item.type === "settle_cash"), "lodging money cannot be collected before the key is delivered");
    const selected = input.availableAffordances.find((item) => item.type === "assign_lodging");
    const selectedCandidate = input.privateActionCandidates.find((candidate) => candidate.feasible && candidate.realization?.affordanceId === selected.id);
    assert.ok(selectedCandidate);
    return { decision: {
      candidateId: selectedCandidate.candidateId,
      actionType: selected.actionType,
      speechAct: "inform",
      targetCharacterId: luo,
      speech: "客房在楼上靠窗，这把钥匙你收好。",
      visibleAction: "",
      moveToZoneId: "",
      affordanceId: selected.id,
      informationSourceImpactId: "",
      commitmentAction: "none",
      commitmentTopic: "",
      privateReason: "先交付钥匙，再结房饭钱。",
    } };
  },
});
const lodgingVisit = lodgingResult.tavernState.activeVisits.find((item) => item.id === "visit_lodging_key_red");
assert.equal(lodgingVisit.lodgingStatus, "assigned");
assert.equal(lodgingVisit.keyDelivered, true);
assert.ok(listTavernCausalAffordances(
  { ...lodgingState, tavernState: lodgingResult.tavernState },
  lodgingResult.privateSceneRuntime,
  mother,
).some((item) => item.type === "settle_cash"), "payment becomes legal only after room, key, and meal are all delivered");

const currencyState = structuredClone(state);
currencyState.characters.find((character) => character.id === mother).lifeState.present = true;
currencyState.characters.find((character) => character.id === luo).lifeState.present = true;
currencyState.tavernState.activeVisits = [{
  id: "visit_currency_gate_red",
  visitorId: luo,
  visitorName: "洛照",
  purpose: "住一晚并吃一顿热饭",
  purposeStatus: "declared",
  purposeDisclosureStatus: "declared",
  purposeDeclaredByActionId: "fixture:currency-purpose",
  kind: "lodging",
  expectedHostIds: [mother],
  requestedService: "lodging_meal",
  paymentMode: "cash",
  stage: "waiting",
  hostId: "",
  serviceStatus: "pending",
  lodgingStatus: "pending",
  paymentStatus: "unpaid",
}];
const currencyResult = await runTavernCausalScene(currencyState, {
  characterIds: [mother, luo],
  positions: { [mother]: "hall", [luo]: "hall" },
  maxSteps: 1,
  minimumActivationScore: 0,
  async runAgent(input) {
    const candidate = input.privateActionCandidates.find((row) => row.feasible && row.targetCharacterId === luo)
      || input.privateActionCandidates.find((row) => row.feasible);
    return { decision: {
      candidateId: candidate?.candidateId || "",
      actionType: "speak",
      speechAct: "inform",
      targetCharacterId: luo,
      speech: "客房一晚五钱银，连饭带宿。",
      visibleAction: "谢母迎到洛照面前",
      moveToZoneId: "",
      affordanceId: "",
      informationSourceImpactId: "",
      commitmentAction: "none",
      commitmentTopic: "住店价钱",
      privateReason: "故意探测错误币制。",
    } };
  },
});
assert.ok(currencyResult.decisions[0].decision.claimAnnotations.some((violation) => violation.code === "MATERIAL_CURRENCY_MISMATCH"));
assert.ok(currencyResult.actions.some((action) => /银/.test(action.speech || "")), "a mistaken, deceptive, or joking silver price remains something the character actually said");
const currencyVisit = currencyResult.tavernState.activeVisits.find((item) => item.id === "visit_currency_gate_red");
assert.equal(currencyVisit.hostId, mother, "the physically valid reception still happens");
assert.equal(currencyVisit.lodgingStatus, "pending", "the false price claim must not assign a room");
assert.equal(currencyVisit.serviceStatus, "pending", "the false price claim must not serve a meal");
assert.equal(currencyVisit.paymentStatus, "unpaid", "the false price claim must not settle money");

const unauthorizedServiceState = structuredClone(state);
for (const characterId of [father, luo]) unauthorizedServiceState.characters.find((character) => character.id === characterId).lifeState.present = true;
unauthorizedServiceState.tavernState.activeVisits = [{
  id: "visit_service_gate_red",
  visitorId: luo,
  visitorName: "洛照",
  purpose: "吃一碗热饭",
  purposeStatus: "declared",
  purposeDisclosureStatus: "declared",
  purposeDeclaredByActionId: "fixture:unauthorized-service-purpose",
  kind: "meal",
  expectedHostIds: [mother],
  requestedService: "meal",
  paymentMode: "cash",
  stage: "received",
  hostId: mother,
  serviceStatus: "pending",
  lodgingStatus: "not_required",
  paymentStatus: "unpaid",
}];
const unauthorizedServiceResult = await runTavernCausalScene(unauthorizedServiceState, {
  characterIds: [father, luo],
  positions: { [father]: "hall", [luo]: "hall" },
  seedImpacts: [{
    sourceCharacterId: "world:unauthorized-service-probe",
    sourceZoneId: "hall",
    type: "institution",
    modality: "sound",
    intensity: 100,
    radius: 0,
    directedTargetId: father,
    content: "探测没有服务权限和 affordance 时能否凭文字交饭。",
  }],
  maxSteps: 1,
  minimumActivationScore: 0,
  async runAgent(input) {
    const candidate = input.privateActionCandidates.find((row) => row.feasible && row.targetCharacterId === luo)
      || input.privateActionCandidates.find((row) => row.feasible);
    return { decision: {
      candidateId: candidate?.candidateId || "",
      actionType: "interact",
      speechAct: "inform",
      targetCharacterId: luo,
      speech: "饭好了，趁热吃。",
      visibleAction: "谢恒把一碗热饭放在洛照面前的桌上",
      moveToZoneId: "",
      affordanceId: "",
      informationSourceImpactId: "",
      commitmentAction: "none",
      commitmentTopic: "交饭",
      privateReason: "故意探测没有世界提交的交饭动作。",
    } };
  },
});
const unauthorizedServiceAction = unauthorizedServiceResult.actions.find((action) => action.actorId === father);
assert.equal(unauthorizedServiceAction?.speech, "饭好了，趁热吃。", "the person's false or mistaken utterance must remain public");
assert.equal(unauthorizedServiceAction?.actionType, "speak", "only the physically unsupported part of a mixed speech/action output should be removed");
assert.ok(!/把一碗热饭放在/.test(unauthorizedServiceAction?.visibleAction || ""), "an unauthorized meal handoff must not become a visible world fact");
assert.ok(
  unauthorizedServiceResult.decisions[0].decision.actionAttemptFailures.some((violation) => violation.code === "MATERIAL_SERVICE_NOT_SERVED"),
  "the failed physical attempt must remain auditable without censoring the utterance",
);
const unauthorizedServiceVisit = unauthorizedServiceResult.tavernState.activeVisits.find((item) => item.id === "visit_service_gate_red");
assert.equal(unauthorizedServiceVisit.serviceStatus, "pending", "failed handoff prose must not consume stock or settle service");

console.log("tavernCausalAffordances:test passed", {
  actions: result.actions.map((action) => action.affordanceType || action.actionType),
  stage: visit.stage,
  meals: result.tavernState.stock.meals,
  ledgerEntries: result.tavernState.ledger.filter((entry) => entry.visitId === visit.id).length,
  contradictionSpeechAccepted: contradictionProbe.actions.some((action) => action.speech),
  lodgingKeyBeforeSettlement: lodgingVisit.keyDelivered,
  inventedSilverAccepted: currencyResult.actions.some((action) => /银/.test(action.speech || "")),
  unauthorizedMealSpeechAccepted: Boolean(unauthorizedServiceAction?.speech),
  unauthorizedMealHandoffCommitted: unauthorizedServiceVisit.serviceStatus !== "pending",
});
