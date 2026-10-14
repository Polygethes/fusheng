import assert from "node:assert/strict";
import {
  auditCharacterFoundationProbeInput,
  validateCharacterFoundationProbeDecision,
} from "../src/server/ecology/characterFoundationBlindProbe.mjs";
import {
  buildZhouMinConsequentialChoiceProbeInput,
  ZHOU_MIN_CONSEQUENTIAL_CHOICE_IDS,
} from "./fixtures/zhouMinConsequentialChoiceProbeFixture.mjs";

const IDS = ZHOU_MIN_CONSEQUENTIAL_CHOICE_IDS;
const input = buildZhouMinConsequentialChoiceProbeInput();

const audit = auditCharacterFoundationProbeInput(input);
assert.equal(audit.valid, true, JSON.stringify(audit.errors));
assert.equal(
  input.foundation.identityModel.openChoiceAxes.find((row) => row.id === IDS.OPEN_CHOICE_AXIS)?.resolution,
  "story-open",
);

const serialized = JSON.stringify(input);
for (const forbidden of [
  "calibrationEvidence",
  "holdouts",
  "authorCorrection",
  "expectedAction",
  "expectedOutcome",
  "周珉应当拒绝",
  "周珉应当透露",
]) {
  assert.equal(serialized.includes(forbidden), false, `consequential probe input leaked ${forbidden}`);
}

function commonDecision() {
  return {
    perceivedFacts: [
      {
        id: IDS.OFFER_EVENT,
        status: "objective",
        summary: "使者当面提出以谢真石的私密弱点交换一次真实候补考核资格。",
        basisIds: [IDS.OFFER_EVENT],
      },
      {
        id: IDS.AUTHORITY_FACT,
        status: "objective",
        summary: "周珉已亲眼核对使者身份、宗门印记与空白候补名帖。",
        basisIds: [IDS.AUTHORITY_FACT],
      },
      {
        id: IDS.EXCHANGE_FACT,
        status: "objective",
        summary: "名帖只带来考核资格；交换窗口会随使者离开而结束。",
        basisIds: [IDS.EXCHANGE_FACT],
      },
      {
        id: IDS.PRIVATE_DISCLOSURE_MEMORY,
        status: "firsthand_memory",
        summary: "谢真石曾在无人处向周珉透露自己持久力问题正在加重。",
        basisIds: [IDS.PRIVATE_DISCLOSURE_MEMORY],
      },
      {
        id: IDS.MOTHER_REQUEST_MEMORY,
        status: "firsthand_memory",
        summary: "周珉记得母亲明确要求自己进入内门。",
        basisIds: [IDS.MOTHER_REQUEST_MEMORY],
      },
      {
        id: "inference:real-progress-requires-private-disclosure",
        status: "inference",
        summary: "眼前机会能推进内门欲望，但交换条件会利用朋友私下交付的弱点。",
        basisIds: [IDS.OFFER_EVENT, IDS.AUTHORITY_FACT, IDS.EXCHANGE_FACT, IDS.PRIVATE_DISCLOSURE_MEMORY],
      },
    ],
    candidateComparison: [
      {
        candidateId: "candidate:reveal-private-weakness",
        primitiveId: "inform",
        targetCharacterId: IDS.ENVOY,
        affordanceId: "",
        feasible: true,
        attemptable: true,
        reason: "使者在面前且声路可达；周珉确实知道一项可供交换的私密弱点。",
      },
      {
        candidateId: "candidate:refuse-exchange",
        primitiveId: "inform",
        targetCharacterId: IDS.ENVOY,
        affordanceId: "",
        feasible: true,
        attemptable: true,
        reason: "周珉可以直接拒绝，使者没有物理手段强迫他透露。",
      },
      {
        candidateId: "candidate:ask-for-clean-route",
        primitiveId: "ask",
        targetCharacterId: IDS.ENVOY,
        affordanceId: "",
        feasible: true,
        attemptable: true,
        reason: "可以询问是否存在不交出朋友秘密的其他考核路径，但使者没有义务提供。",
      },
      {
        candidateId: "candidate:leave-private-room",
        primitiveId: "move",
        targetCharacterId: "",
        affordanceId: IDS.EXIT_ROOM_AFFORDANCE,
        feasible: true,
        attemptable: true,
        reason: "客房门可以打开，周珉可以沿相邻路线离开这次私下谈话。",
      },
    ],
    chosenCandidateId: "",
    epistemicUpdate: {
      sourceEventId: IDS.OFFER_EVENT,
      classification: "objective_fact",
      claimAcceptedAsFact: true,
      confidenceBand: "high",
      evidenceBasisIds: [IDS.OFFER_EVENT, IDS.AUTHORITY_FACT, IDS.EXCHANGE_FACT],
    },
    relationshipUpdate: {
      targetCharacterId: IDS.XIE,
      change: "none",
      durable: false,
      evidenceBasisIds: [IDS.PRIVATE_DISCLOSURE_MEMORY, IDS.WITNESS_SCOPE_FACT],
    },
    action: {
      primitiveId: "",
      targetCharacterId: "",
      affordanceId: "",
      speechAct: "none",
      speech: "",
      visibleAction: "",
    },
    futureIntention: {
      mode: "none",
      targetCharacterId: "",
      triggerCondition: "",
      knowledgeLimit: "not_applicable",
    },
    memoryWrite: {
      kind: "firsthand_episode",
      sourceEventId: IDS.OFFER_EVENT,
      proposition: "使者当面提出以谢真石的私密弱点交换候补考核资格",
      confidenceBand: "high",
    },
    postChoiceContinuity: {
      phase: "pending_world_resolution",
      choiceSignificance: "consequential",
      actionMemory: {
        mode: "encode_if_committed",
        content: "",
        basisIds: [],
      },
      desireContinuity: [],
      dynamicStateContinuity: [],
      selfNarrative: {
        mode: "conflict_candidate",
        proposedClaim: "",
        replacesClaimIds: [],
        significanceBand: "high",
        permanenceBand: "medium",
        basisIds: [],
        consolidationStatus: "pending_committed_owned_episode",
      },
    },
    memoryRetrieval: {
      episodeIds: [IDS.PRIVATE_DISCLOSURE_MEMORY, IDS.MOTHER_REQUEST_MEMORY],
      influence: "母亲的要求与内门机会提高推进压力；朋友私下透露弱点的记忆同时激活友情和做人边界。",
    },
    expectedWorldConsequences: [],
    factorLedger: {
      chosen: [],
      rejectedAlternative: {
        primitiveId: "inform",
        reason: "",
        factors: [],
      },
    },
    privateReason: "",
  };
}

