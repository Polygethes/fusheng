import assert from "node:assert/strict";
import { normalizePrivateSimulation } from "../src/server/pipeline/privateSimulator.mjs";
import { normalizeSceneInteraction } from "../src/server/pipeline/sceneInteractionSimulator.mjs";
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
const dialogueHistory = [
  {
    source: "model-agent-dialogue",
    relationshipSource: "model-agent-exchange",
    sharedObject: "铜铃",
    eventOutcome: "铜铃留在两人中间。",
    finalTurn: "铃声停了，话还没完。",
    followupTurn: "你记住的是城规，还是我刚才的停顿？",
    dialogueTurnCount: 4,
    locationId: state.locations[0].id,
    locationName: state.locations[0].name,
    periodSlot: "上午",
  },
  {
    source: "model-agent-dialogue",
    relationshipSource: "model-agent-exchange",
    sharedObject: "渡令",
    eventOutcome: "渡令被压回岸边。",
    finalTurn: "人可以退，渡令不走。",
    followupTurn: "你刚才问的是城规，现在渡令先别换手。",
    dialogueTurnCount: 4,
    locationId: state.locations[0].id,
    locationName: state.locations[0].name,
    periodSlot: "中午",
  },
];

Object.assign(rel, {
  resentment: 72,
  wantsToBeSeen: 68,
  misreading: `${actor.name}把${target.name}连续留下物件听成拖延。`,
  unspoken: "这已经不是单次争执。",
  dialogueHistory,
  lastDialogue: dialogueHistory.at(-1),
});

const compact = compactState(state);
const compactActor = compact.activeCharacters.find((character) => character.id === actor.id);
const compactTarget = compact.activeCharacters.find((character) => character.id === target.id);
const actorSim = normalizePrivateSimulation({}, compact, compactActor, target.id);
const targetSim = normalizePrivateSimulation({}, compact, compactTarget, actor.id);

assert.equal(
  actorSim.relationshipDialogueHistory?.length,
  2,
  "private simulation should carry structured repeated relationship dialogue history",
);
assert.equal(
  actorSim.relationshipHistoryCount,
  2,
  "private simulation should expose a relationship history count for scene momentum",
);

const normalized = normalizeSceneInteraction({
  agentExchanges: [{
    sourceCharacterId: actor.id,
    responseCharacterId: target.id,
    sourceCharacterName: actor.name,
    responseCharacterName: target.name,
    sharedObject: "渡令",
    generatedFrom: "model-agent-dialogue",
    eventOutcome: `${target.name}没有接${actor.name}推来的渡令。`,
    dialogueTurns: [
      { speakerId: actor.id, targetId: target.id, line: "渡令先停。", turnRole: "claim" },
      { speakerId: target.id, targetId: actor.id, line: "人能过，追杀不能过。", turnRole: "response" },
      { speakerId: actor.id, targetId: target.id, line: "人可以退，渡令不走。", turnRole: "counter" },
    ],
    relationshipDeltas: [
      {
        fromCharacterId: actor.id,
        toCharacterId: target.id,
        deltas: { resentment: 2, wantsToBeSeen: 2 },
        misreading: `${actor.name}把${target.name}的回应听成拖延。`,
        unspoken: "渡令还没结清。",
      },
    ],
  }],
}, [actorSim, targetSim], { perCharacter: [] });

const momentumShift = normalized.relationshipShift.find((shift) =>
  shift.fromCharacterId === actor.id
  && shift.toCharacterId === target.id
  && shift.generatedFrom === "model-agent-dialogue"
);

assert.equal(
  momentumShift?.relationshipMomentum?.historyCount,
  2,
  "scene normalization should use carried private-simulation dialogue history to intensify the next relationship shift",
);

console.log("modelPrivateSimulationCarriesDialogueHistory:test passed", {
  historyCount: actorSim.relationshipHistoryCount,
  momentum: momentumShift.relationshipMomentum,
});
