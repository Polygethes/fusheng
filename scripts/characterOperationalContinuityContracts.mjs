import assert from "node:assert/strict";

import { createCharacterAgentMemoryState } from "../src/engine/characterAgentMemory.js";
import {
  TAVERN_SCENE_TOPOLOGY,
} from "../src/server/pipeline/tavernCausalScene.mjs";
import {
  tavernCausalMaterialFacts,
  tavernSettledInteractionEvents,
} from "../src/server/pipeline/tavernCausalEconomy.mjs";
import { createTavernCharacterAgentV2Session } from "../src/server/pipeline/tavernCharacterAgentV2.mjs";
import { buildCharacterAgentStageInput } from "../src/server/simulation/characterAgentTurnProtocol.mjs";
import {
  deriveCharacterDiscourseContext,
  mergeCharacterRecentOwnActions,
  seedCharacterOwnedOperationMemory,
} from "../src/server/simulation/characterOperationalContinuity.mjs";
import {
  buildLuoZhaoTavernCharacterAgentV2QualityFixture,
  LUO_ZHAO_V2_QUALITY_IDS,
} from "./fixtures/luoZhaoTavernCharacterAgentV2QualityFixture.mjs";

const fixture = buildLuoZhaoTavernCharacterAgentV2QualityFixture();
const { luo: LUO, xieZhenshi: XIE } = LUO_ZHAO_V2_QUALITY_IDS;
const BYSTANDER = "char_xyy_xieheng";
const runtime = {
  id: "runtime:operational-continuity",
  locationId: "loc_xyy_tavern",
  topology: TAVERN_SCENE_TOPOLOGY,
  elapsedSeconds: 4,
  step: 2,
  agents: {
    [LUO]: { characterId: LUO, characterName: "洛照", present: true, zoneId: "hall" },
    [XIE]: { characterId: XIE, characterName: "谢真石", present: true, zoneId: "hall" },
    [BYSTANDER]: { characterId: BYSTANDER, characterName: "谢恒", present: true, zoneId: "hall" },
  },
  actions: [],
};

const xieFacts = tavernCausalMaterialFacts(fixture.state, runtime, XIE, [LUO], ["tavern_vessel_teapot_1"]);
assert.equal(xieFacts.length, 1);
assert.equal(xieFacts[0].requestedService, "fine_cloud_tea_pot", "the person who served an offering must know which offering he served");
assert.equal(xieFacts[0].serviceStatus, "served", "the server must retain the settled service state");
assert.equal(xieFacts[0].servicePreparationStatus, "delivered");
assert.equal(xieFacts[0].purpose, "尚未说明", "serving a guest must not reveal the guest's undisclosed private purpose");
assert.equal(xieFacts[0].paymentStatus, "unknown", "service participation alone must not leak a separately handled payment state");
assert.ok(xieFacts[0].authoritativeFact.includes("云岫春芽已经交付"));

const bystanderFacts = tavernCausalMaterialFacts(fixture.state, runtime, BYSTANDER, [LUO], ["tavern_vessel_teapot_1"]);
assert.equal(bystanderFacts[0].requestedService, "unknown");
assert.equal(bystanderFacts[0].serviceStatus, "unknown");
assert.deepEqual(bystanderFacts[0].settledInteractionEvents, []);

const settledEvents = tavernSettledInteractionEvents(fixture.state, XIE);
const serviceEvent = settledEvents.find((event) => event.kind === "service_delivery");
assert.ok(serviceEvent, "explicit object provenance must reconstruct the settled service event");
assert.equal(serviceEvent.actorId, XIE);
assert.equal(serviceEvent.actionId, "historical-service:luozhao-fine-tea");
assert.deepEqual(serviceEvent.participantIds.sort(), [LUO, XIE].sort());
assert.ok(serviceEvent.summary.includes("亲手把一壶云岫春芽交给洛照"));

let memory = seedCharacterOwnedOperationMemory(createCharacterAgentMemoryState(XIE), {
  characterId: XIE,
  settledInteractionEvents: settledEvents,
  nowSeconds: 4,
  worldDay: 1,
  locationId: "loc_xyy_tavern",
  zoneId: "hall",
});
const ownServiceEpisodes = memory.episodes.filter((episode) => (
  episode.source?.kind === "self_action"
  && episode.source?.sourceActionId === serviceEvent.actionId
));
assert.equal(ownServiceEpisodes.length, 1, "pre-scene settled self-actions must enter first-person episodic memory once");
assert.ok(ownServiceEpisodes[0].perception.content.includes("云岫春芽"));
assert.equal(JSON.stringify(ownServiceEpisodes[0]).includes("验证谢真石"), false, "private visitor purpose must not leak into the server's self-action memory");
memory = seedCharacterOwnedOperationMemory(memory, {
  characterId: XIE,
  settledInteractionEvents: settledEvents,
  nowSeconds: 12,
  worldDay: 1,
  locationId: "loc_xyy_tavern",
  zoneId: "hall",
});
assert.equal(memory.episodes.filter((episode) => episode.source?.sourceActionId === serviceEvent.actionId).length, 1, "rebuilding a scene input must not rehearse the same self-action into duplicate memories");

