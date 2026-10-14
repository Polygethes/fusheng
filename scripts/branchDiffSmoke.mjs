import { initialState } from "../src/data/seed.js";
import { computeBranchDiff } from "../src/state/branchDiff.js";

function deepClone(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

const snapshot = {
  characters: deepClone(initialState.characters),
  relationships: deepClone(initialState.relationships),
  canonEvents: [],
  draftScenes: [],
  rumors: [],
  evidence: [],
  secrets: [],
  irreversibleTraces: [],
};
const altered = deepClone(snapshot);
altered.rumors.push({ id: "rumor_smoke", content: "有人说两条线里的同一个动作不再有同一种含义。", distortion: "把多义行动简化成丑闻。", spreadRisk: 51 });

const state = {
  ...deepClone(initialState),
  ui: { ...initialState.ui, activeBranchId: "branch_main" },
  branches: [
    { id: "branch_main", title: "主线", snapshot },
    { id: "branch_rumor", title: "谣言线", snapshot: altered },
  ],
  ...snapshot,
};

const diff = computeBranchDiff(state, "branch_main", "branch_rumor");
if (diff.totalAddedRumors !== 1) {
  console.error(JSON.stringify(diff, null, 2));
  process.exit(1);
}
console.log("branch diff smoke passed");
