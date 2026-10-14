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

const turnScript = [
  { speech: "你打算什么时候说？", action: "指着水位线", moveIntent: "stay", innerNote: "INNER_钉住他" },
  { speech: "等勘探队回来。", action: "", moveIntent: "stay", innerNote: "" },
  { speech: "", action: "", moveIntent: "pass", innerNote: "" },
  { speech: "", action: "", moveIntent: "pass", innerNote: "" },
];
let turnCalls = 0;
const turnPrompts = [];
const events = [];
let scenePromptSims = null;
const calls = { visibility: 0, audit: 0, repair: 0, psychology: 0 };

const runners = {
  async runPrivateSimulators(compact) {
    const [source, target] = compact.activeCharacters;
    return {
      privateSimulations: [
        {
          characterId: source.id, characterName: source.name,
          targetCharacterId: target.id, targetCharacterName: target.name,
          tone: "试探", publicGoal: "逼出回答", privateDesire: `PRIVATE_${source.id}`,
          defensiveMask: "只是确认", selfLie: "我没有逼她",
          actionCandidate: `${source.name}按住门把。`, falseBeliefs: [], withheldFacts: [],
          pressure: 72, contradictionScore: 66,
        },
        {
          characterId: target.id, characterName: target.name,
          targetCharacterId: source.id, targetCharacterName: source.name,
          tone: "撤退", publicGoal: "拖延回答", privateDesire: `PRIVATE_${target.id}`,
          defensiveMask: "先谈别的", selfLie: "这只是误会",
          actionCandidate: `${target.name}退到门边。`, falseBeliefs: [], withheldFacts: [],
          pressure: 84, contradictionScore: 74,
        },
      ],
      stages: [{ name: "PrivateAgents", provider: "test" }],
    };
  },
  async runVisibilityLayer() {
    calls.visibility += 1;
    throw new Error("live mode must derive visibility locally");
  },
  async runSceneInteractionSimulator(_compact, simulations) {
    scenePromptSims = simulations;
    const [source, target] = simulations;
    return {
      sceneInteraction: {
        surfaceEvent: "两个人在门边对峙。",
        sceneText: "场景正文。",
        interactionBeats: [], agentExchanges: [], presenceChanges: [], remainingCastAftermath: [],
        misunderstandings: [], reversals: [], visibilityFlips: [], relationshipMutationIntents: [],
        evidenceCreated: [], rumorCreated: [], memoryDistortions: [], irreversibleTraces: [],
        subtextMatrix: [], relationshipShift: [],
        sourceCharacterId: source.characterId, targetCharacterId: target.characterId,
      },
      stage: { name: "SharedScene", provider: "test" },
    };
  },
  async runDialoguePsychology(_compact, sims) {
    calls.psychology += 1;
    assert.equal(sims.length, 1, "live 心理应是选择性单角色（balanced 行为）");
    return { reactions: [], stages: [{ name: "SelectivePsychology", provider: "test" }] };
  },
  async runDepthAuditor() {
    calls.audit += 1;
    throw new Error("live mode must use the local audit");
  },
  async runRepairPass() {
    calls.repair += 1;
    throw new Error("live mode must not enter repair");
  },
  async streamSceneNovel(_compact, _scene, { onDelta }) {
    const novelText = "门把轻响了一声。";
    await onDelta(novelText);
    return { novelText, stage: { name: "NovelWriter", provider: "test" } };
  },
};

try {
  const draft = await playWithOpenAIPipeline(state, {
    pipelineMode: "live",
    runners,
    onProgress: async (event) => events.push(event),
    liveTurnOptions: {
      runTurn: async ({ user }) => {
        turnPrompts.push(user);
        const parsed = turnScript[Math.min(turnCalls, turnScript.length - 1)];
        turnCalls += 1;
        return { parsed, meta: { model: "fake-live" } };
      },
    },
  });

  // 1. 回合循环确实被逐轮驱动
  assert.ok(turnCalls >= 3, `live 模式必须逐回合调用模型，实际 ${turnCalls}`);
  // 2. 隔离：每个回合 prompt 只含本人的私人字段
  assert.ok(turnPrompts[0].includes("PRIVATE_"), "回合 prompt 必须含本人私人状态");
  for (const prompt of turnPrompts) {
    const hits = (prompt.match(/PRIVATE_/g) || []).length;
    assert.ok(hits <= 1, `回合 prompt 泄漏了其他角色的私人状态（${hits} 处）`);
  }
  // 3. 模型台词逐字进入场景模拟器收到的 dialogueExchangeTurns
  assert.ok(scenePromptSims, "场景模拟器必须被调用");
  const spokenLines = scenePromptSims.flatMap((sim) => (sim.dialogueExchangeTurns || []).map((turn) => turn.line));
  assert.ok(spokenLines.includes("你打算什么时候说？"), "模型台词必须逐字进入场景模拟器");
  assert.ok(spokenLines.includes("等勘探队回来。"));
  // 4. 流式回合事件存在且不含 innerNote
  const turnEvents = events.filter((event) => event.type === "agent_turn");
  assert.ok(turnEvents.length >= 2, "必须流式发出 agent_turn 事件");
  assert.ok(!JSON.stringify(turnEvents).includes("INNER_"), "innerNote 绝不进入流事件");
  // 5. pipelineMeta 标注 live 且包含回合阶段
  assert.equal(draft.pipelineMeta.pipelineMode, "live");
  assert.ok(draft.pipelineMeta.stages.some((stage) => stage.name === "AgentDialogue:LiveTurnLoop"));
  assert.match(draft.pipelineMeta.pipeline, /LiveTurnLoop/);
  // 6. 远程可见性/审计/修复未被调用（本地派生）
  assert.equal(calls.visibility, 0);
  assert.equal(calls.audit, 0);
  assert.equal(calls.repair, 0);
  assert.equal(calls.psychology, 1, "选择性心理恰好一次");

  console.log("livePipelineMode:test passed", { turnCalls, turnEvents: turnEvents.length });
} finally {
  process.env.DEEPSEEK_API_KEY = originalEnv.DEEPSEEK_API_KEY ?? "";
  process.env.OPENAI_API_KEY = originalEnv.OPENAI_API_KEY ?? "";
}
