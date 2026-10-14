import assert from "node:assert/strict";

import { createCharacterAgentMemoryState } from "../src/engine/characterAgentMemory.js";
import { tavernCharacterAgentV2SystemPrompt } from "../src/server/pipeline/tavernCharacterAgentV2.mjs";
import { runCharacterReflectionTurn } from "../src/server/simulation/characterReflectionTurn.mjs";

const OWNER = "char:reflection-turn:owner";
const OTHER = "char:reflection-turn:other";
const SOURCE_MEMORY_ID = "episode:reflection-turn:source";
const UNRELATED_MEMORY_ID = "episode:reflection-turn:unrelated";
const OPPORTUNITY_ID = "reflection-opportunity:reflection-turn-owner:1";
const SOURCE_CONTENT = "雨停后，我独自把门前的木牌扶正。";
const UNRELATED_SECRET = "这段本人记忆不属于当前反思机会。";
const OTHER_SECRET = "另一个角色的私人记忆绝不能进入反思投影。";
const SELF_CLAIM = "我习惯先把眼前能修好的小事做好。";
const PRIVATE_PURPOSE = "稍后确认木牌是否仍然稳固。";
const REJECTED_PRIVATE_INSIGHT = "被拒绝的私有洞见正文绝不能进入修正反馈。";

function episode({ id, content, atSeconds, importance = 0.8 }) {
  return {
    id,
    ownerCharacterId: OWNER,
    kind: "episodic_perception",
    objectiveEventId: `event:${id}`,
    sourceImpactId: `impact:${id}`,
    sourceImpactIds: [`impact:${id}`],
    evidenceIds: [`evidence:${id}`],
    perceivedAt: {
      seconds: atSeconds,
      worldDay: 0,
      locationId: "place:front-step",
      zoneId: "front-step",
    },
    perception: {
      modality: "vision",
      content,
      topic: "木牌",
      fragments: [],
    },
    semanticFrame: {
      id: `frame:${id}`,
      kind: "observation",
      predicate: "notice",
      topicId: "wooden-sign",
      lexicalAnchors: ["木牌"],
      importance,
    },
    source: { kind: "firsthand", confidence: 0.95 },
    retentionStrength: 0.82,
    accessibility: 0.78,
    importance,
    retrievalCues: ["木牌"],
    interpretations: [],
    status: "active",
  };
}

function pendingOpportunity() {
  return {
    schemaVersion: "character-reflection-v1",
    authority: "character-private-reflection-opportunity",
    ownerCharacterId: OWNER,
    opportunityId: OPPORTUNITY_ID,
    sequence: 1,
    status: "due",
    dueAtSeconds: 30,
    accumulatedImportance: 1.1,
    sourceMemoryIds: [SOURCE_MEMORY_ID],
    decisionAuthority: "character-agent",
    selection: null,
  };
}

function privateState() {
  const memoryContext = createCharacterAgentMemoryState(OWNER, {
    selfNarrative: {
      currentClaims: [{
        id: "self-claim:reflection-turn:care",
        claim: SELF_CLAIM,
        confidence: 0.79,
        sourceEpisodeIds: [SOURCE_MEMORY_ID],
      }],
    },
  });
  memoryContext.episodes = [
    episode({ id: SOURCE_MEMORY_ID, content: SOURCE_CONTENT, atSeconds: 20, importance: 0.9 }),
    episode({ id: UNRELATED_MEMORY_ID, content: UNRELATED_SECRET, atSeconds: 25, importance: 0.2 }),
  ];
  return {
    ownerCharacterId: OWNER,
    memoryContext,
    reflectionState: {
      schemaVersion: "character-reflection-v1",
      authority: "character-private-reflection-ledger",
      ownerCharacterId: OWNER,
      formulaVersion: 1,
      threshold: 1,
      accumulatedImportance: 0,
      accumulationSourceMemoryIds: [],
      accountedImportanceByMemoryId: {
        [SOURCE_MEMORY_ID]: 0.9,
      },
      pendingOpportunity: pendingOpportunity(),
      completedOpportunityIds: [],
      completedOpportunities: [],
      nextOpportunitySequence: 2,
      lastAdvancedAtSeconds: 30,
    },
    ecologyState: {
      characterPsychologyV2State: {
        continuationIntentions: [{
          ownerAuthority: "character-agent",
          ownerCharacterId: OWNER,
          intentionId: "plan-step:reflection-turn:check-sign",
          triggerType: "elapsed_without_progress",
          intendedPrimitive: "observe",
          targetHandle: "object:wooden-sign",
          linkedSourceIds: [SOURCE_MEMORY_ID],
          minimumDelaySeconds: 60,
          createdAtCharacterSeconds: 20,
          privatePurpose: PRIVATE_PURPOSE,
          deferrals: 0,
          maxDeferrals: 2,
          status: "active",
        }],
      },
    },
    privateSecret: "完整 privateState 不能传给反思 stage。",
    otherCharacterPrivateState: {
      ownerCharacterId: OTHER,
      memoryContext: {
        ownerCharacterId: OTHER,
        episodes: [{ id: "episode:other:secret", content: OTHER_SECRET }],
      },
    },
  };
}

