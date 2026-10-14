import assert from "node:assert/strict";

import {
  CHARACTER_MODEL_SESSION_POOL_VERSION,
  createCharacterModelSession,
  createCharacterModelSessionPool,
  restoreCharacterModelSessionPool,
} from "../src/server/simulation/characterModelSession.mjs";

const XIE = "char_xyy_xiezenshi";
const LUO = "char_xyy_luozhao";
const FIVE_PHASES = [
  "awaiting_subjective_appraisal",
  "awaiting_agent_candidates",
  "awaiting_agent_choice_and_regulation",
  "awaiting_expression_plan",
  "awaiting_realization",
];

function clone(value) {
  return structuredClone(value);
}

function createLocalProviderPort({ fixedConversationId = "" } = {}) {
  const liveById = new Map();
  const calls = { open: [], stage: [], checkpoint: [], close: [] };
  let sequence = 0;

  function liveFor(handle = {}) {
    const row = liveById.get(handle.providerConversationId);
    assert.ok(row, "the local provider must receive an open conversation handle");
    assert.equal(row.closed, false, "the local provider may not use a closed conversation");
    assert.equal(handle.characterId, row.characterId);
    return row;
  }

  const port = {
    async openConversation(input = {}) {
      const conversationId = fixedConversationId
        || input.providerConversationId
        || `local-provider-conversation:${input.characterId}:${++sequence}`;
      const restored = clone(input.providerCheckpoint || {});
      const row = {
        characterId: input.characterId,
        providerConversationId: conversationId,
        transcript: clone(restored.transcript || []),
        closed: false,
      };
      liveById.set(conversationId, row);
      calls.open.push({
        characterId: input.characterId,
        requestedConversationId: input.providerConversationId,
        providerConversationId: conversationId,
        restoredTranscriptLength: row.transcript.length,
      });
      return { characterId: input.characterId, providerConversationId: conversationId };
    },
    async runStage(handle, input = {}, context = {}) {
      const row = liveFor(handle);
      assert.equal(context.authority, "character-model-session");
      assert.equal(context.characterId, row.characterId);
      assert.equal(context.providerConversationId, row.providerConversationId);
      const priorMarkers = row.transcript.map((entry) => entry.privateMarker).filter(Boolean);
      row.transcript.push({
        characterId: input.characterId,
        agentTurnId: input.agentTurnId,
        phase: input.phase,
        privateMarker: input.privateMarker || "",
      });
      calls.stage.push({
        characterId: row.characterId,
        providerConversationId: row.providerConversationId,
        agentTurnId: input.agentTurnId,
        phase: input.phase,
        stageSequence: context.stageSequence,
        priorMarkers,
      });
      return {
        characterId: row.characterId,
        providerConversationId: row.providerConversationId,
        acceptedPhase: input.phase,
        historyLengthBeforeStage: row.transcript.length - 1,
        priorMarkers,
      };
    },
    async checkpointConversation(handle) {
      const row = liveFor(handle);
      calls.checkpoint.push({
        characterId: row.characterId,
        providerConversationId: row.providerConversationId,
      });
      return {
        characterId: row.characterId,
        providerConversationId: row.providerConversationId,
        transcript: clone(row.transcript),
      };
    },
    async closeConversation(handle) {
      const row = liveFor(handle);
      row.closed = true;
      calls.close.push({
        characterId: row.characterId,
        providerConversationId: row.providerConversationId,
      });
    },
  };

  return { port, calls };
}

function stageInput(characterId, agentTurnId, phase, privateMarker = "") {
  return { characterId, agentTurnId, phase, privateMarker };
}

const firstProvider = createLocalProviderPort();
const pool = createCharacterModelSessionPool({ providerPort: firstProvider.port });

for (const [index, phase] of FIVE_PHASES.entries()) {
  const result = await pool.runStage(stageInput(
    XIE,
    `agent-turn:${XIE}:1`,
    phase,
    index === 0 ? "xie-private-first-impression" : "",
  ));
  assert.equal(result.historyLengthBeforeStage, index);
}

const xieConversationId = pool.snapshot(XIE).providerConversationId;
assert.ok(xieConversationId);
assert.equal(firstProvider.calls.open.filter((row) => row.characterId === XIE).length, 1);
assert.deepEqual(
  firstProvider.calls.stage.filter((row) => row.characterId === XIE)
    .map((row) => row.providerConversationId),
  Array(5).fill(xieConversationId),
  "all five stages must run inside one provider conversation",
);

