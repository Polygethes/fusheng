import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createCharacterWorldRuntime } from '../src/server/simulation/characterWorldRuntime.mjs';
import { summarizeSettledSimulation } from '../src/server/simulation/settledSimulationReport.mjs';
const actor = (id, status = 'active') => ({ characterId: id, executionControl: { status }, mailbox: [], runNextTurn() { throw new Error('MUST_NOT_CALL_MODEL'); } });
const rows = Array.from({ length: 24 }, (_, i) => ({ agentTurnId: `t${i}`, characterId: 'a', turnKind: 'action', publicSummary: { characterId: 'a', turnKind: 'action', speech: '', outcome: { primitive: 'move', status: 'success' }, resolvedEffectKinds: ['actor_movement'], movementDestination: i % 2 ? 'hall' : 'threshold' } }));
const runtime = (actors, completedTurnRecords = []) => createCharacterWorldRuntime({ actors, completedTurnRecords, readyQueue: ['a'], coordinator: { submitActionAttempt() {}, worldState: {}, journal: {} }, situationProjector() {} });
test('a suspended participant stops the scene before any other model call, including restored checkpoints', async () => {
  const r = runtime([actor('a'), actor('b', 'suspended_model_error')]);
  await assert.rejects(r.runNext(), { code: 'SIMULATION_PARTICIPANT_UNAVAILABLE' });
  assert.equal(r.executionStatus.status, 'suspended_model_error');
});
test('a restored silent shuttle stops before the next model call', async () => {
  await assert.rejects(runtime([actor('a')], rows).runNext(), { code: 'SIMULATION_NO_PROGRESS' });
});
test('suspension and stagnation outrank even a reached turn budget in reports', () => {
  const c = { actors: [actor('a', 'suspended_model_error')], completedTurnRecords: rows };
  assert.equal(summarizeSettledSimulation({ checkpoint: c, turns: rows, requestedTurns: 24, running: true }).stopReason, 'suspended_model_error');
  c.actors[0].executionControl.status = 'active';
  assert.equal(summarizeSettledSimulation({ checkpoint: c, turns: rows, requestedTurns: 24 }).stopReason, 'stalled_no_progress');
});
test('steps along a resident\'s own schedule neither hide nor make a stalled window', async () => {
  const own = i => ({ agentTurnId: `own${i}`, characterId: 'a', turnKind: 'own_plan_step', publicSummary: { characterId: 'a', turnKind: 'own_plan_step', speech: '',
    outcome: { primitive: 'move', status: 'success' }, resolvedEffectKinds: ['actor_movement'], movementDestination: `street_${i}` } });
  const mixed = rows.flatMap((row, i) => [row, own(i)]);
  await assert.rejects(runtime([actor('a')], mixed).runNext(), error => error.code === 'SIMULATION_NO_PROGRESS'
    && error.evidence.firstTurnId === 't0' && error.evidence.lastTurnId === 't23');
  assert.equal(summarizeSettledSimulation({ checkpoint: { actors: [actor('a')], completedTurnRecords: mixed }, turns: mixed, requestedTurns: 1000 }).stopReason, 'stalled_no_progress');
  const walking = Array.from({ length: 48 }, (_, i) => own(i));
  assert.equal(summarizeSettledSimulation({ checkpoint: { actors: [actor('a')], completedTurnRecords: walking }, turns: walking, requestedTurns: 1000 }).stopReason, 'waiting');
});
test('external replies cannot start a real-model run or default unlabelled run', () => {
  for (const purpose of ['', 'real-model']) {
    const r = spawnSync(process.execPath, ['scripts/runV27ModelRelay.mjs'], { env: { ...process.env, RELAY_INPUT_KIND: 'external-unverified', RELAY_RUN_PURPOSE: purpose, RELAY_RESUME_PATH: '', RELAY_SAVE_PATH: '', RELAY_PORT: '0' }, encoding: 'utf8', timeout: 4000 });
    assert.match(r.stderr, /RELAY_REAL_MODEL_REQUIRES_DIRECT_PROVIDER/);
    assert.notEqual(r.status, 0);
  }
});

test('genuine travel, fresh dialogue and completed work are not the shuttle pattern', () => {
  const changed = structuredClone(rows);
  changed.forEach((r, i) => { r.publicSummary.movementDestination = `place${i}`; });
  const summary = records => summarizeSettledSimulation({ checkpoint: { actors: [actor('a')], completedTurnRecords: records }, turns: records, requestedTurns: 24 });
  assert.equal(summary(changed).stopReason, 'turn_limit_reached');
  changed.forEach((r, i) => { r.publicSummary.movementDestination = ''; r.publicSummary.speech = `new statement ${i}`; });
  assert.equal(summary(changed).stopReason, 'turn_limit_reached');
  const work = structuredClone(rows);
  work.at(-1).publicSummary.resolvedEffectKinds = ['work_unit_completed', 'object_resource_changed'];
  assert.equal(summary(work).stopReason, 'turn_limit_reached');
});
