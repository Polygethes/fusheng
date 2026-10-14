import assert from "node:assert/strict";

import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { createTavernV27FixtureStageRunner } from "../src/server/pipeline/tavernV27FixtureStage.mjs";
import {
  createTavernWorldRuntimeV27,
  projectTavernV27TurnForObserver,
} from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { tavernCharacterAgentV2OutputSchemaForStage } from "../src/server/pipeline/tavernCharacterAgentV2.mjs";

const A = "char_xyy_xiezenshi";
const B = "char_xyy_luozhao";
const SOURCE_MEMORY_ID = "episode:reflection:v27:replanning-source";
const OPPORTUNITY_ID = "reflection-opportunity:xiezenshi:v27:replanning";
const PRIVATE_MEMORY = "PRIVATE_MEMORY_MARKER：他只在心里记得，收工后反复确认门闩。";
const PRIVATE_INSIGHT = "PRIVATE_INSIGHT_MARKER：重复确认会让我暂时收束心绪，但也会拖住下一件事。";
const PLAN_ID = "reflection-grounded-plan:recheck-later";

function seedState() {
  return buildPlayableWorldFromSetup({
    setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
    setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
  });
}

function reflectionGroundedPlan() {
  return {
    intention: "先放下手，重新考虑手边事务",
    primitive: "gesture",
    utterance: "",
    visibleAction: "谢真石放下手。",
    bodyActions: [{ kind: "lower_hand", direction: "down", amplitude: "small", speed: "normal" }],
    texture: [],
    privateBasis: "先做一个短促而可停止的整理动作，再继续原事。",
  };
}

function assertPrivateInsightTrace(stageInput, expectedBeliefId) {
  const memoryContext = stageInput.privateContext?.memoryContext
    || stageInput.impulseGroundingSurface?.relevantMemoryContext
    || {};
  const belief = (memoryContext.beliefs || []).find((row) => row.id === expectedBeliefId);
  assert.ok(belief, `${stageInput.phase} must receive the retrieved reflection belief`);
  assert.equal(belief.kind, "reflection_insight");
  assert.equal(belief.proposition, PRIVATE_INSIGHT);
  assert.equal(belief.importance, 0.81);
  assert.deepEqual(belief.sourceMemoryIds, [SOURCE_MEMORY_ID]);
  assert.equal(belief.sourceReflectionOpportunityId, OPPORTUNITY_ID);
  assert.ok(
    stageInput.referenceContract?.ownedPsychologicalSourceIds?.includes(expectedBeliefId),
    `${stageInput.phase} must bind the retrieved insight as an owned psychological source`,
  );
}

function assertSchemaBindsInsight(stageInput, expectedBeliefId, stage) {
  const schema = tavernCharacterAgentV2OutputSchemaForStage(stageInput);
  let sourceIds = [];
  if (stage === "subjective_appraisal") {
    sourceIds = schema.properties.relevanceLinks.items.properties.sourceId.enum;
  } else if (stage === "agent_candidates") {
    sourceIds = schema.properties.candidates.items.properties.expectedEffects.items.properties.sourceId.enum;
  } else if (stage === "agent_choice_and_regulation") {
    sourceIds = schema.properties.continuationIntentions.items.properties.linkedSourceIds.items.enum;
  }
  assert.ok(sourceIds?.includes(expectedBeliefId), `${stage} schema must bind the reflection belief id`);
}

const fixture = createTavernV27FixtureStageRunner({ planForTurn: reflectionGroundedPlan });
const calls = [];
let reflectionBeliefId = "";

