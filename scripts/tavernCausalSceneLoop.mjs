import assert from "node:assert/strict";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { runTavernCausalScene } from "../src/server/pipeline/tavernCausalScene.mjs";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
state.ui.timeGrain = "scene";
state.ui.engineMode = "openai";
const mother = "char_xyy_xiemu";
const father = "char_xyy_xieheng";
const son = "char_xyy_xiezenshi";
const guest = "char_xyy_luozhao";
const privateMarkers = {
  [mother]: "PRIVATE_MOTHER_LEDGER",
  [father]: "PRIVATE_FATHER_WINE",
  [son]: "PRIVATE_SON_RECOMMENDATION",
  [guest]: "PRIVATE_GUEST_ROUTE",
};
for (const character of state.characters) {
  if (privateMarkers[character.id]) character.lifeState.hiddenAgenda = privateMarkers[character.id];
}

const calls = [];
const progress = [];
const result = await runTavernCausalScene(state, {
  allowOrphanVisitors: true,
  characterIds: [mother, father, son, guest],
  positions: {
    [mother]: "counter",
    [father]: "hall",
    [son]: "courtyard",
    [guest]: "guest_room",
  },
  seedImpacts: [{
    sourceCharacterId: "world:tavern-door",
    sourceZoneId: "threshold",
    type: "physical",
    modality: "sound",
    intensity: 88,
    radius: 3,
    directedTargetId: father,
    content: "门板被人从外面叩了两下，门外有人喊了一声谢恒。",
  }],
  maxSteps: 8,
  async runAgent(input) {
    calls.push(structuredClone(input));
    const feasibleCandidates = (input.privateActionCandidates || []).filter((candidate) => candidate.feasible);
    const serialized = JSON.stringify(input);
    const usesValidatedFoundation = input.agent.privateState?.selfModel?.authority
      === "validated-character-foundation-and-owned-memory-only";
    if (usesValidatedFoundation) {
      assert.equal(input.agent.psychologyAnchor?.characterId, input.agent.id);
      assert.equal(input.agent.psychologyAnchor?.runtimeSurface, "character-foundation");
    } else {
      assert.ok(serialized.includes(privateMarkers[input.agent.id]), "a legacy Agent must receive its own private runtime state");
    }
    for (const [characterId, marker] of Object.entries(privateMarkers)) {
      if (usesValidatedFoundation || characterId !== input.agent.id) {
        assert.ok(!serialized.includes(marker), "legacy or another character's private state must never enter the prompt");
      }
    }
    if (calls.length === 1) {
      assert.equal(input.agent.id, father,
        "the first thinker must emerge from delivered evidence and personal state, not a scene-assigned manager answer");
      assert.ok(input.perceivedImpacts.some((impact) => impact.content.includes("谢恒")), "the action opportunity must be caused by the perceived addressed call");
      assert.ok(!input.perceivedCharacters.some((item) => item.id === guest), "a closed guest room must not become globally visible");
      const candidate = feasibleCandidates.find((row) => row.actionKind === "handle_environment_event")
        || feasibleCandidates[0];
      assert.ok(candidate, "the first thinker needs a feasible character-owned option to react to the call");
      return { decision: {
        candidateId: candidate.candidateId,
        actionType: "move",
        speechAct: "none",
        vocalMode: "conversational",
        targetCharacterId: "",
        speech: "",
        visibleAction: "谢恒放下手里的东西，朝门槛走去。",
        moveToZoneId: "threshold",
        affordanceId: candidate.realization?.affordanceId || "",
        informationSourceImpactId: "",
        commitmentAction: "none",
        commitmentTopic: "",
        privateReason: "自己离门近，也愿意先去确认。",
      } };
    }
    const candidate = feasibleCandidates[0];
    return { decision: {
      candidateId: candidate?.candidateId || "",
      actionType: "pass",
      speechAct: "none",
      targetCharacterId: "",
      speech: "",
      visibleAction: "",
      moveToZoneId: "",
      affordanceId: "",
      informationSourceImpactId: "",
      commitmentAction: "none",
      commitmentTopic: "",
      privateReason: "没有足够理由打断手上的事。",
    } };
  },
  async onEvent(event) { progress.push(structuredClone(event)); },
});

assert.equal(calls[0].agent.id, father, "activation follows causal impact, not round-robin order or a scene host mapping");
assert.ok(result.actions.length >= 1);
assert.ok(result.actions[0].causalParentImpactId, "the committed reaction must retain its perceived causal parent");
assert.ok(result.actions[0].impactFactors.length >= 1, "visible movement must create a typed impact");
assert.equal(result.sceneRuntime.agents[father].zoneId, "threshold", "validated movement must update the persistent scene position");
assert.equal(result.sceneRuntime.agents[guest].perceptionMemory.length, 0, "an occluded guest must not learn the hall exchange");
assert.ok(result.sceneRuntime.elapsedSeconds > 0 && result.sceneRuntime.elapsedSeconds < 15 * 60, "conversation advances seconds, not the macro day slot");
assert.equal(result.macroTimeAdvanced, false, "a single causal scene must not advance dawn/noon/afternoon time");
assert.ok(["quiescent", "all-passed"].includes(result.stopReason));
assert.ok(progress.some((event) => event.type === "impact_delivered"));
assert.ok(progress.some((event) => event.type === "causal_agent_activated"));
assert.ok(progress.some((event) => event.type === "causal_action_committed"));

console.log("tavernCausalSceneLoop:test passed", {
  order: calls.map((input) => input.agent.id),
  actions: result.actions.length,
  elapsedSeconds: result.sceneRuntime.elapsedSeconds,
  stopReason: result.stopReason,
});
