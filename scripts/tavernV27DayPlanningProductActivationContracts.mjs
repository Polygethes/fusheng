import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { createTavernV27FixtureStageRunner } from "../src/server/pipeline/tavernV27FixtureStage.mjs";
import { createTavernV27SessionAdapter } from "../src/server/pipeline/tavernV27SessionAdapter.mjs";
import { createFileWorldRuntimeSessionRepository } from "../src/server/simulation/worldRuntimeSessionRepository.mjs";

const CHARACTER_ID = "char_xyy_xiezenshi";
const sessionKey = {
  projectId: "project:day-planning-product",
  branchId: "branch:main",
  runtimeId: "tavern-v27:day-planning-product",
};
const rootDir = await mkdtemp(path.join(tmpdir(), "gtown-v27-day-planning-product-"));
let stageCalls = 0;

function stateEnvelope() {
  return {
    state: buildPlayableWorldFromSetup({
      setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
      setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
    }),
    characterIds: [CHARACTER_ID],
    positions: { [CHARACTER_ID]: "hall" },
    initialWake: { characterId: CHARACTER_ID, kind: "opportunity_window" },
  };
}

function fixtureStageFactory() {
  const fixture = createTavernV27FixtureStageRunner({
    planForTurn: () => ({
      intention: "先把身体安顿下来，再考虑今天其余时段",
      primitive: "rest",
      targetId: "",
      utterance: "",
      visibleAction: "谢真石在柜边坐稳，缓了一口气。",
      texture: [{ channel: "posture", modality: "visual", feature: "肩背慢慢松下来" }],
      privateBasis: "这是当前可以亲自完成、也不会替世界预写结果的一步。",
      continuationIntentions: [],
    }),
  });
  return async (input, options) => {
    stageCalls += 1;
    return fixture(input, options);
  };
}

try {
  const repository = createFileWorldRuntimeSessionRepository({ rootDir });
  const adapter = createTavernV27SessionAdapter({
    repository,
    stateFactory: async () => stateEnvelope(),
    fixtureStageFactory,
    enableDayPlanning: true,
  });

  const started = await adapter.execute({
    operation: "start",
    sessionKey,
    commandId: "command:day-planning-product:start",
    expectedSessionRevision: 0,
  });
  assert.equal(started.observation.turns.length, 1);
  assert.equal(started.observation.turns[0].submissionMode, "atomic",
    "the explicit bootstrap opportunity must remain the first product command");
  assert.equal(started.observation.turns[0].turnKind, "action");
  assert.ok(started.observation.turns[0].outcome,
    "the first product command must show an embodied world attempt, not only a private plan");
  assert.equal(stageCalls, 3, "the first atomic command uses the three-call provider contract");

  const continued = await adapter.execute({
    operation: "continue",
    sessionKey,
    sessionId: started.sessionRef.sessionId,
    commandId: "command:day-planning-product:continue",
    expectedSessionRevision: started.sessionRevision,
  });
  assert.equal(continued.observation.turns.length, 1);
  const planningTurn = continued.observation.turns[0];
  assert.equal(planningTurn.submissionMode, "day_planning",
    "an idle Character must privately author a near-term plan after bootstrap");
  assert.equal(planningTurn.turnKind, "day_planning");
  assert.equal(planningTurn.characterAgentCompleted, true);
  assert.equal(planningTurn.acceptedStageCount, 1);
  assert.equal(planningTurn.outcome, null);
  assert.equal(stageCalls, 4, "a day-planning command uses one stage and never auto-runs a public action");
  assert.equal(continued.worldVersion, started.worldVersion,
    "private planning advances the durable session but not the objective world");

  const publicJson = JSON.stringify(continued);
  for (const privateField of ["lifePlanState", "planBlocks", "privatePurpose", "sourceIds"]) {
    assert.equal(publicJson.includes(privateField), false, `${privateField} must remain Character-private`);
  }
  const stored = await repository.load(sessionKey);
  const actor = stored.checkpoint.actors.find((row) => row.characterId === CHARACTER_ID);
  assert.ok(actor.privateState.lifePlanState, "the private plan must survive the command checkpoint");
  assert.equal(stored.definition.pacingMode, "scene", "new product sessions default to scene pacing");
  assert.ok(actor.privateState.lifePlanState.steps.length >= 1);
  assert.ok(actor.privateState.lifePlanState.steps.length <= 4);
  assert.equal(actor.privateState.lifePlanState.horizonEndsAtSeconds - stored.checkpoint.coordinator.worldState.nowSeconds, 1800);

  console.log(JSON.stringify({
    status: "all-passed",
    checks: {
      bootstrapActionPrecedesPlanning: true,
      enabledAdapterPersistsPrivatePlan: true,
      oneTurnPerCommand: true,
      planningUsesOneStage: true,
      observerReceivesNoPlanContent: true,
    },
  }, null, 2));
} finally {
  await rm(rootDir, { recursive: true, force: true });
}
