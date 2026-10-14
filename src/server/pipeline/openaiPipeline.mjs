import { createId } from "../../data/seed.js";
import { auditDraft } from "../../engine/depthAuditor.js";
import { buildUpdateBundle } from "../../engine/stateUpdater.js";
import { playNext as playWithMock } from "../../engine/mockEngine.js";
import { charactersAvailableAtLocation } from "./presenceResolver.mjs";
import { calibrateAgentOutputWithMemory, compactState, selectedLocation, normalizeAgentOutput } from "./context.mjs";
import { observableActionFromPrivateSimulation, runPrivateSimulators } from "./privateSimulator.mjs";
import { buildLocalVisibilityLayer, runVisibilityLayer } from "./visibilityLayer.mjs";
import { runSceneInteractionSimulator } from "./sceneInteractionSimulator.mjs";
import { runRepairPass } from "./repairPass.mjs";
import { runDepthAuditor } from "./depthAuditor.mjs";
import { buildLocalDialoguePsychology, runDialoguePsychology } from "./dialoguePsychology.mjs";
import { liveProtocolFromTurns, publicLiveTurn, runLiveTurnLoop } from "./liveTurnEngine.mjs";
import { runBackgroundSlot } from "./backgroundSlotSimulator.mjs";
import { streamSceneNovel } from "./novelStreamer.mjs";
import { currentProviderConfig, requireCurrentModel } from "./responseClient.mjs";
import { activeInterventionsForState, applyInterventionsToAgentOutput, buildInterventionRelationshipShifts } from "../../state/interventions.js";
import { forbiddenTargetNames, relationshipIntensityScore } from "./relationshipTargeting.mjs";
import { ensureCharacterPlans } from "../../state/intentPlanner.js";
import { buildAgentDialogueExchange, buildCharacterDialogueDecision } from "../../engine/dialogueProtocol.js";
import { buildAgentCognitiveFrame } from "../../engine/cognitiveLoop.js";
import { isTavernLifeState, playTavernLifeNext } from "../../engine/tavernLifeEngine.js";
import {
  applyTavernAgentDecisionResult,
  runTavernAgentDecision,
  runTavernAgentDecisionPeriod,
} from "./tavernAgentDecision.mjs";
import { runTavernCausalAgent, runTavernCausalScene } from "./tavernCausalScene.mjs";
import { runTavernCharacterAgentV2Stage } from "./tavernCharacterAgentV2.mjs";
import { prepareTavernCausalSlot, TAVERN_CAUSAL_DAY_SLOTS } from "./tavernCausalEconomy.mjs";

function shouldRepair(audit) {
  if (process.env.CHARACTER_TOWN_DISABLE_REPAIR === "1") return false;
  if (process.env.CHARACTER_TOWN_FORCE_REPAIR === "1") return true;
  return Boolean(
    audit?.shouldRegenerate ||
    audit?.safeClosureRisk > 58 ||
    audit?.whitePaperCharacterRisk > 58 ||
    audit?.multiMotivationScore < 56 ||
    audit?.irreversibleConsequenceScore < 55 ||
    audit?.memoryUseRisk > 58 ||
    audit?.ignoredMemoryRisk > 58 ||
    audit?.memoryChangedActionScore < 36 ||
    audit?.singleMemoryRisk > 65 ||
    audit?.planRisk > 70 ||
    audit?.planUseScore < 35 ||
    audit?.realtimeSimulationRisk > 70 ||
    audit?.realtimeSimulationScore < 38 ||
    audit?.privateIntentCoverage < 48 ||
    audit?.unscriptedCollisionScore < 42
  );
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(Number(value) || 0)));
}

function deepClone(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

async function runCriticalModelStage(stage, operation) {
  try {
    return await operation();
  } catch (error) {
    if (error && typeof error === "object") {
      error.kind = error.kind || "model_stage";
      error.stage = error.stage || stage;
    }
    throw error;
  }
}

const DEFAULT_MODEL_RUNNERS = {
  runPrivateSimulators,
  runVisibilityLayer,
  runSceneInteractionSimulator,
  runDepthAuditor,
  runRepairPass,
  runDialoguePsychology,
  runLiveTurnLoop,
  runBackgroundSlot,
  runTavernAgentDecision,
  runTavernCausalAgent,
  runTavernCharacterAgentV2Stage,
  streamSceneNovel,
};

function runnerNotInjected(key, injectedKeys) {
  const error = new Error(
    `Runner "${String(key)}" was requested under a strict runner policy but was not injected. `
    + `Injected runners: ${injectedKeys.length ? injectedKeys.join(", ") : "(none)"}. `
    + "Falling back to the real provider here would turn an offline contract into a network call.",
  );
  error.code = "RUNNER_NOT_INJECTED";
  error.runnerKey = String(key);
  error.injectedRunnerKeys = injectedKeys;
  return error;
}

// Under the default policy a missing override resolves to the real
// implementation, which is what production wants.  Under `policy: "strict"` a
// runner that is invoked but never injected raises instead, so a renamed runner
// key surfaces as a named failure rather than as a silent provider call.
//
// The guard fires on invocation rather than on property access: call sites read
// runners defensively (passing them on as options they may never use), and
// throwing on a read would report drift that never happened.  Invocation is the
// exact moment a provider call would otherwise have gone out.
export function modelRunnerTable(overrides = {}, { policy = "default" } = {}) {
  const injected = Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => typeof value === "function"),
  );
  if (policy !== "strict") {
    return Object.fromEntries(
      Object.keys(DEFAULT_MODEL_RUNNERS).map((key) => [key, injected[key] || DEFAULT_MODEL_RUNNERS[key]]),
    );
  }
  const injectedKeys = Object.keys(injected).sort();
  return new Proxy(injected, {
    get(target, key, receiver) {
      if (typeof key === "symbol" || key in target) return Reflect.get(target, key, receiver);
      return function runnerNotInjectedGuard() {
        throw runnerNotInjected(key, injectedKeys);
      };
    },
    has(target, key) {
      return Reflect.has(target, key);
    },
  });
}

function modelRunners(overrides = {}, options = {}) {
  return modelRunnerTable(overrides, options);
}

async function emitPipelineProgress(options, event) {
  if (typeof options?.onProgress !== "function") return;
  try {
    await options.onProgress(event);
  } catch {
    // The simulation result must not depend on the observer transport.
  }
}

function progressContext(compact, options = {}) {
  return {
    slotIndex: options.progressContext?.slotIndex ?? null,
    slotLabel: options.progressContext?.slotLabel || "",
    locationId: compact.selectedLocation?.id || "",
    locationName: compact.selectedLocation?.name || "",
  };
}

async function runBalancedDialoguePsychology(runners, compact, privateSimulations, sceneInteraction, psychologyOptions) {
  const local = await buildLocalDialoguePsychology(compact, privateSimulations, sceneInteraction, psychologyOptions);
  const selectedId = compact.ui?.selectedCharacterId || "";
  const priority = privateSimulations.find((simulation) => simulation.characterId === selectedId)
    || privateSimulations.slice().sort((a, b) => Number(b.pressure || 0) - Number(a.pressure || 0))[0]
    || null;
  if (!priority) return local;
  try {
    const remote = await runners.runDialoguePsychology(compact, [priority], sceneInteraction, psychologyOptions);
    const byCharacter = new Map(local.reactions.map((reaction) => [reaction.characterId, reaction]));
    for (const reaction of remote.reactions || []) byCharacter.set(reaction.characterId, reaction);
    return {
      reactions: [...byCharacter.values()],
      stages: [
        ...(local.stages || []).filter((stage) => !String(stage.name || "").includes(priority.characterName || priority.characterId)),
        ...(remote.stages || []),
      ],
      failures: remote.failures || [],
    };
  } catch (error) {
    return {
      ...local,
      failures: [{
        characterId: priority.characterId || "",
        characterName: priority.characterName || "",
        error: error?.message || String(error),
      }],
    };
  }
}

async function emitPublicInteractionProgress(options, sceneInteraction = {}, compact = {}) {
  const context = progressContext(compact, options);
  for (const beat of sceneInteraction.interactionBeats || []) {
    const text = String(beat.beat || beat.visibleBeat || beat.responseBeat || "").trim();
    if (!text) continue;
    await emitPipelineProgress(options, {
      type: "action",
      actorId: beat.actorId || "",
      actorName: beat.actorName || compactCharacterName(compact, beat.actorId),
      targetId: beat.targetId || "",
      targetName: beat.targetName || compactCharacterName(compact, beat.targetId),
      text,
      ...context,
    });
  }
  for (const exchange of sceneInteraction.agentExchanges || []) {
    await emitPipelineProgress(options, {
      type: "exchange_started",
      sourceCharacterId: exchange.sourceCharacterId || "",
      sourceCharacterName: exchange.sourceCharacterName || compactCharacterName(compact, exchange.sourceCharacterId),
      responseCharacterId: exchange.responseCharacterId || "",
      responseCharacterName: exchange.responseCharacterName || compactCharacterName(compact, exchange.responseCharacterId),
      sharedObject: exchange.sharedObject || "",
      ...context,
    });
    for (const turn of exchange.dialogueTurns || []) {
      const line = String(turn.line || "").trim();
      if (!line) continue;
      await emitPipelineProgress(options, {
        type: "dialogue",
        speakerId: turn.speakerId || "",
        speakerName: turn.speakerName || compactCharacterName(compact, turn.speakerId),
        targetId: turn.targetId || "",
        targetName: turn.targetName || compactCharacterName(compact, turn.targetId),
        line,
        turnRole: turn.turnRole || "turn",
        respondsTo: turn.respondsTo || "",
        responseSourceLine: turn.responseSourceLine || "",
        responseSourceSpeakerId: turn.responseSourceSpeakerId || "",
        responseSourceSlotId: turn.responseSourceSlotId || "",
        responseSourceSlotLabel: turn.responseSourceSlotLabel || "",
        responseThreadId: turn.responseThreadId || "",
        responseTopic: turn.responseTopic || "",
        sharedObject: exchange.sharedObject || "",
        ...context,
      });
    }
    const outcome = String(exchange.eventOutcome || "").trim();
    if (outcome) {
      await emitPipelineProgress(options, {
        type: "exchange_outcome",
        sourceCharacterId: exchange.sourceCharacterId || "",
        sourceCharacterName: exchange.sourceCharacterName || compactCharacterName(compact, exchange.sourceCharacterId),
        responseCharacterId: exchange.responseCharacterId || "",
        responseCharacterName: exchange.responseCharacterName || compactCharacterName(compact, exchange.responseCharacterId),
        sharedObject: exchange.sharedObject || "",
        text: outcome,
        ...context,
      });
    }
  }
}

function relationshipDeltaByTone(tone) {
  const byTone = {
    惩罚: { resentment: 6, shame: 4, revenge: 3, fear: 2, wantsToBeSeen: 2 },
    接近: { attraction: 4, dependence: 3, shame: 3, wantsToBeSeen: 4, deception: 2 },
    伪装: { deception: 5, shame: 3, wantsToEscape: 3 },
    保护: { protection: 6, dependence: 2, wantsToPossess: 3, shame: 2 },
    陷害: { revenge: 7, deception: 5, fear: 3, resentment: 4 },
    自毁: { shame: 5, fear: 4, wantsToDestroy: 4, deception: 2 },
    共谋: { attraction: 3, deception: 4, dependence: 3, shame: 2 },
    求证: { wantsToBeSeen: 4, shame: 2, resentment: 2 },
    撤退: { wantsToEscape: 5, deception: 2, shame: 3 },
    试探: { wantsToBeSeen: 4, deception: 3, attraction: 2, resentment: 1 },
  };
  return byTone[tone] || byTone.试探;
}

function pickEvidence(sceneInteraction, index) {
  const evidence = sceneInteraction?.evidenceCreated || [];
  const traces = sceneInteraction?.irreversibleTraces || [];
  return evidence[index] || traces[index] || sceneInteraction?.irreversibleTrace || "一次可以被误读的沉默。";
}

function agentOutputFromPrivateSimulation(sim, visibilityRow, sceneInteraction, index, state, compact) {
  const raw = {
    characterId: sim.characterId,
    targetCharacterId: sim.targetCharacterId,
    tone: sim.tone,
    visibleAction: observableActionFromPrivateSimulation(sim),
    hiddenAction: sim.privateDesire,
    defenseAction: sim.defensiveMask,
    shadowAction: sim.shadowImpulse,
    selfDeceptionSentence: sim.selfLie,
    wantsFromOthers: sim.whatTheyWantFromOthers,
    desiredEmotionalResponse: `希望${sim.targetCharacterName}以一种能维持自己自我神话的方式回应。`,
    possibleHarm: sim.riskTheyWillCreate,
    possibleNobleAction: sim.nobleImpulse,
    possibleEvidenceLeft: pickEvidence(sceneInteraction, index),
    surfaceJustification: sim.publicGoal,
    desireReason: sim.privateDesire,
    shameReason: sim.whatTheyRefuseToAdmit,
    powerReason: `通过${sim.publicGoal}保留解释权。`,
    selfDeceptionReason: sim.defensiveMask,
    unadmittedPleasure: `如果${sim.targetCharacterName}被影响，${sim.characterName}会把这种确认解释成局面控制。`,
    postActionSelfPunishment: `${sim.characterName}会在事后重放这个动作，并把其中一部分改写成“不得不如此”。`,
    memoryId: sim.sourceMemoryId || sim.memoryId || null,
    memoryInfluence: sim.memoryTension || sim.memoryLine || "",
    planId: sim.sourcePlanId || sim.planId || null,
    planInfluence: sim.planTension || sim.planLine || "",
    planNextAction: sim.actionCandidate,
    planStatus: sim.sourcePlanId ? "active" : "implicit",
    realtimePublicGoal: sim.publicGoal,
    realtimePrivateDesire: sim.privateDesire,
    realtimeDefensiveMask: sim.defensiveMask,
    realtimeShadowImpulse: sim.shadowImpulse,
    realtimeNobleImpulse: sim.nobleImpulse,
    realtimeLieToSelf: sim.selfLie,
    realtimeActionCandidate: sim.actionCandidate,
    realtimePressure: Number(sim.pressure || sim.contradictionScore || 50),
    realtimeContradictionScore: Number(sim.contradictionScore || 55),
    currentActivity: sim.currentActivity || null,
    reactionIntent: sim.cognitiveDecision?.reaction || sim.reactionIntent || "continue",
    reactionReason: sim.cognitiveDecision?.reason || sim.reactionReason || "",
    conversationObjective: sim.conversationObjective || "",
    conversationEndCondition: sim.conversationEndCondition || "",
    visibilityFacts: visibilityRow?.knownFacts || [],
    falseBeliefs: visibilityRow?.falseBeliefs || sim.falseBeliefs || [],
    withheldFacts: visibilityRow?.withheldFacts || sim.withheldFacts || [],
  };
  const normalized = normalizeAgentOutput(raw, sim.characterId, sim.targetCharacterId, {
    targetCharacterName: sim.targetCharacterName || compactCharacterName(compact, sim.targetCharacterId),
    forbiddenTargetNames: forbiddenTargetNames(compact, sim.characterId, sim.targetCharacterId),
  });
  const character = (compact.activeCharacters || []).find((item) => item.id === sim.characterId);
  const target = (compact.activeCharacters || []).find((item) => item.id === sim.targetCharacterId);
  const calibrated = calibrateAgentOutputWithMemory(normalized, { compact, character, target });
  return applyInterventionsToAgentOutput(calibrated, { ...compact, interventions: compact.activeInterventions, characters: compact.activeCharacters, ...state });
}

function buildAgentOutputsFromSimulation(state, compact, privateSimulations, visibilityLayer, sceneInteraction) {
  return (privateSimulations || []).map((sim, index) => {
    const visibilityRow = (visibilityLayer?.perCharacter || []).find((row) => row.characterId === sim.characterId);
    return agentOutputFromPrivateSimulation(sim, visibilityRow, sceneInteraction, index, state, compact);
  });
}

function protocolOutputFromSimulation(sim = {}) {
  return {
    outputId: sim.outputId || createId("agent_output"),
    characterId: sim.characterId || "",
    targetCharacterId: sim.targetCharacterId || "",
    characterName: sim.characterName || sim.characterId || "有人",
    targetCharacterName: sim.targetCharacterName || sim.targetCharacterId || "对方",
    tone: sim.tone || "试探",
    realtimePublicGoal: sim.publicGoal || "",
    realtimePrivateDesire: sim.privateDesire || "",
    realtimeLeverageObject: sim.agentProfile?.leverageObject || "",
    relationshipDialogueMemory: sim.relationshipDialogueMemory || null,
    currentActivity: sim.currentActivity || sim.actionCandidate || sim.planNextAction || "",
    activityDurationTicks: Number(sim.activityDurationTicks || 2),
    reactionIntent: sim.reactionIntent || "",
    reactionTargetCharacterId: sim.reactionTargetCharacterId || sim.targetCharacterId || "",
    reactionReason: sim.reactionReason || "",
    conversationObjective: sim.conversationObjective || "",
    conversationEndCondition: sim.conversationEndCondition || "",
    presenceIntent: sim.presenceIntent || "stay",
    exitUrgency: Number(sim.exitUrgency || 0),
    exitResistance: Number(sim.exitResistance || 0),
    realtimePressure: Number(sim.pressure ?? 55),
    realtimeContradictionScore: Number(sim.contradictionScore ?? 55),
    planId: sim.planId || sim.sourcePlanId || "",
    planNextAction: sim.planNextAction || sim.actionCandidate || "",
    recentDialogueLines: (sim.relationshipDialogueHistory || []).flatMap((dialogue) => (
      dialogue.dialogueTurns || []
    )).filter((turn) => turn.speakerId === sim.characterId).map((turn) => turn.line).filter(Boolean),
  };
}

