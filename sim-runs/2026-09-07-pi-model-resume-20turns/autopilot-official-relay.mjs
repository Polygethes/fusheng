#!/usr/bin/env node
// autopilot.mjs — 自动驾驶 two-call 协议跑到目标回合数
// 用法: node autopilot.mjs <targetSettled>
import fs from 'fs';

const TARGET = Number(process.argv[2] || 47);
const BASE = 'http://127.0.0.1:8791';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const CHAR = {
  char_xyy_zhoumin: { short: 'zm', desire: 'desire_zhoumin_become_inner_court_disciple', motive: 'rel_xiaoyaoyou_zhoumin_to_xiezenshi', preserve: ['desire_zhoumin_become_inner_court_disciple'] },
  char_xyy_xiezenshi: { short: 'xz', desire: 'desire_xiezenshi_obtain_father_help_and_recover', motive: 'rel_xiaoyaoyou_xiezenshi_to_zhoumin', preserve: ['desire_xiezenshi_obtain_father_help_and_recover'] },
  char_xyy_luozhao: { short: 'lz', desire: 'desire_luozhao_test_own_limit_against_xiezenshi', motive: 'desire_luozhao_test_own_limit_against_xiezenshi', preserve: ['desire_luozhao_test_own_limit_against_xiezenshi'] }
};
// 上轮已验收立场（逐字结转）
const LAST_POS = {
  char_xyy_zhoumin: [{ positionId: 'pos_zm_receiver_authority_t2', domain: 'claim', subjectHandle: 'perceived_entity:1p0k8zq', carriedUnchanged: true }],
  char_xyy_xiezenshi: [
    { positionId: 'pos_xz_zhoumin_purpose_t2', domain: 'intent', subjectHandle: 'perceived_entity:19f211w', carriedUnchanged: true },
    { positionId: 'pos_xz_stranger_sword_t2', domain: 'ability', subjectHandle: 'perceived_entity:1kg6z28', carriedUnchanged: true },
    { positionId: 'pos_xz_zhoumin_reply_t3', domain: 'intent', subjectHandle: 'perceived_entity:19f211w', carriedUnchanged: true },
    { positionId: 'pos_xz_luozhao_intent_t6', domain: 'intent', subjectHandle: 'perceived_entity:1kg6z28', carriedUnchanged: true }
  ],
  char_xyy_luozhao: [
    { positionId: 'pos_lz_swordman_identity_t1', domain: 'identity', subjectHandle: 'perceived_entity:p6nrxy', carriedUnchanged: true },
    { positionId: 'pos_lz_swordman_disposition_t1', domain: 'intent', subjectHandle: 'perceived_entity:p6nrxy', carriedUnchanged: true }
  ]
};

