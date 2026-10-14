import assert from 'node:assert/strict';
import { createWorldActionRegistry } from '../src/server/simulation/worldActionRegistry.mjs';
import { renderBodyActions } from '../src/server/simulation/physicalExpression.mjs';
const entity = (id, zoneId) => ({ id, zoneId, kind: 'character', present: true, placeId: 'tavern' });
const state = { nowSeconds: 0, entities: { speaker: entity('speaker', 'yard'), visible: entity('visible', 'yard'),
  hearingOnly: entity('hearingOnly', 'room'), sightOnly: entity('sightOnly', 'window') },
  places: { tavern: { topology: { zones: { yard: {}, room: {}, window: {} }, edges: [
    { from: 'yard', to: 'room', sound: 1, visual: 0 }, { from: 'yard', to: 'window', sound: 0, visual: 1 },
  ] } } } };
const registry = createWorldActionRegistry();
const bodyActions = [{ kind: 'gaze', direction: 'left', amplitude: 'small', speed: 'normal' }];
const body = renderBodyActions(bodyActions) + '视线停住。';
const payload = { utterance: '真石，起手那半步该怎么改？', visibleAction: '动作草稿不公开', bodyActions, targetCharacterId: 'visible',
  observableAffectiveTexture: [{ modality: 'visual', channel: 'attentionLock', cue: 'gaze_fixed', feature: '视线停住。' },
    { modality: 'sound', channel: 'volume', cue: 'voice_soft', feature: '声音放轻。' }] };
const result = await registry.settle({ state, attempt: { attemptId: 'spoken-body', actorId: 'speaker', primitive: 'speak', payload } });
const bodies = result.deliveries.filter(row => row.modality === 'visual' && row.content === body);
assert.deepEqual(bodies.map(row => row.recipientCharacterId).sort(), ['sightOnly', 'visible'],
  'actual Sol turn 18 body text must reach sight routes independently of speech');
assert.ok(bodies.every(row => row.observableAffectiveTexture.every(texture => texture.modality === 'visual')));
const audio = result.deliveries.filter(row => row.eventKind === 'speech');
assert.deepEqual(audio.map(row => row.recipientCharacterId).sort(), ['hearingOnly', 'visible']);
assert.deepEqual(audio.find(row => row.recipientCharacterId === 'hearingOnly').observableAffectiveTexture,
  payload.observableAffectiveTexture.filter(row => row.modality === 'sound'), 'hearing through a wall cannot reveal gaze');
assert.equal(audio.find(row => row.recipientCharacterId === 'visible').observableAffectiveTexture.length, 2);
const quietBody = await registry.settle({ state, attempt: { attemptId: 'no-body', actorId: 'speaker', primitive: 'speak', payload: { ...payload, visibleAction: '', bodyActions: [], observableAffectiveTexture: [] } } });
assert.ok(!quietBody.deliveries.some(row => row.modality === 'visual'), 'no new body gesture is invented');
const gazeOnly = await registry.settle({ state, attempt: { attemptId: 'gaze-only', actorId: 'speaker', primitive: 'speak', payload: { ...payload, visibleAction: '', bodyActions: [] } } });
assert.equal(gazeOnly.deliveries.filter(row => row.modality === 'visual' && row.content === '视线停住。').length, 2, 'a separately authored visual cue also reaches sight-only observers');
const accompany = await registry.settle({ state, attempt: { attemptId: 'listen-speak', actorId: 'speaker', primitive: 'listen', payload: { ...payload, targetId: 'visible' } } });
assert.equal(accompany.deliveries.filter(row => row.modality === 'visual' && row.content === body).length, 2, 'accompanying speech does not duplicate a primary attention gesture');
console.log('Speech expression contracts passed: exact body delivery, independent sight and hearing routes, no gaze through walls, no voice through sight-only routes, no duplicate gesture.');
