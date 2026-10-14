import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { playFromServer, modelStatus } from "../src/server/modelRouter.mjs";

const status = modelStatus("openai");
assert.equal(status.version, "1.2.0");
assert.equal(status.provider, process.env.OPENAI_API_KEY ? "openai-pipeline" : "mock");

if (!process.env.OPENAI_API_KEY) {
  console.log("realModelPipeline:test skipped: OPENAI_API_KEY is not set.");
  process.exit(0);
}

const state = structuredClone(initialState);
state.ui.engineMode = "openai";
state.ui.timeGrain = "beat";
state.ui.userDirective = "真实模型测试：让人物在不被剧情安排的情况下，通过私人意图和可见性错位发生一拍互动。";
state.ui.injectedEvent = "一条被删改过的批注记录突然出现在场所里。";
state.ui.eventImpact = 66;
state.ui.activeCharacterIds = ["char_shen", "char_lin"];

const draft = await playFromServer(state, { mode: "openai", allowFallback: false });
assert.equal(draft.provider, "openai-realtime-simulation");
assert.ok(draft.simulationTick, "draft should include simulationTick");
assert.ok(Array.isArray(draft.privateSimulations) && draft.privateSimulations.length >= 2, "private simulations should include active characters");
assert.ok(draft.visibilityLayer?.perCharacter?.length >= 2, "visibility layer should include per-character visibility");
assert.ok(draft.sceneInteraction?.interactionBeats?.length >= 1, "scene interaction should include beats");
assert.ok(draft.engineMeta?.stages?.some((stage) => stage.name === "VisibilityLayer"), "pipeline should call VisibilityLayer");
assert.ok(draft.engineMeta?.stages?.some((stage) => stage.name === "SceneInteractionSimulator"), "pipeline should call SceneInteractionSimulator");
console.log("realModelPipeline:test passed", {
  draftId: draft.id,
  provider: draft.provider,
  stages: draft.engineMeta.stages.map((stage) => stage.name),
});
