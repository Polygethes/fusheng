import assert from "node:assert/strict";
import test from "node:test";
import { createLocalCharacterRuntimePort } from "../src/server/simulation/characterRuntimePort.mjs";
import { createCharacterSessionActor, restoreCharacterSessionActor } from "../src/server/simulation/characterSessionActor.mjs";
import { createWorldActionRegistry } from "../src/server/simulation/worldActionRegistry.mjs";
import { createWorldCommitCoordinator } from "../src/server/simulation/worldCommitCoordinator.mjs";
import { createCharacterWorldRuntime } from "../src/server/simulation/characterWorldRuntime.mjs";
import { registerCharacterEventDelivery } from "../src/server/simulation/characterEventReceipts.mjs";
import { runTavernCharacterAgentTurnV2 } from "../src/server/pipeline/tavernCharacterAgentV2.mjs";
import { createTavernV27FixtureStageRunner } from "../src/server/pipeline/tavernV27FixtureStage.mjs";

test("recovery keeps the evidence scope frozen before private reduction removes retained observations", async () => {
  const evidenceId = "evidence:retained-self";
  const actor = createCharacterSessionActor({ characterId: "a", privateState: { retainedImmediateSelfEvidence: [{ evidenceId }] },
    runtimePort: createLocalCharacterRuntimePort({ async runTurn(input) {
      return { characterId: "a", agentTurnId: input.agentTurnId, privateStatePatch: { retainedImmediateSelfEvidence: [] },
        actionAttempt: { primitive: "rest", payload: {} }, privateResult: {
          evidencePresentation: { presentedEvidenceIds: [evidenceId], expiredEvidenceIds: [] },
          evidenceReceiptSettlement: { authority: "character-agent", noticedEvidenceIds: [evidenceId], appraisedEvidenceIds: [evidenceId], consumedEvidenceIds: [] },
        } };
    } }) });
  const world = { worldId: "recovery-evidence", entities: { a: { id: "a", kind: "character", present: true, placeId: "inn", zoneId: "hall" } },
    places: { inn: { topology: { zones: { hall: {} }, edges: [] } } } };
  const coordinator = createWorldCommitCoordinator({ worldId: world.worldId, initialWorldState: world, actionRegistry: createWorldActionRegistry() });
  const situationProjector = () => ({ authority: "recipient-specific-world-projection", recipientCharacterId: "a", evidence: [] });
  let saved;
  const runtime = createCharacterWorldRuntime({ coordinator, actors: [actor], situationProjector,
    async onExecutionCheckpoint({ phase }) {
      if (phase === "world_attempt_prepared") { saved = await runtime.checkpoint(); throw Object.assign(new Error("crash"), { code: "TEST_CRASH" }); }
    } });
  registerCharacterEventDelivery(runtime.receiptLedger, { id: "delivery:self", objectiveEventId: "event:self", recipientId: "a", evidenceId, modality: "proprioception" });
  await runtime.enqueueWake("a", { wakeId: "retry", kind: "opportunity_window", evidenceIds: [], evidence: [] });
  await assert.rejects(runtime.runNext(), { code: "TEST_CRASH" });
  assert.deepEqual(saved.actors[0].privateState.retainedImmediateSelfEvidence, []);
  const restoredActor = restoreCharacterSessionActor(saved.actors[0], { runtimePort: createLocalCharacterRuntimePort({
    runTurn() { assert.fail("no additional decision is needed"); },
  }) });
  const restoredCoordinator = createWorldCommitCoordinator({ checkpoint: saved.coordinator, actionRegistry: createWorldActionRegistry() });
  const recovered = createCharacterWorldRuntime({ coordinator: restoredCoordinator, actors: [restoredActor], situationProjector, receiptLedger: saved.receiptLedger });
  try {
    const turn = await recovered.runNext();
    assert.equal(turn.outcome.status, "success");
    assert.equal(restoredCoordinator.journal.events.length, 1);
    assert.deepEqual(turn.privateResult.evidenceReceiptSettlement.noticedEvidenceIds, [evidenceId], "recovery must not erase attention history to proceed");
  } finally { await actor.close(); await restoredActor.close(); }
});

test("reply to an earlier group participant is repaired before leaving the character protocol", async () => {
  const fixture = createTavernV27FixtureStageRunner({ planForTurn: () => ({ intention: "回应乙", primitive: "speak", targetId: "b",
    utterance: "好。", visibleAction: "", texture: [], privateBasis: "本人回应。" }) });
  let commits = 0;
  const issues = [];
  const result = await runTavernCharacterAgentTurnV2({ agentTurnId: "reply-scope:1", submissionMode: "atomic",
    agent: { id: "a", name: "甲" }, scene: { id: "inn", zoneId: "hall" },
    perceivedCharacters: [{ id: "b", name: "乙" }, { id: "c", name: "丙" }],
    conversationAnchors: { anchors: [{ anchorHandle: "group", allowedModes: ["reply", "continue"], participantHandles: ["b", "c"],
      recentTurns: [{ direction: "incoming", speakerHandle: "b", utterance: "先前的话。" }, { direction: "incoming", speakerHandle: "c", utterance: "最新的话。" }] }] },
  }, { characterAgentCallMode: "three-call", maxStageProtocolRepairs: 1,
    onStageRejected(event) { issues.push(...event.issues); },
    async runStage(input, options) {
      const output = await fixture(input, options);
      if (options.stage === "agent_turn_commit") {
        commits++;
        output.turnCommit.conversationAnchorSelection = { mode: commits === 1 ? "reply" : "continue", anchorHandle: "group",
          targetParticipantHandle: "b", postTurnDisposition: "keep_resumable" };
      }
      return output;
    },
  });
  assert.equal(commits, 2);
  assert.ok(issues.some(row => row.code === "CHARACTER_AGENT_CONVERSATION_REPLY_TARGET_MISMATCH"
    || (row.code === "STAGE_OUTPUT_ENUM" && row.path?.endsWith("targetParticipantHandle"))), JSON.stringify(issues));
  assert.equal(result.session.turnCommit.conversationAnchorSelection.mode, "continue");
});
