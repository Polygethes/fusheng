import assert from "node:assert/strict";
import {
  createBranchFromDraft,
  getState,
  resetState,
  saveDraft,
  saveStoryRevision,
  setActiveBranch,
  setStoryWorkspace,
} from "../src/state/store.js";

resetState();
saveDraft({
  id: "draft_story_branch_source",
  createdAt: "2026-07-09T12:00:00.000Z",
  locationId: "loc_gregor_room",
  participantIds: ["char_gregor", "char_grete"],
  sceneText: "门外响了一次。",
  surfaceEvent: "门外响了一次。",
});
setStoryWorkspace({ sourceDraftId: "draft_story_branch_source", rewriteText: "主线里，门外只响了一次。" });
saveStoryRevision();

const branch = createBranchFromDraft("draft_story_branch_source", "另一种讲法");
const branchDraftId = getState().draftScenes[0].id;
setStoryWorkspace({ sourceDraftId: branchDraftId, rewriteText: "分支里，敲门声没有停。" });
saveStoryRevision();

setActiveBranch("branch_main");
const mainState = getState();
assert.ok(mainState.storyRevisions.some((revision) => revision.text.includes("只响了一次")), "main branch should retain its story");
assert.ok(!mainState.storyRevisions.some((revision) => revision.text.includes("没有停")), "main branch must not receive the fork's rewrite");

setActiveBranch(branch.id);
const branchState = getState();
assert.ok(branchState.storyRevisions.some((revision) => revision.text.includes("没有停")), "fork should retain its own rewrite");

console.log("storyWorkspaceBranchIsolation:test passed", { branchId: branch.id });
