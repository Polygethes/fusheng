import assert from "node:assert/strict";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { createTavernWorldRuntimeV27, projectTavernV27TurnForObserver } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { createTavernV27FixtureStageRunner } from "../src/server/pipeline/tavernV27FixtureStage.mjs";
import { tavernCharacterAgentV2OutputSchemaForStage } from "../src/server/pipeline/tavernCharacterAgentV2.mjs";
import { CHARACTER_PSYCHOLOGY_LEAKAGE_CHANNELS } from "../src/server/simulation/characterPsychologyTools.mjs";
import { resolveV27CharacterAgentCallMode } from "../src/server/v27CharacterModelProvider.mjs";

assert.equal(resolveV27CharacterAgentCallMode({ GTOWN_V27_CHARACTER_AGENT_CALL_MODE: "three-call" }), "three-call");
assert.equal(resolveV27CharacterAgentCallMode({}), "three-call", "new runs must express against the actual post-regulation snapshot");
assert.throws(() => resolveV27CharacterAgentCallMode({ GTOWN_V27_CHARACTER_AGENT_CALL_MODE: "two-call" }),
  { code: "GTOWN_V27_LEGACY_CALL_MODE_REQUIRES_DIAGNOSTIC_OPT_IN" });
assert.equal(resolveV27CharacterAgentCallMode({ GTOWN_V27_CHARACTER_AGENT_CALL_MODE: "two-call", GTOWN_V27_DIAGNOSTIC_LEGACY_CALL_MODE: "1" }), "two-call");