function forbiddenSurfaceKeys(value, path = "result", rows = []) {
  if (!value || typeof value !== "object") return rows;
  for (const [key, child] of Object.entries(value)) {
    if (["worldPatch", "worldState", "worldMutation", "utterance", "speech", "literalSpeech"].includes(key)) {
      rows.push(`${path}.${key}`);
    }
    forbiddenSurfaceKeys(child, `${path}.${key}`, rows);
  }
  return rows;
}

// Tracer bullet: one lawful reflection is private, source-bounded and side-effect free.
{
  const before = privateState();
  const original = structuredClone(before);
  const stageCalls = [];
  const result = await runCharacterReflectionTurn({
    ownerCharacterId: OWNER,
    privateState: before,
    pendingOpportunity: pendingOpportunity(),
    nowSeconds: 31,
    async runStage(input, options) {
      stageCalls.push({ input: structuredClone(input), options: structuredClone(options) });
      return {
        ownerAuthority: "character-agent",
        insights: [{
          proposition: "我会在无人催促时主动维护自己在意的地方。",
          sourceMemoryIds: [SOURCE_MEMORY_ID],
          confidence: 0.76,
          importance: 0.72,
          semanticFrame: {
            kind: "reflection_insight",
            predicate: "maintain",
            topicId: "self-directed-care",
            lexicalAnchors: ["主动", "维护"],
          },
        }],
      };
    },
  });

  assert.equal(stageCalls.length, 1, "one opportunity must invoke exactly one reflection stage");
  assert.equal(stageCalls[0].options.stage, "character_reflection");
  assert.equal(stageCalls[0].input.ownerCharacterId, OWNER);
  assert.deepEqual(
    stageCalls[0].input.privateContext.memorySlice.episodes.map((row) => row.id),
    [SOURCE_MEMORY_ID],
    "the reflection stage may see only memories cited by this opportunity",
  );
  assert.deepEqual(stageCalls[0].input.privateContext.memorySlice.beliefs, []);
  assert.equal(stageCalls[0].input.privateContext.selfNarrative.currentClaims[0].claim, SELF_CLAIM);
  assert.equal(
    stageCalls[0].input.privateContext.activePlanProjection.activePlanSteps[0].privatePurpose,
    PRIVATE_PURPOSE,
  );
  assert.equal(stageCalls[0].input.privateContext.activePlanProjection.selection, null);
  const projectedText = JSON.stringify(stageCalls[0].input);
  assert.equal(projectedText.includes(SOURCE_CONTENT), true);
  assert.equal(projectedText.includes(UNRELATED_SECRET), false);
  assert.equal(projectedText.includes(OTHER_SECRET), false);
  assert.equal(projectedText.includes("完整 privateState"), false);

  const insight = result.privateStatePatch.memoryContext.beliefs.find((row) => (
    row.kind === "reflection_insight"
  ));
  assert.ok(insight, "a lawful Character-authored insight must enter private memory");
  assert.equal(insight.ownerCharacterId, OWNER);
  assert.deepEqual(insight.sourceMemoryIds, [SOURCE_MEMORY_ID]);
  assert.equal(insight.sourceReflectionOpportunityId, OPPORTUNITY_ID);
  assert.equal(result.privateStatePatch.reflectionState.pendingOpportunity, null);
  assert.equal(result.actionAttempt, null);
  assert.equal(result.worldChanged, false);
  assert.deepEqual(forbiddenSurfaceKeys(result), [], "a reflection result cannot contain world or speech payloads");
  assert.deepEqual(before, original, "the turn must return a patch without mutating current private state");
}

