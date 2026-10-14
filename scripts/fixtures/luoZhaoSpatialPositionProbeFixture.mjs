import fs from "node:fs";
import { buildCharacterFoundationProbeInput } from "../../src/server/ecology/characterFoundationBlindProbe.mjs";
import { compileEmbodiedPositionAffordances } from "../../src/server/simulation/embodiedSpatialChoice.mjs";

export const LUO_ZHAO_SPATIAL_POSITION_PROBE_IDS = Object.freeze({
  LUO: "char_xyy_luozhao",
  XIE_MOTHER: "char_xyy_xiemu",
  SWORD: "luozhao_sword",
  ARRIVAL_MEMORY: "episode:luozhao:accepted-visit-and-arrived-wangti",
  HEARSAY_BELIEF: "belief:luozhao:xiezenshi-name-and-hearsay",
  LAYOUT_EVENT: "impact:luozhao:perceives-tavern-entry-layout",
  SWORD_WORN_FACT: "fact:luozhao-sword-is-sheathed-and-worn-on-body",
  NO_MARTIAL_CUE_FACT: "fact:no-current-xiezenshi-or-high-value-martial-cue",
  NO_GREETING_FACT: "fact:no-one-has-addressed-luozhao-at-entry",
  INFORMATION_AVAILABLE_FACT: "fact:tavern-information-access-varies-by-position",
  THRESHOLD_POSITION: "position:tavern-threshold-standing",
  SIDE_WALL_POSITION: "position:tavern-hall-side-wall-table",
  CENTER_POSITION: "position:tavern-hall-center-table",
  COUNTER_POSITION: "position:tavern-hall-near-counter",
  NEAR_DOOR_POSITION: "position:tavern-hall-near-threshold-bench",
  LEAVE_AFFORDANCE: "affordance:luozhao-leave-tavern-from-threshold",
});

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(new URL(relativePath, import.meta.url), "utf8"));
}

export function buildLuoZhaoPositionOptions(IDS = LUO_ZHAO_SPATIAL_POSITION_PROBE_IDS) {
  return [
    {
      id: IDS.SIDE_WALL_POSITION,
      label: "堂前侧墙空桌",
      zoneId: "hall",
      available: true,
      metrics: {
        informationAccess: [0.68, 0.84],
        visualCoverage: [0.72, 0.86],
        socialExposure: [0.28, 0.44],
        approachability: [0.24, 0.4],
        trafficInterference: [0.12, 0.28],
        movementClearance: [0.68, 0.84],
        exitAccess: [0.48, 0.64],
        comfort: [0.42, 0.58],
      },
      objectClearance: [{ objectId: IDS.SWORD, range: [0.72, 0.88] }],
      observableFeatures: [
        "一侧临墙，背后没有客人通行",
        "斜向能看见门槛和柜台",
        "离主要取送饭食路线有一段距离",
      ],
    },
    {
      id: IDS.CENTER_POSITION,
      label: "堂中空桌",
      zoneId: "hall",
      available: true,
      metrics: {
        informationAccess: [0.82, 0.94],
        visualCoverage: [0.82, 0.94],
        socialExposure: [0.78, 0.92],
        approachability: [0.76, 0.9],
        trafficInterference: [0.62, 0.8],
        movementClearance: [0.5, 0.68],
        exitAccess: [0.45, 0.6],
        comfort: [0.55, 0.72],
      },
      objectClearance: [{ objectId: IDS.SWORD, range: [0.55, 0.7] }],
      observableFeatures: [
        "堂中多处谈话都较清楚",
        "四面都可能有人经过或落座",
        "在座客人容易注意这里",
      ],
    },
    {
      id: IDS.COUNTER_POSITION,
      label: "近柜台空位",
      zoneId: "hall",
      available: true,
      metrics: {
        informationAccess: [0.84, 0.96],
        visualCoverage: [0.58, 0.74],
        socialExposure: [0.62, 0.78],
        approachability: [0.8, 0.94],
        trafficInterference: [0.7, 0.88],
        movementClearance: [0.42, 0.58],
        exitAccess: [0.32, 0.48],
        comfort: [0.35, 0.52],
      },
      objectClearance: [{ objectId: IDS.SWORD, range: [0.46, 0.62] }],
      observableFeatures: [
        "柜台交谈最容易听清",
        "经营者容易注意并主动询问",
        "取送物品和结账的人会经过",
      ],
    },
    {
      id: IDS.NEAR_DOOR_POSITION,
      label: "近门侧凳",
      zoneId: "hall",
      available: true,
      metrics: {
        informationAccess: [0.45, 0.62],
        visualCoverage: [0.78, 0.9],
        socialExposure: [0.48, 0.65],
        approachability: [0.4, 0.58],
        trafficInterference: [0.66, 0.84],
        movementClearance: [0.6, 0.76],
        exitAccess: [0.88, 0.96],
        comfort: [0.32, 0.48],
      },
      objectClearance: [{ objectId: IDS.SWORD, range: [0.6, 0.76] }],
      observableFeatures: [
        "门外和新来的人最容易看见",
        "堂中较远处的低声交谈不容易听清",
        "进出酒馆的人会从附近经过",
      ],
    },
  ];
}

