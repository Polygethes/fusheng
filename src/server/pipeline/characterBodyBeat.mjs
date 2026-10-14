// The body before the mind. When a person's health changes state — they
// collapse, come round, or die — or while they lie unconscious, the beat is
// the body's, not a decision: no model is asked. The world settles the change
// (primitive "body_state") and onlookers see it; someone unconscious lies
// still and is looked in on every half hour of world time. Someone lying
// unconscious in knee-deep floodwater drowns.
import { healthOf, healthStep, woundsNow, bodyWithWounds } from "../simulation/characterHealth.mjs";
import { reduceCharacterPerformanceTurn } from "../simulation/characterPrivateStateReducer.mjs";
import { silentPayload, performanceContinuations } from "./characterPerformanceTurn.mjs";

export const BODY_BEAT_VERSION = "character-body-beat-v1";
export const UNCONSCIOUS_CHECK_SECONDS = 1800;
const clone = (value) => (value === undefined ? undefined : structuredClone(value));

/** Synced physiology with the wounds the world records felt in the body (pain, lost strength). */
export function woundedPhysiology(physiology = {}, selfHealth = {}, nowSeconds = 0) {
  const wounds = woundsNow(healthOf({ health: selfHealth }), nowSeconds);
  if (wounds <= 0) return physiology;
  const ecologyState = { ...(physiology.privateStatePatch?.ecologyState || {}) };
  ecologyState.body = bodyWithWounds(ecologyState.body || {}, wounds);
  return { ...physiology, privateState: { ...physiology.privateState, ecologyState }, privateStatePatch: { ...physiology.privateStatePatch, ecologyState } };
}

/** The beat's result in the runtime's turn shape, or null when the person is up and able to decide. */
export function runBodyBeat({ turnContext = {}, physiology = {}, nowSeconds = 0 } = {}) {
  const health = healthOf({ health: turnContext.worldProjection?.selfHealth });
  const ecologyState = clone(physiology.privateStatePatch?.ecologyState || turnContext.privateContext?.ecologyState || {});
  const drowning = health.state === "down" && (turnContext.worldProjection?.perceivedConditions || []).some((row) => row.kind === "flood_here" && row.deep === true);
  const step = drowning ? { health: { ...health, state: "dead", cause: "drowned", diedAtSeconds: nowSeconds }, event: "died" }
    : healthStep({ health, body: ecologyState.body || {}, nowSeconds });
  let attempt = null;
  let note = "";
  if (step.event) {
    attempt = { primitive: "body_state", payload: { ...silentPayload(), event: step.event, health: step.health } };
    note = { collapsed: "眼前一黑，身子不听使唤了。", came_round: "慢慢醒了过来。", died: "" }[step.event];
  } else if (health.state === "down") {
    attempt = { primitive: "wait", payload: { ...silentPayload(), targetCharacterId: "",
      waitCondition: { condition: "new_evidence", maximumSeconds: UNCONSCIOUS_CHECK_SECONDS, interruptOnDirectSpeech: false } } };
    note = "昏迷不醒。";
  }
  if (!attempt) return null;
  const actionAttempt = { ...attempt, attemptId: `action-attempt:${turnContext.agentTurnId}` };
  // Falling or coming round is followed at once by the next beat (lying still, or waking to think); lying still waits.
  ecologyState.characterPsychologyV2State = { ...(ecologyState.characterPsychologyV2State || {}),
    continuationIntentions: ["collapsed", "came_round"].includes(step.event) ? performanceContinuations(actionAttempt, turnContext.agentTurnId, nowSeconds) : [] };
  const privateTransition = reduceCharacterPerformanceTurn({
    ownerCharacterId: turnContext.characterId,
    previousPrivateState: turnContext.privateContext,
    agentTurnId: turnContext.agentTurnId,
    ownedEvidenceRecords: [],
    actionAttempt,
    thought: note,
    ownedParticipantHandleByCharacterId: clone(turnContext.worldProjection?.recipientPrivateBindings?.entityHandleByCanonicalId || {}),
    nowSeconds,
  });
  return {
    characterId: turnContext.characterId,
    agentTurnId: turnContext.agentTurnId,
    privateStatePatch: { ...physiology.privateStatePatch, ...privateTransition.privateStatePatch, ecologyState },
    actionAttempt,
    privateResult: {
      protocolVersion: BODY_BEAT_VERSION,
      turnKind: "body_beat",
      submissionMode: "body_beat",
      executionMode: "world-follows-the-body",
      stages: [],
      acceptedStageHistory: [{ stage: "body_beat" }],
      bodyBeat: { event: step.event || "unconscious", state: step.health.state, cause: step.health.cause || "" },
      evidenceReceiptSettlement: clone(privateTransition.receiptTransitions),
      decision: { privateDecisionBasis: note },
    },
  };
}
