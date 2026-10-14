import assert from "node:assert/strict";

import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import {
  prepareTavernCausalSlot,
  TAVERN_CAUSAL_DAY_SLOTS,
} from "../src/server/pipeline/tavernCausalEconomy.mjs";
import {
  buildTavernSceneRuntime,
  runTavernCausalScene,
} from "../src/server/pipeline/tavernCausalScene.mjs";

const MOTHER = "char_xyy_xiemu";
const YAN = "char_xyy_yanzhizhong";
const noon = TAVERN_CAUSAL_DAY_SLOTS.find((slot) => slot.id === "noon");

function activeYanVisit(state) {
  return (state.tavernState?.activeVisits || []).find((visit) => visit.visitorId === YAN) || null;
}

function makePreparedVisit() {
  const state = buildPlayableWorldFromSetup({
    setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
    setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
  });
  state.ui.timeGrain = "day";
  state.ui.engineMode = "openai";
  state.tavernState.candidateNotices = [{
    id: "candidate_notice_position_provenance_luozhao",
    status: "pending",
    candidateId: "char_xyy_luozhao",
    candidateName: "洛照",
    sourceVisitId: "visit_position_provenance_luozhao",
    recordKind: "候选留宿与接引登记",
    reason: "洛照持玉衡宗拜帖在望梯酒馆留宿等接引",
    createdDay: 1,
    createdSlot: "黄昏",
  }];
  const prepared = prepareTavernCausalSlot(state, { day: 2, slot: noon });
  assert.ok(activeYanVisit(prepared.state), "fixture must create Yan Zhizhong's business visit");
  return prepared;
}

function keepVisitUndeclared(state) {
  const visit = activeYanVisit(state);
  Object.assign(visit, {
    purposeStatus: "undisclosed",
    purposeDisclosureStatus: "undisclosed",
    declaredPurpose: "",
    purposeDeclaredByActionId: "",
    hostId: "",
    stage: "waiting",
  });
  return visit;
}

const stale = makePreparedVisit();
keepVisitUndeclared(stale.state);
stale.state.tavernState.sceneRuntime = {
  agents: {
    [YAN]: {
      characterId: YAN,
      present: true,
      zoneId: "courtyard",
      ecologyState: { presence: { locationId: "loc_xyy_tavern", zoneId: "courtyard", observableAtStage: true } },
    },
  },
};

const directRestore = buildTavernSceneRuntime(stale.state, {
  characterIds: [MOTHER, YAN],
  positions: { [MOTHER]: "hall" },
});
assert.equal(
  directRestore.agents[YAN]?.zoneId,
  "threshold",
  "an undeclared visitor's unproven legacy zone must not revive inside the tavern",
);
assert.equal(
  directRestore.agents[YAN]?.ecologyState?.presence?.zoneId,
  "threshold",
  "restored public and ecology positions must have one source of truth",
);

const slotRestore = prepareTavernCausalSlot(stale.state, { day: 2, slot: noon });
assert.equal(
  slotRestore.positions[YAN],
  "threshold",
  "macro-slot restoration must apply the same visitor position validation",
);

const moving = makePreparedVisit();
keepVisitUndeclared(moving.state);
const movement = await runTavernCausalScene(moving.state, {
  characterIds: [YAN],
  positions: { [YAN]: "threshold" },
  seedImpacts: [{
    id: "position-provenance:reception-unattended",
    sourceCharacterId: "world:threshold",
    sourceZoneId: "threshold",
    type: "institution",
    modality: "memory",
    intensity: 100,
    radius: 0,
    directedTargetId: YAN,
    content: "门槛处看不到能经手这次公务的人。",
    topic: "寻找经手人",
  }],
  slotContext: { day: 2, slotId: "position-provenance:approach", slotLabel: "正午", slotBaseId: "noon" },
  maxSteps: 1,
  minimumActivationScore: 0,
  async runAgent(input) {
    const affordance = input.availableAffordances.find((item) => item.type === "approach_reception");
    const candidate = input.privateActionCandidates.find((item) => item.realization?.affordanceId === affordance?.id);
    assert.ok(affordance, "fixture must offer a lawful approach_reception movement");
    return { decision: {
      candidateId: candidate?.candidateId || "",
      actionType: affordance.actionType,
      speechAct: "none",
      targetCharacterId: "",
      speech: "",
      visibleAction: "",
      moveToZoneId: affordance.moveToZoneId,
      affordanceId: affordance.id,
      informationSourceImpactId: "position-provenance:reception-unattended",
      commitmentAction: "none",
      commitmentTopic: "",
      privateReason: "门槛处没有经手人，先走到堂前寻找；来意仍由自己稍后说明。",
    } };
  },
});

const movementAction = movement.actions.find((action) => action.actorId === YAN);
assert.equal(movementAction?.worldResolution?.movementCommitted, true, "fixture movement must be committed by the world");
assert.equal(movement.sceneRuntime.agents[YAN]?.zoneId, "hall");
assert.deepEqual(
  movement.sceneRuntime.agents[YAN]?.zoneProvenance,
  {
    schemaVersion: 1,
    authority: "world-movement-commit",
    sourceActionId: movementAction.id,
    fromZoneId: "threshold",
    toZoneId: "hall",
    committedAtStep: 1,
  },
  "a committed movement must persist objective provenance with the resulting zone",
);

const carried = structuredClone(moving.state);
carried.tavernState.sceneRuntime = structuredClone(movement.sceneRuntime);
const carriedRuntime = buildTavernSceneRuntime(carried, {
  characterIds: [YAN],
  positions: {},
});
assert.equal(
  carriedRuntime.agents[YAN]?.zoneId,
  "hall",
  "a proven committed movement must survive a direct runtime rebuild",
);
const carriedSlot = prepareTavernCausalSlot(carried, { day: 2, slot: noon });
assert.equal(
  carriedSlot.positions[YAN],
  "hall",
  "a proven committed movement must survive the next macro-slot preparation",
);

console.log("tavern visitor position provenance contracts passed");
