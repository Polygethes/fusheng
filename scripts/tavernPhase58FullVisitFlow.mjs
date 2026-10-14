import assert from "node:assert/strict";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import {
  prepareTavernCausalSlot,
  TAVERN_CAUSAL_DAY_SLOTS,
} from "../src/server/pipeline/tavernCausalEconomy.mjs";
import { playTavernCausalSceneWithRunners } from "../src/server/pipeline/openaiPipeline.mjs";


// This project ships no default model. A contract that drives the real-model
// pipeline must name the model it is pretending to call.
process.env.CHARACTER_TOWN_MODEL ||= "contract-test-model";

const IDS = {
  father: "char_xyy_xieheng",
  mother: "char_xyy_xiemu",
  yan: "char_xyy_yanzhizhong",
  luo: "char_xyy_luozhao",
};

const AUTHORED_BUSINESS_ACTION = "严执中摊开掌籍名录和待核纸页，拇指按住页角，把洛照的留宿时辰与接引凭据逐项对到同一行登记。";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
state.ui.timeGrain = "scene";
state.ui.engineMode = "openai";
state.tavernState.candidateNotices = [{
  id: "candidate_notice_full_flow_luozhao",
  status: "pending",
  candidateId: IDS.luo,
  candidateName: "洛照",
  sourceVisitId: "visit_full_flow_luozhao",
  recordKind: "候选留宿与接引登记",
  reason: "洛照持玉衡宗拜帖在望梯酒馆留宿等接引",
  createdDay: 1,
  createdSlot: "黄昏",
}];
for (const character of state.characters) {
  if (character.id !== IDS.yan && character.lifeProfile?.simulationTier === "visitor" && character.lifeState?.visitIntention) {
    character.lifeState.visitIntention.status = "completed";
  }
}

const noon = TAVERN_CAUSAL_DAY_SLOTS.find((slot) => slot.id === "noon");
const prepared = prepareTavernCausalSlot(state, { day: 2, slot: noon });
const visitAtArrival = prepared.state.tavernState.activeVisits.find((visit) => visit.visitorId === IDS.yan);
assert.ok(visitAtArrival, "pending candidate notice must cause Yan Zhizhong to arrive in his available window");
assert.match(visitAtArrival.purpose, /洛照.*留宿.*接引登记/, "the visit must name the concrete record being checked");

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

const streamed = [];
const draft = await playTavernCausalSceneWithRunners(prepared.state, {
  characterAgentProtocolVersion: 1,
  characterIds: [IDS.father, IDS.mother, IDS.yan],
  positions: {
    [IDS.father]: "hall",
    [IDS.mother]: "hall",
    [IDS.yan]: "threshold",
  },
  seedImpacts: prepared.seedImpacts,
  slotContext: prepared.slotContext,
  maxSteps: 40,
  // Exercise the production threshold: unfinished material work must survive
  // the short post-action cooldown instead of being mistaken for quiescence.
  minimumActivationScore: 34,
  async onProgress(event) {
    streamed.push(structuredClone(event));
  },
  runners: {
    async runTavernCausalAgent(input) {
      const priority = [
        "declare_visit_purpose",
        "move_to_hall",
        "receive_guest",
        "perform_visit_business",
        "approach_service_vessel",
        "approach_service_station",
        "start_service_preparation",
        "finish_service_preparation",
        "approach_service_delivery",
        "serve_guest",
        "consume_service",
        "pay_cash",
        "settle_cash",
      ];
      const selected = priority.map((type) => (input.availableAffordances || []).find((item) => item.type === type)).find(Boolean)
        || null;
      const selectedCandidate = selected
        ? input.privateActionCandidates.find((candidate) => candidate.feasible && candidate.realization?.affordanceId === selected.id)
        : null;
      if (!selected || !selectedCandidate) {
        const quietCandidate = input.privateActionCandidates.find((candidate) => candidate.feasible && !candidate.realization?.affordanceId);
        return { decision: passDecision("人物此刻没有选择可提交的来访事务，保持安静。", quietCandidate?.candidateId) };
      }

      let speech = "";
      let speechAct = "none";
      if (selected.type === "declare_visit_purpose") {
        speechAct = "inform";
        speech = "谢东家，我来核洛照的留宿与接引登记。掌籍名录在这里，先对酒馆这一笔。";
      } else if (selected.type === "receive_guest") {
        speechAct = "inform";
        speech = input.agent.id === IDS.mother
          ? "严长老，洛姑娘那笔在账板上。留宿时辰和接引凭据，我拿来给您对。"
          : "严长老，洛照那笔登记在账板上。我把留宿和接引两项拿来对。";
      }
      return { decision: {
        candidateId: selectedCandidate.candidateId,
        actionType: selected.actionType,
        speechAct,
        targetCharacterId: selected.targetCharacterId || "",
        speech,
        visibleAction: selected.type === "perform_visit_business" ? AUTHORED_BUSINESS_ACTION : "",
        moveToZoneId: selected.moveToZoneId || "",
        affordanceId: selected.id,
        informationSourceImpactId: "",
        commitmentAction: "none",
        commitmentTopic: /purpose|business/.test(selected.type) ? visitAtArrival.purpose : "",
        privateReason: `眼下先完成${selected.label}，不让茶钱替代候选登记公务。`,
      } };
    },
  },
});