export function buildModelAgentDialogueProtocol(compact = {}, privateSimulations = []) {
  const agentExchanges = [];
  const lineSpeakers = new Map();
  for (const character of compact.activeCharacters || []) {
    for (const value of character.agentProfile?.dialogueMoves || []) {
      const line = String(value || "").trim();
      if (!line) continue;
      if (!lineSpeakers.has(line)) lineSpeakers.set(line, new Set());
      lineSpeakers.get(line).add(character.id);
    }
  }
  const sharedDialogueLines = [...lineSpeakers.entries()]
    .filter(([, speakers]) => speakers.size > 1)
    .map(([line]) => line);
  const charactersById = new Map((compact.activeCharacters || []).map((character) => [character.id, character]));
  const outputsById = new Map((privateSimulations || []).map((sim) => [
    sim.characterId,
    { ...protocolOutputFromSimulation(sim), sharedDialogueLines },
  ]));
  const cognitiveFrame = buildAgentCognitiveFrame({
    state: compact,
    location: compact.selectedLocation || {},
    activeCharacters: compact.activeCharacters || [],
    privateSimulations,
    agentOutputs: [...outputsById.values()],
  });
  const decisionsById = new Map();
  const exchangeTurnsById = new Map();
  for (const conversation of cognitiveFrame.conversations) {
    const sourceSimulation = (privateSimulations || []).find((sim) => sim.characterId === conversation.sourceCharacterId) || {};
    const responseSimulation = (privateSimulations || []).find((sim) => sim.characterId === conversation.responseCharacterId) || {};
    const sourceCharacter = charactersById.get(conversation.sourceCharacterId) || {
      id: sourceSimulation.characterId,
      name: sourceSimulation.characterName,
      agentProfile: sourceSimulation.agentProfile,
      actionLines: { desire: sourceSimulation.privateDesire, visible: sourceSimulation.publicGoal },
    };
    const responseCharacter = charactersById.get(conversation.responseCharacterId) || {
      id: responseSimulation.characterId,
      name: responseSimulation.characterName,
      agentProfile: responseSimulation.agentProfile,
      actionLines: { desire: responseSimulation.privateDesire, visible: responseSimulation.publicGoal },
    };
    const sourceOutput = outputsById.get(conversation.sourceCharacterId) || {};
    const responseOutput = outputsById.get(conversation.responseCharacterId) || {};
    const opening = buildCharacterDialogueDecision({
      character: sourceCharacter,
      target: responseCharacter,
      output: sourceOutput,
    });
    const response = buildCharacterDialogueDecision({
      character: responseCharacter,
      target: sourceCharacter,
      output: responseOutput,
      observedDecision: opening,
    });
    const sourceWithDecision = { ...sourceOutput, dialogueDecision: opening };
    const responseWithDecision = { ...responseOutput, dialogueDecision: response };
    const dialogueExchangeTurns = buildAgentDialogueExchange({
      sourceCharacter,
      sourceOutput: sourceWithDecision,
      responseCharacter,
      responseOutput: responseWithDecision,
      conversationPolicy: conversation,
    });
    decisionsById.set(sourceCharacter.id, opening);
    decisionsById.set(responseCharacter.id, response);
    exchangeTurnsById.set(responseCharacter.id, dialogueExchangeTurns);
    agentExchanges.push({
      sourceCharacterId: sourceCharacter.id,
      sourceCharacterName: sourceCharacter.name || sourceOutput.characterName,
      responseCharacterId: responseCharacter.id,
      responseCharacterName: responseCharacter.name || responseOutput.characterName,
      sharedObject: dialogueExchangeTurns[0]?.topic || opening.topic || "",
      dialogueTurns: dialogueExchangeTurns,
      conversationObjective: conversation.objective,
      conversationEndCondition: conversation.endCondition,
      conversationMaxTurns: conversation.maxTurns,
      reactionReason: conversation.reason,
      generatedFrom: "character-agent-protocol",
    });
  }
  const simulations = (privateSimulations || []).map((sim) => {
    const character = charactersById.get(sim.characterId) || {
      id: sim.characterId,
      name: sim.characterName,
      agentProfile: sim.agentProfile,
      actionLines: { desire: sim.privateDesire, visible: sim.publicGoal },
    };
    const cognitiveDecision = cognitiveFrame.decisions.find((decision) => decision.characterId === sim.characterId) || null;
    const currentActivity = cognitiveFrame.activities.find((activity) => activity.characterId === sim.characterId) || null;
    return {
      ...sim,
      characterName: sim.characterName || character.name,
      cognitiveDecision,
      currentActivity,
      dialogueDecision: decisionsById.get(sim.characterId) || null,
      dialogueExchangeTurns: exchangeTurnsById.get(sim.characterId) || [],
    };
  });
  return { privateSimulations: simulations, agentExchanges, cognitiveFrame };
}

export function applyAgentDialogueProtocolToScene(sceneInteraction = {}, protocolExchanges = []) {
  if (!Array.isArray(protocolExchanges) || !protocolExchanges.length) {
    return { ...sceneInteraction, agentExchanges: [] };
  }
  const modelExchanges = Array.isArray(sceneInteraction.agentExchanges) ? sceneInteraction.agentExchanges : [];
  const used = new Set();
  const locked = protocolExchanges.map((protocol) => {
    const index = modelExchanges.findIndex((exchange, modelIndex) => (
      !used.has(modelIndex)
      && exchange.sourceCharacterId === protocol.sourceCharacterId
      && exchange.responseCharacterId === protocol.responseCharacterId
    ));
    const modelExchange = index >= 0 ? modelExchanges[index] : {};
    if (index >= 0) used.add(index);
    return {
      ...modelExchange,
      ...protocol,
      eventOutcome: modelExchange.eventOutcome || protocol.eventOutcome || "",
      relationshipDeltas: modelExchange.relationshipDeltas || protocol.relationshipDeltas || [],
      dialogueTurns: protocol.dialogueTurns,
      generatedFrom: "character-agent-protocol",
    };
  });
  return {
    ...sceneInteraction,
    agentExchanges: locked,
  };
}

function compactCharacterName(compact, id) {
  return compact?.activeCharacters?.find((character) => character.id === id)?.name || id;
}

function chooseModelInteractionSource(outputs = [], output = {}) {
  return outputs.find((item) => item.characterId === output.targetCharacterId)
    || outputs.find((item) => item.targetCharacterId === output.characterId)
    || outputs[outputs.length - 1]
    || null;
}

function matchingInteractionBeat(sceneInteraction, output, sourceOutput) {
  const beats = sceneInteraction?.interactionBeats || [];
  return beats.find((beat) => beat.actorId === sourceOutput?.characterId && beat.targetId === output.characterId)
    || beats.find((beat) => beat.actorId === output.characterId && beat.targetId === sourceOutput?.characterId)
    || beats.find((beat) => String(beat.beat || "").includes(output.characterId))
    || null;
}

