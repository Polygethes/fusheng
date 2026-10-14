import assert from "node:assert/strict";

import {
  buildCharacterAgentStageInput,
  createCharacterAgentTurnSession,
} from "../src/server/simulation/characterAgentTurnProtocol.mjs";

const TARGET = "perceived_entity:counterpart";
const EVIDENCE = "evidence:directed-attention";

function finalSurfaceFor({ characterId, voiceContract, privateMarker, candidateMarker }) {
  const created = createCharacterAgentTurnSession({
    agentTurnId: `turn:preverbal-boundary:${characterId}`,
    characterId,
    worldProjection: {
      authority: "recipient-specific-world-projection",
      scene: { id: "scene:generic-room", elapsedSeconds: 12 },
      evidence: [{ evidenceId: EVIDENCE, modality: "visual", content: "对方似乎在留意你，但具体落点并不清楚。" }],
      perceivedImpacts: [],
      perceivedCharacters: [{ id: TARGET, identityKnown: false }],
      perceivedObjects: [],
      affordances: [],
      reachableZones: [{ id: "room" }],
    },
    privateContext: { voiceContract },
  });
  return buildCharacterAgentStageInput({
    ...created,
    phase: "awaiting_agent_realization",
    generatedCandidates: [{
      originAuthority: "character-agent",
      candidateId: "candidate:ask-about-attention",
      intention: candidateMarker,
      attemptPrimitive: "speak",
      targetHandle: TARGET,
      perceivedPrerequisites: [EVIDENCE],
      timingIntent: "now",
      disclosureNeed: "minimal",
    }],
    agentChoice: {
      ownerAuthority: "character-agent",
      agentTurnId: created.agentTurnId,
      selectedCandidateId: "candidate:ask-about-attention",
      privateDecisionBasis: privateMarker,
      regulationChoice: { ownerAuthority: "character-agent", regulationChoiceId: `regulation:${characterId}` },
      automaticCommunicationImpulse: {
        ownerAuthority: "character-agent",
        impulseId: `impulse:${characterId}`,
        mode: "speech",
        triggerEvidenceIds: [EVIDENCE],
        discourseAnchorIds: [],
        motiveSourceIds: [],
        perceivedTurnDemand: "确认刚才那一点注意是否真实指向自己",
        feltTendency: "直接问清对方是否在看自己",
        urgency: 0.48,
        disclosurePressure: 0.42,
        inhibitionPressure: 0.34,
        conflict: { present: false, opposingSourceIds: [], description: "" },
      },
    },
    regulatedExpressionPlan: {
        ownerAuthority: "character-agent",
        sourceImpulseId: `impulse:${characterId}`,
        impulseTransformation: { treatment: "blend", privateBasis: "保留确认冲动，不公开背后的完整判断。" },
        mode: "mixed",
        actionIntent: "抬眼确认对方是否愿意回应",
        publicStance: {
          interactionMove: "ask",
          releasedMeaning: "想确认对方刚才是否在留意自己",
          audienceCharacterIds: [TARGET],
          disclosure: "partial",
          epistemicRelation: "uncertain",
          intendedEffect: "让对方表明那一点注意是否指向自己",
          threadDisposition: "open_new",
          sharedContextAnchorIds: [],
          sharedContextTreatment: "not_applicable",
        },
        nonverbalUndertone: "已经察觉，但不急着暴露判断",
        privateRemainderPresent: true,
        relationshipStance: "初见时仍保留距离",
        timing: "during_action",
        turnYield: "yield",
      },
    regulationOutcome: {
      authority: "character-private-psychology-tool",
      sourceRegulationChoiceId: `regulation:${characterId}`,
      channelLeakagePressures: { gaze: 0.68, voiceOnset: 0.42 },
      remainingControl: 0.62,
      regulationCost: 0.28,
    },
  });
}

const xie = finalSurfaceFor({
  characterId: "char_xyy_xiezenshi",
  privateMarker: "PRIVATE_XIE_REASON_MUST_NOT_REACH_WORDING",
  candidateMarker: "PRIVATE_XIE_CANDIDATE_RATIONALE_MUST_NOT_REACH_WORDING",
  voiceContract: {
    characterId: "char_xyy_xiezenshi",
    voiceFormation: { qualitativeCore: ["年轻、反应快，熟悉剑时好奇会先于客套", "碰到弱处会收紧或嘴硬"] },
  },
});
const luo = finalSurfaceFor({
  characterId: "char_xyy_luozhao",
  privateMarker: "PRIVATE_LUO_REASON_MUST_NOT_REACH_WORDING",
  candidateMarker: "PRIVATE_LUO_CANDIDATE_RATIONALE_MUST_NOT_REACH_WORDING",
  voiceContract: {
    characterId: "char_xyy_luozhao",
    voiceFormation: { qualitativeCore: ["冷静、克制，不为缓和气氛多说", "遇到真正值得看的剑时兴奋从注意和节奏漏出来"] },
  },
});

for (const input of [xie, luo]) {
  const serialized = JSON.stringify(input);
  assert.equal(input.worldProjection, undefined);
  assert.equal(input.privateContext, undefined);
  assert.equal(input.subjectiveAppraisal, undefined);
  assert.equal(input.psychologySnapshot, undefined);
  assert.equal(input.agentChoice, undefined);
  assert.equal(input.selectedAction.intention, undefined, "candidate rationale must not be forwarded as a wording brief");
  assert.equal(serialized.includes("PRIVATE_"), false, "private reasons and candidate rationale must stop before literal wording");
  assert.equal(input.regulatedExpressionPlan.publicStance.releasedMeaning, "想确认对方刚才是否在留意自己");
  assert.deepEqual(input.regulatedExpressionPlan.publicStance.audienceCharacterIds, [TARGET]);
  assert.equal(input.regulatedExpressionPlan.communicationPlan, undefined);
  assert.equal(input.regulatedExpressionPlan.privateRemainder.present, true);
  assert.equal(input.regulatedExpressionPlan.turnYield, "yield");
}

assert.notDeepEqual(xie.voiceContract, luo.voiceContract, "the same public move must still reach two different character voices");
assert.deepEqual(
  xie.regulatedExpressionPlan.publicStance.releasedMeaning,
  luo.regulatedExpressionPlan.publicStance.releasedMeaning,
  "voice differentiation must not depend on changing the objective conversational move",
);

console.log(JSON.stringify({
  status: "passed",
  checks: {
    privateReasonStoppedBeforeWording: true,
    candidateRationaleStoppedBeforeWording: true,
    observerRelativeWorldSurfacePreserved: true,
    samePublicMoveKeepsDistinctVoices: true,
    deferredMeaningRedactedBeforeWording: true,
    abstractCommunicationLedgerRedactedBeforeWording: true,
    noLiteralLinePrewritten: true,
  },
}, null, 2));
