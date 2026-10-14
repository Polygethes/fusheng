import assert from "node:assert/strict";

import { createLocalCharacterRuntimePort } from "../src/server/simulation/characterRuntimePort.mjs";
import { createCharacterSessionActor } from "../src/server/simulation/characterSessionActor.mjs";
import { createCharacterWorldRuntime } from "../src/server/simulation/characterWorldRuntime.mjs";
import { createWorldActionRegistry } from "../src/server/simulation/worldActionRegistry.mjs";
import { createWorldCommitCoordinator } from "../src/server/simulation/worldCommitCoordinator.mjs";

const A = "char:reflection:a";
const B = "char:reflection:b";
const OPPORTUNITY = "reflection-opportunity:char_reflection_a:1";

function reflectionState(ownerCharacterId, pendingOpportunity = null) {
  return {
    schemaVersion: "character-reflection-v1",
    authority: "character-private-reflection-ledger",
    ownerCharacterId,
    threshold: 1,
    accumulatedImportance: 0,
    accumulationSourceMemoryIds: [],
    accountedImportanceByMemoryId: {},
    pendingOpportunity,
    completedOpportunityIds: [],
    completedOpportunities: [],
    nextOpportunitySequence: 2,
  };
}

const seen = [];
function actor(characterId, pendingOpportunity = null) {
  return createCharacterSessionActor({
    characterId,
    privateState: {
      ownerCharacterId: characterId,
      memoryContext: { ownerCharacterId: characterId, episodes: [], beliefs: [] },
      reflectionState: reflectionState(characterId, pendingOpportunity),
    },
    runtimePort: createLocalCharacterRuntimePort({
      async runTurn(input) {
        seen.push(structuredClone(input));
        const isReflection = input.wake?.causeType === "reflection_due";
        return {
          characterId,
          agentTurnId: input.agentTurnId,
          privateStatePatch: isReflection ? {
            reflectionState: reflectionState(characterId, null),
          } : {},
          privateResult: isReflection ? {
            turnKind: "reflection",
            reflectionOpportunityId: input.wake.reflectionOpportunityId,
          } : {},
          actionAttempt: null,
        };
      },
      async applyWorldOutcome() {
        throw new Error("reflection must not reach world resolution");
      },
    }),
  });
}

const actorA = actor(A, {
  schemaVersion: "character-reflection-v1",
  authority: "character-private-reflection-opportunity",
  ownerCharacterId: A,
  opportunityId: OPPORTUNITY,
  status: "due",
  dueAtSeconds: 0,
  accumulatedImportance: 1.2,
  sourceMemoryIds: ["episode:a:private"],
  decisionAuthority: "character-agent",
  selection: null,
});
const actorB = actor(B, null);
const coordinator = createWorldCommitCoordinator({
  worldId: "world:reflection-isolation",
  initialWorldState: {
    worldId: "world:reflection-isolation",
    worldVersion: 0,
    nowSeconds: 0,
    entities: {
      [A]: { id: A, kind: "character", present: true, placeId: "place:room", zoneId: "hall" },
      [B]: { id: B, kind: "character", present: true, placeId: "place:room", zoneId: "hall" },
    },
    objects: {},
    signals: [],
    processes: [],
    places: {
      "place:room": {
        topology: { zones: { hall: { id: "hall" } }, edges: [] },
        socialBoundaries: [],
        accessGrants: [],
      },
    },
  },
  actionRegistry: createWorldActionRegistry(),
});
const runtime = createCharacterWorldRuntime({
  coordinator,
  actors: [actorA, actorB],
  situationProjector: ({ worldState, worldVersion, characterId }) => ({
    authority: "recipient-specific-world-projection",
    recipientCharacterId: characterId,
    worldVersion,
    nowSeconds: worldState.nowSeconds,
    evidence: [],
  }),
});

await runtime.enqueueWake(A, {
  wakeId: "wake:external:a:first",
  kind: "world_evidence",
  causeType: "world_evidence",
  evidenceIds: [],
  evidence: [],
});

const worldBefore = structuredClone(coordinator.worldState);
const journalBefore = structuredClone(coordinator.journal);
const first = await runtime.runNext();
assert.equal(first.wake.causeType, "world_evidence", "fresh world evidence must be considered before private reflection");
assert.equal(first.actionAttempt, null);

const second = await runtime.runNext();
assert.equal(second.characterId, A);
assert.equal(second.wake.causeType, "reflection_due");
assert.equal(second.wake.reflectionOpportunityId, OPPORTUNITY);
assert.deepEqual(second.wake.evidenceIds, []);
assert.deepEqual(second.wake.evidence, []);
assert.equal(second.actionAttempt, null);
assert.equal(second.outcome, null);
assert.equal(second.privateResult.turnKind, "reflection");
const wakeText = JSON.stringify(second.wake);
for (const secret of ["episode:a:private", "sourceMemoryIds", "insights", "actionAttempt", "utterance", "privatePurpose"]) {
  assert.equal(wakeText.includes(secret), false, `reflection wake must not reveal ${secret}`);
}

assert.deepEqual(coordinator.worldState, worldBefore, "private reflection must not mutate objective world state");
assert.deepEqual(coordinator.journal, journalBefore, "private reflection must not create a public world event");
assert.equal(seen.some((row) => row.characterId === B), false, "another Character must not be woken for A's reflection");
assert.equal(await runtime.runNext(), null, "a consumed reflection opportunity must not immediately repeat");

const checkpoint = await runtime.checkpoint();
assert.equal(checkpoint.readyQueue.length, 0);
assert.equal(checkpoint.actors.find((row) => row.characterId === A).mailbox.length, 0);
assert.equal(checkpoint.actors.find((row) => row.characterId === B).privateState.reflectionState.pendingOpportunity, null);

console.log("character reflection wake isolation contracts passed");
