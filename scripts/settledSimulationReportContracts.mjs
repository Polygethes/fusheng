import assert from "node:assert/strict";
import { compactSettledTurnRecord, renderSettledSimulationReport, summarizeSettledSimulation } from "../src/server/simulation/settledSimulationReport.mjs";

const failed = compactSettledTurnRecord({ agentTurnId: "turn:1", characterId: "a", privateResult: { turnKind: "action" },
  actionAttempt: { primitive: "work", payload: { utterance: "伪造未发出的对白", visibleAction: "第五斧完成，茶杯满了。" } },
  outcome: { primitive: "work", status: "failed", resolvedEffects: [], failedEffects: [{ code: "TOOL_NOT_HELD" }] },
}, { index: 1 });
assert.equal(failed.speech, "");
assert.equal(failed.visibleAction, "");
const spoken = compactSettledTurnRecord({ agentTurnId: "turn:2", characterId: "a", privateResult: { turnKind: "action" },
  actionAttempt: { primitive: "speak" }, outcome: { primitive: "speak", status: "success", resolvedEffects: [{ kind: "speech_emitted" }],
    committedFacts: [{ kind: "utterance_emitted", utterance: "柴都劈完了。" }] },
}, { index: 2 });
const checkpoint = { actors: [{ characterId: "a", executionControl: { status: "active" } }], coordinator: {
  worldState: { objects: { tavern_resource_unprocessed_firewood: { state: { unprocessedBundles: 8 } }, tavern_resource_sheltered_firewood: { state: { processedBundles: 0 } } } },
  journal: { events: [] },
} };
const summary = summarizeSettledSimulation({ checkpoint, turns: [failed, spoken], requestedTurns: 2, calls: [{ accepted: false }, { accepted: true }] });
assert.equal(summary.stopReason, "turn_limit_reached");
assert.equal(summary.scenarioComplete, null, "the turn limit cannot declare an unevaluated scenario complete or incomplete");
assert.equal(summary.scenarioCompletionEvaluated, false);
assert.equal(summary.counts.completedWorkSteps, 0);
assert.equal(summary.completedWorkStepsScope, "checkpoint_world_history");
assert.equal(summary.objectiveState.firewood.processedBundles, 0, "claims in actual speech do not change task completion");
assert.equal(summary.counts.failed, 1);
assert.equal(summary.counts.rejectedCalls, 1);
const report = renderSettledSimulationReport([failed, spoken], { kind: "fixture" }, summary);
assert.ok(report.includes("柴都劈完了。"));
assert.ok(!report.includes("伪造未发出的对白") && !report.includes("第五斧"));
assert.ok(report.includes("未加工 8 束，成柴 0 束"));
console.log("Settled reports distinguish speech, rejected drafts, world outcomes, cumulative work and unevaluated scenario completion.");
