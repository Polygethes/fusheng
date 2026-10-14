import assert from "node:assert/strict";

globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

const store = await import("../src/state/store.js");

assert.equal(typeof store.applySetupWorld, "function", "store should apply a skill-generated world before entering observation");

store.resetState();
store.applySetupWorld({
  setupWorldPrompt: "《西游记》：一条漫长的取经路，神佛、妖怪、官府、山野和人心试炼同时存在，每一站都有自己的规矩。",
  setupPeoplePrompt: "一个必须抵达的人、几个本性不同的同行者、沿途的妖怪、求助的人、阻拦的人和旁观的神佛。",
});

const state = store.getState();

assert.ok(state.project.title.includes("西游") || state.town.name.includes("取经"), "applied state should use the generated world title");
assert.ok(state.worldSetup.generatedBySkills, "applied state should remember skill generation");
assert.ok(state.characters.some((character) => character.name === "孙悟空"), "applied state should contain generated cast");
assert.ok(!state.characters.some((character) => character.name.includes("格里高尔")), "applied state should replace the old seed cast");
assert.ok(state.locations.some((location) => location.name.includes("山门")), "applied state should contain generated locations");
assert.ok(state.relationships.every((relationship) => state.characters.some((character) => character.id === relationship.fromCharacterId)), "relationships should point at generated characters");
assert.ok(state.ui.activeCharacterIds.every((id) => state.characters.some((character) => character.id === id)), "active characters should point at generated cast");
assert.equal(state.ui.selectedLocationId, state.locations[0].id, "selected location should point at generated first location");
assert.ok(state.ui.userDirective.includes("西游") || state.ui.userDirective.includes("取经"), "directive should carry the generated world");

console.log("setupSkillStateApply:test passed", {
  title: state.project.title,
  cast: state.characters.map((character) => character.name).join(", "),
});
