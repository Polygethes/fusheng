import assert from "node:assert/strict";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import {
  appraiseTavernAgentEcology,
  bindTavernAgentEcologyChoice,
} from "../src/server/pipeline/tavernEcologyRuntime.mjs";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
const mother = state.characters.find((character) => character.id === "char_xyy_xiemu");
const fatherId = "char_xyy_xieheng";
const actor = { characterId: mother.id, present: true, zoneId: "counter", standing: "manager" };
const oldImpactId = "impact_old_knock";
const freshImpactId = "impact_fresh_knock";
const priorActions = Array.from({ length: 6 }, (_, index) => ({
  id: `prior_${index}`,
  actorId: index % 2 ? fatherId : mother.id,
  targetCharacterId: index % 2 ? mother.id : fatherId,
  speech: index % 2 ? "门外没人。" : "再看一眼。",
  speechAct: index % 2 ? "answer" : "ask",
  causalParentImpactId: oldImpactId,
  ecologyRuntimeSignature: `respond:${fatherId}:respond_to_impact:${oldImpactId}`,
}));
const runtime = {
  locationId: "loc_xyy_tavern",
  elapsedSeconds: 140,
  macroDay: 1,
  macroTick: 0,
  step: 7,
  slotContext: { slotId: "same-scene", slotLabel: "同一场" },
  requestLocks: [],
  commitments: [],
  actions: priorActions,
  agents: {
    [mother.id]: actor,
    [fatherId]: { characterId: fatherId, present: true, zoneId: "counter", standing: "proprietor" },
  },
};
const pending = [{
  impactId: freshImpactId,
  sourceCharacterId: fatherId,
  sourceZoneId: "counter",
  type: "speech",
  modality: "sound",
  content: "门外这回真有人，还带着一只伤鸟。",
  topic: "新的来客与伤鸟",
  impactScore: 92,
  directed: true,
  directedTargetId: mother.id,
  provenance: { sourceActionId: "fresh_source_action" },
}];
const appraisal = appraiseTavernAgentEcology({
  character: mother,
  runtime,
  actor,
  pendingImpacts: pending,
  visibleCharacterIds: [fatherId],
  availableAffordances: [],
  recentOwnActions: priorActions.filter((action) => action.actorId === mother.id),
  relationships: state.relationships,
});
const freshCandidate = appraisal.appraisal.candidates.find((candidate) => candidate.candidateId === `impact:${freshImpactId}:respond`);
assert.ok(freshCandidate, "fresh delivered impact did not create a candidate");
assert.equal(freshCandidate.feasible, true, "a new causal event was incorrectly blocked by old pair-turn repetition");
assert.ok(!freshCandidate.blockedBy.includes("same-scene-conversation-saturated"));
assert.ok(!freshCandidate.blockedBy.includes("same-scene-intention-cycle"));
assert.equal(appraisal.selectedIntent, null, "reactivation pressure must not preselect the person's answer");
const chosen = bindTavernAgentEcologyChoice(appraisal, freshCandidate.candidateId);
assert.equal(chosen.selectedIntent.id, `impact:${freshImpactId}:respond`, "a newly noticed directed fact must remain selectable by the person without scene responsibility authority");

console.log("tavernPhase59FreshImpactReactivation:test passed", {
  priorPairTurns: priorActions.length,
  selectedCandidateId: chosen.selectedIntent.id,
  runtimeSignature: chosen.selectedIntent.runtimeSignature,
});