async function runStage(input, options = {}) {
  calls.push({ input: structuredClone(input), stage: options.stage });
  if (options.stage === "character_reflection") return {
    reflection: {
      ownerAuthority: "character-agent",
      insights: [{
        proposition: PRIVATE_INSIGHT,
        sourceMemoryIds: [SOURCE_MEMORY_ID],
        confidence: 0.76,
        importance: 0.81,
        semanticFrame: {
          kind: "reflection_insight",
          predicate: "self_regulate",
          topicId: "finish-work-checking",
          lexicalAnchors: ["收束心绪", "下一件事"],
        },
      }],
    },
    stage: {
      name: `TavernV27Fixture:character_reflection:${input.characterId}`,
      provider: "local-fixture",
      elapsedMs: 0,
    },
  };

  const result = await fixture(input, options);
  if (input.characterId !== A) return result;
  assert.ok(reflectionBeliefId, "the ordinary turn must happen after reflection settlement");

  if (options.stage === "subjective_appraisal") {
    assertPrivateInsightTrace(input, reflectionBeliefId);
    assertSchemaBindsInsight(input, reflectionBeliefId, options.stage);
    result.appraisal.relevanceLinks = [{
      sourceId: reflectionBeliefId,
      relation: "这次整理与本人刚形成的自我认识直接相关",
      strength: 0.86,
      confidence: 0.76,
    }];
  }

  if (options.stage === "agent_candidates") {
    assertPrivateInsightTrace(input, reflectionBeliefId);
    assertSchemaBindsInsight(input, reflectionBeliefId, options.stage);
    assert.equal(input.subjectiveAppraisal.relevanceLinks[0].sourceId, reflectionBeliefId);
    const selected = result.candidates.candidates[0];
    selected.expectedEffects = [{
      sourceId: reflectionBeliefId,
      direction: "support",
      magnitude: 0.82,
      confidence: 0.76,
    }];
    const unrelated = structuredClone(selected);
    unrelated.candidateId = `unrelated:${input.agentTurnId}`;
    unrelated.intention = "仍站在原处，不处理门边的小事";
    unrelated.attemptPrimitive = "none";
    unrelated.targetHandle = "";
    unrelated.actionBinding = {
      kind: "none",
      targetCharacterId: "",
      objectId: "",
      destinationId: "",
      positionId: "",
      affordanceId: "",
    };
    unrelated.expectedEffects = [];
    unrelated.timingIntent = "hold";
    result.candidates.candidates = [unrelated, selected];
  }

  if (options.stage === "agent_choice_and_regulation") {
    assertPrivateInsightTrace(input, reflectionBeliefId);
    assertSchemaBindsInsight(input, reflectionBeliefId, options.stage);
    const selected = input.generatedCandidates.find((row) => (
      row.expectedEffects?.some((effect) => effect.sourceId === reflectionBeliefId)
    ));
    assert.ok(selected, "choice must receive a candidate grounded in the reflection belief");
    result.choice.selectedCandidateId = selected.candidateId;
    result.choice.continuationIntentions = [{
      ownerAuthority: "character-agent",
      intentionId: PLAN_ID,
      triggerType: "elapsed_without_progress",
      intendedPrimitive: "observe",
      targetHandle: "",
      linkedSourceIds: [reflectionBeliefId],
      minimumDelaySeconds: 60,
      triggerThreshold: 0.5,
      maxDeferrals: 2,
      privatePurpose: "稍后再判断整理动作是否真的帮助自己回到原事。",
    }];
    result.choice.privateDecisionBasis = "选择可停止的短动作，并给稍后的自己保留重新判断机会。";
  }

  return result;
}

