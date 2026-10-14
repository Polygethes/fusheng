import assert from "node:assert/strict";
import { compactState } from "../src/server/pipeline/context.mjs";
import { normalizePrivateSimulation } from "../src/server/pipeline/privateSimulator.mjs";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道执律剑修、邪派使者、妖医、镜灵、龙裔和鬼修都被中立城规矩暂时压住。",
});

state.ui.activeCharacterIds = state.characters.slice(0, 2).map((character) => character.id);
state.ui.selectedLocationId = state.locations[0].id;

const actor = state.characters[0];
const target = state.characters[1];
const rel = state.relationships.find((item) => item.fromCharacterId === actor.id && item.toCharacterId === target.id);

const dialogueTurns = [
  {
    speakerId: actor.id,
    speakerName: actor.name,
    targetId: target.id,
    targetName: target.name,
    line: "按城法扣契，不按宗门私仇。",
    turnRole: "claim",
  },
  {
    speakerId: target.id,
    speakerName: target.name,
    targetId: actor.id,
    targetName: actor.name,
    line: "我押的是灵契，不是命。",
    turnRole: "response",
  },
  {
    speakerId: actor.id,
    speakerName: actor.name,
    targetId: target.id,
    targetName: target.name,
    line: "剑可以停，证据不能走。",
    turnRole: "counter",
  },
  {
    speakerId: target.id,
    speakerName: target.name,
    targetId: actor.id,
    targetName: actor.name,
    line: "那你要谁替你盖印？",
    turnRole: "turn",
  },
];

Object.assign(rel, {
  resentment: 72,
  wantsToBeSeen: 68,
  misreading: `${actor.name}把${target.name}的追问记成逼自己让步。`,
  unspoken: "证据不能走。",
  lastDialogue: {
    source: "model-agent-dialogue",
    relationshipSource: "model-agent-exchange",
    sharedObject: "灵契",
    eventOutcome: `${actor.name}把灵契推向${target.name}，守门人没有盖印。`,
    finalTurn: dialogueTurns.at(-1).line,
    followupTurn: dialogueTurns.at(-1).line,
    dialogueTurnCount: dialogueTurns.length,
    dialogueTurns,
    locationId: state.locations[0].id,
    locationName: state.locations[0].name,
    periodSlot: "上午",
  },
});
rel.dialogueHistory = [rel.lastDialogue];

const compact = compactState(state);
const compactActor = compact.activeCharacters.find((character) => character.id === actor.id);
const sim = normalizePrivateSimulation({}, compact, compactActor, target.id);

for (const turn of dialogueTurns) {
  assert.match(
    `${sim.memoryLine || ""} ${sim.relationshipDialogueTranscript || ""}`,
    new RegExp(turn.line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    `private simulation should expose full prior dialogue turn: ${turn.line}`,
  );
}

console.log("privateSimulationDialogueTranscriptContext:test passed", {
  transcript: sim.relationshipDialogueTranscript,
});
