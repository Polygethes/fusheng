// Deterministic run-health checks, never a replacement for character decisions.
// Computed from saved history so a restart cannot erase a detected loop.
const INCIDENTAL = new Set(['actor_movement', 'gesture_performed', 'speech_emitted', 'speech_delivered', 'auditory_attention_established', 'visual_attention_established', 'actor_wait_registered', 'actor_resting', 'actor_practicing']);
export function restoreProgressRecords(records = [], outcomes = []) {
  const destinations = new Map(outcomes.map(o => [o.outcomeId, (o.resolvedEffects || []).find(e => e.kind === 'actor_movement')?.toZoneId || '']));
  return records.map(r => r.publicSummary && !Object.hasOwn(r.publicSummary, 'movementDestination')
    ? { ...r, publicSummary: { ...r.publicSummary, movementDestination: destinations.get(r.outcomeId) || '' } } : r);
}
export function assessSimulationIntegrity({ actors = [], records = [] } = {}) {
  const unavailable = [...actors].filter(a => a.executionControl?.status === 'suspended_model_error');
  if (unavailable.length) return { code: 'SIMULATION_PARTICIPANT_UNAVAILABLE', stopReason: 'suspended_model_error',
    message: 'A scene participant cannot decide. The scene is stopped; no substitute decision was made.',
    evidence: { actors: unavailable.map(a => ({ characterId: a.characterId, status: a.executionControl.status, reason: a.executionControl.reason || null })) } };
  // Steps the world takes along a resident's own schedule are not decisions.
  const window = records.filter(r => (r.turnKind || r.publicSummary?.turnKind) !== 'own_plan_step').slice(-24);
  const recent = window.map(r => r.publicSummary || r);
  if (recent.length < 24) return null;
  const actions = recent.filter(r => r.turnKind === 'action');
  // Only repetitive, causally empty windows are stopped. New speech, destinations,
  // work, transfers, and other material effects are not declared worthless here.
  if (actions.some(r => (r.resolvedEffectKinds || []).some(k => !INCIDENTAL.has(k)))) return null;
  const fingerprints = new Set(actions.map(r => JSON.stringify([r.characterId, r.outcome?.primitive, r.movementDestination || '', (r.speech || '').trim()])));
  if ((actions.length >= 12 && fingerprints.size <= 3) || actions.length === 0) {
    return { code: 'SIMULATION_NO_PROGRESS', stopReason: 'stalled_no_progress',
      message: '24 settled decisions repeat without a material outcome. Review the saved scene before resuming.',
      evidence: { windowTurns: 24, actionTurns: actions.length, distinctActions: fingerprints.size, firstTurnId: window[0]?.agentTurnId, lastTurnId: window.at(-1)?.agentTurnId } };
  }
  return null;
}
export function throwSimulationIntegrityIssue(issue) {
  if (issue) throw Object.assign(new Error(issue.message), { code: issue.code, evidence: issue.evidence, stopReason: issue.stopReason });
}
