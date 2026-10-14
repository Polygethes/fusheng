import assert from "node:assert/strict";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import {
  applyTavernCausalAffordance,
  listTavernCausalAffordances,
  prepareTavernCausalSlot,
  TAVERN_CAUSAL_DAY_SLOTS,
} from "../src/server/pipeline/tavernCausalEconomy.mjs";

const IDS = {
  mother: "char_xyy_xiemu",
  chen: "char_xyy_chenyan",
};

const failures = [];

function check(label, fn) {
  try {
    return fn();
  } catch (error) {
    failures.push({ label, message: error.message });
    return null;
  }
}

function buildScenario(name) {
  const state = buildPlayableWorldFromSetup({
    setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
    setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
  });
  const dawn = TAVERN_CAUSAL_DAY_SLOTS.find((slot) => slot.id === "dawn");
  const prepared = prepareTavernCausalSlot(state, { day: 1, slot: dawn });
  const visit = prepared.state.tavernState.activeVisits.find((item) => item.visitorId === IDS.chen);
  assert.ok(visit, `${name}: 陈砚的以工换饭来访不存在`);

  // This fixture starts at the already-public, already-received boundary so this
  // test can isolate the work contract. Every contract transition below still
  // travels through listTavernCausalAffordances + applyTavernCausalAffordance.
  visit.purposeStatus = "declared";
  visit.purposeDisclosureStatus = "declared";
  visit.declaredPurpose = visit.purpose;
  visit.hostId = IDS.mother;
  visit.receivedBy = IDS.mother;
  visit.stage = "received";

  const runtime = {
    elapsedSeconds: 0,
    topology: {
      zones: {
        threshold: { id: "threshold", label: "门槛" },
        hall: { id: "hall", label: "堂前" },
        stove: { id: "stove", label: "灶边" },
        courtyard: { id: "courtyard", label: "后院" },
      },
      edges: [
        { from: "threshold", to: "hall", move: 1 },
        { from: "hall", to: "stove", move: 1 },
        { from: "hall", to: "courtyard", move: 1 },
      ],
    },
    agents: {
      [IDS.mother]: {
        characterId: IDS.mother,
        characterName: "谢母",
        present: true,
        zoneId: "hall",
      },
      [IDS.chen]: {
        characterId: IDS.chen,
        characterName: "陈砚",
        present: true,
        zoneId: "hall",
      },
    },
  };

  const scenario = {
    name,
    state: prepared.state,
    visit,
    runtime,
    sequence: 0,
  };

  // Listing is deliberately the only way to materialize/synchronize the
  // selected open work order into the visit-facing contract.
  listTavernCausalAffordances(scenario.state, scenario.runtime, IDS.mother, [IDS.chen]);
  assert.ok(visit.workExchange?.workOrderId, `${name}: 未从环境中的开放工单形成具体合同`);
  return scenario;
}

function listFor(scenario, actorId) {
  const perceivedCharacterIds = Object.keys(scenario.runtime.agents).filter((id) => id !== actorId);
  return listTavernCausalAffordances(
    scenario.state,
    scenario.runtime,
    actorId,
    perceivedCharacterIds,
  ).filter((item) => item.visitId === scenario.visit.id);
}

