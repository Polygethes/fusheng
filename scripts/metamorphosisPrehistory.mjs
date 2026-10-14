import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";

const grete = initialState.characters.find((character) => character.id === "char_grete");
const gregor = initialState.characters.find((character) => character.id === "char_gregor");

assert.ok(grete, "Grete should exist in the Metamorphosis seed");
assert.ok(gregor, "Gregor should exist in the Metamorphosis seed");
assert.ok(initialState.worldSetup?.selectedTimepointId, "world setup should require a selected timepoint");
assert.ok(
  JSON.stringify(initialState.worldSetup).includes("变形尚未发生") || JSON.stringify(initialState.worldSetup).includes("变形前夜"),
  "world setup should state that transformation has not happened yet",
);

assert.ok(!gregor.publicIdentity.includes("醒来后"), "Gregor should not begin from a post-transformation identity");
assert.ok(gregor.publicIdentity.includes("旅行推销员"), "Gregor should begin from his prehistory role");
assert.ok(!grete.publicIdentity.includes("照护者"), "Grete should not pre-know a caregiver role");
assert.ok(grete.publicIdentity.includes("小提琴"), "Grete should begin from her prehistory desire");

const serializedGrete = JSON.stringify(grete);
const serializedGreteMemories = JSON.stringify(initialState.characterMemories.filter((memory) => memory.characterId === "char_grete"));
const serializedRelationships = JSON.stringify(initialState.relationships.filter((relationship) => relationship.fromCharacterId === "char_grete" || relationship.toCharacterId === "char_grete"));
const serializedInitialState = JSON.stringify(initialState);

const forbiddenGreteFuture = [
  "送食物",
  "清理房间",
  "哥哥已经听不懂了",
  "怪物",
  "必须摆脱",
  "第一次端食物",
  "没有哥哥后",
  "照护哥哥",
  "照护者",
  "放弃他",
];

for (const term of forbiddenGreteFuture) {
  assert.ok(!serializedGrete.includes(term), `Grete character card should stay in prehistory and not include: ${term}`);
  assert.ok(!serializedGreteMemories.includes(term), `Grete seed memories should stay in prehistory and not include: ${term}`);
  assert.ok(!serializedRelationships.includes(term), `Grete relationships should stay in prehistory and not include: ${term}`);
}

for (const term of ["怪物", "变形后", "退租", "托盘", "他已经不是"]) {
  assert.ok(!serializedInitialState.includes(term), `initial state should not leak later Metamorphosis knowledge: ${term}`);
}

console.log("metamorphosisPrehistory:test passed", {
  timepoint: initialState.worldSetup.selectedTimepointId,
  grete: grete.publicIdentity,
});
