import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { playNext } from "../src/engine/mockEngine.js";
import { activeInterventionsForState } from "../src/state/interventions.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const state = clone(initialState);
state.ui.engineMode = "mock";
state.interventions = [
  {
    id: "intervention_test_force_misread",
    projectId: state.project.id,
    branchId: state.ui.activeBranchId,
    enabled: true,
    consumed: false,
    type: "force_misread",
    action: "misread",
    targetCharacterId: "char_lin",
    secondaryCharacterId: "char_shen",
    intensity: 81,
    instruction: "林澄必须把沈闻山的冷淡误读成只对她开放的隐秘信号。",
    persistence: "next_play",
    createdAt: new Date().toISOString(),
  },
];

assert.equal(activeInterventionsForState(state).length, 1, "active intervention should be visible");
const draft = playNext(state);
assert.ok(draft.sceneText.includes("操盘干预"), "scene should mention operator intervention pressure");
assert.ok(draft.interventionsApplied?.length >= 1, "draft should record applied interventions");
assert.ok(draft.updateBundle?.consumedInterventionIds?.includes("intervention_test_force_misread"), "next_play intervention should be consumed by update bundle");
assert.ok((draft.updateBundle?.stateChangeReasons || []).some((item) => item.kind === "operator_intervention"), "state reasons should include operator intervention explanation");
console.log("intervention layer test passed", draft.id);