function takeAction(scenario, {
  actorId,
  type,
  speech = "",
}) {
  const available = listFor(scenario, actorId);
  const selected = available.find((item) => item.type === type);
  assert.ok(
    selected,
    `${scenario.name}: 缺少 ${type}；当前可用=[${available.map((item) => item.type).join(", ")}]`,
  );
  scenario.sequence += 1;
  const action = {
    id: `phase59_work_lifecycle:${scenario.name}:${scenario.sequence}:${type}`,
    actorId,
    targetCharacterId: selected.targetCharacterId,
    moveToZoneId: selected.moveToZoneId,
    speech,
    visibleAction: selected.canonicalVisibleAction,
    day: 1,
    slotLabel: "清晨",
  };
  const perceivedCharacterIds = Object.keys(scenario.runtime.agents).filter((id) => id !== actorId);
  const result = applyTavernCausalAffordance(
    scenario.state,
    scenario.runtime,
    action,
    selected,
    perceivedCharacterIds,
  );
  const transitionByType = {
    assign_work: "offer",
    accept_work: "accept",
    refuse_work: "refuse",
    perform_work: "execute",
    submit_work: "submit",
    verify_work: "verify",
    serve_work_meal: "compensate",
  };
  const objective = scenario.visit.objectiveGraph?.objectives?.find(
    (item) => item.id === selected.objectiveId,
  );
  const requiredObjectIds = objective?.task?.preconditions?.[transitionByType[type]]?.objectIds || [];
  const suppliedObjectIds = [...new Set([...(selected.objectIds || []), ...(selected.toolIds || [])])];
  assert.ok(
    result,
    `${scenario.name}: ${type} 被列为可用，但执行入口拒绝了同一个动作；合同所需物件=[${requiredObjectIds.join(", ")}]，动作携带物件=[${suppliedObjectIds.join(", ")}]`,
  );
  if (selected.moveToZoneId) scenario.runtime.agents[actorId].zoneId = selected.moveToZoneId;
  return { selected, result };
}

function prepareAndDeliverWorkMeal(scenario) {
  for (let step = 0; step < 5 && !listFor(scenario, IDS.mother).some((item) => item.type === "start_service_preparation"); step += 1) {
    const approach = listFor(scenario, IDS.mother).find((item) => (
      item.type === "approach_service_vessel" || item.type === "approach_service_station"
    ));
    assert.ok(approach, `${scenario.name}: 店家必须能走到饭碗或灶边`);
    takeAction(scenario, { actorId: IDS.mother, type: approach.type });
  }

  takeAction(scenario, { actorId: IDS.mother, type: "start_service_preparation" });
  const process = scenario.state.tavernState.serviceProcesses.find((item) => item.subjectId === scenario.visit.id);
  assert.ok(process?.durationSeconds > 0, `${scenario.name}: 热饭必须占用真实世界时间`);
  assert.equal(scenario.visit.serviceStatus, "preparing");
  assert.equal(scenario.visit.servicePreparationStatus, "preparing");
  scenario.runtime.elapsedSeconds += process.durationSeconds;

  takeAction(scenario, { actorId: IDS.mother, type: "finish_service_preparation" });
  assert.equal(scenario.visit.serviceStatus, "prepared");

  for (let step = 0; step < 5 && !listFor(scenario, IDS.mother).some((item) => item.type === "serve_work_meal"); step += 1) {
    const carry = listFor(scenario, IDS.mother).find((item) => item.type === "approach_service_delivery");
    assert.ok(carry, `${scenario.name}: 做好的饭必须能被端回客人所在位置`);
    takeAction(scenario, { actorId: IDS.mother, type: "approach_service_delivery" });
  }
  return takeAction(scenario, { actorId: IDS.mother, type: "serve_work_meal" });
}

function contractScope(visit) {
  return {
    taskId: visit.workExchange?.agreement?.taskId,
    description: visit.workExchange?.agreement?.description,
    requiredUnits: visit.workExchange?.execution?.requiredUnits,
    zoneIds: [...(visit.workExchange?.agreement?.zoneIds || [])],
    completionCriteria: [...(visit.workExchange?.agreement?.completionCriteria || [])],
    objectIds: [...(visit.workExchange?.agreement?.objectIds || [])],
    toolIds: [...(visit.workExchange?.agreement?.toolIds || [])],
  };
}

function workOrder(scenario) {
  return scenario.state.tavernState.workOrders.find(
    (item) => item.id === scenario.visit.workExchange?.workOrderId,
  );
}

const completion = check("completion fixture", () => buildScenario("completion"));
let completionHealthy = Boolean(completion);
let lockedScope = null;
let initialMealStock = 0;