const revealDecision = commonDecision();
revealDecision.chosenCandidateId = "candidate:reveal-private-weakness";
revealDecision.action = {
  primitiveId: "inform",
  targetCharacterId: IDS.ENVOY,
  affordanceId: "",
  speechAct: "answer",
  speech: "他持久力有问题，力竭时腿会发软。",
  visibleAction: "周珉看着使者，把自己知道的弱点说了出来。",
};
revealDecision.expectedWorldConsequences = [
  {
    kind: "speech_heard",
    certainty: "direct",
    description: "使者听见了周珉交出的私密弱点。",
    basisIds: [revealDecision.chosenCandidateId, IDS.OFFER_EVENT],
  },
  {
    kind: "future_opportunity",
    certainty: "direct",
    description: "按已核实的交换条件，候补名帖会写入周珉姓名；这仍不等于成为内门弟子。",
    basisIds: [revealDecision.chosenCandidateId, IDS.AUTHORITY_FACT, IDS.EXCHANGE_FACT],
  },
  {
    kind: "relationship_tension",
    certainty: "conditional",
    description: "谢真石尚未感知这次透露；是否形成双方关系后果取决于之后的信息传播和各自反应。",
    basisIds: [revealDecision.chosenCandidateId, IDS.WITNESS_SCOPE_FACT],
  },
];
revealDecision.factorLedger = {
  chosen: [
    {
      factorId: IDS.CORE_DESIRE,
      direction: "supports",
      strengthBand: "high",
      basisIds: [IDS.CORE_DESIRE, IDS.AUTHORITY_FACT, IDS.EXCHANGE_FACT],
    },
    {
      factorId: IDS.STATUS_PRESSURE_STATE,
      direction: "supports",
      strengthBand: "high",
      basisIds: [IDS.STATUS_PRESSURE_STATE, `dynamicState.${IDS.STATUS_PRESSURE_STATE}`],
    },
    {
      factorId: IDS.FRIEND_BETRAYAL_INHIBITOR,
      direction: "opposes",
      strengthBand: "high",
      basisIds: [IDS.FRIEND_BETRAYAL_INHIBITOR, IDS.PRIVATE_DISCLOSURE_MEMORY],
    },
  ],
  rejectedAlternative: {
    primitiveId: "inform",
    reason: "拒绝会保住边界，但让一次真实且即将消失的进展机会落空。",
    factors: [{
      factorId: "opportunity",
      direction: "opposes",
      strengthBand: "high",
      basisIds: [IDS.EXCHANGE_FACT],
    }],
  },
};
revealDecision.postChoiceContinuity = {
  phase: "pending_world_resolution",
  choiceSignificance: "consequential",
  actionMemory: {
    mode: "encode_if_committed",
    content: "我把朋友私下交付的弱点换成了自己的候补考核资格。",
    basisIds: [revealDecision.chosenCandidateId, IDS.OFFER_EVENT, IDS.PRIVATE_DISCLOSURE_MEMORY],
  },
  desireContinuity: [{
    desireId: IDS.CORE_DESIRE,
    status: "progress_if_verified",
    pressureDirection: "decrease",
    strengthBand: "medium",
    settlementCondition: "verified_progress",
    reason: "只有使者实际交付候补名帖才算推进；这仍不等于进入内门。",
    basisIds: [IDS.CORE_DESIRE, revealDecision.chosenCandidateId, IDS.EXCHANGE_FACT],
  }],
  dynamicStateContinuity: [{
    stateId: IDS.STATUS_PRESSURE_STATE,
    direction: "decrease",
    strengthBand: "medium",
    settlementCondition: "verified_desire_progress",
    linkedDesireId: IDS.CORE_DESIRE,
    reason: "若名帖真实交付，眼前的失败压力会暂时下降。",
    basisIds: [IDS.STATUS_PRESSURE_STATE, revealDecision.chosenCandidateId, IDS.EXCHANGE_FACT],
  }],
  selfNarrative: {
    mode: "conflict_candidate",
    proposedClaim: "我可能会为了前程动用朋友私下交给我的东西。",
    replacesClaimIds: [],
    significanceBand: "high",
    permanenceBand: "medium",
    basisIds: [revealDecision.chosenCandidateId, IDS.PRIVATE_DISCLOSURE_MEMORY],
    consolidationStatus: "pending_committed_owned_episode",
  },
};
revealDecision.privateReason = "我知道这会伤到朋友的边界，但这次名额是真的，而且正在从我手里消失。";

