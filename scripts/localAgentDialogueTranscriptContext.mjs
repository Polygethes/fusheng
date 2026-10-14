import assert from "node:assert/strict";
import { characterAgent } from "../src/engine/mockEngine.js";
import { simulatePrivateCharacter } from "../src/state/simulationLoop.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道执律剑修、邪派使者、妖医、镜灵、龙裔和鬼修都被中立城规矩暂时压住。",
});

state.ui.activeCharacterIds = state.characters.slice(0, 2).map((character) => character.id);
state.ui.selectedLocationId = state.locations[0].id;

const actor = state.characters[0];
const target = state.characters[1];
const location = state.locations[0];
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
    locationId: location.id,
    locationName: location.name,
    periodSlot: "上午",
  },
});
rel.dialogueHistory = [rel.lastDialogue];

const sim = simulatePrivateCharacter({
  state,
  character: actor,
  activeCharacters: [actor, target],
  location,
  visibilityLayer: { perCharacter: [] },
});

const output = characterAgent({
  state,
  character: actor,
  activeCharacters: [actor, target],
  location,
});

for (const turn of dialogueTurns) {
  const escaped = new RegExp(turn.line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  assert.match(
    `${sim.whatTheyRefuseToAdmit || ""} ${sim.memoryTension || ""} ${sim.memoryDialogueEcho || ""}`,
    escaped,
    `local private simulation should expose full prior dialogue turn: ${turn.line}`,
  );
  assert.match(
    `${output.relationshipPressureSummary || ""} ${output.hiddenAction || ""}`,
    escaped,
    `mock agent should expose full prior dialogue turn: ${turn.line}`,
  );
}

assert.equal(
  (sim.memoryDialogueEcho.match(/上一轮对白全文/g) || []).length,
  1,
  "single remembered exchange should not duplicate the same dialogue transcript as history",
);

console.log("localAgentDialogueTranscriptContext:test passed", {
  transcript: sim.relationshipDialogueTranscript,
});
