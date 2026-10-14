import assert from "node:assert/strict";

import { auditCharacterLongHorizonContinuity } from "../src/server/evaluation/characterLongHorizonContinuity.mjs";

const A = "char:a";
const B = "char:b";

function outcome({ attemptId, actorId, worldVersion, primitive, utterance = "", speechAct = "none", provenance = null }) {
  return {
    eventId: `world-event:${attemptId}`,
    actionAttemptId: attemptId,
    actorId,
    worldVersion,
    primitive,
    status: "success",
    attemptSurface: utterance ? [{
      kind: "utterance_emitted",
      actorId,
      utterance,
      speechAct,
      provenance,
    }] : [{ kind: `${primitive}_completed`, actorId }],
    deliveries: utterance ? [{
      eventKind: "speech",
      sourceCharacterId: actorId,
      content: utterance,
      speechAct,
      provenance,
    }] : [],
  };
}

function turn({ id, characterId, wakeId, wakeKind, primitive = "", targetId = "", utterance = "", speechAct = "none", provenance = null, worldVersion = 0 }) {
  const attemptId = primitive ? `action-attempt:${id}` : "";
  return {
    agentTurnId: id,
    characterId,
    wake: { wakeId, kind: wakeKind, causeType: wakeKind },
    actionAttempt: primitive ? {
      attemptId,
      actorId: characterId,
      primitive,
      payload: { targetId, utterance, speechAct, provenance },
    } : null,
    outcome: primitive ? outcome({
      attemptId,
      actorId: characterId,
      worldVersion,
      primitive,
      utterance,
      speechAct,
      provenance,
    }) : null,
  };
}

const questionAttempt = "action-attempt:agent-turn:b:1";
const cleanTurns = [
  turn({
    id: "agent-turn:a:1",
    characterId: A,
    wakeId: "wake:plan:a:morning",
    wakeKind: "plan_due",
    primitive: "move",
    targetId: "town-square",
    worldVersion: 1,
  }),
  turn({
    id: "agent-turn:b:1",
    characterId: B,
    wakeId: "wake:event:b:noticed-a",
    wakeKind: "world_evidence",
    primitive: "speak",
    targetId: A,
    utterance: "你也去广场？",
    speechAct: "ask",
    provenance: {
      sourceActionId: questionAttempt,
      sourceThreadId: "live-thread:walk",
      responseToTurnId: "",
    },
    worldVersion: 2,
  }),
  turn({
    id: "agent-turn:a:2",
    characterId: A,
    wakeId: "wake:event:a:question",
    wakeKind: "world_evidence",
    primitive: "speak",
    targetId: B,
    utterance: "嗯，去看看早市。",
    speechAct: "answer",
    provenance: {
      sourceActionId: "action-attempt:agent-turn:a:2",
      sourceThreadId: "live-thread:walk",
      responseToTurnId: questionAttempt,
    },
    worldVersion: 3,
  }),
  turn({
    id: "agent-turn:a:3",
    characterId: A,
    wakeId: "wake:reflection:a:1",
    wakeKind: "reflection_due",
  }),
];

const cleanCheckpoint = {
  actors: [{
    characterId: A,
    privateState: {
      ownerCharacterId: A,
      memoryContext: {
        ownerCharacterId: A,
        episodes: [{ id: "episode:a:1", ownerCharacterId: A }],
        beliefs: [{ id: "belief:a:1", ownerCharacterId: A }],
      },
    },
  }, {
    characterId: B,
    privateState: {
      ownerCharacterId: B,
      memoryContext: { ownerCharacterId: B, episodes: [], beliefs: [] },
    },
  }],
};

const clean = auditCharacterLongHorizonContinuity({
  requiredCharacterIds: [A, B],
  turns: cleanTurns,
  checkpoint: cleanCheckpoint,
  publicWorld: { journal: [{ type: "world_clock_advanced", nowSeconds: 60 }] },
  policy: { minTurnsPerCharacter: 1, requireAutonomousWake: true, maxConsecutiveSameAction: 2 },
});
assert.equal(clean.valid, true, JSON.stringify(clean.issues, null, 2));
assert.equal(clean.metrics.causalResponseCount, 1);
assert.equal(clean.metrics.planWakeCount, 1);
assert.equal(clean.metrics.reflectionWakeCount, 1);
assert.equal(clean.metrics.silentTurnCount, 1);

const underCovered = auditCharacterLongHorizonContinuity({
  requiredCharacterIds: [A, B],
  turns: cleanTurns,
  checkpoint: cleanCheckpoint,
  publicWorld: { nowSeconds: 59, readyQueue: [] },
  policy: { minimumCoveredWorldSeconds: 86_400, requireQuiescentEnd: true },
});
assert.ok(underCovered.issues.some((row) => row.code === "WORLD_HORIZON_UNDER_COVERED"));