export function buildLuoZhaoSpatialPositionProbeInput() {
  const IDS = LUO_ZHAO_SPATIAL_POSITION_PROBE_IDS;
  const foundation = readJson(
    "../../.codex/anchors/scene_xyy_wangti_tavern/characters/char_xyy_luozhao/character-foundation.json",
  );
  const memorySeed = readJson(
    "../../.codex/anchors/scene_xyy_wangti_tavern/characters/char_xyy_luozhao/memory-seed.json",
  );
  const arrivalMemory = memorySeed.episodes.find((row) => row.id === IDS.ARRIVAL_MEMORY);
  const hearsayBelief = memorySeed.beliefs.find((row) => row.id === IDS.HEARSAY_BELIEF);
  if (!arrivalMemory || !hearsayBelief) throw new TypeError("洛照盲测缺少本人到店记忆或带来源的谢真石传闻");

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
  const positionAffordances = compileEmbodiedPositionAffordances({
    actorId: IDS.LUO,
    ...spatialChoice,
  });

  return buildCharacterFoundationProbeInput({
    probeId: "probe:luozhao:threshold-position-selection",
    character: { id: IDS.LUO, name: "洛照" },
    foundation,
    dynamicState: {
      desireIntensity: 0.8,
      frustration: 0.08,
      domainExcitement: 0.04,
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
      informationBoundary: "洛照只看见对方在柜台内忙碌；没有共同往事、私人信任、欠负或已经发生的接待。",
    }],
    world: {
      sceneId: "scene_xyy_wangti_tavern",
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
          content: "洛照刚站到门槛内，柜台后的谢母正在处理手边事务，当前没有人向洛照说话、招手、要求她等待或替她安排座位。",
          evidenceStrength: "direct",
        },
        {
          id: IDS.INFORMATION_AVAILABLE_FACT,
          content: "堂前存在正在继续的普通交谈；不同空位能听见和看见的范围、被人注意或搭话的概率、人流干扰与活动空间各不相同。",
          evidenceStrength: "direct",
        },
      ],
      perceivedEvents: [{
        id: IDS.LAYOUT_EVENT,
        type: "direct_environment_perception",
        sourceCharacterId: IDS.LUO,
        directedTargetId: IDS.LUO,
        content: "洛照跨入门槛后，看见堂前四处当前可用的空位，也听见各处传来的普通交谈和脚步声。",
        topic: "进入酒馆后感知布局与信息环境",
        truthStatus: "verified",
        provenance: {
          kind: "firsthand_visual_and_auditory_layout",
          speakerObserved: false,
          corroboratingEvidenceIds: [IDS.INFORMATION_AVAILABLE_FACT],
        },
      }],
      perceivedCharacters: [
        { id: IDS.XIE_MOTHER, name: "谢母", zoneId: "counter", identityKnown: true },
      ],
      spatialChoice,
      availableAffordances: [
        ...positionAffordances,
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
