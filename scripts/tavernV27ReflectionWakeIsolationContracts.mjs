import assert from "node:assert/strict";

import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import {
  createTavernWorldRuntimeV27,
  projectTavernV27TurnForObserver,
} from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { tavernCharacterAgentV2OutputSchemaForStage } from "../src/server/pipeline/tavernCharacterAgentV2.mjs";

const A = "char_xyy_xiezenshi";
const B = "char_xyy_luozhao";
const MEMORY_ID = "episode:reflection:v27:owned";
const OPPORTUNITY_ID = "reflection-opportunity:xiezenshi:v27:1";
const PRIVATE_CONTENT = "他想起自己总在忙完后独自检查门闩。";
const INSIGHT = "我把反复检查当成让自己重新安静下来的办法。";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
const calls = [];
const instance = createTavernWorldRuntimeV27(state, {
  characterIds: [A, B],
  positions: { [A]: "hall", [B]: "hall" },
  runStage: async (input, options = {}) => {
    calls.push({ input: structuredClone(input), options: structuredClone(options) });
    assert.equal(input.phase, "awaiting_character_reflection");
    assert.equal(options.stage, "character_reflection");
    const schema = tavernCharacterAgentV2OutputSchemaForStage(input);
    assert.deepEqual(
      schema.properties.insights.items.properties.sourceMemoryIds.items.enum,
      [MEMORY_ID],
      "the model schema must bind insight sources to this opportunity's owned memory slice",
    );
    return {
      reflection: {
        ownerAuthority: "character-agent",
        insights: [{
          proposition: INSIGHT,
          sourceMemoryIds: [MEMORY_ID],
          confidence: 0.74,
          importance: 0.78,
          semanticFrame: {
            kind: "reflection_insight",
            predicate: "self_regulate",
            topicId: "quiet_after_work",
            lexicalAnchors: ["检查", "安静"],
          },
        }],
      },
      stage: {
        name: `TavernCharacterAgentV2:character_reflection:${A}`,
        provider: "fixture",
        elapsedMs: 0,
      },
    };
  },
});

const actorA = instance.runtime.actors.get(A);
const actorB = instance.runtime.actors.get(B);
actorA.privateState.memoryContext = {
  ...(actorA.privateState.memoryContext || {}),
  ownerCharacterId: A,
  episodes: [{
    id: MEMORY_ID,
    ownerCharacterId: A,
    kind: "episodic_perception",
    objectiveEventId: "event:reflection:v27:owned",
    sourceImpactId: "impact:reflection:v27:owned",
    sourceImpactIds: ["impact:reflection:v27:owned"],
    evidenceIds: ["evidence:reflection:v27:owned"],
    perceivedAt: { seconds: 10, worldDay: 0, locationId: "loc_xyy_tavern", zoneId: "hall" },
    perception: { modality: "proprioception", content: PRIVATE_CONTENT, topic: "收工后的检查", fragments: [] },
    semanticFrame: {
      id: "frame:reflection:v27:owned",
      kind: "observation",
      predicate: "check",
      topicId: "door-check",
      lexicalAnchors: ["门闩", "检查"],
      importance: 0.82,
    },
    source: { kind: "firsthand", confidence: 0.98 },
    retentionStrength: 0.82,
    accessibility: 0.8,
    importance: 0.82,
    retrievalCues: ["门闩", "检查"],
    interpretations: [],
    status: "active",
  }],
  beliefs: [],
};
actorA.privateState.reflectionState = {
  schemaVersion: "character-reflection-v1",
  authority: "character-private-reflection-ledger",
  ownerCharacterId: A,
  formulaVersion: 1,
  threshold: 1,
  accumulatedImportance: 0,
  accumulationSourceMemoryIds: [],
  accountedImportanceByMemoryId: { [MEMORY_ID]: 0.82 },
  pendingOpportunity: {
    schemaVersion: "character-reflection-v1",
    authority: "character-private-reflection-opportunity",
    ownerCharacterId: A,
    opportunityId: OPPORTUNITY_ID,
    sequence: 1,
    status: "due",
    dueAtSeconds: 0,
    accumulatedImportance: 1.1,
    sourceMemoryIds: [MEMORY_ID],
    decisionAuthority: "character-agent",
    selection: null,
  },
  completedOpportunityIds: [],
  completedOpportunities: [],
  nextOpportunitySequence: 2,
};

const worldBefore = structuredClone(instance.coordinator.worldState);
const journalBefore = structuredClone(instance.coordinator.journal);
const otherBefore = structuredClone(actorB.privateState);
const turn = await instance.runtime.runNext();

assert.equal(turn.characterId, A);
assert.equal(turn.wake.causeType, "reflection_due");
assert.equal(turn.actionAttempt, null);
assert.equal(turn.outcome, null);
assert.equal(turn.privateResult.turnKind, "reflection");
assert.equal(turn.privateResult.reflectionCompleted, true);
assert.equal(calls.length, 1);
assert.deepEqual(instance.coordinator.worldState, worldBefore);
assert.deepEqual(instance.coordinator.journal, journalBefore);
assert.deepEqual(actorB.privateState, otherBefore);
assert.equal(actorA.privateState.reflectionState.pendingOpportunity, null);
const belief = actorA.privateState.memoryContext.beliefs.find((row) => row.kind === "reflection_insight");
assert.equal(belief.proposition, INSIGHT);
assert.deepEqual(belief.sourceMemoryIds, [MEMORY_ID]);

const observer = projectTavernV27TurnForObserver(turn, state.characters);
assert.equal(observer.turnKind, "reflection");
assert.equal(observer.submissionMode, "reflection");
assert.equal(observer.characterAgentCompleted, true);
assert.equal(observer.acceptedStageCount, 1);
assert.equal(observer.expectedAcceptedStageCount, 1);
assert.equal(observer.outcome, null);
assert.deepEqual(observer.publicRealization, {
  actionType: "",
  targetCharacterId: "",
  speech: "",
  visibleAction: "",
  observableAffectiveTexture: [],
});
const observerText = JSON.stringify(observer);
for (const secret of [MEMORY_ID, PRIVATE_CONTENT, INSIGHT, OPPORTUNITY_ID, "sourceMemoryIds", "reflectionState"]) {
  assert.equal(observerText.includes(secret), false, `observer reflection status must not leak ${secret}`);
}
assert.equal(await instance.runtime.runNext(), null, "the settled opportunity must not repeat");

console.log("tavern v2.7 reflection wake isolation contracts passed");
