import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildTavernVoiceContract } from "../src/server/pipeline/tavernCharacterVoice.mjs";
import { renderSettledSimulationReport, summarizeSettledSimulation } from "../src/server/simulation/settledSimulationReport.mjs";

const blueprint = { interactionStance: "先动手再解释的少年", attentionPriorities: ["手里的剑"] };
const voice = buildTavernVoiceContract({ id: "char_probe_child", name: "孩子", voiceBlueprint: blueprint });
assert.equal(JSON.stringify(voice).includes("先动手再解释的少年"), true, "a pack-authored voice blueprint is used");

const packState = {
  nowSeconds: 30,
  entities: { child: { id: "child", name: "小满", kind: "character" } },
  objects: {
    line: { id: "line", state: { litSegments: 1 } },
    token: { id: "token", holderCharacterId: "child", state: {} },
  },
  worldPackMeta: { id: "probe", report: { renderer: "pack-metrics", metrics: [
    { label: "北侧阵纹", objectId: "line", stateKey: "litSegments", unit: "段", target: 3 },
    { label: "接引符", objectId: "token", kind: "holder" },
  ] } },
};
const summary = summarizeSettledSimulation({ checkpoint: { coordinator: { worldState: packState }, actors: [] }, turns: [] });
assert.deepEqual(summary.objectiveState.metrics, [
  { label: "北侧阵纹", value: 1, unit: "段", target: 3 },
  { label: "接引符", value: "小满", unit: "", target: null },
]);
const report = renderSettledSimulationReport([], { kind: "fresh-world" }, summary);
assert.match(report, /北侧阵纹：1 段（目标 3）/u);
assert.match(report, /接引符：小满/u);
assert.doesNotMatch(report, /柴：/u, "a pack report no longer prints tavern firewood lines");

const legacy = JSON.parse(readFileSync(new URL("../sim-runs/relay-43eee56c-7eaa-4732-b7bf-971242df35c5/world-save.json", import.meta.url), "utf8"));
const legacySummary = summarizeSettledSimulation({ checkpoint: legacy.checkpoint, turns: legacy.settledTurns });
assert.match(renderSettledSimulationReport(legacy.settledTurns, legacy.provenance, legacySummary), /柴：未加工 2 束/u,
  "older saves keep the tavern report");

console.log("World pack report and voice passed: pack blueprints and metrics are used; older saves keep their report.");