if (completion) {
  initialMealStock = Number(completion.state.tavernState.stock.meals || 0);
  completionHealthy = Boolean(check("offer concrete work order", () => {
    const offered = takeAction(completion, {
      actorId: IDS.mother,
      type: "assign_work",
      speech: "陈砚，把堂前这两张空桌收净，我验过便给你一碗热饭。",
    });
    const order = workOrder(completion);
    assert.equal(completion.visit.workExchange.agreement.status, "offered");
    assert.equal(completion.visit.workStatus, "offered");
    assert.equal(completion.visit.workExchange.agreement.acceptedActionId || "", "");
    assert.equal(order?.status, "offered");
    assert.equal(Number(order?.completedUnits || 0), 0);
    assert.ok(!listFor(completion, IDS.chen).some((item) => item.type === "perform_work"));
    lockedScope = contractScope(completion.visit);
    assert.equal(lockedScope.taskId, offered.selected.taskId);
    assert.equal(lockedScope.requiredUnits, offered.selected.requiredUnits);
    assert.ok(lockedScope.description);
    assert.ok(lockedScope.zoneIds.length);
    assert.ok(lockedScope.completionCriteria.length);
    return true;
  }));
}

if (completionHealthy) completionHealthy = Boolean(check("worker explicitly accepts locked scope", () => {
  takeAction(completion, {
    actorId: IDS.chen,
    type: "accept_work",
    speech: "成，就照这两张桌子的标准做，验过换一碗饭。",
  });
  assert.equal(completion.visit.workExchange.agreement.status, "accepted");
  assert.equal(completion.visit.workStatus, "assigned");
  assert.equal(completion.visit.workExchange.agreement.acceptedByActorId, IDS.chen);
  assert.ok(completion.visit.workExchange.agreement.acceptedActionId);
  assert.deepEqual(contractScope(completion.visit), lockedScope);
  assert.equal(workOrder(completion)?.status, "accepted");
  return true;
}));

if (completionHealthy) completionHealthy = Boolean(check("execute required units and block early submission", () => {
  const requiredUnits = Number(completion.visit.workExchange.execution.requiredUnits || 0);
  assert.ok(requiredUnits > 1, "测试工单必须至少需要两个可分次完成的单位");
  assert.ok(!listFor(completion, IDS.chen).some((item) => item.type === "submit_work"));

  for (let index = 0; index < requiredUnits; index += 1) {
    takeAction(completion, { actorId: IDS.chen, type: "perform_work" });
    assert.equal(Number(workOrder(completion)?.completedUnits || 0), index + 1);
    assert.deepEqual(contractScope(completion.visit), lockedScope);
    const canSubmit = listFor(completion, IDS.chen).some((item) => item.type === "submit_work");
    if (index + 1 < requiredUnits) assert.equal(canSubmit, false, `只完成 ${index + 1}/${requiredUnits} 时不得提交`);
    else assert.equal(canSubmit, true, `达到 ${requiredUnits}/${requiredUnits} 后应允许提交`);
  }
  return true;
}));

if (completionHealthy) completionHealthy = Boolean(check("worker submits only after reaching required units", () => {
  takeAction(completion, {
    actorId: IDS.chen,
    type: "submit_work",
    speech: "两张桌子都收净了，请照刚才说的标准验一遍。",
  });
  assert.equal(completion.visit.workExchange.execution.status, "submitted");
  assert.equal(completion.visit.workStatus, "done");
  assert.equal(completion.visit.workExchange.verification.status, "pending");
  assert.equal(completion.state.tavernState.stock.meals, initialMealStock);
  assert.deepEqual(contractScope(completion.visit), lockedScope);
  return true;
}));

if (completionHealthy) completionHealthy = Boolean(check("host verifies without silently paying compensation", () => {
  takeAction(completion, { actorId: IDS.mother, type: "verify_work" });
  assert.equal(completion.visit.workExchange.verification.status, "verified");
  assert.equal(completion.visit.workStatus, "verified");
  assert.equal(completion.visit.workExchange.compensation.status, "pending");
  assert.equal(completion.visit.serviceStatus, "pending");
  assert.equal(completion.visit.paymentStatus, "unsettled");
  assert.equal(completion.state.tavernState.stock.meals, initialMealStock);
  assert.equal(workOrder(completion)?.status, "accepted");
  return true;
}));

