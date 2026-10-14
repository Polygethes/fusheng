import { createId } from "../data/seed.js";

const REACTIONS = new Set(["continue", "talk", "respond", "wait", "leave"]);

function clamp(value, min = 0, max = 100) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function text(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function relationshipBetween(state = {}, sourceId = "", targetId = "") {
  return (state.relationships || []).find((relationship) => (
    (relationship.fromCharacterId === sourceId && relationship.toCharacterId === targetId)
    || (relationship.fromCharacterId === targetId && relationship.toCharacterId === sourceId)
  )) || null;
}

function relationshipPressure(relationship = null) {
  if (!relationship) return 0;
  return clamp(
    Number(relationship.resentment || 0) * 0.24
      + Number(relationship.fear || 0) * 0.18
      + Number(relationship.dependence || 0) * 0.16
      + Number(relationship.protection || 0) * 0.16
      + Number(relationship.power || 0) * 0.14
      + Number(relationship.wantsToBeSeen || 0) * 0.12
      + (relationship.lastDialogue ? 22 : 0),
  );
}

function activePlanFor(state = {}, characterId = "") {
  return (state.activeCharacterPlans || state.characterPlans || [])
    .filter((plan) => plan?.characterId === characterId)
    .filter((plan) => !["completed", "abandoned"].includes(plan.status))
    .sort((left, right) => (
      Number(right.priority || 0) + Number(right.pressure || 0)
    ) - (
      Number(left.priority || 0) + Number(left.pressure || 0)
    ))[0] || null;
}

function simulationFor(privateSimulations = [], characterId = "") {
  return privateSimulations.find((simulation) => simulation?.characterId === characterId) || {};
}

function latestOverheardMemory(state = {}, characterId = "", targetId = "") {
  if (!characterId || !targetId) return null;
  const rows = (state.characterMemories || []).filter((memory) => (
    memory.characterId === characterId
      && memory.targetCharacterId === targetId
      && memory.sourceRelationshipShift?.relationshipSource === "overheard-dialogue"
  ));
  return rows.at(-1) || null;
}

function outputFor(agentOutputs = [], characterId = "") {
  return agentOutputs.find((output) => output?.characterId === characterId) || {};
}

function targetIdFor(simulation = {}, output = {}, plan = null, activeIds = new Set()) {
  const candidates = [
    simulation.reactionTargetCharacterId,
    output.reactionTargetCharacterId,
    simulation.targetCharacterId,
    output.targetCharacterId,
    plan?.targetCharacterId,
  ];
  return candidates.find((id) => id && activeIds.has(id)) || "";
}

function explicitReaction(simulation = {}, output = {}) {
  const value = text(simulation.reactionIntent || output.reactionIntent).toLowerCase();
  if (REACTIONS.has(value)) return value;
  if ((simulation.presenceIntent || output.presenceIntent) === "leave") return "leave";
  return "";
}

function fallbackReaction({ character = {}, simulation = {}, output = {}, plan = null, targetId = "", relationship = null } = {}) {
  if ((simulation.presenceIntent || output.presenceIntent) === "leave") return "leave";
  if (!targetId || targetId === character.id) return "continue";
  const directedAtTarget = simulation.targetCharacterId === targetId || output.targetCharacterId === targetId || plan?.targetCharacterId === targetId;
  const pressure = relationshipPressure(relationship)
    + Number(simulation.contradictionScore || output.realtimeContradictionScore || 0) * 0.25
    + Number(simulation.pressure || output.realtimePressure || 0) * 0.2
    + (directedAtTarget ? 45 : 0)
    + (relationship?.lastDialogue ? 18 : 0);
  return pressure >= 42 ? "talk" : "continue";
}

function activityDescription(character = {}, simulation = {}, output = {}, plan = null) {
  return text(
    simulation.currentActivity
      || output.currentActivity?.description
      || output.currentActivity
      || plan?.immediateObjective
      || simulation.planNextAction
      || output.planNextAction
      || simulation.actionCandidate
      || output.visibleAction
      || character.currentActivity?.description
      || "继续眼前的事",
  );
}

function buildActivity({ character = {}, simulation = {}, output = {}, plan = null, location = {} } = {}) {
  const previous = character.currentActivity && typeof character.currentActivity === "object"
    ? character.currentActivity
    : null;
  const description = activityDescription(character, simulation, output, plan);
  const sameActivity = previous?.status === "active"
    && previous.locationId === location.id
    && text(previous.description) === description
    && Number(previous.remainingTicks || 0) > 0;
  const requestedDuration = clamp(simulation.activityDurationTicks || output.activityDurationTicks || 2, 1, 12);
  return {
    id: sameActivity ? previous.id : createId("activity"),
    characterId: character.id || simulation.characterId || output.characterId || "",
    description,
    locationId: location.id || previous?.locationId || character.currentLocationId || "",
    targetCharacterId: simulation.targetCharacterId || output.targetCharacterId || plan?.targetCharacterId || "",
    sourcePlanId: plan?.id || simulation.planId || output.planId || "",
    remainingTicks: sameActivity ? Math.max(0, Number(previous.remainingTicks || 1) - 1) : Math.max(0, requestedDuration - 1),
    status: "active",
  };
}

function conversationScore(decision = {}) {
  return Number(decision.explicit ? 1000 : 0)
    + Number(decision.salience || 0)
    + Number(decision.relationshipPressure || 0)
    + Number(decision.simulationPressure || 0) * 0.35;
}

function conversationPolicy(decision = {}, simulation = {}, relationship = null) {
  const unresolved = Boolean(relationship?.lastDialogue || simulation.relationshipDialogueMemory);
  const pressure = Number(decision.relationshipPressure || 0) + Number(decision.simulationPressure || 0);
  return {
    objective: text(simulation.conversationObjective || `让${decision.targetCharacterName || "对方"}回应眼前的冲突`),
    endCondition: text(simulation.conversationEndCondition || "一方得到可执行的回答、明确拒绝，或决定离开"),
    maxTurns: unresolved || pressure >= 105 ? 4 : 3,
  };
}

export function charactersAtLocation(characters = [], locationId = "") {
  return characters.filter((character) => !character?.currentLocationId || character.currentLocationId === locationId);
}

export function buildAgentCognitiveFrame({
  state = {},
  location = {},
  activeCharacters = [],
  privateSimulations = [],
  agentOutputs = [],
} = {}) {
  const physicallyPresent = charactersAtLocation(activeCharacters, location.id);
  const activeIds = new Set(physicallyPresent.map((character) => character.id));
  const activities = [];
  const decisions = [];

  for (const [order, character] of physicallyPresent.entries()) {
    const simulation = simulationFor(privateSimulations, character.id);
    const output = outputFor(agentOutputs, character.id);
    const plan = activePlanFor(state, character.id);
    const targetId = targetIdFor(simulation, output, plan, activeIds);
    const target = physicallyPresent.find((item) => item.id === targetId) || null;
    const relationship = relationshipBetween(state, character.id, targetId);
    const overheardMemory = latestOverheardMemory(state, character.id, targetId);
    const explicit = explicitReaction(simulation, output);
    // An overheard exchange this character cannot let go of is itself a reason
    // to seek the speaker out: recall pressure ranks the conversation up
    // without overriding an explicit reaction.
    const reaction = explicit
      || (overheardMemory ? "talk" : "")
      || fallbackReaction({ character, simulation, output, plan, targetId, relationship });
    const activity = buildActivity({ character, simulation, output, plan, location });
    const directObservation = targetId && (
      simulation.targetCharacterId === targetId
      || output.targetCharacterId === targetId
      || plan?.targetCharacterId === targetId
    );
    const simulationPressure = clamp(simulation.pressure || output.realtimePressure || 0);
    const relationPressure = relationshipPressure(relationship);
    const salience = clamp(
      (directObservation ? 35 : 0)
        + (relationship?.lastDialogue ? 30 : 0)
        + (overheardMemory ? 45 : 0)
        + Number(simulation.contradictionScore || output.realtimeContradictionScore || 0) * 0.25,
    );
    activities.push(activity);
    decisions.push({
      characterId: character.id,
      characterName: character.name || character.id,
      targetCharacterId: targetId,
      targetCharacterName: target?.name || targetId,
      reaction,
      explicit: Boolean(explicit),
      memoryDriven: Boolean(overheardMemory),
      reason: text(simulation.reactionReason || output.reactionReason || (reaction === "continue" ? "当前观察不足以打断原计划。" : "眼前事件与当前计划发生了冲突。")),
      observation: target ? text(outputFor(agentOutputs, target.id).visibleAction || simulationFor(privateSimulations, target.id).actionCandidate || `${target.name}正在附近行动`) : "",
      salience,
      relationshipPressure: relationPressure,
      simulationPressure,
      activityId: activity.id,
      order,
    });
  }

  const candidates = decisions
    .filter((decision) => decision.reaction === "talk" && decision.targetCharacterId)
    .filter((decision) => {
      const targetDecision = decisions.find((item) => item.characterId === decision.targetCharacterId);
      return targetDecision && targetDecision.reaction !== "leave";
    })
    .sort((left, right) => {
      if (left.explicit !== right.explicit) return Number(right.explicit) - Number(left.explicit);
      // An overheard exchange the character cannot let go of is a legitimate
      // reason to open the next conversation ahead of cast order; without it,
      // insertion order would silently ignore the recall pressure.
      if (left.memoryDriven !== right.memoryDriven) return Number(right.memoryDriven) - Number(left.memoryDriven);
      return left.order - right.order;
    });
  const occupied = new Set();
  const conversations = [];
  for (const source of candidates) {
    if (occupied.has(source.characterId) || occupied.has(source.targetCharacterId)) continue;
    const simulation = simulationFor(privateSimulations, source.characterId);
    const relationship = relationshipBetween(state, source.characterId, source.targetCharacterId);
    const policy = conversationPolicy(source, simulation, relationship);
    conversations.push({
      sourceCharacterId: source.characterId,
      sourceCharacterName: source.characterName,
      responseCharacterId: source.targetCharacterId,
      responseCharacterName: source.targetCharacterName,
      reason: source.reason,
      objective: policy.objective,
      endCondition: policy.endCondition,
      maxTurns: policy.maxTurns,
    });
    occupied.add(source.characterId);
    occupied.add(source.targetCharacterId);
  }

  for (const conversation of conversations) {
    const responder = decisions.find((decision) => decision.characterId === conversation.responseCharacterId);
    if (responder && responder.reaction !== "talk") responder.reaction = "respond";
  }

  return { activities, decisions, conversations };
}
