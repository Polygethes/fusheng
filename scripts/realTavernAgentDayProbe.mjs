import { playModelPeriodWithRunners } from "../src/server/pipeline/openaiPipeline.mjs";
import { runTavernCausalAgent } from "../src/server/pipeline/tavernCausalScene.mjs";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
state.ui.timeGrain = "day";
state.ui.engineMode = "openai";

const decisions = [];
const startedAt = Date.now();
const draft = await playModelPeriodWithRunners(state, {
  pipelineMode: "live",
  characterAgentProtocolVersion: 1,
  runners: {
    async runTavernCausalAgent(input, options) {
      const result = await runTavernCausalAgent(input, options);
      decisions.push({
        slot: input.scene?.slotLabel || "",
        agentId: input.agent?.id || "",
        agentName: input.agent?.name || "",
        role: input.agent?.role || "",
        zoneId: input.scene?.zoneId || "",
        activation: input.activation || null,
        perceivedImpactCount: input.perceivedImpacts?.length || 0,
        availableAffordances: (input.availableAffordances || []).map((item) => item.type),
        candidateCount: input.privateActionCandidates?.length || 0,
        highestPressureActionKind: [...(input.privateActionCandidates || [])]
          .filter((candidate) => candidate.feasible)
          .sort((left, right) => right.activationScore - left.activationScore)[0]?.actionKind || "",
        openThreadObligations: (input.openConversationThreads || [])
          .filter((thread) => thread.nextObligationCharacterId === input.agent?.id)
          .map((thread) => thread.topic),
        decision: result.decision,
      });
      return result;
    },
  },
});

const ticks = (draft.periodSimulation?.ticks || []).map((tick) => ({
  slot: tick.label,
  actions: (tick.agentOutputs || []).map((output) => `${output.characterName}:${output.actionType}`),
  dialogue: (tick.canonicalDialogueTurns || []).map((turn) => `${turn.speakerName}->${turn.targetName}:${turn.line}`),
  consequences: (tick.lifeEvents || []).map((event) => event.consequence).filter(Boolean),
}));
const causalActions = draft.causalScene?.actions || [];
const causalDeliveries = draft.causalScene?.deliveries || [];
const relationshipShifts = (draft.updateBundle?.relationships || [])
  .filter((shift) => shift.generatedFrom === "character-agent-owned-appraisal")
  .map((shift) => {
    const action = causalActions.find((item) => item.id === shift.sourceActionId);
    const delivery = causalDeliveries.find((item) => (
      item.impactId === shift.sourceImpactId
      && item.recipientId === shift.fromCharacterId
      && item.sourceCharacterId === shift.toCharacterId
    ));
    return {
      from: shift.fromCharacterId,
      to: shift.toCharacterId,
      sourceActionId: shift.sourceActionId,
      sourceImpactId: shift.sourceImpactId,
      actionActorId: action?.actorId || "",
      deliveredTo: delivery?.recipientId || "",
      directionVerified: Boolean(
        action?.actorId === shift.toCharacterId
        && delivery
        && action.impactFactors?.some((impact) => impact.id === shift.sourceImpactId)
      ),
      rules: shift.rules || [],
      deltas: shift.deltas || {},
      finalTurn: shift.finalTurn,
    };
  });

console.log(JSON.stringify({
  elapsedMs: Date.now() - startedAt,
  agentDecisionMeta: draft.agentDecisionMeta,
  decisions,
  ticks,
  openThreads: draft.updateBundle?.tavernState?.eventThreads || [],
  relationshipShifts,
}, null, 2));
