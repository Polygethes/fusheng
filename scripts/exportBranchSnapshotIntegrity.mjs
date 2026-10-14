// Contract: an exported state file must describe every branch on its own.
//
// `exportState()` used to null out the active branch's snapshot, on the theory
// that import rebuilds it from the top-level state.  The round trip through
// `importState` does survive that, but the exported JSON itself is then lossy:
// anything reading the file directly — a diff tool, an archive browser, another
// process, a human — sees the branch the author was actually standing in as the
// one branch with no snapshot.
//
// Losslessness is the default.  The size optimisation stays available as an
// explicit `{ compact: true }` request.

import assert from "node:assert/strict";

const memory = new Map();
globalThis.localStorage = {
  getItem(key) { return memory.has(key) ? memory.get(key) : null; },
  setItem(key, value) { memory.set(key, String(value)); },
  removeItem(key) { memory.delete(key); },
  clear() { memory.clear(); },
};

const store = await import("../src/state/store.js");

store.resetState();
let state = store.getState();
const mainBranchId = state.ui.activeBranchId;
const [firstId, secondId] = state.characters.slice(0, 2).map((character) => character.id);
assert.ok(firstId && secondId, "fixture requires at least two characters");

store.saveDraft({
  id: "draft_export_seed",
  projectId: state.project.id,
  branchId: mainBranchId,
  locationId: state.ui.selectedLocationId,
  participantIds: [firstId, secondId],
  surfaceEvent: "导出完整性测试草稿",
  sceneText: "一个用于验证导出完整性的草稿。",
  relationshipShift: [],
  irreversibleTraces: [],
  updateBundle: {},
});

const fork = store.createBranchFromDraft("draft_export_seed", "导出完整性分支");
assert.ok(fork?.id, "expected branch to be created");

store.applyUpdateBundle({
  evidence: [{ id: "evidence_export_only", type: "test", content: "只应存在于导出分支的证据。" }],
});

state = store.getState();
assert.equal(state.ui.activeBranchId, fork.id, "fork must be the active branch for this contract to mean anything");

// 1. The default export carries a snapshot for every branch, including the
//    active one.
{
  const exported = JSON.parse(store.exportState());
  for (const branch of exported.branches) {
    assert.ok(branch.snapshot, `export must include a snapshot for branch ${branch.id} (${branch.title || "untitled"})`);
  }
  const forked = exported.branches.find((branch) => branch.id === fork.id);
  assert.ok(
    forked.snapshot.evidence.some((item) => item.id === "evidence_export_only"),
    "the active branch snapshot must carry its own evidence, not an empty shell",
  );
  const main = exported.branches.find((branch) => branch.id === mainBranchId);
  assert.ok(
    !main.snapshot.evidence.some((item) => item.id === "evidence_export_only"),
    "the inactive branch snapshot must stay unpolluted",
  );
}

// 2. Compact export remains available and still round-trips, but it is now an
//    explicit request rather than a silent default.
{
  const compact = JSON.parse(store.exportState({ compact: true }));
  const activeBranch = compact.branches.find((branch) => branch.id === fork.id);
  assert.equal(activeBranch.snapshot, null, "compact export may omit the active branch snapshot");
  assert.equal(
    compact.activeBranchSnapshotOmitted,
    true,
    "a compact export must declare that it is lossy so readers do not treat it as complete",
  );

  store.importState(JSON.stringify(compact));
  const restored = store.getState();
  assert.equal(restored.ui.activeBranchId, fork.id, "compact import must restore the active branch");
  assert.ok(
    restored.evidence.some((item) => item.id === "evidence_export_only"),
    "compact import must rebuild the active branch content from top-level state",
  );
}

// 3. The default export round-trips too, and reselecting branches after import
//    keeps each branch's own content.
{
  store.resetState();
  const fresh = store.getState();
  const freshMain = fresh.ui.activeBranchId;
  const [a, b] = fresh.characters.slice(0, 2).map((character) => character.id);
  store.saveDraft({
    id: "draft_roundtrip",
    projectId: fresh.project.id,
    branchId: freshMain,
    locationId: fresh.ui.selectedLocationId,
    participantIds: [a, b],
    surfaceEvent: "往返测试",
    sceneText: "往返。",
    relationshipShift: [],
    irreversibleTraces: [],
    updateBundle: {},
  });
  const roundTripFork = store.createBranchFromDraft("draft_roundtrip", "往返分支");
  store.applyUpdateBundle({
    evidence: [{ id: "evidence_roundtrip", type: "test", content: "往返证据。" }],
  });

  store.importState(store.exportState());
  const afterImport = store.getState();
  assert.equal(afterImport.ui.activeBranchId, roundTripFork.id, "lossless import must restore the active branch");
  assert.ok(
    afterImport.evidence.some((item) => item.id === "evidence_roundtrip"),
    "lossless import must restore active branch evidence",
  );

  store.setActiveBranch(freshMain);
  const onMain = store.getState();
  assert.ok(
    !onMain.evidence.some((item) => item.id === "evidence_roundtrip"),
    "after a lossless round trip the other branch must still be unpolluted",
  );

  store.setActiveBranch(roundTripFork.id);
  const backOnFork = store.getState();
  assert.ok(
    backOnFork.evidence.some((item) => item.id === "evidence_roundtrip"),
    "after a lossless round trip the fork must still restore its own evidence",
  );
}

console.log("export branch snapshot integrity contract passed");
