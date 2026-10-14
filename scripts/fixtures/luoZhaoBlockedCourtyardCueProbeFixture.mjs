import fs from "node:fs";
import { buildCharacterFoundationProbeInput } from "../../src/server/ecology/characterFoundationBlindProbe.mjs";
import { compileEmbodiedPositionAffordances } from "../../src/server/simulation/embodiedSpatialChoice.mjs";
import { compileSituatedServiceAffordances } from "../../src/server/simulation/situatedServiceChoice.mjs";
import {
  buildLuoZhaoTavernEntryChoiceProbeInput,
  LUO_ZHAO_TAVERN_ENTRY_CHOICE_IDS,
} from "./luoZhaoTavernEntryChoiceProbeFixture.mjs";
import { buildLuoZhaoPositionOptions } from "./luoZhaoSpatialPositionProbeFixture.mjs";

const BASE = LUO_ZHAO_TAVERN_ENTRY_CHOICE_IDS;
export const LUO_ZHAO_BLOCKED_COURTYARD_CUE_IDS = Object.freeze({
  ...BASE,
  PROBE: "probe:luozhao:blocked-courtyard-martial-cue",
  UNKNOWN_SWORD_USER: "perceived-actor:unknown-courtyard-sword-user",
  HALL_ENTRY_POSITION: "position:tavern-hall-entry-standing",
  COURTYARD_APPROACH_POSITION: "position:tavern-hall-courtyard-approach",
  COURTYARD_INTERIOR_POSITION: "position:tavern-courtyard-inside",
  MARTIAL_CUE_FACT: "fact:direct-partial-sword-sound-from-courtyard",
  IDENTITY_UNRESOLVED_FACT: "fact:courtyard-sword-user-identity-unresolved",
  HOUSEHOLD_ACCESS_FACT: "fact:tavern-household-work-area-access-norm",
  CUE_EVENT: "impact:luozhao:hears-partial-courtyard-sword-cue",
  LEAVE_FROM_HALL: "affordance:luozhao-leave-tavern-from-hall-entry",
});

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(new URL(relativePath, import.meta.url), "utf8"));
}

function factById(input, id) {
  const fact = input.world.objectiveFacts.find((row) => row.id === id);
  if (!fact) throw new TypeError(`洛照 Holdout 3 缺少基础客观事实 ${id}`);
  return structuredClone(fact);
}

function blockedCuePositionOptions(IDS) {
  const ordinary = buildLuoZhaoPositionOptions(IDS);
  const sideWall = ordinary.find((row) => row.id === IDS.SIDE_WALL_POSITION);
  const counter = ordinary.find((row) => row.id === IDS.COUNTER_POSITION);
  if (!sideWall || !counter) throw new TypeError("洛照 Holdout 3 缺少堂前公共位置");

  return [
    structuredClone(sideWall),
    structuredClone(counter),
    {
      id: IDS.COURTYARD_APPROACH_POSITION,
      label: "堂前一侧的后院通道口外",
      zoneId: "hall",
      available: true,
      metrics: {
        informationAccess: [0.8, 0.92],
        visualCoverage: [0.5, 0.68],
        socialExposure: [0.54, 0.72],
        approachability: [0.42, 0.58],
        trafficInterference: [0.24, 0.42],
        movementClearance: [0.66, 0.82],
        exitAccess: [0.46, 0.62],
        comfort: [0.12, 0.28],
      },
      objectClearance: [{ objectId: IDS.SWORD, range: [0.7, 0.86] }],
      observableFeatures: [
        "位置仍在堂前，没有越过家用工作区边界",
        "能更清楚辨别后院声响的方向与间隔",
        "门框与转角仍遮住持剑者的面貌、年龄、性别与衣着",
      ],
    },
    {
      id: IDS.COURTYARD_INTERIOR_POSITION,
      label: "后院内侧空处",
      zoneId: "courtyard",
      available: true,
      metrics: {
        informationAccess: [0.9, 0.98],
        visualCoverage: [0.88, 0.97],
        socialExposure: [0.84, 0.96],
        approachability: [0.68, 0.84],
        trafficInterference: [0.26, 0.44],
        movementClearance: [0.72, 0.88],
        exitAccess: [0.5, 0.68],
        comfort: [0.08, 0.22],
      },
      objectClearance: [{ objectId: IDS.SWORD, range: [0.74, 0.9] }],
      observableFeatures: [
        "堂前通往后院的路线当前敞开，没有门闩或物件堵路",
        "跨过通道边界后才进入酒馆经营者的家用工作区",
        "当前没有经营者邀请、许可或领路",
      ],
      socialAccess: {
        physicallyAttemptable: true,
        permissionRequiredByNorm: true,
        permissionCurrentlyGranted: false,
        violationPhysicallyPossible: true,
        evidenceIds: [IDS.HOUSEHOLD_ACCESS_FACT],
        possibleResponseTags: [
          "ignore",
          "question_intent",
          "grant_permission",
          "set_boundary",
          "warn",
          "intervene",
        ],
      },
    },
  ];
}

