import assert from "node:assert/strict";
import {
  getState,
  resetState,
  saveDraft,
  setActiveTab,
  setStoryWorkspace,
  saveStoryRevision,
} from "../src/state/store.js";

resetState();
const sourceDraft = {
  id: "draft_story_source",
  createdAt: "2026-07-09T12:00:00.000Z",
  locationId: "loc_gregor_room",
  participantIds: ["char_gregor", "char_grete"],
  sceneText: "格里高尔贴着门说他马上就好。格蕾特没有推门。",
  surfaceEvent: "门外的人第一次没有继续催促。",
};
saveDraft(sourceDraft);

const before = getState();
setActiveTab("story");
setStoryWorkspace({
  sourceDraftId: sourceDraft.id,
  title: "门的另一侧",
  rewriteText: "门板另一边安静下来。格里高尔听见妹妹的手停在木头上。",
  mode: "close-third",
});
const revision = saveStoryRevision();
const after = getState();

assert.ok(revision?.id, "saving should create a standalone story revision");
assert.equal(revision.sourceDraftId, sourceDraft.id, "revision should retain its factual source");
assert.equal(after.storyRevisions.length, before.storyRevisions.length + 1, "story revisions should persist separately");
assert.equal(
  after.draftScenes.find((draft) => draft.id === sourceDraft.id)?.sceneText,
  sourceDraft.sceneText,
  "rewriting prose must not overwrite the reality draft",
);

for (const key of [
  "characters",
  "relationships",
  "townStateLedger",
  "canonEvents",
  "characterMemories",
  "characterPlans",
  "evidence",
  "rumors",
  "irreversibleTraces",
]) {
  assert.deepEqual(after[key], before[key], `story editing must not mutate reality state: ${key}`);
}

console.log("storyWorkspaceIsolation:test passed", {
  revisionId: revision.id,
  sourceDraftId: revision.sourceDraftId,
});
