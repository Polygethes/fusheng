import assert from "node:assert/strict";
import { characterAgent } from "../src/engine/mockEngine.js";
import { buildSimulationTick } from "../src/state/simulationLoop.js";
import { compactState } from "../src/server/pipeline/context.mjs";
import { buildPrivateSimulationUserPrompt } from "../src/server/pipeline/privateSimulator.mjs";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道执律剑修、邪派使者、妖医、镜灵、龙裔和鬼修都被中立城规矩暂时压住。",
});

const healer = state.characters.find((item) => item.id === "char_xianxia_luqingluo") || state.characters.find((item) => item.name === "鹿青萝");
const sword = state.characters.find((item) => item.id === "char_xianxia_shenheng") || state.characters.find((item) => item.name === "沈珩");
const clinic = state.locations.find((item) => item.id === "loc_xianxia_clinic")
  || state.locations.find((item) => /医坊|药炉|万灵/.test(item.name || item.subtext || ""))
  || state.locations[0];

assert.ok(healer && sword && clinic, "fixture should expose 鹿青萝、沈珩 and a playable clinic location");

const relationshipDialogueAct = {
  kind: "protect",
  deltas: { protection: 4, dependence: 1 },
  reason: "鹿青萝把庇护牌重新命名为救命和保护的边界。",
};

const lastDialogue = {
  source: "model-agent-dialogue",
  relationshipSource: "model-agent-exchange",
  sharedObject: "庇护牌",
  locationId: clinic.id,
  locationName: clinic.name,
  periodSlot: "夜间",
  eventOutcome: "鹿青萝把庇护牌压到药炉旁，沈珩没有拿走。",
  finalTurn: "药炉前先救命，庇护牌不交给照骨司。",
  followupTurn: "药炉前先救命，庇护牌不交给照骨司。",
  dialogueTurnCount: 4,
  dialogueTurns: [
    {
      speakerId: healer.id,
      speakerName: healer.name,
      targetId: sword.id,
      targetName: sword.name,
      line: "药炉前先救命，庇护牌不交给照骨司。",
      turnRole: "claim",
    },
    {
      speakerId: sword.id,
      speakerName: sword.name,
      targetId: healer.id,
      targetName: healer.name,
      line: "庇护不能把证据吞掉。",
      turnRole: "response",
    },
    {
      speakerId: healer.id,
      speakerName: healer.name,
      targetId: sword.id,
      targetName: sword.name,
      line: "你可以等封条，伤者不能等。",
      turnRole: "counter",
    },
  ],
  relationshipDialogueAct,
};

state.relationships = [
  {
    id: "rel_luqingluo_shenheng_act_carry",
    projectId: state.project.id,
    branchId: state.project.activeBranchId,
    fromCharacterId: healer.id,
    toCharacterId: sword.id,
    love: 10,
    attraction: 0,
    resentment: 18,
    fear: 20,
    dependence: 18,
    power: 34,
    shame: 12,
    jealousy: 0,
    protection: 42,
    revenge: 0,
    deception: 12,
    wantsToBeSeen: 20,
    wantsToEscape: 14,
    misreading: "鹿青萝把沈珩的扣牌听成把伤者交给审判。",
    unspoken: "救命的边界不该被照骨司夺走。",
    lastDialogue,
    dialogueHistory: [lastDialogue],
  },
];
state.characterMemories = [];
state.characterPlans = [];
state.ui.activeCharacterIds = [healer.id, sword.id];
state.ui.selectedLocationId = clinic.id;
state.ui.timeGrain = "scene";
state.ui.focusMode = "location";

const tick = buildSimulationTick(state);
const privateSimulation = tick.privateSimulations.find((item) => item.characterId === healer.id);
const privateText = [
  privateSimulation?.memoryDialogueEcho,
  privateSimulation?.whatTheyRefuseToAdmit,
  privateSimulation?.memoryTension,
].filter(Boolean).join(" ");

assert.match(
  privateText,
  /关系动作|保护的边界|救命和保护/,
  `local private simulation should carry the relationship dialogue act into next action pressure, got:\n${privateText}`,
);

const output = characterAgent({
  state,
  character: healer,
  activeCharacters: [healer, sword],
  location: clinic,
});
const agentText = `${output.relationshipPressureSummary || ""} ${output.desireReason || ""}`;
assert.match(
  agentText,
  /关系动作|保护的边界|救命和保护/,
  `mock agent should let the relationship dialogue act shape the next hidden action, got:\n${agentText}`,
);

const compact = compactState(state);
const compactHealer = compact.activeCharacters.find((item) => item.id === healer.id);
const prompt = buildPrivateSimulationUserPrompt({
  compact,
  character: compactHealer,
  targetId: sword.id,
});

assert.match(
  prompt,
  /关系动作|保护的边界|救命和保护/,
  "private simulator prompt should include relationshipDialogueAct reason so the model can plan from it",
);

console.log("relationshipDialogueActCarriesForward:test passed", {
  privateText,
  agentText,
  promptExcerpt: prompt.match(/关系对白上下文：[\s\S]*?本轮必须/)?.[0]?.slice(0, 500),
});