function actionFromInteractionBeat(beat, output, compact) {
  const text = String(beat?.responseBeat || beat?.beat || beat?.visibleBeat || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const actorName = compactCharacterName(compact, output.characterId);
  const actorStart = text.indexOf(actorName);
  const actorText = actorStart >= 0 ? text.slice(actorStart) : text;
  const sentence = actorText
    .split(/[。！？]/)
    .map((part) => part.trim())
    .find((part) => part.includes(actorName));
  if (sentence) return `${sentence}。`;
  return text.length > 140 ? `${text.slice(0, 140)}。` : text;
}

function dialogueTurnsForOutput(sceneInteraction = {}, output = {}, sourceOutput = null) {
  const turns = (sceneInteraction.agentExchanges || []).flatMap((exchange) => exchange.dialogueTurns || []);
  const ownTurns = turns.filter((turn) => turn.speakerId === output.characterId);
  if (!ownTurns.length) return [];
  if (sourceOutput?.characterId) {
    const responseTurns = ownTurns.filter((turn) => turn.targetId === sourceOutput.characterId);
    return responseTurns.length ? responseTurns : [ownTurns[0]];
  }
  const priority = new Set(["claim", "counter", "turn"]);
  const primaryTurns = ownTurns.filter((turn) => priority.has(turn.turnRole));
  return primaryTurns.length ? primaryTurns : [ownTurns[0]];
}

function sentencePrefix(text = "") {
  const trimmed = String(text || "").trim();
  if (!trimmed) return "";
  if (/[。！？…][”"]?$/.test(trimmed)) return trimmed;
  return `${trimmed.replace(/[。！？…]+$/u, "")}。`;
}

function visibleActionWithDialogue(baseAction = "", turns = [], compact = {}) {
  const normalizedTurns = (Array.isArray(turns) ? turns : [turns]).filter((turn) => String(turn?.line || "").trim());
  let next = String(baseAction || "").trim();
  for (const turn of normalizedTurns) {
    const line = String(turn.line || "").trim();
    if (!line || next.includes(line)) continue;
    const speakerName = turn.speakerName || compactCharacterName(compact, turn.speakerId) || "对方";
    const prefix = sentencePrefix(next);
    next = `${prefix}${speakerName}说：“${line.replace(/[。！？…]+$/g, "")}。”`;
  }
  return next || baseAction;
}

function spokenDialoguePayload(turn = {}) {
  return {
    line: turn.line,
    turnRole: turn.turnRole,
    targetCharacterId: turn.targetId,
    respondsToLine: turn.respondsTo || "",
  };
}

function dialogueDecisionFromTurn(turn = {}) {
  if (!turn?.line) return null;
  return {
    turnId: turn.turnId || "",
    generatedBy: turn.generatedBy || "character-agent",
    speakerId: turn.speakerId || "",
    speakerName: turn.speakerName || "",
    targetId: turn.targetId || "",
    targetName: turn.targetName || "",
    act: turn.act || turn.turnRole || "claim",
    topic: turn.topic || "",
    proposition: turn.proposition || "",
    utterance: turn.line,
    observedTurnId: turn.observedTurnId || "",
    observedUtterance: turn.observedUtterance || turn.respondsTo || "",
  };
}

export function attachInteractionCausalityToAgentOutputs(agentOutputs = [], sceneInteraction = {}, compact = {}) {
  const exchangeId = createId("model_exchange");
  const outputs = (agentOutputs || []).map((output, index) => ({
    ...output,
    outputId: output.outputId || createId("agent_output"),
    agentExchangeId: output.agentExchangeId || exchangeId,
    interactionRole: index === 0 ? "initiator" : "responder",
  }));
  const attached = [];
  for (const [index, output] of outputs.entries()) {
    if (index === 0) {
      const turns = dialogueTurnsForOutput(sceneInteraction, output);
      const visibleAction = visibleActionWithDialogue(output.visibleAction || "", turns, compact);
      attached.push({
        ...output,
        visibleAction,
        realtimeActionCandidate: visibleAction,
        dialogueDecision: dialogueDecisionFromTurn(turns[0]),
        spokenDialogue: turns[0] ? spokenDialoguePayload(turns[0]) : null,
        spokenDialogues: turns.map(spokenDialoguePayload),
      });
      continue;
    }
    const sourceOutput = chooseModelInteractionSource(attached, output);
    if (!sourceOutput) {
      attached.push(output);
      continue;
    }
    const beat = matchingInteractionBeat(sceneInteraction, output, sourceOutput);
    const turns = dialogueTurnsForOutput(sceneInteraction, output, sourceOutput);
    const ownCandidateBeforeResponse = output.visibleAction || "";
    const visibleAction = visibleActionWithDialogue(
      actionFromInteractionBeat(beat, output, compact) || ownCandidateBeforeResponse,
      turns,
      compact,
    );
    attached.push({
      ...output,
      targetCharacterId: sourceOutput.characterId,
      visibleAction,
      realtimeActionCandidate: visibleAction,
      dialogueDecision: dialogueDecisionFromTurn(turns[0]),
      interactionInput: {
        sourceCharacterId: sourceOutput.characterId,
        sourceOutputId: sourceOutput.outputId,
        sourceTone: sourceOutput.tone,
        observedVisibleAction: sourceOutput.visibleAction,
        observedDialogueTurnId: sourceOutput.dialogueDecision?.turnId || "",
        observedUtterance: sourceOutput.dialogueDecision?.utterance || "",
        ownCandidateBeforeResponse,
        sceneBeat: beat?.beat || "",
        dialogueLine: turns[0]?.line || "",
        dialogueTurnRole: turns[0]?.turnRole || "",
        respondsToLine: turns[0]?.respondsTo || "",
        dialogueLines: turns.map((turn) => turn.line),
      },
      spokenDialogue: turns[0] ? spokenDialoguePayload(turns[0]) : null,
      spokenDialogues: turns.map(spokenDialoguePayload),
      reactsToOutputId: sourceOutput.outputId,
      responseToCharacterId: sourceOutput.characterId,
    });
  }
  const presenceByCharacter = new Map((sceneInteraction.presenceChanges || []).map((change) => [change.characterId, change]));
  return attached.map((output) => {
    const change = presenceByCharacter.get(output.characterId);
    if (!change) return output;
    const visibleDeparture = String(change.visibleDeparture || "").trim();
    const visibleAction = visibleDeparture && !String(output.visibleAction || "").includes(visibleDeparture)
      ? `${sentencePrefix(output.visibleAction || "")}${visibleDeparture}`
      : output.visibleAction;
    return {
      ...output,
      visibleAction,
      realtimeActionCandidate: visibleAction,
      presenceDecision: change.decision,
      currentLocationId: change.decision === "leave" ? change.destinationId || "" : "",
      presenceTrigger: change.trigger || "",
    };
  });
}

function buildSimulationTick(state, compact, privateSimulations, visibilityLayer, sceneInteraction) {
  const location = selectedLocation(state);
  const averageContradiction = clamp(privateSimulations.reduce((sum, sim) => sum + Number(sim.contradictionScore || 0), 0) / Math.max(privateSimulations.length, 1));
  const hiddenFactPressure = clamp((visibilityLayer.hiddenFacts || []).length * 14 + (compact.ui?.eventImpact || 0) * 0.35 + averageContradiction * 0.55 + (sceneInteraction.misunderstandings || []).length * 8);
  return {
    id: createId("tick"),
    branchId: state.ui?.activeBranchId || state.project?.activeBranchId || "branch_main",
    createdAt: new Date().toISOString(),
    grain: compact.ui?.timeGrain || "scene",
    mode: "model_orchestrated_realtime_simulation_tick",
    locationId: location.id,
    locationName: location.name,
    activeCharacterIds: compact.activeCharacterIds,
    visiblePressure: (visibilityLayer.visibleFacts || []).join("；"),
    hiddenPressure: (visibilityLayer.hiddenFacts || []).join("；"),
    injectedEvent: compact.ui?.injectedEvent || "",
    eventImpact: Number(compact.ui?.eventImpact || 0),
    interventions: (compact.activeInterventions || []).map((item) => item.instruction || item.type),
    privateSimulations,
    visibilityLayer,
    sceneInteraction,
    presenceChanges: sceneInteraction.presenceChanges || [],
    presentAtEndIds: sceneInteraction.presentAtEndIds || compact.activeCharacterIds,
    remainingCastAftermath: sceneInteraction.remainingCastAftermath || [],
    interaction: sceneInteraction,
    contradictionPressureSummary: {
      averageContradiction,
      hiddenFactPressure,
      highest: privateSimulations.slice().sort((a, b) => Number(b.contradictionScore || 0) - Number(a.contradictionScore || 0))[0] || null,
    },
  };
}

function ensureRelationshipShifts(agentOutputs, sceneInteraction) {
  const fromScene = Array.isArray(sceneInteraction.relationshipShift) ? sceneInteraction.relationshipShift : [];
  const fallback = agentOutputs.flatMap((output) => ([
    {
      fromCharacterId: output.characterId,
      toCharacterId: output.targetCharacterId,
      deltas: relationshipDeltaByTone(output.tone),
      misreading: `${output.characterId}把对方反应纳入自己的私人模拟。`,
      unspoken: output.wantsFromOthers,
    },
  ]));
  return fromScene.length ? fromScene : fallback;
}

function normalizeDraftBase(state, compact, agentOutputs, sceneInteraction, pipelineMeta, simulationTick = null) {
  const location = selectedLocation(state);
  return {
    id: createId("draft"),
    projectId: state.project.id,
    branchId: state.ui?.activeBranchId || state.project?.activeBranchId || "branch_main",
    createdAt: new Date().toISOString(),
    provider: "openai-realtime-simulation",
    model: requireCurrentModel(),
    timeGrain: state.ui?.timeGrain,
    locationId: location.id,
    participantIds: compact.activeCharacterIds,
    userDirective: state.ui?.userDirective,
    injectedEvent: state.ui?.injectedEvent,
    eventImpact: state.ui?.eventImpact || 0,
    interventionsUsed: activeInterventionsForState(state).map((item) => item.id),
    interventionsApplied: agentOutputs.flatMap((output) => output.appliedInterventions || []),
    simulationMode: "model-orchestrated-realtime-character-simulation-loop",
    simulationTick,
    visibilityLayer: simulationTick?.visibilityLayer || {},
    privateSimulations: simulationTick?.privateSimulations || [],
    sceneInteraction,
    surfaceEvent: sceneInteraction.surfaceEvent,
    sceneText: sceneInteraction.sceneText,
    agentOutputs,
    subtextMatrix: sceneInteraction.subtextMatrix || [],
    relationshipShift: [
      ...ensureRelationshipShifts(agentOutputs, sceneInteraction),
      ...buildInterventionRelationshipShifts(state, compact.activeCharacterIds || []),
    ],
    irreversibleTraces: [
      ...(sceneInteraction.irreversibleTraces || []),
      ...(sceneInteraction.evidenceCreated || []).map((item) => `模型场景证据：${item}`),
      ...(sceneInteraction.rumorCreated || []).map((item) => `模型场景谣言：${item}`),
      ...activeInterventionsForState(state).map((item) => `操盘干预留下痕迹：${item.instruction || item.type}`),
    ],
    directorNotes: sceneInteraction.directorNotes || sceneInteraction.sceneThesis || "",
    pipelineMeta,
  };
}

function relationshipShiftSignature(shift = {}) {
  return [
    shift.fromCharacterId || "",
    shift.toCharacterId || "",
    shift.generatedFrom || "",
    shift.relationshipSource || "",
    shift.sourceOutputId || "",
    shift.responseOutputId || "",
    shift.sharedObject || "",
    shift.followupTurn || "",
    shift.finalTurn || "",
    shift.interventionId || "",
    shift.misreading || "",
    shift.unspoken || "",
  ].join("|");
}

function shouldPreserveOriginalRelationshipShift(shift = {}) {
  return Boolean(
    shift.generatedFrom === "model-agent-dialogue"
    || shift.generatedFrom === "agent-dialogue-relationship"
    || shift.generatedFrom === "causal-perceived-relationship-outcome"
    || shift.generatedFrom === "character-agent-owned-appraisal"
    || /agent.*exchange|dialogue/i.test(String(shift.relationshipSource || ""))
    || shift.interventionId
  );
}

function mergeRepairedRelationshipShifts(original = [], repaired = []) {
  if (!Array.isArray(repaired)) return Array.isArray(original) ? original : [];
  const merged = [...repaired];
  const signatures = new Set(merged.map(relationshipShiftSignature));
  for (const shift of original || []) {
    if (!shouldPreserveOriginalRelationshipShift(shift)) continue;
    const signature = relationshipShiftSignature(shift);
    if (signatures.has(signature)) continue;
    signatures.add(signature);
    merged.push(shift);
  }
  return merged;
}

function isPeriodGrain(grain) {
  return grain === "day" || grain === "week";
}

function periodSlotsForGrain(grain) {
  if (grain === "week") {
    return [
      { label: "周一", focus: "误投材料先在行政层出现" },
      { label: "周二", focus: "课堂与走廊开始交换版本" },
      { label: "周三", focus: "档案和论坛把私人动作改写成证据" },
      { label: "周四", focus: "评奖压力迫使每个人寻找体面退路" },
      { label: "周五", focus: "公开流程把隐藏动机压到桌面边缘" },
      { label: "周末", focus: "沉默和补救在校内继续发酵" },
    ];
  }
  return [
    { label: "上午", focus: "意外先在公共空间露出" },
    { label: "中午", focus: "谣言穿过论坛和走廊" },
    { label: "下午", focus: "程序与档案开始吞掉私人解释" },
    { label: "傍晚", focus: "当事人在半公开地点互相试探" },
    { label: "夜间", focus: "没有被看见的动作留下明天的证据" },
  ];
}

function uniqueById(items = []) {
  const seen = new Set();
  const result = [];
  for (const item of items || []) {
    if (!item?.id || seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }
  return result;
}

function orderedLocations(state, firstLocation) {
  const locations = Array.isArray(state.locations) && state.locations.length ? state.locations : [firstLocation].filter(Boolean);
  return uniqueById([
    firstLocation,
    ...locations.filter((location) => location?.id !== firstLocation?.id),
  ]);
}

function chooseModelLocationForSlot(state, locations = [], slotIndex = 0, focus = {}) {
  if (focus.mode === "location" && focus.locationId) {
    if (slotIndex === 0) return locations.find((location) => location.id === focus.locationId) || locations[0];
    const nonFocused = locations.filter((location) => location.id !== focus.locationId);
    return nonFocused[(slotIndex - 1) % Math.max(nonFocused.length, 1)] || locations[0];
  }
  const ambientLocation = selectedLocation(state);
  const hasDialogueFocus = (state.relationships || []).some((rel) => rel?.lastDialogue && (
    rel.lastDialogue.locationId === ambientLocation?.id || rel.lastDialogue.locationName === ambientLocation?.name
  ));
  if (hasDialogueFocus && slotIndex % 2 === 0) return ambientLocation;
  return locations[slotIndex % Math.max(locations.length, 1)] || ambientLocation;
}

export function chooseModelCharactersForSlot(state, location, slotIndex = 0) {
  const characters = state.characters || [];
  const available = charactersAvailableAtLocation(characters, location?.id || "");
  if (available.length <= 3) return available;
  const byId = new Map(available.map((character) => [character.id, character]));
  const hotRelationshipCast = hotDialogueRelationshipCast(state, byId);
  const frequent = (location?.frequentCharacters || []).map((id) => byId.get(id)).filter(Boolean);
  const active = (state.ui?.activeCharacterIds || []).map((id) => byId.get(id)).filter(Boolean);
  const rotated = available.slice(slotIndex).concat(available.slice(0, slotIndex));
  return uniqueById([...hotRelationshipCast, ...frequent, ...active, ...rotated]).slice(0, Math.min(3, available.length));
}

function chooseBalancedCharactersForSlot(state, location, slotIndex = 0, usage = new Map()) {
  const characters = charactersAvailableAtLocation(state.characters || [], location?.id || "");
  const frequentIds = new Set(location?.frequentCharacters || []);
  const activeIds = new Set(state.ui?.activeCharacterIds || []);
  const byId = new Map(characters.map((character) => [character.id, character]));
  const hotIds = new Set(hotDialogueRelationshipCast(state, byId).map((character) => character.id));
  const ranked = characters
    .map((character, index) => {
      const record = usage.get(character.id) || { count: 0, lastSlot: -10 };
      const currentLocationBoost = character.currentLocationId === location?.id ? 110 : 0;
      const score = currentLocationBoost
        + (frequentIds.has(character.id) ? 65 : 0)
        + (hotIds.has(character.id) ? 45 : 0)
        + (activeIds.has(character.id) ? 14 : 0)
        + ((characters.length - ((index - slotIndex + characters.length) % characters.length)) * 2)
        - record.count * 82
        - (record.lastSlot === slotIndex - 1 ? 105 : 0);
      return { character, score };
    })
    .sort((a, b) => b.score - a.score || a.character.id.localeCompare(b.character.id))
    .map((item) => item.character);
  let selected = ranked.slice(0, Math.min(3, ranked.length));
  const seenSignatures = usage.get("__cast_signatures__") || new Set();
  const signatureOf = (items) => items.map((item) => item.id).sort().join("|");
  if (seenSignatures.has(signatureOf(selected))) {
    for (let index = selected.length; index < ranked.length; index += 1) {
      const candidate = [...selected.slice(0, -1), ranked[index]];
      if (!seenSignatures.has(signatureOf(candidate))) {
        selected = candidate;
        break;
      }
    }
  }
  while (selected.length > 1 && seenSignatures.has(signatureOf(selected))) selected = selected.slice(0, -1);
  return selected;
}

function notePeriodCastUsage(usage, characters = [], slotIndex = 0) {
  for (const character of characters) {
    const previous = usage.get(character.id) || { count: 0, lastSlot: -10 };
    usage.set(character.id, { count: previous.count + 1, lastSlot: slotIndex });
  }
  const signatures = usage.get("__cast_signatures__") || new Set();
  signatures.add(characters.map((character) => character.id).sort().join("|"));
  usage.set("__cast_signatures__", signatures);
}

function hotDialogueRelationshipCast(state, byId) {
  const hot = (state.relationships || [])
    .filter((rel) => rel?.lastDialogue)
    .filter((rel) => byId.has(rel.fromCharacterId) && byId.has(rel.toCharacterId))
    .map((rel) => ({
      rel,
      score: 140 + relationshipIntensityScore(rel) + Number(rel.lastDialogue?.dialogueTurnCount || 0) * 5,
    }))
    .sort((a, b) => b.score - a.score)[0]?.rel;
  if (!hot) return [];
  return [byId.get(hot.fromCharacterId), byId.get(hot.toCharacterId)].filter(Boolean);
}

function buildModelPeriodFocus(state, firstLocation) {
  if (state.ui?.focusMode === "location") {
    return {
      mode: "location",
      locationId: firstLocation?.id || null,
      locationName: firstLocation?.name || null,
      precisionRule: `${firstLocation?.name || "当前地点"}被盯紧；其他地点只留下脚步、物件和传闻。`,
    };
  }
  return {
    mode: "ambient",
    locationId: null,
    locationName: null,
    precisionRule: "整座小镇留下脚步、物件和传闻；关系热区会在后续时段回到场中。",
  };
}

function cleanBackgroundFragment(value = "") {
  return String(value || "")
    .replace(/[【】]/g, "")
    .replace(/(?:第?\s*\d+|几|多)\s*轮|上一轮|本轮|未结清|把话推回去/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[。！？]+$/g, "");
}

function backgroundDetailForLocation(location = {}, slotIndex = 0, used = new Set()) {
  const likelyEvents = (location.likelyEvents || []).map(cleanBackgroundFragment).filter(Boolean);
  const candidates = likelyEvents.length ? likelyEvents : [
    location.surfaceUse,
    location.visibleUse,
    location.subtext,
  ].map(cleanBackgroundFragment).filter(Boolean);
  const rotated = candidates.slice(slotIndex % Math.max(candidates.length, 1)).concat(candidates.slice(0, slotIndex % Math.max(candidates.length, 1)));
  const picked = rotated.find((candidate) => !used.has(candidate)) || rotated[0] || "入口处有东西被挪动过";
  used.add(picked);
  return picked.slice(0, 110);
}

function backgroundActionFromDraft(sceneDraft = {}, slotIndex = 0, activeCharacters = [], usedActions = new Set()) {
  const outputs = sceneDraft.agentOutputs || [];
  const namesById = new Map(activeCharacters.map((character) => [character.id, character.name]));
  const start = slotIndex % Math.max(outputs.length, 1);
  const rotated = outputs.slice(start).concat(outputs.slice(0, start));
  for (const output of rotated) {
    const actorName = namesById.get(output.characterId) || "";
    const beforeSpeech = String(output.visibleAction || "").split(/(?:说|问|喊)[：:]?[“"]/)[0];
    const action = beforeSpeech
      .split(/[。！？]/)
      .map(cleanBackgroundFragment)
      .find((sentence) => sentence.length >= 5) || "";
    if (!action || /到一半|围着\S+停住|关系状态|下一步|后台|凭证/.test(action)) continue;
    const actionKey = activeCharacters
      .reduce((value, character) => value.replaceAll(character.name, "人物"), action)
      .split(/[，,]/)[0]
      .replace(/\s+/g, "")
      .trim();
    if (!actionKey || usedActions.has(actionKey)) continue;
    let conciseAction = action;
    for (const name of namesById.values()) {
      let seen = false;
      conciseAction = conciseAction.replaceAll(name, () => {
        if (!seen) {
          seen = true;
          return name;
        }
        return name === actorName ? "自己" : "对方";
      });
    }
    usedActions.add(actionKey);
    return `${conciseAction.slice(0, 120)}。`;
  }
  return "";
}

export function buildBalancedBackgroundNovel({ location, slot, sceneDraft, slotIndex, usedDetails, usedActions, activeCharacters }) {
  const action = backgroundActionFromDraft(sceneDraft, slotIndex, activeCharacters, usedActions);
  if (action) return `${slot.label}，${location.name}。${action}`.trim();
  return `${slot.label}，${location.name}没有留下足以确认的变化。`;
}

function buildLocalModelState(state, location, activeCharacters, slot = null) {
  return {
    ...state,
    ui: {
      ...(state.ui || {}),
      selectedLocationId: location.id,
      activeCharacterIds: activeCharacters.map((character) => character.id),
      userDirective: slot?.focus ? `${state.ui?.userDirective || ""}\n本段时间：${slot.label}，${slot.focus}。`.trim() : state.ui?.userDirective || "",
    },
  };
}

function normalizeDialogueTurnsForRelationship(turns = []) {
  return (Array.isArray(turns) ? turns : [])
    .map((turn) => {
      const line = String(turn?.line || "").trim();
      if (!line) return null;
      return {
        speakerId: String(turn?.speakerId || ""),
        speakerName: String(turn?.speakerName || ""),
        targetId: String(turn?.targetId || ""),
        targetName: String(turn?.targetName || ""),
        line,
        turnRole: String(turn?.turnRole || ""),
        respondsTo: String(turn?.respondsTo || ""),
        triggeredBy: String(turn?.triggeredBy || ""),
      };
    })
    .filter(Boolean);
}

function relationshipDialogueFromShift(shift = {}) {
  const dialogueTurns = normalizeDialogueTurnsForRelationship(shift.dialogueTurns);
  const triggeredBy = String(shift.triggeredBy || shift.conductorSignal?.inWorldClue || "").trim();
  const hasDialogueTrace = [
    shift.sharedObject,
    shift.eventOutcome,
    shift.finalTurn,
    shift.followupTurn,
    shift.dialogueTurnCount,
    dialogueTurns.length,
    ["agent-dialogue-relationship", "model-agent-dialogue", "causal-perceived-relationship-outcome", "character-agent-owned-appraisal"].includes(shift.generatedFrom),
  ].some(Boolean);
  if (!hasDialogueTrace) return null;
  return {
    source: shift.generatedFrom || shift.relationshipSource || "relationship-shift",
    relationshipSource: shift.relationshipSource || "",
    sharedObject: shift.sharedObject || "",
    eventOutcome: shift.eventOutcome || shift.unspoken || "",
    finalTurn: shift.finalTurn || "",
    followupTurn: shift.followupTurn || "",
    dialogueTurnCount: Number(shift.dialogueTurnCount || dialogueTurns.length || 0),
    dialogueTurns,
    triggeredBy,
    conductorSignal: shift.conductorSignal || null,
    relationshipDialogueAct: shift.relationshipDialogueAct || null,
    locationId: shift.locationId || "",
    locationName: shift.locationName || "",
    periodSlot: shift.periodSlot || "",
    updatedAt: new Date().toISOString(),
  };
}

function appendRelationshipDialogueHistory(rel, dialogue) {
  if (!dialogue) return;
  const previous = Array.isArray(rel.dialogueHistory) ? rel.dialogueHistory : [];
  const signature = [
    dialogue.sharedObject,
    dialogue.eventOutcome,
    dialogue.finalTurn,
    dialogue.followupTurn,
    dialogue.triggeredBy,
    dialogue.locationId,
    dialogue.periodSlot,
  ].join("|");
  const withoutDuplicate = previous.filter((item) => [
    item.sharedObject,
    item.eventOutcome,
    item.finalTurn,
    item.followupTurn,
    item.triggeredBy,
    item.locationId,
    item.periodSlot,
  ].join("|") !== signature);
  rel.dialogueHistory = [...withoutDuplicate, dialogue].slice(-12);
}

function createLocalRelationship(state, shift = {}) {
  return {
    id: createId("rel"),
    projectId: state.project?.id,
    fromCharacterId: shift.fromCharacterId,
    toCharacterId: shift.toCharacterId,
    love: 10,
    attraction: 10,
    resentment: 10,
    fear: 10,
    dependence: 10,
    power: 10,
    shame: 10,
    jealousy: 0,
    protection: 10,
    revenge: 0,
    deception: 10,
    wantsToBeSeen: 10,
    wantsToPossess: 0,
    wantsToEscape: 10,
    wantsToDestroy: 0,
    misreading: "",
    unspoken: "",
    evidenceIds: [],
  };
}

function applyModelPeriodBundleToLocalState(state, updateBundle = {}) {
  const next = {
    ...state,
    characters: deepClone(state.characters || []),
    relationships: deepClone(state.relationships || []),
    characterMemories: deepClone(state.characterMemories || []),
    characterPlans: deepClone(state.characterPlans || []),
    rumors: deepClone(state.rumors || []),
    evidence: deepClone(state.evidence || []),
    irreversibleTraces: deepClone(state.irreversibleTraces || []),
    stateChangeReasons: deepClone(state.stateChangeReasons || []),
  };

  if (updateBundle.tavernState) next.tavernState = deepClone(updateBundle.tavernState);

  if (Array.isArray(updateBundle.characters)) {
    const patches = new Map(updateBundle.characters.map((patch) => [patch.id, patch]));
    next.characters = next.characters.map((character) => {
      const patch = patches.get(character.id);
      if (!patch) return character;
      return {
        ...character,
        currentState: { ...(character.currentState || {}), ...(patch.currentState || {}) },
        ...(Object.prototype.hasOwnProperty.call(patch, "lifeState") ? { lifeState: { ...(character.lifeState || {}), ...(deepClone(patch.lifeState) || {}) } } : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, "ecologyState") ? { ecologyState: deepClone(patch.ecologyState) } : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, "agentMemory") ? { agentMemory: deepClone(patch.agentMemory) } : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, "currentActivity") ? { currentActivity: patch.currentActivity } : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, "previousLocationId") ? { previousLocationId: patch.previousLocationId } : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, "currentLocationId") ? { currentLocationId: patch.currentLocationId } : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, "inTransit") ? { inTransit: patch.inTransit } : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, "lastPresenceDecision") ? { lastPresenceDecision: patch.lastPresenceDecision } : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, "lastMovementReason") ? { lastMovementReason: patch.lastMovementReason } : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, "lastPresenceDraftId") ? { lastPresenceDraftId: patch.lastPresenceDraftId } : {}),
      };
    });
  }

  if (Array.isArray(updateBundle.relationships)) {
    for (const shift of updateBundle.relationships) {
      if (!shift?.fromCharacterId || !shift?.toCharacterId) continue;
      let rel = next.relationships.find((item) => item.fromCharacterId === shift.fromCharacterId && item.toCharacterId === shift.toCharacterId);
      if (!rel) {
        rel = createLocalRelationship(next, shift);
        next.relationships.push(rel);
      }
      for (const [key, delta] of Object.entries(shift.deltas || {})) {
        if (typeof rel[key] === "number") rel[key] = clamp(rel[key] + Number(delta), 0, 100);
      }
      if (shift.misreading) rel.misreading = shift.misreading;
      if (shift.unspoken) rel.unspoken = shift.unspoken;
      const lastDialogue = relationshipDialogueFromShift(shift);
      if (lastDialogue) {
        rel.lastDialogue = { ...(rel.lastDialogue || {}), ...lastDialogue };
        appendRelationshipDialogueHistory(rel, rel.lastDialogue);
      }
    }
  }

  if (Array.isArray(updateBundle.characterMemories)) next.characterMemories.unshift(...deepClone(updateBundle.characterMemories));
  if (Array.isArray(updateBundle.characterPlans)) {
    const patches = new Map();
    for (const patch of updateBundle.characterPlans) {
      if (patch?.id) patches.set(patch.id, patch);
      if (patch?.characterId) patches.set(patch.characterId, patch);
    }
    next.characterPlans = ensureCharacterPlans(next).map((plan) => {
      const patch = patches.get(plan.id) || patches.get(plan.characterId);
      return patch ? { ...plan, ...patch, id: plan.id, characterId: plan.characterId } : plan;
    });
  }
  if (Array.isArray(updateBundle.rumors)) next.rumors.unshift(...deepClone(updateBundle.rumors));
  if (Array.isArray(updateBundle.evidence)) next.evidence.unshift(...deepClone(updateBundle.evidence));
  if (Array.isArray(updateBundle.irreversibleTraces)) next.irreversibleTraces.unshift(...deepClone(updateBundle.irreversibleTraces));
  if (Array.isArray(updateBundle.stateChangeReasons)) next.stateChangeReasons.unshift(...deepClone(updateBundle.stateChangeReasons));
  return next;
}

function withPeriodMetadata(items = [], tick = {}) {
  return (items || []).map((item) => ({
    ...item,
    periodSlot: tick.label,
    locationId: item.locationId || tick.locationId,
    locationName: item.locationName || tick.locationName,
  }));
}

function buildModelPeriodAggregateTick(state, ticks, grain) {
  const privateSimulations = ticks.flatMap((tick) => withPeriodMetadata(tick.privateSimulations || tick.simulationTick?.privateSimulations || [], tick));
  const visibleFacts = ticks.map((tick) => `${tick.label} / ${tick.locationName}：${tick.surfaceEvent}`);
  const hiddenFacts = ticks.map((tick) => `${tick.label} / ${tick.locationName}：${tick.simulationTick?.hiddenPressure || "隐藏压力继续累积"}`);
  const averageContradiction = clamp(privateSimulations.reduce((sum, sim) => sum + Number(sim.contradictionScore || sim.realtimeContradictionScore || 0), 0) / Math.max(privateSimulations.length, 1));
  return {
    id: createId("model_period_tick"),
    createdAt: new Date().toISOString(),
    branchId: state.ui?.activeBranchId || state.project?.activeBranchId || "branch_main",
    grain,
    mode: "model_town_period_simulation",
    locationId: "town_scope",
    locationName: "全镇",
    activeCharacterIds: (state.characters || []).map((character) => character.id),
    visiblePressure: visibleFacts.join("；"),
    hiddenPressure: hiddenFacts.join("；"),
    visibilityLayer: {
      visibleFacts,
      hiddenFacts,
      perCharacter: ticks.flatMap((tick) => withPeriodMetadata(tick.visibilityLayer?.perCharacter || tick.simulationTick?.visibilityLayer?.perCharacter || [], tick)),
    },
    privateSimulations,
    contradictionPressureSummary: {
      averageContradiction,
      hiddenFactPressure: clamp(hiddenFacts.length * 14 + averageContradiction * 0.65 + Number(state.ui?.eventImpact || 0) * 0.25),
      highest: privateSimulations.slice().sort((a, b) => Number(b.contradictionScore || 0) - Number(a.contradictionScore || 0))[0] || null,
    },
  };
}

