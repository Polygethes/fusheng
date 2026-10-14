import assert from "node:assert/strict";
import {
  normalizePrivateSimulation,
  privateSimulationToAgentOutput,
} from "../src/server/pipeline/privateSimulator.mjs";
import { compactState } from "../src/server/pipeline/context.mjs";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵、散修和城中执法者都被中立城规矩暂时压住。",
});

state.ui.activeCharacterIds = state.characters.slice(0, 2).map((character) => character.id);
state.ui.selectedLocationId = state.locations[0].id;

const actor = state.characters[0];
const target = state.characters[1];
const rel = state.relationships.find((item) => item.fromCharacterId === actor.id && item.toCharacterId === target.id);
Object.assign(rel, {
  resentment: 35,
  fear: 22,
  misreading: `${actor.name}把${target.name}的回应记成对自己判断权的挑战。`,
  unspoken: "证据不能走。",
  lastDialogue: {
    source: "model-agent-dialogue",
    relationshipSource: "model-agent-exchange",
    sharedObject: "灵契",
    eventOutcome: `${actor.name}把灵契推向${target.name}，守门人没有盖印。`,
    finalTurn: "证据不能走。",
    followupTurn: "你要谁替你盖印？",
    dialogueTurnCount: 4,
    locationId: state.locations[0].id,
    locationName: state.locations[0].name,
  },
});

const compact = compactState(state);
const compactActor = compact.activeCharacters.find((character) => character.id === actor.id);
const sim = normalizePrivateSimulation({}, compact, compactActor, target.id);
const output = privateSimulationToAgentOutput(sim);

assert.equal(sim.relationshipDialogueMemory?.sharedObject, "灵契", "model private sim should expose relationship last-dialogue object");
assert.match(
  sim.memoryLine,
  /灵契|证据不能走|盖印/,
  "model private sim fallback memoryLine should carry relationship dialogue history",
);
assert.match(
  sim.memoryLine,
  new RegExp(state.locations[0].name),
  "model private sim fallback memoryLine should carry where the relationship dialogue happened",
);
assert.match(
  output.memoryInfluence,
  /灵契|证据不能走|盖印/,
  "agent output converted from private sim should preserve relationship dialogue history",
);

console.log("modelPrivateSimulationRelationshipDialogue:test passed", {
  memoryLine: sim.memoryLine,
  memoryInfluence: output.memoryInfluence,
});
