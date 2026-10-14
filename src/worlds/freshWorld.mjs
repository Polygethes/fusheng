import { buildPlayableWorldFromPack } from "./buildPlayableWorldFromPack.mjs";
import { worldPackDigest } from "./worldPack.mjs";
import { createWorldRuntimeV27 } from "../server/pipeline/tavernWorldRuntimeV27.mjs";
import { renderSettledSimulationReport, summarizeSettledSimulation } from "../server/simulation/settledSimulationReport.mjs";

/**
 * A 0-turn save for a world pack, in the same shape every runner resumes
 * from. No character has acted and no model has been called.
 */
export async function createFreshWorldSave(pack, { runId = `fresh-${pack.meta.id}-${Date.now()}` } = {}) {
  const instance = createWorldRuntimeV27(buildPlayableWorldFromPack(pack), {
    worldPack: pack,
    worldId: `world:${pack.meta.id}:${runId}`,
    pacingMode: "scene",
    enableDayPlanning: true,
    characterAgentCallMode: "three-call",
    async runStage() {
      throw Object.assign(new Error("A fresh world save never calls a model."), { code: "FRESH_WORLD_NO_MODEL" });
    },
  });
  const checkpoint = await instance.runtime.checkpoint();
  for (const actor of instance.runtime.actors.values()) await actor.close?.();
  const provenance = { kind: "fresh-world", modelVerified: false, note: "Built from the world pack; no character has acted yet." };
  const summary = summarizeSettledSimulation({ checkpoint, turns: [] });
  return {
    save: {
      schemaVersion: 1, runId, worldPackId: pack.meta.id, worldPackDigest: worldPackDigest(pack),
      provenance, settledTurns: [], halted: false, failure: null, summary, checkpoint,
    },
    report: renderSettledSimulationReport([], provenance, summary),
  };
}
