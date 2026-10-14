import assert from "node:assert/strict";
import { normalizeAgentOutput } from "../src/server/pipeline/context.mjs";
import { normalizePrivateSimulation } from "../src/server/pipeline/privateSimulator.mjs";

const compact = {
  activeCharacters: [
    { id: "char_a", name: "沈珩", actionLines: {}, currentState: {}, internalSituation: {} },
    { id: "char_b", name: "阎无咎", actionLines: {}, currentState: {}, internalSituation: {} },
    { id: "char_c", name: "鹿青萝", actionLines: {}, currentState: {}, internalSituation: {} },
  ],
};

const character = compact.activeCharacters[0];
const relationshipChosenTargetId = "char_c";

const privateSim = normalizePrivateSimulation(
  {
    characterId: "char_a",
    targetCharacterId: "char_b",
    targetCharacterName: "阎无咎",
    actionCandidate: "沈珩仍想转向阎无咎。",
  },
  compact,
  character,
  relationshipChosenTargetId,
);

assert.equal(
  privateSim.targetCharacterId,
  relationshipChosenTargetId,
  "private simulation normalization should keep the relationship-selected target even if model JSON names another target",
);
assert.equal(privateSim.targetCharacterName, "鹿青萝", "private simulation target name should match the locked target");
assert.doesNotMatch(
  privateSim.actionCandidate,
  /阎无咎/,
  "private simulation action text should not keep the model's stale target name after target locking",
);
assert.match(
  privateSim.actionCandidate,
  /鹿青萝/,
  "private simulation action text should be rewritten toward the locked target name",
);

const agentOutput = normalizeAgentOutput(
  {
    characterId: "char_a",
    targetCharacterId: "char_b",
    visibleAction: "沈珩转向阎无咎。",
  },
  "char_a",
  relationshipChosenTargetId,
  { targetCharacterName: "鹿青萝", forbiddenTargetNames: ["阎无咎"] },
);

assert.equal(
  agentOutput.targetCharacterId,
  relationshipChosenTargetId,
  "agent output normalization should keep the relationship-selected target even if model JSON names another target",
);
assert.doesNotMatch(
  agentOutput.visibleAction,
  /阎无咎/,
  "agent output visible action should not keep the stale model target name after target locking",
);
assert.match(agentOutput.visibleAction, /鹿青萝/, "agent output visible action should name the locked target");

console.log("modelOutputCannotOverrideRelationshipTarget:test passed", {
  privateTarget: privateSim.targetCharacterId,
  outputTarget: agentOutput.targetCharacterId,
  actionCandidate: privateSim.actionCandidate,
  visibleAction: agentOutput.visibleAction,
});
