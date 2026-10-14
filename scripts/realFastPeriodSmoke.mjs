import assert from "node:assert/strict";
import "../src/server/env.mjs";
import { initialState } from "../src/data/seed.js";
import { playFromServer } from "../src/server/modelRouter.mjs";

const state = structuredClone(initialState);
state.ui.engineMode = "openai";
state.ui.timeGrain = "day";
state.ui.focusMode = "ambient";
state.ui.activeCharacterIds = state.characters.slice(0, 3).map((character) => character.id);
state.ui.selectedLocationId = state.locations[0].id;

const startedAt = Date.now();
let firstNovelDeltaAt = 0;
const draft = await playFromServer(state, {
  mode: "openai",
  allowFallback: false,
  onProgress: async (event) => {
    if (event.type === "novel_delta" && !firstNovelDeltaAt) firstNovelDeltaAt = Date.now();
  },
});
const elapsedMs = Date.now() - startedAt;
const ticks = draft.periodSimulation?.ticks || [];

assert.equal(draft.pipelineMeta?.pipelineMode, "balanced");
assert.equal(ticks.length, 5);
assert.equal(ticks.filter((tick) => tick.executionMode === "remote_focus").length, 1);
assert.equal(ticks.filter((tick) => tick.executionMode === "local_background").length, 4);
assert.ok(firstNovelDeltaAt > 0);
assert.ok(draft.novelText?.trim());
const backgroundTexts = ticks.filter((tick) => tick.executionMode === "local_background").map((tick) => tick.novelText || "");
assert.ok(backgroundTexts.every((text) => !/围着\S+停住/.test(text)), backgroundTexts.join("\n"));
const focusedDialogue = ticks.flatMap((tick) => tick.sceneInteraction?.agentExchanges || []).flatMap((exchange) => exchange.dialogueTurns || []);
assert.ok(!focusedDialogue.some((turn) => /(?:\d+|几|多)轮|上一轮|本轮|未结清|把话推回去/.test(turn.line || "")));
const dialogueKeys = focusedDialogue.map((turn) => `${turn.speakerId}|${String(turn.line || "").replace(/[“”"「」『』，,。！？!?；;：:\s]/g, "")}`);
assert.equal(new Set(dialogueKeys).size, dialogueKeys.length, "focused dialogue should not repeat semantic lines");

console.log("realFastPeriodSmoke:test passed", {
  elapsedMs,
  firstNovelDeltaMs: firstNovelDeltaAt - startedAt,
  modes: ticks.map((tick) => tick.executionMode),
  remoteStages: (draft.pipelineMeta?.stages || []).filter((stage) => stage.provider !== "local").map((stage) => stage.name),
});
