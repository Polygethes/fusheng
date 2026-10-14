import assert from 'node:assert/strict';
import { tavernCharacterAgentV2OutputSchemaForStage } from '../src/server/pipeline/tavernCharacterAgentV2.mjs';
import { validateCharacterOutputShape } from '../src/server/simulation/characterStageSubmission.mjs';

// Real Luna failure: a recognized canonical id was syntactically accepted,
// while relationship appraisal requires the current perceived person handle.
for (const phase of ['awaiting_subjective_appraisal', 'awaiting_subjective_appraisal_and_candidates']) {
  const schema = tavernCharacterAgentV2OutputSchemaForStage({ phase,
    referenceContract: { perceivedCharacterHandles: ['perceived_entity:friend'],
      perceivedTargetHandles: ['perceived_entity:friend', 'object:cloth'] },
  });
  const appraisal = phase.endsWith('_and_candidates') ? schema.properties.appraisal : schema;
  const target = appraisal.properties.relationshipAppraisal.properties.targetCharacterId;
  assert.ok(validateCharacterOutputShape('char_xyy_xiezenshi', target).length,
    `${phase}: reject canonical identity before a provider can generate a domain-invalid reference`);
  assert.ok(validateCharacterOutputShape('object:cloth', target).length);
  assert.ok(validateCharacterOutputShape('perceived_entity:another-owner', target).length);
  assert.deepEqual(validateCharacterOutputShape('perceived_entity:friend', target), []);
  assert.deepEqual(validateCharacterOutputShape('', target), [], 'no relationship change may leave the target empty');
}
console.log('Relationship reference schema contracts passed: known identity is not a perceived relationship handle, both appraisal call modes bound.');
