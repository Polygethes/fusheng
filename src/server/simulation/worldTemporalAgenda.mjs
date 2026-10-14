// Host-authored deadlines describe world obligations, never a Character's
// decision or an invented response. Private appraisal remains with the owner.
import { nextWorldEnvironmentBoundary } from "./worldEnvironmentEvents.mjs";
import { nextLifeBoundary } from "./lifeCycle.mjs";
import { nextWakeBoundary } from "./sleep.mjs";
const copy = value => structuredClone(value);
const now = state => Math.max(0, Number(state.nowSeconds || 0));
const finished = row => ["fulfilled", "fulfilled_late"].includes(row.status);

function conditionMet(state, condition) {
  const kind = condition.kind || "object_state";
  if (kind === "object_holder") return String(state.objects?.[condition.objectId]?.holderCharacterId || "") === condition.holderId;
  if (kind === "actor_zone") {
    const actor = state.entities?.[condition.actorId];
    return Boolean(actor && actor.present !== false && actor.zoneId === condition.zoneId);
  }
  const value = state.objects?.[condition.objectId]?.state?.[condition.stateKey];
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  return typeof condition.maximum === "number" ? value <= condition.maximum : value >= condition.minimum;
}

// A private arrangement is not a public announcement: when a deadline names
// who knows it, nobody else sees it or is reminded of it.
const knows = (row, actorId) => !Array.isArray(row.knownByActorIds) || row.knownByActorIds.includes(actorId);

// Whether this person could see if a condition currently holds.
function conditionObservable(condition, actor, visible) {
  if ((condition.kind || "object_state") === "actor_zone") return condition.actorId === actor.id || actor.zoneId === condition.zoneId;
  return visible.has(condition.objectId);
}

export function nextWorldTemporalBoundary(state = {}) {
  const times = (state.temporalAgenda || []).flatMap(row => {
    if (finished(row) || row.status === "overdue") return [];
    return [!row.warned ? row.warningAtSeconds : null, row.dueAtSeconds]
      .filter(value => Number.isFinite(value) && value > now(state));
  });
  const environmentAt = nextWorldEnvironmentBoundary(state);
  const lifeAt = nextLifeBoundary(state);
  const wakeAt = nextWakeBoundary(state);
  const all = [...times, ...(environmentAt != null ? [environmentAt] : []), ...(lifeAt != null ? [lifeAt] : []), ...(wakeAt != null ? [wakeAt] : [])];
  return all.length ? Math.min(...all) : null;
}

export function resolveWorldTemporalAgenda(state = {}) {
  const agenda = copy(state.temporalAgenda || []), changes = [];
  for (const row of agenda) {
    if (finished(row)) continue;
    const met = Boolean(row.conditions?.length && row.conditions.every(condition => conditionMet(state, condition)));
    const previouslyMet = Number.isFinite(row.conditionsSatisfiedAtSeconds);
    if (met && !previouslyMet) row.conditionsSatisfiedAtSeconds = now(state);
    if (!met && previouslyMet) row.conditionsSatisfiedAtSeconds = null;
    let kind = "";
    if (met && now(state) >= row.dueAtSeconds) {
      row.status = row.conditionsSatisfiedAtSeconds > row.dueAtSeconds || row.status === "overdue" ? "fulfilled_late" : "fulfilled";
      row.resolvedAtSeconds = Math.max(row.dueAtSeconds, row.conditionsSatisfiedAtSeconds);
      kind = "world_deadline_fulfilled";
    } else if (row.status !== "overdue" && now(state) >= row.dueAtSeconds) {
      row.status = "overdue";
      kind = "world_deadline_due";
    } else if (row.status !== "overdue" && !met && !row.warned && now(state) >= row.warningAtSeconds) {
      row.warned = true;
      kind = "world_deadline_warning";
    }
    // Readiness can change before the deadline. Preserve its actual time,
    // but keep checking the resources until due instead of finalizing early.
    if (!kind && met !== previouslyMet) kind = "world_deadline_readiness_changed";
    if (kind) changes.push({ kind, deadline: copy(row) });
  }
  return { agenda, changes };
}

export function temporalDeadlineDeliveries(state, { kind, deadline }, eventId) {
  // Completion of hidden resources is not a magical announcement to people
  // elsewhere. Their ordinary perception supplies those material facts.
  if (!["world_deadline_warning", "world_deadline_due"].includes(kind)) return [];
  return Object.values(state.entities || {}).filter(actor => actor.kind === "character" && actor.present !== false
    && actor.placeId === deadline.placeId && knows(deadline, actor.id))
    .map(actor => ({ deliveryId: `delivery:${eventId}:${deadline.id}:${actor.id}`, recipientCharacterId: actor.id,
      eventKind: kind, modality: "temporal", directed: true, urgent: true, occurredAtSeconds: now(state),
      content: kind === "world_deadline_warning"
        ? `${deadline.label}的约定时限还有 ${Math.max(0, deadline.dueAtSeconds - now(state))} 秒；继续等待也会用去这段时间。`
        : `${deadline.label}的约定时限已到；是否办妥须以本人实际所见为准，不能因为已经答应就当作完成。` }));
}

export function projectWorldTemporalContext(state, actor, visibleObjectIds = []) {
  const visible = new Set(visibleObjectIds);
  return { nowSeconds: now(state), pacingMode: state.timePolicy?.mode || "day",
    deadlines: (state.temporalAgenda || []).filter(row => row.placeId === actor.placeId && knows(row, actor.id)).map(row => {
      const known = row.conditions?.length && row.conditions.every(condition => conditionObservable(condition, actor, visible));
      return { id: row.id, label: row.label, dueAtSeconds: row.dueAtSeconds,
        remainingSeconds: Math.max(0, row.dueAtSeconds - now(state)), elapsedAfterDeadlineSeconds: Math.max(0, now(state) - row.dueAtSeconds),
        timeStatus: now(state) >= row.dueAtSeconds ? "elapsed" : "upcoming",
        personallyResponsible: (row.responsibleActorIds || []).includes(actor.id),
        knownCompletion: known ? row.conditions.every(condition => conditionMet(state, condition)) : null,
        delayConsequence: row.delayConsequence, source: row.source };
    }),
    decisionAuthority: "character-agent", selection: null };
}
