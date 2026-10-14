// Reproducible local baseline. No network, provider, CLI or API credentials.
import { mkdtemp, rm, stat, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { npcActivityIntervalMs } from "../src/ui/npcActivityLoop.js";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { createTavernV27FixtureStageRunner } from "../src/server/pipeline/tavernV27FixtureStage.mjs";
import { createTavernV27SessionAdapter } from "../src/server/pipeline/tavernV27SessionAdapter.mjs";
import { createTavernWorldRuntimeV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { tavernCharacterAgentV2SystemPrompt, tavernCharacterAgentV2UserPrompt, tavernCharacterAgentV2OutputSchemaForStage } from "../src/server/pipeline/tavernCharacterAgentV2.mjs";
import { createFileWorldRuntimeSessionRepository, worldRuntimeSessionStorageId } from "../src/server/simulation/worldRuntimeSessionRepository.mjs";

const round = n => Math.round(n * 100) / 100;
function summary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = p => round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] || 0);
  return { count: sorted.length, min: round(sorted[0] || 0), p50: percentile(0.5), p95: percentile(0.95), max: round(sorted.at(-1) || 0) };
}
const seed = buildPlayableWorldFromSetup({ setupWorldPrompt: "逍遥游，望梯酒馆", setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚" });
const characterIds = ["char_xyy_xiezenshi", "char_xyy_luozhao"];
const rootDir = await mkdtemp(path.join(os.tmpdir(), "gtown-local-latency-"));
const turns = [];
const standardFirstTurn = new Map();
try {
  for (let repetition = 0; repetition < 3; repetition += 1) {
    const baseRepository = createFileWorldRuntimeSessionRepository({ rootDir });
    let storageMs = 0, storageCalls = 0;
    const repository = { ...baseRepository };
    for (const method of ["load", "createIfAbsent", "compareAndSwap"]) {
      repository[method] = async (...args) => {
        const start = performance.now();
        try { return await baseRepository[method](...args); }
        finally { storageMs += performance.now() - start; storageCalls += 1; }
      };
    }
    let stageCount = 0;
    const adapter = createTavernV27SessionAdapter({ repository, enableDayPlanning: true,
      stateFactory: () => ({ state: seed, characterIds, positions: { char_xyy_xiezenshi: "hall", char_xyy_luozhao: "hall" } }),
      fixtureStageFactory: () => {
        const fixture = createTavernV27FixtureStageRunner();
        return async (input, options) => {
          stageCount += 1;
          const result = await fixture(input, options);
          return result;
        };
      },
    });
    const key = { projectId: "benchmark", branchId: `run-${repetition}`, runtimeId: "tavern-v27:benchmark" };
    let response = null;
    for (let index = 0; index < 40; index += 1) {
      storageMs = 0; storageCalls = 0; stageCount = 0;
      const start = performance.now();
      response = await adapter.execute({ operation: index ? "continue" : "start", sessionKey: key,
        sessionId: response?.sessionRef.sessionId, commandId: `turn-${index}`, expectedSessionRevision: response?.sessionRevision || 0 });
      const elapsedMs = performance.now() - start;
      if (!response.observation.turns.length) break;
      const directory = path.join(rootDir, worldRuntimeSessionStorageId(key));
      const generation = (await readdir(directory)).filter(name => name.startsWith("generation-")).sort().at(-1);
      turns.push({ repetition, turn: index + 1, worldVersion: response.worldVersion, stageCount,
        elapsedMs: round(elapsedMs), storageMs: round(storageMs), storageCalls,
        generationBytes: (await stat(path.join(directory, generation))).size });
    }
  }
  // Compare prompt shapes for a controlled first action (two actors, no
  // previous model transcript), independent of day-plan scheduling above.
  const fixture = createTavernV27FixtureStageRunner();
  const standard = createTavernWorldRuntimeV27(seed, { characterIds, runStage: async (input, options) => {
    const result = await fixture(input, options);
    standardFirstTurn.set(options.stage, structuredClone(result));
    return result;
  } });
  try {
    await standard.runtime.enqueueWake("char_xyy_xiezenshi", { wakeId: "benchmark-prompt", kind: "opportunity_window", evidence: [], evidenceIds: [] });
    await standard.runtime.runNext();
  } finally { for (const actor of standard.runtime.actors.values()) await actor.close(); }
  const promptSamples = [];
  const instance = createTavernWorldRuntimeV27(seed, {
    characterIds, characterAgentCallMode: "two-call", runStage: async (input, options) => {
      const start = performance.now();
      const system = tavernCharacterAgentV2SystemPrompt(input);
      const user = tavernCharacterAgentV2UserPrompt(input);
      const schema = JSON.stringify(tavernCharacterAgentV2OutputSchemaForStage(input));
      promptSamples.push({ stage: options.stage, systemBytes: Buffer.byteLength(system), userBytes: Buffer.byteLength(user), schemaBytes: Buffer.byteLength(schema), formattingMs: round(performance.now() - start) });
      if (options.stage === "subjective_appraisal_and_candidates") return {
        appraisalAndCandidates: { appraisal: standardFirstTurn.get("subjective_appraisal").appraisal, candidates: standardFirstTurn.get("agent_candidates").candidates },
        stage: { provider: "local-fixture", elapsedMs: 0 },
      };
      return {
        choiceAndTurnCommit: { choice: standardFirstTurn.get("agent_choice_and_regulation").choice, turnCommit: standardFirstTurn.get("agent_turn_commit").turnCommit },
        stage: { provider: "local-fixture", elapsedMs: 0 },
      };
    },
  });
  try {
    await instance.runtime.enqueueWake("char_xyy_xiezenshi", { wakeId: "benchmark", kind: "opportunity_window", evidence: [], evidenceIds: [] });
    await instance.runtime.runNext();
  } finally { for (const actor of instance.runtime.actors.values()) await actor.close(); }
  const warm = turns.filter(row => row.turn > 1);
  console.log(JSON.stringify({
    measuredAt: new Date().toISOString(), node: process.version, platform: `${os.platform()} ${os.arch()}`,
    measurement: "local fixture adapter including durable storage; excludes HTTP, browser rendering and real model inference",
    repetitions: 3, characters: characterIds.length, enableDayPlanning: true,
    maximumCommandsPerRun: 40, elapsedMs: summary(warm.map(row => row.elapsedMs)), storageMs: summary(warm.map(row => row.storageMs)),
    coldStartMs: summary(turns.filter(row => row.turn === 1).map(row => row.elapsedMs)),
    generationBytes: summary(turns.map(row => row.generationBytes)),
    configuredUiWaitMs: npcActivityIntervalMs("normal"), configuredFastUiWaitMs: npcActivityIntervalMs("fast"),
    firstTwoCallPromptBytes: promptSamples, turns,
  }, null, 2));
} finally { await rm(rootDir, { recursive: true, force: true }); }
