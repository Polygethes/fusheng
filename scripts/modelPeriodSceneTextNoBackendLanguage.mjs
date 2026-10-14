import assert from "node:assert/strict";
import { playModelPeriodWithRunners } from "../src/server/pipeline/openaiPipeline.mjs";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";


// This project ships no default model. A contract that drives the real-model
// pipeline must name the model it is pretending to call.
process.env.CHARACTER_TOWN_MODEL ||= "contract-test-model";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "赛博朋克海底避难城，氧气被公司征税，潮汐闸、黑市码头和祈祷舱互相牵制。",
  setupPeoplePrompt: "潜水员走私者、公司监察官、合成圣女、老工程师、黑市医生。",
});

state.ui.timeGrain = "day";
state.ui.focusMode = "location";
state.ui.engineMode = "openai";
state.ui.selectedLocationId = state.locations.find((location) => /潮汐闸|黑市|祈祷/.test(location.name))?.id || state.locations[0]?.id;
state.ui.activeCharacterIds = state.characters.slice(0, 3).map((character) => character.id);

let sceneCallCount = 0;
let witnessCalls = 0;

const runners = {
  async runBackgroundSlot(input) {
    // The hybrid period keeps non-focused slots on the deterministic witness.
    witnessCalls += 1;
    return {
      slotText: `${input.slot.label}，${input.location?.name || "避难城"}里的人继续各自的活动。`,
      carryFacts: [],
      characterActivities: [],
      dialogueTurns: [],
      stage: { name: `ActivityWitness:${input.slot.label}`, provider: "test", elapsedMs: 0 },
    };
  },
  async runPrivateSimulators(compact) {
    const active = compact.activeCharacters.slice(0, 2);
    const [first, second] = active;
    return {
      privateSimulations: active.map((character, index) => {
        const target = index === 0 ? second : first;
        return {
          id: `sim_${sceneCallCount}_${character.id}`,
          characterId: character.id,
          characterName: character.name,
          targetCharacterId: target?.id || character.id,
          targetCharacterName: target?.name || character.name,
          tone: index === 0 ? "试探" : "保护",
          publicGoal: `${character.name}把场中的凭证留住。`,
          privateDesire: `${character.name}要让${target?.name || "对方"}继续回应。`,
          defensiveMask: character.agentProfile?.dialogueMoves?.[0] || "先把东西留下。",
          shadowImpulse: `${character.name}把沉默压到凭证旁。`,
          nobleImpulse: "先让人停下。",
          selfLie: "我只是按规矩办事。",
          actionCandidate: `${character.name}把凭证推到${target?.name || "对方"}面前。`,
          whatTheyWantFromOthers: "让对方继续解释。",
          whatTheyRefuseToAdmit: "还没有上一轮关系记忆。",
          riskTheyWillCreate: "凭证会继续留在两人中间。",
          contradictionScore: 54 + index * 7,
          pressure: 50 + index * 8,
        };
      }),
      agentOutputs: [],
      stages: [{ name: "FakePrivate", provider: "test" }],
    };
  },
  async runVisibilityLayer(compact, privateSimulations) {
    return {
      visibilityLayer: {
        visibleFacts: [`${compact.selectedLocation.name}里，凭证还在桌边。`],
        hiddenFacts: ["每个人只知道自己刚才没拿走凭证。"],
        perCharacter: privateSimulations.map((sim) => ({
          characterId: sim.characterId,
          knownFacts: ["凭证还在。"],
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
    const eventOutcome = `${target.characterName}没有接走凭证，把凭证压回${compact.selectedLocation.name}的桌边。`;
    const relationshipShift = [{
      generatedFrom: "model-agent-dialogue",
      relationshipSource: "agent-exchange",
      fromCharacterId: source.characterId,
      toCharacterId: target.characterId,
      deltas: { resentment: 2, wantsToBeSeen: 3 },
      sharedObject: "凭证",
      eventOutcome,
      finalTurn: "凭证先留在这里。",
      dialogueTurnCount: 3,
      misreading: `${source.characterName}把${target.characterName}的停顿记成拖延。`,
      unspoken: "凭证先留在这里。",
    }];
    return {
      sceneInteraction: {
        surfaceEvent: `${compact.selectedLocation.name}里，${source.characterName}和${target.characterName}围着凭证停住`,
        sceneText: `${source.characterName}说：“凭证先留在这里。”${target.characterName}说：“人可以退，凭证不走。” ${eventOutcome}`,
        sceneThesis: "关系通过物件和对白继续发酵。",
        interactionBeats: [],
        agentExchanges: [],
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

const draft = await playModelPeriodWithRunners(state, { pipelineMode: "fast", runners });

assert.ok(
  (draft.periodSimulation?.ticks || []).filter((tick) => tick.resolution !== "focused_scene")
    .every((tick) => tick.executionMode === "local_background"),
  "the hybrid period must run non-focused slots on the deterministic town engine",
);
const locationCount = new Set(draft.periodSimulation?.ticks?.map((tick) => tick.locationId)).size;
const focusedTicks = draft.periodSimulation?.ticks?.filter((tick) => tick.resolution === "focused_scene") || [];
const otherTicks = draft.periodSimulation?.ticks?.filter((tick) => tick.resolution !== "focused_scene") || [];

assert.ok(draft.periodSimulation?.ticks?.length >= 4, "model day should run multiple time slots");
assert.ok(locationCount >= 2, "model day should move through multiple locations when focused");
assert.ok(focusedTicks.length >= 1, "model focused day should include the observed location");
assert.ok(otherTicks.length >= 2, "model focused day should keep other places moving");
assert.doesNotMatch(
  draft.sceneText,
  /低精度|后台运行|后台动作|表面执行|私人压力|镇级偏移|完整场景|聚焦场景|模型小镇|模型场景|自动升格/,
  `model period sceneText should be observation prose, got:\n${draft.sceneText}`,
);
assert.match(draft.sceneText, /说：“/, `model period sceneText should preserve dialogue, got:\n${draft.sceneText}`);
assert.match(draft.sceneText, /潮汐闸|黑市码头|祈祷舱|赛博朋克海底避难城/, `model period sceneText should show town movement, got:\n${draft.sceneText}`);

console.log("modelPeriodSceneTextNoBackendLanguage:test passed", {
  ticks: draft.periodSimulation.ticks.length,
  locationCount,
  focusedTicks: focusedTicks.length,
  sample: draft.sceneText.slice(0, 500),
});
