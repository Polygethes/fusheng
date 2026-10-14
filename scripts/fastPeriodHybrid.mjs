import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { playModelPeriodWithRunners } from "../src/server/pipeline/openaiPipeline.mjs";


// This project ships no default model. A contract that drives the real-model
// pipeline must name the model it is pretending to call.
process.env.CHARACTER_TOWN_MODEL ||= "contract-test-model";

const state = structuredClone(initialState);
state.ui.timeGrain = "day";
state.ui.focusMode = "ambient";
state.ui.activeCharacterIds = state.characters.slice(0, 3).map((item) => item.id);

const calls = { private: 0, scene: 0, novel: 0, visibility: 0, psychology: 0, audit: 0, repair: 0 };
const runners = {
  async runPrivateSimulators(compact) {
    calls.private += 1;
    const characters = compact.activeCharacters.slice(0, 3);
    return {
      privateSimulations: characters.map((character, index) => {
        const target = characters[(index + 1) % characters.length] || character;
        return {
          characterId: character.id, characterName: character.name,
          targetCharacterId: target.id, targetCharacterName: target.name,
          tone: "试探", publicGoal: "守住手边物件", privateDesire: "逼对方先表态",
          defensiveMask: "只是按规矩", shadowImpulse: "拖住对方", nobleImpulse: "不牵连旁人",
          selfLie: "我没有逼迫任何人", actionCandidate: `${character.name}把手边物件留在桌上。`,
          falseBeliefs: [], withheldFacts: [], pressure: 62, contradictionScore: 64,
        };
      }),
      stages: [{ name: "FastPeriodPrivate", provider: "test" }],
    };
  },
  async runVisibilityLayer() { calls.visibility += 1; throw new Error("fast period should use local visibility"); },
  async runSceneInteractionSimulator(_compact, simulations) {
    calls.scene += 1;
    const [source, target] = simulations;
    return {
      sceneInteraction: {
        surfaceEvent: "一张旧凭证被推到桌面中央。",
        sceneText: `${source.characterName}说：“这张凭证是谁留下的？”${target.characterName}没有立刻回答。`,
        interactionBeats: [], agentExchanges: [{
          sourceCharacterId: source.characterId, sourceCharacterName: source.characterName,
          responseCharacterId: target.characterId, responseCharacterName: target.characterName,
          sharedObject: "旧凭证",
          dialogueTurns: [
            { speakerId: source.characterId, speakerName: source.characterName, targetId: target.characterId, targetName: target.characterName, line: "这张凭证是谁留下的？" },
            { speakerId: target.characterId, speakerName: target.characterName, targetId: source.characterId, targetName: source.characterName, line: "先说你从哪里拿到它。" },
          ], eventOutcome: "旧凭证留在两个人之间。", relationshipDeltas: [],
        }],
        presenceChanges: [], remainingCastAftermath: [], misunderstandings: [], reversals: [], visibilityFlips: [],
        relationshipMutationIntents: [], evidenceCreated: [], rumorCreated: [], memoryDistortions: [], irreversibleTraces: [], subtextMatrix: [], relationshipShift: [],
      },
      stage: { name: "FastPeriodScene", provider: "test" },
    };
  },
  async runDialoguePsychology() { calls.psychology += 1; throw new Error("fast period should use local psychology"); },
  async runDepthAuditor() { calls.audit += 1; throw new Error("fast period should use local audit"); },
  async runRepairPass() { calls.repair += 1; throw new Error("fast period should not repair"); },
  async streamSceneNovel(_compact, _scene, { onDelta }) {
    calls.novel += 1;
    const novelText = "旧凭证擦过桌面。\n\n“先说你从哪里拿到它。”";
    await onDelta(novelText);
    return { novelText, stage: { name: "FastPeriodNovel", provider: "test" } };
  },
};

const events = [];
const draft = await playModelPeriodWithRunners(state, {
  pipelineMode: "fast",
  runners,
  onProgress: async (event) => events.push(event),
});

assert.equal(draft.periodSimulation.ticks.length, 5);
assert.deepEqual(calls, { private: 1, scene: 1, novel: 1, visibility: 0, psychology: 0, audit: 0, repair: 0 });
assert.equal(draft.periodSimulation.ticks.filter((tick) => tick.executionMode === "remote_focus").length, 1);
assert.equal(draft.periodSimulation.ticks.filter((tick) => tick.executionMode === "local_background").length, 4);
const firstNovelIndex = events.findIndex((event) => event.type === "novel_delta");
const remoteSceneIndex = events.findIndex((event) => event.type === "scene_started");
assert.ok(firstNovelIndex >= 0 && remoteSceneIndex >= 0 && firstNovelIndex < remoteSceneIndex, "ambient day should show a low-detail morning before waiting for the remote focus scene");

console.log("fastPeriodHybrid:test passed", { calls, modes: draft.periodSimulation.ticks.map((tick) => tick.executionMode) });
