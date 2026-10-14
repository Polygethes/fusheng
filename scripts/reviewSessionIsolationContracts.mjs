import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { createTavernV27FixtureStageRunner } from "../src/server/pipeline/tavernV27FixtureStage.mjs";
import { createTavernV27SessionAdapter } from "../src/server/pipeline/tavernV27SessionAdapter.mjs";
import { createTavernV27SessionHttpHandler } from "../src/server/pipeline/tavernV27SessionHttp.mjs";
import { createFileWorldRuntimeSessionRepository } from "../src/server/simulation/worldRuntimeSessionRepository.mjs";

const rootDir = await mkdtemp(path.join(tmpdir(), "gtown-review-mode-"));
try {
  const repository = createFileWorldRuntimeSessionRepository({ rootDir });
  const stateFactory = async () => ({ state: buildPlayableWorldFromSetup({ setupWorldPrompt: "逍遥游，望梯酒馆", setupPeoplePrompt: "谢真石、洛照" }) });
  const modelAdapter = createTavernV27SessionAdapter({ repository, stateFactory, stageRunnerFactory: createTavernV27FixtureStageRunner });
  const localAdapter = createTavernV27SessionAdapter({ repository, stateFactory });
  const key = { projectId: "review", branchId: "main", runtimeId: "tavern-v27-model:review" };
  const started = await modelAdapter.execute({ operation: "start", sessionKey: key, commandId: "start", expectedSessionRevision: 0 });
  const before = await repository.load(key);
  const local = createTavernV27SessionHttpHandler({ adapter: localAdapter });
  for (const operation of ["continue", "reset"]) {
    const response = await local({ operation, body: { ...started.sessionRef, commandId: operation, expectedRevision: started.sessionRevision } });
    assert.equal(response.status, 409, "fixture commands may not touch a model session");
    assert.equal(response.body.code, "TAVERN_V27_SESSION_MODE_MISMATCH");
    assert.equal(response.body.sessionRef, undefined, "a wrong-mode caller must not receive recovery metadata");
    assert.deepEqual(await repository.load(key), before);
  }
  await assert.rejects(() => localAdapter.execute({ operation: "start", sessionKey: { ...key, runtimeId: "tavern-v27-model:new" }, commandId: "new", expectedSessionRevision: 0 }),
    (error) => error.code === "TAVERN_V27_SESSION_MODE_MISMATCH");
  await assert.rejects(() => modelAdapter.execute({ operation: "start", sessionKey: { ...key, runtimeId: "tavern-v27:local" }, commandId: "new", expectedSessionRevision: 0 }),
    (error) => error.code === "TAVERN_V27_SESSION_MODE_MISMATCH");
  console.log("review persistent session mode isolation contracts passed");
} finally { await rm(rootDir, { recursive: true, force: true }); }
