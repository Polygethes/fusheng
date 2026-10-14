import assert from "node:assert/strict";

import {
  buildTavernConversationalRealization,
  buildTavernVoiceContract,
  validateTavernVoiceRealization,
} from "../src/server/pipeline/tavernCharacterVoice.mjs";
import { buildZhouMinTavernBehaviorAcceptanceFixture } from "./fixtures/zhouMinTavernBehaviorAcceptanceFixture.mjs";

const SPEAKER = "char_portability_close_peer_a";
const TARGET = "char_portability_close_peer_b";
const relationshipContext = [{
  otherCharacterId: TARGET,
  label: "一起长大的朋友",
  allowedAddresses: ["阿青"],
  publicPressure: { closeness: 72, tension: 18 },
  ownedImpression: null,
}];
const voiceContract = buildTavernVoiceContract({
  id: SPEAKER,
  name: "可移植人物甲",
  speechProfile: {
    cadence: "熟人面前省略双方已经知道的背景",
    avoids: ["把内心目的逐项汇报"],
    underPressure: "先说眼下最需要对方回应的一件事",
  },
}, {
  targetCharacterId: TARGET,
  relationshipContext,
  identityMinimumScore: 0,
});
const strictVoiceContract = {
  ...voiceContract,
  telemetry: { ...voiceContract.telemetry, minimumContextualCoherence: 0.46 },
};
const responseCandidate = {
  candidateId: "candidate:portability:respond",
  targetCharacterId: TARGET,
  actionKind: "respond_to_impact",
  realization: {
    mode: "respond",
    responseSourceImpactId: "impact:portability:question",
  },
};
const directQuestion = {
  impactId: "impact:portability:question",
  sourceCharacterId: TARGET,
  type: "speech",
  modality: "sound",
  directed: true,
  content: "你还有别的事？",
  speechAct: "ask",
};

const closePeerRealization = buildTavernConversationalRealization({
  voiceContract,
  candidate: responseCandidate,
  sourceImpact: directQuestion,
  relationshipContext,
});
assert.equal(closePeerRealization.authority, "generic-conversational-realization");
assert.equal(closePeerRealization.turnMode, "direct-response");
assert.equal(closePeerRealization.sharedContextBand, "high");
assert.equal(closePeerRealization.privateReasonIsNotSpeech, true);
assert.match(closePeerRealization.informationPackaging, /一个前景动作/u);
assert.ok(closePeerRealization.avoid.some((entry) => /目的清单/u.test(entry)));
assert.doesNotMatch(JSON.stringify(closePeerRealization), /周珉|谢真石|举荐|药包/u);

const motiveLedger = validateTavernVoiceRealization({
  speech: "我想请你再看一遍。我还有一件事，也想同你谈清。",
  speechAct: "answer",
  characterId: SPEAKER,
  targetCharacterId: TARGET,
  voiceContract,
  conversationRealization: closePeerRealization,
  requiresSubstantiveAnswer: true,
  contextTopics: ["熟人之间尚未说明的来意"],
});
assert.equal(motiveLedger.ok, true, "voice telemetry must not censor a line the Character Agent chose to say");
assert.equal(motiveLedger.publicSpeech, motiveLedger.proposedSpeech);
assert.ok(motiveLedger.diagnosticFindings.some((entry) => entry.code === "MOTIVE_LEDGER_REGISTER"));

const compressedReply = validateTavernVoiceRealization({
  speech: "那件事，你再听我说一句？",
  speechAct: "answer",
  characterId: SPEAKER,
  targetCharacterId: TARGET,
  voiceContract,
  conversationRealization: closePeerRealization,
  requiresSubstantiveAnswer: true,
  contextTopics: ["熟人之间尚未说明的来意"],
});
assert.equal(compressedReply.ok, true);

const embodiedRequest = {
  ...directQuestion,
  impactId: "impact:portability:demonstration-request",
  content: "把药包先拿好，再把刚才练的那一式走一遍给我看。",
  speechAct: "request",
};
const embodiedResponseCandidate = {
  ...responseCandidate,
  realization: {
    mode: "respond",
    responseSourceImpactId: embodiedRequest.impactId,
  },
};
const embodiedClosePeerRealization = buildTavernConversationalRealization({
  voiceContract,
  candidate: embodiedResponseCandidate,
  sourceImpact: embodiedRequest,
  relationshipContext,
});
const embodiedCompressedReply = validateTavernVoiceRealization({
  speech: "行，看好了。",
  visibleAction: "人物甲把手里的东西搁到一旁，退开半步，并指起势。",
  speechAct: "answer",
  characterId: SPEAKER,
  targetCharacterId: TARGET,
  voiceContract: strictVoiceContract,
  conversationRealization: embodiedClosePeerRealization,
  requiresSubstantiveAnswer: true,
  contextTopics: ["走一遍刚才练的招式"],
});
assert.equal(embodiedCompressedReply.ok, true);
assert.equal(embodiedCompressedReply.diagnostics.evaluationScope, "preceding-turn+relationship+speech+visible-action");
assert.equal(embodiedCompressedReply.diagnostics.embodiedDirectResponse.passed, true);
assert.ok(embodiedCompressedReply.identityScore >= 0.46);

