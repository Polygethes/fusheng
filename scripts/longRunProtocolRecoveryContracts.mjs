import assert from "node:assert/strict";
import test from "node:test";
import { tavernCharacterAgentV2OutputSchemaForStage, runTavernCharacterAgentTurnV2 } from "../src/server/pipeline/tavernCharacterAgentV2.mjs";
import { validateCharacterOutputShape, prepareCharacterStageSubmission } from "../src/server/simulation/characterStageSubmission.mjs";
import { reduceCharacterPrivateTurn } from "../src/server/simulation/characterPrivateStateReducer.mjs";
import { createTavernV27FixtureStageRunner } from "../src/server/pipeline/tavernV27FixtureStage.mjs";
import { authorizeCharacterTurnRetry, createCharacterTurnExecution } from "../src/server/simulation/characterTurnExecution.mjs";

test("recipient-bound transfer can name its object and cannot submit an empty object", () => {
  const schema = tavernCharacterAgentV2OutputSchemaForStage({ phase: "awaiting_agent_turn_commit", agentTurnId: "t:1",
    expressionMoment: { lockedAction: { primitive: "transfer", actionBinding: { kind: "character", targetCharacterId: "person:b" } } },
    actionReferenceOptions: { character: ["person:b"], object: ["manifest"], place: [], position: [], affordance: [] } });
  const object = schema.properties.actionAttempt.properties.objectId;
  assert.deepEqual(validateCharacterOutputShape("manifest", object), []);
  assert.ok(validateCharacterOutputShape("", object).length);
  assert.deepEqual(schema.properties.actionAttempt.properties.targetCharacterId.enum, ["person:b"]);
});

test("desire activation schema preserves cue-gating and excludes latent for persistent desires", () => {
  const schema = tavernCharacterAgentV2OutputSchemaForStage({ phase: "awaiting_subjective_appraisal",
    referenceContract: { ownedDesireIds: ["persistent", "cue"], ownedPsychologicalSourceIds: ["persistent", "cue"] },
    privateContext: { desires: [{ desireId: "persistent", activationMode: "persistent" }, { desireId: "cue", activationMode: "cue_gated" }] } });
  const branches = schema.properties.desireGroundings.items.anyOf;
  assert.ok(branches?.length);
  const persistent = branches.find(b => b.properties.desireId.enum.includes("persistent"));
  const cue = branches.find(b => b.properties.desireId.enum.includes("cue"));
  assert.ok(!persistent.properties.activationState.enum.includes("latent"));
  assert.ok(cue.properties.activationState.enum.includes("latent"));
  const activeCue = branches.find(b => b.properties.desireId.enum.includes("cue") && b.properties.activationState.enum.includes("active"));
  assert.equal(activeCue.properties.activationEvidenceIds.minItems, 1);
});

test("continuation target schema uses current perceived targets", () => {
  const schema = tavernCharacterAgentV2OutputSchemaForStage({ phase: "awaiting_agent_choice_and_regulation",
    referenceContract: { perceivedTargetHandles: ["person:b", "counter"] } });
  const target = schema.properties.continuationIntentions.items.properties.targetHandle;
  assert.ok(validateCharacterOutputShape("invented", target).length);
  assert.deepEqual(validateCharacterOutputShape("counter", target), []);
});

