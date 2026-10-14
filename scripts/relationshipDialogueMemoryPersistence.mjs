import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) || null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
};

const {
  acceptDraft,
  applySetupWorld,
  getState,
  resetState,
  saveDraft,
  setUi,
} = await import("../src/state/store.js");

resetState();
applySetupWorld({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵、散修和城中执法者都被中立城规矩暂时压住。",
});
let state = getState();
setUi({
  timeGrain: "scene",
  focusMode: "focused",
  activeTab: "observe",
  selectedLocationId: state.locations[0].id,
  activeCharacterIds: state.characters.slice(0, 3).map((character) => character.id),
});

state = getState();
const draft = playNext(state);
saveDraft(draft);

const dialogueShifts = (draft.relationshipShift || []).filter((shift) =>
  shift.generatedFrom === "agent-dialogue-relationship" || shift.generatedFrom === "model-agent-dialogue"
);
assert.ok(dialogueShifts.length >= 2, "draft should have dialogue-derived relationship shifts");

const dialogueMemories = (draft.updateBundle?.characterMemories || []).filter((memory) => memory.source === "agent_dialogue_relationship");
assert.ok(dialogueMemories.length >= 2, "update bundle should turn dialogue relationship shifts into private memories");
assert.ok(dialogueMemories.every((memory) => memory.sourceRelationshipShift), "dialogue memories should trace the relationship shift");
assert.ok(
  dialogueMemories.some((memory) => (memory.sourceRelationshipShift?.dialogueTurns || []).length >= 3),
  "dialogue memories should preserve the source exchange turns",
);
assert.ok(dialogueMemories.some((memory) => /灵契|魔印|庇护牌|照骨镜|渡令|魂灯/.test(`${memory.content} ${memory.privateVersion}`)), "dialogue memories should preserve concrete objects");
assert.ok(dialogueMemories.some((memory) => /说|回应|没接|压住|留下|挑战|逼近/.test(`${memory.content} ${memory.privateVersion}`)), "dialogue memories should remember interaction, not only numeric deltas");

const canon = acceptDraft(draft.id, draft.updateBundle);
assert.ok(canon?.id, "draft should be accepted into canon");

state = getState();
const persisted = (state.characterMemories || []).filter((memory) => memory.source === "agent_dialogue_relationship");
assert.ok(persisted.length >= dialogueMemories.length, "accepted state should persist dialogue-derived relationship memories");
assert.ok(persisted.some((memory) => memory.sourceDraftId === draft.id), "persisted dialogue memory should trace the accepted draft");

const nextDraft = playNext(state);
const memoryUsingOutput = (nextDraft.agentOutputs || []).find((output) =>
  /agent_dialogue_relationship|关系对话|上一轮|灵契|魔印|庇护牌/.test(`${output.memoryInfluence || ""} ${output.memoryUse || ""}`)
);
assert.ok(memoryUsingOutput, "next play should allow character agents to read the accepted dialogue memory");

console.log("relationshipDialogueMemoryPersistence:test passed", {
  dialogueShifts: dialogueShifts.length,
  dialogueMemories: dialogueMemories.length,
  persisted: persisted.length,
  nextMemoryUse: memoryUsingOutput?.memoryInfluence || memoryUsingOutput?.memoryUse,
});