const capped = auditCharacterLongHorizonContinuity({
  requiredCharacterIds: [A, B],
  turns: cleanTurns,
  checkpoint: cleanCheckpoint,
  publicWorld: { nowSeconds: 86_400, readyQueue: [A] },
  policy: { minimumCoveredWorldSeconds: 86_400, requireQuiescentEnd: true, endedByTurnLimit: true },
});
assert.ok(capped.issues.some((row) => row.code === "LONG_HORIZON_NOT_QUIESCENT"));
assert.ok(capped.issues.some((row) => row.code === "LONG_HORIZON_TURN_LIMIT_EXHAUSTED"));

const ownerMismatch = structuredClone(cleanTurns);
ownerMismatch[0].actionAttempt.actorId = B;
assert.ok(auditCharacterLongHorizonContinuity({
  requiredCharacterIds: [A, B], turns: ownerMismatch, checkpoint: cleanCheckpoint,
}).issues.some((row) => row.code === "ACTION_OWNER_MISMATCH"));

const orphanResponse = structuredClone(cleanTurns);
orphanResponse[2].actionAttempt.payload.provenance.responseToTurnId = "action-attempt:missing";
orphanResponse[2].outcome.deliveries[0].provenance.responseToTurnId = "action-attempt:missing";
orphanResponse[2].outcome.attemptSurface[0].provenance.responseToTurnId = "action-attempt:missing";
assert.ok(auditCharacterLongHorizonContinuity({
  requiredCharacterIds: [A, B], turns: orphanResponse, checkpoint: cleanCheckpoint,
}).issues.some((row) => row.code === "SPEECH_PARENT_MISSING"));

const duplicateWake = [...cleanTurns, {
  ...structuredClone(cleanTurns[3]),
  agentTurnId: "agent-turn:a:4",
}];
assert.ok(auditCharacterLongHorizonContinuity({
  requiredCharacterIds: [A, B], turns: duplicateWake, checkpoint: cleanCheckpoint,
}).issues.some((row) => row.code === "WAKE_CONSUMED_TWICE"));

const loopTurns = [1, 2, 3].map((index) => turn({
  id: `agent-turn:a:loop:${index}`,
  characterId: A,
  wakeId: `wake:a:loop:${index}`,
  wakeKind: "plan_due",
  primitive: "move",
  targetId: "same-place",
  worldVersion: index,
}));
assert.ok(auditCharacterLongHorizonContinuity({
  requiredCharacterIds: [A], turns: loopTurns, checkpoint: { actors: [cleanCheckpoint.actors[0]] },
  policy: { maxConsecutiveSameAction: 2 },
}).issues.some((row) => row.code === "UNMOTIVATED_ACTION_LOOP"));

const waitTurns = loopTurns.map(row => ({ ...structuredClone(row),
  actionAttempt: { ...structuredClone(row.actionAttempt), primitive: "wait" },
  outcome: { ...structuredClone(row.outcome), primitive: "wait", resolvedEffects: [{ kind: "actor_wait_registered" }] },
}));
assert.equal(auditCharacterLongHorizonContinuity({
  requiredCharacterIds: [A], turns: waitTurns, checkpoint: { actors: [cleanCheckpoint.actors[0]] },
  policy: { maxConsecutiveSameAction: 2 },
}).issues.some(row => row.code === "UNMOTIVATED_ACTION_LOOP"), false, "registered waits resume on events or deadlines rather than poll");
for (const row of waitTurns) { row.outcome.status = "failed"; row.outcome.resolvedEffects = []; }
assert.ok(auditCharacterLongHorizonContinuity({
  requiredCharacterIds: [A], turns: waitTurns, checkpoint: { actors: [cleanCheckpoint.actors[0]] },
  policy: { maxConsecutiveSameAction: 2 },
}).issues.some(row => row.code === "UNMOTIVATED_ACTION_LOOP"), "unregistered waits must still count as failed repetitions");

const leaked = auditCharacterLongHorizonContinuity({
  requiredCharacterIds: [A, B],
  turns: cleanTurns,
  checkpoint: cleanCheckpoint,
  publicWorld: { journal: [{ activePlanProjection: { privatePurpose: "只属于 A 的秘密计划" } }] },
});
assert.ok(leaked.issues.some((row) => row.code === "PRIVATE_CONTINUITY_PUBLIC_LEAK"));

const crossedMemory = structuredClone(cleanCheckpoint);
crossedMemory.actors[1].privateState.memoryContext.episodes.push({ id: "episode:wrong", ownerCharacterId: A });
assert.ok(auditCharacterLongHorizonContinuity({
  requiredCharacterIds: [A, B], turns: cleanTurns, checkpoint: crossedMemory,
}).issues.some((row) => row.code === "MEMORY_OWNER_MISMATCH"));

console.log("character long-horizon continuity audit contracts passed");
