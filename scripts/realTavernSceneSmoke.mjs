import assert from "node:assert/strict";
import { playWithOpenAIPipeline } from "../src/server/pipeline/openaiPipeline.mjs";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
state.ui.timeGrain = "scene";
state.tavernState.eventThreads = [{
  id: "real_smoke_opening_thread",
  topic: "今晚的米是否够用",
  stake: "若再来两桌客人，晚饭可能断供",
  participantIds: ["char_xyy_xiemu", "char_xyy_xieheng"],
  status: "open",
  openedDay: 0,
  openedSlot: "night",
  lastAdvancedDay: 0,
  lastAdvancedSlot: "night",
  nextObligationCharacterId: "char_xyy_xieheng",
  turns: [{
    turnId: "real_smoke_opening_turn",
    speakerId: "char_xyy_xiemu",
    addresseeId: "char_xyy_xieheng",
    line: "灶上的米，只照现在的碗数够；今晚若再来两桌，怎么办？",
    day: 0,
    slotId: "night",
    action: "open",
  }],
}];
const startedAt = Date.now();
const draft = await playWithOpenAIPipeline(state, { pipelineMode: "live" });
const witnessStages = (draft.pipelineMeta?.stages || []).filter((stage) => String(stage.name || "").startsWith("BackgroundSlot:"));
const decisionStages = (draft.pipelineMeta?.stages || []).filter((stage) => String(stage.name || "").startsWith("TavernAgentDecision:"));
const dialogueTurns = draft.periodSimulation.ticks.flatMap((tick) => tick.canonicalDialogueTurns || []);

assert.equal(draft.periodSimulation?.ticks?.length, 1);
assert.ok(witnessStages.some((stage) => stage.provider === "openai"), "real smoke must reach the configured activity witness model");
assert.ok(decisionStages.length >= 2, "real smoke must make isolated per-Agent decision calls");
assert.ok(decisionStages.every((stage) => stage.provider === "openai"), "real Agent decisions must reach the configured remote model");
assert.ok(dialogueTurns.length >= 1, "the Agent who owes the next public move must answer, refuse, question, or delay aloud");
assert.ok(dialogueTurns.every((turn) => draft.novelText.includes(turn.line)), "the witness must preserve every canonical Agent line verbatim");
assert.ok(draft.periodSimulation.ticks[0].agentOutputs?.length, "model prose must retain canonical character activities");
assert.match(draft.pipelineMeta.pipeline, /TavernLifeKernel.*ActivityWitness/);

console.log("realTavernScene:smoke passed", {
  model: draft.model,
  elapsedMs: Date.now() - startedAt,
  witnessStages: witnessStages.map((stage) => stage.name),
  decisionStages: decisionStages.map((stage) => stage.name),
  dialogue: dialogueTurns.map((turn) => `${turn.speakerName}：${turn.line}`),
  proseLength: draft.novelText.length,
});
