// Following one's own plan (spec §9.3). When a block of a town resident's
// written schedule comes due — or the last step of it has just settled, or
// a walk they chose is still under way — and nothing new has reached them,
// the world carries out the next step of what they themselves decided: one
// hop of the walk, starting the job, or settling in to rest or sleep. Any
// new evidence, a deadline of theirs close at hand, a conversation they are
// in, or a block that needs them (a visit, a job that cannot start) hands
// the next beat back to the character.

export const OWN_PLAN_STEP_TURN_KIND = "own_plan_step";
export const OWN_PLAN_STEP_VERSION = "character-own-plan-step-v1";
export const OWN_PLAN_INTENTION_PREFIX = "own-plan-step:";
export const OWN_WALK_INTENTION_PREFIX = "own-walk:";
const NEAR_DEADLINE_SECONDS = 1800;
const CONVERSATION_WINDOW_SECONDS = 180;

const clean = (value) => String(value ?? "").trim();
const list = (value) => (Array.isArray(value) ? value : []);
const siteOf = (zoneId) => { const id = clean(zoneId); return id.includes("__") ? id.split("__")[0] : id; };

/** First hop of the shortest walk between two zones, or "" when there is none. */
export function nextHop(zoneEdges = [], fromZoneId = "", toZoneId = "") {
  const from = clean(fromZoneId), to = clean(toZoneId);
  if (!from || !to || from === to) return "";
  const previous = new Map([[from, null]]);
  const queue = [from];
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    if (current === to) break;
    for (const [a, b] of list(zoneEdges)) {
      const next = a === current ? b : b === current ? a : "";
      if (next && !previous.has(next)) { previous.set(next, current); queue.push(next); }
    }
  }
  if (!previous.has(to)) return "";
  let hop = to;
  while (previous.get(hop) !== from) hop = previous.get(hop);
  return hop;
}

function handsBack({ wake = {}, deadlines = [], recentTurns = [], selfId = "", nowSeconds = 0 }) {
  if (list(wake.evidenceIds).length || list(wake.evidence).length || wake.hasPendingEvidence === true) return true;
  if (list(deadlines).some((row) => row.personallyResponsible && clean(row.timeStatus) !== "elapsed"
    && !["fulfilled", "met"].includes(clean(row.status)) && Number(row.remainingSeconds) <= NEAR_DEADLINE_SECONDS)) return true;
  return list(recentTurns).some((row) => Number(row.occurredAtSeconds || 0) >= Number(nowSeconds) - CONVERSATION_WINDOW_SECONDS
    && (clean(row.speakerId) === clean(selfId) || clean(row.addresseeId) === clean(selfId)));
}

/**
 * What, if anything, the world does next on the character's behalf.
 * Returns null (the character takes a real beat), or one of
 * { kind: "walk" | "start_work" | "settle" | "handover", … }.
 */