test("authorized retry preserves accepted decisions and history, remains bounded and is idempotent", async () => {
  const old = { schemaVersion: 1, protocolVersion: "test", agentTurnId: "t:retry", initialInput: { agentTurnId: "t:retry" },
    acceptedStages: [{ stage: "choice", session: { choice: "unchanged" } }], currentStage: { stage: "commit", status: "rejected", lastIssues: [{ code: "OLD" }] },
    callCount: 5, maxCalls: 5, repairAttempts: 2, maxRepairs: 2, status: "suspended_model_error" };
  assert.throws(() => createCharacterTurnExecution({ input: old.initialInput, protocolVersion: "test", checkpoint: old }), { code: "CHARACTER_MODEL_SUSPENDED" });
  const grant = { authorizationId: "user:fix-and-change-model", reason: "Contract repair and provider switch", additionalCalls: 1, additionalRepairs: 0 };
  const next = authorizeCharacterTurnRetry(old, grant);
  assert.deepEqual(next.acceptedStages, old.acceptedStages);
  assert.deepEqual(next.initialInput, old.initialInput);
  assert.deepEqual(next.retryAuthorizations[0].priorStage, old.currentStage);
  assert.equal(next.callCount, 5);
  assert.deepEqual(authorizeCharacterTurnRetry(next, grant), next);
  assert.equal(old.status, "suspended_model_error");
  const execution = createCharacterTurnExecution({ input: next.initialInput, protocolVersion: "test", checkpoint: next });
  await execution.prepareStage("commit", { phase: "commit" }, { type: "object" });
  await execution.beforeModelCall();
  await assert.rejects(execution.beforeModelCall(), { code: "CHARACTER_MODEL_SUSPENDED" });
  assert.throws(() => authorizeCharacterTurnRetry({ ...old, currentStage: { status: "response_received", response: { actual: "authored" } } }, grant), { code: "CHARACTER_RETRY_RECEIVED_OUTPUT_PENDING" });
});

test("an explicitly configured repair budget permits repair in a later stage without resetting counters", async () => {
  let snapshot;
  const execution = createCharacterTurnExecution({ input: { agentTurnId: "t:budget" }, protocolVersion: "test", maxRepairs: 4,
    onCheckpoint: value => { snapshot = value; } });
  await execution.prepareStage("appraisal", {}, {});
  for (let n = 0; n < 2; n++) {
    await execution.beforeModelCall(); await execution.rejectStage({ issues: [] }, {});
  }
  await execution.beforeModelCall(); await execution.acceptStage("appraisal", { phase: "choice" }, {});
  await execution.prepareStage("choice", {}, {});
  await execution.beforeModelCall(); await execution.rejectStage({ issues: [] }, {});
  assert.equal(snapshot.repairAttempts, 3);
  assert.equal(snapshot.callCount, 4);
  assert.equal(snapshot.maxCalls, 7);
  assert.equal(snapshot.status, "active");
});

test("private relationship reduction recognizes a personally perceived anonymous source", () => {
  const owner = "a", target = "perceived_entity:b", evidence = "ev:b";
  const result = reduceCharacterPrivateTurn({ ownerCharacterId: owner, previousPrivateState: { ownerCharacterId: owner },
    acceptedSession: { characterId: owner, agentTurnId: "t:anonymous", phase: "ready_for_world_resolution", submissionMode: "atomic",
      history: ["subjective_appraisal_accepted", "agent_candidates_accepted", "agent_choice_accepted", "agent_turn_commit_accepted"].map(stage => ({ stage })),
      privateContext: {}, psychologySnapshot: { authority: "character-private-psychology-tool", desires: [], emotions: [] },
      regulationOutcome: { authority: "character-private-psychology-tool" },
      subjectiveAppraisal: { noticedEvidenceIds: [evidence], relationshipAppraisal: { targetCharacterId: target,
        changeMode: "retained", sourceImpactIds: [evidence], dimensionChanges: [{ metric: "trust", direction: "increase", strengthBand: "low" }] } } },
    ownedEvidenceRecords: [{ evidenceId: evidence, recipientCharacterId: owner, sourceCharacterId: "", sourceEntityHandle: target,
      identityKnown: false, modality: "direct_speech", provenance: { kind: "firsthand" } }], relationshipPolicy: { metricIds: ["trust"] } });
  assert.equal(result.privateStatePatch.relationshipContext[0].toCharacterId, target);
  assert.equal(result.privateStatePatch.relationshipContext[0].trust, 1);
});