const xieSecondTurn = await pool.runStage(stageInput(
  XIE,
  `agent-turn:${XIE}:2`,
  "awaiting_subjective_appraisal",
));
assert.equal(xieSecondTurn.historyLengthBeforeStage, 5);
assert.deepEqual(xieSecondTurn.priorMarkers, ["xie-private-first-impression"]);
assert.equal(pool.snapshot(XIE).providerConversationId, xieConversationId);

const luoFirstTurn = await pool.runStage(stageInput(
  LUO,
  `agent-turn:${LUO}:1`,
  "awaiting_subjective_appraisal",
  "luo-private-purpose",
));
const luoConversationId = pool.snapshot(LUO).providerConversationId;
assert.ok(luoConversationId);
assert.notEqual(luoConversationId, xieConversationId, "different characters require different conversations");
assert.deepEqual(luoFirstTurn.priorMarkers, [], "Luo Zhao may not inherit Xie Zhenshi's private conversation");

const directXieSession = createCharacterModelSession({
  characterId: XIE,
  providerPort: createLocalProviderPort().port,
});
await assert.rejects(
  directXieSession.runStage(stageInput(LUO, `agent-turn:${LUO}:1`, FIVE_PHASES[0])),
  (error) => error.code === "CHARACTER_MODEL_SESSION_STAGE_OWNER_MISMATCH",
  "one character session must reject another character's stage before calling the provider",
);

const checkpoint = await pool.checkpoint();
assert.equal(checkpoint.schemaVersion, CHARACTER_MODEL_SESSION_POOL_VERSION);
assert.equal(checkpoint.sessions.length, 2);
const serializedCheckpoint = JSON.parse(JSON.stringify(checkpoint));
const xieCheckpoint = serializedCheckpoint.sessions.find((row) => row.characterId === XIE);
const luoCheckpoint = serializedCheckpoint.sessions.find((row) => row.characterId === LUO);
assert.equal(xieCheckpoint.providerConversationId, xieConversationId);
assert.equal(luoCheckpoint.providerConversationId, luoConversationId);
assert.equal(JSON.stringify(xieCheckpoint).includes("luo-private-purpose"), false);
assert.equal(JSON.stringify(luoCheckpoint).includes("xie-private-first-impression"), false);
await pool.close();

const restoredProvider = createLocalProviderPort();
const restoredPool = restoreCharacterModelSessionPool(serializedCheckpoint, {
  providerPort: restoredProvider.port,
});
const restoredXie = await restoredPool.runStage(stageInput(
  XIE,
  `agent-turn:${XIE}:2`,
  "awaiting_agent_candidates",
));
assert.equal(restoredPool.snapshot(XIE).providerConversationId, xieConversationId);
assert.equal(restoredProvider.calls.open[0].requestedConversationId, xieConversationId);
assert.equal(restoredProvider.calls.open[0].restoredTranscriptLength, 6);
assert.equal(restoredXie.historyLengthBeforeStage, 6);
assert.deepEqual(restoredXie.priorMarkers, ["xie-private-first-impression"]);
assert.equal(restoredXie.priorMarkers.includes("luo-private-purpose"), false);

const collidingProvider = createLocalProviderPort({ fixedConversationId: "provider-conversation:shared" });
const collidingPool = createCharacterModelSessionPool({ providerPort: collidingProvider.port });
await collidingPool.runStage(stageInput(XIE, `agent-turn:${XIE}:1`, FIVE_PHASES[0]));
await assert.rejects(
  collidingPool.runStage(stageInput(LUO, `agent-turn:${LUO}:1`, FIVE_PHASES[0])),
  (error) => error.code === "CHARACTER_MODEL_SESSION_CONVERSATION_SHARED",
  "a faulty provider may not place two characters in one conversation",
);

await restoredPool.close();
// A provider that aliases two owners has already violated its handle contract;
// discard that poisoned pool instead of asking the faulty adapter to close an
// id whose ownership it cannot distinguish.

console.log(JSON.stringify({
  status: "all-passed",
  checks: {
    fiveStagesShareOneProviderConversation: true,
    laterAgentTurnResumesSameConversation: true,
    charactersUseIsolatedConversations: true,
    crossCharacterStageRejectedBeforeProvider: true,
    checkpointRoundTripPreservesConversation: true,
    restoredProviderReceivesConversationCheckpoint: true,
    providerConversationCollisionRejected: true,
    noExternalModelCalled: true,
  },
}, null, 2));
