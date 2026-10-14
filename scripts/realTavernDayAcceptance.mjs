import assert from "node:assert/strict";
import { playModelPeriodWithRunners } from "../src/server/pipeline/openaiPipeline.mjs";
import { runTavernCausalAgent } from "../src/server/pipeline/tavernCausalScene.mjs";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
state.ui.timeGrain = "day";
state.ui.engineMode = "openai";

const startedAt = Date.now();
const draft = await playModelPeriodWithRunners(state, {
  pipelineMode: "live",
  characterAgentProtocolVersion: 1,
  maxStepsPerSlot: 4,
  runners: { runTavernCausalAgent },
});
const ticks = draft.periodSimulation?.ticks || [];
const turns = ticks.flatMap((tick) => tick.canonicalDialogueTurns || []);
const dialogueTicks = ticks.filter((tick) => (tick.canonicalDialogueTurns || []).length > 0);
const decisionStages = (draft.pipelineMeta?.stages || []).filter((stage) => String(stage.name || "").startsWith("TavernCausalAgent:"));
const legacyStages = (draft.pipelineMeta?.stages || []).filter((stage) => /TavernAgentDecision|BackgroundSlot|ActivityWitness|AffordanceProbe/.test(String(stage.name || "")));
const materialActions = ticks.flatMap((tick) => tick.causalScene?.actions || []).filter((action) => action.affordanceId);
const causalActions = draft.causalScene?.actions || [];
const causalDeliveries = draft.causalScene?.deliveries || [];
const causalRelationshipShifts = (draft.updateBundle?.relationships || []).filter((shift) => (
  shift.generatedFrom === "character-agent-owned-appraisal"
));
const relationshipAttributions = causalRelationshipShifts.map((shift) => {
  const action = causalActions.find((item) => item.id === shift.sourceActionId);
  const delivery = causalDeliveries.find((item) => (
    item.impactId === shift.sourceImpactId
    && item.recipientId === shift.fromCharacterId
    && item.sourceCharacterId === shift.toCharacterId
  ));
  const sourceImpactBelongsToAction = Boolean(action?.impactFactors?.some((impact) => impact.id === shift.sourceImpactId));
  return {
    shift,
    action,
    delivery,
    attributable: Boolean(
      action
      && action.actorId === shift.toCharacterId
      && delivery
      && sourceImpactBelongsToAction
    ),
  };
});
const attributableShifts = relationshipAttributions.filter((entry) => entry.attributable);
const unattributableShifts = relationshipAttributions.filter((entry) => !entry.attributable);

assert.equal(ticks.length, 5, "a real tavern day must resolve five lived slots");
assert.ok(decisionStages.length >= 10, "the real day must reach isolated remote Agent decisions across the day");
assert.ok(
  decisionStages.every((stage) => stage.provider === "openai"),
  `Agent decisions must not silently fall back during acceptance: ${decisionStages.filter((stage) => stage.provider !== "openai").map((stage) => `${stage.name}=${stage.error || stage.provider}`).join(" | ")}`,
);
assert.equal(legacyStages.length, 0, `no legacy day author may run: ${legacyStages.map((stage) => stage.name).join(", ")}`);
assert.ok(ticks.every((tick) => tick.causalScene && tick.causalScene.macroTimeAdvanced === false));
assert.ok(ticks.every((tick) => tick.agentParticipation?.witness?.ran === false));
assert.ok(dialogueTicks.length >= 2, `visible dialogue must occur across at least two slots, got ${dialogueTicks.length}`);
assert.ok(turns.length >= 3, `an ordinary public day must contain a small interaction sequence, got ${turns.length} accepted turns`);
assert.ok(turns.every((turn) => turn.slotId && turn.slotLabel), "every public turn must retain its actual causal slot");
assert.ok(turns.filter((turn) => turn.respondsTo).every((turn) => turn.responseSourceSlotId === turn.slotId), "direct replies must stay inside the scene where the source line occurred");
assert.ok(
  !(draft.updateBundle?.relationships || []).some((shift) => shift.generatedFrom === "causal-perceived-relationship-outcome"),
  "public interaction is only a stimulus and must not force a relationship change without its recipient Character Agent",
);
assert.equal(
  unattributableShifts.length,
  0,
  `every relationship consequence must trace to its committed action and actual recipient delivery: ${JSON.stringify(unattributableShifts.map(({ shift }) => ({
    from: shift.fromCharacterId,
    to: shift.toCharacterId,
    sourceActionId: shift.sourceActionId,
    sourceImpactId: shift.sourceImpactId,
  })), null, 2)}`,
);
assert.ok(turns.every((turn) => draft.novelText.includes(turn.line)), "the visible witness text must preserve every canonical Agent line verbatim");
assert.ok(turns.every((turn) => draft.novelText.split(turn.line).length - 1 === 1), "each canonical Agent line must appear exactly once in the visible day");
assert.doesNotMatch(draft.novelText, /自己的(?:在|于)|(?:在|把|将){2,}|的的|了了|undefined|\[object Object\]/, "malformed action-fragment concatenation must not reach the visible day");
assert.ok(materialActions.length >= 2, "real Agents must choose validated hospitality affordances, not only talk around the visit");
assert.ok(materialActions.every((action) => action.materialConsequence && action.visitId));
assert.ok((draft.updateBundle?.tavernState?.ledger || []).length >= 1 || materialActions.some((action) => action.affordanceType === "receive_guest"), "the day must visibly advance a real hospitality transaction");
assert.equal(draft.updateBundle.tavernState.day, 1);
assert.equal(draft.updateBundle.tavernState.tick, 5);

console.log("realTavernDayAcceptance:smoke passed", {
  model: draft.model,
  elapsedMs: Date.now() - startedAt,
  dialogueTicks: dialogueTicks.map((tick) => tick.label),
  dialogue: turns.map((turn) => `${turn.speakerName}->${turn.targetName}:${turn.line}`),
  relationshipShifts: attributableShifts.map(({ shift }) => ({
    from: shift.fromCharacterId,
    to: shift.toCharacterId,
    sourceActionId: shift.sourceActionId,
    sourceImpactId: shift.sourceImpactId,
    rules: shift.rules,
  })),
  materialActions: materialActions.map((action) => `${action.slotLabel}:${action.actorName}:${action.affordanceType}`),
  visits: {
    active: draft.updateBundle?.tavernState?.activeVisits?.length || 0,
    archived: draft.updateBundle?.tavernState?.visits?.length || 0,
    ledger: draft.updateBundle?.tavernState?.ledger?.length || 0,
  },
  prose: draft.novelText,
});
