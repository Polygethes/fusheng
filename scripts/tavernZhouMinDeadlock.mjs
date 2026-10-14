import assert from "node:assert/strict";

import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import {
  prepareTavernCausalSlot,
  TAVERN_CAUSAL_DAY_SLOTS,
} from "../src/server/pipeline/tavernCausalEconomy.mjs";
import { runTavernCausalScene } from "../src/server/pipeline/tavernCausalScene.mjs";

const IDS = {
  zhou: "char_xyy_zhoumin",
  son: "char_xyy_xiezenshi",
  verifier: "char_xyy_xiemu",
};
const ZHOU_CORE_DESIRE = "desire_zhoumin_become_inner_court_disciple";

function buildDeadlockState() {
  const state = buildPlayableWorldFromSetup({
    setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
    setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
  });
  const noon = TAVERN_CAUSAL_DAY_SLOTS.find((slot) => slot.id === "noon");
  const prepared = prepareTavernCausalSlot(state, { day: 1, slot: noon });
  const visit = prepared.state.tavernState.activeVisits.find((item) => item.visitorId === IDS.zhou);
  assert.ok(visit, "the real Xiaoyaoyou seed must create Zhou Min's medicine delivery visit");

  for (const character of prepared.state.characters) {
    character.lifeState.present = [IDS.zhou, IDS.son].includes(character.id);
  }
  visit.expectedHostIds = [IDS.verifier];
  visit.hostId = IDS.verifier;
  visit.receivedBy = IDS.verifier;
  visit.purposeStatus = "declared";
  visit.purposeDisclosureStatus = "declared";
  visit.declaredPurpose = visit.purpose;
  visit.stage = "received";
  visit.deliveryStatus = "pending";
  delete visit.objectiveGraph;
  delete visit.objectives;
  delete visit.objectiveSummary;
  return { state: prepared.state, visitId: visit.id, slotContext: prepared.slotContext };
}

function passDecision(reason, candidateId = "") {
  return {
    candidateId,
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
    privateReason: reason,
  };
}

function decisionRunner(inputs) {
  return async function runAgent(input) {
    inputs.push(structuredClone(input));
    const selectedCandidate = input.privateActionCandidates.find((candidate) => (
      candidate.feasible && candidate.realization?.affordanceId
    )) || null;
    const selected = (input.availableAffordances || []).find((item) => item.id === selectedCandidate?.realization?.affordanceId) || null;
    if (selected) return { decision: {
      candidateId: selectedCandidate.candidateId,
      actionType: selected.actionType,
      speechAct: selected.requiresSpeech ? "inform" : "none",
      targetCharacterId: selected.targetCharacterId || "",
      speech: selected.requiresSpeech ? "药包和清单都在这里，请当面验过。" : "",
      visibleAction: "",
      moveToZoneId: selected.moveToZoneId || "",
      affordanceId: selected.id,
      informationSourceImpactId: input.activation?.impactId || "",
      commitmentAction: "none",
      commitmentTopic: selected.label || "",
      privateReason: `按当前合法步骤完成${selected.label}。`,
    } };

    const innerCourtCandidate = input.privateActionCandidates.find((candidate) => (
      candidate.feasible
      && candidate.driveId === ZHOU_CORE_DESIRE
      && candidate.actionKind === "pursue_desired_state"
    ));
    if (input.agent.id === IDS.zhou && innerCourtCandidate) return { decision: {
      candidateId: innerCourtCandidate.candidateId,
      actionType: "speak",
      speechAct: "ask",
      targetCharacterId: IDS.son,
      speech: "真石，我想参加内门考核。你肯不肯为我写一封举荐？",
      visibleAction: "周珉按住药包，抬头看向谢真石。",
      moveToZoneId: "",
      affordanceId: "",
      informationSourceImpactId: input.activation?.impactId || "",
      commitmentAction: "open",
      commitmentTopic: "请求谢真石举荐自己参加内门考核",
      privateReason: "药包暂时无人能验，但谢真石就在面前；向他提出举荐请求能推进自己的内门道路。",
    } };

    const answerCandidate = input.privateActionCandidates.find((candidate) => candidate.feasible && candidate.targetCharacterId === IDS.zhou);
    if (input.agent.id === IDS.son && answerCandidate) return { decision: {
      candidateId: answerCandidate.candidateId,
      actionType: "speak",
      speechAct: "answer",
      targetCharacterId: IDS.zhou,
      speech: "我答应，今天把举荐写清。",
      visibleAction: "谢真石停下手里的事，正面看向周珉。",
      moveToZoneId: "",
      affordanceId: "",
      informationSourceImpactId: input.activation?.impactId || "",
      commitmentAction: "fulfill",
      commitmentTopic: "举荐答复",
      decisionValue: "accept",
      privateReason: "周珉当面问了，必须先给明确回应。",
    } };

    const quietCandidate = input.privateActionCandidates.find((candidate) => candidate.feasible && !candidate.realization?.affordanceId)
      || input.privateActionCandidates.find((candidate) => candidate.feasible);
    return { decision: passDecision("当前没有选择可合法提交的动作。", quietCandidate?.candidateId) };
  };
}

