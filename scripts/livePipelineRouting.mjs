import assert from "node:assert/strict";
import { modelStatus } from "../src/server/modelRouter.mjs";


// This project ships no default model. A contract that drives the real-model
// pipeline must name the model it is pretending to call.
process.env.CHARACTER_TOWN_MODEL ||= "contract-test-model";

const original = process.env.CHARACTER_TOWN_PIPELINE_MODE;
const originalKey = process.env.DEEPSEEK_API_KEY;
try {
  process.env.DEEPSEEK_API_KEY = "test-key";

  process.env.CHARACTER_TOWN_PIPELINE_MODE = "live";
  const live = modelStatus("openai");
  assert.equal(live.pipelineMode, "live");
  assert.match(live.pipeline, /LiveTurnLoop/, "状态端点必须标注 live 管线");
  assert.ok(live.remoteCallsForThreeCharacters >= 12, "live 的调用数标称值应反映回合成本");
  assert.equal(live.repairEnabled, false, "live 不进修复");

  delete process.env.CHARACTER_TOWN_PIPELINE_MODE;
  assert.equal(modelStatus("openai").pipelineMode, "balanced", "默认仍是 balanced");

  process.env.CHARACTER_TOWN_PIPELINE_MODE = "nonsense";
  assert.equal(modelStatus("openai").pipelineMode, "balanced", "未知值回落 balanced");

  console.log("livePipelineRouting:test passed", { live: live.pipeline });
} finally {
  if (original === undefined) delete process.env.CHARACTER_TOWN_PIPELINE_MODE;
  else process.env.CHARACTER_TOWN_PIPELINE_MODE = original;
  if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = originalKey;
}
