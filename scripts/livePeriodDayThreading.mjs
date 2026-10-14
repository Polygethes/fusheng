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
state.ui.activeCharacterIds = state.characters.slice(0, 3).map((character) => character.id);

let backgroundCalls = 0;
const backgroundInputs = [];
let turnPrompts = [];
let sceneCompact = null;
let turnCalls = 0;

const turnScript = [
  { speech: "日落前选一条路。", action: "把路线图压在石面上", moveIntent: "stay", innerNote: "" },
  { speech: "先把缺水的那一段标出来。", action: "", moveIntent: "stay", innerNote: "" },
  { speech: "", action: "", moveIntent: "pass", innerNote: "" },
  { speech: "", action: "", moveIntent: "pass", innerNote: "" },
  { speech: "", action: "", moveIntent: "pass", innerNote: "" },
];

const runners = {
  async runPrivateSimulators(compact) {
    const characters = compact.activeCharacters.slice(0, 3);
    return {
      privateSimulations: characters.map((character, index) => {
        const target = characters[(index + 1) % characters.length] || character;
        return {
          characterId: character.id, characterName: character.name,
          targetCharacterId: target.id, targetCharacterName: target.name,
          tone: "试探", publicGoal: "守住当前路线", privateDesire: "逼对方给出选择",
          defensiveMask: "只是核对", selfLie: "我只在乎路线", actionCandidate: `${character.name}把路线图压在石面上。`,
          falseBeliefs: [], withheldFacts: [], pressure: 60 + index * 12, contradictionScore: 64,
        };
      }),
      stages: [{ name: "ThreadPrivate", provider: "test" }],
    };
  },
  async runBackgroundSlot({ slot, dayLog }) {
    backgroundCalls += 1;
    backgroundInputs.push({ slotLabel: slot.label, dayLog: [...dayLog] });
    return {
      slotText: `SLOTTEXT_${slot.label}：人们各自做着自己的事。`,
      carryFacts: [`CARRY_${slot.label}_留下了痕迹`],
      characterActivities: [],
      stage: { name: `BackgroundSlot:${slot.label}`, provider: "test", model: "fake-bg", elapsedMs: 0 },
    };
  },
  async runSceneInteractionSimulator(compact, simulations) {
    sceneCompact = compact;
    const [source, target] = simulations;
    return {
      sceneInteraction: {
        surfaceEvent: "FOCUS_路线图压住了旧刻痕。", sceneText: "", interactionBeats: [],
        agentExchanges: [], presenceChanges: [], remainingCastAftermath: [], misunderstandings: [], reversals: [], visibilityFlips: [],
        relationshipMutationIntents: [], evidenceCreated: [], rumorCreated: [], memoryDistortions: [], irreversibleTraces: [], subtextMatrix: [], relationshipShift: [],
        sourceCharacterId: source.characterId, targetCharacterId: target.characterId,
      },
      stage: { name: "ThreadScene", provider: "test" },
    };
  },
  async runDialoguePsychology() {
    return { reactions: [], stages: [{ name: "ThreadPsych", provider: "test" }], failures: [] };
  },
  async streamSceneNovel(_compact, _scene, { onDelta }) {
    const text = "路线图擦过石面。";
    await onDelta(text);
    return { novelText: text, stage: { name: "ThreadNovel", provider: "test" } };
  },
};

const draft = await playModelPeriodWithRunners(state, {
  pipelineMode: "live",
  runners,
  liveTurnOptions: {
    runTurn: async ({ user }) => {
      turnPrompts.push(user);
      const parsed = turnScript[Math.min(turnCalls, turnScript.length - 1)];
      turnCalls += 1;
      return { parsed, meta: { model: "fake-live" } };
    },
  },
});

const ticks = draft.periodSimulation.ticks;
const backgrounds = ticks.filter((tick) => tick.executionMode === "local_background");
const focusIndex = ticks.findIndex((tick) => tick.executionMode === "remote_focus");

// 1. 每个背景时段一次模型调用
assert.equal(backgroundCalls, 4, `背景时段必须逐段调用模型，实际 ${backgroundCalls}`);
// 2. 背景 tick 的正文使用模型产出
assert.ok(backgrounds.every((tick) => tick.novelText.startsWith("SLOTTEXT_")), backgrounds.map((tick) => tick.novelText).join("\n"));
// 3. dayLog 按时段累积：第二个背景调用能看到第一个的 carryFact
assert.ok(backgroundInputs[1].dayLog.some((fact) => fact.includes("CARRY_")), JSON.stringify(backgroundInputs[1]));
// 4. 焦点场景（回合 prompt 与场景模拟器）能看到之前时段的 carryFacts
assert.ok(turnPrompts[0].includes("CARRY_"), "焦点场景的回合 prompt 必须包含今天已发生的事");
assert.ok(Array.isArray(sceneCompact.periodDayLog) && sceneCompact.periodDayLog.some((fact) => fact.includes("CARRY_")), "场景模拟器必须收到 periodDayLog");
// 5. 焦点场景之后的背景时段能看到焦点结果
const afterFocus = backgroundInputs.slice(focusIndex);
assert.ok(afterFocus.length >= 1 && afterFocus.every((input) => input.dayLog.some((fact) => fact.includes("FOCUS_"))), JSON.stringify(afterFocus));

// 6. 背景模型失败时回退本地文本，不炸整天
Math.random = () => 0.18;
let fallbackDraft = await playModelPeriodWithRunners(structuredClone(state), {
  pipelineMode: "live",
  runners: {
    ...runners,
    async runBackgroundSlot() { throw new Error("background model down"); },
  },
  liveTurnOptions: {
    runTurn: async () => ({ parsed: { speech: "", action: "", moveIntent: "pass", innerNote: "" }, meta: { model: "fake-live" } }),
  },
});
const fallbackBackgrounds = fallbackDraft.periodSimulation.ticks.filter((tick) => tick.executionMode === "local_background");
assert.ok(fallbackBackgrounds.every((tick) => tick.novelText && !tick.novelText.startsWith("SLOTTEXT_")), "模型失败必须回退到本地背景文本");

Math.random = originalRandom;
console.log("livePeriodDayThreading:test passed", { backgroundCalls, focusIndex });
