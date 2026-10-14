import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { playFromServer, modelStatus } from "../src/server/modelRouter.mjs";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const state = clone(initialState);
state.ui.engineMode = "mock";
state.interventions = [
  {
    id: "intervention_smoke_protect",
    projectId: state.project.id,
    branchId: state.ui.activeBranchId,
    enabled: true,
    type: "force_protect",
    action: "protect",
    targetCharacterId: "char_lin",
    secondaryCharacterId: "char_shen",
    intensity: 73,
    instruction: "林澄保护沈闻山，但保护本身也成为占有和报复。",
    persistence: "next_play",
    createdAt: new Date().toISOString(),
  },
];

const status = modelStatus("mock");
assert.equal(status.version, "1.2.0");
const draft = await playFromServer(state, { mode: "mock" });
assert.ok(draft.updateBundle?.consumedInterventionIds?.includes("intervention_smoke_protect"));
assert.ok((draft.relationshipShift || []).some((shift) => shift.interventionId === "intervention_smoke_protect"));
console.log("intervention smoke passed", draft.id, status.pipeline);