const visit = draft.updateBundle.tavernState.activeVisits.find((item) => item.visitorId === IDS.yan);
const notice = draft.updateBundle.tavernState.candidateNotices.find((item) => item.id === "candidate_notice_full_flow_luozhao");
const types = draft.causalScene.actions.map((action) => action.affordanceType).filter(Boolean);
if (visit?.businessStatus !== "done" || visit?.stage !== "completed") {
  console.log("phase58 full visit diagnostic", {
    stopReason: draft.causalScene.stopReason,
    elapsedSeconds: draft.causalScene.privateSceneRuntime?.elapsedSeconds,
    visit,
    types,
    actions: draft.causalScene.actions.map((action) => ({
      actor: action.actorName,
      type: action.affordanceType,
      speech: action.speech,
      visibleAction: action.visibleAction,
      moveToZoneId: action.moveToZoneId,
    })),
    novelText: draft.novelText,
  });
}

assert.equal(visit?.purposeStatus, "declared", "the visitor must state his own purpose before reception");
assert.equal(visit?.businessStatus, "done", "the candidate record must actually be checked");
assert.equal(visit?.stage, "completed", "service, business, and payment must all close before completion");
assert.equal(notice?.status, "reviewed", "the concrete notice must retain the review consequence");
assert.ok(types.includes("declare_visit_purpose"), "the flow must contain an observable purpose declaration");
assert.ok(
  types.includes("move_to_hall")
    || draft.causalScene.actions.some((action) => action.affordanceType === "declare_visit_purpose" && action.moveToZoneId === "hall"),
  "the visitor must cross from the threshold into the hall explicitly",
);
assert.ok(types.includes("receive_guest"), "the host must answer the declared purpose in person");
assert.ok(types.includes("perform_visit_business"), "the actual registry task must be committed");
assert.equal(
  draft.causalScene.actions.find((action) => action.affordanceType === "perform_visit_business")?.visibleAction,
  AUTHORED_BUSINESS_ACTION,
  "a valid Agent-authored realization must survive while the affordance remains the material consequence authority",
);
assert.ok(types.includes("serve_guest"), "tea remains a separate hospitality transaction");
assert.ok(types.includes("start_service_preparation"), "the tea must be physically started rather than appearing at the table on request");
assert.ok(types.includes("finish_service_preparation"), "elapsed time only makes the tea ready; a character must finish the preparation");
assert.ok(types.includes("approach_service_delivery"), "the prepared tea must be carried through the room before delivery");
assert.ok(types.some((type) => ["pay_cash", "settle_cash"].includes(type)), "tea money must be settled only after the business is done");

const declareIndex = types.indexOf("declare_visit_purpose");
const receiveIndex = types.indexOf("receive_guest");
const businessIndex = types.indexOf("perform_visit_business");
const settlementIndex = Math.max(types.indexOf("pay_cash"), types.indexOf("settle_cash"));
assert.ok(declareIndex >= 0 && declareIndex < receiveIndex, "the host cannot receive an undisclosed internal policy");
assert.ok(receiveIndex < businessIndex, "the registry task starts only after an actual reception");
assert.ok(businessIndex < settlementIndex, "payment cannot erase an unfinished public purpose");

assert.match(draft.novelText, /严执中推门进入望梯酒馆/, "the canonical arrival must be the visible beginning");
assert.ok(
  streamed.some((event) => event.type === "novel_delta" && /严执中推门进入望梯酒馆/.test(event.text || "")),
  "the public arrival context must stream into the live observer before character actions",
);
assert.match(draft.novelText, /我来核洛照的留宿与接引登记/, "the purpose must be visible in Yan Zhizhong's own voice");
assert.match(draft.novelText, /摊开掌籍名录和待核纸页.*逐项.*登记/, "the business task must have a concrete visible object and action");
assert.doesNotMatch(draft.novelText, /接下了这次来意|能正面回应的位置|走向后院|合不合口味|茶不错/, "the repaired flow must not regress to abstract scheduler prose, wrong zones, or generic service talk");

