import assert from "node:assert/strict";

import { buildPlayableWorldFromSetup } from "../../src/worldbuilding/skills.js";
import {
  prepareTavernCausalSlot,
  TAVERN_CAUSAL_DAY_SLOTS,
} from "../../src/server/pipeline/tavernCausalEconomy.mjs";

export const LUO_ZHAO_V2_QUALITY_IDS = Object.freeze({
  luo: "char_xyy_luozhao",
  xieZhenshi: "char_xyy_xiezenshi",
});

function confirmIdentity(character, otherCharacterId, basis = "") {
  character.agentMemory ||= {};
  character.agentMemory.identityKnowledge = [
    ...(character.agentMemory.identityKnowledge || []).filter((row) => row.characterId !== otherCharacterId),
    {
      characterId: otherCharacterId,
      status: "confirmed",
      confidenceBand: "high",
      basis,
    },
  ];
}

export function buildLuoZhaoTavernCharacterAgentV2QualityFixture() {
  const ids = LUO_ZHAO_V2_QUALITY_IDS;
  const initialState = buildPlayableWorldFromSetup({
    setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
    setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
  });
  const dawn = TAVERN_CAUSAL_DAY_SLOTS.find((slot) => slot.id === "dawn");
  const prepared = prepareTavernCausalSlot(initialState, { day: 1, slot: dawn });
  const tavern = prepared.state.tavernState;
  const visit = tavern.activeVisits.find((row) => row.visitorId === ids.luo);
  const luo = prepared.state.characters.find((row) => row.id === ids.luo);
  const xie = prepared.state.characters.find((row) => row.id === ids.xieZhenshi);
  const teapot = tavern.objectLedger.objects.tavern_vessel_teapot_1;
  assert.ok(visit && luo && xie && teapot);

  tavern.activeVisits = [visit];
  for (const character of prepared.state.characters) {
    character.lifeState.present = [ids.luo, ids.xieZhenshi].includes(character.id);
  }

  // This is a non-canonical quality cell that begins after an earlier ordinary
  // service exchange.  The starting fact is settled, not a prewritten answer:
  // Luo has paid for the best listed tea and has just obtained enough evidence
  // to know which young man is Xie Zhenshi.  What either person does next is
  // wholly owned by their Character Agent.
  visit.requestedService = "fine_cloud_tea_pot";
  visit.requestedServiceSource = "visitor_choice_before_probe";
  visit.serviceRequestStatus = "requested";
  visit.arrivalCue = "佩着剑，已经在堂前侧墙空桌落座";
  visit.purpose = "尚未说明";
  visit.purposeStatus = "undisclosed";
  visit.purposeAction = "";
  visit.purposeZoneIds = [];
  visit.personalOpenLoops = [];
  visit.businessStatus = "not_required";
  visit.serviceStatus = "served";
  visit.servicePreparationStatus = "delivered";
  visit.serviceConsumptionStatus = "pending";
  visit.serviceTransactionStatus = "completed";
  visit.servedOffering = "fine_cloud_tea_pot";
  visit.servedBy = ids.xieZhenshi;
  visit.servedObjectIds = [teapot.id];
  visit.paymentStatus = "paid";
  visit.paymentMode = "cash";
  visit.seatingPositionId = "position:tavern-hall-side-wall-table";
  tavern.guestPositionOccupancy ||= {};
  tavern.guestPositionOccupancy[visit.seatingPositionId] = [ids.luo];

  teapot.zoneId = "hall";
  teapot.holderActorId = "";
  teapot.custody = { storageMode: "placed", containerId: "", inHand: false };
  teapot.presentation = { exposure: "open", displayedToActorIds: [ids.luo], publiclyVisible: true };
  teapot.state = {
    ...(teapot.state || {}),
    contents: "fine_cloud_tea_pot",
    preparedForVisitId: "",
    servedVisitId: visit.id,
    servedToActorId: ids.luo,
    servedByActorId: ids.xieZhenshi,
    servedByActionId: "historical-service:luozhao-fine-tea",
  };

  confirmIdentity(luo, ids.xieZhenshi, "先前店中称呼、年龄与本人观察已经相互印证");
  xie.lifeState.currentActivity = {
    type: "tavern_service",
    description: "刚把一壶云岫春芽放到洛照桌边，手正从壶柄上收回",
  };
  luo.lifeState.currentActivity = {
    type: "visit",
    description: "佩剑坐在堂前安静处，刚确认送茶的年轻人就是谢真石",
  };

  const seedImpactId = "impact:v2-quality:xie-serves-luo-fine-tea";
  return {
    state: prepared.state,
    slotContext: prepared.slotContext,
    characterIds: [ids.luo, ids.xieZhenshi],
    positions: {
      [ids.luo]: "hall",
      [ids.xieZhenshi]: "hall",
    },
    seedImpacts: [{
      id: seedImpactId,
      sourceCharacterId: ids.xieZhenshi,
      sourceZoneId: "hall",
      type: "visible_action",
      modality: "visual",
      intensity: 94,
      radius: 2.5,
      directedTargetId: ids.luo,
      content: "谢真石把一壶刚泡好的云岫春芽放到洛照桌边，手从壶柄上收回；茶汤还在冒热气。",
      topic: "送上已点的云岫春芽",
      speechAct: "none",
      objectIds: [teapot.id],
      publicEvent: true,
    }],
    reviewScenario: {
      canonical: false,
      purpose: "检验 Character Agent v2 是否把情绪、欲望、克制、关系判断和人物嗓音组织进同一因果回合",
      storyTime: "第一集《璞玉》开场前，清晨，同一连续时刻",
      location: "望梯酒馆堂前",
      objectiveFacts: [
        "洛照已经自行点了价牌上最贵的云岫春芽并付清六文；茶刚由谢真石送到桌边，仍然很烫。",
        "洛照此前只知道传闻；到这个测试起点，她刚凭店中称呼、年龄与本人观察确认送茶者就是谢真石。",
        "洛照佩剑不离身；谢真石在自家酒馆做完一次真实送茶动作，两人同处堂前、彼此可见可听。",
        "当前堂前只有洛照与谢真石，没有第三方观众；堂前仍有热茶和桌椅，动剑存在场所规矩与财物风险。后院不是访客可自行进入的公共区域，但可由双方协商并由有权限的人临时带入。",
        "世界只提供人物、场所、物件、路线、许可与后果，不替任何一方决定观察、提议、接受、拒绝、换地方、喝茶、沉默或离开。",
        "没有为任何一方预写台词、候选、动作结果、情绪结论或关系变化。",
      ],
      targetAgentActivations: 2,
      stagesPerActivation: 4,
      hardRemoteRequestLimit: 8,
      authoringDialogueIncluded: false,
      expectedActionIncluded: false,
      authorAcceptanceRequired: true,
    },
  };
}
