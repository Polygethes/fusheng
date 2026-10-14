import fs from "node:fs";
import { buildCharacterFoundationProbeInput } from "../../src/server/ecology/characterFoundationBlindProbe.mjs";
import { compileEmbodiedPositionAffordances } from "../../src/server/simulation/embodiedSpatialChoice.mjs";
import { compileSituatedServiceAffordances } from "../../src/server/simulation/situatedServiceChoice.mjs";
import {
  buildLuoZhaoPositionOptions,
  LUO_ZHAO_SPATIAL_POSITION_PROBE_IDS,
} from "./luoZhaoSpatialPositionProbeFixture.mjs";

const BASE = LUO_ZHAO_SPATIAL_POSITION_PROBE_IDS;
export const LUO_ZHAO_TAVERN_ENTRY_CHOICE_IDS = Object.freeze({
  ...BASE,
  COINS: "resource:luozhao:current-copper-coins",
  SERVICES_FACT: "fact:tavern-visible-current-tea-meal-offers",
  TABLE_NORM_FACT: "fact:tavern-public-table-use-norm",
  REQUEST_HOT_WATER: "affordance:service-request:char_xyy_luozhao:hot_water",
  REQUEST_TEA: "affordance:service-request:char_xyy_luozhao:rough_mountain_tea",
  REQUEST_MEAL: "affordance:service-request:char_xyy_luozhao:wangti_basic_meal",
});

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(new URL(relativePath, import.meta.url), "utf8"));
}

function offering(scene, id, needChannels) {
  const source = scene.economy?.offerings?.find((row) => row.id === id);
  if (!source) throw new TypeError(`洛照入店盲测缺少酒馆服务 ${id}`);
  return {
    id: source.id,
    label: source.label,
    available: true,
    price: {
      amount: source.priceWen,
      currencyId: scene.economy.currency.id,
      knownToActor: true,
    },
    needChannels,
    observableEffects: [...(source.bodyEffects || [])],
  };
}