function buildModelPeriodInteraction(ticks = []) {
  return {
    tickId: createId("model_period_interaction"),
    sceneThesis: "模型小镇按时间段连续运行，每段关系变化都会进入下一段人物判断。",
    interactionBeats: ticks.flatMap((tick) => withPeriodMetadata(tick.sceneInteraction?.interactionBeats || [], tick)),
    agentExchanges: ticks.flatMap((tick) => withPeriodMetadata(tick.sceneInteraction?.agentExchanges || [], tick)),
    misunderstandings: ticks.flatMap((tick) => withPeriodMetadata(tick.sceneInteraction?.misunderstandings || [], tick)),
    reversals: ticks.flatMap((tick) => (tick.sceneInteraction?.reversals || []).map((line) => `${tick.label} / ${tick.locationName}：${line}`)),
    visibilityFlips: ticks.flatMap((tick) => withPeriodMetadata(tick.sceneInteraction?.visibilityFlips || [], tick)),
    relationshipMutationIntents: ticks.flatMap((tick) => withPeriodMetadata(tick.sceneInteraction?.relationshipMutationIntents || [], tick)),
    relationshipShift: ticks.flatMap((tick) => withPeriodMetadata(tick.synthesized?.relationshipShift || [], tick)),
    simulationNotes: [
      "真实模型路径的一次播放覆盖完整时间段。",
      "每个时段结束后会把人物状态、关系对白、记忆和计划写入临时状态，再进入下一时段。",
    ],
    periodTicks: ticks.map((tick) => ({
      label: tick.label,
      locationId: tick.locationId,
      locationName: tick.locationName,
      participantIds: tick.participantIds,
      tickId: tick.simulationTick?.id,
    })),
  };
}

function buildModelPeriodSceneText({ grain, ticks, state, focus }) {
  const title = grain === "week" ? "【小镇一周运转】" : "【小镇一日运转】";
  const focusLine = focus?.mode === "location"
    ? `观察焦点：${focus.locationName}。这里被盯紧，别处只留下脚步、物件和传闻。`
    : "观察焦点：无。关系热区会在后续时段自动被带回场中。";
  return [
    title,
    state.ui?.injectedEvent ? `启动事件：${state.ui.injectedEvent}` : "启动事件：没有显式事件，镇内关系自然流动。",
    focusLine,
    "",
    ...ticks.map((tick) => [
      `【${tick.label} · ${tick.locationName}】`,
      tick.surfaceEvent,
      tick.sceneText || tick.sceneInteraction?.sceneText || "",
    ].filter(Boolean).join("\n")),
  ].filter(Boolean).join("\n");
}

export function applyRepairedFields(draft, repaired) {
  return {
    ...draft,
    surfaceEvent: repaired.surfaceEvent || draft.surfaceEvent,
    sceneText: repaired.sceneText || draft.sceneText,
    agentOutputs: Array.isArray(repaired.agentOutputs) && repaired.agentOutputs.length ? repaired.agentOutputs : draft.agentOutputs,
    subtextMatrix: Array.isArray(repaired.subtextMatrix) ? repaired.subtextMatrix : draft.subtextMatrix,
    relationshipShift: mergeRepairedRelationshipShifts(draft.relationshipShift, repaired.relationshipShift),
    irreversibleTraces: Array.isArray(repaired.irreversibleTraces) ? repaired.irreversibleTraces : draft.irreversibleTraces,
    repairNotes: repaired.repairNotes || "RepairPass returned no notes.",
  };
}

async function runModelSceneOnce(state, options = {}) {
  const totalStarted = Date.now();
  const compact = compactState(state);
  const runners = modelRunners(options.runners || {}, { policy: options.runnerPolicy });
  const pipelineMode = ["fast", "balanced", "live"].includes(options.pipelineMode) ? options.pipelineMode : "quality";
  const fastMode = pipelineMode === "fast";
  const balancedMode = pipelineMode === "balanced";
  const liveMode = pipelineMode === "live";
  const optimizedMode = fastMode || balancedMode || liveMode;
  compact.pipelineMode = pipelineMode;
  if (Array.isArray(options.periodContext?.dayLog) && options.periodContext.dayLog.length) {
    compact.periodDayLog = options.periodContext.dayLog.slice(-8);
  }
  const pipelineMeta = {
    mode: fastMode ? "model-orchestrated-fast-simulation" : balancedMode ? "model-orchestrated-balanced-simulation" : liveMode ? "model-orchestrated-live-turn-simulation" : "model-orchestrated-realtime-simulation",
    pipelineMode,
    provider: "openai",
    model: requireCurrentModel(),
    pipeline: optimizedMode
      ? `CharacterPrivateSimulator(s)→${liveMode ? "LiveTurnLoop" : "CognitiveReactionGate→AgentDialogue"}→LocalVisibility→SceneInteractionSimulator→NovelStreamer + ${balancedMode || liveMode ? "SelectivePsychology" : "LocalPsychology"}/LocalAudit→StateArchivist`
      : "CharacterPrivateSimulator(s)→CognitiveReactionGate→AgentDialogue→VisibilityLayer→SceneInteractionSimulator→DepthAuditor→RepairPass→StateArchivist",
    stages: [],
    degradedStages: [],
    repaired: false,
    repairReason: null,
  };

  const context = progressContext(compact, options);
  await emitPipelineProgress(options, {
    type: "scene_started",
    characterIds: compact.activeCharacterIds || [],
    characterNames: (compact.activeCharacters || []).map((character) => character.name),
    ...context,
  });

  const { privateSimulations, stages: privateStages } = await runCriticalModelStage("private_simulators", () => runners.runPrivateSimulators(compact, {
    signal: options.signal,
    onProgress: options.onProgress,
    context,
  }));
  pipelineMeta.stages.push(...privateStages);
  let dialogueProtocol;
  if (liveMode) {
    const liveVisibility = buildLocalVisibilityLayer(compact, privateSimulations);
    const loopResult = await runCriticalModelStage("agent_dialogue_turns", () => runners.runLiveTurnLoop(
      { ...compact, visibleFacts: [...(compact.periodDayLog || []), ...liveVisibility.visibleFacts] },
      privateSimulations,
      {
        signal: options.signal,
        ...(options.liveTurnOptions || {}),
        onTurn: async (turn) => emitPipelineProgress(options, {
          type: "agent_turn",
          ...publicLiveTurn(turn),
          ...context,
        }),
      },
    ));
    pipelineMeta.stages.push(loopResult.stage);
    dialogueProtocol = liveProtocolFromTurns(compact, privateSimulations, loopResult);
    pipelineMeta.stages.push({
      name: "CognitiveReactionGate:LiveTurns",
      provider: "local",
      elapsedMs: 0,
      exchangeCount: dialogueProtocol.agentExchanges.length,
    });
  } else {
    dialogueProtocol = buildModelAgentDialogueProtocol(compact, privateSimulations);
    pipelineMeta.stages.push({
      name: "CognitiveReactionGate:AgentApprovedDialogue",
      provider: "local",
      elapsedMs: 0,
      exchangeCount: dialogueProtocol.agentExchanges.length,
    });
  }
  const causalPrivateSimulations = dialogueProtocol.privateSimulations;

  const { visibilityLayer, stage: visibilityStage } = optimizedMode
    ? {
        visibilityLayer: buildLocalVisibilityLayer(compact, causalPrivateSimulations),
        stage: { name: "VisibilityLayer:LocalFast", provider: "local", elapsedMs: 0 },
      }
    : await runCriticalModelStage("visibility_layer", () => runners.runVisibilityLayer(compact, causalPrivateSimulations, { signal: options.signal }));
  pipelineMeta.stages.push(visibilityStage);

  await emitPipelineProgress(options, {
    type: "shared_space",
    characterIds: compact.activeCharacterIds || [],
    characterNames: (compact.activeCharacters || []).map((character) => character.name),
    ...context,
  });

  const { sceneInteraction: generatedSceneInteraction, stage: interactionStage } = await runCriticalModelStage("scene_interaction", () => runners.runSceneInteractionSimulator(compact, causalPrivateSimulations, visibilityLayer, { signal: options.signal }));
  pipelineMeta.stages.push(interactionStage);
  const sceneInteraction = applyAgentDialogueProtocolToScene(generatedSceneInteraction, dialogueProtocol.agentExchanges);

  const agentOutputs = attachInteractionCausalityToAgentOutputs(
    buildAgentOutputsFromSimulation(state, compact, causalPrivateSimulations, visibilityLayer, sceneInteraction),
    sceneInteraction,
    compact,
  );
  const simulationTick = buildSimulationTick(state, compact, causalPrivateSimulations, visibilityLayer, sceneInteraction);
  let draft = normalizeDraftBase(state, compact, agentOutputs, sceneInteraction, pipelineMeta, simulationTick);

  const localAudit = auditDraft(draft, state);
  await emitPipelineProgress(options, {
    type: "novel_started",
    ...context,
  });
  const psychologyOptions = {
    signal: options.signal,
    onUpdate: async (reaction) => emitPipelineProgress(options, {
      type: "psychology_update",
      ...reaction,
      ...context,
    }),
  };
  const psychologyPromise = fastMode
    ? buildLocalDialoguePsychology(compact, causalPrivateSimulations, sceneInteraction, psychologyOptions)
    : balancedMode || liveMode
      ? runBalancedDialoguePsychology(runners, compact, causalPrivateSimulations, sceneInteraction, psychologyOptions)
      : runners.runDialoguePsychology(compact, causalPrivateSimulations, sceneInteraction, psychologyOptions);
  const novelPromise = runners.streamSceneNovel(compact, sceneInteraction, {
    signal: options.signal,
    onDelta: async (text) => emitPipelineProgress(options, {
      type: "novel_delta",
      text,
      ...context,
    }),
  });
  const auditPromise = optimizedMode
    ? Promise.resolve({
        audit: localAudit,
        stage: { name: "DepthAuditor:LocalFast", provider: "local", elapsedMs: 0 },
      })
    : runners.runDepthAuditor(compact, draft, localAudit, { signal: options.signal });
  const [psychologySettled, novelSettled, auditSettled] = await Promise.allSettled([
    psychologyPromise,
    novelPromise,
    auditPromise,
  ]);
  if (novelSettled.status === "rejected") {
    const error = novelSettled.reason;
    if (error && typeof error === "object") {
      error.kind = error.kind || "model_stage";
      error.stage = error.stage || "novel_streamer";
    }
    throw error;
  }

  const recordDegradedStage = async (stage, error) => {
    const degraded = {
      stage,
      error: error?.message || String(error),
      at: new Date().toISOString(),
    };
    pipelineMeta.degradedStages.push(degraded);
    await emitPipelineProgress(options, {
      type: "stage_warning",
      stage,
      message: degraded.error,
      ...context,
    });
  };

  const psychologyResult = psychologySettled.status === "fulfilled"
    ? psychologySettled.value
    : { reactions: [], stages: [] };
  if (psychologySettled.status === "rejected") {
    await recordDegradedStage("dialogue_psychology", psychologySettled.reason);
  }
  for (const failure of psychologyResult.failures || []) {
    await recordDegradedStage(
      `dialogue_psychology:${failure.characterId || failure.characterName || "unknown"}`,
      new Error(failure.error || "心理代理调用失败。"),
    );
  }

  const auditDegraded = auditSettled.status === "rejected";
  const auditResult = auditDegraded
    ? {
        audit: localAudit,
        stage: {
          name: "DepthAuditor:LocalFallback",
          provider: "local",
          elapsedMs: 0,
        },
      }
    : auditSettled.value;
  if (auditDegraded) await recordDegradedStage("depth_auditor", auditSettled.reason);

  const novelResult = novelSettled.value;
  if (novelResult.degraded) {
    await recordDegradedStage("novel_streamer", new Error(novelResult.failure || "正文流降级。"));
  }
  const { audit, stage: auditStage } = auditResult;
  draft.dialoguePsychology = psychologyResult.reactions || [];
  draft.novelText = novelResult.novelText || "";
  draft.sceneText = draft.novelText || draft.sceneText;
  draft.simulationTick.dialoguePsychology = draft.dialoguePsychology;
  draft.simulationTick.novelText = draft.novelText;
  pipelineMeta.stages.push(...(psychologyResult.stages || []), novelResult.stage);
  draft.audit = audit;
  pipelineMeta.stages.push(auditStage);

  await emitPipelineProgress(options, {
    type: "novel_complete",
    ...context,
  });

  if (!optimizedMode && !auditDegraded && shouldRepair(draft.audit)) {
    pipelineMeta.repairAttempted = true;
    pipelineMeta.repairReason = (draft.audit.requiredFixes || []).join("；") || "审查分数触发修复。";
    try {
      const { repaired, stage } = await runners.runRepairPass(compact, draft, draft.audit, { signal: options.signal });
      pipelineMeta.repaired = true;
      pipelineMeta.stages.push(stage);
      draft = applyRepairedFields(draft, repaired);
      draft.sceneText = draft.novelText || draft.sceneText;
      draft.agentOutputs = attachInteractionCausalityToAgentOutputs(draft.agentOutputs, draft.sceneInteraction, compact);
      draft.audit = auditDraft(draft, state);
      pipelineMeta.stages.push({
        name: "DepthAuditor:AfterRepair",
        provider: "local",
        elapsedMs: 0,
        shouldRegenerate: draft.audit.shouldRegenerate,
        scores: {
          safeClosureRisk: draft.audit.safeClosureRisk,
          multiMotivationScore: draft.audit.multiMotivationScore,
          irreversibleConsequenceScore: draft.audit.irreversibleConsequenceScore,
          memoryUseRisk: draft.audit.memoryUseRisk,
          ignoredMemoryRisk: draft.audit.ignoredMemoryRisk,
          planUseScore: draft.audit.planUseScore,
          planRisk: draft.audit.planRisk,
          realtimeSimulationScore: draft.audit.realtimeSimulationScore,
          realtimeSimulationRisk: draft.audit.realtimeSimulationRisk,
        },
      });
    } catch (error) {
      pipelineMeta.repaired = false;
      await recordDegradedStage("repair_pass", error);
    }
  }

  await emitPipelineProgress(options, {
    type: "scene_complete",
    surfaceEvent: draft.surfaceEvent || "",
    sceneText: draft.novelText || draft.sceneText || "",
    ...context,
  });

  pipelineMeta.elapsedMs = Date.now() - totalStarted;
  draft.pipelineMeta = pipelineMeta;
  draft.engineMeta = pipelineMeta;
  draft.updateBundle = buildUpdateBundle(draft, state);
  return draft;
}

