import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { playWithOpenAIPipeline } from "../src/server/pipeline/openaiPipeline.mjs";


// This project ships no default model. A contract that drives the real-model
// pipeline must name the model it is pretending to call.
process.env.CHARACTER_TOWN_MODEL ||= "contract-test-model";

const originalEnv = { ...process.env };
process.env.DEEPSEEK_API_KEY = "test-key";
process.env.OPENAI_API_KEY = "";
process.env.CHARACTER_TOWN_DISABLE_REPAIR = "1";

const state = structuredClone(initialState);
state.ui.engineMode = "openai";
state.ui.timeGrain = "scene";
state.ui.activeCharacterIds = state.characters.slice(0, 2).map((character) => character.id);
state.ui.selectedLocationId = state.locations[0].id;

function baseRunners(overrides = {}) {
  return {
    async runPrivateSimulators(compact) {
      const [source, target] = compact.activeCharacters;
      return {
        privateSimulations: [
          {
            characterId: source.id,
            characterName: source.name,
            targetCharacterId: target.id,
            targetCharacterName: target.name,
            tone: "试探",
            publicGoal: "扣住门把",
            privateDesire: "逼对方回答",
            defensiveMask: "只是确认",
            shadowImpulse: "不让对方离开",
            nobleImpulse: "避免惊动旁人",
            selfLie: "我没有逼她",
            actionCandidate: `${source.name}按住门把。`,
            contradictionScore: 62,
            pressure: 64,
          },
          {
            characterId: target.id,
            characterName: target.name,
            targetCharacterId: source.id,
            targetCharacterName: source.name,
            tone: "伪装",
            publicGoal: "把手收回",
            privateDesire: "拖延回答",
            defensiveMask: "先谈别的",
            shadowImpulse: "让对方先失态",
            nobleImpulse: "不把门外的人牵进来",
            selfLie: "这只是误会",
            actionCandidate: `${target.name}把手停在门板上。`,
            contradictionScore: 66,
            pressure: 68,
          },
        ],
        stages: [{ name: "FakePrivate", provider: "test" }],
      };
    },
    async runVisibilityLayer(_compact, simulations) {
      return {
        visibilityLayer: {
          visibleFacts: ["两个人都没有离开门边。"],
          hiddenFacts: [],
          perCharacter: simulations.map((simulation) => ({
            characterId: simulation.characterId,
            knownFacts: ["门仍然关着。"],
            falseBeliefs: [],
            withheldFacts: [],
          })),
        },
        stage: { name: "FakeVisibility", provider: "test" },
      };
    },
    async runSceneInteractionSimulator(_compact, simulations) {
      const [source, target] = simulations;
      return {
        sceneInteraction: {
          surfaceEvent: "门把被两只手同时按住。",
          sceneText: `${source.characterName}按住门把。${target.characterName}说：“先让我把话说完。”`,
          interactionBeats: [{
            actorId: source.characterId,
            actorName: source.characterName,
            targetId: target.characterId,
            targetName: target.characterName,
            beat: `${source.characterName}按住门把。`,
          }],
          agentExchanges: [{
            sourceCharacterId: source.characterId,
            sourceCharacterName: source.characterName,
            responseCharacterId: target.characterId,
            responseCharacterName: target.characterName,
            sharedObject: "门把",
            dialogueTurns: [
              { speakerId: source.characterId, speakerName: source.characterName, targetId: target.characterId, targetName: target.characterName, line: "你先回答。" },
              { speakerId: target.characterId, speakerName: target.characterName, targetId: source.characterId, targetName: source.characterName, line: "先让我把话说完。" },
            ],
            eventOutcome: "两个人都没有松开门把。",
            relationshipDeltas: [],
          }],
          misunderstandings: [],
          reversals: [],
          visibilityFlips: [],
          relationshipMutationIntents: [],
          evidenceCreated: [],
          rumorCreated: [],
          memoryDistortions: [],
          irreversibleTraces: [],
          subtextMatrix: [],
          relationshipShift: [],
        },
        stage: { name: "FakeScene", provider: "test" },
      };
    },
    async streamSceneNovel(_compact, _scene, { onDelta }) {
      const novelText = "门把在两只手之间轻轻响了一声。\n\n“先让我把话说完。”";
      await onDelta(novelText);
      return { novelText, stage: { name: "FakeNovel", provider: "test" } };
    },
    async runDialoguePsychology() {
      throw new TypeError("fetch failed");
    },
    async runDepthAuditor() {
      throw new TypeError("fetch failed");
    },
    async runRepairPass() {
      throw new Error("repair should be disabled");
    },
    ...overrides,
  };
}

try {
  const events = [];
  const draft = await playWithOpenAIPipeline(state, {
    runners: baseRunners(),
    onProgress: async (event) => events.push(event),
  });

  assert.match(draft.novelText, /门把在两只手之间/, "successful prose must survive auxiliary model failures");
  assert.equal(draft.dialoguePsychology.length, 0, "failed private reactions should degrade to an empty update, not abort reality");
  assert.ok(draft.pipelineMeta.degradedStages.some((item) => item.stage === "dialogue_psychology"));
  assert.ok(draft.pipelineMeta.degradedStages.some((item) => item.stage === "depth_auditor"));
  assert.equal(events.filter((event) => event.type === "stage_warning").length, 2);
  assert.ok(events.some((event) => event.type === "scene_complete"), "the paid run should still complete");
  assert.ok(!events.some((event) => event.type === "error"), "recoverable stage failures must not become fatal run errors");

  delete process.env.CHARACTER_TOWN_DISABLE_REPAIR;
  process.env.CHARACTER_TOWN_FORCE_REPAIR = "1";
  const repairEvents = [];
  const repairDraft = await playWithOpenAIPipeline(state, {
    runners: baseRunners({
      async runDialoguePsychology() {
        return { reactions: [], stages: [] };
      },
      async runDepthAuditor(_compact, _draft, localAudit) {
        return {
          audit: { ...localAudit, requiredFixes: ["fixture forces repair"] },
          stage: { name: "FakeAudit", provider: "test" },
        };
      },
      async runRepairPass() {
        throw new TypeError("fetch failed");
      },
    }),
    onProgress: async (event) => repairEvents.push(event),
  });

  assert.match(repairDraft.novelText, /门把在两只手之间/, "completed prose must survive a failed repair pass");
  assert.ok(repairDraft.pipelineMeta.degradedStages.some((item) => item.stage === "repair_pass"));
  assert.ok(repairEvents.some((event) => event.type === "stage_warning" && event.stage === "repair_pass"));
  assert.ok(repairEvents.some((event) => event.type === "scene_complete"), "repair failure must not suppress scene completion");

  console.log("modelRecoverableStageFailures:test passed", {
    warnings: [...events, ...repairEvents].filter((event) => event.type === "stage_warning").map((event) => event.stage),
    novelLength: draft.novelText.length,
  });
} finally {
  process.env = originalEnv;
}
