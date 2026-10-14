import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFileWorldRuntimeSessionRepository } from "../src/server/simulation/worldRuntimeSessionRepository.mjs";
import { createWorldRuntimeSessionService } from "../src/server/simulation/worldRuntimeSessionService.mjs";

const rootDir = await mkdtemp(path.join(os.tmpdir(), "gtown-stage-persistence-"));
try {
  const repository = createFileWorldRuntimeSessionRepository({ rootDir });
  const sessionKey = { projectId: "test", branchId: "main", runtimeId: "stage-recovery" };
  const auditRecord = { phase: "stage_response_received", stageTicket: "frozen-stage", output: { literalSpeech: "保留最初的原话。" } };
  let calls = 0;
  const createService = () => createWorldRuntimeSessionService({ repository,
    runtimeFactory: async ({ checkpoint, persistExecutionCheckpoint }) => {
      let state = structuredClone(checkpoint || { accepted: false });
      return { async checkpoint() { return structuredClone(state); },
        async advance() { if (!state.accepted) { calls++; state.accepted = true; await persistExecutionCheckpoint?.({ phase: "stage_accepted", auditRecord }); } }, close() {} };
    },
    executeCommand: async ({ runtime, command }) => {
      await runtime.advance();
      if (command.input.crash) throw Object.assign(new Error("crash after accepted stage"), { code: "SIMULATED_EXIT" });
      return { result: { accepted: true } };
    },
  });
  await assert.rejects(createService().runCommand({ sessionKey, commandId: "first", expectedSessionRevision: 0,
    bootstrap: { definition: {} }, commandInput: { crash: true } }), { code: "SIMULATED_EXIT" });
  const saved = await repository.load(sessionKey);
  assert.equal(saved.checkpoint.accepted, true, "the persistent UI/service path must not roll back an accepted stage after failure");
  const result = await createService().runCommand({ sessionKey, commandId: "resume", expectedSessionRevision: saved.sessionRevision, commandInput: { crash: false } });
  assert.equal(result.result.accepted, true);
  assert.equal(calls, 1, "a new command must resume saved execution rather than repeat the model decision");
  for (let i = 0; i < 4; i++) {
    const current = await repository.load(sessionKey);
    await createService().runCommand({ sessionKey, commandId: `later:${i}`, expectedSessionRevision: current.sessionRevision, commandInput: { crash: false } });
  }
  const current = await repository.load(sessionKey);
  await repository.appendExecutionRecord(sessionKey, { sessionId: current.sessionId, expectedSessionRevision: current.sessionRevision, record: auditRecord });
  await assert.rejects(repository.appendExecutionRecord(sessionKey, { sessionId: current.sessionId, expectedSessionRevision: 0, record: { forged: true } }), { code: "WORLD_RUNTIME_SESSION_REVISION_CONFLICT" });
  const auditPaths = (await readdir(rootDir, { recursive: true })).filter(name => name.includes("execution-audit/") && name.endsWith(".json"));
  assert.equal(auditPaths.length, 1, "immutable raw replies survive snapshot rotation and duplicate capture");
  assert.deepEqual(JSON.parse(await readFile(path.join(rootDir, auditPaths[0]), "utf8")).record, auditRecord);
  console.log("Persistent service preserves accepted stages and resumes them without another decision.");
} finally { await rm(rootDir, { recursive: true, force: true }); }
