import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { initialState } from "../src/data/seed.js";

function reservePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitForServer(url, child, logs) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`test server exited early\n${logs()}`);
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`test server did not start\n${logs()}`);
}

const port = await reservePort();
const url = `http://127.0.0.1:${port}`;
let stdout = "";
let stderr = "";
const child = spawn(process.execPath, ["server.mjs"], {
  cwd: new URL("..", import.meta.url),
  env: {
    ...process.env,
    PORT: String(port),
    DEEPSEEK_API_KEY: "",
    OPENAI_API_KEY: "",
    CHARACTER_TOWN_MODEL_MODE: "mock",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", (chunk) => { stdout += chunk; });
child.stderr.on("data", (chunk) => { stderr += chunk; });
const logs = () => `${stdout}\n${stderr}`;

try {
  await waitForServer(url, child, logs);
  const runId = "run_resume_contract";
  const response = await fetch(`${url}/api/engine/play/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ state: initialState, mode: "mock", allowFallback: true, runId, afterSeq: 0 }),
  });
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /application\/x-ndjson/);
  const events = text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  assert.equal(events[0]?.type, "run_started");
  assert.equal(events[0]?.runId, runId);
  assert.deepEqual(events.map((event) => event.seq), [1, 2], "buffered run events should have stable sequence numbers");
  assert.equal(events.filter((event) => event.type === "complete").length, 1, "one run should emit one final draft");
  const draftId = events.find((event) => event.type === "complete")?.draft?.id;
  assert.ok(draftId);

  const resumedResponse = await fetch(`${url}/api/engine/play/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ state: initialState, mode: "mock", allowFallback: true, runId, afterSeq: 1 }),
  });
  const resumedText = await resumedResponse.text();
  const resumedEvents = resumedText.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  assert.deepEqual(resumedEvents.map((event) => event.type), ["complete"], "resume should replay only unseen buffered events");
  assert.equal(resumedEvents[0].draft?.id, draftId, "resume must return the same completed run, not simulate again");
  assert.equal(child.exitCode, null, `streaming should not terminate the server\n${logs()}`);
  console.log("serverLiveStream:test passed", { eventTypes: events.map((event) => event.type), resumed: resumedEvents.map((event) => event.type) });
} finally {
  child.kill("SIGTERM");
}
