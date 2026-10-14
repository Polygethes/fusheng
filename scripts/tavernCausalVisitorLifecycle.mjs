import assert from "node:assert/strict";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import {
  prepareTavernCausalSlot,
  TAVERN_CAUSAL_DAY_SLOTS,
} from "../src/server/pipeline/tavernCausalEconomy.mjs";
import { runTavernCausalScene } from "../src/server/pipeline/tavernCausalScene.mjs";

const LUO_ID = "char_xyy_luozhao";
const XIE_ID = "char_xyy_xiezenshi";
const LUO_DESIRE_ID = "desire_luozhao_test_own_limit_against_xiezenshi";

function world() {
  return buildPlayableWorldFromSetup({
    setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
    setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
  });
}

function slot(id) {
  return TAVERN_CAUSAL_DAY_SLOTS.find((row) => row.id === id);
}

const scheduleIndependent = world();
const scheduledLuo = scheduleIndependent.characters.find((character) => character.id === LUO_ID);
scheduledLuo.lifeProfile.schedule = [];
const dawn = prepareTavernCausalSlot(scheduleIndependent, { day: 1, slot: slot("dawn") });
const noon = prepareTavernCausalSlot(dawn.state, { day: 1, slot: slot("noon") });
assert.ok(dawn.arrivals.includes(LUO_ID), "an owned zero-slot arrival intention must place Luo Zhao at the threshold without using a schedule");
assert.ok(!noon.arrivals.includes(LUO_ID), "the same owned arrival must not replay at every period");
const dawnVisit = dawn.state.tavernState.activeVisits.find((visit) => visit.visitorId === LUO_ID);
assert.match(dawnVisit.arrivalCause.motive, /拜帖|打探消息/u);
assert.equal(dawnVisit.arrivalCause.travelCostSlots, 0);
assert.equal(dawnVisit.kind, "self_directed");
assert.equal(dawnVisit.purposeDisclosureRequired, false);
assert.equal(dawnVisit.hostReceptionRequired, false);
assert.equal(dawnVisit.requestedService, "none");
assert.equal(dawnVisit.paymentStatus, "not_required");

const shiftedCause = world();
const shiftedLuo = shiftedCause.characters.find((character) => character.id === LUO_ID);
shiftedLuo.lifeProfile.schedule = ["午后"];
shiftedLuo.lifeState.visitIntention.committedAtSlotIndex = 1;
shiftedLuo.lifeState.visitIntention.travelCostSlots = 2;
const shiftedAfternoon = prepareTavernCausalSlot(shiftedCause, { day: 1, slot: slot("afternoon") });
const shiftedDusk = prepareTavernCausalSlot(shiftedAfternoon.state, { day: 1, slot: slot("dusk") });
assert.ok(!shiftedAfternoon.arrivals.includes(LUO_ID), "a listed schedule slot must not teleport a not-yet-arrived person");
assert.ok(shiftedDusk.arrivals.includes(LUO_ID), "moving the owned commitment later must move arrival later without editing the schedule");

const legacyCause = world();
const legacyLuo = legacyCause.characters.find((character) => character.id === LUO_ID);
delete legacyLuo.lifeState.visitIntention;
legacyLuo.lifeProfile.tavernAgency.visitPolicy.travelCostSlots = 2;
const legacyAfternoon = prepareTavernCausalSlot(legacyCause, { day: 3, slot: slot("afternoon") });
const legacyDusk = prepareTavernCausalSlot(legacyAfternoon.state, { day: 3, slot: slot("dusk") });
const legacyNight = prepareTavernCausalSlot(legacyDusk.state, { day: 3, slot: slot("night") });
assert.ok(!legacyAfternoon.arrivals.includes(LUO_ID) && !legacyDusk.arrivals.includes(LUO_ID));
assert.ok(legacyNight.arrivals.includes(LUO_ID), "a migrated visitor must begin travel at migration time instead of teleporting from an invented slot-zero commitment");

function activeLuoWorld() {
  const prepared = prepareTavernCausalSlot(world(), { day: 1, slot: slot("dawn") });
  const state = prepared.state;
  state.tavernState.activeVisits = state.tavernState.activeVisits.filter((visit) => visit.visitorId === LUO_ID);
  const visit = state.tavernState.activeVisits[0];
  assert.ok(visit);
  assert.equal(visit.stage, "self_directed");
  assert.equal(visit.serviceTransactionStatus, "not_required");
  assert.equal(visit.paymentStatus, "not_required");
  assert.equal(visit.lodgingStatus, "not_required");
  for (const character of state.characters || []) {
    character.lifeState.present = [LUO_ID, XIE_ID].includes(character.id);
    if (character.lifeState.present) character.currentLocationId = "loc_xyy_tavern";
  }
  return state;
}

function decisionFor(candidate, { leave = false } = {}) {
  return {
    candidateId: candidate.candidateId,
    actionType: leave ? "leave" : "act",
    speechAct: "none",
    targetCharacterId: candidate.targetCharacterId || "",
    speech: "",
    visibleAction: leave ? "" : "洛照拇指压着剑格，安静看完眼前人的收剑余势",
    moveToZoneId: "",
    vocalMode: "conversational",
    affordanceId: candidate.realization?.affordanceId || "",
    informationSourceImpactId: "",
    commitmentAction: "none",
    commitmentTopic: "",
    decisionValue: "none",
    privateReason: leave
      ? "眼下没有必要继续停留，我自己决定先走；尚未验证的事没有因此完成。"
      : "到店没有预先替我规定交易，我仍按自己的目标观察。",
  };
}

