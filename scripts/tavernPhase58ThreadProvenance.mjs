import assert from "node:assert/strict";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { runTavernCausalScene } from "../src/server/pipeline/tavernCausalScene.mjs";
import { playTavernCausalSceneWithRunners } from "../src/server/pipeline/openaiPipeline.mjs";


// This project ships no default model. A contract that drives the real-model
// pipeline must name the model it is pretending to call.
process.env.CHARACTER_TOWN_MODEL ||= "contract-test-model";

const IDS = {
  son: "char_xyy_xiezenshi",
  father: "char_xyy_xieheng",
  zhou: "char_xyy_zhoumin",
};

const THREAD_ID = "thread_phase58_recommendation";
const SOURCE_TURN_ID = "turn_phase58_zhou_request";
const SOURCE_LINE = "真石，举荐的事请你亲口给我一个答复。";
const UNSOURCED_REPLY = "知道了。举荐的事你自己拿主意，不必先问我。";

function buildWorld() {
  const state = buildPlayableWorldFromSetup({
    setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
    setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
  });
  state.ui.timeGrain = "scene";
  state.ui.engineMode = "openai";
  state.ui.setupCompleted = true;
  state.tavernState.activeVisits = [];
  return state;
}

function makePresent(state, characterIds) {
  for (const characterId of characterIds) {
    const character = state.characters.find((entry) => entry.id === characterId);
    character.lifeState.present = true;
    character.currentLocationId = "loc_xyy_tavern";
    character.ecologyState.presence.locationId = "loc_xyy_tavern";
    character.ecologyState.presence.observableAtStage = true;
  }
}

