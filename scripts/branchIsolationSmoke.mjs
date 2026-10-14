const memory = new Map();
globalThis.localStorage = {
  getItem(key) { return memory.has(key) ? memory.get(key) : null; },
  setItem(key, value) { memory.set(key, String(value)); },
  removeItem(key) { memory.delete(key); },
  clear() { memory.clear(); },
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const store = await import("../src/state/store.js");

store.resetState();
let state = store.getState();
const mainBranchId = state.ui.activeBranchId;
const [shenId, linId] = state.characters.slice(0, 2).map((character) => character.id);
assert(shenId && linId, "branch fixture requires at least two characters");

store.updateCharacter(shenId, (character) => ({
  currentState: { ...character.currentState, desire: 11, shame: 22 },
}));

store.saveDraft({
  id: "draft_branch_isolation_seed",
  projectId: state.project.id,
  branchId: mainBranchId,
  locationId: state.ui.selectedLocationId,
  participantIds: [shenId, linId],
  surfaceEvent: "分支隔离测试草稿",
  sceneText: "一个用于验证分支隔离的草稿。",
  relationshipShift: [],
  irreversibleTraces: [],
  updateBundle: {
    characters: [],
    relationships: [],
    rumors: [],
    evidence: [],
    secrets: [],
    irreversibleTraces: [],
  },
});

const fork = store.createBranchFromDraft("draft_branch_isolation_seed", "隔离测试分支");
assert(fork?.id, "expected branch to be created");

store.updateCharacter(shenId, (character) => ({
  currentState: { ...character.currentState, desire: 99, shame: 88 },
}));
store.applyUpdateBundle({
  evidence: [{ id: "evidence_branch_only", type: "test", content: "只应存在于测试分支的证据。" }],
  rumors: [{ id: "rumor_branch_only", content: "只应存在于测试分支的谣言。", distortion: "测试", spreadRisk: 44 }],
  irreversibleTraces: [{ id: "trace_branch_only", type: "test", content: "只应存在于测试分支的不可逆痕迹。" }],
});
store.saveDraft({
  id: "draft_branch_only",
  projectId: state.project.id,
  branchId: fork.id,
  locationId: state.ui.selectedLocationId,
  participantIds: [shenId, linId],
  surfaceEvent: "分支专属草稿",
  sceneText: "这个草稿只应留在新分支。",
  relationshipShift: [],
  irreversibleTraces: [],
  updateBundle: {},
});

state = store.getState();
assert(state.ui.activeBranchId === fork.id, "expected fork to be active");
assert(state.characters.find((c) => c.id === shenId).currentState.desire === 99, "expected branch character mutation");
assert(state.evidence.some((item) => item.id === "evidence_branch_only"), "expected branch evidence");

store.setActiveBranch(mainBranchId);
state = store.getState();
assert(state.ui.activeBranchId === mainBranchId, "expected main branch active");
assert(state.characters.find((c) => c.id === shenId).currentState.desire === 11, "main branch character state was polluted");
assert(!state.evidence.some((item) => item.id === "evidence_branch_only"), "main branch evidence was polluted");
assert(!state.rumors.some((item) => item.id === "rumor_branch_only"), "main branch rumor was polluted");
assert(!state.irreversibleTraces.some((item) => item.id === "trace_branch_only"), "main branch trace was polluted");
assert(!state.draftScenes.some((item) => item.id === "draft_branch_only"), "main branch draft list was polluted");

store.setActiveBranch(fork.id);
state = store.getState();
assert(state.characters.find((c) => c.id === shenId).currentState.desire === 99, "fork branch character state was not restored");
assert(state.evidence.some((item) => item.id === "evidence_branch_only"), "fork branch evidence was not restored");
assert(state.rumors.some((item) => item.id === "rumor_branch_only"), "fork branch rumor was not restored");
assert(state.irreversibleTraces.some((item) => item.id === "trace_branch_only"), "fork branch trace was not restored");
assert(state.draftScenes.some((item) => item.id === "draft_branch_only"), "fork branch draft was not restored");

const exported = JSON.parse(store.exportState());
const main = exported.branches.find((branch) => branch.id === mainBranchId);
const forked = exported.branches.find((branch) => branch.id === fork.id);
assert(main?.snapshot, "export must include main branch snapshot");
assert(forked?.snapshot, "export must include fork branch snapshot");
assert(!main.snapshot.evidence.some((item) => item.id === "evidence_branch_only"), "exported main snapshot polluted");
assert(forked.snapshot.evidence.some((item) => item.id === "evidence_branch_only"), "exported fork snapshot missing evidence");

console.log("branch isolation smoke passed");