test("relationship impact references are checked even when changeMode is none", () => {
  const input = { phase: "awaiting_subjective_appraisal", worldProjection: { evidence: [{ evidenceId: "e", impactId: "impact:e" }] } };
  const schema = { type: "object", properties: {} };
  const result = prepareCharacterStageSubmission(input, { noticedEvidenceIds: ["e"], relationshipAppraisal: {
    changeMode: "none", sourceImpactIds: ["episode:private-memory"] } }, schema);
  assert.equal(result.valid, false);
});

test("relationship firsthand failure is repaired in appraisal before the stage is accepted", async () => {
  const fixture = createTavernV27FixtureStageRunner({ planForTurn: () => ({ intention: "休息", primitive: "rest", utterance: "", visibleAction: "", texture: [], privateBasis: "本人休息。" }) });
  let appraisalCalls = 0; const issues = [];
  const result = await runTavernCharacterAgentTurnV2({ agentTurnId: "t:relationship", submissionMode: "atomic", agent: { id: "a", name: "甲" },
    scene: { id: "inn", zoneId: "hall" }, perceivedCharacters: [{ id: "b", name: "乙" }, { id: "c", name: "丙" }],
    perceivedImpacts: [{ evidenceId: "ev:c", impactId: "ev:c", sourceCharacterId: "c", sourceEntityHandle: "c", content: "丙说话。", type: "speech", provenance: { kind: "firsthand" } }] },
    { characterAgentCallMode: "three-call", maxStageProtocolRepairs: 2, onStageRejected: e => issues.push(...e.issues),
      async runStage(input, options) {
        const output = await fixture(input, options);
        if (options.stage === "subjective_appraisal_and_candidates") {
          appraisalCalls++;
          output.appraisalAndCandidates.appraisal.relationshipAppraisal = { phase: "pending_perception_appraisal", targetCharacterId: "b",
            sourceImpactIds: ["ev:c"], changeMode: appraisalCalls === 1 ? "retained" : "provisional",
            dimensionChanges: [{ metric: "protection", direction: "increase", strengthBand: "low" }], reason: "本人判断。" };
        }
        return output;
      } }).catch(error => { error.message += JSON.stringify(issues); throw error; });
  assert.equal(appraisalCalls, 2);
  assert.ok(issues.some(i => i.code === "CHARACTER_AGENT_RELATIONSHIP_FIRSTHAND_REQUIRED"));
  assert.equal(result.session.subjectiveAppraisal.relationshipAppraisal.changeMode, "provisional");
});

test("invalid API JSON enters the same bounded character repair loop instead of halting the world", async () => {
  const fixture = createTavernV27FixtureStageRunner({ planForTurn: () => ({ intention: "休息", primitive: "rest", utterance: "", visibleAction: "", texture: [], privateBasis: "本人休息。" }) });
  let calls = 0, savedInvalidText; const issues = [];
  const result = await runTavernCharacterAgentTurnV2({ agentTurnId: "t:json-repair", submissionMode: "atomic", agent: { id: "a", name: "甲" }, scene: { id: "inn", zoneId: "hall" } }, {
    characterAgentCallMode: "three-call", maxStageProtocolRepairs: 2, onStageRejected: e => issues.push(...e.issues),
    onExecutionCheckpoint: state => { if (state.currentStage?.rejectedModelText) savedInvalidText = state.currentStage.rejectedModelText; },
    async runStage(input, options) {
      calls++;
      if (calls === 1) throw Object.assign(new Error("malformed model JSON"), { code: "CHARACTER_STAGE_OUTPUT_INVALID", rawOutput: '{"unfinished":',
        issues: [{ code: "STAGE_OUTPUT_INVALID_JSON", path: "output" }] });
      if (calls === 2) assert.equal(input.protocolRepairFeedback.violations[0].code, "STAGE_OUTPUT_INVALID_JSON");
      return fixture(input, options);
    } });
  assert.equal(calls, 4);
  assert.equal(savedInvalidText, '{"unfinished":');
  assert.equal(result.session.phase, "ready_for_world_resolution");
  assert.ok(issues.some(i => i.code === "STAGE_OUTPUT_INVALID_JSON"));
});