const state = seedState();
const instance = createTavernWorldRuntimeV27(state, {
  characterAgentCallMode: "standard", // Inject the candidate after reflection at its own seam.
  characterIds: [A, B],
  positions: { [A]: "hall", [B]: "hall" },
  runStage,
});
const actorA = instance.runtime.actors.get(A);
const actorB = instance.runtime.actors.get(B);
actorA.privateState.memoryContext = {
  ...(actorA.privateState.memoryContext || {}),
  ownerCharacterId: A,
  episodes: [{
    id: SOURCE_MEMORY_ID,
    ownerCharacterId: A,
    kind: "episodic_perception",
    objectiveEventId: "event:reflection:v27:replanning-source",
    sourceImpactId: "impact:reflection:v27:replanning-source",
    sourceImpactIds: ["impact:reflection:v27:replanning-source"],
    evidenceIds: ["evidence:reflection:v27:replanning-source"],
    perceivedAt: { seconds: 10, worldDay: 0, locationId: "loc_xyy_tavern", zoneId: "hall" },
    perception: { modality: "proprioception", content: PRIVATE_MEMORY, topic: "收工后的检查", fragments: [] },
    semanticFrame: {
      id: "frame:reflection:v27:replanning-source",
      kind: "observation",
      predicate: "check",
      topicId: "door-check",
      lexicalAnchors: ["门闩", "检查"],
      importance: 0.84,
    },
    source: { kind: "firsthand", confidence: 0.98 },
    retentionStrength: 0.84,
    accessibility: 0.82,
    importance: 0.84,
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
  accountedImportanceByMemoryId: { [SOURCE_MEMORY_ID]: 0.84 },
  pendingOpportunity: {
    schemaVersion: "character-reflection-v1",
    authority: "character-private-reflection-opportunity",
    ownerCharacterId: A,
    opportunityId: OPPORTUNITY_ID,
    sequence: 1,
    status: "due",
    dueAtSeconds: 0,
    accumulatedImportance: 1.1,
    sourceMemoryIds: [SOURCE_MEMORY_ID],
    decisionAuthority: "character-agent",
    selection: null,
  },
  completedOpportunityIds: [],
  completedOpportunities: [],
  nextOpportunitySequence: 2,
};

const reflectionTurn = await instance.runtime.runNext();
assert.equal(reflectionTurn.characterId, A);
assert.equal(reflectionTurn.privateResult.turnKind, "reflection");
const durableInsight = actorA.privateState.memoryContext.beliefs.find((row) => row.kind === "reflection_insight");
assert.ok(durableInsight, "reflection must settle a durable owner-private belief");
reflectionBeliefId = durableInsight.id;
assert.deepEqual(durableInsight.sourceMemoryIds, [SOURCE_MEMORY_ID]);
assert.equal(durableInsight.sourceReflectionOpportunityId, OPPORTUNITY_ID);

await instance.runtime.enqueueWake(A, {
  wakeId: "wake:v27:reflection-replanning:a",
  kind: "opportunity_window",
  evidenceIds: [],
  evidence: [],
});
const actionTurn = await instance.runtime.runNext({ characterId: A });
assert.equal(actionTurn.outcome.primitive, "gesture");
assert.equal(actionTurn.privateResult.agentChoice.selectedCandidateId, `fixture-candidate:${actionTurn.agentTurnId}`);
assert.equal(
  actionTurn.privateResult.worldBridge.selectedCandidate.expectedEffects[0].sourceId,
  reflectionBeliefId,
  "the chosen action must retain the private reflection source that distinguished it from the unrelated alternative",
);
const storedPlan = actorA.privateState.ecologyState.characterPsychologyV2State.continuationIntentions
  .find((row) => row.intentionId === PLAN_ID);
assert.ok(storedPlan, "the reflection-grounded follow-up must survive as Character-owned plan continuity");
assert.deepEqual(storedPlan.linkedSourceIds, [reflectionBeliefId]);

const privateSecrets = [SOURCE_MEMORY_ID, OPPORTUNITY_ID, reflectionBeliefId, PRIVATE_MEMORY, PRIVATE_INSIGHT];
const observerText = JSON.stringify(projectTavernV27TurnForObserver(actionTurn, state.characters));
for (const secret of privateSecrets) {
  assert.equal(observerText.includes(secret), false, `observer projection must not leak ${secret}`);
  assert.equal(JSON.stringify(actorB.privateState).includes(secret), false, `other Character state must not receive ${secret}`);
}

await instance.runtime.enqueueWake(B, {
  wakeId: "wake:v27:reflection-replanning:b",
  kind: "opportunity_window",
  evidenceIds: [],
  evidence: [],
});
const otherTurn = await instance.runtime.runNext({ characterId: B });
assert.equal(otherTurn.characterId, B);
const otherInputs = calls.filter((row) => row.input.characterId === B).map((row) => row.input);
assert.equal(otherInputs.length, 4);
const otherInputText = JSON.stringify(otherInputs);
for (const secret of privateSecrets) {
  assert.equal(otherInputText.includes(secret), false, `other Character Agent input must not receive ${secret}`);
}

console.log("tavern v2.7 reflection retrieval and replanning contracts passed");
