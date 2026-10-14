import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { createTavernWorldRuntimeV27, projectTavernSituationV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { createTavernV27FixtureStageRunner } from "../src/server/pipeline/tavernV27FixtureStage.mjs";
import { tavernCharacterAgentV2OutputSchemaForStage } from "../src/server/pipeline/tavernCharacterAgentV2.mjs";
import { prepareCharacterStageSubmission } from "../src/server/simulation/characterStageSubmission.mjs";
import { describeSettledTurn, renderSettledSimulationReport } from "../src/server/simulation/settledSimulationReport.mjs";

const seed = buildPlayableWorldFromSetup({ setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。", setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。" });
const clone = structuredClone, saved = new Map(), fixture = createTavernV27FixtureStageRunner();
const keys = { subjective_appraisal: "appraisal", agent_candidates: "candidates", agent_choice_and_regulation: "choice", agent_turn_commit: "turnCommit" };
const instance = createTavernWorldRuntimeV27(seed, {
  characterAgentCallMode: "standard", // Exercise each individual protocol schema; production uses three calls.
  characterIds: ["char_xyy_xiezenshi", "char_xyy_zhoumin", "char_xyy_luozhao"],
  runStage: async (input, options) => {
    const result = await fixture(input, options);
    saved.set(options.stage, { input: clone(input), output: clone(result[keys[options.stage]]) });
    return result;
  },
});
try {
  await instance.runtime.enqueueWake("char_xyy_xiezenshi", { wakeId: "preflight:test", kind: "opportunity_window", evidence: [], evidenceIds: [] });
  await instance.runtime.runNext();
  for (const [stage, { input, output }] of saved) {
    const schema = tavernCharacterAgentV2OutputSchemaForStage(input);
    const before = JSON.stringify(output);
    const checked = prepareCharacterStageSubmission(input, output, schema);
    assert.equal(checked.valid, true, `${stage}: ${JSON.stringify(checked.issues)}`);
    assert.equal(JSON.stringify(output), before);
    const missingMetadata = clone(output);
    delete missingMetadata.ownerAuthority; delete missingMetadata.agentTurnId;
    assert.equal(prepareCharacterStageSubmission(input, missingMetadata, schema).valid, true);
    const foreign = { ...output, agentTurnId: "another-character-turn" };
    assert.equal(prepareCharacterStageSubmission(input, foreign, schema).valid, false);
  }
  const candidate = saved.get("agent_candidates");
  const candidateSchema = tavernCharacterAgentV2OutputSchemaForStage(candidate.input);
  for (const primitive of ["drop", "handle"]) {
    const invalid = clone(candidate.output);
    invalid.candidates[0].attemptPrimitive = primitive;
    assert.ok(prepareCharacterStageSubmission(candidate.input, invalid, candidateSchema).issues.some(row => row.path.endsWith("attemptPrimitive")));
  }
  const wrongReference = clone(candidate.output);
  wrongReference.candidates[0].targetHandle = "unprojected-object";
  assert.equal(prepareCharacterStageSubmission(candidate.input, wrongReference, candidateSchema).valid, false);
  const wrongRelation = clone(candidate.output);
  wrongRelation.candidates[0].desireRelations = [{ desireId: candidate.input.referenceContract.ownedDesireIds[0],
    relation: "conflict", terminalConditionMatch: 0, counterfactualResult: "测试非法关系", preservesNonSubstitutableConditions: true, confidence: 0.5 }];
  assert.equal(prepareCharacterStageSubmission(candidate.input, wrongRelation, candidateSchema).valid, false);

  const choice = saved.get("agent_choice_and_regulation"), commit = saved.get("agent_turn_commit");
  const choicesSchema = tavernCharacterAgentV2OutputSchemaForStage(choice.input);
  assert.equal(prepareCharacterStageSubmission(choice.input, commit.output, choicesSchema).valid, false, "a commit cannot replace a missing choice");
  const commitSchema = tavernCharacterAgentV2OutputSchemaForStage(commit.input);
  assert.equal(prepareCharacterStageSubmission(commit.input, { choice: choice.output, turnCommit: commit.output }, commitSchema).valid, false,
    "a standalone repair cannot replay or replace the accepted choice");
  const inconsistent = clone(choice.output);
  inconsistent.goalPreservation.preservedDesireIds = [choice.input.referenceContract.ownedDesireIds.find(id =>
    !choice.input.generatedCandidates.find(c => c.candidateId === inconsistent.selectedCandidateId).desireRelations.some(r => r.desireId === id))].filter(Boolean);
  if (inconsistent.goalPreservation.preservedDesireIds.length) {
    assert.ok(prepareCharacterStageSubmission(choice.input, inconsistent, choicesSchema).issues.some(row => row.code === "CHARACTER_AGENT_PRESERVED_DESIRE_UNLINKED"));
  }
  // Each allowed anchor must remain bound to its own participants, even when
  // the overall audience/participant union contains both targets.
  const anchoredInput = clone(commit.input);
  anchoredInput.expressionMoment.conversationAnchors = { anchors: [
    { anchorHandle: "anchor-a", allowedModes: ["reply"], participantHandles: ["target-a"] },
    { anchorHandle: "anchor-b", allowedModes: ["reply"], participantHandles: ["target-b"] },
  ] };
  anchoredInput.expressionMoment.allowedAudienceCharacterIds = ["target-a", "target-b"];
  const anchored = clone(commit.output);
  anchored.publicExpression.audienceCharacterIds = ["target-b"];
  anchored.conversationAnchorSelection = { mode: "reply", anchorHandle: "anchor-a", targetParticipantHandle: "target-b", postTurnDisposition: "keep_resumable" };
  const anchoredSchema = tavernCharacterAgentV2OutputSchemaForStage(anchoredInput);
  assert.equal(prepareCharacterStageSubmission(anchoredInput, anchored, anchoredSchema).valid, false);
  anchored.conversationAnchorSelection.anchorHandle = "anchor-b";
  assert.equal(prepareCharacterStageSubmission(anchoredInput, anchored, anchoredSchema).valid, true);

  const projection = projectTavernSituationV27({ worldState: instance.coordinator.worldState, worldVersion: 1, characterId: "char_xyy_zhoumin", wake: {} });
  const medicine = projection.perceivedObjects.find(row => row.id === "tavern_delivery_medicine_parcel");
  assert.equal(medicine.custody.storageMode, "carried");
  assert.equal(medicine.custody.inHand, false, "missing custody uses the same defaults as settlement");
  assert.match(medicine.handlingState, /尚未拿在手中/);

  const archive = JSON.parse(await readFile(new URL("../sim-runs/2026-09-07-pi-model-resume-20turns/world-save-60.json", import.meta.url), "utf8"));
  const report = renderSettledSimulationReport(archive.settledTurns.slice(50), archive.provenance);
  assert.ok(!report.includes("你的帖拿来我看吧"), "a rejected draft must never enter the settled public chronology");
  assert.equal((report.match(/物品尚未拿在手中/gu) || []).length, 3);
  assert.equal(describeSettledTurn(archive.settledTurns[58]), "私人反思，没有公开行动");
  assert.ok(!report.includes("交割线闭合"));
  assert.ok(!renderSettledSimulationReport([{ index: 1, turnKind: "action", speech: "未实际发出的台词",
    outcome: { status: "failed" }, resolvedEffectKinds: [] }]).includes("未实际发出的台词"));
  console.log("Submission contracts passed: valid runtime outputs, metadata ownership, invalid names/references, repair shape, anchor pairs, own custody and factual 51-60 report.");
} finally {
  for (const actor of instance.runtime.actors.values()) await actor.close();
}
