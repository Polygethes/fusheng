import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createFileWorldRuntimeSessionRepository } from "../src/server/simulation/worldRuntimeSessionRepository.mjs";
import { createWorldRuntimeSessionService } from "../src/server/simulation/worldRuntimeSessionService.mjs";

const rootDir = await mkdtemp(path.join(tmpdir(), "gtown-session-execution-context-"));
const sessionKey = {
  projectId: "project:execution-context",
  branchId: "branch:main",
  runtimeId: "runtime:two-agent-model",
};
const executionSecret = "authorization:must-never-persist";
let commandRuntimeFactoryCalls = 0;
let executorCalls = 0;
const runtimeContexts = [];
const executorContexts = [];

try {
  const repository = createFileWorldRuntimeSessionRepository({ rootDir });
  const service = createWorldRuntimeSessionService({
    repository,
    idFactory: () => "session:execution-context",
    runtimeFactory: async ({ purpose, checkpoint, executionContext }) => {
      if (purpose === "command") commandRuntimeFactoryCalls += 1;
      runtimeContexts.push({ purpose, executionContext });
      let value = Number(checkpoint?.value || 0);
      return {
        increment() { value += 1; },
        async checkpoint() { return { value }; },
      };
    },
    executeCommand: async ({ runtime, executionContext }) => {
      executorCalls += 1;
      executorContexts.push(executionContext);
      runtime.increment();
      return { result: { ok: true } };
    },
  });

  const first = await service.runCommand({
    sessionKey,
    commandId: "command:first",
    expectedSessionRevision: 0,
    bootstrap: {
      definition: { cast: ["xie", "luo"] },
      checkpoint: { value: 0 },
    },
    commandInput: { operation: "start" },
    executionContext: {
      authorizationAcknowledged: true,
      authorizationId: executionSecret,
      providerCapability: { run: "not-serializable-authority" },
    },
  });

  assert.equal(first.replayed, false);
  assert.equal(commandRuntimeFactoryCalls, 1);
  assert.equal(executorCalls, 1);
  assert.equal(runtimeContexts.find((row) => row.purpose === "command")?.executionContext?.authorizationId, executionSecret);
  assert.equal(executorContexts[0]?.authorizationId, executionSecret);

  const stored = await repository.load(sessionKey);
  assert.equal(JSON.stringify(stored).includes(executionSecret), false, "execution authority must never enter the durable session record");
  assert.equal(JSON.stringify(stored).includes("authorizationAcknowledged"), false);
  assert.equal(JSON.stringify(stored).includes("providerCapability"), false);

  const replay = await service.runCommand({
    sessionKey,
    commandId: "command:first",
    expectedSessionRevision: 0,
    commandInput: { operation: "start" },
    executionContext: {
      authorizationAcknowledged: true,
      authorizationId: "authorization:replay-must-not-run",
    },
  });
  assert.equal(replay.replayed, true);
  assert.equal(commandRuntimeFactoryCalls, 1, "completed replay may not reconstruct a provider-backed runtime");
  assert.equal(executorCalls, 1, "completed replay may not execute the command again");

  console.log(JSON.stringify({
    status: "all-passed",
    checks: {
      executionContextReachesCommandRuntime: true,
      executionContextReachesExecutor: true,
      executionContextNeverPersists: true,
      completedReplayDoesNotReuseCapability: true,
    },
  }, null, 2));
} finally {
  await rm(rootDir, { recursive: true, force: true });
}
