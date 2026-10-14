import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { runSceneInteractionSimulation } from "../src/state/simulationLoop.js";

const simulationTick = {
  id: "tick_relationship_dialogue",
  locationId: "loc_xianxia_contract_gate",
  locationName: "四方法契门",
  visiblePressure: "入门者必须把本命物放在界石边。",
  privateSimulations: [
    {
      characterId: "char_a",
      characterName: "甲",
      privateDesire: "逼乙承认杯里的水被换过。",
      defensiveMask: "我只看杯口。",
      shadowImpulse: "把乙困在桌边。",
    },
    {
      characterId: "char_b",
      characterName: "乙",
      privateDesire: "保住红绳里的名字。",
      defensiveMask: "绳子在，话才算数。",
      shadowImpulse: "把杯子从证据里挪走。",
    },
  ],
};

const agentOutputs = [
  {
    outputId: "out_a",
    characterId: "char_a",
    targetCharacterId: "char_b",
    visibleAction: "甲把青瓷杯推到乙面前，杯沿还沾着水。甲说：“先看杯口。”",
    tone: "试探",
  },
  {
    outputId: "out_b",
    characterId: "char_b",
    targetCharacterId: "char_a",
    visibleAction: "乙没有接甲推来的青瓷杯，把红绳压到杯沿旁。乙说：“绳子在，话才算数。”",
    tone: "保护",
    interactionInput: {
      sourceCharacterId: "char_a",
      sourceOutputId: "out_a",
      observedVisibleAction: "甲把青瓷杯推到乙面前，杯沿还沾着水。甲说：“先看杯口。”",
      sharedObject: "青瓷杯",
    },
  },
];

const scene = runSceneInteractionSimulation({
  state: { characters: [] },
  simulationTick,
  agentOutputs,
});

const exchange = scene.agentExchanges[0];
assert.ok(exchange?.relationshipDeltas?.length >= 2, "agent exchange should carry relationship deltas");
assert.ok(scene.agentRelationshipShifts?.length >= 2, "scene interaction should expose dialogue-derived relationship shifts");

const directShift = scene.agentRelationshipShifts.find((shift) => shift.fromCharacterId === "char_a" && shift.toCharacterId === "char_b");
assert.ok(directShift, "initiator-to-responder relationship shift should exist");
assert.equal(directShift.generatedFrom, "agent-dialogue-relationship", "relationship shift should declare dialogue origin");
assert.equal(directShift.sourceOutputId, "out_a", "relationship shift should trace initiating output");
assert.equal(directShift.responseOutputId, "out_b", "relationship shift should trace responding output");
assert.ok(directShift.dialogueTurnCount >= 3, "relationship shift should know the conversation had turn-taking");
assert.match(`${directShift.misreading} ${directShift.unspoken}`, /杯口|红绳|青瓷杯/, "relationship shift should cite concrete dialogue or objects");

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵、散修和城中执法者都被中立城规矩暂时压住。",
});
state.ui.timeGrain = "day";
state.ui.activeTab = "observe";

const draft = playNext(state);
const dialogueShifts = (draft.relationshipShift || []).filter((shift) => shift.generatedFrom === "agent-dialogue-relationship");

assert.ok(dialogueShifts.length >= 5, "day simulation should aggregate relationship shifts from agent dialogue in multiple periods");
assert.ok(draft.updateBundle?.relationships?.some((shift) => shift.generatedFrom === "agent-dialogue-relationship"), "update bundle should preserve dialogue-derived relationship shifts for canon acceptance");

console.log("relationshipEvolutionFromAgentDialogue:test passed", {
  lowLevelShifts: scene.agentRelationshipShifts.length,
  dayDialogueShifts: dialogueShifts.length,
  sample: dialogueShifts[0],
});