function causalLine(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function causalSentence(value = "") {
  const line = causalLine(value);
  if (!line) return "";
  return /[。！？…]$/.test(line) ? line : `${line}。`;
}

function causalActionParagraph(action = {}) {
  const rawVisible = causalLine(action.visibleAction);
  const visible = causalSentence(rawVisible && action.actorName && !rawVisible.includes(action.actorName)
    ? `${action.actorName}${rawVisible}`
    : rawVisible);
  const affectiveTexture = (Array.isArray(action.observableAffectiveTexture) ? action.observableAffectiveTexture : [])
    .map((row) => causalLine(row?.feature))
    .filter(Boolean)
    .map(causalSentence)
    .join(" ");
  const target = action.targetCharacterName ? `对${action.targetCharacterName}` : "";
  const speech = action.speech ? `${action.actorName}${target}说：“${causalLine(action.speech)}”` : "";
  return [visible, affectiveTexture, speech].filter(Boolean).join(" ");
}

function causalPublicEventParagraph(event = {}) {
  return causalSentence(event.surfaceEvent || event.content || "");
}

function publicCausalAction(action = {}) {
  const copy = deepClone(action);
  delete copy.privateReason;
  delete copy.goalPreservation;
  delete copy.observerPsychology;
  delete copy.communicationPlan;
  delete copy.communicationPlanAuthority;
  delete copy.speechRealizationPlan;
  delete copy.speechRealizationPlanAuthority;
  delete copy.embodiedIntent;
  delete copy.embodiedIntentAuthority;
  delete copy.actionAttemptAuthority;
  delete copy.utteranceAuthority;
  delete copy.postChoiceContinuity;
  delete copy.postChoiceContinuityAuthority;
  delete copy.continuitySettlement;
  delete copy.privateProposalDiagnostics;
  if (copy.sharedActivityResolution) {
    copy.sharedActivityTransition = {
      status: copy.sharedActivityResolution.status || "",
      code: copy.sharedActivityResolution.code || "",
      operation: copy.sharedActivity?.operation || "none",
      activityId: copy.sharedActivityResolution.activity?.activityId || copy.sharedActivity?.activityId || "",
      activityStatus: copy.sharedActivityResolution.activity?.status || "",
      accessGrantId: copy.sharedActivityResolution.accessGrant?.grantId || "",
    };
  }
  delete copy.sharedActivity;
  delete copy.sharedActivityResolution;
  copy.impactFactors = (copy.impactFactors || []).map((impact) => ({
    id: impact.id,
    type: impact.type,
    modality: impact.modality,
    directedTargetId: impact.directedTargetId || "",
  }));
  delete copy.deliveries;
  return copy;
}

function publicCausalDelivery(delivery = {}) {
  return {
    id: delivery.id || "",
    evidenceId: delivery.evidenceId || delivery.id || delivery.impactId || "",
    impactId: delivery.impactId || "",
    objectiveEventId: delivery.objectiveEventId || "",
    recipientId: delivery.recipientId || "",
    sourceCharacterId: delivery.sourceCharacterId || delivery.perceivedSourceCharacterId || "",
    sourceEntityHandle: delivery.sourceEntityHandle || "",
    identityKnown: delivery.identityKnown !== false,
    type: delivery.type || "",
    modality: delivery.modality || "",
    content: delivery.content || "",
    topic: delivery.topic || "",
    directed: Boolean(delivery.directed),
    receivedIntensity: Number(delivery.receivedIntensity || 0),
    personalRelevance: Number(delivery.personalRelevance || 0),
    impactScore: Number(delivery.impactScore || 0),
    sourceZoneId: delivery.sourceZoneId || "",
    recipientZoneId: delivery.recipientZoneId || "",
    distance: Number(delivery.distance || 0),
    route: [...(delivery.route || [])],
    barriers: [...(delivery.barriers || [])],
    deliveredAtSeconds: Number(delivery.deliveredAtSeconds || 0),
    processedAtStep: delivery.processedAtStep ?? null,
    provenance: {
      kind: delivery.provenance?.kind || "",
      sourceActionId: delivery.provenance?.sourceActionId || "",
      sourceImpactIds: [...(delivery.provenance?.sourceImpactIds || [])],
      sourceThreadId: delivery.provenance?.sourceThreadId || "",
      responseToTurnId: delivery.provenance?.responseToTurnId || "",
      responseSourceLine: delivery.provenance?.responseSourceLine || "",
      responseSourceSlotId: delivery.provenance?.responseSourceSlotId || "",
      responseSourceSlotLabel: delivery.provenance?.responseSourceSlotLabel || "",
      speakerCharacterId: delivery.provenance?.speakerCharacterId || "",
    },
  };
}

function publicObserverPsychology(entry = {}) {
  if (!entry || typeof entry !== "object" || !entry.actionId || !entry.characterId || (!entry.privateReason && !entry.formulaReason && !entry.selectedIntent)) return null;
  const clean = (value, limit = 220) => String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
  const rawTrace = entry.factorTrace && typeof entry.factorTrace === "object" ? entry.factorTrace : null;
  const selectedCandidateId = clean(rawTrace?.selection?.selectedCandidateId || entry.selectedIntent?.selectedCandidateId, 120);
  const rankedCandidates = [...(rawTrace?.candidates || [])].sort((a, b) => Number(b.activationScore || 0) - Number(a.activationScore || 0));
  const selectedCandidate = rankedCandidates.find((candidate) => clean(candidate.candidateId, 120) === selectedCandidateId) || null;
  const compactCandidates = [
    ...(selectedCandidate ? [selectedCandidate] : []),
    ...rankedCandidates.filter((candidate) => candidate !== selectedCandidate),
  ].slice(0, 4);
  const traceCandidates = compactCandidates.map((candidate) => {
    const detailed = clean(candidate.candidateId, 120) === selectedCandidateId;
    return ({
    candidateId: clean(candidate.candidateId, 120),
    label: clean(candidate.label, 180),
    feasible: Boolean(candidate.feasible),
    activationScore: Number(candidate.activationScore || 0),
    blockedBy: (candidate.blockedBy || []).map((item) => clean(item, 80)).slice(0, 6),
    desireScore: Number(candidate.desirePressure?.score || 0),
    resistanceScore: Number(candidate.obstacleResistance?.score || 0),
    bodyRewardScore: Number(candidate.bodyAppraisal?.rewardScore || 0),
    bodyCostScore: Number(candidate.bodyAppraisal?.costScore || 0),
    positiveFactors: detailed ? (candidate.positiveFactors || []).map((factor) => ({
      label: clean(factor.label, 100),
      contribution: Number(factor.contribution || 0),
    })).filter((factor) => factor.contribution > 0).sort((a, b) => b.contribution - a.contribution).slice(0, 4) : [],
    negativeFactors: detailed ? (candidate.negativeFactors || []).map((factor) => ({
      label: clean(factor.label, 100),
      contribution: Number(factor.contribution || 0),
    })).filter((factor) => factor.contribution > 0).sort((a, b) => b.contribution - a.contribution).slice(0, 4) : [],
    });
  });
  return {
    schemaVersion: 1,
    visibility: "observer-only",
    source: "causal-character-agent-decision",
    actionId: clean(entry.actionId, 120),
    characterId: clean(entry.characterId, 120),
    characterName: clean(entry.characterName, 80),
    desire: clean(entry.desire, 180),
    currentIntention: clean(entry.currentIntention, 180),
    privateReason: clean(entry.privateReason, 220),
    formulaReason: clean(entry.formulaReason, 420),
    selectedIntent: entry.selectedIntent ? {
      selectedCandidateId: clean(entry.selectedIntent.selectedCandidateId, 120),
      label: clean(entry.selectedIntent.label, 180),
      actionKind: clean(entry.selectedIntent.actionKind, 80),
      targetCharacterId: clean(entry.selectedIntent.targetCharacterId, 120),
      activationScore: Number(entry.selectedIntent.activationScore || 0),
    } : null,
    relationshipAppraisal: entry.relationshipAppraisal ? {
      relationshipId: clean(entry.relationshipAppraisal.relationshipId, 120),
      fromCharacterId: clean(entry.relationshipAppraisal.fromCharacterId, 120),
      toCharacterId: clean(entry.relationshipAppraisal.toCharacterId, 120),
      closeness: Number(entry.relationshipAppraisal.closeness || 0),
      tension: Number(entry.relationshipAppraisal.tension || 0),
      trust: Number(entry.relationshipAppraisal.trust || 0),
    } : null,
    copingBias: entry.copingBias ? {
      approach: Number(entry.copingBias.approach || 0),
      avoid: Number(entry.copingBias.avoid || 0),
      assert: Number(entry.copingBias.assert || 0),
      inhibit: Number(entry.copingBias.inhibit || 0),
      repair: Number(entry.copingBias.repair || 0),
      repairNeed: Number(entry.copingBias.repairNeed || 0),
      dominant: clean(entry.copingBias.dominant, 40),
    } : null,
    expressionStrategy: entry.expressionStrategy ? {
      mode: clean(entry.expressionStrategy.mode, 80),
      directness: clean(entry.expressionStrategy.directness, 40),
      warmth: clean(entry.expressionStrategy.warmth, 40),
      motive: clean(entry.expressionStrategy.motive, 40),
    } : null,
    eventAppraisal: entry.eventAppraisal?.applied ? {
      applied: true,
      impactId: clean(entry.eventAppraisal.impactId, 120),
      cueIds: (entry.eventAppraisal.cueIds || []).map((item) => clean(item, 80)).slice(0, 8),
      affect: entry.eventAppraisal.affect ? {
        before: deepClone(entry.eventAppraisal.affect.before || {}),
        after: deepClone(entry.eventAppraisal.affect.after || {}),
      } : null,
      copingBias: entry.eventAppraisal.copingBias ? {
        dominant: clean(entry.eventAppraisal.copingBias.dominant, 40),
      } : null,
      sensitivities: (entry.eventAppraisal.sensitivities || []).filter((item) => (item.matchedCueIds || []).length).slice(0, 4).map((item) => ({
        sensitivityId: clean(item.sensitivityId, 120),
        threatMeaning: clean(item.threatMeaning, 180),
        matchedCueIds: (item.matchedCueIds || []).map((cue) => clean(cue, 80)).slice(0, 6),
        after: Number(item.after || 0),
      })),
    } : null,
    factorTrace: rawTrace ? {
      visibility: "observer-only",
      formulaVersion: clean(rawTrace.formulaVersion, 40),
      selectedCandidateId,
      candidates: traceCandidates,
    } : null,
    trigger: entry.trigger ? {
      impactId: clean(entry.trigger.impactId, 120),
      sourceCharacterId: clean(entry.trigger.sourceCharacterId, 120),
      type: clean(entry.trigger.type, 40),
      modality: clean(entry.trigger.modality, 40),
      content: clean(entry.trigger.content, 220),
      topic: clean(entry.trigger.topic, 120),
      directed: Boolean(entry.trigger.directed),
    } : null,
    memoryBasis: entry.memoryBasis ? {
      influence: entry.memoryBasis.influence ? {
        total: Number(entry.memoryBasis.influence.total || 0),
        episodePressure: Number(entry.memoryBasis.influence.episodePressure || 0),
        commitmentPressure: Number(entry.memoryBasis.influence.commitmentPressure || 0),
        beliefPressure: Number(entry.memoryBasis.influence.beliefPressure || 0),
        scoreDelta: Number(entry.memoryBasis.influence.scoreDelta || 0),
        preMemoryActivationScore: Number(entry.memoryBasis.influence.preMemoryActivationScore || 0),
        postMemoryActivationScore: Number(entry.memoryBasis.influence.postMemoryActivationScore || 0),
        explanation: clean(entry.memoryBasis.influence.explanation, 220),
        basisEpisodeIds: (entry.memoryBasis.influence.basisEpisodeIds || []).map((id) => clean(id, 180)).slice(0, 4),
        basisBeliefIds: (entry.memoryBasis.influence.basisBeliefIds || []).map((id) => clean(id, 180)).slice(0, 3),
        basisCommitmentIds: (entry.memoryBasis.influence.basisCommitmentIds || []).map((id) => clean(id, 180)).slice(0, 3),
      } : null,
      episodes: (entry.memoryBasis.episodes || []).slice(0, 4).map((episode) => ({
        id: clean(episode.id, 180),
        content: clean(episode.content, 180),
        topic: clean(episode.topic, 100),
        sourceKind: clean(episode.sourceKind, 40),
        sourceConfidence: Number(episode.sourceConfidence || 0),
        accessibility: Number(episode.accessibility || 0),
      })),
      beliefs: (entry.memoryBasis.beliefs || []).slice(0, 3).map((belief) => ({
        id: clean(belief.id, 180),
        currentValue: clean(belief.currentValue, 100),
        confidence: Number(belief.confidence || 0),
        status: clean(belief.status, 40),
      })),
      commitments: (entry.memoryBasis.commitments || []).slice(0, 3).map((commitment) => ({
        id: clean(commitment.id, 180),
        ownerRole: clean(commitment.ownerRole, 60),
        counterpartyCharacterId: clean(commitment.counterpartyCharacterId, 120),
        beneficiaryCharacterId: clean(commitment.beneficiaryCharacterId, 120),
        requestedAct: clean(commitment.requestedAct, 180),
        status: clean(commitment.status, 40),
      })),
    } : null,
    slotId: clean(entry.slotId, 80),
    slotLabel: clean(entry.slotLabel, 80),
    decidedAtSeconds: Math.max(0, Number(entry.decidedAtSeconds || 0)),
  };
}

function observerPsychologyEntries(result = {}, slotContext = {}) {
  const actions = new Map((result.actions || []).map((action) => [`${action.step}:${action.actorId}`, action]));
  return (result.decisions || []).map((entry) => {
    const action = actions.get(`${entry.step}:${entry.characterId}`);
    const source = entry.observerPsychology || (action && entry.decision?.privateReason ? {
      actionId: action.id,
      characterId: action.actorId,
      characterName: action.actorName,
      desire: "",
      currentIntention: action.commitmentTopic || "",
      privateReason: entry.decision.privateReason,
      trigger: null,
      decidedAtSeconds: action.startedAtSeconds,
    } : null);
    return publicObserverPsychology(source ? {
      ...source,
      slotId: source.slotId || slotContext.slotId || "causal-scene",
      slotLabel: source.slotLabel || slotContext.slotLabel || "同一场",
    } : null);
  }).filter(Boolean);
}

function persistentCausalRuntime(runtime = {}) {
  return {
    id: runtime.id || "",
    schemaVersion: Number(runtime.schemaVersion || 1),
    locationId: runtime.locationId || "loc_xyy_tavern",
    macroDay: Number(runtime.macroDay || 0),
    macroTick: Number(runtime.macroTick || 0),
    slotContext: deepClone(runtime.slotContext || {}),
    elapsedSeconds: Number(runtime.elapsedSeconds || 0),
    step: Number(runtime.step || 0),
    activeCharacterIds: [...(runtime.activeCharacterIds || [])],
    agents: Object.fromEntries(Object.entries(runtime.agents || {}).map(([id, agent]) => [id, {
      characterId: agent.characterId || id,
      characterName: agent.characterName || id,
      role: agent.role || "",
      standing: agent.standing || "",
      zoneId: agent.zoneId || "hall",
      zoneProvenance: deepClone(agent.zoneProvenance || null),
      present: Boolean(agent.present),
      currentIntention: agent.currentIntention || "",
      attentionTargetId: agent.attentionTargetId || "",
      currentVisibleActivity: agent.currentVisibleActivity || "",
      perceptionMemory: (agent.perceptionMemory || []).slice(-10).map((delivery) => ({
        impactId: delivery.impactId || "",
        sourceCharacterId: delivery.sourceCharacterId || "",
        type: delivery.type || "",
        modality: delivery.modality || "",
        content: delivery.content || "",
        topic: delivery.topic || "",
        directed: Boolean(delivery.directed),
        provenance: deepClone(delivery.provenance || {}),
      })),
    }])),
    commitments: (runtime.commitments || []).slice(-16),
    requestLocks: (runtime.requestLocks || []).slice(-16).map((lock) => ({
      id: lock.id || "",
      threadId: lock.threadId || "",
      requesterId: lock.requesterId || "",
      responderId: lock.responderId || "",
      topic: lock.topic || "",
      status: lock.status || "awaiting",
      openedAtStep: Number(lock.openedAtStep || 0),
      latestActionId: lock.latestActionId || lock.sourceActionId || "",
      attempts: Number(lock.attempts || 0),
      maxAttempts: Number(lock.maxAttempts || 2),
      resolvedByActionId: lock.resolvedByActionId || "",
      resolution: lock.resolution || "",
    })),
    sharedActivities: deepClone((runtime.sharedActivities || []).slice(-12)),
    accessGrants: deepClone((runtime.accessGrants || []).filter((grant) => grant.status === "active").slice(-12)),
    failedAttemptCooldowns: deepClone((runtime.failedAttemptCooldowns || []).slice(-12)),
    lastActorId: runtime.lastActorId || "",
  };
}

function directCausalReply(action = {}, parentAction = null) {
  return Boolean(
    parentAction?.speech
    && parentAction.targetCharacterId === action.actorId
    && action.targetCharacterId === parentAction.actorId
  );
}

function causalDialogueTurns(result = {}, slotContext = {}) {
  const actions = new Map((result.actions || []).map((action) => [action.id, action]));
  const impacts = new Map((result.impacts || []).map((impact) => [impact.id, impact]));
  return (result.actions || []).filter((action) => action.speech).map((action) => {
    const parentImpact = impacts.get(action.causalParentImpactId);
    const parentAction = actions.get(parentImpact?.causedByActionId);
    const respondsDirectly = directCausalReply(action, parentAction);
    const sourceThreadId = action.sourceThreadId || parentImpact?.provenance?.sourceThreadId || "";
    const responseToTurnId = action.responseToTurnId || parentImpact?.provenance?.responseToTurnId || "";
    const responseSourceLine = respondsDirectly
      ? parentAction.speech
      : action.responseSourceLine || parentImpact?.provenance?.responseSourceLine || "";
    return {
      turnId: action.id,
      day: Number(slotContext.day ?? 0),
      slotId: slotContext.slotId || "causal-scene",
      slotLabel: slotContext.slotLabel || "同一场",
      speakerId: action.actorId,
      speakerName: action.actorName,
      targetId: action.targetCharacterId || "",
      targetName: action.targetCharacterName || "",
      line: action.speech,
      turnRole: action.speechAct || "turn",
      interactionKind: action.speechAct || "speak",
      respondsTo: respondsDirectly ? parentAction.id : responseToTurnId,
      responseToTurnId: respondsDirectly ? parentAction.id : responseToTurnId,
      responseSourceLine,
      responseSourceSpeakerId: respondsDirectly ? parentAction.actorId : "",
      responseSourceSlotId: respondsDirectly
        ? slotContext.slotId || "causal-scene"
        : action.responseSourceSlotId || parentImpact?.provenance?.responseSourceSlotId || "",
      responseSourceSlotLabel: respondsDirectly
        ? slotContext.slotLabel || "同一场"
        : action.responseSourceSlotLabel || parentImpact?.provenance?.responseSourceSlotLabel || "先前",
      responseThreadId: sourceThreadId || (respondsDirectly ? action.publicTopic || action.commitmentTopic || "" : ""),
      sourceThreadId,
      continuationKind: sourceThreadId ? "active-thread-continuation" : "",
      responseTopic: respondsDirectly || sourceThreadId
        ? action.publicTopic || parentAction?.publicTopic || parentImpact?.topic || ""
        : "",
      sourceImpactId: action.causalParentImpactId || "",
      generatedBy: "causal-character-agent",
    };
  });
}

function causalCharacterMemories(state = {}, result = {}, draftId = "") {
  const impacts = new Map((result.impacts || []).map((impact) => [impact.id, impact]));
  const seen = new Set();
  return (result.deliveries || []).filter((delivery) => {
    const key = `${delivery.recipientId}:${delivery.impactId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return delivery.receivedIntensity >= 18;
  }).map((delivery) => {
    const impact = impacts.get(delivery.impactId) || {};
    const sourceName = state.characters?.find((character) => character.id === delivery.sourceCharacterId)?.name || "场中动静";
    return {
      id: createId("mem"),
      projectId: state.project?.id,
      branchId: state.ui?.activeBranchId || state.project?.activeBranchId || "branch_main",
      characterId: delivery.recipientId,
      type: impact.type === "information" ? "heard_information" : "scene_perception",
      content: `在望梯酒馆，${sourceName}造成的动静抵达了自己：${delivery.content}`,
      publicVersion: delivery.content,
      privateVersion: delivery.content,
      sourceDraftId: draftId,
      sourceImpactId: delivery.impactId,
      provenance: deepClone(delivery.provenance || {}),
      reliability: delivery.provenance?.kind === "gossip" ? 55 : 86,
      createdAt: new Date().toISOString(),
    };
  }).slice(-48);
}

function defaultPersistentParticipantThreadState(thread = {}, characterId = "") {
  const lastTurn = [...(thread.turns || [])].reverse().find((turn) => turn.speakerId) || null;
  const isNext = thread.nextObligationCharacterId === characterId;
  const isLastSpeaker = lastTurn?.speakerId === characterId;
  return {
    schemaVersion: 1,
    threadId: thread.id || "",
    characterId,
    processingStatus: isNext ? "remembered_unappraised" : "appraised",
    perceivedDisposition: "unclear",
    satisfaction: isLastSpeaker && thread.status === "open" ? "unsatisfied" : "uncertain",
    responseNeed: isNext ? "medium" : "none",
    selfClosure: thread.status === "resolved" ? "closed_for_self" : "open",
    lastReceivedTurnId: isNext ? lastTurn?.turnId || lastTurn?.id || "" : "",
    lastAppraisedTurnId: "",
    lastSpokenTurnId: isLastSpeaker ? lastTurn?.turnId || lastTurn?.id || "" : "",
    outgoingDisposition: "none",
    pressure: isNext ? 0.55 : 0.2,
    summary: "",
    authority: "legacy-shared-thread-migration",
  };
}

function ensurePersistentParticipantThreadState(thread = {}, characterId = "") {
  if (!thread.id || !characterId) return null;
  thread.participantStates ||= {};
  thread.participantStates[characterId] ||= defaultPersistentParticipantThreadState(thread, characterId);
  return thread.participantStates[characterId];
}

function mergePrivateParticipantStates(thread = {}, privateRuntime = {}) {
  const ownedStates = privateRuntime.participantThreadStates?.[thread.id] || {};
  for (const characterId of new Set([...(thread.participantIds || []), ...Object.keys(ownedStates)])) {
    if (!characterId) continue;
    const base = ensurePersistentParticipantThreadState(thread, characterId);
    if (ownedStates[characterId]) {
      thread.participantStates[characterId] = {
        ...base,
        ...deepClone(ownedStates[characterId]),
        threadId: thread.id,
        characterId,
      };
    }
  }
}

function deriveSharedThreadCompatibility(thread = {}, latestSceneSeconds = 0) {
  const participantStates = (thread.participantIds || [])
    .map((characterId) => ensurePersistentParticipantThreadState(thread, characterId))
    .filter(Boolean);
  const everyParticipantClosed = participantStates.length > 0
    && participantStates.every((participant) => participant.selfClosure === "closed_for_self");
  thread.status = everyParticipantClosed ? "resolved" : "open";
  if (everyParticipantClosed) {
    thread.nextObligationCharacterId = "";
    thread.resolvedAtSceneSeconds = Number(latestSceneSeconds || thread.resolvedAtSceneSeconds || 0);
    return;
  }
  delete thread.resolvedAtSceneSeconds;
  const needsAppraisal = participantStates.find((participant) => (
    ["received_unappraised", "remembered_unappraised"].includes(participant.processingStatus)
    && participant.selfClosure !== "closed_for_self"
  ));
  const wantsResponse = participantStates.find((participant) => (
    ["medium", "high"].includes(participant.responseNeed)
    && participant.selfClosure !== "closed_for_self"
  ));
  thread.nextObligationCharacterId = needsAppraisal?.characterId || wantsResponse?.characterId || "";
}

function updateCausalEventThreads(state = {}, result = {}, slotContext = {}) {
  const threads = deepClone(state.tavernState?.eventThreads || []);
  const impacts = new Map((result.impacts || []).map((impact) => [impact.id, impact]));
  const actions = new Map((result.actions || []).map((action) => [action.id, action]));
  const privateRuntime = result.privateSceneRuntime || {};
  let latestSceneSeconds = Number(privateRuntime.elapsedSeconds || result.sceneRuntime?.elapsedSeconds || 0);
  for (const action of result.actions || []) {
    if (!action.speech || !action.targetCharacterId) continue;
    latestSceneSeconds = Math.max(latestSceneSeconds, Number(action.endedAtSeconds || 0));
    const seeksResponse = ["ask", "offer", "negotiate", "warn"].includes(action.speechAct)
      || action.commitmentAction === "open"
      || action.threadDisposition === "open_new";
    const parentImpact = impacts.get(action.causalParentImpactId);
    const parentAction = actions.get(parentImpact?.causedByActionId);
    const respondsDirectly = directCausalReply(action, parentAction);
    const sourceThreadId = action.sourceThreadId || parentImpact?.provenance?.sourceThreadId || "";
    let thread = sourceThreadId
      ? [...threads].reverse().find((candidate) => (
        candidate.id === sourceThreadId
        && (candidate.participantIds || []).includes(action.actorId)
        && (candidate.participantIds || []).includes(action.targetCharacterId)
      ))
      : null;
    if (!thread) thread = [...threads].reverse().find((candidate) => (
      candidate.status === "open"
      && (action.publicTopic || action.commitmentTopic)
      && candidate.topic === (action.publicTopic || action.commitmentTopic)
      && (candidate.participantIds || []).includes(action.actorId)
      && (respondsDirectly || action.commitmentAction === "open")
    ));
    if (!thread && seeksResponse) {
      thread = {
        id: sourceThreadId || createId("tavern_thread"),
        topic: action.publicTopic || clean(action.speech, 120) || "等待当面回应的请求",
        stake: action.publicTopic || clean(action.speech, 180) || "等待当面回应的请求",
        participantIds: [action.actorId, action.targetCharacterId],
        participantStates: {},
        status: "open",
        openedDay: Number(slotContext.day ?? state.tavernState?.day ?? 0),
        openedSlot: slotContext.slotId || "causal-scene",
        turns: [],
      };
      threads.push(thread);
    }
    if (!thread) continue;
    thread.participantIds = [...new Set([...(thread.participantIds || []), action.actorId, action.targetCharacterId])];
    if (!(thread.turns || []).some((turn) => turn.turnId === action.id || turn.line === action.speech)) {
      thread.turns = [...(thread.turns || []), {
        turnId: action.id,
        speakerId: action.actorId,
        addresseeId: action.targetCharacterId,
        line: action.speech,
        action: action.commitmentAction || action.speechAct,
        elapsedSeconds: action.endedAtSeconds,
      }].slice(-12);
    }
    const speaker = ensurePersistentParticipantThreadState(thread, action.actorId);
    const recipient = ensurePersistentParticipantThreadState(thread, action.targetCharacterId);
    if (speaker) {
      speaker.lastSpokenTurnId = action.id;
      speaker.outgoingDisposition = action.threadDisposition || "none";
      if (["settle", "refuse"].includes(action.threadDisposition)) {
        speaker.selfClosure = "closed_for_self";
        speaker.responseNeed = "none";
      }
      if (seeksResponse) {
        speaker.satisfaction = "unsatisfied";
        speaker.responseNeed = "medium";
        speaker.selfClosure = "open";
      }
    }
    const noticedByRecipient = (action.deliveries || result.deliveries || []).some((delivery) => (
      delivery.recipientId === action.targetCharacterId
      && Boolean(delivery.noticedProjection || delivery.noticedEvidenceId)
      && (!delivery.impactId || (action.impactFactors || []).some((impact) => impact.id === delivery.impactId))
    ));
    if (recipient && noticedByRecipient) {
      recipient.processingStatus = "received_unappraised";
      recipient.lastReceivedTurnId = action.id;
      recipient.perceivedDisposition = "unclear";
      recipient.selfClosure = "open";
      recipient.authority = "awaiting-character-agent-appraisal";
    }
  }
  for (const thread of threads) {
    mergePrivateParticipantStates(thread, privateRuntime);
    deriveSharedThreadCompatibility(thread, latestSceneSeconds);
  }
  return threads.slice(-12);
}

function buildTavernCausalDraft(state = {}, result = {}, totalStarted = Date.now(), pipelineMode = "live", slotContext = {}) {
  const id = createId("draft");
  const actions = (result.actions || []).map(publicCausalAction);
  const publicEvents = (result.publicEvents || []).map((event) => deepClone(event));
  const dialogueTurns = causalDialogueTurns(result, slotContext);
  const observerPsychology = observerPsychologyEntries(result, slotContext);
  const novelText = [
    ...publicEvents.map(causalPublicEventParagraph),
    ...actions.map(causalActionParagraph),
  ].filter(Boolean).join("\n\n")
    || "望梯酒馆里，各人仍做着手边的事，没有谁受到足够大的影响而开口。";
  const participantIds = [...new Set(result.sceneRuntime?.activeCharacterIds || actions.map((action) => action.actorId))];
  const characterNames = Object.fromEntries((state.characters || []).map((character) => [character.id, character.name]));
  const relationshipShift = Array.isArray(result.relationshipShifts)
    ? result.relationshipShifts.map((shift) => ({ ...deepClone(shift), sourceDraftId: id }))
    : [];
  const eventThreads = updateCausalEventThreads(state, result, slotContext);
  const sceneRuntime = persistentCausalRuntime(result.sceneRuntime || {});
  const pipelineMeta = {
    mode: "model-tavern-causal-scene",
    pipelineMode,
    provider: "openai",
    model: requireCurrentModel(),
    pipeline: "CausalAgentScene:Action→Impact→SpatialPropagation→PrivateAppraisal→NextAgent→Commit",
    stages: [...(result.stages || []), result.stage].filter(Boolean),
    degradedStages: [],
    repaired: false,
    elapsedMs: Date.now() - totalStarted,
  };
  const draft = {
    id,
    projectId: state.project?.id,
    branchId: state.ui?.activeBranchId || state.project?.activeBranchId || "branch_main",
    createdAt: new Date().toISOString(),
    provider: "openai-causal-character-agents",
    model: requireCurrentModel(),
    timeGrain: state.ui?.timeGrain || "scene",
    day: Number(slotContext.day ?? state.tavernState?.day ?? 0),
    slotId: slotContext.slotId || "causal-scene",
    label: slotContext.slotLabel || "同一场",
    locationId: result.sceneRuntime?.locationId || "loc_xyy_tavern",
    participantIds,
    surfaceEvent: actions.length
      ? `${actions.length}次人物行动在酒馆内连续发生`
      : publicEvents[0]?.surfaceEvent || publicEvents[0]?.content || "酒馆暂时没有形成新的互动",
    sceneText: novelText,
    novelText,
    observerPsychology,
    publicEvents,
    canonicalDialogueTurns: dialogueTurns,
    agentOutputs: actions.map((action) => ({
      outputId: action.id,
      characterId: action.actorId,
      targetCharacterId: action.targetCharacterId,
      visibleAction: action.visibleAction || action.speech,
      currentActivity: { type: action.actionType, description: action.visibleAction || action.speech, zoneId: action.moveToZoneId || action.actorZoneId },
      tone: ["refuse", "warn"].includes(action.speechAct) ? "惩罚" : "试探",
    })),
    sceneInteraction: {
      interactionBeats: actions.map((action) => ({
        id: action.id,
        actorId: action.actorId,
        actorName: action.actorName,
        targetId: action.targetCharacterId,
        targetName: action.targetCharacterName,
        visibleAction: action.visibleAction,
        causalParentImpactId: action.causalParentImpactId,
      })),
      agentExchanges: dialogueTurns.length ? [{
        id: createId("causal_exchange"),
        generatedFrom: "causal-character-agent",
        dialogueTurns,
        eventOutcome: `这一场在${result.sceneRuntime?.elapsedSeconds || 0}秒后${result.stopReason === "quiescent" ? "自然静止" : "停止"}。`,
      }] : [],
      relationshipShift,
      concreteOutcome: `场景运行${result.sceneRuntime?.elapsedSeconds || 0}秒，产生${actions.length}次行动和${result.impacts?.length || 0}个可传播影响。`,
      presentAtEndIds: Object.values(result.sceneRuntime?.agents || {}).filter((agent) => agent.present).map((agent) => agent.characterId),
    },
    relationshipShift,
    irreversibleTraces: [],
    causalScene: {
      schemaVersion: 1,
      elapsedSeconds: Number(result.sceneRuntime?.elapsedSeconds || 0),
      stopReason: result.stopReason,
      macroTimeAdvanced: false,
      slotId: slotContext.slotId || "causal-scene",
      slotLabel: slotContext.slotLabel || "同一场",
      day: Number(slotContext.day ?? state.tavernState?.day ?? 0),
      unresolvedRequests: deepClone(result.unresolvedRequests || []),
      actions,
      impacts: deepClone(result.impacts || []),
      deliveries: (result.deliveries || []).map(publicCausalDelivery),
      activations: (result.decisions || []).map((entry) => ({
        step: entry.step,
        characterId: entry.characterId,
        characterName: characterNames[entry.characterId] || entry.characterId,
        sourceImpactId: entry.sourceImpactId || "",
        activationScore: entry.activationScore,
        actionType: entry.decision?.actionType || "pass",
        speechAct: entry.decision?.speechAct || "none",
      })),
      sceneRuntime,
    },
    agentParticipation: [{
      day: Number(slotContext.day ?? state.tavernState?.day ?? 0),
      slotId: slotContext.slotId || "causal-scene",
      slotLabel: slotContext.slotLabel || "同一场",
      presentCharacterIds: participantIds,
      presentCharacterNames: participantIds.map((characterId) => characterNames[characterId] || characterId),
      activatedAgentIds: [...new Set((result.decisions || []).map((entry) => entry.characterId))],
      activatedAgentNames: [...new Set((result.decisions || []).map((entry) => characterNames[entry.characterId] || entry.characterId))],
      completedAgentIds: [...new Set(actions.map((action) => action.actorId))],
      ruleOnlyCharacterIds: [],
      ruleOnlyCharacterNames: [],
      witness: { scheduled: false, ran: false, provider: "", stage: "", degraded: false },
    }],
    agentDecisionMeta: {
      decisions: result.decisions?.length || 0,
      dialogueTurns: dialogueTurns.length,
      failures: [],
    },
    pipelineMeta,
    engineMeta: pipelineMeta,
  };
  const characterPatches = new Map((result.characterPatches || []).map((patch) => [patch.id, deepClone(patch)]));
  for (const action of actions) {
    const patch = characterPatches.get(action.actorId) || { id: action.actorId };
    patch.currentActivity = { type: action.actionType, description: action.visibleAction || action.speech, zoneId: action.moveToZoneId || action.actorZoneId };
    characterPatches.set(action.actorId, patch);
  }
  draft.updateBundle = {
    tavernState: {
      ...(deepClone(result.tavernState || state.tavernState || {})),
      sceneRuntime,
      eventThreads,
    },
    characters: [...characterPatches.values()],
    relationships: relationshipShift,
    characterMemories: causalCharacterMemories(state, result, id),
    characterPlans: [],
    townStateLedger: [],
    lifeEvents: actions.map((action) => ({
      id: action.id,
      characterId: action.actorId,
      activityType: action.actionType,
      visibleAction: action.visibleAction,
      dialogue: action.speech,
      affordanceId: action.affordanceId || "",
      affordanceType: action.affordanceType || "",
      visitId: action.visitId || "",
      materialConsequence: action.materialConsequence || "",
      resourceDelta: deepClone(action.resourceDelta || {}),
      elapsedSeconds: action.endedAtSeconds,
    })),
    rumors: [],
    evidence: [],
    secrets: [],
    irreversibleTraces: [],
    stateChangeReasons: actions.map((action) => ({
      id: createId("reason"),
      characterId: action.actorId,
      sourceDraftId: id,
      reason: `该行动由抵达人物自己的影响${action.causalParentImpactId ? ` ${action.causalParentImpactId}` : "与内在压力"}触发。`,
    })),
    consumedInjectedEvent: Boolean(causalLine(state.ui?.injectedEvent)),
  };
  draft.audit = auditDraft(draft, state);
  return draft;
}

export async function playTavernCausalSceneWithRunners(state, options = {}) {
  const totalStarted = Date.now();
  const runners = modelRunners(options.runners || {}, { policy: options.runnerPolicy });
  const slotContext = {
    day: Number(options.slotContext?.day ?? state.tavernState?.day ?? 0),
    slotId: options.slotContext?.slotId || "causal-scene",
    slotLabel: options.slotContext?.slotLabel || "同一场",
    slotBaseId: options.slotContext?.slotBaseId || "scene",
  };
  const characterIds = options.characterIds?.length
    ? options.characterIds
    : (state.characters || [])
      .filter((character) => character.lifeState?.present || character.lifeProfile?.simulationTier === "core")
      .map((character) => character.id)
      .slice(0, 6);
  const characterNames = characterIds.map((id) => state.characters?.find((character) => character.id === id)?.name || id);
  await emitPipelineProgress(options, {
    type: "scene_started",
    grain: state.ui?.timeGrain || "scene",
    characterIds,
    characterNames,
    locationId: "loc_xyy_tavern",
    locationName: "望梯酒馆",
    slotLabel: slotContext.slotLabel,
    slotId: slotContext.slotId,
  });
  await emitPipelineProgress(options, {
    type: "shared_space",
    characterIds,
    characterNames,
    locationId: "loc_xyy_tavern",
    locationName: "望梯酒馆",
    slotLabel: slotContext.slotLabel,
    slotId: slotContext.slotId,
  });
  const streamedImpacts = new Map();
  const streamedActions = new Map();
  // A remote Character Agent outage must degrade the stage, not kill the
  // world: the guarded runner records the failure and falls back to a pass
  // decision so the scene keeps settling on deterministic rules.
  const causalAgentFailures = [];
  const guardedCausalAgentRunner = async (input, callOptions = {}) => {
    try {
      return await runners.runTavernCausalAgent(input, callOptions);
    } catch (error) {
      causalAgentFailures.push({
        runnerKey: "runTavernCausalAgent",
        characterId: input?.agent?.id || input?.characterId || "",
        characterName: input?.agent?.name || "",
        message: String(error?.message || error).slice(0, 200),
      });
      return {
        decision: {
          actionType: "pass",
          speechAct: "none",
          utterance: { literalSpeech: "", vocalMode: "conversational" },
          privateReason: "远程人物决策暂不可用，本轮按原地继续结算。",
        },
        stage: { name: "CausalAgent:DeterministicFallback", provider: "deterministic-kernel", elapsedMs: 0 },
      };
    }
  };
  const result = await runTavernCausalScene(state, {
    characterIds,
    positions: options.positions || {},
    seedImpacts: options.seedImpacts || [],
    allowOrphanVisitors: options.allowOrphanVisitors === true,
    runAgent: guardedCausalAgentRunner,
    characterAgentProtocolVersion: options.characterAgentProtocolVersion ?? 2,
    runAgentV2Stage: runners.runTavernCharacterAgentV2Stage,
    signal: options.signal,
    maxSteps: options.maxSteps || 12,
    maxSceneSeconds: options.maxSceneSeconds || 15 * 60,
    minimumActivationScore: options.minimumActivationScore || 34,
    slotContext,
    async onEvent(event) {
      if (event.type === "impact_created" && event.impact?.id) streamedImpacts.set(event.impact.id, event.impact);
      const observerPsychology = publicObserverPsychology(event.observerPsychology);
      const { observerPsychology: _observerOnly, ...eventWithoutObserverPsychology } = event;
      const publicEvent = event.type === "causal_action_committed"
        ? { ...eventWithoutObserverPsychology, action: publicCausalAction(event.action) }
        : eventWithoutObserverPsychology;
      await emitPipelineProgress(options, publicEvent);
      if (event.type === "impact_created" && event.impact?.publicEvent === true) {
        const paragraph = causalPublicEventParagraph(event.impact);
        if (paragraph) await emitPipelineProgress(options, {
          type: "novel_delta",
          text: `${paragraph}\n\n`,
          locationId: "loc_xyy_tavern",
          locationName: "望梯酒馆",
          slotLabel: slotContext.slotLabel,
          slotId: slotContext.slotId,
        });
      }
      if (event.type === "causal_agent_activated") {
        await emitPipelineProgress(options, {
          type: "agent_thinking",
          characterId: event.characterId,
          characterName: event.characterName,
          locationId: "loc_xyy_tavern",
          locationName: "望梯酒馆",
          slotLabel: slotContext.slotLabel,
          slotId: slotContext.slotId,
        });
      }
      if (event.type !== "causal_action_committed") return;
      const action = event.action;
      const parentImpact = streamedImpacts.get(action.causalParentImpactId);
      const parentAction = streamedActions.get(parentImpact?.causedByActionId);
      const respondsDirectly = directCausalReply(action, parentAction);
      streamedActions.set(action.id, publicCausalAction(action));
      const paragraph = causalActionParagraph(action);
      await emitPipelineProgress(options, {
        type: "agent_ready",
        characterId: action.actorId,
        characterName: action.actorName,
        locationId: "loc_xyy_tavern",
        locationName: "望梯酒馆",
        slotLabel: slotContext.slotLabel,
        slotId: slotContext.slotId,
        observerPsychology,
      });
      if (action.visibleAction) await emitPipelineProgress(options, {
        type: "action",
        id: action.id,
        actorId: action.actorId,
        actorName: action.actorName,
        targetId: action.targetCharacterId,
        targetName: action.targetCharacterName,
        text: action.visibleAction,
        locationName: "望梯酒馆",
        slotLabel: slotContext.slotLabel,
        slotId: slotContext.slotId,
        observerPsychology,
      });
      if (action.speech) await emitPipelineProgress(options, {
        type: "dialogue",
        id: action.id,
        speakerId: action.actorId,
        speakerName: action.actorName,
        targetId: action.targetCharacterId,
        targetName: action.targetCharacterName,
        line: action.speech,
        turnRole: action.speechAct,
        respondsTo: respondsDirectly ? parentAction.id : "",
        responseSourceLine: respondsDirectly ? parentAction.speech : "",
        responseSourceSpeakerId: respondsDirectly ? parentAction.actorId : "",
        responseSourceSlotId: slotContext.slotId,
        responseSourceSlotLabel: slotContext.slotLabel,
        responseTopic: respondsDirectly ? action.publicTopic || parentAction?.publicTopic || "" : "",
        locationName: "望梯酒馆",
        slotLabel: slotContext.slotLabel,
        slotId: slotContext.slotId,
        observerPsychology,
      });
      const reachedNames = [...new Set((action.deliveries || []).map((delivery) => (
        state.characters?.find((character) => character.id === delivery.recipientId)?.name || delivery.recipientId
      )))];
      if (reachedNames.length) await emitPipelineProgress(options, {
        type: "exchange_outcome",
        sourceCharacterId: action.actorId,
        sourceCharacterName: action.actorName,
        responseCharacterId: action.targetCharacterId,
        responseCharacterName: action.targetCharacterName,
        sharedObject: action.publicTopic || "同场影响",
        text: `${action.actorName}的这次行动确实传到了${reachedNames.join("、")}那里。`,
        locationName: "望梯酒馆",
        slotLabel: slotContext.slotLabel,
        slotId: slotContext.slotId,
      });
      if (paragraph) await emitPipelineProgress(options, {
        type: "novel_delta",
        text: `${paragraph}\n\n`,
        locationId: "loc_xyy_tavern",
        locationName: "望梯酒馆",
        slotLabel: slotContext.slotLabel,
        slotId: slotContext.slotId,
      });
    },
  });
  const draft = buildTavernCausalDraft(state, result, totalStarted, options.pipelineMode || "live", slotContext);
  if (causalAgentFailures.length) {
    draft.agentDecisionMeta = {
      ...(draft.agentDecisionMeta || {}),
      failures: [...(draft.agentDecisionMeta?.failures || []), ...causalAgentFailures],
    };
    draft.pipelineMeta = {
      ...(draft.pipelineMeta || {}),
      degradedStages: [
        ...(draft.pipelineMeta?.degradedStages || []),
        ...causalAgentFailures.map(() => ({ name: "CausalAgent:DeterministicFallback", provider: "deterministic-kernel", elapsedMs: 0 })),
      ],
    };
  }
  await emitPipelineProgress(options, {
    type: "scene_complete",
    surfaceEvent: draft.surfaceEvent,
    sceneText: draft.novelText,
    locationId: draft.locationId,
    locationName: "望梯酒馆",
    slotLabel: slotContext.slotLabel,
    slotId: slotContext.slotId,
  });
  return draft;
}

function compactCausalPeriodOutputTick(tick = {}) {
  const causal = tick.causalScene || {};
  return {
    id: tick.id,
    projectId: tick.projectId,
    branchId: tick.branchId,
    day: Number(tick.day || 0),
    order: Number(tick.order || 0),
    slotId: tick.slotId || "",
    label: tick.label || tick.slotLabel || "",
    slotLabel: tick.slotLabel || tick.label || "",
    locationId: tick.locationId || "loc_xyy_tavern",
    locationName: "望梯酒馆",
    participantIds: [...(tick.participantIds || [])],
    arrivalCharacterIds: [...(tick.arrivalCharacterIds || [])],
    surfaceEvent: tick.surfaceEvent || "",
    sceneText: tick.sceneText || tick.novelText || "",
    novelText: tick.novelText || tick.sceneText || "",
    canonicalDialogueTurns: deepClone(tick.canonicalDialogueTurns || []),
    agentOutputs: deepClone(tick.agentOutputs || []),
    sceneInteraction: deepClone(tick.sceneInteraction || {}),
    agentParticipation: deepClone(tick.agentParticipation || {}),
    agentDecisionMeta: deepClone(tick.agentDecisionMeta || {}),
    causalScene: {
      schemaVersion: Number(causal.schemaVersion || 1),
      elapsedSeconds: Number(causal.elapsedSeconds || 0),
      stopReason: causal.stopReason || "",
      macroTimeAdvanced: Boolean(causal.macroTimeAdvanced),
      slotId: causal.slotId || tick.slotId || "",
      slotLabel: causal.slotLabel || tick.label || "",
      day: Number(causal.day || tick.day || 0),
      unresolvedRequests: deepClone(causal.unresolvedRequests || []),
      actions: deepClone(causal.actions || []),
      activations: deepClone(causal.activations || []),
    },
  };
}

async function playTavernCausalPeriodWithRunners(state, options = {}) {
  const totalStarted = Date.now();
  const grain = state.ui?.timeGrain === "week" ? "week" : "day";
  const dayCount = grain === "week" ? 7 : 1;
  const startDay = Number(state.tavernState?.day || 0);
  const startTick = Number(state.tavernState?.tick || 0);
  const storedCursor = state.tavernState?.periodCursor?.status === "blocked"
    ? state.tavernState.periodCursor
    : null;
  const periodStartDay = Number(storedCursor?.periodStartDay || startDay + 1);
  const periodEndDay = Number(storedCursor?.periodEndDay || startDay + dayCount);
  const firstRunDay = Number(storedCursor?.day || periodStartDay);
  const firstSlotIndex = storedCursor
    ? Math.max(0, TAVERN_CAUSAL_DAY_SLOTS.findIndex((slot) => slot.id === storedCursor.slotBaseId))
    : 0;
  const slotSchedule = [];
  for (let day = firstRunDay; day <= periodEndDay; day += 1) {
    const slots = day === firstRunDay ? TAVERN_CAUSAL_DAY_SLOTS.slice(firstSlotIndex) : TAVERN_CAUSAL_DAY_SLOTS;
    for (const slot of slots) slotSchedule.push({ day, slot });
  }
  const totalSlots = slotSchedule.length;
  const ticks = [];
  let evolvingState = deepClone(state);
  const stages = [];
  let periodBlockedBy = null;

  await emitPipelineProgress(options, {
    type: "period_started",
    grain,
    totalSlots,
    locationId: "loc_xyy_tavern",
    locationName: "望梯酒馆",
  });

  periodSlots: for (const { day, slot } of slotSchedule) {
      const resumingBlockedSlot = Boolean(storedCursor && day === firstRunDay && slot.id === storedCursor.slotBaseId);
      const prepared = prepareTavernCausalSlot(evolvingState, { day, slot, resume: resumingBlockedSlot });
      const displayLabel = grain === "week" ? `第${day - periodStartDay + 1}日·${slot.label}` : slot.label;
      const slotContext = { ...prepared.slotContext, slotLabel: displayLabel };
      const sceneDraft = await playTavernCausalSceneWithRunners(prepared.state, {
        ...options,
        characterIds: prepared.characterIds,
        positions: prepared.positions,
        seedImpacts: [
          ...prepared.seedImpacts,
          ...(resumingBlockedSlot ? [] : options.seedImpactsBySlot?.[prepared.slotContext.slotId] || []),
        ],
        slotContext,
        maxSteps: Number(options.maxStepsPerSlot || (grain === "week" ? 5 : 6)),
        maxSceneSeconds: Number(options.maxSceneSecondsPerSlot || 12 * 60),
      });
      sceneDraft.day = day;
      sceneDraft.order = ticks.length + 1;
      sceneDraft.slotId = slotContext.slotId;
      sceneDraft.label = displayLabel;
      sceneDraft.slotLabel = displayLabel;
      sceneDraft.arrivalCharacterIds = prepared.arrivals;
      sceneDraft.agentParticipation = sceneDraft.agentParticipation?.[0] || {
        day,
        slotId: slotContext.slotId,
        slotLabel: displayLabel,
        presentCharacterIds: prepared.characterIds,
        activatedAgentIds: [],
        witness: { scheduled: false, ran: false, provider: "", stage: "", degraded: false },
      };
      const unresolvedRequests = sceneDraft.causalScene?.unresolvedRequests || [];
      sceneDraft.causalScene.macroTimeAdvanced = unresolvedRequests.length === 0;
      ticks.push(sceneDraft);
      stages.push(...(sceneDraft.pipelineMeta?.stages || []));

      evolvingState = applyModelPeriodBundleToLocalState(prepared.state, sceneDraft.updateBundle || {});
      evolvingState.tavernState = evolvingState.tavernState || {};
      if (ticks.length === 1 && evolvingState.ui) evolvingState.ui.injectedEvent = "";
      if (unresolvedRequests.length) {
        periodBlockedBy = {
          day,
          slotBaseId: slot.id,
          slotId: slotContext.slotId,
          slotLabel: displayLabel,
          requests: deepClone(unresolvedRequests),
        };
        evolvingState.tavernState.periodCursor = {
          status: "blocked",
          day,
          slotBaseId: slot.id,
          slotId: slotContext.slotId,
          slotLabel: displayLabel,
          periodStartDay,
          periodEndDay,
          grain,
          blockedRequestIds: unresolvedRequests.map((request) => request.id).filter(Boolean),
          elapsedSecondsWithinSlot: Number(sceneDraft.causalScene?.elapsedSeconds || 0),
        };
        break periodSlots;
      }
      evolvingState.tavernState.periodCursor = null;
      evolvingState.tavernState.tick = startTick + ticks.length;
      if (slot.id === "night") evolvingState.tavernState.day = day;
  }

  const id = createId("draft");
  const actions = ticks.flatMap((tick) => (tick.causalScene?.actions || []).map((action) => ({
    ...deepClone(action),
    day: tick.day,
    slotId: tick.slotId,
    slotLabel: tick.label,
  })));
  const impacts = ticks.flatMap((tick) => (tick.causalScene?.impacts || []).map((impact) => ({
    ...deepClone(impact), day: tick.day, slotId: tick.slotId, slotLabel: tick.label,
  })));
  const deliveries = ticks.flatMap((tick) => (tick.causalScene?.deliveries || []).map((delivery) => ({
    ...deepClone(delivery), day: tick.day, slotId: tick.slotId, slotLabel: tick.label,
  })));
  const activations = ticks.flatMap((tick) => (tick.causalScene?.activations || []).map((activation) => ({
    ...deepClone(activation), day: tick.day, slotId: tick.slotId, slotLabel: tick.label,
  })));
  const observerPsychology = ticks.flatMap((tick) => (tick.observerPsychology || []).map((entry) => ({
    ...deepClone(entry), day: tick.day, slotId: tick.slotId, slotLabel: tick.label,
  })));
  const participantIds = [...new Set(ticks.flatMap((tick) => tick.participantIds || []))];
  const relationshipShift = ticks.flatMap((tick) => tick.updateBundle?.relationships || []);
  const characterMemories = ticks.flatMap((tick) => tick.updateBundle?.characterMemories || []);
  const lifeEvents = ticks.flatMap((tick) => tick.updateBundle?.lifeEvents || []);
  const stateChangeReasons = ticks.flatMap((tick) => tick.updateBundle?.stateChangeReasons || []);
  const novelText = ticks.map((tick) => `${tick.label}，望梯酒馆内。\n\n${tick.novelText || tick.sceneText || ""}`).join("\n\n");
  const agentOutputs = ticks.flatMap((tick) => (tick.agentOutputs || []).map((output) => ({
    ...deepClone(output), day: tick.day, periodLabel: tick.label, slotId: tick.slotId,
  })));
  const pipelineMeta = {
    mode: "model-tavern-causal-period",
    pipelineMode: options.pipelineMode || "live",
    provider: "openai",
    model: requireCurrentModel(),
    pipeline: "MacroTrigger→CausalAgentScene→Commit→AdvanceClock→CanonicalActionLedger",
    stages,
    degradedStages: [],
    repaired: false,
    elapsedMs: Date.now() - totalStarted,
    remoteCallUpperBound: totalSlots * Number(options.maxStepsPerSlot || (grain === "week" ? 5 : 6)),
  };
  const outputTicks = ticks.map(compactCausalPeriodOutputTick);
  const draft = {
    id,
    projectId: state.project?.id,
    branchId: state.ui?.activeBranchId || state.project?.activeBranchId || "branch_main",
    createdAt: new Date().toISOString(),
    provider: "openai-causal-character-agents",
    model: requireCurrentModel(),
    timeGrain: grain,
    locationId: "loc_xyy_tavern",
    participantIds,
    surfaceEvent: periodBlockedBy
      ? `${periodBlockedBy.slotLabel}仍有当面请求未得到回答、拒绝、转交或明确延期，时间停在这一局部互动。`
      : `${grain === "week" ? "七日" : "一日"}内的${ticks.length}个时段依次完成因果人物场景并结算。`,
    sceneText: novelText,
    novelText,
    observerPsychology,
    agentOutputs,
    relationshipShift,
    irreversibleTraces: [],
    sceneInteraction: {
      locationId: "loc_xyy_tavern",
      agentExchanges: ticks.flatMap((tick) => tick.sceneInteraction?.agentExchanges || []),
      relationshipShift,
      concreteOutcome: `${actions.length}次人物行动按时段先后提交，没有未来时段预写。`,
      presentAtEndIds: (evolvingState.characters || []).filter((character) => character.lifeState?.present).map((character) => character.id),
    },
    periodSimulation: {
      id: createId("tavern_causal_period"),
      duration: grain,
      focus: { mode: "location", locationId: "loc_xyy_tavern", locationName: "望梯酒馆" },
      tickCount: ticks.length,
      startedAt: new Date(totalStarted).toISOString(),
      locationIds: ["loc_xyy_tavern"],
      participantIds,
      ticks: outputTicks,
    },
    causalPeriod: {
      schemaVersion: 1,
      grain,
      slots: ticks.map((tick) => ({
        day: tick.day,
        slotId: tick.slotId,
        slotLabel: tick.label,
        elapsedSeconds: Number(tick.causalScene?.elapsedSeconds || 0),
        actionCount: tick.causalScene?.actions?.length || 0,
        stopReason: tick.causalScene?.stopReason || "quiescent",
        committedBeforeNextSlot: !(tick.causalScene?.unresolvedRequests || []).length,
      })),
      blockedBy: deepClone(periodBlockedBy),
    },
    causalScene: {
      schemaVersion: 1,
      elapsedSeconds: ticks.reduce((sum, tick) => sum + Number(tick.causalScene?.elapsedSeconds || 0), 0),
      stopReason: periodBlockedBy ? "period-blocked-by-unresolved-interaction" : "period-complete",
      macroTimeAdvanced: !periodBlockedBy,
      unresolvedRequests: deepClone(periodBlockedBy?.requests || []),
      actions,
      impacts,
      deliveries,
      activations,
      sceneRuntime: deepClone(evolvingState.tavernState?.sceneRuntime || {}),
    },
    agentParticipation: ticks.map((tick) => deepClone(tick.agentParticipation || {})),
    agentDecisionMeta: {
      decisions: activations.length,
      dialogueTurns: ticks.reduce((sum, tick) => sum + Number(tick.agentDecisionMeta?.dialogueTurns || 0), 0),
      failures: ticks.flatMap((tick) => tick.agentDecisionMeta?.failures || []),
      participationByTick: Object.fromEntries(ticks.map((tick) => [tick.slotId, deepClone(tick.agentParticipation || {})])),
    },
    pipelineMeta: {
      ...pipelineMeta,
      degradedStages: [
        ...(pipelineMeta?.degradedStages || []),
        ...ticks.flatMap((tick) => tick.pipelineMeta?.degradedStages || []).filter((stage) => String(stage?.name || "").includes("DeterministicFallback")),
      ],
    },
    engineMeta: pipelineMeta,
  };
  draft.updateBundle = {
    tavernState: deepClone(evolvingState.tavernState || {}),
    characters: (evolvingState.characters || []).map((character) => ({
      id: character.id,
      currentLocationId: character.currentLocationId || "loc_xyy_tavern",
      currentActivity: deepClone(character.currentActivity || character.lifeState?.currentActivity || null),
      lifeState: deepClone(character.lifeState || {}),
      ecologyState: deepClone(character.ecologyState || null),
    })),
    relationships: relationshipShift,
    characterMemories,
    characterPlans: [],
    townStateLedger: [],
    lifeEvents,
    rumors: [],
    evidence: [],
    secrets: [],
    irreversibleTraces: [],
    stateChangeReasons,
    consumedInjectedEvent: Boolean(causalLine(state.ui?.injectedEvent)),
  };
  draft.audit = auditDraft(draft, state);
  await emitPipelineProgress(options, {
    type: "period_complete",
    grain,
    totalSlots,
    locationId: "loc_xyy_tavern",
    locationName: "望梯酒馆",
  });
  return draft;
}

function canonicalTavernCarryFacts(tick = {}) {
  const importantTypes = new Set([
    "arrive", "depart", "receive_guest", "accept_delivery", "serve_guest", "settle_visit",
    "perform_exchange", "perform_visit_business", "attempt_secondary_objective",
    "request", "refuse", "refuse_service", "speak",
  ]);
  const facts = (tick.lifeEvents || [])
    .filter((event) => event.characterId && (event.consequence || event.socialIntent || importantTypes.has(event.activityType)))
    .map((event) => `${tick.label || "这一刻"}：${event.consequence || event.visibleAction || event.description || ""}`)
    .filter((fact) => !fact.endsWith("："));
  return [...new Set(facts)].slice(0, 4);
}

function appendBoundedDayLog(dayLog, facts = []) {
  dayLog.push(...facts.filter(Boolean));
  if (dayLog.length > 18) dayLog.splice(0, dayLog.length - 18);
}

async function playTavernModelPeriodWithRunners(state, options = {}) {
  const totalStarted = Date.now();
  const runners = modelRunners(options.runners || {}, { policy: options.runnerPolicy });
  const probeDraft = playTavernLifeNext(state);
  const decisionResult = await runTavernAgentDecisionPeriod(state, probeDraft, {
    runDecision: runners.runTavernAgentDecision,
    signal: options.signal,
    maxAgentsPerTick: 3,
  });
  let draft = playTavernLifeNext(state, {
    decisionOverrides: decisionResult.decisionOverrides,
    settledSocialRequestIds: decisionResult.settledSocialRequestIds || [],
  });
  draft = applyTavernAgentDecisionResult(draft, decisionResult, state);
  const location = (state.locations || []).find((item) => item.id === draft.locationId) || state.locations?.[0] || { id: draft.locationId, name: "望梯酒馆" };
  const groundedLocation = {
    ...location,
    institution: deepClone(draft.updateBundle?.tavernState?.institution || state.tavernState?.institution || {}),
  };
  const dayLog = [];
  const stages = [
    { name: "TavernAffordanceProbe", provider: "deterministic-kernel", elapsedMs: 0 },
    ...(decisionResult.stages || []),
    { name: "TavernLifeReplay", provider: "deterministic-kernel", elapsedMs: 0 },
  ];
  const periodTicks = draft.periodSimulation?.ticks || [];
  const witnessIndexes = periodTicks.length <= 5
    ? new Set(periodTicks.map((_, index) => index))
    : new Set(Array.from({ length: 5 }, (_, index) => Math.round(index * (periodTicks.length - 1) / 4)));

  await emitPipelineProgress(options, {
    type: "period_started",
    grain: state.ui?.timeGrain || "day",
    totalSlots: draft.periodSimulation?.ticks?.length || 0,
    locationId: location.id,
    locationName: location.name,
  });

  for (const [index, tick] of periodTicks.entries()) {
    const groundingActions = (tick.agentOutputs || []).map((output) => output.visibleAction).filter(Boolean);
    const canonicalCarryFacts = canonicalTavernCarryFacts(tick);
    await emitPublicInteractionProgress(options, tick.sceneInteraction || {}, {
      activeCharacters: state.characters || [],
      selectedLocation: location,
    });
    if (!witnessIndexes.has(index)) {
      tick.agentParticipation = {
        ...(tick.agentParticipation || {}),
        witness: { scheduled: false, ran: false, provider: "", stage: "", degraded: false },
      };
      appendBoundedDayLog(dayLog, canonicalCarryFacts);
      await emitPipelineProgress(options, {
        type: "novel_delta",
        text: `${tick.novelText || tick.sceneText || ""}\n\n`,
        slotIndex: index,
        slotLabel: tick.label,
        locationId: location.id,
        locationName: location.name,
      });
      continue;
    }
    let stage = { name: `ActivityWitness:${tick.label}:LocalFallback`, provider: "local", elapsedMs: 0 };
    try {
      const slotResult = await runners.runBackgroundSlot({
        location: groundedLocation,
        slot: { id: tick.id, label: tick.label, focus: tick.slotFocus || "" },
        characters: (tick.participantIds || []).map((characterId) => {
          const character = (state.characters || []).find((item) => item.id === characterId) || {};
          const activity = (tick.agentOutputs || []).find((output) => output.characterId === characterId);
          return {
            id: character.id,
            name: character.name,
            identity: character.lifeProfile?.role || character.externalSituation || "",
            situationalRole: activity?.situationalRole || character.lifeState?.situationalRole || "",
            currentActivity: activity?.chosenAction || character.currentActivity?.description || "",
            goal: character.lifeState?.activeGoal || character.lifeProfile?.commitments?.[0] || "",
            agency: deepClone(activity?.agency || character.lifeProfile?.tavernAgency || {}),
            knowledgeBoundary: deepClone(activity?.knowledgeBoundary || character.lifeProfile?.tavernAgency?.knowledgeBoundary || {}),
            perceivedVisit: deepClone(activity?.perceivedVisit || null),
            contextManifest: deepClone(activity?.contextManifest || null),
          };
        }),
        groundingActions,
        lifeEvents: tick.lifeEvents || [],
        socialIntents: tick.sceneInteraction?.socialIntents || [],
        canonicalDialogueTurns: tick.canonicalDialogueTurns || [],
        canonicalConsequences: (tick.lifeEvents || []).map((event) => event.consequence).filter(Boolean),
        dayLog: [...dayLog],
        ui: {
          ...(state.ui || {}),
          injectedEvent: (tick.lifeEvents || []).some((event) => event.pressureType === "injected-pressure") ? state.ui?.injectedEvent || "" : "",
        },
        signal: options.signal,
      });
      if (slotResult.slotText) {
        tick.novelText = slotResult.slotText;
        tick.sceneText = slotResult.slotText;
        tick.synthesized = { ...(tick.synthesized || {}), sceneText: slotResult.slotText };
      }
      if ((slotResult.dialogueTurns || []).length && !(tick.canonicalDialogueTurns || []).length) {
        const dialogueTurns = slotResult.dialogueTurns.map((turn, turnIndex) => ({
          ...turn,
          turnId: `${tick.id}_witness_turn_${turnIndex + 1}`,
          line: turn.line,
          generatedBy: "activity-witness-expression",
          observedTurnId: turnIndex > 0 ? `${tick.id}_witness_turn_${turnIndex}` : "",
          respondsTo: turnIndex > 0 ? `${tick.id}_witness_turn_${turnIndex}` : "",
        }));
        tick.sceneInteraction = {
          ...(tick.sceneInteraction || {}),
          agentExchanges: [{
            id: `${tick.id}_witness_exchange`,
            generatedFrom: "canonical-tavern-social-intent",
            dialogueTurns,
            eventOutcome: tick.sceneInteraction?.concreteOutcome || tick.surfaceEvent || "",
          }],
        };
        if (tick.simulationTick) tick.simulationTick.sceneInteraction = tick.sceneInteraction;
        tick.synthesized = { ...(tick.synthesized || {}), sceneInteraction: tick.sceneInteraction };
      }
      appendBoundedDayLog(dayLog, [...(slotResult.carryFacts || []), ...canonicalCarryFacts]);
      stage = slotResult.stage || { name: `ActivityWitness:${tick.label}`, provider: "model", elapsedMs: 0 };
    } catch (error) {
      appendBoundedDayLog(dayLog, canonicalCarryFacts.length
        ? canonicalCarryFacts
        : [`${tick.label}：${tick.surfaceEvent || groundingActions[0] || "酒馆照常运转"}`]);
      stage = {
        name: `ActivityWitness:${tick.label}:LocalFallback`,
        provider: "deterministic-kernel",
        elapsedMs: 0,
        error: error?.message || String(error),
      };
    }
    stages.push(stage);
    tick.agentParticipation = {
      ...(tick.agentParticipation || {}),
      witness: {
        scheduled: true,
        ran: true,
        provider: stage.provider || "",
        stage: stage.name || `ActivityWitness:${tick.label}`,
        degraded: String(stage.name || "").includes("Fallback") || Boolean(stage.error),
      },
    };
    await emitPipelineProgress(options, {
      type: "novel_delta",
      text: `${tick.novelText || tick.sceneText || ""}\n\n`,
      slotIndex: index,
      slotLabel: tick.label,
      locationId: location.id,
      locationName: location.name,
    });
  }

  draft.provider = "model-tavern-activity-witness";
  draft.agentParticipation = periodTicks.map((tick) => deepClone(tick.agentParticipation || {}));
  if (draft.agentDecisionMeta) {
    draft.agentDecisionMeta.participationByTick = Object.fromEntries(periodTicks.map((tick) => [
      `${Number(tick.day || 0)}:${String(tick.slotId || tick.id || "")}`,
      deepClone(tick.agentParticipation || {}),
    ]));
  }
  draft.model = requireCurrentModel();
  draft.novelText = (draft.periodSimulation?.ticks || []).map((tick) => tick.novelText || tick.sceneText || "").filter(Boolean).join("\n\n");
  draft.sceneText = draft.novelText;
  draft.pipelineMeta = {
    mode: "model-tavern-life-period",
    pipelineMode: options.pipelineMode || "live",
    provider: "openai",
    model: requireCurrentModel(),
    pipeline: `TavernLifeKernel:AffordanceProbe→TavernAgentDecision→ValidatedReplay→ActivityWitness*${witnessIndexes.size}→ConsequenceLedger→StateArchivist`,
    stages,
    degradedStages: stages.filter((stage) => String(stage?.name || "").includes("Fallback")),
    repaired: false,
    elapsedMs: Date.now() - totalStarted,
  };
  draft.engineMeta = draft.pipelineMeta;
  await emitPipelineProgress(options, {
    type: "period_complete",
    grain: state.ui?.timeGrain || "day",
    totalSlots: draft.periodSimulation?.ticks?.length || 0,
    locationId: location.id,
    locationName: location.name,
  });
  return draft;
}

export async function playModelPeriodWithRunners(state, options = {}) {
  if (isTavernLifeState(state)) {
    return ["scene", "beat"].includes(state.ui?.timeGrain)
      ? playTavernCausalSceneWithRunners(state, options)
      : playTavernCausalPeriodWithRunners(state, options);
  }
  const totalStarted = Date.now();
  const grain = state.ui?.timeGrain || "day";
  const configuredLocation = selectedLocation(state);
  const firstLocation = state.ui?.focusMode === "location" ? configuredLocation : (state.locations?.[0] || configuredLocation);
  const locations = orderedLocations(state, firstLocation);
  const focus = buildModelPeriodFocus(state, firstLocation);
  const slots = periodSlotsForGrain(grain);
  let evolvingState = deepClone(state);
  const ticks = [];
  const periodStages = [];
  const hybridPeriod = ["fast", "balanced", "live"].includes(options.pipelineMode);
  const balancedPeriod = options.pipelineMode === "balanced" || options.pipelineMode === "live";
  const livePeriod = options.pipelineMode === "live";
  const dayLog = [];
  const runners = modelRunners(options.runners || {}, { policy: options.runnerPolicy });
  const detailedSlotIndex = hybridPeriod ? (focus.mode === "location" ? 0 : Math.min(2, slots.length - 1)) : -1;
  const castUsage = new Map();
  const usedBackgroundDetails = new Set();
  const usedBackgroundActions = new Set();

  await emitPipelineProgress(options, {
    type: "period_started",
    grain,
    totalSlots: slots.length,
    locationId: firstLocation?.id || "",
    locationName: firstLocation?.name || "",
  });

  for (const [index, slot] of slots.entries()) {
    const location = chooseModelLocationForSlot(evolvingState, locations, index, focus);
    const activeCharacters = balancedPeriod
      ? chooseBalancedCharactersForSlot(evolvingState, location, index, castUsage)
      : chooseModelCharactersForSlot(evolvingState, location, index);
    notePeriodCastUsage(castUsage, activeCharacters, index);
    const localState = buildLocalModelState(evolvingState, location, activeCharacters, slot);
    const useRemoteFocus = !hybridPeriod || index === detailedSlotIndex;
    let sceneDraft;
    if (useRemoteFocus) {
      sceneDraft = await runModelSceneOnce(localState, {
        ...options,
        periodContext: livePeriod ? { dayLog: [...dayLog] } : options.periodContext,
        progressContext: {
          slotIndex: index,
          slotLabel: slot.label,
        },
      });
      if (livePeriod && sceneDraft.surfaceEvent) {
        dayLog.push(`${slot.label} / ${location.name}：${sceneDraft.surfaceEvent}`);
      }
    } else {
      const backgroundState = {
        ...localState,
        ui: {
          ...(localState.ui || {}),
          timeGrain: "scene",
          focusMode: "location",
          selectedLocationId: location.id,
        },
      };
      sceneDraft = playWithMock(backgroundState);
      const backgroundMode = balancedPeriod ? "balanced" : "fast";
      sceneDraft.provider = `local-${backgroundMode}-background`;
      const localBackgroundText = buildBalancedBackgroundNovel({
        location,
        slot,
        sceneDraft,
        slotIndex: index,
        usedDetails: usedBackgroundDetails,
        usedActions: usedBackgroundActions,
        activeCharacters,
      });
      let backgroundStage = { name: `BackgroundSimulation:${slot.label}`, provider: "local", elapsedMs: 0 };
      sceneDraft.novelText = localBackgroundText;
      if (livePeriod) {
        try {
          const slotResult = await runners.runBackgroundSlot({
            location,
            slot,
            characters: activeCharacters.map((character) => ({
              id: character.id,
              name: character.name,
              identity: character.externalSituation || "",
              currentActivity: character.currentActivity?.description || character.currentActivity || "",
              goal: character.actionLines?.desire || "",
            })),
            groundingActions: (sceneDraft.agentOutputs || []).map((output) => output.visibleAction).filter(Boolean).slice(0, 4),
            dayLog: [...dayLog],
            ui: state.ui || {},
            signal: options.signal,
          });
          if (slotResult.slotText) {
            sceneDraft.novelText = slotResult.slotText;
            backgroundStage = slotResult.stage;
          }
          dayLog.push(...(slotResult.carryFacts || []));
        } catch {
          backgroundStage = { name: `BackgroundSlot:${slot.label}:LocalFallback`, provider: "local", elapsedMs: 0 };
        }
      }
      sceneDraft.pipelineMeta = {
        mode: `local-${backgroundMode}-background`,
        pipelineMode: backgroundMode,
        provider: "local",
        model: "deterministic-town-engine",
        pipeline: livePeriod
          ? "LocalBackgroundCharacterSimulation→BackgroundSlotModel→StateArchivist"
          : "LocalBackgroundCharacterSimulation→StateArchivist",
        stages: [backgroundStage],
        degradedStages: [],
        repaired: false,
        elapsedMs: 0,
      };
      sceneDraft.engineMeta = sceneDraft.pipelineMeta;
      await emitPipelineProgress(options, {
        type: "novel_delta",
        text: `${sceneDraft.novelText}\n\n`,
        slotIndex: index,
        slotLabel: slot.label,
        locationId: location.id,
        locationName: location.name,
      });
    }
    periodStages.push(...(sceneDraft.pipelineMeta?.stages || []));
    const tick = {
      id: createId("model_period_slot"),
      order: index + 1,
      label: slot.label,
      slotFocus: slot.focus,
      executionMode: useRemoteFocus ? "remote_focus" : "local_background",
      resolution: useRemoteFocus ? "focused_scene" : "background",
      precision: useRemoteFocus ? "scene" : "low",
      locationId: location.id,
      locationName: location.name,
      participantIds: sceneDraft.participantIds || activeCharacters.map((character) => character.id),
      simulationTick: sceneDraft.simulationTick,
      visibilityLayer: sceneDraft.visibilityLayer,
      privateSimulations: sceneDraft.privateSimulations || [],
      dialoguePsychology: sceneDraft.dialoguePsychology || [],
      novelText: sceneDraft.novelText || "",
      sceneInteraction: sceneDraft.sceneInteraction,
      agentOutputs: sceneDraft.agentOutputs || [],
      surfaceEvent: sceneDraft.surfaceEvent,
      sceneText: sceneDraft.sceneText,
      pipelineMeta: sceneDraft.pipelineMeta,
      synthesized: {
        surfaceEvent: sceneDraft.surfaceEvent,
        sceneText: sceneDraft.sceneText,
        subtextMatrix: sceneDraft.subtextMatrix || [],
        relationshipShift: sceneDraft.relationshipShift || [],
        irreversibleTraces: sceneDraft.irreversibleTraces || [],
        sceneInteraction: sceneDraft.sceneInteraction,
      },
      updateBundle: sceneDraft.updateBundle,
    };
    ticks.push(tick);
    evolvingState = applyModelPeriodBundleToLocalState(evolvingState, sceneDraft.updateBundle || buildUpdateBundle(sceneDraft, localState));
  }

  const periodSimulationTick = buildModelPeriodAggregateTick(state, ticks, grain);
  const periodInteraction = buildModelPeriodInteraction(ticks);
  const agentOutputs = ticks.flatMap((tick) => withPeriodMetadata(tick.agentOutputs || [], tick));
  const relationshipShift = ticks.flatMap((tick) => withPeriodMetadata(tick.synthesized?.relationshipShift || [], tick));
  const irreversibleTraces = ticks.flatMap((tick) => (tick.synthesized?.irreversibleTraces || []).map((trace) => `${tick.label} / ${tick.locationName}：${trace}`));
  const pipelineMeta = {
    mode: hybridPeriod ? `hybrid-${options.pipelineMode}-town-period-simulation` : "model-town-period-simulation",
    pipelineMode: hybridPeriod ? options.pipelineMode : "quality",
    provider: "openai",
    model: requireCurrentModel(),
    pipeline: hybridPeriod
      ? `LocalBackground*4 + CharacterPrivateSimulator(s)→${options.pipelineMode === "live" ? "LiveTurnLoop" : "CausalDialogueProtocol"}→LocalVisibility→SceneInteractionSimulator→NovelStreamer${balancedPeriod ? "+SelectivePsychology" : ""}*1→StateArchivist`
      : "Period(CharacterPrivateSimulator→VisibilityLayer→SceneInteractionSimulator→StateArchivist)*",
    stages: periodStages,
    repaired: periodStages.some((stage) => String(stage?.name || "").includes("Repair")),
    repairReason: null,
    elapsedMs: Date.now() - totalStarted,
  };
  const draft = {
    id: createId("draft"),
    projectId: state.project.id,
    branchId: state.ui?.activeBranchId || state.project?.activeBranchId || "branch_main",
    createdAt: new Date().toISOString(),
    provider: "openai-period-simulation",
    model: requireCurrentModel(),
    timeGrain: grain,
    locationId: firstLocation.id,
    participantIds: (state.characters || []).map((character) => character.id),
    userDirective: state.ui?.userDirective || "",
    injectedEvent: state.ui?.injectedEvent || "",
    eventImpact: state.ui?.eventImpact || 0,
    interventionsUsed: activeInterventionsForState(state).map((item) => item.id),
    interventionsApplied: agentOutputs.flatMap((output) => output.appliedInterventions || []),
    simulationMode: "model-town-period-simulation-loop",
    simulationTick: periodSimulationTick,
    visibilityLayer: periodSimulationTick.visibilityLayer,
    privateSimulations: periodSimulationTick.privateSimulations,
    sceneInteraction: periodInteraction,
    surfaceEvent: `${grain === "week" ? "一周" : "一天"}内，模型小镇在${ticks.length}个时间段连续运转`,
    sceneText: buildModelPeriodSceneText({ grain, ticks, state, focus }),
    novelText: ticks.map((tick) => tick.novelText || "").filter(Boolean).join("\n\n"),
    dialoguePsychology: ticks.flatMap((tick) => tick.dialoguePsychology || []),
    agentOutputs,
    subtextMatrix: ticks.flatMap((tick) => withPeriodMetadata(tick.synthesized?.subtextMatrix || [], tick)),
    relationshipShift,
    irreversibleTraces,
    periodSimulation: {
      id: createId("model_period"),
      duration: grain,
      focus,
      tickCount: ticks.length,
      startedAt: new Date().toISOString(),
      locationIds: [...new Set(ticks.map((tick) => tick.locationId))],
      participantIds: (state.characters || []).map((character) => character.id),
      ticks,
    },
    pipelineMeta,
    engineMeta: pipelineMeta,
  };
  draft.audit = auditDraft(draft, state);
  draft.updateBundle = buildUpdateBundle(draft, state);
  await emitPipelineProgress(options, {
    type: "period_complete",
    grain,
    totalSlots: ticks.length,
    locationId: firstLocation?.id || "",
    locationName: firstLocation?.name || "",
  });
  return draft;
}

export async function playWithOpenAIPipeline(state, options = {}) {
  if (!currentProviderConfig().apiKey) throw new Error("缺少 OPENAI_API_KEY/DEEPSEEK_API_KEY，无法使用实时模型模拟模式。 ");
  if (isTavernLifeState(state)) {
    return ["scene", "beat"].includes(state.ui?.timeGrain)
      ? playTavernCausalSceneWithRunners(state, options)
      : playTavernCausalPeriodWithRunners(state, options);
  }
  if (isPeriodGrain(state.ui?.timeGrain)) return playModelPeriodWithRunners(state, options);
  return runModelSceneOnce(state, options);
}
