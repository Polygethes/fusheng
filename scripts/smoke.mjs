import { initialState } from "../src/data/seed.js";
import { playFromServer, modelStatus } from "../src/server/modelRouter.mjs";

const state = structuredClone(initialState);
state.ui.engineMode = "mock";
const status = modelStatus("mock");
if (!String(status.pipeline || "").includes("DepthAuditor")) {
  throw new Error("Smoke test failed: modelStatus missing pipeline label");
}
const draft = await playFromServer(state, { mode: "mock" });
if (!draft || !draft.sceneText || !draft.updateBundle || !draft.agentOutputs?.length) {
  throw new Error("Smoke test failed: draft/updateBundle/agentOutputs missing");
}
const meta = draft.pipelineMeta || draft.engineMeta;
if (!meta?.stages?.length && !meta?.pipeline) {
  throw new Error("Smoke test failed: pipeline metadata missing");
}
console.log("smoke ok", draft.id, draft.provider || draft.engine?.provider || "mock", meta.pipeline || meta.mode);
