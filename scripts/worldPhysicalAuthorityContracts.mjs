import assert from "node:assert/strict";
import { createWorldActionRegistry } from "../src/server/simulation/worldActionRegistry.mjs";
import { bridgeTavernCharacterAgentV2ResultForWorld, TAVERN_CHARACTER_AGENT_V2_VERSION } from "../src/server/pipeline/tavernCharacterAgentV2.mjs";
import { canonicalAffectiveTexture, validatePhysicalExpression } from "../src/server/simulation/physicalExpression.mjs";

const actor = id => ({ id, name: id, kind: "character", present: true, placeId: "inn", zoneId: "yard" });
const state = { nowSeconds: 0, entities: { a: actor("a"), b: actor("b") },
  places: { inn: { topology: { zones: { yard: {} }, edges: [] } } },
  objects: { axe: { id: "axe", kind: "object", label: "斧", placeId: "inn", zoneId: "yard", holderCharacterId: "", state: {} } } };
const registry = createWorldActionRegistry();
// The archived turn 52 claimed a split log through gesture prose. Test every
// expression-bearing entry point, including forged affective sound features.
const forged = "AUDIT_ONLY_第五斧落下，湿柴全部劈完，茶已倒满。";
for (const primitive of ["gesture", "observe", "listen", "rest", "practice", "interact", "handle", "speak"]) {
  const outcome = await registry.settle({ state, attempt: { attemptId: `forged:${primitive}`, actorId: "a", primitive,
    payload: { visibleAction: forged, gesture: forged, targetId: "b", targetCharacterId: "b", objectId: "axe", operation: "take",
      utterance: primitive === "speak" ? "柴都劈完了。" : "", soundContent: forged,
      observableAffectiveTexture: [{ channel: "breath", modality: "sound", feature: forged }] } } });
  assert.ok(!JSON.stringify(outcome).includes("AUDIT_ONLY"), `${primitive} must not promote unverified prose to objective facts, signals or perception`);
  if (primitive === "gesture") {
    assert.equal(outcome.status, "failed");
    assert.ok(outcome.failedEffects.some(row => row.code === "PHYSICAL_EXPRESSION_REQUIRED"));
  }
  if (primitive === "speak") assert.ok(outcome.deliveries.some(row => row.content === "柴都劈完了。"), "character speech is preserved as speech, including lies");
}
assert.throws(() => bridgeTavernCharacterAgentV2ResultForWorld({ protocolVersion: TAVERN_CHARACTER_AGENT_V2_VERSION,
  session: { phase: "ready_for_world_resolution", generatedCandidates: [], finalDecision: {
    actionAttempt: { primitive: "act" }, embodiedIntent: { intendedGesture: forged } } } }, {}),
  { code: "TAVERN_CHARACTER_AGENT_UNSUPPORTED_ACTION_PRIMITIVE" }, "unsupported act must not become a successful gesture");

const gesture = await registry.settle({ state, attempt: { attemptId: "typed:nod", actorId: "a", primitive: "gesture",
  payload: { bodyActions: [{ kind: "nod", direction: "forward", amplitude: "small", speed: "slow" }], visibleAction: forged } } });
assert.equal(gesture.status, "success", "explicitly authored supported body action remains available");
assert.ok(gesture.deliveries.some(row => row.recipientCharacterId === "b" && row.content.includes("点头")));
assert.ok(!JSON.stringify(gesture).includes("AUDIT_ONLY"));
assert.deepEqual(gesture.statePatch.operations, [], "a nod does not move resources");
for (const bodyActions of [[{ kind: "split_wood" }], [{ kind: "nod", direction: forged }]]) {
  const failed = await registry.settle({ state, attempt: { attemptId: "typed:invalid", actorId: "a", primitive: "gesture", payload: { bodyActions } } });
  assert.equal(failed.status, "failed", "unknown physical operations and parameters are not lowered heuristically");
}
for (const cue of ["__proto__", "constructor", "toString", "unknown_劈柴"]) {
  const texture = [{ cue, channel: "breath", modality: "sound", feature: forged }];
  assert.deepEqual(canonicalAffectiveTexture(texture), [], "unknown and inherited property names cannot become physical cues");
  assert.ok(validatePhysicalExpression({ affectiveDeltas: texture }).some(row => row.code === "PHYSICAL_AFFECTIVE_CUE_INVALID"));
}
console.log("World physical authority contracts passed: untrusted prose isolation, literal speech, typed gestures and unsupported action rejection.");
