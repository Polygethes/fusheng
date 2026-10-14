import assert from "node:assert/strict";
import "../src/server/env.mjs";
import { initialState } from "../src/data/seed.js";
import { playFromServer, modelStatus } from "../src/server/modelRouter.mjs";

if (!process.env.OPENAI_API_KEY && !process.env.DEEPSEEK_API_KEY) {
  console.log("real model smoke skipped: OPENAI_API_KEY/DEEPSEEK_API_KEY is not set.");
  process.exit(0);
}

const status = modelStatus("openai");
assert.equal(status.provider, "openai-pipeline");
assert.ok(status.pipeline.includes("CharacterPrivateSimulator"));

const smokeState = structuredClone(initialState);
smokeState.ui.engineMode = "openai";
smokeState.ui.timeGrain = "scene";
smokeState.ui.focusMode = "location";
smokeState.ui.activeCharacterIds = smokeState.characters.slice(0, 2).map((character) => character.id);
const progressEvents = [];
const draft = await playFromServer(smokeState, {
  mode: "openai",
  allowFallback: false,
  onProgress: async (event) => progressEvents.push(event),
});
assert.equal(draft.provider, "openai-realtime-simulation");
assert.ok(draft.simulationTick, "missing simulationTick");
assert.ok(Array.isArray(draft.privateSimulations) && draft.privateSimulations.length >= 1, "missing privateSimulations");
assert.ok(draft.visibilityLayer?.perCharacter?.length >= 1, "missing visibilityLayer perCharacter rows");
assert.ok(draft.sceneInteraction, "missing sceneInteraction");
assert.ok(draft.engineMeta?.stages?.some((stage) => String(stage.name).includes("CharacterPrivateSimulator")), "missing CharacterPrivateSimulator stage");
assert.ok(draft.engineMeta?.stages?.some((stage) => String(stage.name).includes("VisibilityLayer")), "missing VisibilityLayer stage");
assert.ok(draft.engineMeta?.stages?.some((stage) => String(stage.name).includes("SceneInteractionSimulator")), "missing SceneInteractionSimulator stage");
assert.ok(draft.engineMeta?.stages?.some((stage) => String(stage.name).includes("DialoguePsychology")), "missing dialogue-aware psychology stage");
assert.ok(draft.engineMeta?.stages?.some((stage) => String(stage.name).includes("NovelStreamer")), "missing native novel stream stage");
assert.ok(String(draft.novelText || "").length > 40, "missing canonical streamed novel prose");
assert.equal(progressEvents.filter((event) => event.type === "psychology_update").length, smokeState.ui.activeCharacterIds.length, "each active character should publish one private dialogue reaction");
assert.ok(progressEvents.filter((event) => event.type === "novel_delta").length >= 2, "real model prose should arrive in multiple deltas");
assert.equal(progressEvents.filter((event) => event.type === "novel_delta").map((event) => event.text).join(""), draft.novelText, "streamed deltas should exactly equal the final canonical manuscript");
assert.ok(!progressEvents.some((event) => ["action", "dialogue", "exchange_outcome"].includes(event.type)), "legacy public rows must stay suppressed");
console.log("real model smoke passed", {
  draftId: draft.id,
  model: draft.model,
  stages: draft.engineMeta.stages.map((stage) => stage.name),
  repaired: draft.engineMeta.repaired,
  novelDeltas: progressEvents.filter((event) => event.type === "novel_delta").length,
  psychologyUpdates: progressEvents.filter((event) => event.type === "psychology_update").length,
});
