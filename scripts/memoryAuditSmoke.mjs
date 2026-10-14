import assert from "node:assert/strict";
import { resetState, getState, addCharacterMemory, saveDraft } from "../src/state/store.js";
import { playFromServer, modelStatus } from "../src/server/modelRouter.mjs";

resetState();
const memory = addCharacterMemory({
  characterId: "char_lin",
  targetCharacterId: "char_shen",
  type: "weaponized",
  stance: "revenge",
  content: "她把他的批注记成一种可被公开的证据。",
  publicVersion: "保留材料。",
  privateVersion: "让别人看见他曾经怎样看见自己。",
  distortion: "保护和报复共用同一份材料。",
  reliability: 36,
  heat: 86,
});
assert.ok(memory.id, "memory should be inserted");
const state = getState();
state.ui.engineMode = "mock";
state.ui.activeCharacterIds = ["char_shen", "char_lin"];
const status = modelStatus("mock");
assert.equal(status.version, "1.2.0");
const draft = await playFromServer(state, { mode: "mock" });
assert.ok(draft.audit?.memoryAudit, "draft audit should include memoryAudit");
assert.ok("memoryUseRisk" in draft.audit, "draft audit should expose memoryUseRisk");
assert.ok(draft.updateBundle?.stateChangeReasons?.some((reason) => reason.kind === "memory_use" || reason.kind === "memory_blind_spot"), "state reasons should include memory use or blind spots");
saveDraft(draft);
console.log("memoryAudit:smoke ok", {
  draftId: draft.id,
  memoryUseRisk: draft.audit.memoryUseRisk,
  stateReasons: draft.updateBundle.stateChangeReasons.length,
});
