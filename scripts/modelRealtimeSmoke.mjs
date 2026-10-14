import assert from "node:assert/strict";
import { modelStatus } from "../src/server/modelRouter.mjs";

const status = modelStatus("mock");
assert.equal(status.version, "1.2.0");
assert.equal(status.provider, "mock");
assert.ok(status.pipeline.includes("MockPrivateSimulator"));
const autoStatus = modelStatus("auto");
assert.ok(autoStatus.pipeline.includes("PrivateSimulator"));
console.log("model realtime smoke ok");
