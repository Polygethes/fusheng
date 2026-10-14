import assert from "node:assert/strict";
import { playModelPeriodWithRunners } from "../src/server/pipeline/openaiPipeline.mjs";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
state.ui.timeGrain = "scene";
state.ui.engineMode = "openai";

const startedAt = Date.now();
const draft = await playModelPeriodWithRunners(state, {
  pipelineMode: "live",
  runners: {
    async runBackgroundSlot(input) {
      const dialogue = (input.canonicalDialogueTurns || [])
        .map((turn) => `${turn.speakerName}对${turn.targetName}说：“${turn.line}”`)
        .join(" ");
      return {
        slotText: `${input.groundingActions.join(" ")} ${dialogue}`.trim(),
        carryFacts: [],
        dialogueTurns: input.canonicalDialogueTurns || [],
        stage: { name: "BackgroundSlot:清晨:AcceptanceStub", provider: "acceptance-stub", elapsedMs: 0 },
      };
    },
  },
});

const turns = draft.periodSimulation.ticks.flatMap((tick) => tick.canonicalDialogueTurns || []);
const decisionStages = (draft.pipelineMeta?.stages || []).filter((stage) => String(stage.name || "").startsWith("TavernAgentDecision:"));
assert.ok(decisionStages.length >= 2, "an ordinary opening scene must call isolated real Agents without an injected event thread");
assert.ok(decisionStages.every((stage) => stage.provider === "openai"), "all activated Agents must reach the configured remote model");
assert.ok(turns.length >= 1, "a waiting assigned visitor must produce at least one accepted canonical contact turn");
assert.ok(turns.some((turn) => turn.visitId && ["waiting-guest", "addressed-turn"].includes(turn.interactionKind)), "the first contact must be attributable to a concrete visit obligation");
assert.ok((draft.updateBundle?.relationships || []).some((shift) => turns.some((turn) => shift.finalTurn === turn.line && shift.visitId === turn.visitId)), "the visible visit turn must cause attributable relationship progress");

console.log("realTavernUnpromptedScene:smoke passed", {
  model: draft.model,
  elapsedMs: Date.now() - startedAt,
  dialogue: turns.map((turn) => `${turn.speakerName}->${turn.targetName}:${turn.line}`),
});