let stayedCandidate = null;
const stayed = await runTavernCausalScene(activeLuoWorld(), {
  characterIds: [LUO_ID, XIE_ID],
  positions: { [LUO_ID]: "hall", [XIE_ID]: "hall" },
  maxSteps: 1,
  minimumActivationScore: 0,
  seedImpacts: [{
    sourceCharacterId: "world:visible-sword-cue",
    sourceZoneId: "hall",
    type: "physical",
    modality: "visual",
    intensity: 96,
    radius: 0,
    directedTargetId: LUO_ID,
    content: "堂前有人收剑，动作没有朝任何食客逼近。",
    topic: "可观察的剑势",
  }],
  async runAgent(input) {
    stayedCandidate = (input.privateActionCandidates || []).find((candidate) => (
      candidate.feasible
      && candidate.driveId.startsWith("desire_luozhao_test_own_limit_against_")
      && candidate.actionKind !== "affordance_leave_visit"
    ));
    assert.ok(stayedCandidate, "an unresolved personal desire must still generate a feasible action during a self-directed visit");
    return { decision: decisionFor(stayedCandidate) };
  },
});

assert.doesNotMatch(stayedCandidate.candidateId, /xiezenshi/i, "the Character Agent must not receive an unknown person's canonical slug inside a candidate id");
assert.equal(stayed.decisions[0]?.candidateId, `desire:${LUO_DESIRE_ID}:pursue`, "the server must resolve the opaque candidate handle back to the canonical private drive after selection");
assert.ok(stayed.actions.some((action) => action.actorId === LUO_ID && action.actionType !== "leave"));
assert.ok(stayed.tavernState.activeVisits.some((visit) => visit.visitorId === LUO_ID));
const stayedVisit = stayed.tavernState.activeVisits.find((visit) => visit.visitorId === LUO_ID);
assert.equal(stayedVisit.serviceTransactionStatus, "not_required");
assert.ok(Number(stayed.characterPatches.find((patch) => patch.id === LUO_ID)?.ecologyState?.desires?.[LUO_DESIRE_ID]?.satisfaction || 0) < 1);
assert.ok(!stayed.decisions[0]?.decision?.semanticViolations?.some((row) => row.code === "VISIT_PURPOSE_REQUIRED_BEFORE_ENTRY"));

let leaveCandidate = null;
const left = await runTavernCausalScene(activeLuoWorld(), {
  characterIds: [LUO_ID, XIE_ID],
  positions: { [LUO_ID]: "hall", [XIE_ID]: "hall" },
  maxSteps: 1,
  minimumActivationScore: 0,
  seedImpacts: [{
    sourceCharacterId: "world:daylight-shift",
    sourceZoneId: "hall",
    type: "institution",
    modality: "visual",
    intensity: 96,
    radius: 0,
    directedTargetId: LUO_ID,
    content: "门外天色渐暗，来客仍可自行决定继续停留或离开。",
    topic: "天色渐暗",
  }],
  async runAgent(input) {
    leaveCandidate = (input.privateActionCandidates || []).find((candidate) => (
      candidate.feasible
      && candidate.realization?.affordanceId
      && candidate.actionKind === "affordance_leave_visit"
    ));
    assert.ok(leaveCandidate, "a self-directed visitor must be able to leave without the world commanding departure");
    return { decision: decisionFor(leaveCandidate, { leave: true }) };
  },
});

assert.ok(left.actions.some((action) => action.actorId === LUO_ID && action.affordanceType === "leave_visit"));
assert.ok(!left.tavernState.activeVisits.some((visit) => visit.visitorId === LUO_ID));
const archivedVisit = left.tavernState.visits.find((visit) => visit.visitorId === LUO_ID && visit.departedByOwnAction);
assert.equal(archivedVisit.departureChoice, "character-agent");
assert.ok(archivedVisit.unresolvedPersonalOpenLoopsAtDeparture.some((loop) => loop.sourceId === LUO_DESIRE_ID && loop.status === "open"));
const luoPatch = left.characterPatches.find((patch) => patch.id === LUO_ID);
assert.equal(luoPatch.lifeState.present, false);
assert.equal(luoPatch.lifeState.visitIntention.status, "return_open");
assert.ok(luoPatch.lifeState.returnIntentions.some((intention) => intention.status === "open_uncommitted"));
const duelState = luoPatch.ecologyState.desires[LUO_DESIRE_ID];
assert.ok(Number(duelState.satisfaction || 0) < 1, "leaving must not count the unresolved test desire as satisfied");

console.log("tavernCausalVisitorLifecycle:test passed", {
  arrivalWithoutSchedule: dawnVisit.arrivedSlot,
  shiftedArrival: shiftedDusk.state.tavernState.activeVisits.find((visit) => visit.visitorId === LUO_ID)?.arrivedSlot,
  stayedWithoutForcedTransaction: true,
  leftByOwnChoiceWithReturnIntention: true,
});
