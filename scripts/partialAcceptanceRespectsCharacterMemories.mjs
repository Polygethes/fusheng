import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) || null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
};

const {
  acceptDraftWithOptions,
  applySetupWorld,
  getState,
  resetState,
  saveDraft,
} = await import("../src/state/store.js");

resetState();
applySetupWorld({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵、散修和城中执法者都被中立城规矩暂时压住。",
});

const before = getState();
const shen = before.characters.find((item) => item.id === "char_xianxia_shenheng");
const yan = before.characters.find((item) => item.id === "char_xianxia_yanwujie");
assert.ok(shen && yan, "test characters should exist");

const draft = {
  id: "draft_partial_memory_filter",
  projectId: before.project.id,
  branchId: before.ui.activeBranchId || "branch_main",
  createdAt: new Date().toISOString(),
  locationId: "loc_xianxia_contract_gate",
  participantIds: [shen.id, yan.id],
  surfaceEvent: "四方法契门前，灵契没有离盘。",
  sceneText: "沈珩说：“灵契先留在铜盘里。”阎无咎没有接走。",
  relationshipShift: [],
  irreversibleTraces: [],
  updateBundle: {
    characterMemories: [{
      id: "mem_should_not_be_written_when_character_memories_unchecked",
      projectId: before.project.id,
      branchId: "branch_main",
      characterId: shen.id,
      targetCharacterId: yan.id,
      type: "weaponized",
      stance: "revenge",
      content: "这条记忆在部分赞同时不应写入。",
      publicVersion: "灵契没离盘。",
      privateVersion: "沈珩把阎无咎的停顿记成拖延。",
      reliability: 50,
      heat: 80,
      source: "agent_dialogue_relationship",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }],
  },
};

saveDraft(draft);
acceptDraftWithOptions(draft.id, draft.updateBundle, {
  scene: true,
  characters: true,
  relationships: true,
  rumors: true,
  evidence: true,
  characterMemories: false,
  characterPlans: true,
  irreversibleTraces: true,
  secrets: true,
  stateChangeReasons: true,
});

const after = getState();
assert.ok(
  !after.characterMemories.some((memory) => memory.id === "mem_should_not_be_written_when_character_memories_unchecked"),
  "partial acceptance with characterMemories=false must not persist character memories",
);

console.log("partialAcceptanceRespectsCharacterMemories:test passed", {
  memoriesBefore: before.characterMemories.length,
  memoriesAfter: after.characterMemories.length,
});
