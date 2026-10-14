import { assessSimulationIntegrity, throwSimulationIntegrityIssue } from "./simulationIntegrity.mjs";
import { nextWorldTemporalBoundary } from "./worldTemporalAgenda.mjs";
import {
  characterEventEvidenceRecords,
  createCharacterEventReceiptLedger,
  markCharacterEvidenceAppraised,
  markCharacterEvidenceConsumed,
  markCharacterEvidenceNoticed,
  registerCharacterEventDelivery,
  reserveCharacterEvidenceWake,
  recordCharacterEvidencePresentation,
} from "./characterEventReceipts.mjs";
import {
  characterOwnedTimedPlanSteps,
  dueCharacterOwnedPlanSteps,
  nextCharacterOwnedPlanDueAtSeconds,
} from "./characterLifeContinuity.mjs";
import { isExecutionProgressEvidence, materialStateDigest, promoteDueMaintenance, recordExecutionProgress, recordMaintenanceOpportunity, waitMatchesWake } from "./characterExecutionControl.mjs";
import { compactSettledTurnRecord } from "./settledSimulationReport.mjs";
import { isAsleep } from "./sleep.mjs";

export const CHARACTER_WORLD_RUNTIME_VERSION = "character-world-runtime-v1";

function clone(value) {
  if (value === undefined) return undefined;
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function clean(value = "") {
  return String(value ?? "").trim();
}

function fail(code, message, evidence = {}) {
  const error = new Error(message);
  error.code = code;
  error.evidence = clone(evidence);
  return error;
}

function actorMap(actors = []) {
  const rows = actors instanceof Map ? [...actors.values()] : Array.isArray(actors) ? actors : Object.values(actors || {});
  const map = new Map();
  for (const actor of rows) {
    const id = clean(actor?.characterId);
    if (!id || typeof actor?.runNextTurn !== "function") throw fail("CHARACTER_WORLD_ACTOR_INVALID", "World runtime requires Character Session Actors.");
    if (map.has(id)) throw fail("CHARACTER_WORLD_ACTOR_DUPLICATE", "Character actor is registered twice.", { characterId: id });
    map.set(id, actor);
  }
  return map;
}

function uniqueEvidenceIds(values = []) {
  return [...new Set((values || []).map(clean).filter(Boolean))];
}

function agentEvidenceReceiptSettlement(turn = {}, deliveredEvidenceIds = []) {
  const source = turn?.privateResult?.evidenceReceiptSettlement;
  if (!source) return null;
  if (clean(source.authority) !== "character-agent") {
    throw fail(
      "CHARACTER_WORLD_RECEIPT_SETTLEMENT_AUTHORITY_INVALID",
      "Only the Character Agent may report its private attention and appraisal settlement.",
    );
  }
  const delivered = new Set(uniqueEvidenceIds(deliveredEvidenceIds));
  const noticedEvidenceIds = uniqueEvidenceIds(source.noticedEvidenceIds);
  const appraisedEvidenceIds = uniqueEvidenceIds(source.appraisedEvidenceIds);
  const consumedEvidenceIds = uniqueEvidenceIds(source.consumedEvidenceIds);
  for (const evidenceId of [...noticedEvidenceIds, ...appraisedEvidenceIds, ...consumedEvidenceIds]) {
    if (!delivered.has(evidenceId)) {
      throw fail(
        "CHARACTER_WORLD_RECEIPT_SETTLEMENT_EVIDENCE_NOT_DELIVERED",
        "Character receipt settlement references evidence outside this wake.",
        { characterId: turn.characterId, evidenceId },
      );
    }
  }
  const noticed = new Set(noticedEvidenceIds);
  const appraised = new Set(appraisedEvidenceIds);
  for (const evidenceId of appraised) {
    if (!noticed.has(evidenceId)) {
      throw fail(
        "CHARACTER_WORLD_RECEIPT_APPRAISED_BEFORE_NOTICED",
        "Appraised evidence must also be explicitly reported as noticed.",
        { characterId: turn.characterId, evidenceId },
      );
    }
  }
  for (const evidenceId of consumedEvidenceIds) {
    if (!appraised.has(evidenceId)) {
      throw fail(
        "CHARACTER_WORLD_RECEIPT_CONSUMED_BEFORE_APPRAISED",
        "Consumed evidence must also be explicitly reported as appraised.",
        { characterId: turn.characterId, evidenceId },
      );
    }
  }
  return {
    noticedEvidenceIds,
    appraisedEvidenceIds,
    consumedEvidenceIds,
    consumptionDisposition: clean(source.consumptionDisposition) || "acted_or_explicitly_deferred",
  };
}

function applyAgentEvidenceReceiptSettlement(ledger, turn, deliveredEvidenceIds, step) {
  const settlement = agentEvidenceReceiptSettlement(turn, deliveredEvidenceIds);
  if (!settlement) return;
  const shared = {
    characterId: turn.characterId,
    agentTurnId: turn.agentTurnId,
    step,
  };
  if (settlement.noticedEvidenceIds.length) {
    markCharacterEvidenceNoticed(ledger, {
      ...shared,
      evidenceIds: settlement.noticedEvidenceIds,
    });
  }
  if (settlement.appraisedEvidenceIds.length) {
    markCharacterEvidenceAppraised(ledger, {
      ...shared,
      evidenceIds: settlement.appraisedEvidenceIds,
    });
  }
  if (settlement.consumedEvidenceIds.length) {
    markCharacterEvidenceConsumed(ledger, {
      ...shared,
      evidenceIds: settlement.consumedEvidenceIds,
      disposition: settlement.consumptionDisposition,
    });
  }
}

export function createCharacterWorldRuntime({
  coordinator,
  actors = [],
  situationProjector,
  receiptLedger = null,
  readyQueue = [],
  enableDayPlanning = false,
  prioritizeEvidenceWakes = false,
  onExecutionCheckpoint,
  completedTurnRecords = [],
} = {}) {
  if (!coordinator || typeof coordinator.submitActionAttempt !== "function") {
    throw fail("CHARACTER_WORLD_COORDINATOR_REQUIRED", "Character world runtime requires a commit coordinator.");
  }
  if (typeof situationProjector !== "function") {
    throw fail("CHARACTER_WORLD_PROJECTOR_REQUIRED", "Character world runtime requires a recipient-specific situation projector.");
  }
  // The dead act no more and are woken by nothing.
  const ended = new Set(Object.values(coordinator.worldState.entities || {}).filter((row) => row?.health?.state === "dead").map((row) => row.id));
  const actorById = actorMap(actors);
  const ledger = receiptLedger?.schemaVersion
    ? createCharacterEventReceiptLedger({ receipts: receiptLedger.receipts })
    : createCharacterEventReceiptLedger();
  const queue = [...new Set((readyQueue || []).map(clean).filter((id) => actorById.has(id) && actorRunnable(actorById.get(id))))];
  const completedRecords = new Map((completedTurnRecords || []).map(row => [row.agentTurnId, clone(row)]));
  for (const actor of actorById.values()) if (actorRunnable(actor) && (actor.pendingTurn || actor.inFlightWake) && !queue.includes(actor.characterId)) queue.push(actor.characterId);
  const persistExecution = async (phase, agentTurnId) => { if (onExecutionCheckpoint) await onExecutionCheckpoint({ phase, agentTurnId }); };

  function activeContinuationIntentions(actor) {
    return (actor?.privateState?.ecologyState?.characterPsychologyV2State?.continuationIntentions || [])
      .filter((row) => clean(row?.status || "active") === "active")
      .filter((row) => clean(row?.intentionId));
  }

  function continuationCanWakeWithoutNewEvidence(intention = {}, actor = {}) {
    const triggerType = clean(intention.triggerType);
    const nowSeconds = Math.max(0, Number(coordinator.worldState.nowSeconds || 0));
    const createdAt = Math.max(0, Number(intention.createdAtCharacterSeconds || 0));
    const ageSeconds = Math.max(0, nowSeconds - createdAt);
    const minimumDelaySeconds = Math.max(0, Number(intention.minimumDelaySeconds || 0));
    if (ageSeconds < minimumDelaySeconds) return false;
    // An opportunity is a changed affordance perceived by the character, not
    // a timer synonym. It can only wake through recipient-specific evidence.
    if (triggerType === "opportunity_window") return false;
    // A character may deliberately set a non-zero time horizon for checking
    // stalled progress. Zero means no clock wake was actually scheduled.
    if (triggerType === "elapsed_without_progress") return minimumDelaySeconds > 0;
    if (triggerType === "internal_pressure") {
      const pressure = Number(actor?.privateState?.ecologyState?.characterPsychologyV2State?.internalWakePressure || 0);
      return pressure >= Math.max(0, Math.min(1, Number(intention.triggerThreshold ?? 0.5)));
    }
    // target_response and new_relevant_evidence are activated only by real
    // recipient-specific deliveries, never by a synthetic scheduler guess.
    return false;
  }

  async function enqueueOwnedActionSettlementContinuation(actor, outcome = {}) {
    if (actor.executionControl?.waiting || actor.executionControl?.status !== "active") return false;
    const ownsActiveContinuousProcess = (coordinator.worldState.processes || []).some((row) => (
      clean(row.ownerActorId) === clean(actor.characterId)
      && clean(row.status) === "active"
      && clean(row.attentionMode) === "continuous_work"
    ));
    // Starting or continuing embodied work already occupies this character's
    // attention until an objective boundary (ready, interruption, or new
    // external evidence). Re-waking immediately from the just-settled motion
    // creates a zero-time decision loop and makes the Agent start the same
    // work again. The Character still owns any later response at those real
    // boundaries; the scheduler merely withholds a redundant opportunity.
    if (ownsActiveContinuousProcess) return false;
    const due = activeContinuationIntentions(actor)
      .filter((row) => clean(row.triggerType) === "own_action_settled");
    if (!due.length || !clean(outcome.eventId)) return false;
    return enqueueWake(actor.characterId, {
      wakeId: `wake:own-action-settled:${outcome.eventId}:${actor.characterId}`,
      kind: "continuation_due",
      causeType: "own_action_settled",
      eventId: clean(outcome.eventId),
      evidenceIds: [],
      evidence: [],
      continuationIntentionIds: due.map((row) => clean(row.intentionId)).filter(Boolean),
      settledOwnAction: {
        outcomeId: clean(outcome.outcomeId),
        eventId: clean(outcome.eventId),
        status: clean(outcome.status),
        primitive: clean(outcome.primitive),
      },
    });
  }

  function queueActor(characterId) {
    const id = clean(characterId);
    const actor = actorById.get(id);
    if (actor && actorRunnable(actor) && !queue.includes(id)) queue.push(id);
  }

  // In a town, a block of a resident's own written schedule — or the next
  // day's schedule — is a real new opportunity, not an empty loop: it releases
  // a stalled resident the way a direct address does.
  function ownScheduleDue(actor) {
    const plan = actor?.privateState?.lifePlanState;
    if (!prioritizeEvidenceWakes || clean(plan?.source) !== "day_schedule") return false;
    const now = Math.max(0, Number(coordinator.worldState.nowSeconds || 0));
    if (Number(plan.horizonEndsAtSeconds) <= now) return true;
    return (plan.steps || []).some((row) => row.autopilot === true && clean(row.status) === "planned" && Number(row.dueAtSeconds) <= now);
  }
  function followingOwnScheduleBlock(actor, nowSeconds) {
    const plan = actor?.privateState?.lifePlanState;
    if (!prioritizeEvidenceWakes || clean(plan?.source) !== "day_schedule" || Number(plan.horizonEndsAtSeconds) <= nowSeconds) return false;
    return (plan.steps || []).some((row) => row.autopilot === true && ["planned", "in_progress"].includes(clean(row.status))
      && Number(row.dueAtSeconds) <= nowSeconds && Number(row.endsAtSeconds) > nowSeconds);
  }
  function resumeForOwnSchedule(actor) {
    if (actor?.executionControl?.status !== "stalled" || !ownScheduleDue(actor)) return;
    const control = actor.executionControl;
    control.resumedFrom = clone(control.reason);
    control.status = "active"; control.reason = null; control.waiting = null;
    control.repeatedCount = 0; control.waitTimeouts = 0; control.waitedSecondsWithoutChange = 0;
    control.passiveHistory = []; control.passiveRevisits = 0;
    control.reviewPending = false; control.reviewCompleted = false; control.lastWaitResolution = null;
  }

  function actorRunnable(actor) {
    if (ended.has(actor.characterId)) return false;
    if (isAsleep(coordinator.worldState.entities?.[actor.characterId])) return false;
    if (actor.executionControl?.status !== "active") return false;
    if (actor.pendingTurn || actor.inFlightWake) return true;
    const wait = actor.executionControl?.waiting;
    return !wait || actor.mailbox.some(wake => waitMatchesWake(wait, wake));
  }

  async function scheduleWaitDeadlines() {
    const now = Number(coordinator.worldState.nowSeconds || 0);
    for (const actor of actorById.values()) {
      const wait = actor.executionControl?.waiting;
      if (!wait || actor.executionControl.status !== "active") continue;
      const ready = wait.condition === "own_process_ready" && (coordinator.worldState.processes || []).some(row => wait.processIds.includes(row.id) && row.status === "ready");
      if (wait.deadlineSeconds > now && !ready) continue;
      await enqueueWake(actor.characterId, { wakeId: `wake:wait:${wait.registeredByAttemptId}`, kind: "wait_deadline",
        causeType: ready ? "owned_process_ready" : "wait_deadline", evidenceIds: [], evidence: [], occurredAtSeconds: now });
    }
  }

  function nextWaitDeadline() {
    const deadlines = [...actorById.values()].filter(actor => actor.executionControl?.status === "active")
      .map(actor => actor.executionControl?.waiting?.deadlineSeconds).filter(Number.isFinite);
    return deadlines.length ? Math.min(...deadlines) : null;
  }

  function dueOwnedReflectionOpportunity(actor) {
    const opportunity = actor?.privateState?.reflectionState?.pendingOpportunity;
    if (!opportunity || clean(opportunity.status) !== "due") return null;
    if (clean(opportunity.ownerCharacterId) !== clean(actor?.characterId)) return null;
    const dueAtSeconds = Math.max(0, Number(opportunity.dueAtSeconds || 0));
    const nowSeconds = Math.max(0, Number(coordinator.worldState.nowSeconds || 0));
    if (dueAtSeconds > nowSeconds) return null;
    const minInterval = Number(coordinator.worldState.timePolicy?.reflectionMinIntervalSeconds || 0);
    const lastSettled = Number(actor.privateState.reflectionState?.completedOpportunities?.at(-1)?.settledAtSeconds ?? 0);
    if (minInterval > 0 && !opportunity.executionReviewReason && nowSeconds - lastSettled < minInterval) return null;
    // A town resident in the middle of a block of their own written schedule
    // has already thought the day through; an idle reflection waits until
    // the schedule leaves them without a block of their own.
    if (!opportunity.executionReviewReason && followingOwnScheduleBlock(actor, nowSeconds)) return null;
    const ownsActiveContinuousProcess = (coordinator.worldState.processes || []).some((row) => (
      clean(row.ownerActorId) === clean(actor.characterId)
      && clean(row.status) === "active"
      && clean(row.attentionMode) === "continuous_work"
    ));
    return ownsActiveContinuousProcess ? null : opportunity;
  }

  async function scheduleDueOwnedReflections() {
    for (const actor of actorById.values()) {
      const opportunity = dueOwnedReflectionOpportunity(actor);
      if (!opportunity) continue;
      const opportunityId = clean(opportunity.opportunityId);
      await enqueueWake(actor.characterId, {
        wakeId: `wake:reflection:${actor.characterId}:${opportunityId}`,
        kind: "reflection_due",
        causeType: "reflection_due",
        reflectionOpportunityId: opportunityId,
        executionReview: Boolean(opportunity.executionReviewReason),
        evidenceIds: [],
        evidence: [],
      });
    }
  }

  function dueOwnedDayPlanning(actor) {
    if (!enableDayPlanning) return null;
    // Coarse planning is an idle-time opportunity. It must never overtake an
    // explicit bootstrap wake, newly delivered evidence, or work the Character
    // has already queued for consideration.
    if ((actor?.mailbox || []).length && actor.turnSequence === 0) return null;
    if (actor.executionControl?.waiting || actor.executionControl?.status !== "active") return null;
    const nowSeconds = Math.max(0, Number(coordinator.worldState.nowSeconds || 0));
    const lifePlanState = actor?.privateState?.lifePlanState;
    const ownsCurrentPlan = clean(lifePlanState?.ownerCharacterId) === clean(actor?.characterId)
      && clean(lifePlanState?.status || "active") === "active";
    const horizonEndsAtSeconds = Number(lifePlanState?.horizonEndsAtSeconds);
    if (ownsCurrentPlan && Number.isFinite(horizonEndsAtSeconds) && horizonEndsAtSeconds > nowSeconds) return null;
    return {
      dayIndex: Math.floor(nowSeconds / 86_400),
      nowSeconds,
      previousPlanId: clean(lifePlanState?.planId),
      previousRevision: Math.max(0, Math.floor(Number(lifePlanState?.revision || 0))),
    };
  }

  async function scheduleDueOwnedDayPlanning() {
    for (const actor of actorById.values()) {
      resumeForOwnSchedule(actor);
      const due = dueOwnedDayPlanning(actor);
      if (!due) continue;
      await enqueueWake(actor.characterId, {
        wakeId: `wake:day-planning:${actor.characterId}:day=${due.dayIndex}:revision=${due.previousRevision + 1}`,
        kind: "day_planning_due",
        causeType: "day_planning_due",
        dayIndex: due.dayIndex,
        previousPlanId: due.previousPlanId,
        evidenceIds: [],
        evidence: [],
      });
    }
  }

  async function scheduleDueOwnedContinuations() {
    for (const actor of actorById.values()) {
      resumeForOwnSchedule(actor);
      const timedPlanSteps = dueCharacterOwnedPlanSteps(
        actor.privateState,
        coordinator.worldState.nowSeconds,
      );
      if (timedPlanSteps.length) {
        const planStepRefs = timedPlanSteps.map((row) => ({
          referenceId: clean(row.referenceId),
          planStepId: clean(row.planStepId),
          revision: clean(row.revision),
          dueAtSeconds: Math.max(0, Number(row.dueAtSeconds || 0)),
        })).sort((left, right) => left.referenceId.localeCompare(right.referenceId));
        const ids = planStepRefs.map((row) => row.planStepId);
        await enqueueWake(actor.characterId, {
          wakeId: `wake:plan-due:${actor.characterId}:${planStepRefs.map((row) => row.referenceId).join("+")}`,
          kind: "continuation_due",
          causeType: "plan_due",
          evidenceIds: [],
          evidence: [],
          planStepIds: ids,
          planStepRefs,
          continuationIntentionIds: ids,
        });
      }
      const due = activeContinuationIntentions(actor)
        .filter((row) => clean(row.triggerType) !== "elapsed_without_progress")
        .filter((row) => continuationCanWakeWithoutNewEvidence(row, actor));
      if (!due.length) continue;
      const ids = due.map((row) => clean(row.intentionId)).sort();
      const wakeId = `wake:continuation:${actor.characterId}:${ids.join("+")}`;
      await enqueueWake(actor.characterId, {
        wakeId,
        kind: "continuation_due",
        evidenceIds: [],
        evidence: [],
        continuationIntentionIds: ids,
      });
    }
  }

  function nextOwnedPlanDeadline() {
    const nowSeconds = Math.max(0, Number(coordinator.worldState.nowSeconds || 0));
    const deadlines = [...actorById.values()]
      .filter(actor => (actor.executionControl.status === "active"
        || (prioritizeEvidenceWakes && actor.executionControl.status === "stalled" && clean(actor.privateState?.lifePlanState?.source) === "day_schedule"))
        && !actor.executionControl.waiting)
      .map((actor) => nextCharacterOwnedPlanDueAtSeconds(actor.privateState, nowSeconds))
      .filter((value) => value != null && Number.isFinite(Number(value)));
    return deadlines.length ? Math.min(...deadlines.map(Number)) : null;
  }

  function nextOwnedDayPlanningDeadline() {
    if (!enableDayPlanning) return null;
    const nowSeconds = Math.max(0, Number(coordinator.worldState.nowSeconds || 0));
    const deadlines = [...actorById.values()].flatMap((actor) => {
      const stalledTownResident = prioritizeEvidenceWakes && actor.executionControl.status === "stalled"
        && clean(actor.privateState?.lifePlanState?.source) === "day_schedule";
      if ((actor.executionControl.status !== "active" && !stalledTownResident) || actor.executionControl.waiting) return [];
      const state = actor?.privateState?.lifePlanState;
      if (clean(state?.ownerCharacterId) !== clean(actor?.characterId)
        || clean(state?.status || "active") !== "active") return [];
      const value = Number(state?.horizonEndsAtSeconds);
      return Number.isFinite(value) && value > nowSeconds ? [value] : [];
    });
    return deadlines.length ? Math.min(...deadlines) : null;
  }

  function registeredEvidenceIds(characterId, evidenceIds = []) {
    if (!(evidenceIds || []).map(clean).some(Boolean)) return [];
    return characterEventEvidenceRecords(ledger, characterId, evidenceIds)
      .filter((row) => ["delivered", "noticed"].includes(clean(row.status)))
      .map((row) => row.evidenceId);
  }

  function staleMailboxEvidenceIds(actor) {
    const ids = uniqueEvidenceIds((actor?.mailbox || [])
      .flatMap((wake) => wake?.evidenceIds || []));
    if (!ids.length) return [];
    const fresh = new Set(registeredEvidenceIds(actor.characterId, ids));
    return ids.filter((evidenceId) => !fresh.has(evidenceId));
  }

  function pruneStaleActorWakes() {
    for (const actor of actorById.values()) {
      if (typeof actor.prunePendingWakes !== "function") continue;
      actor.prunePendingWakes({
        activeWaitAttemptId: actor.executionControl?.waiting?.registeredByAttemptId || "",
        staleEvidenceIds: staleMailboxEvidenceIds(actor),
        activeContinuationIntentionIds: activeContinuationIntentions(actor)
          .map((row) => clean(row.intentionId))
          .filter(Boolean),
        activePlanStepReferenceIds: characterOwnedTimedPlanSteps(actor.privateState)
          .map((row) => clean(row.referenceId))
          .filter(Boolean),
        activeReflectionOpportunityIds: [
          clean(actor.privateState?.reflectionState?.pendingOpportunity?.status) === "due"
            ? clean(actor.privateState?.reflectionState?.pendingOpportunity?.opportunityId)
            : "",
        ].filter(Boolean),
      });
    }
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      const actor = actorById.get(queue[index]);
      if ((!(actor?.mailbox || []).length && !actor?.pendingTurn) || !actorRunnable(actor)) queue.splice(index, 1);
    }
  }

  function currentWakeBundle(actor) {
    if (actor?.pendingTurn) return clone(actor.pendingTurn.wake);
    if (actor?.inFlightWake) return clone(actor.inFlightWake);
    if (actor.executionControl?.waiting) {
      const index = actor.mailbox.findIndex(wake => waitMatchesWake(actor.executionControl.waiting, wake));
      if (index < 0) return null;
      const wait = actor.executionControl.waiting, wake = actor.mailbox[index];
      actor.executionControl.lastWaitResolution = {
        timedOut: (wake.causeType || wake.kind) === "wait_deadline",
        executionReview: wake.executionReview === true,
        elapsedSeconds: Math.max(0, Number(coordinator.worldState.nowSeconds || 0) - Number(wait.startedAtSeconds || 0)),
        materialUnchanged: wait.materialDigest === materialStateDigest(coordinator.worldState, actor.characterId),
        condition: wait.condition,
      };
      actor.mailbox.unshift(...actor.mailbox.splice(index, 1));
      actor.executionControl.waiting = null;
    }
    promoteDueMaintenance(actor);
    if (prioritizeEvidenceWakes) {
      // In a town, anything new that reached this person is answered before a
      // block of their own schedule is carried out for them.
      const index = (actor.mailbox || []).findIndex((wake) => ["world_evidence", "new_external_impact"].includes(clean(wake.kind || wake.causeType)));
      if (index > 0) actor.mailbox.unshift(...actor.mailbox.splice(index, 1));
    }
    const primary = actor?.mailbox?.[0];
    if (!primary) return null;
    const primaryKind = clean(primary.kind || primary.causeType);
    if (!["world_evidence", "new_external_impact"].includes(primaryKind)) return clone(primary);
    const sourceWakes = [];
    for (const wake of actor.mailbox || []) {
      const kind = clean(wake.kind || wake.causeType);
      if (!["world_evidence", "new_external_impact"].includes(kind)) break;
      sourceWakes.push(wake);
    }
    if (sourceWakes.length <= 1) return {
      ...clone(primary),
      sourceWakeIds: [clean(primary.wakeId)],
    };
    const evidenceById = new Map();
    for (const wake of sourceWakes) {
      for (const row of wake.evidence || []) {
        const evidenceId = clean(row?.evidenceId);
        if (evidenceId && !evidenceById.has(evidenceId)) evidenceById.set(evidenceId, clone(row));
      }
    }
    return {
      ...clone(primary),
      authority: "character-current-mailbox-bundle",
      sourceWakeIds: sourceWakes.map((wake) => clean(wake.wakeId)).filter(Boolean),
      sourceEventIds: [...new Set(sourceWakes.map((wake) => clean(wake.eventId)).filter(Boolean))],
      evidenceIds: uniqueEvidenceIds(sourceWakes.flatMap((wake) => wake.evidenceIds || [])),
      processIds: [...new Set(sourceWakes.flatMap((wake) => wake.processIds || []).map(clean).filter(Boolean))],
      evidence: [...evidenceById.values()],
      mergeRule: "Every still-fresh external delivery already queued at this world version is available to the same Character Agent thought opportunity; causal wake ids remain separate provenance.",
    };
  }

  async function enqueueWake(characterId, wake = {}) {
    if (ended.has(clean(characterId))) return false;
    // A sleeper gets no beat until something wakes them; waking is settled in the world first.
    if (isAsleep(coordinator.worldState.entities?.[clean(characterId)])) return false;
    const id = clean(characterId);
    const actor = actorById.get(id);
    if (!actor) throw fail("CHARACTER_WORLD_ACTOR_UNKNOWN", "Wake targets an unknown Character Actor.", { characterId: id });
    const normalized = { ...clone(wake), recipientCharacterId: id };
    const wakeKind = clean(normalized.kind || normalized.causeType);
    const wakeEvidenceIds = uniqueEvidenceIds(normalized.evidenceIds || []);
    const externalWakeId = clean(normalized.wakeId || normalized.id);
    if (["world_evidence", "new_external_impact"].includes(wakeKind) && wakeEvidenceIds.length && externalWakeId) {
      const reserved = reserveCharacterEvidenceWake(ledger, {
        characterId: id,
        evidenceIds: wakeEvidenceIds,
        wakeId: externalWakeId,
        step: coordinator.journal.worldVersion,
      });
      if (!reserved) return false;
    }
    const accepted = await actor.enqueueWake(normalized);
    if (accepted) queueActor(id);
    return accepted;
  }

  async function routeOutcomeDeliveries(outcome = {}) {
    // Whoever died in this settlement — the actor, someone they struck, someone the water took.
    for (const row of outcome.resolvedEffects || []) if (row.kind === "health_changed" && row.state === "dead") ended.add(clean(row.actorId));
    const grouped = new Map();
    // A compound action can produce both an outward signal and private
    // observation feedback. Give affected others their response opportunity
    // before waking the actor again from the actor's own evidence.
    const orderedDeliveries = (outcome.deliveries || [])
      .map((source, index) => ({ source, index }))
      .sort((left, right) => {
        const leftSelf = clean(left.source?.recipientCharacterId || left.source?.recipientId) === clean(outcome.actorId);
        const rightSelf = clean(right.source?.recipientCharacterId || right.source?.recipientId) === clean(outcome.actorId);
        return Number(leftSelf) - Number(rightSelf) || left.index - right.index;
      })
      .map((row) => row.source);
    for (const source of orderedDeliveries) {
      const recipientId = clean(source.recipientCharacterId || source.recipientId);
      if (!actorById.has(recipientId)) continue;
      const deliveryId = clean(source.deliveryId || source.id) || `delivery:${outcome.eventId}:${recipientId}:${grouped.get(recipientId)?.length || 0}`;
      const evidenceId = clean(source.evidenceId) || `evidence:${deliveryId}`;
      const delivery = {
        ...clone(source),
        id: deliveryId,
        deliveryId,
        objectiveEventId: outcome.eventId,
        eventId: outcome.eventId,
        recipientId,
        characterId: recipientId,
        evidenceId,
      };
      registerCharacterEventDelivery(ledger, delivery, {
        deliveredAtSeconds: coordinator.worldState.nowSeconds,
        step: outcome.worldVersion,
      });
      const immediateSelfSensoryResult = recipientId === clean(outcome.actorId)
        && ["observation_result", "listening_result", "own_action_result"].includes(clean(delivery.eventKind));
      const actorRequestsImmediateReappraisal = immediateSelfSensoryResult
        && activeContinuationIntentions(actorById.get(recipientId))
          .some((row) => ["new_relevant_evidence", "target_response"].includes(clean(row.triggerType)));
      // The result of an intentional look/listen is part of that embodied
      // beat. Keep it on the objective outcome for the Actor's private reducer,
      // but do not automatically spend another full thought on it. A character
      // can explicitly retain an immediate-evidence continuation when needed.
      if (immediateSelfSensoryResult && !actorRequestsImmediateReappraisal) continue;
      const rows = grouped.get(recipientId) || [];
      rows.push(delivery);
      grouped.set(recipientId, rows);
    }
    const ambientQuiet = coordinator.worldState.timePolicy?.ambientGesturesWake === false;
    const zoneOf = (id) => clean(coordinator.worldState.entities?.[clean(id)]?.zoneId);
    // A passing glance, someone settling down to rest, or a small handling seen
    // from another room is perceived, but by itself it is not a reason to stop
    // and think again. Speech, movement, anything aimed at the recipient and
    // world deadlines always reach them as a new opportunity.
    const peripheral = (row, recipientId) => {
      if (row.directed === true || row.urgent === true) return false;
      const kind = clean(row.eventKind);
      if (["gesture", "actor_resting"].includes(kind)) return true;
      if (kind === "speech" || !clean(row.sourceCharacterId)) return false;
      if (kind === "movement") {
        if (coordinator.worldState.timePolicy?.bystanderMovementWakes === false) return true;
        const step = (outcome.resolvedEffects || []).find((effect) => clean(effect?.kind) === "actor_movement");
        return Boolean(step && zoneOf(recipientId) && ![clean(step.fromZoneId), clean(step.toZoneId)].includes(zoneOf(recipientId)));
      }
      if ([row.targetCharacterId, row.toCharacterId, row.receiverCharacterId].map(clean).includes(recipientId)) return false;
      return Boolean(zoneOf(row.sourceCharacterId) && zoneOf(recipientId) && zoneOf(row.sourceCharacterId) !== zoneOf(recipientId));
    };
    for (const [recipientId, deliveries] of grouped) {
      const recipient = actorById.get(recipientId);
      if (ambientQuiet && deliveries.every((row) => peripheral(row, recipientId))) continue;
      const accepted = await enqueueWake(recipientId, {
        wakeId: `wake:${outcome.eventId}:${recipientId}`,
        kind: "world_evidence",
        eventId: outcome.eventId,
        evidenceIds: deliveries.map((row) => row.evidenceId),
        processIds: [...new Set(deliveries.map((row) => clean(row.processId)).filter(Boolean))],
        evidence: deliveries.map((row) => ({
          evidenceId: row.evidenceId,
          eventId: outcome.eventId,
          objectiveEventId: outcome.eventId,
          eventKind: row.eventKind,
          modality: row.modality,
          sourceCharacterId: row.sourceCharacterId,
          perceivedSourceCharacterId: row.perceivedSourceCharacterId,
          sourceEntityHandle: row.sourceEntityHandle,
          identityKnown: row.identityKnown,
          sourceObjectId: row.sourceObjectId,
          signalId: row.signalId,
          processId: row.processId,
          content: row.content,
          topic: row.topic,
          directed: row.directed,
          speechAct: row.speechAct,
          speechFunctions: clone(row.speechFunctions || []),
          vocalMode: row.vocalMode,
          receivedIntensity: row.receivedIntensity,
          personalRelevance: row.personalRelevance,
          distance: row.distance,
          barriers: clone(row.barriers || []),
          semanticFrame: clone(row.semanticFrame || {}),
          provenance: clone(row.provenance || {}),
          encodingContext: clone(row.encodingContext || null),
          observableAffectiveTexture: clone(row.observableAffectiveTexture || []),
          occurredAtSeconds: Number(row.occurredAtSeconds ?? coordinator.worldState.nowSeconds ?? 0),
          urgent: row.urgent === true,
        })),
      });
      // Receipt deduplication must succeed before a repeated delivery can
      // release a stalled actor. A replay is not a new fact.
      if (accepted && recipient?.executionControl.status === "stalled" && deliveries.some(row =>
        (row.eventKind === "speech" ? row.directed === true : isExecutionProgressEvidence(row))
        && row.sourceCharacterId !== recipientId)) {
        const control = recipient.executionControl;
        control.resumedFrom = clone(control.reason);
        control.status = "active"; control.reason = null; control.waiting = null;
        control.repeatedCount = 0; control.waitTimeouts = 0; control.waitedSecondsWithoutChange = 0;
        // A direct address gives another decision opportunity, not proof that
        // the character's repeated passive actions made physical progress.
        if (deliveries.some(isExecutionProgressEvidence)) {
          control.passiveHistory = []; control.passiveRevisits = 0;
          control.failureHistory = []; control.failureRevisits = 0;
          control.reviewPending = false; control.reviewCompleted = false;
        }
        control.lastWaitResolution = null;
        queueActor(recipientId);
      }
    }
  }

  async function materializeWorldProcessReadiness({ allowTimeAdvance = false } = {}) {
    if (typeof coordinator.advanceWorldProcesses !== "function") return null;
    const processOutcome = await coordinator.advanceWorldProcesses({ allowTimeAdvance });
    if (processOutcome) await routeOutcomeDeliveries(processOutcome);
    const temporalOutcome = await coordinator.advanceWorldTemporalAgenda?.();
    if (temporalOutcome) await routeOutcomeDeliveries(temporalOutcome);
    return processOutcome;
  }

  function unfinishedActorId() {
    return [...actorById.values()].find(actor => actor.executionControl.status === "active"
      && (actor.pendingTurn || actor.inFlightWake))?.characterId || "";
  }

  function integrityIssue() {
    return assessSimulationIntegrity({ actors: actorById.values(), records: [...completedRecords.values()] });
  }

  async function runNext({ characterId = "", notAfterSeconds = null } = {}) {
    throwSimulationIntegrityIssue(integrityIssue());
    const requestedHorizon = notAfterSeconds != null && Number.isFinite(Number(notAfterSeconds))
      ? Math.max(0, Number(notAfterSeconds))
      : null;
    const beforeRequestedHorizon = () => requestedHorizon == null
      || Math.max(0, Number(coordinator.worldState.nowSeconds || 0)) < requestedHorizon;
    await materializeWorldProcessReadiness({ allowTimeAdvance: false });
    await scheduleWaitDeadlines();
    pruneStaleActorWakes();
    await scheduleDueOwnedDayPlanning();
    await scheduleDueOwnedReflections();
    await scheduleDueOwnedContinuations();
    pruneStaleActorWakes();
    while (!queue.length) {
      // Draining wakes at a boundary may leave only sleeping actors. A later
      // deadline belongs to the next run, including after checkpoint restore.
      if (!beforeRequestedHorizon()) return null;
      const planDeadline = nextOwnedPlanDeadline();
      const dayPlanningDeadline = nextOwnedDayPlanningDeadline();
      const nowSeconds = Math.max(0, Number(coordinator.worldState.nowSeconds || 0));
      const beforeVersion = coordinator.journal.worldVersion;
      const horizon = requestedHorizon == null ? null : Math.max(nowSeconds, requestedHorizon);
      const nextBoundary = [planDeadline, dayPlanningDeadline, nextWaitDeadline(), nextWorldTemporalBoundary(coordinator.worldState), horizon]
        .filter((value) => value != null && Number(value) > nowSeconds)
        .sort((left, right) => Number(left) - Number(right))[0] ?? null;
      if (nextBoundary != null && typeof coordinator.advanceWorldClockTo === "function") {
        const boundaryOutcome = await coordinator.advanceWorldClockTo({ targetSeconds: nextBoundary });
        if (boundaryOutcome) await routeOutcomeDeliveries(boundaryOutcome);
      } else if (horizon == null) {
        await materializeWorldProcessReadiness({ allowTimeAdvance: true });
      }
      // A process and a public deadline can share the same timestamp. Both
      // facts must be settled before any actor reacts at that boundary.
      await materializeWorldProcessReadiness({ allowTimeAdvance: false });
      await scheduleWaitDeadlines();
      pruneStaleActorWakes();
      await scheduleDueOwnedDayPlanning();
      await scheduleDueOwnedReflections();
      await scheduleDueOwnedContinuations();
      pruneStaleActorWakes();
      // An objective boundary may have no recipient who needs a new thought.
      // Continue to the next real boundary rather than declaring the run idle
      // while a later deadline or process is still scheduled.
      if (coordinator.journal.worldVersion === beforeVersion
        && Number(coordinator.worldState.nowSeconds || 0) <= nowSeconds) break;
    }
    let id = clean(characterId);
    if (!beforeRequestedHorizon()) {
      // A requested stop time must not change causal scheduling. Keep every
      // due wake queued and finish only an already-started turn/outbox.
      const unfinishedId = unfinishedActorId();
      if (!unfinishedId || (id && id !== unfinishedId)) return null;
      id = unfinishedId;
    }
    if (id) {
      const index = queue.indexOf(id);
      if (index >= 0) queue.splice(index, 1);
    } else {
      // A saved, partially executed turn owns its original wake. Resume that
      // transaction before newly scheduled planning for a different actor.
      id = unfinishedActorId() || queue[0] || "";
      const index = queue.indexOf(id);
      if (index >= 0) queue.splice(index, 1);
    }
    if (!id) return null;
    const actor = actorById.get(id);
    if (!actor || !actorRunnable(actor)) return null;
    const wake = currentWakeBundle(actor);
    if (!wake) return null;
    const retainedSelfEvidenceIds = (actor.privateState?.retainedImmediateSelfEvidence || [])
      .map((row) => clean(row?.evidenceId))
      .filter(Boolean);
    const evidenceIds = actor.pendingTurn?.receiptEvidenceIds ?? actor.inFlightReceiptEvidenceIds ?? registeredEvidenceIds(id, [
      ...(wake.evidenceIds || []),
      ...retainedSelfEvidenceIds,
    ]);
    try {
      const beforeMaterial = materialStateDigest(coordinator.worldState, id);
      const beforeBody = clone(actor.privateState.ecologyState?.body || {});
      const projection = await situationProjector({
        worldState: coordinator.worldState,
        worldVersion: coordinator.journal.worldVersion,
        characterId: id,
        wake: clone(wake),
      });
      projection.ownTimeExperience = { lastWait: clone(actor.executionControl.lastWaitResolution),
        repeatedWaitTimeouts: actor.executionControl.waitTimeouts, waitedSecondsWithoutChange: actor.executionControl.waitedSecondsWithoutChange,
        passiveRevisitsWithoutProgress: actor.executionControl.passiveRevisits,
        executionReviewPending: actor.executionControl.reviewPending };
      const turn = await actor.runNextTurn({
        worldVersion: coordinator.journal.worldVersion,
        situationProjection: projection,
        wakeBundle: wake,
        retainPendingTurn: true,
        receiptEvidenceIds: evidenceIds,
      });
      if (!turn) return null;
      await persistExecution("world_attempt_prepared", turn.agentTurnId);
      // Attention and appraisal are consequences of the Character Agent turn,
      // not of the later objective action result. Settle them first so a world
      // resolver failure cannot erase or repeat a thought that already happened.
      if (!actor.pendingTurn?.receiptsSettled) {
        if (turn.privateResult?.evidencePresentation) recordCharacterEvidencePresentation(ledger, {
          ...turn.privateResult.evidencePresentation, characterId: id, agentTurnId: turn.agentTurnId, step: coordinator.journal.worldVersion,
        });
        applyAgentEvidenceReceiptSettlement(ledger, turn, evidenceIds, coordinator.journal.worldVersion);
        if (actor.pendingTurn) actor.pendingTurn.receiptsSettled = true;
      }
      pruneStaleActorWakes();
      let outcome = null;
      if (turn.actionAttempt) {
        outcome = await coordinator.submitActionAttempt(turn.actionAttempt);
        await persistExecution("world_outcome_committed", turn.agentTurnId);
        await actor.applyWorldOutcome(outcome);
        recordExecutionProgress(actor, { ...turn, outcome }, { beforeMaterial,
          beforeBody, afterMaterial: materialStateDigest(coordinator.worldState, id), nowSeconds: coordinator.worldState.nowSeconds,
          repeatedWaitReviewLimit: coordinator.worldState.timePolicy?.repeatedWaitReviewLimit || 0 });
        await routeOutcomeDeliveries(outcome);
        await enqueueOwnedActionSettlementContinuation(actor, outcome);
        await materializeWorldProcessReadiness({ allowTimeAdvance: false });
      } else {
        recordExecutionProgress(actor, turn, { beforeMaterial, afterMaterial: beforeMaterial, nowSeconds: coordinator.worldState.nowSeconds,
          repeatedWaitReviewLimit: coordinator.worldState.timePolicy?.repeatedWaitReviewLimit || 0 });
        if (turn.privateResult?.turnKind === "reflection" && actor.executionControl.reviewCompleted && (actor.executionControl.waitTimeouts > 0 || actor.executionControl.passiveRevisits >= 3)) {
          await enqueueWake(id, { wakeId: `wake:review-completed:${turn.agentTurnId}`, kind: "continuation_due", causeType: "execution_review_completed", evidenceIds: [], evidence: [] });
        }
      }
      await scheduleDueOwnedDayPlanning();
      await scheduleDueOwnedContinuations();
      await scheduleDueOwnedReflections();
      recordMaintenanceOpportunity(actor, turn);
      if (actor.mailbox.length) queueActor(id);
      const record = { agentTurnId: turn.agentTurnId, characterId: turn.characterId,
        publicSummary: compactSettledTurnRecord({ ...turn, outcome }, { characterName: coordinator.worldState.entities?.[id]?.name || id }),
        turnKind: clean(turn.privateResult?.turnKind || "action"), wakeKind: clean(turn.wake?.kind),
        actionAttemptId: turn.actionAttempt?.attemptId || "", outcomeId: outcome?.outcomeId || "", eventId: outcome?.eventId || "",
        worldVersion: outcome?.worldVersion ?? coordinator.journal.worldVersion,
        occurredAtSeconds: Number(coordinator.worldState.nowSeconds || 0) };
      completedRecords.set(turn.agentTurnId, record);
      const pendingTurn = actor.pendingTurn;
      actor.pendingTurn = null;
      if (actor.handle && actor.runtimePort.finalizeTurn) await actor.runtimePort.finalizeTurn(actor.handle, turn.agentTurnId);
      try { await persistExecution("turn_finalized", turn.agentTurnId); }
      catch (error) { actor.pendingTurn = pendingTurn; throw error; }
      return { ...turn, outcome };
    } catch (error) {
      if (error.code === "CHARACTER_MODEL_SUSPENDED") {
        actor.executionControl.status = "suspended_model_error";
        actor.executionControl.reason = { code: error.code, message: error.message, agentTurnId: actor.inFlightWake ? `agent-turn:${id}:${actor.turnSequence + 1}` : "" };
        await persistExecution("suspended_model_error", actor.executionControl.reason.agentTurnId);
        throwSimulationIntegrityIssue(integrityIssue());
        return null;
      }
      queueActor(id);
      throw error;
    }
  }

  async function runUntilIdle({ maxTurns = 100 } = {}) {
    const results = [];
    const limit = Math.max(0, Math.floor(Number(maxTurns || 0)));
    while (results.length < limit) {
      const result = await runNext();
      if (!result) break;
      results.push(result);
    }
    return results;
  }

  async function runUntilWorldTime({ targetSeconds, maxTurns = 1000 } = {}) {
    const target = Number(targetSeconds);
    if (!Number.isFinite(target) || target < 0) {
      throw fail("CHARACTER_WORLD_TIME_TARGET_INVALID", "A finite non-negative world-time target is required.", {
        targetSeconds,
      });
    }
    const results = [];
    const limit = Math.max(0, Math.floor(Number(maxTurns || 0)));
    let stalled = false;
    while (results.length < limit) {
      const nowSeconds = Math.max(0, Number(coordinator.worldState.nowSeconds || 0));
      if (nowSeconds >= target && !unfinishedActorId()) break;
      const result = await runNext({ notAfterSeconds: target });
      if (!result) {
        if (Math.max(0, Number(coordinator.worldState.nowSeconds || 0)) < target) stalled = true;
        break;
      }
      results.push(result);
    }
    const reachedTarget = Math.max(0, Number(coordinator.worldState.nowSeconds || 0)) >= target;
    const endedByTurnLimit = results.length >= limit && (!reachedTarget || Boolean(unfinishedActorId()));
    return {
      turns: results,
      targetSeconds: target,
      nowSeconds: Math.max(0, Number(coordinator.worldState.nowSeconds || 0)),
      reachedTarget,
      endedByTurnLimit,
      stalled: stalled && !reachedTarget,
    };
  }

  return {
    schemaVersion: CHARACTER_WORLD_RUNTIME_VERSION,
    coordinator,
    actors: actorById,
    receiptLedger: ledger,
    get executionStatus() {
      const states = [...actorById.values()].map(actor => ({ characterId: actor.characterId, ...clone(actor.executionControl) }));
      const runningTurn = [...actorById.values()].some(actor => actor.executionControl.status === "active" && (actor.activeTurnId || actor.pendingTurn));
      const integrity = integrityIssue();
      return { integrity, status: integrity?.stopReason || (queue.length || runningTurn ? "running" : states.some(row => row.status === "suspended_model_error") ? "suspended_model_error"
        : states.some(row => row.status === "stalled") ? "stalled" : "waiting"), actors: states };
    },
    get readyQueue() { return [...queue]; },
    enqueueWake,
    /** A player world event (天意): settled by the world, delivered to whoever perceives it. */
    async applyWorldEvent(event = {}) {
      if (typeof coordinator.applyWorldEvent !== "function") throw fail("WORLD_EVENT_UNSUPPORTED", "This world cannot settle world events.");
      const outcome = await coordinator.applyWorldEvent(event);
      await routeOutcomeDeliveries(outcome);
      return outcome;
    },
    scheduleDueOwnedContinuations,
    scheduleDueOwnedReflections,
    scheduleDueOwnedDayPlanning,
    runNext,
    runUntilIdle,
    runUntilWorldTime,
    async checkpoint() {
      const actorCheckpoints = [];
      for (const actor of actorById.values()) actorCheckpoints.push(await actor.checkpoint());
      return {
        schemaVersion: CHARACTER_WORLD_RUNTIME_VERSION,
        coordinator: coordinator.checkpoint(),
        actors: actorCheckpoints,
        receiptLedger: clone(ledger),
        readyQueue: [...queue],
        completedTurnRecords: [...completedRecords.values()].map(clone),
      };
    },
  };
}
