import assert from "node:assert/strict";
import { privateSimulationSchema, visibilityLayerSchema, sceneInteractionSchema } from "../src/server/pipeline/schemas.mjs";

assert.ok(privateSimulationSchema.required.includes("privateDesire"));
assert.ok(privateSimulationSchema.required.includes("defensiveMask"));
assert.ok(privateSimulationSchema.required.includes("shadowImpulse"));
assert.ok(visibilityLayerSchema.required.includes("perCharacter"));
assert.ok(sceneInteractionSchema.required.includes("interactionBeats"));
assert.ok(sceneInteractionSchema.required.includes("misunderstandings"));
assert.ok(sceneInteractionSchema.required.includes("relationshipShift"));
console.log("model realtime orchestration contracts ok");
