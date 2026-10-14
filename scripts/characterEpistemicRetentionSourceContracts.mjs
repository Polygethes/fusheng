import assert from 'node:assert/strict';
import { expandRetainedEpistemicPositions } from '../src/server/simulation/characterAgentTurnProtocol.mjs';

// Minimized from actual Sol turn 18. The model authored three new positions;
// automatic retention appended a location position whose old belief source
// had fallen out of the current owned-source list, rejecting the whole stage.
const target = 'perceived_entity:friend';
const prior = [{ positionId: 'location:friend', domain: 'location', subjectHandle: target,
  proposition: '对方此刻在后院。', confidence: 0.96, status: 'settled',
  workingStance: 'rely_as_settled', relianceScope: 'ordinary_reversible',
  basisEvidenceIds: ['old:hearing'], basisPsychologicalSourceIds: ['belief:aged-out', 'relationship:owned'],
  privateReason: '上次声音来自后院。' }];
const authored = { epistemicPositionUpdateMode: 'retain_unmentioned', epistemicPositions: [] };
const expanded = expandRetainedEpistemicPositions(authored, prior, [target], ['relationship:owned']);
assert.deepEqual(expanded.epistemicPositions[0].basisPsychologicalSourceIds, ['relationship:owned'],
  'automatically retained provenance must not reintroduce a source unavailable in the current reference contract');
assert.deepEqual(expanded.epistemicPositions[0], { ...prior[0], basisEvidenceIds: [], basisPsychologicalSourceIds: ['relationship:owned'] },
  'reference maintenance never changes the Character-authored proposition, stance, confidence or judgment');
assert.deepEqual(prior[0].basisPsychologicalSourceIds, ['belief:aged-out', 'relationship:owned'], 'historical state is not rewritten');
const explicit = { ...prior[0], status: 'rejected', confidence: 0.1, basisEvidenceIds: [], basisPsychologicalSourceIds: ['model:unknown'] };
const revised = expandRetainedEpistemicPositions({ ...authored, epistemicPositions: [explicit] }, prior, [target], ['relationship:owned']);
assert.deepEqual(revised.epistemicPositions[0], explicit,
  'explicitly authored references are not silently repaired; unknown references still reach normal validation');
const carried = expandRetainedEpistemicPositions({ epistemicPositions: [{ positionId: prior[0].positionId,
  domain: prior[0].domain, subjectHandle: target, carriedUnchanged: true }] }, prior, [target], []);
assert.deepEqual(carried.epistemicPositions[0].basisPsychologicalSourceIds, []);
assert.equal(carried.epistemicPositions[0].confidence, prior[0].confidence);
console.log('Retained epistemic sources passed: aged-out references filtered only during hydration, judgment and archived history preserved, authored references remain audited.');