export function buildLuoZhaoTavernEntryChoiceProbeInput() {
  const IDS = LUO_ZHAO_TAVERN_ENTRY_CHOICE_IDS;
  const foundation = readJson(
    "../../.codex/anchors/scene_xyy_wangti_tavern/characters/char_xyy_luozhao/character-foundation.json",
  );
  const memorySeed = readJson(
    "../../.codex/anchors/scene_xyy_wangti_tavern/characters/char_xyy_luozhao/memory-seed.json",
  );
  const scene = readJson("../../.codex/anchors/scene_xyy_wangti_tavern/scene-contract.json");
  const arrivalMemory = memorySeed.episodes.find((row) => row.id === IDS.ARRIVAL_MEMORY);
  const hearsayBelief = memorySeed.beliefs.find((row) => row.id === IDS.HEARSAY_BELIEF);
  if (!arrivalMemory || !hearsayBelief) throw new TypeError("洛照入店盲测缺少本人到店记忆或带来源的谢真石传闻");

  const spatialChoice = {
    currentPosition: { id: IDS.THRESHOLD_POSITION, zoneId: "threshold" },
    positionOptions: buildLuoZhaoPositionOptions(IDS),
    carriedObjects: [{
      id: IDS.SWORD,
      label: "洛照的佩剑",
      holderActorId: IDS.LUO,
      portable: true,
      state: { sheathed: true },
      attachment: {
        active: true,
        actorId: IDS.LUO,
        mode: "worn_on_body_unspecified",
        transitionRequiresExplicitOperation: true,
      },
    }],
  };
  const serviceChoice = {
    operatorActorIds: [IDS.XIE_MOTHER],
    bodyNeeds: {
      hunger: 0.26,
      thirst: 0.42,
      fatigue: 0.24,
    },
    ownedTender: [{
      id: IDS.COINS,
      currencyId: scene.economy.currency.id,
      amount: 8,
    }],
    offers: [
      offering(scene, "hot_water", ["thirst", "stay_legitimacy"]),
      offering(scene, "rough_mountain_tea", ["thirst", "stay_legitimacy", "information_cover"]),
      offering(scene, "wangti_basic_meal", ["hunger", "fatigue", "stay_legitimacy"]),
    ],
    tableUseNorm: {
      id: "norm_public_table_use_during_business",
      sitWithoutOrderingPhysicallyPossible: true,
      operatorResponseRequiresOwnAction: true,
      pressureOnset: "洛照真实占用客桌且谢母实际注意到尚无消费或来意后，随停留时间产生",
    },
    currentTransactionState: "none",
    stateScope: "本次 Holdout 的当前状态，不编译为洛照永久饥渴、钱财或固定消费习惯。",
  };
  const positionAffordances = compileEmbodiedPositionAffordances({
    actorId: IDS.LUO,
    ...spatialChoice,
  });
  const serviceAffordances = compileSituatedServiceAffordances({
    actorId: IDS.LUO,
    ...serviceChoice,
  });

  return buildCharacterFoundationProbeInput({
    probeId: "probe:luozhao:integrated-tavern-entry-choice",
    character: { id: IDS.LUO, name: "洛照" },
    foundation,
    dynamicState: {
      desireIntensity: 0.8,
      frustration: 0.08,
      domainExcitement: 0.04,
      hunger: serviceChoice.bodyNeeds.hunger,
      thirst: serviceChoice.bodyNeeds.thirst,
      fatigue: serviceChoice.bodyNeeds.fatigue,
    },
    ownedMemory: {
      episodes: [arrivalMemory],
      beliefs: [hearsayBelief],
      commitments: [],
    },
    relationshipContext: [{
      targetCharacterId: IDS.XIE_MOTHER,
      knownRelationship: "刚看见的望梯酒馆经营者",
      directlyExperiencedEvidenceIds: [],
      informationBoundary: "洛照只看见谢母在柜台内忙碌；没有共同往事、私人信任、欠负或已经发生的接待。",
    }],
    world: {
      sceneId: scene.sceneId,
      locationId: "loc_xyy_tavern",
      zoneId: "threshold",
      atmosphere: {
        publicScrutiny: 0.48,
        crowding: 0.54,
        privacy: 0.14,
        timePressure: 0.18,
      },
      objectiveFacts: [
        {
          id: IDS.SWORD_WORN_FACT,
          content: "洛照的佩剑仍在鞘中并贴身佩带。她移动或落座时，佩剑随身体一起移动；当前没有解除佩带、放置或转交的已提交动作。",
          evidenceStrength: "direct",
        },
        {
          id: IDS.NO_MARTIAL_CUE_FACT,
          content: "当前视听范围内没有任何人同时满足洛照用于核实谢真石身份的多项条件，也没有出现高价值剑术证据。",
          evidenceStrength: "direct",
        },
        {
          id: IDS.NO_GREETING_FACT,
          content: "洛照刚站到门槛内，当前没有人向她说话、招手、要求等待或替她安排座位。",
          evidenceStrength: "direct",
        },
        {
          id: IDS.INFORMATION_AVAILABLE_FACT,
          content: "堂前存在正在继续的普通交谈；不同空位能听见和看见的范围、被人注意或搭话的概率、人流干扰与活动空间各不相同。",
          evidenceStrength: "direct",
        },
        {
          id: IDS.SERVICES_FACT,
          content: "洛照能看见柜台旁当日价牌和可用茶饭器具：热水免费，粗焙山茶一文，望梯常饭五文；谢母在有效声路内，提出请求只会打开待回应的服务事务，不会自动端上茶饭或扣钱。",
          evidenceStrength: "direct",
        },
        {
          id: IDS.TABLE_NORM_FACT,
          content: "营业时占用客桌通常会点茶饭或向经营者说明来意；不消费仍可实际坐下，只有经营者亲眼注意后自行采取招呼、询问或设限，社会压力才会继续发展。",
          evidenceStrength: "direct",
        },
      ],
      perceivedEvents: [{
        id: IDS.LAYOUT_EVENT,
        type: "direct_environment_and_service_perception",
        sourceCharacterId: IDS.LUO,
        directedTargetId: IDS.LUO,
        content: "洛照跨入门槛后，看见堂前空位、价牌、茶饭器具和柜台后的谢母，也听见各处普通交谈与脚步声。",
        topic: "进入酒馆后感知布局、服务和信息环境",
        truthStatus: "verified",
        provenance: {
          kind: "firsthand_visual_and_auditory_layout",
          speakerObserved: false,
          corroboratingEvidenceIds: [IDS.INFORMATION_AVAILABLE_FACT, IDS.SERVICES_FACT, IDS.TABLE_NORM_FACT],
        },
      }],
      perceivedCharacters: [
        { id: IDS.XIE_MOTHER, name: "谢母", zoneId: "counter", identityKnown: true },
      ],
      ownedResources: serviceChoice.ownedTender,
      spatialChoice,
      serviceChoice,
      availableAffordances: [
        ...positionAffordances,
        ...serviceAffordances,
        {
          id: IDS.LEAVE_AFFORDANCE,
          type: "leave",
          fromZoneId: "threshold",
          toZoneId: "outside",
          preconditions: ["门槛到酒馆外的路线开放"],
          effects: ["洛照离开望梯酒馆", "未完成的信息目的和验证欲望保持未解决"],
        },
      ],
    },
  });
}