const refuseDecision = commonDecision();
refuseDecision.chosenCandidateId = "candidate:refuse-exchange";
refuseDecision.action = {
  primitiveId: "inform",
  targetCharacterId: IDS.ENVOY,
  affordanceId: "",
  speechAct: "refuse",
  speech: "这条件我不接。",
  visibleAction: "周珉没有去看那张空白名帖，只把话回给使者。",
};
refuseDecision.expectedWorldConsequences = [
  {
    kind: "speech_heard",
    certainty: "direct",
    description: "使者听见了明确拒绝，谢真石的私密弱点没有由周珉在本轮说出。",
    basisIds: [refuseDecision.chosenCandidateId, IDS.OFFER_EVENT],
  },
  {
    kind: "future_opportunity",
    certainty: "direct",
    description: "按已知条件，使者离开时会把这次候补机会交给别人；周珉进入内门的欲望仍未满足。",
    basisIds: [refuseDecision.chosenCandidateId, IDS.EXCHANGE_FACT],
  },
  {
    kind: "relationship_tension",
    certainty: "conditional",
    description: "谢真石尚未感知这场谈话，本轮没有凭空生成双方关系变化。",
    basisIds: [refuseDecision.chosenCandidateId, IDS.WITNESS_SCOPE_FACT],
  },
];
refuseDecision.factorLedger = {
  chosen: [
    {
      factorId: IDS.FRIEND_BETRAYAL_INHIBITOR,
      direction: "supports",
      strengthBand: "high",
      basisIds: [IDS.FRIEND_BETRAYAL_INHIBITOR, IDS.PRIVATE_DISCLOSURE_MEMORY],
    },
    {
      factorId: "relationshipCare",
      direction: "supports",
      strengthBand: "high",
      basisIds: [IDS.XIE, IDS.PRIVATE_DISCLOSURE_MEMORY],
    },
    {
      factorId: IDS.CORE_DESIRE,
      direction: "opposes",
      strengthBand: "high",
      basisIds: [IDS.CORE_DESIRE, IDS.AUTHORITY_FACT, IDS.EXCHANGE_FACT],
    },
  ],
  rejectedAlternative: {
    primitiveId: "inform",
    reason: "透露秘密能换来真实进展，但会把朋友私下交付的弱点变成自己的筹码。",
    factors: [{
      factorId: IDS.FRIEND_BETRAYAL_INHIBITOR,
      direction: "opposes",
      strengthBand: "high",
      basisIds: [IDS.FRIEND_BETRAYAL_INHIBITOR, IDS.PRIVATE_DISCLOSURE_MEMORY],
    }],
  },
};
refuseDecision.postChoiceContinuity = {
  phase: "pending_world_resolution",
  choiceSignificance: "consequential",
  actionMemory: {
    mode: "encode_if_committed",
    content: "我拒绝了用朋友私下透露的弱点换候补考核资格。",
    basisIds: [refuseDecision.chosenCandidateId, IDS.OFFER_EVENT, IDS.PRIVATE_DISCLOSURE_MEMORY],
  },
  desireContinuity: [{
    desireId: IDS.CORE_DESIRE,
    status: "remains_unresolved",
    pressureDirection: "increase",
    strengthBand: "medium",
    settlementCondition: "action_committed",
    reason: "拒绝守住了朋友的边界，却没有让我进入内门，也让这次真实机会消失。",
    basisIds: [IDS.CORE_DESIRE, refuseDecision.chosenCandidateId, IDS.EXCHANGE_FACT],
  }],
  dynamicStateContinuity: [{
    stateId: IDS.STATUS_PRESSURE_STATE,
    direction: "increase",
    strengthBand: "medium",
    settlementCondition: "action_committed",
    linkedDesireId: "",
    reason: "候补机会若真的交给别人，地位失败压力会继续积累。",
    basisIds: [IDS.STATUS_PRESSURE_STATE, refuseDecision.chosenCandidateId, IDS.EXCHANGE_FACT],
  }],
  selfNarrative: {
    mode: "reinforcement_candidate",
    proposedClaim: "即使前程受阻，我也不愿用朋友私下的弱点换路。",
    replacesClaimIds: [],
    significanceBand: "high",
    permanenceBand: "medium",
    basisIds: [refuseDecision.chosenCandidateId, IDS.PRIVATE_DISCLOSURE_MEMORY],
    consolidationStatus: "pending_committed_owned_episode",
  },
};
refuseDecision.privateReason = "我想进内门，但拿他私下告诉我的弱点换名额，就是把朋友拿来垫脚。";

const revealValidation = validateCharacterFoundationProbeDecision(input, revealDecision);
assert.equal(revealValidation.valid, true, JSON.stringify(revealValidation.errors));

const refuseValidation = validateCharacterFoundationProbeDecision(input, refuseDecision);
assert.equal(refuseValidation.valid, true, JSON.stringify(refuseValidation.errors));

assert.notEqual(revealDecision.chosenCandidateId, refuseDecision.chosenCandidateId);
assert.equal(input.choiceAuthority.owner, "character-agent");

console.log("zhoumin-consequential-choice-probe:test passed", {
  probeId: input.probeId,
  oppositeChoicesBoundaryValid: true,
  actionChoiceNotAsserted: true,
  authorAcceptanceStillRequired: true,
});