const recentOwnActions = mergeCharacterRecentOwnActions({
  characterId: XIE,
  settledInteractionEvents: settledEvents,
  runtimeActions: [],
});
assert.equal(recentOwnActions.length, 1);
assert.equal(recentOwnActions[0].actionType, "serve_guest");
assert.equal(recentOwnActions[0].settled, true);

const discourseContext = deriveCharacterDiscourseContext({
  characterId: XIE,
  settledInteractionEvents: settledEvents,
  recentOwnActions,
  openConversationThreads: [],
});
assert.ok(discourseContext.anchorIds.includes(serviceEvent.id));
assert.equal(discourseContext.settledSharedEvents[0].summary, serviceEvent.summary);
assert.equal(discourseContext.interpretationBoundary.includes("撒谎"), true, "shared facts must remain materials, not a censorship rule");

const xie = fixture.state.characters.find((character) => character.id === XIE);
const session = createTavernCharacterAgentV2Session({
  scene: { id: "scene:operational-continuity", step: 2, elapsedSeconds: 4, zoneId: "hall", zoneLabel: "堂前" },
  agent: {
    id: XIE,
    name: "谢真石",
    privateState: { ecologyProfile: {}, ecologyState: {} },
    psychologyAnchor: {},
    memoryContext: { episodes: ownServiceEpisodes },
    relationshipContext: [],
    voiceContract: {},
  },
  perceivedCharacters: [{ id: LUO, name: "洛照", identityKnown: true, zoneId: "hall" }],
  perceivedImpacts: [],
  perceivedObjects: [],
  availableAffordances: [],
  materialFacts: xieFacts,
  settledInteractionEvents: settledEvents,
  discourseContext,
  recentOwnActions,
  openConversationThreads: [],
  reachableZones: [{ id: "hall", label: "堂前" }],
});
assert.equal(session.worldProjection.materialFacts[0].serviceStatus, "served");
assert.equal(session.worldProjection.recentOwnActions[0].actionType, "serve_guest");
assert.ok(session.worldProjection.discourseContext.anchorIds.includes(serviceEvent.id));
assert.ok(session.privateContext.memoryContext.episodes.some((episode) => episode.source?.kind === "self_action"));

const realizationSession = {
  ...session,
  phase: "awaiting_agent_realization",
  generatedCandidates: [{
    originAuthority: "character-agent",
    candidateId: "candidate:continue-conversation",
    attemptPrimitive: "speak",
    targetHandle: LUO,
    perceivedPrerequisites: [],
    domains: ["social"],
    desireRelations: [],
    criterionUses: [],
    sharedActivity: null,
    timingIntent: "now",
    disclosureNeed: "partial",
  }],
  agentChoice: {
    selectedCandidateId: "candidate:continue-conversation",
    goalPreservation: null,
    automaticCommunicationImpulse: {
      ownerAuthority: "character-agent",
      impulseId: "impulse:operational-continuity",
      mode: "speech",
      triggerEvidenceIds: [],
      discourseAnchorIds: [serviceEvent.id],
      motiveSourceIds: [],
      perceivedTurnDemand: "回应来客",
      feltTendency: "接着眼前的事说",
      urgency: 0.36,
      disclosurePressure: 0.38,
      inhibitionPressure: 0.22,
      conflict: { present: false, opposingSourceIds: [], description: "" },
    },
  },
  regulatedExpressionPlan: {
      ownerAuthority: "character-agent",
      sourceImpulseId: "impulse:operational-continuity",
      impulseTransformation: { treatment: "express", privateBasis: "承接已完成的服务事实，不重新询问。" },
      mode: "speech",
      actionIntent: "回应来客",
      publicStance: {
        interactionMove: "answer",
        releasedMeaning: "承接已经完成的服务继续回应来客",
        audienceCharacterIds: [LUO],
        disclosure: "partial",
        epistemicRelation: "believes",
        intendedEffect: "让眼前交流继续",
        threadDisposition: "continue",
        sharedContextAnchorIds: [serviceEvent.id],
        sharedContextTreatment: "accept_as_given",
      },
      nonverbalUndertone: "",
      privateRemainderPresent: false,
      relationshipStance: "待客",
      timing: "standalone",
      turnYield: "yield",
    },
  regulationOutcome: {},
};
const realizationInput = buildCharacterAgentStageInput(realizationSession);
assert.equal(realizationInput.worldSurface.materialFacts[0].serviceStatus, "served");
assert.equal(realizationInput.worldSurface.recentOwnActions[0].actionType, "serve_guest");
assert.ok(realizationInput.worldSurface.discourseContext.anchorIds.includes(serviceEvent.id));
assert.deepEqual(realizationInput.regulatedExpressionPlan.publicStance.sharedContextAnchorIds, [serviceEvent.id]);
assert.equal(realizationInput.regulatedExpressionPlan.publicStance.sharedContextTreatment, "accept_as_given");

assert.ok(xie, "fixture character remains intact");
console.log(JSON.stringify({
  status: "passed",
  checks: {
    serviceActorKnowsOwnOperation: true,
    separatePaymentPrivacyPreserved: true,
    bystanderIsolationPreserved: true,
    preSceneSelfActionEncodedOnce: true,
    recentOwnActionRestored: true,
    discourseContextReachesRealization: true,
    deliberateLyingForgettingAndReopeningRemainCharacterOwned: true,
  },
}, null, 2));
