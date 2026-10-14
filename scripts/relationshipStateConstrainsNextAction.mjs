import assert from "node:assert/strict";
import { buildSimulationTick } from "../src/state/simulationLoop.js";
import { compactState } from "../src/server/pipeline/context.mjs";
import { buildPrivateSimulationUserPrompt } from "../src/server/pipeline/privateSimulator.mjs";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道执律剑修、邪派使者、妖医、镜灵、龙裔和鬼修都被中立城规矩暂时压住。",
});

const healer = state.characters.find((item) => item.name === "鹿青萝");
const sword = state.characters.find((item) => item.name === "沈珩");
const clinic = state.locations.find((item) => /万灵|医坊|药炉/.test(`${item.id} ${item.name} ${item.subtext}`)) || state.locations[0];

assert.ok(healer && sword && clinic, "fixture should include 鹿青萝、沈珩 and a clinic-like place");

const lastDialogue = {
  source: "agent-dialogue-relationship",
  relationshipSource: "agent-exchange",
  sharedObject: "庇护牌",
  locationId: clinic.id,
  locationName: clinic.name,
  eventOutcome: "鹿青萝把庇护牌压到药炉旁，沈珩没有把伤者交给照骨司。",
  finalTurn: "你可以等封条，伤者不能等。",
  followupTurn: "你可以等封条，伤者不能等。",
  dialogueTurnCount: 4,
  relationshipDialogueAct: {
    kind: "protect",
    reason: "鹿青萝把庇护牌重新命名为救命和保护的边界。",
  },
  dialogueTurns: [
    { speakerId: healer.id, speakerName: healer.name, targetId: sword.id, targetName: sword.name, line: "药炉前先救命，庇护牌不交给照骨司。", turnRole: "claim" },
    { speakerId: sword.id, speakerName: sword.name, targetId: healer.id, targetName: healer.name, line: "庇护不能把证据吞掉。", turnRole: "response" },
    { speakerId: healer.id, speakerName: healer.name, targetId: sword.id, targetName: sword.name, line: "你可以等封条，伤者不能等。", turnRole: "counter" },
  ],
};

state.relationships = [
  {
    id: "rel_relationship_state_lu_shen",
    projectId: state.project.id,
    branchId: state.project.activeBranchId,
    fromCharacterId: healer.id,
    toCharacterId: sword.id,
    love: 10,
    attraction: 0,
    resentment: 18,
    fear: 18,
    dependence: 22,
    power: 28,
    shame: 12,
    jealousy: 0,
    protection: 48,
    revenge: 0,
    deception: 8,
    wantsToBeSeen: 18,
    wantsToEscape: 8,
    misreading: "鹿青萝把沈珩的扣押听成要把伤者交给审判。",
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

const tick = buildSimulationTick(state);
const sim = tick.privateSimulations.find((item) => item.characterId === healer.id);

assert.ok(sim, "鹿青萝 should receive a private simulation");
assert.equal(sim.relationshipState?.kind, "protect", `relationshipState should keep the latest dialogue act kind, got:\n${JSON.stringify(sim?.relationshipState, null, 2)}`);
assert.match(
  sim.relationshipState?.label || "",
  /保护|庇护|救命/,
  `relationshipState should name the relationship as a playable state, got:\n${JSON.stringify(sim.relationshipState, null, 2)}`,
);
assert.match(
  sim.relationshipState?.currentConstraint || "",
  /不能只处理庇护牌|必须先回应人|伤者/,
  `relationshipState should state what the next action can no longer ignore, got:\n${JSON.stringify(sim.relationshipState, null, 2)}`,
);
assert.match(
  `${sim.actionCandidate}\n${sim.whatTheyRefuseToAdmit}\n${sim.memoryTension}`,
  /关系状态|不能只处理庇护牌|伤者不能等|救命和保护/,
  `next private action should be constrained by relationshipState, got:\n${JSON.stringify({
    actionCandidate: sim.actionCandidate,
    whatTheyRefuseToAdmit: sim.whatTheyRefuseToAdmit,
    memoryTension: sim.memoryTension,
    relationshipState: sim.relationshipState,
  }, null, 2)}`,
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
  /关系状态/,
  `model private simulator prompt should name the playable relationship state, got:\n${prompt}`,
);
assert.match(
  prompt,
  /不能只处理庇护牌/,
  `model private simulator prompt should carry the playable relationship state constraint, got:\n${prompt}`,
);

console.log("relationshipStateConstrainsNextAction:test passed", {
  relationshipState: sim.relationshipState,
  actionCandidate: sim.actionCandidate,
  promptExcerpt: prompt.match(/关系对白上下文：[\s\S]*?本轮必须/)?.[0]?.slice(0, 520),
});