function applyCharacterPatches(state, patches = []) {
  for (const patch of patches) {
    const character = state.characters.find((item) => item.id === patch.id);
    if (!character) continue;
    character.currentLocationId = patch.currentLocationId;
    character.currentActivity = structuredClone(patch.currentActivity);
    character.lifeState = structuredClone(patch.lifeState);
    character.ecologyState = structuredClone(patch.ecologyState);
  }
}

const fixture = buildDeadlockState();
const blockedInputs = [];
const blocked = await runTavernCausalScene(fixture.state, {
  characterIds: [IDS.zhou, IDS.son],
  positions: { [IDS.zhou]: "hall", [IDS.son]: "hall" },
  slotContext: fixture.slotContext,
  maxSteps: 4,
  minimumActivationScore: 20,
  runAgent: decisionRunner(blockedInputs),
});

const zhouAskIndex = blocked.actions.findIndex((action) => (
  action.actorId === IDS.zhou
  && action.targetCharacterId === IDS.son
  && action.speechAct === "ask"
  && action.ecologyCandidateId.startsWith("desire:")
));
if (zhouAskIndex < 0) {
  console.error(JSON.stringify(blockedInputs.filter((input) => input.agent.id === IDS.zhou).map((input) => ({
    activation: input.activation,
    candidates: input.privateActionCandidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      driveId: candidate.driveId,
      actionKind: candidate.actionKind,
      targetCharacterId: candidate.targetCharacterId,
      feasible: candidate.feasible,
      mode: candidate.realization?.mode,
      affordanceId: candidate.realization?.affordanceId,
    })),
  })), null, 2));
}
assert.ok(zhouAskIndex >= 0 && zhouAskIndex < 4, "Zhou Min's Agent must be able to realize his core inner-court desire as a concrete request while delivery is blocked");
assert.ok(
  blockedInputs.some((input) => input.agent.id === IDS.zhou
    && input.privateActionCandidates.some((candidate) => candidate.driveId === ZHOU_CORE_DESIRE)),
  "the validated self-owned desire must coexist with the visit duty and reach the Agent's private candidates",
);
assert.equal(
  blocked.tavernState.activeVisits.find((visit) => visit.id === fixture.visitId)?.deliveryStatus,
  "pending",
  "desire pursuit must not bypass the absent verifier or accept the medicine delivery",
);

const unlockedState = structuredClone(fixture.state);
unlockedState.tavernState = structuredClone(blocked.tavernState);
applyCharacterPatches(unlockedState, blocked.characterPatches);
for (const character of unlockedState.characters) {
  character.lifeState.present = [IDS.zhou, IDS.verifier].includes(character.id);
}
const unlockedInputs = [];
const unlocked = await runTavernCausalScene(unlockedState, {
  characterIds: [IDS.zhou, IDS.verifier],
  positions: { [IDS.zhou]: "hall", [IDS.verifier]: "hall" },
  slotContext: fixture.slotContext,
  maxSteps: 4,
  minimumActivationScore: 20,
  runAgent: decisionRunner(unlockedInputs),
});
const unlockedVisit = unlocked.tavernState.activeVisits.find((visit) => visit.id === fixture.visitId);
assert.equal(unlockedVisit?.deliveryStatus, "accepted", "the medicine handoff must complete normally after the verifier arrives");
assert.ok(unlocked.actions.some((action) => action.affordanceType === "accept_delivery" && action.actorId === IDS.verifier));

console.log("tavernZhouMinDeadlock:test passed", {
  desireStep: zhouAskIndex + 1,
  blockedDelivery: "pending",
  unlockedDelivery: unlockedVisit.deliveryStatus,
});