function passDecision(reason = "这次没有可公开提交的行动。", candidateId = "") {
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

function answerOldThreadDecision(candidateId) {
  return {
    candidateId,
    actionType: "speak",
    speechAct: "answer",
    targetCharacterId: IDS.zhou,
    speech: "周珉，举荐的事我听清了，我会亲口给你答复。",
    visibleAction: "谢真石停下手里的事，转身看向周珉",
    moveToZoneId: "",
    affordanceId: "",
    informationSourceImpactId: "",
    commitmentAction: "none",
    commitmentTopic: "举荐答复",
    privateReason: "此前的举荐请求仍未得到答复。",
  };
}

const failures = [];

function expectContract(condition, label, evidence = {}) {
  if (!condition) failures.push({ label, evidence });
}

const threadedState = buildWorld();
makePresent(threadedState, [IDS.son, IDS.zhou]);
threadedState.tavernState.eventThreads = [{
  id: THREAD_ID,
  topic: "举荐答复",
  stake: "周珉要听到谢真石本人的明确决定",
  participantIds: [IDS.zhou, IDS.son],
  status: "open",
  nextObligationCharacterId: IDS.son,
  openedDay: 1,
  openedSlot: "day-1-night",
  turns: [{
    turnId: SOURCE_TURN_ID,
    speakerId: IDS.zhou,
    addresseeId: IDS.son,
    line: SOURCE_LINE,
    action: "ask",
    day: 1,
    slotId: "day-1-night",
    slotLabel: "夜深",
  }],
}];

const threadedDraft = await playTavernCausalSceneWithRunners(threadedState, {
  characterAgentProtocolVersion: 1,
  allowOrphanVisitors: true,
  characterIds: [IDS.son, IDS.zhou],
  positions: { [IDS.son]: "hall", [IDS.zhou]: "hall" },
  slotContext: { day: 2, slotId: "day-2-dawn", slotLabel: "清晨", slotBaseId: "dawn" },
  maxSteps: 1,
  minimumActivationScore: 0,
  runners: {
    async runTavernCausalAgent(input) {
      const candidate = input.privateActionCandidates.find((item) => (
        item.feasible && item.targetCharacterId === IDS.zhou
      )) || null;
      if (input.agent.id === IDS.son) {
        assert.ok(candidate, "the old open thread must reach the son as a selectable private response candidate");
        return { decision: answerOldThreadDecision(candidate.candidateId) };
      }
      return { decision: passDecision("这次没有可公开提交的行动。", input.privateActionCandidates.find((item) => item.feasible)?.candidateId) };
    },
  },
});

const threadedAction = threadedDraft.causalScene.actions.find((action) => action.actorId === IDS.son);
const threadImpact = threadedDraft.causalScene.impacts.find((impact) => (
  impact.provenance?.sourceThreadId === THREAD_ID
));
const publicThreadTurn = (threadedDraft.sceneInteraction?.agentExchanges || [])
  .flatMap((exchange) => exchange.dialogueTurns || [])
  .find((turn) => turn.turnId === threadedAction?.id);

expectContract(
  Boolean(threadImpact) && threadImpact.modality !== "sound",
  "跨时段旧话轮只能作为定向记忆义务，不能伪装成此刻从旧说话者位置发出的 sound",
  {
    impactId: threadImpact?.id || "",
    modality: threadImpact?.modality || "missing",
    provenance: threadImpact?.provenance || null,
  },
);

const preservesThreadSource = Boolean(
  publicThreadTurn?.sourceThreadId === THREAD_ID
  && publicThreadTurn?.responseToTurnId === SOURCE_TURN_ID,
);
const explicitActiveContinuation = Boolean(
  publicThreadTurn?.continuationKind === "active-thread-continuation"
  && publicThreadTurn?.sourceThreadId === THREAD_ID,
);
expectContract(
  preservesThreadSource || explicitActiveContinuation,
  "跨时段公开 dialogue turn 必须保留 sourceThreadId/responseToTurnId，或明确标为主动续谈",
  {
    sourceThreadId: publicThreadTurn?.sourceThreadId || "",
    responseToTurnId: publicThreadTurn?.responseToTurnId || "",
    continuationKind: publicThreadTurn?.continuationKind || "",
    legacyRespondsTo: publicThreadTurn?.respondsTo || "",
    legacyResponseThreadId: publicThreadTurn?.responseThreadId || "",
  },
);

const unsourcedState = buildWorld();
makePresent(unsourcedState, [IDS.father, IDS.son]);
unsourcedState.tavernState.eventThreads = [];

const unsourcedInputs = [];
const unsourcedResult = await runTavernCausalScene(unsourcedState, {
  allowOrphanVisitors: true,
  characterIds: [IDS.father, IDS.son],
  positions: { [IDS.father]: "hall", [IDS.son]: "counter" },
  seedImpacts: [{
    id: "impact_phase58_threadless_dawn",
    sourceCharacterId: "world:phase58-dawn",
    sourceZoneId: "hall",
    type: "institution",
    modality: "sound",
    intensity: 100,
    radius: 0,
    directedTargetId: IDS.father,
    content: "天光照进堂前，到了开门的时辰。",
    topic: "清晨酒馆职责",
  }],
  slotContext: { day: 2, slotId: "day-2-dawn", slotLabel: "清晨", slotBaseId: "dawn" },
  maxSteps: 1,
  minimumActivationScore: 0,
  async runAgent(input) {
    unsourcedInputs.push(structuredClone(input));
    if (input.agent.id !== IDS.father) return { decision: passDecision("这次没有可公开提交的行动。", input.privateActionCandidates.find((item) => item.feasible)?.candidateId) };
    const candidate = input.privateActionCandidates.find((item) => (
      item.feasible && item.actionKind === "handle_environment_event"
    ));
    assert.ok(candidate, "the father must be able to select the dawn event before attempting an unsourced utterance");
    return { decision: {
      candidateId: candidate.candidateId,
      actionType: "speak",
      speechAct: "inform",
      targetCharacterId: IDS.son,
      speech: UNSOURCED_REPLY,
      visibleAction: "谢恒靠在墙边，微微点头",
      moveToZoneId: "",
      affordanceId: "",
      informationSourceImpactId: "",
      commitmentAction: "none",
      commitmentTopic: "举荐答复",
      privateReason: "试图用主动陈述标签包装一个没有原话来源的回答。",
    } };
  },
});

const unsourcedCommitted = unsourcedResult.actions.find((action) => action.speech === UNSOURCED_REPLY);
const unsourcedActivation = unsourcedInputs.find((input) => input.agent.id === IDS.father);
const hasCurrentDialogueSource = Boolean(
  unsourcedActivation?.activation?.sourceActionId
  || unsourcedActivation?.activation?.sourceThreadId
  || unsourcedActivation?.openConversationThreads?.length,
);

expectContract(
  Boolean(unsourcedCommitted) && !hasCurrentDialogueSource,
  "没有当前 action/thread 原话来源时，人物仍可说出承接式话语，但世界不能伪造上一句话来源",
  {
    selectedAgentId: unsourcedInputs[0]?.agent?.id || "",
    activation: unsourcedActivation?.activation || null,
    openConversationThreadCount: unsourcedActivation?.openConversationThreads?.length || 0,
    committedAction: unsourcedCommitted || null,
  },
);
expectContract(
  (unsourcedResult.decisions[0]?.decision?.claimAnnotations || []).some((row) => (
    ["MISSING_OPEN_CONVERSATION_SOURCE", "MISSING_DIALOGUE_CONTINUATION_SOURCE"].includes(row.code)
  )),
  "无来源的承接式话语应留下主张标注，而不是被删除或冒充真实回答",
  unsourcedResult.decisions[0]?.decision?.claimAnnotations || [],
);

assert.equal(
  failures.length,
  0,
  `Phase 58 thread provenance contracts failed:\n${failures.map((failure, index) => `${index + 1}. ${failure.label}\n${JSON.stringify(failure.evidence, null, 2)}`).join("\n")}`,
);

console.log("tavernPhase58ThreadProvenance:test passed", {
  threadImpactModality: threadImpact?.modality || "",
  sourceThreadId: publicThreadTurn?.sourceThreadId || "",
  responseToTurnId: publicThreadTurn?.responseToTurnId || "",
  unsourcedReplyCommitted: Boolean(unsourcedCommitted),
});
