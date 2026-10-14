import assert from "node:assert/strict";
import { buildUpdateBundle } from "../src/engine/stateUpdater.js";
import { runSceneInteractionSimulation } from "../src/state/simulationLoop.js";

const state = {
  project: { id: "proj_followup", activeBranchId: "branch_main" },
  ui: { activeBranchId: "branch_main" },
  characters: [
    { id: "char_a", name: "沈珩", currentState: {} },
    { id: "char_b", name: "阎无咎", currentState: {} },
  ],
  locations: [{ id: "loc_gate", name: "四方法契门" }],
  relationships: [],
  characterPlans: [],
};
const conductorSignal = {
  beatId: "beat_contract_gate_memory",
  delivery: "object",
  object: "灵契",
  inWorldClue: "界石忽然照出两道相互缠住的灵痕。",
  pressureCue: "铜盘下方的旧印先亮了一下",
  target: "char_a",
};

const simulationTick = {
  id: "tick_followup_memory",
  locationId: "loc_gate",
  locationName: "四方法契门",
  privateSimulations: [
    {
      characterId: "char_a",
      characterName: "沈珩",
      targetCharacterId: "char_b",
      targetCharacterName: "阎无咎",
      defensiveMask: "按城法扣契，不按宗门私仇。",
      tone: "惩罚",
      memorySource: "agent_dialogue_relationship",
      memorySharedObject: "灵契",
    },
    {
      characterId: "char_b",
      characterName: "阎无咎",
      targetCharacterId: "char_a",
      targetCharacterName: "沈珩",
      defensiveMask: "我押的是灵契，不是命。",
      tone: "伪装",
      memorySource: "agent_dialogue_relationship",
      memorySharedObject: "灵契",
    },
  ],
};

const agentOutputs = [
  {
    outputId: "out_a",
    characterId: "char_a",
    targetCharacterId: "char_b",
    tone: "惩罚",
    visibleAction: "沈珩扣住阎无咎面前的灵契，另一只手拦住阎无咎。",
    conductorSignal,
  },
  {
    outputId: "out_b",
    characterId: "char_b",
    targetCharacterId: "char_a",
    tone: "伪装",
    visibleAction: "阎无咎没有接沈珩推来的灵契，把魔印压到铜盘边。",
    interactionInput: {
      sourceCharacterId: "char_a",
      sourceOutputId: "out_a",
      observedVisibleAction: "沈珩扣住阎无咎面前的灵契，另一只手拦住阎无咎。",
      sharedObject: "灵契",
    },
  },
];

const sceneInteraction = runSceneInteractionSimulation({ state, simulationTick, agentOutputs });
const exchange = sceneInteraction.agentExchanges[0];
const followupLine = exchange.dialogueTurns[3]?.line || "";
assert.ok(followupLine, "fixture should generate a fourth follow-up line");

const relationshipShift = sceneInteraction.agentRelationshipShifts || [];
assert.ok(
  relationshipShift.some((shift) => shift.followupTurn === followupLine),
  "relationship shift should preserve the follow-up line that changed the exchange",
);
assert.ok(
  relationshipShift.some((shift) => shift.relationshipDialogueAct?.kind),
  "fixture should produce a dialogue act that shaped relationship deltas",
);

const draft = {
  id: "draft_followup_memory",
  branchId: "branch_main",
  locationId: "loc_gate",
  participantIds: ["char_a", "char_b"],
  agentOutputs,
  sceneInteraction,
  relationshipShift,
  irreversibleTraces: [],
};
const bundle = buildUpdateBundle(draft, state);
const memories = (bundle.characterMemories || []).filter((memory) => memory.source === "agent_dialogue_relationship");

assert.ok(
  memories.some((memory) => memory.privateVersion.includes(followupLine)),
  "dialogue memory should include the follow-up line, not only the first three turns",
);
assert.ok(
  memories.some((memory) => memory.sourceRelationshipShift?.followupTurn === followupLine),
  "dialogue memory should trace the follow-up line back to the relationship shift",
);
assert.ok(
  memories.some((memory) => memory.sourceRelationshipShift?.triggeredBy === conductorSignal.inWorldClue),
  "dialogue memory should remember the in-world clue that triggered the exchange",
);
assert.ok(
  memories.some((memory) => memory.sourceRelationshipShift?.conductorSignal?.object === conductorSignal.object),
  "dialogue memory should keep the signal object for future memory retrieval",
);
assert.ok(
  memories.some((memory) => memory.sourceRelationshipShift?.relationshipDialogueAct?.kind),
  "dialogue memory should preserve the dialogue act that changed the relationship",
);
assert.ok(
  memories.some((memory) => /城规|灵契|解释权|交易|筹码/.test(memory.sourceRelationshipShift?.relationshipDialogueAct?.reason || "")),
  "dialogue memory should keep a concrete reason for the relationship change",
);
assert.ok(
  memories.some((memory) => memory.retrievalCue?.includes(conductorSignal.object) && memory.retrievalCue?.includes("四方法契门")),
  "dialogue memory should expose a retrieval cue grounded in object and location",
);
assert.ok(
  memories.some((memory) => memory.privateVersion.includes(conductorSignal.inWorldClue)),
  "private dialogue memory should narrate the causal clue, not only the spoken line",
);

console.log("followupDialogueBecomesMemory:test passed", {
  followupLine,
  memoryCount: memories.length,
});
