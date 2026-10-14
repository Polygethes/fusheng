import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const run = args => spawnSync(process.execPath, ["scripts/runV27AutomaticModelBenchmark.mjs", ...args], {
  cwd: root, encoding: "utf8", timeout: 15000,
});
const dry = run(["--dry-run", "--fresh", "--turns", "40"]);
assert.equal(dry.status, 0, dry.stderr);
const events = dry.stdout.trim().split("\n").map(line => JSON.parse(line));
const finish = events.find(row => row.type === "run_finished");
assert.equal(finish.status, "prepared");
try {
  const report = JSON.parse(await readFile(path.join(finish.outputDir, "report.json"), "utf8"));
  const first = JSON.parse(await readFile(path.join(finish.outputDir, "first-stage-input.json"), "utf8"));
  assert.equal(report.model, "gpt-5.6-sol");
  assert.equal(report.reasoningEffort, "medium");
  assert.equal(report.codexCommand, "codex");
  assert.equal(report.requestedTurns, 40);
  assert.equal(report.pacingMode, "scene");
  assert.equal(report.characterIds.length, 5);
  assert.ok(report.characterIds.includes("char_xyy_xiemu"));
  assert.equal(report.sceneDeadlines[0].dueAtSeconds, 900);
  assert.equal(first.horizon.durationSeconds, 1800);
  assert.equal(first.submissionContract.maxBlockSeconds, 300);
  assert.equal(report.turnCounting, "all-character-turns-including-planning-and-reflection");
  assert.equal(first.phase, "awaiting_character_day_planning", "fresh planning must use the real provider path, not a recorded precondition");
  assert.equal(report.calls.length, 0, "preparing a test must never consume model requests");
  assert.equal(report.warmups.length, 0);
  assert.equal(report.counts.completedTurns, 0);
  assert.equal(report.counts.worldOutcomes, 0);
} finally { await rm(finish.outputDir, { recursive: true, force: true }); }
const luna = run(["--dry-run", "--fresh", "--turns", "10", "--model", "gpt-5.6-luna", "--reasoning-effort", "high", "--codex-command", "/example/codex"]);
assert.equal(luna.status, 0, luna.stderr);
const lunaFinish = luna.stdout.trim().split("\n").map(line => JSON.parse(line)).find(row => row.type === "run_finished");
assert.equal(lunaFinish.status, "prepared");
try {
  const report = JSON.parse(await readFile(path.join(lunaFinish.outputDir, "report.json"), "utf8"));
  assert.equal(report.model, "gpt-5.6-luna");
  assert.equal(report.reasoningEffort, "high");
  assert.equal(report.codexCommand, "/example/codex", "the selected executable is explicit and dry run does not invoke it");
  assert.equal(report.requestedTurns, 10);
  assert.equal(report.maxStageProtocolRepairs, 2);
  assert.equal(report.maxRequests, 50, "three base stages plus at most two repairs per character turn");
  assert.equal(report.calls.length, 0);
  assert.equal(report.warmups.length, 0);
} finally { await rm(lunaFinish.outputDir, { recursive: true, force: true }); }
for (const limit of ["-1", "1.5", "3", "11", "NaN"]) {
  const invalid = run(["--dry-run", "--fresh", "--turns", "10", "--max-stage-repairs", limit]);
  assert.notEqual(invalid.status, 0);
  assert.ok(invalid.stderr.includes("INVALID_STAGE_REPAIR_LIMIT"));
}
for (const turns of ["0", "-1", "1.5", "NaN"]) {
  const invalid = run(["--dry-run", "--fresh", "--turns", turns]);
  assert.notEqual(invalid.status, 0, "invalid turn limits must fail before any provider request");
  assert.ok(invalid.stderr.includes("INVALID_TURN_LIMIT"));
}
const retired = spawnSync(process.execPath, ["sim-runs/2026-09-07-pi-model-resume-20turns/autopilot.mjs", "40"], {
  cwd: root, encoding: "utf8", timeout: 2000,
});
assert.notEqual(retired.status, 0);
assert.ok(retired.stderr.includes("ARCHIVED_FIXTURE_AUTOPILOT_DISABLED"), "the old template loop must stop before contacting the relay");
console.log("Automatic model runner contracts passed: default Sol medium and explicit Luna high preparation, bounded repairs, explicit limits, no dry-run calls, retired template driver.");
