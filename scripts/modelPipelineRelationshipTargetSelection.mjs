import assert from "node:assert/strict";
import * as characterAgents from "../src/server/pipeline/characterAgents.mjs";
import * as privateSimulator from "../src/server/pipeline/privateSimulator.mjs";

const compact = {
  activeCharacterIds: ["char_a", "char_b", "char_c"],
  activeCharacters: [
    { id: "char_a", name: "沈珩" },
    { id: "char_b", name: "阎无咎" },
    { id: "char_c", name: "鹿青萝" },
  ],
  relationships: [
    {
      fromCharacterId: "char_a",
      toCharacterId: "char_b",
      wantsToBeSeen: 30,
      attraction: 0,
      resentment: 0,
      revenge: 0,
      deception: 0,
      fear: 0,
      dependence: 0,
      wantsToEscape: 0,
      protection: 0,
    },
    {
      fromCharacterId: "char_a",
      toCharacterId: "char_c",
      wantsToBeSeen: 0,
      attraction: 0,
      resentment: 0,
      revenge: 0,
      deception: 0,
      fear: 42,
      dependence: 82,
      wantsToEscape: 36,
      protection: 0,
    },
  ],
};

assert.equal(typeof privateSimulator.targetFor, "function", "private simulator target selector should be testable");
assert.equal(typeof characterAgents.targetFor, "function", "character agent target selector should be testable");

assert.equal(
  privateSimulator.targetFor(compact.activeCharacters[0], compact),
  "char_c",
  "private simulator should target the strongest evolved relationship, including dependence/fear/escape",
);
assert.equal(
  characterAgents.targetFor(compact.activeCharacters[0], compact),
  "char_c",
  "character agent fallback should use the same complete relationship target selection",
);

console.log("modelPipelineRelationshipTargetSelection:test passed", {
  privateTarget: privateSimulator.targetFor(compact.activeCharacters[0], compact),
  characterAgentTarget: characterAgents.targetFor(compact.activeCharacters[0], compact),
});