// A two-person lodging transaction used to stop immediately after the host's
// price quote: both people were in a short cooldown, which the loop mistook for
// true quiescence even though room, meal, and payment affordances remained.
const lodgingState = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
lodgingState.ui.timeGrain = "scene";
lodgingState.ui.engineMode = "openai";
for (const character of lodgingState.characters) character.lifeState.present = [IDS.mother, IDS.luo].includes(character.id);
lodgingState.tavernState.activeVisits = [{
  id: "phase58_lodging_continuity",
  visitorId: IDS.luo,
  visitorName: "洛照",
  situationalRole: "淋雨后来投宿的客人",
  purpose: "要一碗热饭并住一晚等接引",
  kind: "lodging",
  expectedHostIds: [IDS.mother],
  requestedService: "lodging_meal",
  paymentMode: "cash",
  completionCondition: "饭、客房钥匙和五枚铜钱都当面交割",
  purposeStatus: "undisclosed",
  businessStatus: "not_required",
  purposeZoneIds: ["hall", "counter"],
  allowedZoneIds: ["threshold", "hall", "counter"],
  carriedObjectLabel: "被雨打湿的包袱",
  arrivalCue: "抱着被雨打湿的包袱站在门槛内",
  stage: "waiting",
  hostId: "",
}];

const lodgingDraft = await playTavernCausalSceneWithRunners(lodgingState, {
  characterAgentProtocolVersion: 1,
  characterIds: [IDS.mother, IDS.luo],
  positions: { [IDS.mother]: "counter", [IDS.luo]: "threshold" },
  seedImpacts: [{
    id: "phase58_lodging_own_need",
    sourceCharacterId: "world:rain-and-hunger",
    sourceZoneId: "threshold",
    type: "need",
    modality: "memory",
    intensity: 100,
    radius: 0,
    directedTargetId: IDS.luo,
    content: "洛照的衣袖和包袱被雨打湿；他自己知道要先问热饭和歇脚。",
    topic: "洛照本人当前需求",
  }],
  maxSteps: 32,
  minimumActivationScore: 34,
  runners: {
    async runTavernCausalAgent(input) {
      const priority = [
        "approach_reception",
        "declare_visit_purpose",
        "move_to_hall",
        "approach_waiting_guest",
        "receive_guest",
        "assign_lodging",
        "approach_service_vessel",
        "approach_service_station",
        "start_service_preparation",
        "finish_service_preparation",
        "approach_service_delivery",
        "serve_guest",
        "consume_service",
        "pay_cash",
        "settle_cash",
      ];
      const selected = priority.map((type) => (input.availableAffordances || []).find((item) => item.type === type)).find(Boolean) || null;
      const selectedCandidate = selected
        ? input.privateActionCandidates.find((candidate) => candidate.feasible && candidate.realization?.affordanceId === selected.id)
        : null;
      if (!selected || !selectedCandidate) {
        const quietCandidate = input.privateActionCandidates.find((candidate) => candidate.feasible && !candidate.realization?.affordanceId);
        return { decision: passDecision("眼下没有选择可提交的住店步骤。", quietCandidate?.candidateId) };
      }
      const speech = selected.type === "declare_visit_purpose"
        ? "掌柜，要一间客房和一碗热饭。"
        : selected.type === "receive_guest"
          ? "热饭和客房，五枚铜钱。"
          : "";
      return { decision: {
        candidateId: selectedCandidate.candidateId,
        actionType: selected.actionType,
        speechAct: speech ? "inform" : "none",
        targetCharacterId: selected.targetCharacterId || "",
        speech,
        visibleAction: "",
        moveToZoneId: selected.moveToZoneId || "",
        affordanceId: selected.id,
        informationSourceImpactId: "",
        commitmentAction: "none",
        commitmentTopic: "",
        privateReason: `按实际状态完成${selected.label}。`,
      } };
    },
  },
});
const lodgingTypes = lodgingDraft.causalScene.actions.map((action) => action.affordanceType).filter(Boolean);
if (!lodgingTypes.includes("receive_guest")) {
  console.log("phase58 lodging continuity diagnostic", {
    stopReason: lodgingDraft.causalScene.stopReason,
    lodgingTypes,
    actions: lodgingDraft.causalScene.actions.map((action) => ({
      actor: action.actorName,
      type: action.affordanceType,
      visibleAction: action.visibleAction,
      speech: action.speech,
    })),
    decisions: lodgingDraft.causalScene.decisions,
  });
}
assert.ok(lodgingTypes.includes("declare_visit_purpose"), "the lodging guest must disclose the need");
assert.ok(lodgingTypes.includes("receive_guest"), "the manager must answer the disclosed lodging need");
assert.ok(
  lodgingTypes.includes("assign_lodging") && lodgingTypes.includes("serve_guest"),
  `unfinished room and meal work must outlive short cooldowns: ${JSON.stringify({ stopReason: lodgingDraft.causalScene.stopReason, lodgingTypes })}`,
);
assert.ok(
  lodgingTypes.includes("start_service_preparation")
    && lodgingTypes.includes("finish_service_preparation")
    && lodgingTypes.includes("approach_service_delivery"),
  "lodging meal delivery must retain the same durative physical service chain",
);

console.log("tavernPhase58FullVisitFlow:test passed", {
  purpose: visit.purpose,
  affordances: types,
  stage: visit.stage,
  noticeStatus: notice.status,
  lodgingAffordances: lodgingTypes,
  novelText: draft.novelText,
});