async function status() {
  const r = await fetch(`${BASE}/status`);
  return r.json();
}
async function submit(obj, tag, stageId) {
  // 官方中继需要 {stageId, output} 信封
  const body = stageId ? JSON.stringify({ stageId, output: obj }) : JSON.stringify(obj);
  const r = await fetch(`${BASE}/respond`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  const j = await r.json().catch(() => ({}));
  console.log(`  <- ${tag}: ${r.status}${j.error ? ' ' + j.error : ''}`);
  return r.status;
}
const prevTurnId = tid => { const m = tid.match(/^(.*:)(\d+)$/); return m ? m[1] + Math.max(1, Number(m[2]) - 1) : tid; };

function othersHandles(si) {
  const me = si.agentTurnId.split(':')[1];
  return (si.worldProjection.perceivedCharacters || si.worldProjection.perceivedEntities || [])
    .map(c => c.handle || c.id).filter(h => h && h !== me);
}

function buildS1(si, cfg) {
  const rc = si.referenceContract.perceivedEvidenceIds;
  const E = rc[0];
  const turnId = si.agentTurnId;
  const turnNum = turnId.split(':').pop();
  const others = othersHandles(si);
  const target = others[0] || '';
  const watch = others.length > 0;
  // 先前行动预报：以运行时给出的 pendingSourceAgentTurnId 为准
  const poCtx = si.privateContext?.priorActionOutcomeContext || {};
  const priorTurn = poCtx.pendingSourceAgentTurnId || null;
  const priorOwn = rc.filter(x => x.includes(':own-action-result') && x.includes(turnId.split(':')[1]));
  const mkCand = (id, prim, tgt, domains, dir) => ({
    originAuthority: 'character-agent', candidateId: id, intention: dir, attemptPrimitive: prim,
    targetHandle: tgt || '', actionBinding: tgt ? { kind: 'character', targetCharacterId: tgt } : { kind: 'none' },
    feasibilityHandling: { surfaceId: '', relationToGoal: 'unrelated', stance: 'not_applicable', privateReason: '观察或等待不借可行性。' },
    perceivedPrerequisites: [], domains,
    expectedEffects: [{ sourceId: cfg.desire, direction: dir, magnitude: 0.3, confidence: 0.6 }],
    desireRelations: [{ desireId: cfg.desire, relation: 'probe', terminalConditionMatch: 0.05, counterfactualResult: '不做则无进展。', preservesNonSubstitutableConditions: true, confidence: 0.45 }],
    criterionUses: [],
    epistemicHandling: { positionIds: [], mode: 'not_relevant', errorIfWrong: 0.03, actionReversibility: 0.95, learningDuringAction: 0.1, delayCost: 0.05, privateReason: '没有悬念。' },
    sharedActivity: { operation: 'none' },
    factorInputs: { emotionCompatibility: 0.6, valueAndSelfImage: 0.5, relationshipMeaning: 0.3, informationGain: watch ? 0.35 : 0.1, habitAndIntentionContinuity: 0.75, bodyCost: 0.02, threatAndNormCost: 0.03, exposureAndRelationshipRisk: 0.08, opportunityAndSwitchingCost: 0.35, uncertaintyCost: 0.05 },
    timingIntent: '等待期间。', uncertainty: 0.05
  });
  const candidates = [];
  if (watch) candidates.push(mkCand(`cand_${cfg.short}${turnNum}a_watch`, 'observe', target, ['social'], '留意对方动静，时机不误。'));
  candidates.push(mkCand(`cand_${cfg.short}${turnNum}a_settle`, 'rest', '', ['duty'], '稳住继续等。'));
  const own = rc.filter(x => x.includes(':own-action-result') && x.includes(si.agentTurnId.split(':')[1]));
  return {
    appraisal: {
      ownerAuthority: 'character-agent', agentTurnId: turnId,
      appraisalId: `appraisal:${si.agentTurnId.split(':')[1]}:${turnNum}ap`,
      noticedEvidenceIds: rc,
      interpretations: [{ evidenceIds: [E], meaning: watch ? '按当前所见继续既定节奏：留意对方动静。' : '按当前所见继续既定节奏：稳住等。', confidence: 0.85 }],
      beliefOperations: [],
      epistemicPositions: JSON.parse(JSON.stringify(LAST_POS[si.agentTurnId.split(':')[1]] || [])),
      threadAppraisals: [],
      priorActionOutcomeAppraisal: priorTurn ? { ownerAuthority: 'character-agent', sourceAgentTurnId: priorTurn, status: 'perceived', noticedOutcomeEvidenceIds: priorOwn.length ? priorOwn : [E], perceivedInformationGain: 0.1, perceivedGoalProgress: 0.1, perceivedCost: 0.02, unexpectedness: 0.02, stillUnresolved: true, summary: '既定节奏延续。' } : { ownerAuthority: 'character-agent', sourceAgentTurnId: '', status: 'no_prior_action', noticedOutcomeEvidenceIds: [], perceivedInformationGain: 0, perceivedGoalProgress: 0, perceivedCost: 0, unexpectedness: 0, stillUnresolved: false, summary: '' },
      desireGroundings: [{ desireId: cfg.desire, feltWant: watch ? '留意动静，时机不误。' : '稳住等。', terminalExperience: '保持长期目标。', terminalContractAcknowledged: true, promotedCriteria: [], activationState: 'active', activationEvidenceIds: [E], activationPsychologicalSourceIds: [cfg.motive], missingActivationConditions: [], immediatePull: 0.5, currentlyPerceivedPossible: 0.5, inhibitors: [], acceptableTransformations: ['timing'], privateSummary: '延续。' }],
      entityModelUpdates: []
    },
    candidates: { ownerAuthority: 'character-agent', agentTurnId: turnId, candidates }
  };
}

function buildS2(pending, cfg, winnerId) {
  const turnId = pending.stageInput.agentTurnId;
  const evals = pending.stageInput.candidateEvaluation?.evaluations || [];
  const winner = evals.find(e => e.candidateId === winnerId);
  // 锁定的选择以 candidateCommitContexts[0].selectedAction 为准
  const ccs = pending.stageInput.candidateCommitContexts || [];
  const ccSel = ccs.find(c => c.candidateId === winnerId) || ccs[0] || {};
  const sel = ccSel.selectedAction || {};
  const primitive = sel.attemptPrimitive || winner?.attemptPrimitive || 'rest';
  const tgt = sel.targetHandle || '';
  const tgtChar = sel.actionBinding?.targetCharacterId || tgt;
  return {
    choice: {
      ownerAuthority: 'character-agent', agentTurnId: turnId,
      selectedCandidateId: winnerId,
      regulationChoice: { ownerAuthority: 'character-agent', regulationChoiceId: `reg:${turnId}`, agentTurnId: turnId, strategies: [{ strategy: 'suppress', targetEmotionIds: [], effort: 1.0 }], acceptedCosts: ['情绪收住'] },
      goalPreservation: { preservedDesireIds: cfg.preserve, transformedDimensions: ['timing'], terminalExperiencePreserved: true, acceptedDelay: true, acceptedResidualFrustration: 0.05, privateBasis: '稳住节奏。' },
      automaticCommunicationImpulse: { ownerAuthority: 'character-agent', impulseId: `imp:${turnId}`, mode: 'silence', triggerEvidenceIds: [], discourseAnchorIds: [], motiveSourceIds: [cfg.desire], perceivedTurnDemand: '没有话轮到我。', feltTendency: '守着。', urgency: 0.2, disclosurePressure: 0.05, inhibitionPressure: 0.2, conflict: { present: false, opposingSourceIds: [], description: '' } },
      continuationIntentions: [],
      privateDecisionBasis: '数学最高分候选。'
    },
    turnCommit: {
      ownerAuthority: 'character-agent', agentTurnId: turnId,
      privateExpressionTrace: { affectiveInfluence: { sourceEmotionIds: [], mode: 'no_live_influence', primaryChannelId: '', privateBasis: '情绪收住。' } },
      conversationAnchorSelection: { anchorHandle: '', mode: 'none', targetParticipantHandle: '', postTurnDisposition: 'no_thread' },
      actionAttempt: { primitive, objectId: '', targetCharacterId: tgtChar, destinationId: '', positionId: '', affordanceId: '' },
      publicExpression: { mode: 'silence', audienceCharacterIds: [], timing: 'silence', utterance: { literalSpeech: '', vocalMode: 'conversational' }, bodyDelta: '', affectiveDeltas: [] }
    }
  };
}

function buildReflect(si) {
  const mems = si.opportunity?.sourceMemoryIds || [];
  return {
    ownerAuthority: 'character-agent',
    insights: [{
      proposition: '节奏不由我一个人定——把可控的部分做稳，其余交给对方。', sourceMemoryIds: [mems[0], mems[1]].filter(Boolean).slice(0, 2), confidence: 0.75, importance: 0.5,
      semanticFrame: { kind: 'reflection_insight', predicate: 'steady_rhythm', topicId: 'self_discipline', lexicalAnchors: ['节奏', '稳'] }
    }]
  };
}

function fixS1(si, cfg, s1, violations) {
  const rc = si.referenceContract.perceivedEvidenceIds;
  const E = rc[0];
  for (const v of violations) {
    if (v.code.includes('EVIDENCE_UNKNOWN')) {
      s1.appraisal.noticedEvidenceIds = rc;
      s1.appraisal.interpretations = [{ evidenceIds: [E], meaning: '按当前所见继续既定节奏。', confidence: 0.85 }];
      const own = rc.filter(x => x.includes(':own-action-result') && x.includes(si.agentTurnId.split(':')[1]));
      s1.appraisal.priorActionOutcomeAppraisal.noticedOutcomeEvidenceIds = own.length ? own : [E];
      s1.appraisal.desireGroundings[0].activationEvidenceIds = [E];
    }
    if (v.code.includes('TURN_MISMATCH')) {
      const poCtx = si.privateContext?.priorActionOutcomeContext || {};
      if (poCtx.pendingSourceAgentTurnId) {
        s1.appraisal.priorActionOutcomeAppraisal.sourceAgentTurnId = poCtx.pendingSourceAgentTurnId;
        s1.appraisal.priorActionOutcomeAppraisal.status = 'perceived';
      } else {
        s1.appraisal.priorActionOutcomeAppraisal.status = 'no_prior_action';
        s1.appraisal.priorActionOutcomeAppraisal.noticedOutcomeEvidenceIds = [];
      }
    }
    if (v.code.includes('SILENTLY_DROPPED') || v.code.includes('CARRIED')) {
      s1.appraisal.epistemicPositions = JSON.parse(JSON.stringify(LAST_POS[si.agentTurnId.split(':')[1]] || []));
    }
  }
  return s1;
}

function fixS2(cfg, s2, violations) {
  for (const v of violations) {
    if (v.code.includes('PRESERVED_DESIRE_UNKNOWN') || v.code.includes('PRESERVED_DESIRE_UNLINKED')) {
      s2.choice.goalPreservation.preservedDesireIds = cfg.preserve;
      s2.choice.goalPreservation.privateBasis = '稳住节奏。';
    }
    if (v.code.includes('WITHOUT_LIVE_RESIDUE')) { s2.turnCommit.privateExpressionTrace.affectiveInfluence.mode = 'no_live_influence'; s2.turnCommit.privateExpressionTrace.affectiveInfluence.sourceEmotionIds = []; }
    if (v.code.includes('AFFECTIVE_INFLUENCE_SOURCE_NOT_LIVE') || v.code.includes('AFFECTIVE_CHANNEL')) {
      s2.turnCommit.privateExpressionTrace.affectiveInfluence.sourceEmotionIds = [];
    }
    if (v.code.includes('DISPOSITION_WITHOUT_SPEECH')) {
      s2.turnCommit.conversationAnchorSelection.postTurnDisposition = 'no_thread';
    }
    if (v.code.includes('LIVE_SOURCE_IGNORED')) {
      // 需要包含活残佘情绪——从修复消息或 expressionMoment 提取，保守取 'anticipation'
      const m = String(v.message || '').match(/Emotion (\w+)/);
      const id = m ? m[1] : 'anticipation';
      s2.turnCommit.privateExpressionTrace.affectiveInfluence.sourceEmotionIds = [id];
    }
    if (v.code.includes('REALIZATION')) {
      // 消息形如 "chose X; realization may not replace it with Y" —— 直接采用 X
      const m = String(v.message || '').match(/chose ([\w-]+);/);
      if (m) s2.turnCommit.actionAttempt.primitive = m[1];
    }
  }
  return s2;
}

let lastTurnKey = '';
const LAST_COMMIT = {}; // turnId -> s2 阶段提交的原始 turnCommit（s3 必须重放）
for (let i = 0; i < 500; i++) {
  let s = await status();
  if (s.settledCount >= TARGET) { console.log(`DONE settled=${s.settledCount}/${s.turnLimit}`); break; }
  const p = s.pending;
  if (!p) { await sleep(2000); continue; }
  const si = p.stageInput;
  const turnId = si.agentTurnId;
  const phase = p.phase;
  const cfg = CHAR[turnId.split(':')[1]];
  if (!cfg) { console.log('unknown char', turnId); await sleep(2000); continue; }
  const key = turnId + '@' + phase + '@' + (p.protocolRepairFeedback?.violations?.length || 0);
  if (key === lastTurnKey) { await sleep(1500); continue; }
  lastTurnKey = key;
  const nrep = p.protocolRepairFeedback ? p.protocolRepairFeedback.violations.length : 0;
  if (nrep) console.log('   violations:', JSON.stringify(p.protocolRepairFeedback.violations.map(v => v.code)));
  console.log(`[${s.settledCount}] ${turnId} @${phase} repairs=${nrep}`);

  if (phase === 'awaiting_character_reflection') {
    await submit(buildReflect(si), 'reflect', s.pending.stageId);
  } else if (phase === 'awaiting_subjective_appraisal_and_candidates') {
    let s1 = buildS1(si, cfg);
    if (nrep) s1 = fixS1(si, cfg, s1, p.protocolRepairFeedback?.violations || []);
    await submit(s1, 's1', s.pending.stageId);
  } else if (phase === 'awaiting_agent_choice_and_turn_commit') {
    const evals = si.candidateEvaluation?.evaluations || [];
    const winner = [...evals].sort((a, b) => b.expectedUtility - a.expectedUtility)[0]?.candidateId
      || si.candidateCommitContexts?.[0]?.candidateId;
    let s2 = buildS2(p, cfg, winner);
    if (nrep) s2 = fixS2(cfg, s2, p.protocolRepairFeedback?.violations || []);
    LAST_COMMIT[turnId] = JSON.parse(JSON.stringify(s2.turnCommit));
    await submit(s2, 's2', s.pending.stageId);
  } else if (phase === 'awaiting_agent_turn_commit') {
    // 第三阶段：relay 会把 output 包成 {turnCommit: output}，因此字段必须摊平在根上
    const st = await status();
    const fb = st.pending?.protocolRepairFeedback;
    const tc = LAST_COMMIT[turnId] ? JSON.parse(JSON.stringify(LAST_COMMIT[turnId])) : buildS2(st.pending, cfg, 'cand_x').turnCommit;
    const flat = { ownerAuthority: 'character-agent', ...tc };
    if (fb) fixS2(cfg, { turnCommit: flat }, fb.violations);
    flat.agentTurnId = turnId;
    await submit(flat, 's3', st.pending.stageId);
  }
  await sleep(1200);
}
