import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { playModelPeriodWithRunners } from "../src/server/pipeline/openaiPipeline.mjs";


// This project ships no default model. A contract that drives the real-model
// pipeline must name the model it is pretending to call.
process.env.CHARACTER_TOWN_MODEL ||= "contract-test-model";

const state = structuredClone(initialState);
const originalRandom = Math.random;
Math.random = () => 0.18;
state.ui.timeGrain = "day";
state.ui.focusMode = "ambient";
state.ui.selectedLocationId = state.locations.at(-1).id;
state.ui.activeCharacterIds = state.characters.slice(0, 3).map((character) => character.id);

const calls = { private: 0, scene: 0, novel: 0, psychology: 0, visibility: 0, audit: 0, repair: 0 };
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
          tone: index === 1 ? "撤退" : "试探", publicGoal: "守住当前路线", privateDesire: "逼对方给出选择",
          defensiveMask: "只是核对", shadowImpulse: "让对方先承担风险", nobleImpulse: "避免浪费资源",
          selfLie: "我只在乎路线", actionCandidate: `${character.name}把路线图压在石面上。`,
          falseBeliefs: ["对方准备隐瞒路线。"], withheldFacts: [], pressure: 60 + index * 12, contradictionScore: 64,
        };
      }),
      stages: [{ name: "BalancedPrivate", provider: "test" }],
    };
  },
  async runVisibilityLayer() { calls.visibility += 1; throw new Error("balanced mode should derive visibility locally"); },
  async runSceneInteractionSimulator(_compact, simulations) {
    calls.scene += 1;
    const [source, target] = simulations;
    return {
      sceneInteraction: {
        surfaceEvent: "路线图的一角压住了旧水位刻痕。", sceneText: "", interactionBeats: [],
        agentExchanges: [{
          sourceCharacterId: source.characterId, sourceCharacterName: source.characterName,
          responseCharacterId: target.characterId, responseCharacterName: target.characterName,
          sharedObject: "路线图",
          dialogueTurns: [
            { speakerId: source.characterId, speakerName: source.characterName, targetId: target.characterId, targetName: target.characterName, line: "日落前选一条路。" },
            { speakerId: target.characterId, speakerName: target.characterName, targetId: source.characterId, targetName: source.characterName, line: "先把缺水的那一段标出来。" },
            { speakerId: source.characterId, speakerName: source.characterName, targetId: target.characterId, targetName: target.characterName, line: "你标，我去看出口。" },
          ], eventOutcome: "路线图留在刻痕旁。", relationshipDeltas: [],
        }],
        presenceChanges: [], remainingCastAftermath: [], misunderstandings: [], reversals: [], visibilityFlips: [],
        relationshipMutationIntents: [], evidenceCreated: [], rumorCreated: [], memoryDistortions: [], irreversibleTraces: [], subtextMatrix: [], relationshipShift: [],
      },
      stage: { name: "BalancedScene", provider: "test" },
    };
  },
  async runDialoguePsychology(_compact, simulations, scene, { onUpdate }) {
    calls.psychology += 1;
    assert.equal(simulations.length, 1, "balanced mode should spend remote psychology on only the highest-pressure focus character");
    const simulation = simulations[0];
    const turn = scene.agentExchanges[0].dialogueTurns.find((item) => item.speakerId !== simulation.characterId);
    const reaction = {
      characterId: simulation.characterId, characterName: simulation.characterName,
      heardLine: turn.line, speakerName: turn.speakerName,
      interpretation: "对方在逼自己承担路线风险。", feeling: "恼怒里夹着一点松动。",
      bodyResponse: "手指压紧了路线图。", privateThought: "不能让他先决定。", selfLie: "我只是核对。", nextImpulse: "先标出缺水路段。",
    };
    await onUpdate(reaction);
    return { reactions: [reaction], stages: [{ name: "BalancedPsychology", provider: "test" }], failures: [] };
  },
  async runDepthAuditor() { calls.audit += 1; throw new Error("balanced mode should keep routine audit local"); },
  async runRepairPass() { calls.repair += 1; throw new Error("balanced mode should repair only after a failed deterministic guard"); },
  async streamSceneNovel(_compact, _scene, { onDelta }) {
    calls.novel += 1;
    const text = "路线图擦过石面。\n\n“先把缺水的那一段标出来。”";
    await onDelta(text);
    return { novelText: text, stage: { name: "BalancedNovel", provider: "test" } };
  },
};

const draft = await playModelPeriodWithRunners(state, { pipelineMode: "balanced", runners });
const ticks = draft.periodSimulation.ticks;
const backgrounds = ticks.filter((tick) => tick.executionMode === "local_background");
const backgroundTexts = backgrounds.map((tick) => tick.novelText);
const participantSignatures = backgrounds.map((tick) => [...tick.participantIds].sort().join("|"));
const actionKeys = backgroundTexts
  .map((text) => text.split("。")[1] || "")
  .map((action) => state.characters.reduce((value, character) => value.replaceAll(character.name, "人物"), action))
  .map((action) => action.split(/[，,]/)[0].replace(/\s+/g, "").trim())
  .filter(Boolean);

assert.deepEqual(calls, { private: 1, scene: 1, novel: 1, psychology: 1, visibility: 0, audit: 0, repair: 0 });
assert.equal(draft.pipelineMeta.pipelineMode, "balanced");
assert.equal(ticks[0].locationId, state.locations[0].id, "balanced ambient mode must ignore a stale selected location");
assert.equal(backgrounds.length, 4);
assert.ok(backgrounds.every((tick) => tick.pipelineMeta?.pipelineMode === "balanced"), "balanced background ticks must report balanced mode");
assert.ok(backgroundTexts.every((text) => text && !/围着(?:凭证|氧气牌|\S+)停住/.test(text)), backgroundTexts.join("\n"));
assert.ok(backgroundTexts.every((text) => !/到一半/.test(text)), backgroundTexts.join("\n"));
for (const tick of backgrounds) {
  const location = state.locations.find((item) => item.id === tick.locationId);
  assert.ok(tick.novelText.includes(location?.name || ""), `background must identify its real location: ${tick.novelText}`);
  assert.ok(tick.agentOutputs.some((output) => tick.novelText.includes(state.characters.find((character) => character.id === output.characterId)?.name || "")), `background must report an agent who actually acted: ${tick.novelText}`);
  for (const possibility of location?.likelyEvents || []) {
    const causedByAgent = tick.agentOutputs.some((output) => String(output.visibleAction || "").includes(possibility));
    if (!causedByAgent) assert.ok(!tick.novelText.includes(possibility), `background must not promote an uncaused possible event into fact: ${tick.novelText}`);
  }
}
assert.equal(new Set(backgroundTexts).size, backgroundTexts.length, "every low-detail period should expose a distinct occurrence");
assert.equal(new Set(actionKeys).size, actionKeys.length, "low-detail periods must not repeat the same action skeleton");
for (const text of backgroundTexts) {
  for (const character of state.characters) {
    assert.ok((text.match(new RegExp(character.name, "g")) || []).length <= 1, `background prose should not repeat a character name inside one short event: ${text}`);
  }
}
for (let index = 1; index < participantSignatures.length; index += 1) {
  assert.notEqual(participantSignatures[index], participantSignatures[index - 1], "adjacent low-detail periods must not reuse the whole cast");
}

Math.random = originalRandom;
console.log("balancedPeriodMode:test passed", { calls, backgroundTexts, participantSignatures });
