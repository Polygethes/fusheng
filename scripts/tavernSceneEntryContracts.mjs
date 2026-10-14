// The production HTTP entry must use the same scene policy as the relay.
// Only the fixture endpoint is executed; the model endpoint stays unauthorized.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { createFileWorldRuntimeSessionRepository } from "../src/server/simulation/worldRuntimeSessionRepository.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = await mkdtemp(path.join(tmpdir(), "gtown-scene-entry-"));
const environment = { ...process.env, PORT: "0", HOST: "127.0.0.1", GTOWN_RUNTIME_SESSION_DIR: temporary,
  GTOWN_V27_CHARACTER_AGENT_CALL_MODE: "three-call" };
delete environment.GTOWN_V27_PACING_MODE;
delete environment.GTOWN_V27_OPENING_SECONDS;
const child = spawn(process.execPath, ["server.mjs"], { cwd: root, env: environment, stdio: ["ignore", "pipe", "pipe"] });
let output = "", errors = "";
child.stdout.on("data", chunk => { output += chunk; });
child.stderr.on("data", chunk => { errors += chunk; });
try {
  const startedAt = performance.now();
  while (!output.match(/http:\/\/127\.0\.0\.1:\d+/)) {
    if (child.exitCode !== null) throw new Error(errors);
    assert.ok(performance.now() - startedAt < 10000, "local server startup deadline");
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  const url = output.match(/http:\/\/127\.0\.0\.1:\d+/)[0];
  const status = await (await fetch(`${url}/api/v27/tavern/status`)).json();
  assert.equal(status.defaultPacingMode, "scene");
  assert.equal(status.defaultOpeningAfterSeconds, 900);
  assert.equal(status.actionStageRequestsPerActorTurn, 3);
  const key = { projectId: "scene-entry-test", branchId: "fresh", runtimeId: "tavern-v27:scene-entry" };
  const start = await fetch(`${url}/api/v27/tavern/session/start`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...key, commandId: "start", expectedRevision: 0 }), signal: AbortSignal.timeout(10000) });
  const response = await start.json();
  assert.equal(start.status, 200, JSON.stringify(response));
  assert.equal(response.observation.turns.length, 1);
  const repository = createFileWorldRuntimeSessionRepository({ rootDir: temporary });
  const stored = await repository.load(key);
  assert.equal(stored.definition.pacingMode, "scene");
  assert.equal(stored.checkpoint.actors.length, 5, "server wiring must not override the complete scene cast with a historical two-person list");
  assert.ok(stored.checkpoint.actors.some(actor => actor.characterId === "char_xyy_xiemu"));
  assert.equal(stored.checkpoint.coordinator.worldState.temporalAgenda[0].dueAtSeconds, 900);
  const blocked = await fetch(`${url}/api/v27/tavern/model-session/start`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...key, runtimeId: "tavern-v27-model:scene-entry", commandId: "model-start", expectedRevision: 0 }) });
  assert.equal(blocked.status, 403, "checking scene defaults must never authorize a model request");
  console.log(JSON.stringify({ status: "pass", entry: "production-http", cast: stored.checkpoint.actors.length,
    pacingMode: stored.definition.pacingMode, realModelCalls: 0 }));
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    const closed = once(child, "close");
    child.kill("SIGTERM");
    await closed;
  }
  await rm(temporary, { recursive: true, force: true });
}