const seed = buildPlayableWorldFromSetup({ setupWorldPrompt: "逍遥游，望梯酒馆", setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚" });
const clone = structuredClone;
async function run(callMode, runStage, onStageRejected, repairBudget = 1) {
  const instance = createTavernWorldRuntimeV27(seed, {
    characterIds: ["char_xyy_xiezenshi", "char_xyy_luozhao"],
    worldId: "world:test:three-call", characterAgentCallMode: callMode,
    maxStageProtocolRepairs: repairBudget, runStage, onStageRejected,
  });
  try {
    await instance.runtime.enqueueWake("char_xyy_xiezenshi", { wakeId: "wake:three-call", kind: "opportunity_window", evidence: [], evidenceIds: [] });
    const turn = await instance.runtime.runNext();
    return { observation: projectTavernV27TurnForObserver(turn, seed.characters), events: instance.coordinator.journal.events.length };
  } finally { for (const actor of instance.runtime.actors.values()) await actor.close(); }
}
const fixture = createTavernV27FixtureStageRunner();
const reference = new Map(), originalInputs = new Map();
const baseline = await run("standard", async (input, options) => {
  const output = await fixture(input, options);
  reference.set(options.stage, clone(output)); originalInputs.set(options.stage, clone(input));
  return output;
});
const commitInput = originalInputs.get("agent_turn_commit");
const residue = commitInput.expressionMoment.innerContinuity.affectiveResidue;
const schema = tavernCharacterAgentV2OutputSchemaForStage(commitInput);
const trace = schema.properties.privateExpressionTrace.properties.affectiveInfluence.properties;
const material = residue.liveEmotions.filter(row => ["low", "medium", "high", "very_high"].includes(row.intensity)).map(row => row.emotionId);
assert.deepEqual(trace.sourceEmotionIds.items.enum, material.length ? material : undefined,
  "structured output must not offer sub-threshold emotions the validator rejects");
assert.deepEqual(trace.primaryChannelId.enum, material.length ? residue.possibleLeakageChannels.map(row => row.channelId) : [""],
  "structured output must offer only the actual post-regulation channels");
const belowThreshold = clone(commitInput);
belowThreshold.expressionMoment.innerContinuity.affectiveResidue.liveEmotions = [{ emotionId: "affection", intensity: "very_low" }];
const quiet = tavernCharacterAgentV2OutputSchemaForStage(belowThreshold)
  .properties.privateExpressionTrace.properties.affectiveInfluence.properties;
assert.equal(quiet.sourceEmotionIds.maxItems, 0, "sub-threshold residue cannot be cited as material influence");
assert.deepEqual(quiet.mode.enum, ["no_live_influence"]);
assert.deepEqual(quiet.primaryChannelId.enum, [""]);
const impossible = clone(commitInput);
impossible.expressionMoment.innerContinuity.affectiveResidue.liveEmotions = [{ emotionId: "affection", intensity: "low" }];
impossible.expressionMoment.innerContinuity.affectiveResidue.possibleLeakageChannels = [];
const containedSchema = tavernCharacterAgentV2OutputSchemaForStage(impossible);
assert.equal(containedSchema.properties.publicExpression.properties.affectiveDeltas.maxItems, 0);
assert.ok(containedSchema.properties.privateExpressionTrace.properties.affectiveInfluence.properties.mode.enum.includes("contained_privately"),
  "material affect with no public pressure can still be privately contained without copying a nonexistent channel");

function resultFor(stage) {
  if (stage === "subjective_appraisal_and_candidates") return {
    appraisalAndCandidates: { appraisal: clone(reference.get("subjective_appraisal").appraisal), candidates: clone(reference.get("agent_candidates").candidates) },
  };
  return clone(reference.get(stage));
}
const stages = [], inputs = [];
const three = await run("three-call", async (input, options) => {
  stages.push(options.stage); inputs.push(clone(input)); return resultFor(options.stage);
});
assert.deepEqual(stages, ["subjective_appraisal_and_candidates", "agent_choice_and_regulation", "agent_turn_commit"]);
assert.equal(inputs[1].candidateCommitContexts, undefined, "selection must not carry speculative expression contexts");
assert.equal(inputs[1].candidateEvaluation.selection, null, "math must not select a candidate");
assert.deepEqual(inputs[2].expressionMoment, commitInput.expressionMoment, "expression must receive the actual regulation outcome");
assert.equal(three.events, 1);
assert.equal(three.observation.protocolRepairCount, 0);
const before = clone(baseline.observation), after = clone(three.observation);
delete before.stageNames; delete after.stageNames;
assert.deepEqual(after, before, "three calls must preserve four-stage causal behavior and public output");

const calls = [], rejections = [];
const repaired = await run("three-call", async (input, options) => {
  calls.push(options.stage);
  const result = resultFor(options.stage);
  if (options.stage === "agent_turn_commit" && !input.protocolRepairFeedback) {
    const channels = new Set(input.expressionMoment.innerContinuity.affectiveResidue.possibleLeakageChannels.map(row => row.channelId));
    const invalidChannel = CHARACTER_PSYCHOLOGY_LEAKAGE_CHANNELS.find(id => !channels.has(id));
    assert.ok(invalidChannel);
    result.turnCommit.privateExpressionTrace.affectiveInfluence.primaryChannelId = invalidChannel;
  }
  return result;
}, event => rejections.push(event));
assert.deepEqual(calls, [...stages, "agent_turn_commit"], "a failed expression may not rerun or replace the accepted choice");
assert.ok(rejections.some(event => event.issues.some(issue => issue.code === "STAGE_OUTPUT_ENUM" && issue.path.endsWith("primaryChannelId"))));
assert.equal(repaired.events, 1);
assert.equal(repaired.observation.protocolRepairCount, 1);
console.log("three-call causal ordering, exact affective schema, choice retention and world equivalence passed");

const twoCallStages = [], twoCallRejects = [];
let commitAttempts = 0;
const twoRepairs = await run("two-call", async (input, options) => {
  twoCallStages.push(options.stage);
  if (options.stage === "subjective_appraisal_and_candidates") return resultFor(options.stage);
  const turnCommit = clone(reference.get("agent_turn_commit").turnCommit);
  commitAttempts += 1;
  if (commitAttempts <= 2) turnCommit.privateExpressionTrace.affectiveInfluence.sourceEmotionIds = ["unknown-test-emotion"];
  if (options.stage === "agent_choice_and_turn_commit") return { choiceAndTurnCommit: {
    choice: clone(reference.get("agent_choice_and_regulation").choice), turnCommit,
  } };
  assert.equal(input.phase, "awaiting_agent_turn_commit");
  assert.deepEqual(input.expressionMoment.lockedAction, commitInput.expressionMoment.lockedAction);
  return { turnCommit };
}, event => twoCallRejects.push(event), 2);
assert.deepEqual(twoCallStages, ["subjective_appraisal_and_candidates", "agent_choice_and_turn_commit", "agent_turn_commit", "agent_turn_commit"]);
assert.equal(twoCallRejects.length, 2);
assert.equal(twoRepairs.events, 1, "a repaired commit must settle exactly once");
assert.equal(twoRepairs.observation.protocolRepairCount, 2);
console.log("Two configured commit repairs retain the accepted choice and use the correct standalone phase.");
