import assert from "node:assert/strict";

import { buildPlayableWorldFromSetup } from "../../src/worldbuilding/skills.js";
import {
  prepareTavernCausalSlot,
  TAVERN_CAUSAL_DAY_SLOTS,
} from "../../src/server/pipeline/tavernCausalEconomy.mjs";

export const ZHOU_MIN_BEHAVIOR_ACCEPTANCE_IDS = Object.freeze({
  zhou: "char_xyy_zhoumin",
  xieZhenshi: "char_xyy_xiezenshi",
  xieMother: "char_xyy_xiemu",
});

export function buildZhouMinTavernBehaviorAcceptanceFixture() {
  const ids = ZHOU_MIN_BEHAVIOR_ACCEPTANCE_IDS;
  const initialState = buildPlayableWorldFromSetup({
    setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
    setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
  });
  const noon = TAVERN_CAUSAL_DAY_SLOTS.find((slot) => slot.id === "noon");
  const prepared = prepareTavernCausalSlot(initialState, { day: 1, slot: noon });
  const visit = prepared.state.tavernState.activeVisits.find((item) => item.visitorId === ids.zhou);
  assert.ok(visit, "逍遥游正式种子必须包含周珉送药来访");

  for (const character of prepared.state.characters) {
    character.lifeState.present = [ids.zhou, ids.xieZhenshi].includes(character.id);
  }

  // The scene begins after Zhou Min has already stated the delivery purpose.
  // Xie Mother is briefly outside the active scene, so the medicine cannot be
  // verified yet. Both present Characters receive only the objective sight of
  // the stalled handoff. Neither person's first line or next action is authored.
  visit.expectedHostIds = [ids.xieMother];
  visit.hostId = ids.xieMother;
  visit.receivedBy = ids.xieMother;
  visit.purposeStatus = "declared";
  visit.purposeDisclosureStatus = "declared";
  visit.declaredPurpose = visit.purpose;
  visit.stage = "received";
  visit.deliveryStatus = "pending";
  delete visit.objectiveGraph;
  delete visit.objectives;
  delete visit.objectiveSummary;

  return {
    state: prepared.state,
    slotContext: prepared.slotContext,
    characterIds: [ids.zhou, ids.xieZhenshi],
    positions: {
      [ids.zhou]: "hall",
      [ids.xieZhenshi]: "hall",
    },
    seedImpacts: [
      {
        id: "impact:zhoumin:behavior-acceptance-current-moment",
        sourceCharacterId: "world:current-tavern-state",
        sourceZoneId: "hall",
        type: "situation",
        modality: "visual",
        intensity: 96,
        radius: 0,
        directedTargetId: ids.zhou,
        content: "周珉看见柜台后暂时无人；药包要等谢母回来验收。谢真石此刻就在堂前，二人彼此看得见也听得见。",
        topic: "送药暂时受阻时的堂前现状",
      },
      {
        id: "impact:xiezenshi:behavior-acceptance-current-moment",
        sourceCharacterId: "world:current-tavern-state",
        sourceZoneId: "hall",
        type: "situation",
        modality: "visual",
        intensity: 94,
        radius: 0,
        directedTargetId: ids.xieZhenshi,
        content: "谢真石看见周珉带着药包和清单留在柜台附近；谢母暂时不在堂前，这次交接眼下无法验收。周珉尚未离开。",
        topic: "熟人送药受阻时的堂前现状",
      },
    ],
    reviewScenario: {
      storyTime: "第一集《璞玉》开场前，正午，同一连续时刻",
      location: "望梯酒馆堂前",
      objectiveFacts: [
        "周珉已经说明送药来意，药包与清单仍由他持有。",
        "只有谢母有权完成这次药物验收，但她暂时不在当前场景。",
        "谢真石与周珉都在堂前，彼此可见、可听、可直接接近。",
        "当前没有人为谢真石或周珉写好第一句话、下一步或必须开口的世界规则。",
      ],
      authoringAnswerIncluded: false,
      authoringDialogueIncluded: false,
      expectedActionIncluded: false,
      outboundCharacterIds: [ids.xieZhenshi, ids.zhou],
      targetCommittedAgentTurns: 2,
      boundedRecoveryAgentTurns: 1,
      possibleRemoteRequests: "目标形成 2 个已提交人物行动；若前一决定被硬闸拒绝，最多容许 1 个同场恢复回合。每次激活的首份实现若被拒绝，最多追加 1 次同候选修正，因此远程请求硬上限为 6",
    },
  };
}
