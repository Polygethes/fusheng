import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";

const STORAGE_KEY = "character-town-observer-state-v12";
const storedState = structuredClone(initialState);
storedState.worldSetup = {
  schemaVersion: 1,
  selectedTimepointId: "metamorphosis_eve",
  worldbuildingSkill: { name: "世界建立 Skill", rules: ["旧版规则"] },
  characterSkill: { name: "角色设定 Skill", rules: ["旧版角色规则"] },
};

const storage = new Map([[STORAGE_KEY, JSON.stringify(storedState)]]);
globalThis.localStorage = {
  getItem: (key) => storage.get(key) || null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
};

const store = await import(`../src/state/store.js?skill-migration=${Date.now()}`);
const state = store.getState();

assert.ok(state.worldSetup.worldbuildingSkill.checkpoints?.some((item) => item.includes("底层规则")), "stored world setup should migrate to full world skill");
assert.equal(state.worldSetup.characterSkill.name, "戏剧人物 Skill", "stored character skill should migrate to the dramatic character skill");
assert.ok(state.worldSetup.characterSkill.checkpoints?.some((item) => item.includes("人物边界")), "stored character skill should include boundary checkpoints");

console.log("worldSetupSkillMigration:test passed", {
  worldSkill: state.worldSetup.worldbuildingSkill.name,
  characterSkill: state.worldSetup.characterSkill.name,
});
