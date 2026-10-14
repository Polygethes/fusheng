import assert from "node:assert/strict";
import {
  advanceCharacterAgentMemory,
  applyCharacterMemoryOutcome,
  createCharacterAgentMemoryState,
  encodeCharacterPerception,
  memoryInfluenceForCandidate,
  normalizeSemanticFrame,
  retrieveCharacterAgentMemory,
  reviseCharacterSelfNarrative,
  validateSemanticRoleBinding,
} from "../src/engine/characterAgentMemory.js";

const IDS = {
  xie: "char_xyy_xiezenshi",
  zhou: "char_xyy_zhoumin",
  yan: "char_xyy_yanzhizhong",
  chen: "char_xyy_chenyan",
};

const recommendationFrame = normalizeSemanticFrame({
  id: "frame:zhou-recommendation-request",
  kind: "social_request",
  predicate: "request_recommendation",
  topicId: "inner_sect_recommendation",
  roles: {
    requester: IDS.zhou,
    requestedActor: IDS.xie,
    beneficiary: IDS.zhou,
    ultimateRecipient: IDS.yan,
  },
  object: { id: "inner_sect_assessment", label: "内门考核举荐" },
  requestedAct: "向掌籍长老举荐周珉参加内门考核",
  lexicalAnchors: ["举荐", "内门"],
  importance: 0.9,
});

assert.equal(recommendationFrame.roles.requester, IDS.zhou);
assert.equal(recommendationFrame.roles.requestedActor, IDS.xie);
assert.equal(recommendationFrame.roles.beneficiary, IDS.zhou);
assert.equal(recommendationFrame.roles.ultimateRecipient, IDS.yan);

const initialXie = createCharacterAgentMemoryState(IDS.xie);
const initialChen = createCharacterAgentMemoryState(IDS.chen);
const directImpact = {
  id: "impact:zhou-asks-xie",
  objectiveEventId: "event:zhou-asks-xie",
  sourceCharacterId: IDS.zhou,
  directedTargetId: IDS.xie,
  type: "speech",
  modality: "sound",
  content: "真石，内门举荐的事，请你亲口给我一个答复。",
  topic: "举荐答复",
  semanticFrame: recommendationFrame,
  provenance: {
    kind: "firsthand",
    speakerCharacterId: IDS.zhou,
    sourceActionId: "action:zhou-asks-xie",
    sourceImpactIds: [],
  },
};
const xieDelivery = {
  id: "delivery:zhou-to-xie",
  impactId: directImpact.id,
  objectiveEventId: directImpact.objectiveEventId,
  recipientId: IDS.xie,
  sourceCharacterId: IDS.zhou,
  modality: "sound",
  content: directImpact.content,
  topic: directImpact.topic,
  directed: true,
  receivedIntensity: 92,
  personalRelevance: 68,
  impactScore: 155,
  distance: 0,
  deliveredAtSeconds: 20,
  provenance: directImpact.provenance,
  semanticFrame: recommendationFrame,
};

const encodedXie = encodeCharacterPerception(initialXie, {
  impact: directImpact,
  delivery: xieDelivery,
  nowSeconds: 20,
  worldDay: 1,
  locationId: "loc_xyy_tavern",
  zoneId: "hall",
  encodingContext: {
    attention: 0.92,
    goalRelevance: 0.9,
    surprise: 0.25,
    emotionalArousal: 0.58,
    selfRelevance: 0.82,
    relationshipRelevance: 0.78,
    fatigue: 0.2,
    cognitiveLoad: 0.18,
  },
});

assert.equal(encodedXie.episodes.length, 1, "a delivered perception must enter only the recipient's autobiographical memory");
assert.equal(initialChen.episodes.length, 0, "a bystander without a delivery must not gain the memory");
assert.deepEqual(encodedXie.episodes[0].semanticFrame.roles, recommendationFrame.roles, "the authoritative social roles must survive encoding");
assert.equal(encodedXie.episodes[0].source.kind, "firsthand");
assert.ok(encodedXie.episodes[0].retentionStrength > 0.6);
assert.ok(encodedXie.episodes[0].accessibility > 0.6);
assert.equal(encodedXie.commitments[0].ownerRole, "requestedActor");
assert.equal(encodedXie.commitments[0].counterpartyCharacterId, IDS.zhou);
assert.equal(encodedXie.commitments[0].beneficiaryCharacterId, IDS.zhou);
assert.equal(encodedXie.commitments[0].status, "open");

