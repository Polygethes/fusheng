import { initialState } from "../src/data/seed.js";
import { playFromServer } from "../src/server/modelRouter.mjs";

const state = structuredClone(initialState);
state.ui.engineMode = "mock";
state.ui.activeCharacterIds = ["char_shen", "char_lin"];
const draft = await playFromServer(state, { mode: "mock" });
if (!draft.simulationTick || !draft.privateSimulations || !draft.sceneInteraction) {
  throw new Error("realtime simulation smoke failed: draft missing simulation structures");
}
if (!draft.audit || typeof draft.audit.realtimeSimulationRisk !== "number") {
  throw new Error("realtime simulation smoke failed: draft audit missing simulation metrics");
}
console.log("realtimeSimulation:smoke passed", draft.id, draft.simulationTick.id, draft.audit.realtimeSimulationScore);