if (completionHealthy) check("meal delivery compensates the exchange; actual eating closes the visit", () => {
  prepareAndDeliverWorkMeal(completion);
  assert.equal(completion.visit.workExchange.compensation.status, "delivered");
  assert.equal(completion.visit.serviceStatus, "served");
  assert.equal(completion.visit.serviceConsumptionStatus, "pending");
  assert.equal(completion.visit.paymentStatus, "work_settled");
  assert.notEqual(completion.visit.stage, "completed");
  assert.equal(workOrder(completion)?.status, "completed");
  assert.equal(completion.state.tavernState.stock.meals, initialMealStock - 1);
  assert.deepEqual(contractScope(completion.visit), lockedScope);
  assert.ok(!listFor(completion, IDS.mother).some((item) => item.type === "serve_work_meal"));
  const vesselId = completion.visit.servedObjectIds[0];
  assert.ok(vesselId, "交饭必须绑定一只真实饭碗");
  assert.equal(completion.state.tavernState.objectLedger.objects[vesselId].state.contents, "work_meal");
  assert.ok(listFor(completion, IDS.chen).some((item) => item.type === "consume_service"));

  takeAction(completion, { actorId: IDS.chen, type: "consume_service" });
  assert.equal(completion.visit.serviceConsumptionStatus, "consumed");
  assert.equal(completion.visit.stage, "completed");
  assert.equal(completion.state.tavernState.objectLedger.objects[vesselId].state.contents, "empty");
  assert.equal(completion.state.tavernState.objectLedger.objects[vesselId].holderActorId, "");
});

const refusal = check("refusal fixture", () => buildScenario("refusal"));
let refusalHealthy = Boolean(refusal);
let refusalInitialMeals = 0;

if (refusal) {
  refusalInitialMeals = Number(refusal.state.tavernState.stock.meals || 0);
  refusalHealthy = Boolean(check("host offers before refusal", () => {
    takeAction(refusal, {
      actorId: IDS.mother,
      type: "assign_work",
      speech: "陈砚，把堂前这两张空桌收净，我验过便给你一碗热饭。",
    });
    assert.equal(workOrder(refusal)?.status, "offered");
    return true;
  }));
}

if (refusalHealthy) check("refusal reopens order and forbids execution", () => {
  takeAction(refusal, {
    actorId: IDS.chen,
    type: "refuse_work",
    speech: "这两张桌子的活我今天接不了，饭也先不换了。",
  });
  const order = workOrder(refusal);
  assert.equal(refusal.visit.workExchange.agreement.status, "refused");
  assert.equal(refusal.visit.workStatus, "refused");
  assert.equal(refusal.visit.stage, "refused");
  assert.equal(order?.status, "open");
  assert.equal(order?.offeredVisitId || "", "");
  assert.equal(order?.assignedActorId || "", "");
  const postRefusal = listFor(refusal, IDS.chen);
  assert.ok(!postRefusal.some((item) => item.type === "perform_work"));
  assert.ok(!postRefusal.some((item) => item.type === "accept_work"));
  assert.equal(refusal.state.tavernState.stock.meals, refusalInitialMeals);
});

if (failures.length) {
  console.error("tavernPhase59WorkLifecycle:test RED", failures);
  process.exitCode = 1;
} else {
  console.log("tavernPhase59WorkLifecycle:test passed", {
    completedVisitId: completion.visit.id,
    completedWorkOrderId: completion.visit.workExchange.workOrderId,
    requiredUnits: completion.visit.workExchange.execution.requiredUnits,
    compensationStatus: completion.visit.workExchange.compensation.status,
    mealsDelta: completion.state.tavernState.stock.meals - initialMealStock,
    refusedVisitId: refusal.visit.id,
    reopenedWorkOrderId: refusal.visit.workExchange.workOrderId,
  });
}