export function buildLuoZhaoBlockedCourtyardCueProbeInput() {
  const IDS = LUO_ZHAO_BLOCKED_COURTYARD_CUE_IDS;
  const baseline = structuredClone(buildLuoZhaoTavernEntryChoiceProbeInput());
  const scene = readJson("../../.codex/anchors/scene_xyy_wangti_tavern/scene-contract.json");
  const householdNorm = scene.environmentalPressures?.socialNorms?.find(
    (row) => row.id === "norm_guest_entry_into_household_work_area",
  );
  if (!householdNorm) throw new TypeError("洛照 Holdout 3 缺少家用工作区进入惯例");

  const spatialChoice = {
    currentPosition: { id: IDS.HALL_ENTRY_POSITION, zoneId: "hall" },
    positionOptions: blockedCuePositionOptions(IDS),
    carriedObjects: structuredClone(baseline.world.spatialChoice.carriedObjects),
  };
  const serviceChoice = structuredClone(baseline.world.serviceChoice);
  serviceChoice.stateScope =
    "本次独立未见情境保留轻度饥渴、钱财和可见茶饭；它不发生在 Holdout 1 或 2 之后，也不预写消费、位置或对剑术线索的答案。";

  const positionAffordances = compileEmbodiedPositionAffordances({
    actorId: IDS.LUO,
    ...spatialChoice,
  });
  const serviceAffordances = compileSituatedServiceAffordances({
    actorId: IDS.LUO,
    ...serviceChoice,
  });

  return buildCharacterFoundationProbeInput({
    probeId: IDS.PROBE,
    character: structuredClone(baseline.character),
    foundation: structuredClone(baseline.foundation),
    dynamicState: structuredClone(baseline.dynamicState),
    ownedMemory: structuredClone(baseline.ownedMemory),
    relationshipContext: [
      structuredClone(baseline.relationshipContext[0]),
      {
        targetCharacterId: IDS.UNKNOWN_SWORD_USER,
        knownRelationship: "只凭后院声响感知到的持剑者，身份未知",
        directlyExperiencedEvidenceIds: [IDS.CUE_EVENT],
        informationBoundary: "洛照没有看见此人的面貌、年龄、性别、衣着或完整招式，也没有和此人说过话；当前不能把声音来源认作任何已知人物。",
      },
    ],
    world: {
      sceneId: scene.sceneId,
      locationId: "loc_xyy_tavern",
      zoneId: "hall",
      atmosphere: structuredClone(baseline.world.atmosphere),
      objectiveFacts: [
        factById(baseline, IDS.SWORD_WORN_FACT),
        {
          id: IDS.MARTIAL_CUE_FACT,
          content: "后院刚传来三次短促的剑锋破空声；第二声将尽时，鞋底换步的擦地声已落到另一侧，第三声随后收住。声音来自同一片院内，没有碰撞桌椅、柴堆或器皿的杂响。",
          evidenceStrength: "direct",
        },
        {
          id: IDS.IDENTITY_UNRESOLVED_FACT,
          content: "洛照站在堂前入口内侧，门框与转角挡住后院持剑者；她当前没有看见面貌、年龄、性别、衣着或完整剑招，声音本身不能确认对方身份。",
          evidenceStrength: "direct",
        },
        {
          id: IDS.HOUSEHOLD_ACCESS_FACT,
          content: "堂前到后院的通道当前敞开且可走；后院用于劈柴、取水和备店，属于经营者的家用工作区。来客通常先说明来意或得到许可再进入；未获许可仍能实际跨入，但只有动作真实发生并被他人感知后，经营者或家人才可能自行询问、许可、设限、警告或干预。",
          evidenceStrength: "direct",
        },
        {
          id: IDS.NO_GREETING_FACT,
          content: "洛照刚从门槛跨到堂前入口内侧；谢母仍在柜台处理手边事务，当前没有人向洛照说话、招手、许可她进入后院或替她安排下一步。",
          evidenceStrength: "direct",
        },
        factById(baseline, IDS.SERVICES_FACT),
        factById(baseline, IDS.TABLE_NORM_FACT),
      ],
      perceivedEvents: [{
        id: IDS.CUE_EVENT,
        type: "direct_partial_auditory_martial_cue",
        sourceCharacterId: IDS.UNKNOWN_SWORD_USER,
        directedTargetId: IDS.LUO,
        content: "洛照在堂前入口内侧亲耳听见后院的三次剑锋破空与夹在其间的换步声；声路清楚，但转角遮住了出手者。",
        topic: "后院出现直接但不完整的剑术线索",
        truthStatus: "verified",
        provenance: {
          kind: "firsthand_auditory_partial_martial_cue",
          speakerObserved: false,
          corroboratingEvidenceIds: [
            IDS.MARTIAL_CUE_FACT,
            IDS.IDENTITY_UNRESOLVED_FACT,
            IDS.HOUSEHOLD_ACCESS_FACT,
          ],
        },
      }],
      perceivedCharacters: [
        { id: IDS.XIE_MOTHER, name: "谢母", zoneId: "counter", identityKnown: true },
        {
          id: IDS.UNKNOWN_SWORD_USER,
          name: "后院持剑者（身份未知）",
          zoneId: "courtyard",
          identityKnown: false,
          perceptionMode: "auditory_only",
        },
      ],
      ownedResources: structuredClone(baseline.world.ownedResources),
      spatialChoice,
      serviceChoice,
      socialNorms: [structuredClone(householdNorm)],
      availableAffordances: [
        ...positionAffordances,
        ...serviceAffordances,
        {
          id: IDS.LEAVE_FROM_HALL,
          type: "leave",
          fromPositionId: IDS.HALL_ENTRY_POSITION,
          fromZoneId: "hall",
          toZoneId: "outside",
          routeZoneIds: ["hall", "threshold", "outside"],
          preconditions: ["堂前入口经门槛到酒馆外的路线开放"],
          effects: ["洛照离开望梯酒馆", "未核实的声音来源与未完成欲望保持未解决"],
        },
      ],
    },
  });
}