// One rejected reflection may be rewritten by the same Character in the same
// stage. The feedback is validator metadata only and cannot echo private text.
{
  const before = privateState();
  const stageCalls = [];
  const accepted = [];
  const rejected = [];
  const result = await runCharacterReflectionTurn({
    ownerCharacterId: OWNER,
    agentTurnId: "agent-turn:reflection:repair",
    privateState: before,
    pendingOpportunity: pendingOpportunity(),
    nowSeconds: 31,
    maxStageProtocolRepairs: 1,
    onStageAccepted(event) {
      accepted.push(structuredClone(event));
    },
    onStageRejected(event) {
      rejected.push(structuredClone(event));
    },
    async runStage(input, options) {
      stageCalls.push({ input: structuredClone(input), options: structuredClone(options) });
      if (stageCalls.length === 1) {
        return {
          reflection: {
            ownerAuthority: "character-agent",
            insights: [{
              proposition: REJECTED_PRIVATE_INSIGHT,
              sourceMemoryIds: [SOURCE_MEMORY_ID],
            }],
            utterance: REJECTED_PRIVATE_INSIGHT,
          },
          stage: { responseId: "response:reflection:rejected" },
        };
      }
      return {
        reflection: { ownerAuthority: "character-agent", insights: [] },
        stage: { responseId: "response:reflection:accepted" },
      };
    },
  });

  assert.equal(stageCalls.length, 2);
  assert.equal(stageCalls[0].input.protocolRepairFeedback, undefined);
  assert.equal(stageCalls[0].options.protocolRepairAttempt, 0);
  assert.equal(stageCalls[1].options.protocolRepairAttempt, 1);
  const feedback = stageCalls[1].input.protocolRepairFeedback;
  assert.equal(feedback.operation, "same-character-same-stage-rewrite");
  assert.equal(feedback.stage, "character_reflection");
  assert.match(tavernCharacterAgentV2SystemPrompt(stageCalls[1].input), /上一份同阶段输出没有被协议接受/u);
  assert.deepEqual(Object.keys(feedback.violations[0]).sort(), ["code", "message", "path"]);
  assert.equal(JSON.stringify(feedback).includes(REJECTED_PRIVATE_INSIGHT), false);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].repairAttempt, 1);
  assert.deepEqual(Object.keys(rejected[0].issues[0]).sort(), ["code", "message", "path"]);
  assert.equal(accepted.length, 1);
  assert.equal(result.stages.length, 2);
  assert.equal(result.protocolRepairCount, 1);
  assert.equal(result.privateStatePatch.reflectionState.pendingOpportunity, null);
}

// A valid decision to form no insight still settles this one opportunity.
{
  const before = privateState();
  const originalBeliefs = structuredClone(before.memoryContext.beliefs);
  let stageCallCount = 0;
  const result = await runCharacterReflectionTurn({
    ownerCharacterId: OWNER,
    privateState: before,
    pendingOpportunity: pendingOpportunity(),
    nowSeconds: 32,
    async runStage() {
      stageCallCount += 1;
      return { ownerAuthority: "character-agent", insights: [] };
    },
  });

  assert.equal(stageCallCount, 1);
  assert.equal(result.privateStatePatch.reflectionState.pendingOpportunity, null);
  assert.deepEqual(result.privateStatePatch.memoryContext.beliefs, originalBeliefs);
  const completed = result.privateStatePatch.reflectionState.completedOpportunities.at(-1);
  assert.equal(completed.opportunityId, OPPORTUNITY_ID);
  assert.equal(completed.insightCount, 0, "zero lawful insights must still consume the opportunity");
  assert.equal(result.actionAttempt, null);
  assert.equal(result.worldChanged, false);
}

// A due opportunity must remain reflectable after its source episode ages out
// of the separately bounded durable-memory window.
{
  const before = privateState();
  const durableOpportunity = {
    ...pendingOpportunity(),
    sourceMemorySnapshots: [episode({
      id: SOURCE_MEMORY_ID,
      content: SOURCE_CONTENT,
      atSeconds: 20,
      importance: 0.9,
    })],
  };
  before.memoryContext.episodes = before.memoryContext.episodes
    .filter((row) => row.id !== SOURCE_MEMORY_ID);
  before.reflectionState.pendingOpportunity = structuredClone(durableOpportunity);
  let projectedSourceIds = [];
  const result = await runCharacterReflectionTurn({
    ownerCharacterId: OWNER,
    privateState: before,
    pendingOpportunity: durableOpportunity,
    nowSeconds: 32,
    async runStage(input) {
      projectedSourceIds = input.privateContext.memorySlice.episodes.map((row) => row.id);
      return {
        ownerAuthority: "character-agent",
        insights: [{
          proposition: "重要经历即使离开日常记忆窗口，仍可以在到期的反思中被本人重新理解。",
          sourceMemoryIds: [SOURCE_MEMORY_ID],
        }],
      };
    },
  });

  assert.deepEqual(projectedSourceIds, [SOURCE_MEMORY_ID]);
  assert.ok(result.privateStatePatch.memoryContext.beliefs.some((row) => (
    row.kind === "reflection_insight" && row.sourceMemoryIds.includes(SOURCE_MEMORY_ID)
  )));
  assert.equal(result.privateStatePatch.reflectionState.pendingOpportunity, null);
}

