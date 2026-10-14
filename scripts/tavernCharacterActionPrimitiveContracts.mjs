import assert from "node:assert/strict";
import {
  bridgeTavernCharacterAgentV2ResultForWorld,
  runTavernCharacterAgentTurnV2,
  TAVERN_CHARACTER_AGENT_V2_VERSION,
} from "../src/server/pipeline/tavernCharacterAgentV2.mjs";
import { lowerTavernV27WorldAttempt } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { createTavernV27FixtureStageRunner } from "../src/server/pipeline/tavernV27FixtureStage.mjs";

// Minimized from turn 22 of the archived 40-turn run. `handle` is a world
// primitive, but is not an action accepted from a Character Agent.
function bridge(primitive, body = "", speech = "") {
  return bridgeTavernCharacterAgentV2ResultForWorld({
    protocolVersion: TAVERN_CHARACTER_AGENT_V2_VERSION,
    session: {
      phase: "ready_for_world_resolution",
      generatedCandidates: [],
      finalDecision: {
        actionAttempt: { primitive, objectId: "tavern_tool_wood_axe" },
        embodiedIntent: { intendedGesture: body },
        utterance: { literalSpeech: speech },
      },
    },
  }, {});
}
for (const [primitive, body, speech] of [
  ["handle", "", ""], ["handle", "抡起斧头。", ""],
  ["unknown_action", "", "等一下。"], ["", "", ""],
]) {
  assert.throws(() => bridge(primitive, body, speech),
    { code: "TAVERN_CHARACTER_AGENT_UNSUPPORTED_ACTION_PRIMITIVE" },
    "an explicit invalid action must be rejected, never erased or replaced by speech");
}
assert.equal(lowerTavernV27WorldAttempt(bridge("none")), null);
assert.throws(() => bridge("act", "无"), { code: "TAVERN_CHARACTER_AGENT_UNSUPPORTED_ACTION_PRIMITIVE" });
assert.throws(() => bridge("act", "点头。"), { code: "TAVERN_CHARACTER_AGENT_UNSUPPORTED_ACTION_PRIMITIVE" });
assert.equal(bridge("none", "", "等一下。").rawDecision.actionAttempt.primitive, "speak");
assert.equal(lowerTavernV27WorldAttempt(bridge("pickup")).primitive, "handle");

// Exercise the real protocol repair path, not just the defensive bridge.
const fixture = createTavernV27FixtureStageRunner({ planForTurn: () => ({
  intention: "稍作歇息", primitive: "rest", visibleAction: "稍作歇息。",
  utterance: "", texture: [], privateBasis: "本人决定歇息。",
}) });
const rejected = [];
let candidateCalls = 0;
let repairFeedback;
const result = await runTavernCharacterAgentTurnV2({
  agentTurnId: "agent-turn:primitive-regression:1", submissionMode: "atomic",
  agent: { id: "character:primitive-regression", name: "测试人物" },
  scene: { id: "scene:primitive-regression", zoneId: "hall" },
}, {
  maxStageProtocolRepairs: 1,
  onStageRejected: event => rejected.push(event),
  runStage: async (input, options) => {
    const output = await fixture(input, options);
    if (options.stage === "agent_candidates") {
      candidateCalls += 1;
      if (candidateCalls === 1) output.candidates.candidates[0].attemptPrimitive = "handle";
      else repairFeedback = input.protocolRepairFeedback;
    }
    return output;
  },
});
assert.equal(candidateCalls, 2, "unsupported candidate must receive one bounded repair opportunity");
assert.ok(rejected.some(event => event.issues.some(issue => issue.code === "AGENT_CANDIDATE_PRIMITIVE_UNSUPPORTED")));
assert.ok(JSON.stringify(repairFeedback).includes("AGENT_CANDIDATE_PRIMITIVE_UNSUPPORTED"));
assert.equal(result.session.finalDecision.actionAttempt.primitive, "rest");
assert.equal(bridgeTavernCharacterAgentV2ResultForWorld(result, {}).rawDecision.actionAttempt.primitive, "rest");
console.log("Character action primitive contracts passed: rejection, bounded repair, lawful no-op and object lowering.");
