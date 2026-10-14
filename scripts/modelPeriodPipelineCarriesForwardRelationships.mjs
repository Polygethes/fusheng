import assert from "node:assert/strict";
import { playModelPeriodWithRunners } from "../src/server/pipeline/openaiPipeline.mjs";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";


// This project ships no default model. A contract that drives the real-model
// pipeline must name the model it is pretending to call.
process.env.CHARACTER_TOWN_MODEL ||= "contract-test-model";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵、散修和城中执法者都被中立城规矩暂时压住。",
});

state.ui.timeGrain = "day";
state.ui.focusMode = "ambient";
state.ui.engineMode = "openai";
state.ui.activeCharacterIds = ["char_xianxia_shenheng", "char_xianxia_yanwujie"];
state.ui.selectedLocationId = "loc_xianxia_contract_gate";

const compactSnapshots = [];
let sceneCallCount = 0;

const runners = {
  async runPrivateSimulators(compact) {
    compactSnapshots.push(compact);
    const active = compact.activeCharacters.slice(0, 2);
    const [first, second] = active;
    const sims = active.map((character, index) => {
      const target = index === 0 ? second : first;
      const rel = (compact.relationships || []).find((item) => item.fromCharacterId === character.id && item.toCharacterId === target.id);
      return {
        id: `sim_${compactSnapshots.length}_${character.id}`,
        characterId: character.id,
        characterName: character.name,
        targetCharacterId: target.id,
        targetCharacterName: target.name,
        tone: index === 0 ? "惩罚" : "伪装",
        publicGoal: `${character.name}守住场中的物件。`,
        privateDesire: `${character.name}要让${target.name}继续回应。`,
        defensiveMask: character.agentProfile?.dialogueMoves?.[0] || "按规矩来。",
        shadowImpulse: `${character.name}把沉默压成证据。`,
        nobleImpulse: "先让人停下。",
        selfLie: "我只是按城规办事。",
        actionCandidate: `${character.name}把灵契压到${target.name}面前。`,
        whatTheyWantFromOthers: "让对方继续解释。",
        whatTheyRefuseToAdmit: rel?.lastDialogue ? `上一轮仍压着：${rel.lastDialogue.eventOutcome}` : "还没有上一轮关系记忆。",
        riskTheyWillCreate: "灵契会继续留在两人中间。",
        relationshipDialogueMemory: rel?.lastDialogue || null,
        contradictionScore: rel?.lastDialogue ? 72 : 54,
        pressure: rel?.lastDialogue ? 70 : 50,
      };
    });
    return {
      privateSimulations: sims,
      agentOutputs: [],
      stages: [{ name: `FakePrivate:${compactSnapshots.length}`, provider: "test" }],
    };
  },
  async runVisibilityLayer(compact, privateSimulations) {
    return {
      visibilityLayer: {
        visibleFacts: [`${compact.selectedLocation.name}里，铜盘还在。`],
        hiddenFacts: ["每个人只知道自己刚才没拿走灵契。"],
        perCharacter: privateSimulations.map((sim) => ({
          characterId: sim.characterId,
          knownFacts: ["灵契在铜盘里。"],
          falseBeliefs: [`${sim.characterName}以为对方会先让步。`],
          withheldFacts: [],
        })),
      },
      stage: { name: "FakeVisibility", provider: "test" },
    };
  },
  async runSceneInteractionSimulator(compact, privateSimulations) {
    sceneCallCount += 1;
    const [source, target] = privateSimulations;
    const remembered = Boolean(source.relationshipDialogueMemory || target.relationshipDialogueMemory);
    const finalTurn = remembered ? "上次灵契没有离盘，这次也不能走。" : "灵契先留在铜盘里。";
    const eventOutcome = remembered
      ? "阎无咎记得上一轮灵契没有离盘，又把毒誓符压回铜盘边。"
      : "阎无咎没有接沈珩递出的灵契，把毒誓符压到旁边；灵契被留在两人中间。";
    const relationshipShift = [{
      generatedFrom: "model-agent-dialogue",
      relationshipSource: "agent-exchange",
      fromCharacterId: source.characterId,
      toCharacterId: target.characterId,
      deltas: remembered ? { resentment: 5, wantsToBeSeen: 4 } : { resentment: 3, wantsToBeSeen: 3 },
      sharedObject: "灵契",
      eventOutcome,
      finalTurn,
      followupTurn: remembered ? "谁先带走谁先改口。" : "",
      dialogueTurnCount: remembered ? 4 : 3,
      misreading: `${source.characterName}把${target.characterName}的回应记成拖延。`,
      unspoken: finalTurn,
    }];
    return {
      sceneInteraction: {
        surfaceEvent: `${compact.selectedLocation.name}第${sceneCallCount}次围绕灵契僵住`,
        sceneText: `${source.characterName}说：“${finalTurn}”${target.characterName}没有把灵契拿走。`,
        sceneThesis: "关系通过物件和对白继续发酵。",
        interactionBeats: [],
        agentExchanges: [{
          sourceCharacterId: source.characterId,
          responseCharacterId: target.characterId,
          sourceCharacterName: source.characterName,
          responseCharacterName: target.characterName,
          sharedObject: "灵契",
          dialogueTurns: [
            { speakerId: source.characterId, speakerName: source.characterName, targetId: target.characterId, targetName: target.characterName, line: finalTurn, turnRole: "claim" },
            { speakerId: target.characterId, speakerName: target.characterName, targetId: source.characterId, targetName: source.characterName, line: "我押的是灵契，不是命。", turnRole: "response" },
            { speakerId: source.characterId, speakerName: source.characterName, targetId: target.characterId, targetName: target.characterName, line: "人可以退，灵契不走。", turnRole: "counter" },
          ],
          eventOutcome,
          relationshipDeltas: relationshipShift,
          generatedFrom: "model-agent-dialogue",
        }],
        misunderstandings: [],
        reversals: [],
        visibilityFlips: [],
        relationshipMutationIntents: [],
        evidenceCreated: [],
        rumorCreated: [],
        memoryDistortions: [],
        irreversibleTraces: [eventOutcome],
        subtextMatrix: [],
        relationshipShift,
        directorNotes: "",
        simulationNotes: [],
      },
      stage: { name: `FakeScene:${sceneCallCount}`, provider: "test" },
    };
  },
  async runDepthAuditor(_compact, _draft, localAudit) {
    return {
      audit: {
        ...localAudit,
        shouldRegenerate: false,
        safeClosureRisk: 0,
        whitePaperCharacterRisk: 0,
        multiMotivationScore: 100,
        irreversibleConsequenceScore: 100,
        memoryUseRisk: 0,
        ignoredMemoryRisk: 0,
        memoryChangedActionScore: 100,
        singleMemoryRisk: 0,
        planRisk: 0,
        planUseScore: 100,
        realtimeSimulationRisk: 0,
        realtimeSimulationScore: 100,
        privateIntentCoverage: 100,
        unscriptedCollisionScore: 100,
        requiredFixes: [],
      },
      stage: { name: "FakeAudit", provider: "test" },
    };
  },
  async runRepairPass() {
    throw new Error("repair should not run in this test");
  },
};

