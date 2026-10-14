import assert from "node:assert/strict";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { playModelPeriodWithRunners } from "../src/server/pipeline/openaiPipeline.mjs";
import { runTavernCausalAgent } from "../src/server/pipeline/tavernCausalScene.mjs";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
state.ui.timeGrain = "scene";
state.ui.engineMode = "openai";
const mother = "char_xyy_xiemu";
const luo = "char_xyy_luozhao";
for (const character of state.characters) character.lifeState.present = [mother, luo].includes(character.id);
state.tavernState.activeVisits = [{
  id: "visit_real_lodging_key",
  visitorId: luo,
  visitorName: "洛照",
  purpose: "住一晚等接引，并在堂前吃一顿热饭",
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

let capturedInput = null;
const startedAt = Date.now();
const draft = await playModelPeriodWithRunners(state, {
  pipelineMode: "live",
  characterAgentProtocolVersion: 1,
  characterIds: [mother, luo],
  positions: { [mother]: "hall", [luo]: "hall" },
  seedImpacts: [{
    sourceCharacterId: "world:lodging-key",
    sourceZoneId: "hall",
    type: "institution",
    modality: "sound",
    intensity: 94,
    radius: 0,
    directedTargetId: mother,
    content: "住客的热饭已经交付，但客房钥匙和房间位置还没有交代。",
    topic: "交付客房钥匙",
  }],
  maxSteps: 1,
  runners: {
    async runTavernCausalAgent(input, options) {
      capturedInput = structuredClone(input);
      return runTavernCausalAgent(input, options);
    },
  },
});

assert.ok(capturedInput.availableAffordances.some((item) => item.type === "assign_lodging"));
assert.ok(!capturedInput.availableAffordances.some((item) => item.type === "settle_cash"));
const action = draft.causalScene.actions[0];
assert.equal(action.affordanceType, "assign_lodging", `the real Agent must deliver the room/key before collecting money: ${JSON.stringify(action)}`);
const visit = draft.updateBundle.tavernState.activeVisits.find((item) => item.id === "visit_real_lodging_key");
assert.equal(visit.lodgingStatus, "assigned");
assert.equal(visit.paymentStatus, "unpaid");
assert.match(draft.novelText, /谢母.*客房钥匙/);

console.log("realTavernLodgingAffordanceSmoke:passed", {
  model: draft.model,
  elapsedMs: Date.now() - startedAt,
  action: action.affordanceType,
  speech: action.speech,
  lodgingStatus: visit.lodgingStatus,
  paymentStatus: visit.paymentStatus,
  prose: draft.novelText,
});
