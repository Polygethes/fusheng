import assert from "node:assert/strict";
import { playWithOpenAIPipeline } from "../src/server/pipeline/openaiPipeline.mjs";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";


// This project ships no default model. A contract that drives the real-model
// pipeline must name the model it is pretending to call.
process.env.CHARACTER_TOWN_MODEL ||= "contract-test-model";

const originalEnv = { ...process.env };
process.env.DEEPSEEK_API_KEY = "test-key";
process.env.OPENAI_API_KEY = "";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "仙侠世界当中，正邪两派汇集的中立城市。",
  setupPeoplePrompt: "正道修士与邪派使者在法契门相遇。",
});
state.ui.timeGrain = "scene";
state.ui.engineMode = "openai";
state.ui.activeCharacterIds = state.characters.slice(0, 2).map((character) => character.id);
state.ui.selectedLocationId = state.locations[0].id;
const events = [];

const runners = {
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
          publicGoal: "扣住契牌",
          privateDesire: "逼对方写名",
          defensiveMask: "按城规办事",
          shadowImpulse: "夺回解释权",
          nobleImpulse: "避免动剑",
          selfLie: "我没有私仇",
          actionCandidate: `${source.name}把契牌扣在铜盘边。`,
          whatTheyWantFromOthers: "对方回应",
          whatTheyRefuseToAdmit: "害怕证词消失",
          riskTheyWillCreate: "契牌无法离场",
          contradictionScore: 60,
          pressure: 62,
        },
        {
          characterId: target.id,
          characterName: target.name,
          targetCharacterId: source.id,
          targetCharacterName: source.name,
          tone: "伪装",
          publicGoal: "收回魔印",
          privateDesire: "换走证物",
          defensiveMask: "只谈价码",
          shadowImpulse: "让对方先承认",
          nobleImpulse: "保住证人",
          selfLie: "这只是交易",
          actionCandidate: `${target.name}把魔印压回铜盘。`,
          whatTheyWantFromOthers: "对方让价",
          whatTheyRefuseToAdmit: "害怕旧案开口",
          riskTheyWillCreate: "魔印成为新证据",
          contradictionScore: 66,
          pressure: 68,
        },
      ],
      stages: [{ name: "FakePrivate", provider: "test" }],
    };
  },
  async runVisibilityLayer(compact, simulations) {
    return {
      visibilityLayer: {
        visibleFacts: ["契牌与魔印都在铜盘边。"],
        hiddenFacts: [],
        perCharacter: simulations.map((simulation) => ({
          characterId: simulation.characterId,
          knownFacts: ["对方没有离开。"],
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
        surfaceEvent: "契牌和魔印同时停在铜盘边。",
        sceneText: `${source.characterName}扣住契牌。${target.characterName}说：“先把契牌还我。”`,
        interactionBeats: [{
          actorId: source.characterId,
          actorName: source.characterName,
          targetId: target.characterId,
          targetName: target.characterName,
          beat: `${source.characterName}把契牌扣在铜盘边。`,
        }],
        agentExchanges: [{
          sourceCharacterId: source.characterId,
          sourceCharacterName: source.characterName,
          responseCharacterId: target.characterId,
          responseCharacterName: target.characterName,
          sharedObject: "契牌",
          dialogueTurns: [
            { speakerId: source.characterId, speakerName: source.characterName, targetId: target.characterId, targetName: target.characterName, line: "名字写明白再说。", turnRole: "claim" },
            { speakerId: target.characterId, speakerName: target.characterName, targetId: source.characterId, targetName: source.characterName, line: "先把契牌还我。", turnRole: "response", respondsTo: "名字写明白再说。" },
          ],
          eventOutcome: "契牌没有离开铜盘，魔印也没有被收回。",
          relationshipDeltas: [],
          generatedFrom: "test",
        }],
        misunderstandings: [],
        reversals: [],
        visibilityFlips: [],
        relationshipMutationIntents: [],
        evidenceCreated: [],
        rumorCreated: [],
        memoryDistortions: [],
        irreversibleTraces: ["铜盘留下两道压痕。"],
        subtextMatrix: [],
        relationshipShift: [],
      },
      stage: { name: "FakeScene", provider: "test" },
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
    throw new Error("repair should not run");
  },
  async runDialoguePsychology(_compact, simulations, sceneInteraction, { onUpdate }) {
    const lastLine = sceneInteraction.agentExchanges[0].dialogueTurns.at(-1);
    const reactions = simulations.map((simulation) => ({
      characterId: simulation.characterId,
      characterName: simulation.characterName,
      heardLine: lastLine.line,
      speakerName: lastLine.speakerName,
      interpretation: "这句话正在改变下一步。",
      feeling: "戒备里夹着动摇",
      bodyResponse: "手指停了一瞬。",
      privateThought: "他究竟知道多少？",
      selfLie: "我只是在等。",
      nextImpulse: "逼对方说出名字。",
    }));
    await Promise.all(reactions.map((reaction) => onUpdate(reaction)));
    return { reactions, stages: [{ name: "FakePsychology", provider: "test" }] };
  },
  async streamSceneNovel(_compact, _sceneInteraction, { onDelta }) {
    await onDelta("铜盘上的水光晃了一下。\n\n");
    await onDelta("“名字写明白再说。”");
    return {
      novelText: "铜盘上的水光晃了一下。\n\n“名字写明白再说。”",
      stage: { name: "FakeNovel", provider: "test" },
    };
  },
};

try {
  const draft = await playWithOpenAIPipeline(state, {
    runners,
    onProgress: async (event) => { events.push(event); },
  });
  const types = events.map((event) => event.type);
  assert.equal(types[0], "scene_started");
  assert.ok(types.indexOf("shared_space") < types.indexOf("novel_started"), "the shared scene must exist before prose starts");
  assert.equal(types.filter((type) => type === "novel_delta").length, 2, "model prose deltas should be forwarded immediately");
  assert.equal(types.filter((type) => type === "psychology_update").length, 2, "each private agent reaction should reach psychology");
  assert.ok(types.indexOf("novel_complete") < types.indexOf("scene_complete"), "the manuscript should finish before the scene closes");
  assert.ok(!types.some((type) => ["action", "dialogue", "exchange_outcome"].includes(type)), "legacy public rows must not create a duplicate visible channel");
  assert.equal(draft.novelText, "铜盘上的水光晃了一下。\n\n“名字写明白再说。”");
  assert.equal(draft.dialoguePsychology.length, 2);
  assert.ok(draft.id);
  console.log("modelPipelineProgressEvents:test passed", { types });
} finally {
  process.env = originalEnv;
}