const draft = await playModelPeriodWithRunners(state, { runners });

assert.equal(draft.simulationMode, "model-town-period-simulation-loop", "model path should produce a period simulation for day grain");
assert.ok(draft.periodSimulation?.ticks?.length >= 2, "model day playback should contain multiple period ticks");
assert.ok(compactSnapshots.length >= 2, "model period playback should run multiple compacted ticks");

const secondCompact = compactSnapshots[1];
const carriedRelationship = (secondCompact.relationships || []).find((rel) =>
  rel.fromCharacterId === "char_xianxia_shenheng"
  && rel.toCharacterId === "char_xianxia_yanwujie"
  && rel.lastDialogue?.sharedObject === "灵契"
);

assert.ok(carriedRelationship, "second model period tick should receive first tick relationship lastDialogue");
assert.match(carriedRelationship.lastDialogue.eventOutcome, /灵契|毒誓符|铜盘/);
assert.ok(
  draft.periodSimulation.ticks.slice(1).some((tick) =>
    (tick.privateSimulations || tick.simulationTick?.privateSimulations || []).some((sim) => sim.relationshipDialogueMemory?.sharedObject === "灵契")
  ),
  "later model period tick should let private simulations use the carried relationship dialogue",
);

console.log("modelPeriodPipelineCarriesForwardRelationships:test passed", {
  ticks: draft.periodSimulation.ticks.length,
  carriedOutcome: carriedRelationship.lastDialogue.eventOutcome,
});
