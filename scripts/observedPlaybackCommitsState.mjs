import assert from "node:assert/strict";
import { getState, recordObservedDraft, resetState } from "../src/state/store.js";

resetState();
const before = getState();
const from = before.characters[0]?.id;
const to = before.characters[1]?.id;
assert.ok(from && to, "seed should have at least two characters");

const draft = {
  id: "draft_observed_commit_test",
  projectId: before.project.id,
  branchId: before.ui.activeBranchId || before.project.activeBranchId,
  createdAt: new Date().toISOString(),
  surfaceEvent: "观察播放产生的一场关系变化",
  sceneText: "沈珩说：“灵契先留下。”阎无咎没有接走。",
  locationId: before.locations[0]?.id,
  participantIds: [from, to],
  relationshipShift: [{
    fromCharacterId: from,
    toCharacterId: to,
    deltas: { fear: 5, wantsToEscape: 4, deception: 2 },
    misreading: "观察播放后，回应者把对方的扣留听成退路被堵。",
    unspoken: "灵契没有被接走。",
    generatedFrom: "agent-dialogue-relationship",
    sharedObject: "灵契",
    finalTurn: "灵契先留下。",
    followupTurn: "灵契先留下。",
    eventOutcome: "灵契没有被接走。",
    relationshipSource: "agent-exchange",
  }],
  irreversibleTraces: ["灵契留在铜盘里。"],
  updateBundle: {
    relationships: [{
      fromCharacterId: from,
      toCharacterId: to,
      deltas: { fear: 5, wantsToEscape: 4, deception: 2 },
      misreading: "观察播放后，回应者把对方的扣留听成退路被堵。",
      unspoken: "灵契没有被接走。",
      generatedFrom: "agent-dialogue-relationship",
      sharedObject: "灵契",
      finalTurn: "灵契先留下。",
      followupTurn: "灵契先留下。",
      eventOutcome: "灵契没有被接走。",
      relationshipSource: "agent-exchange",
    }],
    characterMemories: [{
      id: "mem_observed_commit_test",
      projectId: before.project.id,
      branchId: before.ui.activeBranchId || before.project.activeBranchId,
      characterId: to,
      targetCharacterId: from,
      type: "suppressed",
      stance: "self_defense",
      content: "关系对话记忆：灵契没有被接走。",
      publicVersion: "灵契仍在铜盘里。",
      privateVersion: "退路被堵住。",
      source: "agent_dialogue_relationship",
      heat: 90,
      reliability: 60,
    }],
    stateChangeReasons: [{
      kind: "relationship_shift",
      reason: "观察播放应该直接改变小镇状态。",
    }],
  },
};

const canon = recordObservedDraft(draft);
const after = getState();
const rel = after.relationships.find((item) => item.fromCharacterId === from && item.toCharacterId === to);

assert.ok(canon?.id, "recording an observed draft should create a canon event");
assert.equal(after.draftScenes[0]?.id, draft.id, "observed draft should still be saved for replay");
assert.ok(after.canonEvents.some((event) => event.sourceDraftId === draft.id), "observed playback should be visible in canon history");
assert.ok(rel, "observed playback should apply relationship shifts to current state");
assert.ok(rel.fear >= 15, `relationship fear should increase after observed playback, got ${rel?.fear}`);
assert.ok(after.characterMemories.some((memory) => memory.id === "mem_observed_commit_test"), "observed playback should persist relationship memory");

console.log("observedPlaybackCommitsState:test passed", {
  canonId: canon.id,
  relationshipFear: rel.fear,
  memoryCount: after.characterMemories.length,
});