// A legacy checkpoint may already have lost every cited source before source
// snapshots existed. It must consume the stale opportunity once, without a
// provider retry loop or inventing an insight.
{
  const before = privateState();
  before.memoryContext.episodes = before.memoryContext.episodes
    .filter((row) => row.id !== SOURCE_MEMORY_ID);
  let stageCallCount = 0;
  const result = await runCharacterReflectionTurn({
    ownerCharacterId: OWNER,
    privateState: before,
    pendingOpportunity: pendingOpportunity(),
    nowSeconds: 32,
    async runStage() {
      stageCallCount += 1;
      return { ownerAuthority: "character-agent", insights: [] };
    },
  });

  assert.equal(stageCallCount, 0, "an empty legacy source slice cannot justify a model call");
  assert.equal(result.sourceMemoryDegraded, true);
  assert.equal(result.degradationReason, "source-memory-aged-out");
  assert.deepEqual(result.stages, []);
  assert.equal(result.protocolRepairCount, 0);
  assert.equal(result.privateStatePatch.reflectionState.pendingOpportunity, null);
  assert.equal(result.privateStatePatch.reflectionState.completedOpportunities.at(-1).insightCount, 0);
}

// A frozen source remains owner-private checkpoint data; another Character's
// record may not be smuggled into the reflection projection.
{
  const before = privateState();
  const foreignOpportunity = {
    ...pendingOpportunity(),
    sourceMemorySnapshots: [{
      ...episode({ id: SOURCE_MEMORY_ID, content: OTHER_SECRET, atSeconds: 20 }),
      ownerCharacterId: OTHER,
    }],
  };
  before.reflectionState.pendingOpportunity = structuredClone(foreignOpportunity);
  await assert.rejects(
    runCharacterReflectionTurn({
      ownerCharacterId: OWNER,
      privateState: before,
      pendingOpportunity: foreignOpportunity,
      nowSeconds: 32,
      async runStage() {
        return { ownerAuthority: "character-agent", insights: [] };
      },
    }),
    (error) => error?.code === "CHARACTER_REFLECTION_TURN_OWNER_MISMATCH",
  );
}

// A guessed owned memory outside the opportunity cannot authorize an insight.
{
  const before = privateState();
  const original = structuredClone(before);
  let stageCallCount = 0;
  await assert.rejects(
    runCharacterReflectionTurn({
      ownerCharacterId: OWNER,
      privateState: before,
      pendingOpportunity: pendingOpportunity(),
      nowSeconds: 33,
      async runStage() {
        stageCallCount += 1;
        return {
          ownerAuthority: "character-agent",
          insights: [{
            proposition: "不能用机会之外的记忆生成洞见。",
            sourceMemoryIds: [UNRELATED_MEMORY_ID],
          }],
        };
      },
    }),
    (error) => error?.code === "CHARACTER_REFLECTION_SOURCE_NOT_OWNED",
  );
  assert.equal(stageCallCount, 1);
  assert.deepEqual(before, original, "an illegal source must leave the pending opportunity unconsumed");
  assert.equal(before.reflectionState.pendingOpportunity.opportunityId, OPPORTUNITY_ID);
}

// Raw model output has no authority to smuggle world, action, or speech writes.
{
  const before = privateState();
  const original = structuredClone(before);
  await assert.rejects(
    runCharacterReflectionTurn({
      ownerCharacterId: OWNER,
      privateState: before,
      pendingOpportunity: pendingOpportunity(),
      nowSeconds: 34,
      async runStage() {
        return {
          ownerAuthority: "character-agent",
          insights: [],
          worldPatch: { weather: "rain" },
          actionAttempt: { primitive: "speak" },
          utterance: "这句话不应被说出口。",
        };
      },
    }),
    (error) => error?.code === "CHARACTER_REFLECTION_WORLD_WRITE_FORBIDDEN",
  );
  assert.deepEqual(before, original, "forbidden world or expression output must not consume the opportunity");
}

console.log("character reflection turn contracts passed");