const multiModalXie = encodeCharacterPerception(encodedXie, {
  impact: {
    ...directImpact,
    id: "impact:zhou-asks-xie-visible",
    type: "visible_action",
    modality: "visual",
    content: "周珉把举荐笺推到谢真石面前。",
  },
  delivery: {
    ...xieDelivery,
    id: "delivery:zhou-to-xie-visible",
    impactId: "impact:zhou-asks-xie-visible",
    modality: "visual",
    content: "周珉把举荐笺推到谢真石面前。",
  },
  nowSeconds: 21,
  worldDay: 1,
  locationId: "loc_xyy_tavern",
  zoneId: "hall",
});
assert.equal(multiModalXie.episodes.length, 1, "one objective event received through two senses must remain one episode");
assert.deepEqual(multiModalXie.episodes[0].sourceImpactIds.sort(), [
  "impact:zhou-asks-xie",
  "impact:zhou-asks-xie-visible",
].sort());
assert.ok(multiModalXie.episodes[0].perception.modalities.includes("sound"));
assert.ok(multiModalXie.episodes[0].perception.modalities.includes("visual"));

const retrieved = retrieveCharacterAgentMemory(encodedXie, {
  nowSeconds: 40,
  characterIds: [IDS.zhou],
  topicIds: ["inner_sect_recommendation"],
  predicates: ["request_recommendation"],
  lexicalCues: ["举荐"],
  limit: 6,
});
assert.equal(retrieved.episodes[0].id, encodedXie.episodes[0].id);
assert.equal(retrieved.commitments[0].ownerRole, "requestedActor");
assert.ok(retrieved.retrievalTrace[0].cueMatch > 0);

const matchingCandidate = {
  candidateId: "candidate:answer-zhou",
  actionKind: "respond_to_impact",
  targetCharacterId: IDS.zhou,
  sourceImpactId: directImpact.id,
  semanticFrame: recommendationFrame,
};
const unrelatedCandidate = {
  candidateId: "candidate:practice-alone",
  actionKind: "practice",
  targetCharacterId: "",
};
const matchingInfluence = memoryInfluenceForCandidate(encodedXie, matchingCandidate, { nowSeconds: 40 });
const unrelatedInfluence = memoryInfluenceForCandidate(encodedXie, unrelatedCandidate, { nowSeconds: 40 });
assert.ok(matchingInfluence.total > unrelatedInfluence.total + 0.25, "a key memory must make a matching next action measurably more available");
assert.ok(matchingInfluence.basisEpisodeIds.includes(encodedXie.episodes[0].id));
assert.ok(matchingInfluence.basisCommitmentIds.includes(encodedXie.commitments[0].id));

const afterSevenDays = advanceCharacterAgentMemory(encodedXie, {
  nowSeconds: 7 * 24 * 60 * 60,
  sleepCycles: 7,
});
assert.equal(afterSevenDays.episodes.length, 1, "forgetting must not erase a protected open commitment episode");
assert.ok(afterSevenDays.episodes[0].accessibility < encodedXie.episodes[0].accessibility, "ordinary accessibility must decay over time");
assert.ok(afterSevenDays.episodes[0].retentionStrength >= 0.5, "consolidated retention must remain distinct from current accessibility");

const gossipState = encodeCharacterPerception(createCharacterAgentMemoryState(IDS.chen), {
  impact: {
    ...directImpact,
    id: "impact:gossip-about-recommendation",
    sourceCharacterId: IDS.zhou,
    directedTargetId: IDS.chen,
    content: "听人说，谢真石已经答应替周珉举荐。",
    semanticFrame: { ...recommendationFrame, truthValue: "accepted" },
    provenance: {
      kind: "gossip",
      speakerCharacterId: IDS.zhou,
      claimedOriginalSourceId: IDS.xie,
      sourceCharacterChain: [IDS.xie, IDS.zhou],
      sourceImpactIds: [directImpact.id],
      suspectedMotive: "催促答复",
    },
  },
  delivery: {
    ...xieDelivery,
    id: "delivery:gossip-to-chen",
    impactId: "impact:gossip-about-recommendation",
    recipientId: IDS.chen,
    sourceCharacterId: IDS.zhou,
    content: "听人说，谢真石已经答应替周珉举荐。",
    directed: true,
    provenance: {
      kind: "gossip",
      speakerCharacterId: IDS.zhou,
      claimedOriginalSourceId: IDS.xie,
      sourceCharacterChain: [IDS.xie, IDS.zhou],
      sourceImpactIds: [directImpact.id],
      suspectedMotive: "催促答复",
    },
    semanticFrame: { ...recommendationFrame, truthValue: "accepted" },
  },
  nowSeconds: 80,
  worldDay: 1,
  locationId: "loc_xyy_tavern",
  zoneId: "hall",
});
assert.equal(gossipState.episodes[0].source.kind, "gossip");
assert.deepEqual(gossipState.episodes[0].source.characterChain, [IDS.xie, IDS.zhou]);
assert.ok(gossipState.episodes[0].source.confidence < encodedXie.episodes[0].source.confidence);
assert.equal(gossipState.beliefs[0].status, "uncertain");

const invalidOutcome = validateSemanticRoleBinding({
  ...recommendationFrame,
  kind: "social_decision",
  decisionValue: "refuse",
  roles: { ...recommendationFrame.roles, beneficiary: IDS.xie },
}, recommendationFrame);
assert.equal(invalidOutcome.ok, false, "a later realization may not swap the remembered beneficiary");
assert.ok(invalidOutcome.violations.some((item) => item.code === "SEMANTIC_ROLE_BINDING_MISMATCH"));

