import assert from "node:assert/strict";

import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { characterEventEvidenceRecords } from "../src/server/simulation/characterEventReceipts.mjs";
import { createTavernV27FixtureStageRunner } from "../src/server/pipeline/tavernV27FixtureStage.mjs";
import { createTavernWorldRuntimeV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";

const XIE = "char_xyy_xiezenshi";
const LUO = "char_xyy_luozhao";

function seedState() {
  return buildPlayableWorldFromSetup({
    setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
    setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
  });
}

function loggedFixture(calls) {
  const fixture = createTavernV27FixtureStageRunner();
  return async (input, options) => {
    calls.push({ input: structuredClone(input), stage: options.stage });
    return fixture(input, options);
  };
}

const state = seedState();
const calls = [];
const instance = createTavernWorldRuntimeV27(state, {
  positions: { [XIE]: "hall", [LUO]: "hall" },
  runStage: loggedFixture(calls),
});
await instance.runtime.enqueueWake(XIE, {
  wakeId: "wake:v27-private-continuity:start",
  kind: "opportunity_window",
  evidenceIds: [],
  evidence: [],
});
const firstTurn = await instance.runtime.runNext({ characterId: XIE });
const secondTurn = await instance.runtime.runNext({ characterId: LUO });
assert.equal(firstTurn.outcome.primitive, "speak");
assert.equal(secondTurn.outcome.primitive, "speak");

const receipt = characterEventEvidenceRecords(instance.runtime.receiptLedger, LUO)
  .find((row) => row.eventId === firstTurn.outcome.eventId);
const speechEvidenceId = receipt.evidenceId;
assert.equal(receipt.status, "appraised", "the v2.7 port must project the Agent's actual noticed/appraised evidence claim");

const checkpoint = await instance.runtime.checkpoint();
const luoPrivate = checkpoint.actors.find((row) => row.characterId === LUO).privateState;
assert.ok(
  luoPrivate.memoryContext.episodes.some((row) => row.evidenceIds.includes(speechEvidenceId)),
  "Luo Zhao's firsthand speech evidence must survive in her Actor-owned memory",
);
assert.equal(luoPrivate.ecologyState.characterPsychologyV2State.lastAgentTurnId, secondTurn.agentTurnId);
assert.equal(
  Object.values(luoPrivate.pendingAttemptContinuityById || {}).some((row) => row?.sourceAgentTurnId === secondTurn.agentTurnId),
  false,
  "the private pending attempt must be cleared after its objective outcome is applied",
);
assert.equal(
  luoPrivate.ecologyState.characterPsychologyV2State.pendingObjectiveOutcome.outcomeId,
  secondTurn.outcome.outcomeId,
  "the objective outcome should remain pending for the Character Agent's later subjective appraisal",
);
assert.equal(luoPrivate.ecologyState.characterPsychologyV2State.pendingObjectiveOutcome.inferredSatisfaction, null);
assert.equal(luoPrivate.ecologyState.characterPsychologyV2State.pendingObjectiveOutcome.inferredFrustration, null);
assert.equal(luoPrivate.ecologyState.characterPsychologyV2State.pendingObjectiveOutcome.inferredRelationshipChange, null);
assert.ok(
  luoPrivate.settledInteractionEvents.some((row) => row.actionId === secondTurn.outcome.actionAttemptId),
  "the world-confirmed attempt surface must become Luo Zhao's own settled continuity",
);
assert.equal(JSON.stringify(luoPrivate).includes("worldProjection"), false);

const restartCalls = [];
const restored = createTavernWorldRuntimeV27(state, {
  positions: { [XIE]: "hall", [LUO]: "hall" },
  checkpoint,
  runStage: loggedFixture(restartCalls),
});
await restored.runtime.enqueueWake(LUO, {
  wakeId: "wake:v27-private-continuity:next",
  kind: "continuation_due",
  evidenceIds: [],
  evidence: [],
});
const nextLuoTurn = await restored.runtime.runNext({ characterId: LUO });
assert.equal(nextLuoTurn.agentTurnId, `agent-turn:${LUO}:2`);
assert.ok(
  JSON.stringify(restartCalls[0].input).includes("客官，要些什么？"),
  "the next Character Agent activation must receive the prior firsthand episode instead of starting blank",
);

console.log(JSON.stringify({
  status: "all-passed",
  checks: {
    v27PortWritesAgentReceiptClaim: true,
    firsthandMemorySurvivesCheckpoint: true,
    psychologyCarryoverSurvivesCheckpoint: true,
    settledOutcomeContinuitySurvivesCheckpoint: true,
    pendingAttemptClearsAfterSettlement: true,
    objectiveOutcomeMakesNoPrivateInference: true,
    restoredNextTurnReadsPriorMemory: true,
  },
}, null, 2));
