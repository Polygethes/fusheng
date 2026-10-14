import assert from "node:assert/strict";
import { modelStatus } from "../src/server/modelRouter.mjs";


// This project ships no default model. A contract that drives the real-model
// pipeline must name the model it is pretending to call.
process.env.CHARACTER_TOWN_MODEL ||= "contract-test-model";

const original = process.env.CHARACTER_TOWN_PIPELINE_MODE;
const originalKey = process.env.DEEPSEEK_API_KEY;
try {
  process.env.DEEPSEEK_API_KEY = "test-key";
  delete process.env.CHARACTER_TOWN_PIPELINE_MODE;
  const balanced = modelStatus("openai");
  assert.equal(balanced.pipelineMode, "balanced", "the website/API should default to balanced quality and latency");
  assert.match(balanced.pipeline, /SelectivePsychology/);
  assert.equal(balanced.remoteCallsForThreeCharacters, 6);

  process.env.CHARACTER_TOWN_PIPELINE_MODE = "fast";
  const fast = modelStatus("openai");
  assert.equal(fast.pipelineMode, "fast");
  assert.equal(fast.remoteCallsForThreeCharacters, 5);

  process.env.CHARACTER_TOWN_PIPELINE_MODE = "quality";
  const quality = modelStatus("openai");
  assert.equal(quality.pipelineMode, "quality", "the previous full pipeline should remain available explicitly");
  assert.match(quality.pipeline, /OpenAI VisibilityLayer/);

  console.log("fastPipelineServerDefault:test passed", { balanced: balanced.pipeline, fast: fast.pipeline, quality: quality.pipeline });
} finally {
  if (original === undefined) delete process.env.CHARACTER_TOWN_PIPELINE_MODE;
  else process.env.CHARACTER_TOWN_PIPELINE_MODE = original;
  if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = originalKey;
}
