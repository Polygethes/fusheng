import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const bridgeDir = await mkdtemp(path.join(tmpdir(), "gtown-v27-file-bridge-contract-"));

try {
  const result = spawnSync(process.execPath, [
    path.resolve("scripts/runTavernV27CharacterAgentFileBridge.mjs"),
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      PATH: process.env.PATH || "/usr/bin:/bin",
      HOME: process.env.HOME || tmpdir(),
      TAVERN_V27_BRIDGE_DIR: bridgeDir,
      TAVERN_V27_BRIDGE_MAX_TURNS: "1",
      TAVERN_V27_BRIDGE_MAX_REQUESTS: "5",
      TAVERN_V27_BRIDGE_LOCAL_FIXTURE: "1",
    },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

  const run = JSON.parse(await readFile(path.join(bridgeDir, "run.result.json"), "utf8"));
  assert.equal(run.status, "completed");
  assert.equal(run.executionMode, "local-fixture-contract");
  assert.equal(run.externalModelCalled, false);
  assert.equal(run.stageRequests, 3);
  assert.equal(run.maxRequests, 5);
  assert.equal(run.observer.turns.length, 1);
  assert.equal(run.observer.turns[0].submissionMode, "atomic");
  assert.equal(run.observer.turns[0].characterAgentCompleted, true);
  assert.deepEqual(run.requestLog.map((row) => row.phase), [
    "awaiting_subjective_appraisal_and_candidates",
    "awaiting_agent_choice_and_regulation",
    "awaiting_agent_turn_commit",
  ]);

  const finalRequest = JSON.parse(await readFile(path.join(bridgeDir, "stage-003.request.json"), "utf8"));
  const finalResponse = JSON.parse(await readFile(path.join(bridgeDir, "stage-003.response.json"), "utf8"));
  assert.equal(finalRequest.stage, "agent_turn_commit");
  assert.equal(finalRequest.phase, "awaiting_agent_turn_commit");
  assert.equal(finalResponse.ownerAuthority, "character-agent");
  assert.ok(finalResponse.actionAttempt);
  assert.ok(finalResponse.publicExpression);

  console.log(JSON.stringify({
    status: "all-passed",
    checks: {
      threeCallPhaseMapComplete: true,
      oneActorTurnUsesThreeBaseRequests: true,
      twoRequestsReservedForProtocolRepairs: true,
      atomicTurnCommitCrossesFileBridge: true,
      localFixtureContractCallsNoExternalModel: true,
    },
  }, null, 2));
} finally {
  await rm(bridgeDir, { recursive: true, force: true });
}
