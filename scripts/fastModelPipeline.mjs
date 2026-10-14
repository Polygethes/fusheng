import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { playWithOpenAIPipeline } from "../src/server/pipeline/openaiPipeline.mjs";


// This project ships no default model. A contract that drives the real-model
// pipeline must name the model it is pretending to call.
process.env.CHARACTER_TOWN_MODEL ||= "contract-test-model";

const originalEnv = { ...process.env };
process.env.DEEPSEEK_API_KEY = "test-key";
process.env.OPENAI_API_KEY = "";

const state = structuredClone(initialState);
state.ui.timeGrain = "scene";
state.ui.activeCharacterIds = state.characters.slice(0, 2).map((character) => character.id);
state.ui.selectedLocationId = state.locations[0].id;

const calls = { private: 0, visibility: 0, scene: 0, psychology: 0, audit: 0, repair: 0, novel: 0 };
const runners = {
  async runPrivateSimulators(compact) {
    calls.private += 1;
    const [source, target] = compact.activeCharacters;
    return {
      privateSimulations: [
        {
          characterId: source.id, characterName: source.name,
          targetCharacterId: target.id, targetCharacterName: target.name,
          tone: "试探", publicGoal: "扣住门把", privateDesire: "逼对方回答",
          defensiveMask: "只是确认", shadowImpulse: "不让对方离开", nobleImpulse: "避免惊动旁人",
          selfLie: "我没有逼她", actionCandidate: `${source.name}按住门把。`,
          falseBeliefs: ["对方沉默就是准备逃走。"], withheldFacts: [], pressure: 72, contradictionScore: 66,
        },
        {
          characterId: target.id, characterName: target.name,
          targetCharacterId: source.id, targetCharacterName: source.name,
          tone: "撤退", publicGoal: "把手收回", privateDesire: "拖延回答",
          defensiveMask: "先谈别的", shadowImpulse: "让对方先失态", nobleImpulse: "不牵连门外的人",
          selfLie: "这只是误会", actionCandidate: `${target.name}退到门边。`,
          falseBeliefs: ["对方已经决定定罪。"], withheldFacts: [], pressure: 84, contradictionScore: 74,
        },
      ],
      stages: [{ name: "PrivateAgents", provider: "test" }],
    };
  },
  async runVisibilityLayer() {
    calls.visibility += 1;
    throw new Error("fast mode must derive visibility locally");
  },
  async runSceneInteractionSimulator(_compact, simulations, visibilityLayer) {
    calls.scene += 1;
    assert.equal(visibilityLayer.perCharacter.length, 2, "the shared scene should still receive asymmetric visibility rows");
    const [source, target] = simulations;
    return {
      sceneInteraction: {
        surfaceEvent: "门把被两只手同时按住。",
        sceneText: `${source.characterName}说：“你先回答。”${target.characterName}说：“让我把话说完。”`,
        interactionBeats: [],
        agentExchanges: [{
          sourceCharacterId: source.characterId, sourceCharacterName: source.characterName,
          responseCharacterId: target.characterId, responseCharacterName: target.characterName,
          sharedObject: "门把",
          dialogueTurns: [
            { speakerId: source.characterId, speakerName: source.characterName, targetId: target.characterId, targetName: target.characterName, line: "你先回答。" },
            { speakerId: target.characterId, speakerName: target.characterName, targetId: source.characterId, targetName: source.characterName, line: "让我把话说完。" },
          ],
          eventOutcome: "两个人都没有松开门把。", relationshipDeltas: [],
        }],
        presenceChanges: [], remainingCastAftermath: [], misunderstandings: [], reversals: [], visibilityFlips: [],
        relationshipMutationIntents: [], evidenceCreated: [], rumorCreated: [], memoryDistortions: [], irreversibleTraces: [],
        subtextMatrix: [], relationshipShift: [],
      },
      stage: { name: "SharedScene", provider: "test" },
    };
  },
  async runDialoguePsychology() {
    calls.psychology += 1;
    throw new Error("fast mode must derive psychology locally");
  },
  async runDepthAuditor() {
    calls.audit += 1;
    throw new Error("fast mode must use the local audit");
  },
  async runRepairPass() {
    calls.repair += 1;
    throw new Error("fast mode must not enter repair");
  },
  async streamSceneNovel(_compact, _scene, { onDelta }) {
    calls.novel += 1;
    const novelText = "门把轻响了一声。\n\n“让我把话说完。”";
    await onDelta(novelText);
    return { novelText, stage: { name: "NovelWriter", provider: "test" } };
  },
};

try {
  const events = [];
  const draft = await playWithOpenAIPipeline(state, {
    pipelineMode: "fast",
    runners,
    onProgress: async (event) => events.push(event),
  });

  assert.deepEqual(calls, { private: 1, visibility: 0, scene: 1, psychology: 0, audit: 0, repair: 0, novel: 1 });
  assert.equal(draft.pipelineMeta.pipelineMode, "fast");
  const publicTurns = draft.sceneInteraction.agentExchanges.flatMap((exchange) => exchange.dialogueTurns || []);
  assert.equal(
    draft.dialoguePsychology.length,
    publicTurns.length,
    "fast mode should retain one psychology moment for every actual public utterance",
  );
  const gregorMoments = draft.dialoguePsychology.filter((reaction) => reaction.characterId === "char_gregor");
  const greteMoment = draft.dialoguePsychology.find((reaction) => reaction.characterId === "char_grete");
  assert.equal(gregorMoments[0]?.heardLine, "", "the opening speaker cannot hear a future response");
  assert.equal(greteMoment?.heardLine, publicTurns[0].line, "the first response must hear the prior opening turn");
  assert.equal(gregorMoments[1]?.heardLine, publicTurns[1].line, "the counter turn must hear the prior response");
  assert.ok(draft.pipelineMeta.stages.some((stage) => stage.name === "VisibilityLayer:LocalFast"));
  assert.ok(draft.pipelineMeta.stages.some((stage) => stage.name === "DepthAuditor:LocalFast"));
  assert.ok(events.some((event) => event.type === "novel_delta"));

  console.log("fastModelPipeline:test passed", { calls, psychology: draft.dialoguePsychology.length });
} finally {
  process.env = originalEnv;
}
