import assert from "node:assert/strict";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import {
  applyTavernCausalAffordance,
  listTavernCausalAffordances,
  prepareTavernCausalSlot,
  TAVERN_CAUSAL_DAY_SLOTS,
} from "../src/server/pipeline/tavernCausalEconomy.mjs";
import {
  buildTavernVoiceContract,
  validateTavernVoiceRealization,
} from "../src/server/pipeline/tavernCharacterVoice.mjs";

const IDS = {
  son: "char_xyy_xiezenshi",
  father: "char_xyy_xieheng",
  mother: "char_xyy_xiemu",
  zhou: "char_xyy_zhoumin",
  luo: "char_xyy_luozhao",
  yan: "char_xyy_yanzhizhong",
  chen: "char_xyy_chenyan",
};

const failures = [];
function check(label, fn) {
  try {
    fn();
  } catch (error) {
    failures.push({ label, message: error.message });
  }
}

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
const dawn = TAVERN_CAUSAL_DAY_SLOTS.find((slot) => slot.id === "dawn");
const prepared = prepareTavernCausalSlot(state, { day: 1, slot: dawn });
const visit = prepared.state.tavernState.activeVisits.find((item) => item.visitorId === IDS.chen);

check("work-exchange visit exists", () => assert.ok(visit));
check("tavern state exposes concrete work orders", () => {
  assert.ok(Array.isArray(prepared.state.tavernState.workOrders));
  assert.ok(prepared.state.tavernState.workOrders.some((order) => (
    order.status === "open" && order.zoneId && order.taskLabel && Number(order.requiredUnits) > 0
  )));
});
check("visit owns a persistent objective graph", () => {
  assert.ok(Array.isArray(visit.objectives));
  for (const kind of ["disclosure", "reception", "work_exchange", "service"] ) {
    assert.ok(visit.objectives.some((objective) => objective.kind === kind), `missing ${kind}`);
  }
  assert.ok(visit.objectives.every((objective) => (
    objective.id
    && objective.status
    && Number.isFinite(objective.priority)
    && Array.isArray(objective.dependsOn)
    && Array.isArray(objective.evidenceActionIds)
  )));
});
check("work scope is an authoritative locked contract", () => {
  assert.ok(visit.workExchange?.agreement);
  assert.equal(visit.workExchange.agreement.status, "unoffered");
  assert.equal(visit.workExchange.agreement.assignedTo, IDS.chen);
  assert.equal(visit.workExchange.compensation?.kind, "meal");
  assert.ok(visit.workExchange.agreement.zoneIds?.length);
  assert.ok(visit.workExchange.agreement.description);
  assert.ok(visit.workExchange.agreement.completionCriteria?.length);
  assert.ok(Number(visit.workExchange.execution?.requiredUnits) > 0);
});

visit.purposeStatus = "declared";
visit.purposeDisclosureStatus = "declared";
visit.hostId = IDS.mother;
visit.receivedBy = IDS.mother;
visit.stage = "received";
const runtime = {
  topology: {
    zones: {
      hall: { id: "hall", label: "堂前" },
      threshold: { id: "threshold", label: "门槛" },
    },
  },
  agents: {
    [IDS.mother]: { characterId: IDS.mother, characterName: "谢母", present: true, zoneId: "hall" },
    [IDS.chen]: { characterId: IDS.chen, characterName: "陈砚", present: true, zoneId: "hall" },
  },
};
const motherAffordances = listTavernCausalAffordances(prepared.state, runtime, IDS.mother, [IDS.chen]);
const offer = motherAffordances.find((item) => item.type === "assign_work");
check("work offer is concrete, spoken, co-located, and task-bound", () => {
  assert.ok(offer);
  assert.equal(offer.requiresSpeech, true);
  assert.equal(offer.requiredZoneId, "hall");
  assert.equal(offer.taskId, visit.workExchange.agreement.taskId);
  assert.match(`${offer.label} ${offer.canonicalVisibleAction}`, /桌|柴|水|灶|碗/);
  assert.doesNotMatch(offer.canonicalVisibleAction, /没有让他自己猜|把今天要做的杂务指给/);
});

if (offer) {
  applyTavernCausalAffordance(prepared.state, runtime, {
    id: "phase59_offer_work",
    actorId: IDS.mother,
    speechAct: "offer",
    speech: "陈砚，把堂前这两张空桌收净，我验过便给你一碗热饭。",
    day: 1,
    slotLabel: "清晨",
  }, offer);
}
check("host offer does not silently count as worker acceptance", () => {
  assert.equal(visit.workStatus, "offered");
  assert.equal(visit.workExchange.agreement.status, "offered");
  assert.equal(visit.workExchange.agreement.assignedBy, IDS.mother);
  assert.equal(visit.workExchange.agreement.acceptedActionId || "", "");
});
const chenAffordances = listTavernCausalAffordances(prepared.state, runtime, IDS.chen, [IDS.mother]);
check("worker must explicitly accept or refuse before work", () => {
  assert.ok(chenAffordances.some((item) => item.type === "accept_work" && item.requiresSpeech));
  assert.ok(chenAffordances.some((item) => item.type === "refuse_work" && item.requiresSpeech));
  assert.ok(!chenAffordances.some((item) => item.type === "perform_work"), "work cannot begin before acceptance");
});

const voiceRows = Object.values(IDS).map((characterId) => {
  const character = prepared.state.characters.find((item) => item.id === characterId);
  const voiceContract = buildTavernVoiceContract(character, {});
  const result = validateTavernVoiceRealization({
    characterId,
    voiceContract,
    speech: "这一步办妥了。",
    speechAct: "inform",
  });
  return { characterId, result };
});
check("voice validation reports character diagnostics without censoring a generic line", () => {
  assert.ok(voiceRows.every((row) => Number.isFinite(row.result.identityScore)));
  assert.ok(voiceRows.every((row) => row.result.accepted === true));
  assert.ok(voiceRows.some((row) => row.result.identityPassed === false));
  assert.ok(voiceRows.some((row) => row.result.diagnosticFindings.some((violation) => violation.code === "VOICE_IDENTITY_TOO_GENERIC")));
});

if (failures.length) {
  console.error("tavernPhase59Transactions:test RED", failures);
  process.exitCode = 1;
} else {
  console.log("tavernPhase59Transactions:test passed", {
    workExchange: visit.workExchange,
    voiceScores: voiceRows.map((row) => ({ characterId: row.characterId, score: row.result.identityScore })),
  });
}
