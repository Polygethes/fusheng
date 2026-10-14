import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { playModelPeriodWithRunners } from "../src/server/pipeline/openaiPipeline.mjs";

const state = structuredClone(initialState);
const originalRandom = Math.random;
Math.random = () => 0.18;
state.ui.timeGrain = "day";
state.ui.focusMode = "ambient";
state.ui.selectedLocationId = state.locations.at(-1).id;
state.ui.activeCharacterIds = state.characters.slice(0, 3).map((character) => character.id);

const calls = { private: 0, scene: 0, novel: 0, psychology: 0, visibility: 0, audit: 0, repair: 0 };
let turnCalls = 0;
let scenePromptSims = null;
const turnScript = [
  { speech: "日落前选一条路。", action: "把路线图压在石面上", moveIntent: "stay", innerNote: "别让他拖" },
  { speech: "先把缺水的那一段标出来。", action: "", moveIntent: "stay", innerNote: "" },
  { speech: "你们标，我去看出口。", action: "起身", moveIntent: "stay", innerNote: "" },
  { speech: "", action: "", moveIntent: "pass", innerNote: "" },
  { speech: "", action: "", moveIntent: "pass", innerNote: "" },
  { speech: "", action: "", moveIntent: "pass", innerNote: "" },
];

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
      stages: [{ name: "LivePrivate", provider: "test" }],
    };
  },
  async runVisibilityLayer() { calls.visibility += 1; throw new Error("live mode should derive visibility locally"); },
  async runSceneInteractionSimulator(_compact, simulations) {
    calls.scene += 1;
    scenePromptSims = simulations;
    const [source, target] = simulations;
    return {
      sceneInteraction: {
        surfaceEvent: "路线图的一角压住了旧水位刻痕。", sceneText: "", interactionBeats: [],
        agentExchanges: [], presenceChanges: [], remainingCastAftermath: [], misunderstandings: [], reversals: [], visibilityFlips: [],
        relationshipMutationIntents: [], evidenceCreated: [], rumorCreated: [], memoryDistortions: [], irreversibleTraces: [], subtextMatrix: [], relationshipShift: [],
        sourceCharacterId: source.characterId, targetCharacterId: target.characterId,
      },
      stage: { name: "LiveScene", provider: "test" },
    };
  },
  async runDialoguePsychology(_compact, simulations) {
    calls.psychology += 1;
    assert.equal(simulations.length, 1, "live mode should keep selective single-character psychology");
    return { reactions: [], stages: [{ name: "LivePsychology", provider: "test" }], failures: [] };
  },
  async runDepthAuditor() { calls.audit += 1; throw new Error("live mode should keep routine audit local"); },
  async runRepairPass() { calls.repair += 1; throw new Error("live mode should not enter repair"); },
  async streamSceneNovel(_compact, _scene, { onDelta }) {
    calls.novel += 1;
    const text = "路线图擦过石面。\n\n“先把缺水的那一段标出来。”";
    await onDelta(text);
    return { novelText: text, stage: { name: "LiveNovel", provider: "test" } };
  },
};

const draft = await playModelPeriodWithRunners(state, {
  pipelineMode: "live",
  runners,
  liveTurnOptions: {
    runTurn: async () => {
      const parsed = turnScript[Math.min(turnCalls, turnScript.length - 1)];
      turnCalls += 1;
      return { parsed, meta: { model: "fake-live" } };
    },
  },
});

const ticks = draft.periodSimulation.ticks;
const focused = ticks.filter((tick) => tick.executionMode === "remote_focus");
const backgrounds = ticks.filter((tick) => tick.executionMode === "local_background");

// 1. 混合结构与 balanced 相同：1 个远程焦点 + 4 个本地背景
assert.equal(focused.length, 1, "live day must keep exactly one remote focus scene");
assert.equal(backgrounds.length, 4);
// 2. 焦点场景走了回合循环
assert.ok(turnCalls >= 3, `focus scene must run the live turn loop, got ${turnCalls} turn calls`);
assert.equal(focused[0].pipelineMeta.pipelineMode, "live");
assert.ok(focused[0].pipelineMeta.stages.some((stage) => stage.name === "AgentDialogue:LiveTurnLoop"));
// 3. 模型台词逐字进入场景模拟器
const spokenLines = (scenePromptSims || []).flatMap((sim) => (sim.dialogueExchangeTurns || []).map((turn) => turn.line));
assert.ok(spokenLines.includes("日落前选一条路。"), "model turn lines must reach the scene simulator verbatim");
// 4. 远程调用预算与 balanced 相同（背景不额外花钱）
assert.deepEqual(calls, { private: 1, scene: 1, novel: 1, psychology: 1, visibility: 0, audit: 0, repair: 0 });
// 5. 背景 tick 不退化回模板句
const backgroundTexts = backgrounds.map((tick) => tick.novelText);
assert.ok(backgroundTexts.every((text) => text && !/围着\S+停住/.test(text)), backgroundTexts.join("\n"));
// 6. period 元数据标注 live
assert.equal(draft.pipelineMeta.pipelineMode, "live");

Math.random = originalRandom;
console.log("livePeriodFocusScene:test passed", { turnCalls, calls });
