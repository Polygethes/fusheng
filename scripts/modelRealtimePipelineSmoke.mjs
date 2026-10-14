import { modelStatus } from "../src/server/modelRouter.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const status = modelStatus();
assert(status.version === "1.2.0", "expected v1.2.0 status");
assert(status.pipeline.includes("CharacterPrivateSimulator"), "pipeline should mention CharacterPrivateSimulator");
console.log("model realtime pipeline smoke passed", {
  provider: status.provider,
  pipeline: status.pipeline,
  openaiConfigured: status.openaiConfigured,
});
