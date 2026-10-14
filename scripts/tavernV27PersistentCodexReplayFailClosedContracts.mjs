import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(tmpdir(), "gtown-v27-codex-replay-contract-"));
const runner = path.resolve("scripts/runTavernV27PersistentCodexInteraction.mjs");

function run(extraEnvironment = {}) {
  return spawnSync(process.execPath, [runner], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      PATH: process.env.PATH || "/usr/bin:/bin",
      HOME: process.env.HOME || tmpdir(),
      GTOWN_V27_CODEX_MODEL: "gpt-5.6-sol",
      GTOWN_V27_CODEX_REASONING_EFFORT: "medium",
      GTOWN_V27_CODEX_ACTOR_TURNS: "2",
      GTOWN_V27_CODEX_REPORT_PATH: path.join(root, "must-not-run.json"),
      ...extraEnvironment,
    },
  });
}

try {
  const acceptedReportPath = path.join(root, "accepted-stage-report.json");
  await writeFile(acceptedReportPath, JSON.stringify({
    configuration: {
      model: "gpt-5.6-sol",
      reasoningEffort: "medium",
      targetActorTurns: 2,
    },
    counters: { providerRequestsAttempted: 1 },
    stageCalls: [{
      characterId: "char_xyy_xiezenshi",
      phase: "awaiting_subjective_appraisal",
      accepted: true,
      output: { summary: "historical output is evidence, not conversation state" },
    }],
  }), "utf8");
  const acceptedReplay = run({
    GTOWN_V27_CODEX_DRY_RUN: "1",
    GTOWN_V27_CODEX_REPLAY_REPORT: acceptedReportPath,
  });
  assert.notEqual(acceptedReplay.status, 0);
  assert.match(
    `${acceptedReplay.stdout}\n${acceptedReplay.stderr}`,
    /Accepted stage outputs cannot recreate the private provider conversation/u,
  );

  const invalidResumePath = path.join(root, "resume-without-provider-conversation.json");
  await writeFile(invalidResumePath, JSON.stringify({
    key: {
      projectId: "project:contract",
      branchId: "branch:contract",
      runtimeId: "tavern-v27-model:contract",
    },
    sessionId: "session:contract",
    sessionRevision: 1,
    checkpoint: { worldVersion: 1 },
  }), "utf8");
  const invalidResume = run({
    GTOWN_V27_CODEX_AUTHORIZED: "1",
    GTOWN_V27_CODEX_RESUME_SESSION_RECORD: invalidResumePath,
    GTOWN_V27_CODEX_RESUME_COMPLETED_ACTOR_TURNS: "1",
  });
  assert.notEqual(invalidResume.status, 0);
  assert.match(
    `${invalidResume.stdout}\n${invalidResume.stderr}`,
    /does not contain restorable private Codex CharacterModel conversations/u,
  );

  const dryReportPath = path.join(root, "dry-run-report.json");
  const dryCheckpointPath = path.join(root, "dry-run-checkpoint.json");
  const dryRun = run({
    GTOWN_V27_CODEX_DRY_RUN: "1",
    GTOWN_V27_CODEX_REPORT_PATH: dryReportPath,
    GTOWN_V27_CODEX_CHECKPOINT_REPORT: dryCheckpointPath,
  });
  assert.equal(dryRun.status, 0, `${dryRun.stdout}\n${dryRun.stderr}`);
  const durableCheckpoint = JSON.parse(await readFile(dryCheckpointPath, "utf8"));
  assert.ok(durableCheckpoint.sessionId);
  assert.ok(Number(durableCheckpoint.sessionRevision) >= 1);
  assert.ok(durableCheckpoint.checkpoint, "the runner must copy the repository checkpoint before deleting its private temp root");

  const dryReport = JSON.parse(await readFile(dryReportPath, "utf8"));
  assert.equal(dryReport.schemaVersion, "tavern-v27-persistent-codex-interaction-report-v2");
  assert.equal(dryReport.configuration.enableDayPlanning, true,
    "the persistent quality runner must exercise the same private day-planning product path by default");
  assert.equal(Object.hasOwn(dryReport.configuration, "targetTwoWayExchanges"), false,
    "actor-turn pairs must not be mislabeled as completed two-way dialogue exchanges");
  assert.equal(Object.hasOwn(dryReport.counters, "twoWayExchangeSlotsCompleted"), false,
    "maintenance turns must not inflate a dialogue-exchange counter");
  assert.equal(
    dryReport.counters.spokenTurnsCompleted,
    dryReport.authorReviewTurns.filter((turn) => String(turn?.publicRealization?.speech || "").trim()).length,
  );
  assert.equal(Number.isInteger(dryReport.counters.causalSpeechRepliesCompleted), true);
  assert.equal(Number.isInteger(dryReport.counters.conversationThreadsObserved), true);
  assert.equal(dryReport.visibility, "author-review-private");
  assert.equal(dryReport.publicExchange.length, dryReport.authorReviewTurns.length);
  assert.equal(JSON.stringify(dryReport.publicExchange).includes("observerOnlyPsychology"), false,
    "the explicit public projection must never contain author-only psychology");
  assert.equal(JSON.stringify(dryReport.publicExchange).includes("privateDecisionBasis"), false);
  assert.equal(Object.hasOwn(dryReport, "visibleExchange"), false,
    "an ambiguous whole-turn field must not be mistaken for the public projection");
  const extendedReplayPath = path.join(root, "extended-replay-source.json");
  const extendedReportPath = path.join(root, "extended-dry-run-report.json");
  const extendedCheckpointPath = path.join(root, "extended-dry-run-checkpoint.json");
  await writeFile(extendedReplayPath, JSON.stringify({
    ...dryReport,
    counters: {
      ...dryReport.counters,
      providerRequestsAttempted: 4,
    },
  }), "utf8");
  const extendedDryRun = run({
    GTOWN_V27_CODEX_DRY_RUN: "1",
    GTOWN_V27_CODEX_ACTOR_TURNS: "3",
    GTOWN_V27_CODEX_AUTHORIZATION_TOTAL_REQUEST_LIMIT: "5",
    GTOWN_V27_CODEX_AUTHORIZATION_PRIOR_REQUESTS: "4",
    GTOWN_V27_CODEX_REPLAY_REPORT: extendedReplayPath,
    GTOWN_V27_CODEX_RESUME_SESSION_RECORD: dryCheckpointPath,
    GTOWN_V27_CODEX_RESUME_COMPLETED_ACTOR_TURNS: "2",
    GTOWN_V27_CODEX_REPORT_PATH: extendedReportPath,
    GTOWN_V27_CODEX_CHECKPOINT_REPORT: extendedCheckpointPath,
  });
  assert.equal(extendedDryRun.status, 0, `${extendedDryRun.stdout}\n${extendedDryRun.stderr}`);
  const extendedReport = JSON.parse(await readFile(extendedReportPath, "utf8"));
  assert.equal(extendedReport.configuration.targetActorTurns, 3);
  assert.equal(extendedReport.configuration.authorizationTotalProviderRequestLimit, 5);
  assert.equal(extendedReport.configuration.authorizationPriorProviderRequests, 4);
  assert.equal(extendedReport.configuration.authorizationRemainingProviderRequestLimit, 1);
  assert.equal(extendedReport.counters.actorTurnsCompleted, 3);
  assert.equal(extendedReport.counters.providerRequestsAttempted, 4);
  assert.equal(extendedReport.authorReviewTurns.length, 3);
  assert.equal(extendedReport.publicExchange.length, 3);

  console.log(JSON.stringify({
    status: "all-passed",
    checks: {
      acceptedStageReplayCannotForgeProviderContinuity: true,
      resumeWithoutPrivateProviderCheckpointFailsBeforeExecution: true,
      durableCheckpointSurvivesRunnerCleanup: true,
      durableResumeMayExtendTargetWithoutResettingCumulativeAuthorization: true,
      externalCodexNeverCalled: true,
    },
  }, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
