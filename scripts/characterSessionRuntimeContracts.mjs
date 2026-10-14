import assert from "node:assert/strict";

import { assembleCharacterTurnContext } from "../src/server/simulation/characterContextAssembler.mjs";
import { createLocalCharacterRuntimePort } from "../src/server/simulation/characterRuntimePort.mjs";
import {
  createCharacterSessionActor,
  restoreCharacterSessionActor,
} from "../src/server/simulation/characterSessionActor.mjs";

const characterId = "char:runtime-probe";
let releaseTurn;
const turnGate = new Promise((resolve) => { releaseTurn = resolve; });
const observedInputs = [];

const runtimePort = createLocalCharacterRuntimePort({
  async runTurn(input) {
    observedInputs.push(structuredClone(input));
    await turnGate;
    return {
      characterId: input.characterId,
      agentTurnId: input.agentTurnId,
      privateStatePatch: { mood: { arousal: 0.62 }, lastThoughtWakeId: input.wake.wakeId },
      actionAttempt: {
        attemptId: `attempt:${input.agentTurnId}`,
        primitive: "speak",
        payload: { utterance: "testing" },
      },
    };
  },
  async applyWorldOutcome(outcome) {
    return {
      privateStatePatch: {
        lastWorldOutcomeId: outcome.outcomeId,
        lastKnownWorldVersion: outcome.worldVersion,
      },
    };
  },
});

const actor = createCharacterSessionActor({
  characterId,
  privateState: {
    ownerCharacterId: characterId,
    mood: { arousal: 0.2 },
    secret: "owned-only",
  },
  runtimePort,
});

await actor.open();
const wake = {
  wakeId: "wake:event:1",
  kind: "world_evidence",
  eventId: "event:1",
  evidenceIds: ["evidence:1"],
  recipientCharacterId: characterId,
};
assert.equal(await actor.enqueueWake(wake), true);
assert.equal(await actor.enqueueWake(wake), false, "the same wake may not enter one mailbox twice");

const situationProjection = {
  authority: "recipient-specific-world-projection",
  recipientCharacterId: characterId,
  place: { placeId: "place:forge", zoneId: "front" },
  evidence: [{ evidenceId: "evidence:1", content: "a hammer strikes metal" }],
  socialContext: { socialFacts: [], interpretationAuthority: "character-agent" },
};

const pendingTurn = actor.runNextTurn({
  worldVersion: 3,
  situationProjection,
});
await assert.rejects(
  actor.runNextTurn({ worldVersion: 3, situationProjection }),
  (error) => error.code === "CHARACTER_ACTOR_TURN_ALREADY_ACTIVE",
  "one character may have only one active turn",
);
releaseTurn();
const turnResult = await pendingTurn;

assert.equal(turnResult.actionAttempt.actorId, characterId);
assert.equal(turnResult.actionAttempt.expectedWorldVersion, 3);
assert.equal(turnResult.actionAttempt.attemptId.startsWith("attempt:"), true);
assert.equal(actor.privateState.mood.arousal, 0.62);
assert.equal(observedInputs[0].privateContext.secret, "owned-only");
assert.equal(Object.hasOwn(observedInputs[0], "globalWorldState"), false);
assert.equal(Object.hasOwn(observedInputs[0].worldProjection, "journal"), false);

await actor.applyWorldOutcome({
  authority: "world-resolution",
  outcomeId: "outcome:1",
  actionAttemptId: turnResult.actionAttempt.attemptId,
  actorId: characterId,
  worldVersion: 4,
  status: "success",
});
assert.equal(actor.privateState.lastWorldOutcomeId, "outcome:1");
assert.equal(actor.privateState.lastKnownWorldVersion, 4);

await actor.enqueueWake({
  wakeId: "wake:event:2",
  kind: "body_threshold",
  recipientCharacterId: characterId,
  evidenceIds: [],
});
const checkpoint = await actor.checkpoint();
assert.equal(checkpoint.mailbox.length, 1);
assert.equal(checkpoint.privateJournal.some((row) => row.kind === "world_outcome_applied"), true);
assert.equal(JSON.stringify(checkpoint).includes("other-character-secret"), false);

const restored = restoreCharacterSessionActor(checkpoint, { runtimePort });
await restored.open();
assert.equal(restored.characterId, characterId);
assert.equal(restored.mailbox[0].wakeId, "wake:event:2");
assert.equal(restored.privateState.lastKnownWorldVersion, 4);

assert.throws(() => assembleCharacterTurnContext({
  characterId,
  agentTurnId: "turn:bad",
  wake,
  worldVersion: 4,
  situationProjection: {
    ...situationProjection,
    globalWorldState: { forbidden: true },
  },
  privateState: actor.privateState,
}), (error) => error.code === "CHARACTER_CONTEXT_FORBIDDEN_WORLD_AUTHORITY");

const maliciousPort = createLocalCharacterRuntimePort({
  async runTurn(input) {
    return {
      characterId: input.characterId,
      agentTurnId: input.agentTurnId,
      worldPatch: { entities: { hacked: true } },
      actionAttempt: { attemptId: "attempt:malicious", primitive: "observe", payload: {} },
    };
  },
});
const guarded = createCharacterSessionActor({
  characterId: "char:guarded",
  privateState: { ownerCharacterId: "char:guarded" },
  runtimePort: maliciousPort,
});
await guarded.open();
await guarded.enqueueWake({
  wakeId: "wake:guarded",
  kind: "world_evidence",
  recipientCharacterId: "char:guarded",
  evidenceIds: [],
});
await assert.rejects(guarded.runNextTurn({
  worldVersion: 1,
  situationProjection: {
    authority: "recipient-specific-world-projection",
    recipientCharacterId: "char:guarded",
    evidence: [],
  },
}), (error) => error.code === "CHARACTER_RUNTIME_WORLD_WRITE_FORBIDDEN");

console.log(JSON.stringify({
  status: "all-passed",
  checks: {
    duplicateWakeSuppressed: true,
    oneActiveTurn: true,
    recipientSafeContext: true,
    expectedWorldVersionBound: true,
    privateStateSingleWriter: true,
    outcomeReturnedToSameActor: true,
    checkpointRestored: true,
    directWorldWriteRejected: true,
  },
}, null, 2));