const compressedWithoutAction = validateTavernVoiceRealization({
  speech: "行，看好了。",
  visibleAction: "",
  speechAct: "answer",
  characterId: SPEAKER,
  targetCharacterId: TARGET,
  voiceContract: strictVoiceContract,
  conversationRealization: embodiedClosePeerRealization,
  requiresSubstantiveAnswer: true,
  contextTopics: ["走一遍刚才练的招式"],
});
assert.equal(compressedWithoutAction.ok, true);
assert.equal(compressedWithoutAction.diagnostics.embodiedDirectResponse.passed, false);
assert.equal(Object.hasOwn(compressedWithoutAction.diagnostics.components, "sentenceRhythm"), false);

const wrongFollowThrough = validateTavernVoiceRealization({
  speech: "行，看好了。",
  visibleAction: "人物甲转身把门关上，又在门闩上压了压。",
  speechAct: "answer",
  characterId: SPEAKER,
  targetCharacterId: TARGET,
  voiceContract: strictVoiceContract,
  conversationRealization: embodiedClosePeerRealization,
  requiresSubstantiveAnswer: true,
  contextTopics: ["走一遍刚才练的招式"],
});
assert.equal(wrongFollowThrough.ok, true);
assert.equal(wrongFollowThrough.diagnostics.embodiedDirectResponse.passed, false);

const partialButMisalignedFollowThrough = validateTavernVoiceRealization({
  speech: "行，看好了。",
  visibleAction: "人物甲把手里的东西放到一旁。",
  speechAct: "answer",
  characterId: SPEAKER,
  targetCharacterId: TARGET,
  voiceContract: strictVoiceContract,
  conversationRealization: embodiedClosePeerRealization,
  requiresSubstantiveAnswer: true,
  contextTopics: ["走一遍刚才练的招式"],
});
assert.equal(partialButMisalignedFollowThrough.ok, true);
assert.equal(partialButMisalignedFollowThrough.diagnostics.embodiedDirectResponse.hasVisibleFollowThrough, true);
assert.equal(partialButMisalignedFollowThrough.diagnostics.embodiedDirectResponse.speechActionAligned, false);

const strangerRelationship = [{
  otherCharacterId: TARGET,
  label: "初次见面的办事对象",
  allowedAddresses: ["阁下"],
  publicPressure: { closeness: 4, tension: 22 },
  ownedImpression: null,
}];
const strangerRealization = buildTavernConversationalRealization({
  voiceContract: buildTavernVoiceContract({ id: SPEAKER, name: "可移植人物甲" }, {
    targetCharacterId: TARGET,
    relationshipContext: strangerRelationship,
    identityMinimumScore: 0,
  }),
  candidate: responseCandidate,
  sourceImpact: directQuestion,
  relationshipContext: strangerRelationship,
});
assert.equal(strangerRealization.sharedContextBand, "low");
const strangerExplicitReply = validateTavernVoiceRealization({
  speech: "我想请你核对这份名录，也想说明来此的缘由。",
  speechAct: "answer",
  characterId: SPEAKER,
  targetCharacterId: TARGET,
  voiceContract: { ...voiceContract, activeContext: { ...voiceContract.activeContext, closeness: 4 } },
  conversationRealization: strangerRealization,
  requiresSubstantiveAnswer: true,
  contextTopics: ["核对名录", "说明来意"],
});
assert.equal(strangerExplicitReply.violations.some((entry) => entry.code === "MOTIVE_LEDGER_REGISTER"), false);

const strangerCompressedReply = validateTavernVoiceRealization({
  speech: "行，看好了。",
  visibleAction: "人物甲把手里的东西搁到一旁，退开半步，并指起势。",
  speechAct: "answer",
  characterId: SPEAKER,
  targetCharacterId: TARGET,
  voiceContract: {
    ...strictVoiceContract,
    activeContext: { ...strictVoiceContract.activeContext, closeness: 4 },
  },
  conversationRealization: strangerRealization,
  requiresSubstantiveAnswer: true,
  contextTopics: ["走一遍刚才练的招式"],
});
assert.equal(strangerCompressedReply.ok, true);
assert.equal(strangerCompressedReply.diagnostics.embodiedDirectResponse.highSharedContext, false);

const fixture = buildZhouMinTavernBehaviorAcceptanceFixture();
assert.equal(fixture.openingTurn, undefined, "Gate 8 must not prewrite Xie Zhenshi's opening line");
assert.equal(
  fixture.seedImpacts.some((impact) => impact.type === "speech" || impact.modality === "sound"),
  false,
  "Gate 8 must begin from perceived world facts rather than authored dialogue",
);
assert.equal(fixture.reviewScenario.authoringDialogueIncluded, false);
assert.ok(
  fixture.reviewScenario.targetCommittedAgentTurns >= 2,
  "the real sample must require two committed Character Agent turns to form a live exchange",
);

console.log("tavernConversationalRealization:test passed", {
  portableCharacterIds: [SPEAKER, TARGET],
  closePeerTurnMode: closePeerRealization.turnMode,
  closePeerSharedContextBand: closePeerRealization.sharedContextBand,
  prewrittenDialogue: false,
});