export function ownPlanStepDecision({ wake = {}, lifePlanState = null, continuationIntentions = [], hereZoneId = "", zoneEdges = [],
  deadlines = [], recentTurns = [], selfId = "", nowSeconds = 0, startableWorkTemplateIds = [] } = {}) {
  if (handsBack({ wake, deadlines, recentTurns, selfId, nowSeconds })) return null;
  const cause = clean(wake.causeType || wake.kind);
  const here = clean(hereZoneId);
  const now = Number(nowSeconds || 0);
  const steps = list(lifePlanState?.steps);
  const wakeIntentions = new Set(list(wake.continuationIntentionIds).map(clean));

  // A walk the character chose in an earlier beat goes on, one hop at a time.
  if (cause === "own_action_settled") {
    const walk = list(continuationIntentions).find((row) => wakeIntentions.has(clean(row.intentionId))
      && clean(row.intentionId).startsWith(OWN_WALK_INTENTION_PREFIX));
    if (walk) {
      const target = clean(walk.targetHandle);
      if (!target || target === here) return null;
      const hop = nextHop(zoneEdges, here, target);
      return hop ? { kind: "walk", source: "chosen_walk", intentionId: clean(walk.intentionId), target, nextHop: hop } : null;
    }
  }

  // A block of the character's own written schedule.
  let step = null;
  if (cause === "plan_due") {
    const ids = new Set([...list(wake.planStepRefs).map((row) => clean(row?.planStepId || row)), ...list(wake.planStepIds).map(clean)]);
    step = steps.find((row) => ids.has(clean(row.planStepId)) && clean(row.status) === "planned" && row.autopilot === true) || null;
  } else if (cause === "own_action_settled") {
    step = steps.find((row) => clean(row.status) === "in_progress" && wakeIntentions.has(`${OWN_PLAN_INTENTION_PREFIX}${clean(row.planStepId)}`)) || null;
  } else if (cause === "wait_deadline") {
    // A wait the character chose ran out: resume an interrupted walk, or take up the block now due.
    step = steps.find((row) => clean(row.status) === "in_progress" && row.autopilot === true && Number(row.endsAtSeconds) > now)
      || steps.filter((row) => clean(row.status) === "planned" && row.autopilot === true && Number(row.dueAtSeconds) <= now && Number(row.endsAtSeconds) > now)
      .sort((a, b) => Number(a.dueAtSeconds) - Number(b.dueAtSeconds))[0] || null;
  }
  if (!step) return null;
  if (Number(step.endsAtSeconds) <= now) return { kind: "handover", step };
  const activity = step.activity || {};
  const target = activity.kind === "work" ? clean(activity.workZoneId) || clean(step.siteZoneId) : clean(step.siteZoneId);
  const arrived = activity.kind === "work" ? here === target : siteOf(here) === siteOf(target);
  if (!arrived) {
    const hop = nextHop(zoneEdges, here, target);
    return hop ? { kind: "walk", source: "day_schedule", step, target, nextHop: hop } : { kind: "handover", step };
  }
  if (activity.kind === "work") {
    return list(startableWorkTemplateIds).map(clean).includes(clean(activity.workTemplateId)) ? { kind: "start_work", step } : { kind: "handover", step };
  }
  if (activity.kind === "visit") return { kind: "handover", step };
  return { kind: "settle", step, waitSeconds: Math.max(60, Math.min(86400, Math.round(Number(step.endsAtSeconds) - now))) };
}

/** The same life plan with one step's status changed. */
export function markPlanStep(lifePlanState = null, planStepId = "", status = "done", nowSeconds = 0) {
  if (!lifePlanState) return lifePlanState;
  const next = structuredClone(lifePlanState);
  for (const step of list(next.steps)) {
    if (clean(step.planStepId) !== clean(planStepId)) continue;
    step.status = status;
    if (status === "in_progress" && step.startedAtSeconds == null) step.startedAtSeconds = Number(nowSeconds || 0);
    if (status === "done") step.doneAtSeconds = Number(nowSeconds || 0);
  }
  return next;
}

/** Blocks still marked under way whose time has passed are done. */
export function closeEndedPlanSteps(lifePlanState = null, nowSeconds = 0) {
  if (!lifePlanState) return lifePlanState;
  const now = Number(nowSeconds || 0);
  if (!list(lifePlanState.steps).some((step) => clean(step.status) === "in_progress" && Number(step.endsAtSeconds) <= now)) return lifePlanState;
  const next = structuredClone(lifePlanState);
  for (const step of list(next.steps)) {
    if (clean(step.status) === "in_progress" && Number(step.endsAtSeconds) <= now) { step.status = "done"; step.doneAtSeconds = now; }
  }
  return next;
}

/** The continuation that brings the next hop of a walk once this one settles. */
export function walkContinuation(decision = {}, nowSeconds = 0) {
  const intentionId = decision.source === "chosen_walk" ? clean(decision.intentionId) : `${OWN_PLAN_INTENTION_PREFIX}${clean(decision.step?.planStepId)}`;
  return {
    intentionId,
    triggerType: "own_action_settled",
    status: "active",
    intendedPrimitive: "move",
    targetHandle: clean(decision.target),
    linkedSourceIds: [],
    minimumDelaySeconds: 0,
    triggerThreshold: 0.5,
    maxDeferrals: 0,
    deferrals: 0,
    createdAtCharacterSeconds: Math.max(0, Number(nowSeconds || 0)),
    privatePurpose: "按自己的打算接着走。",
  };
}