const resolved = applyCharacterMemoryOutcome(encodedXie, {
  frame: {
    ...recommendationFrame,
    kind: "social_decision",
    decisionValue: "refuse",
    responderCharacterId: IDS.xie,
  },
  sourceEpisodeId: "episode:xie-refusal",
  nowSeconds: 90,
});
assert.equal(resolved.commitments[0].status, "resolved");
assert.equal(resolved.commitments[0].outcome, "refuse");
assert.equal(resolved.commitments[0].beneficiaryCharacterId, IDS.zhou, "resolution must preserve the original beneficiary");

let bounded = encodedXie;
for (let index = 0; index < 160; index += 1) {
  const impactId = `impact:ordinary:${index}`;
  const frame = normalizeSemanticFrame({
    id: `frame:ordinary:${index}`,
    kind: "observation",
    predicate: "observe_tavern_detail",
    topicId: `ordinary:${index}`,
    roles: { observer: IDS.xie },
    object: { id: `detail:${index}`, label: `酒馆琐事${index}` },
    importance: 0.18,
  });
  bounded = encodeCharacterPerception(bounded, {
    impact: {
      id: impactId,
      objectiveEventId: `event:ordinary:${index}`,
      sourceCharacterId: IDS.chen,
      modality: "visual",
      content: `陈砚挪动了第${index}件普通物件。`,
      topic: "酒馆琐事",
      semanticFrame: frame,
      provenance: { kind: "firsthand" },
    },
    delivery: {
      impactId,
      objectiveEventId: `event:ordinary:${index}`,
      recipientId: IDS.xie,
      sourceCharacterId: IDS.chen,
      modality: "visual",
      content: `陈砚挪动了第${index}件普通物件。`,
      topic: "酒馆琐事",
      directed: false,
      receivedIntensity: 35,
      personalRelevance: 5,
      impactScore: 40,
      semanticFrame: frame,
      provenance: { kind: "firsthand" },
      deliveredAtSeconds: 100 + index,
    },
    nowSeconds: 100 + index,
    worldDay: 1,
    locationId: "loc_xyy_tavern",
    zoneId: "hall",
  });
}
assert.equal(bounded.episodes.length, 96, "episodic memory must remain bounded during long operation");
assert.equal(bounded.beliefs.length, 64, "belief evidence must remain bounded during long operation");
assert.ok(bounded.episodes.some((episode) => episode.id === encodedXie.episodes[0].id), "an unresolved protected request must survive ordinary memory pressure");
assert.ok(bounded.commitments.some((commitment) => commitment.id === encodedXie.commitments[0].id), "an unresolved commitment must survive ordinary memory pressure");
assert.ok(Buffer.byteLength(JSON.stringify(bounded), "utf8") < 900_000, "one character's compact memory must stay below the state-size safety bound");

const selfSeed = {
  ...encodedXie,
  selfNarrative: {
    currentClaims: [{ id: "self-claim:xie:withdraw", claim: "我遇到难处时总会退回自己的路。" }],
    versions: [],
  },
};
const ordinaryChoice = reviseCharacterSelfNarrative(selfSeed, {
  id: "self-revision:ordinary",
  confirmedChoice: true,
  significance: 0.42,
  claim: "我今天改了练剑时辰。",
  nowSeconds: 300,
});
assert.equal(ordinaryChoice.selfNarrative.versions.length, 0, "an ordinary choice must not rewrite identity");
const majorChoice = reviseCharacterSelfNarrative(selfSeed, {
  id: "self-revision:major",
  confirmedChoice: true,
  significance: 0.88,
  permanence: 0.91,
  claim: "我会亲自承担拒绝或答应举荐所带来的后果。",
  replacesClaimId: "self-claim:xie:withdraw",
  semanticFrameId: recommendationFrame.id,
  sourceEpisodeIds: [encodedXie.episodes[0].id],
  reason: "本人作出了会改变修行关系和自我评价的公开选择。",
  nowSeconds: 320,
});
assert.equal(majorChoice.selfNarrative.versions.length, 1, "a confirmed major choice must create an identity revision");
assert.equal(majorChoice.selfNarrative.versions[0].previousClaims[0].claim, "我遇到难处时总会退回自己的路。");
assert.equal(majorChoice.selfNarrative.currentClaims[0].claim, "我会亲自承担拒绝或答应举荐所带来的后果。");

console.log("characterAgentMemoryFoundation:test passed", {
  episodeId: encodedXie.episodes[0].id,
  beliefId: encodedXie.beliefs[0].id,
  commitmentId: encodedXie.commitments[0].id,
  matchingInfluence: matchingInfluence.total,
  decayedAccessibility: afterSevenDays.episodes[0].accessibility,
  boundedBytes: Buffer.byteLength(JSON.stringify(bounded), "utf8"),
});
