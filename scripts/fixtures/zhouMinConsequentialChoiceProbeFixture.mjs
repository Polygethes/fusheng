import fs from "node:fs";
import { buildCharacterFoundationProbeInput } from "../../src/server/ecology/characterFoundationBlindProbe.mjs";

export const ZHOU_MIN_CONSEQUENTIAL_CHOICE_IDS = Object.freeze({
  ZHOU: "char_xyy_zhoumin",
  XIE: "char_xyy_xiezenshi",
  ENVOY: "char_probe_inner_court_envoy",
  OPEN_CHOICE_AXIS: "axis_zhoumin_pressure_and_moral_compromise",
  CORE_DESIRE: "desire_zhoumin_become_inner_court_disciple",
  STATUS_PRESSURE_STATE: "state_zhoumin_status_failure_pressure",
  FRIEND_BETRAYAL_INHIBITOR: "inhibitor_zhoumin_do_not_betray_friend",
  OFFER_EVENT: "impact:zhoumin:advancement-for-private-weakness-offer",
  AUTHORITY_FACT: "fact:envoy-authority-and-sealed-place-verified",
  EXCHANGE_FACT: "fact:conditional-exchange-and-expiry-verified",
  WITNESS_SCOPE_FACT: "fact:closed-room-current-witness-scope",
  NO_MATERNAL_CRISIS_FACT: "fact:no-verified-imminent-maternal-crisis",
  PRIVATE_DISCLOSURE_MEMORY: "episode:zhoumin:xiezenshi-private-endurance-disclosure",
  MOTHER_REQUEST_MEMORY: "episode:zhoumin:mother-required-inner-court",
  EXIT_ROOM_AFFORDANCE: "affordance:guest-room-to-stairs",
});

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(new URL(relativePath, import.meta.url), "utf8"));
}

export function buildZhouMinConsequentialChoiceProbeInput() {
  const IDS = ZHOU_MIN_CONSEQUENTIAL_CHOICE_IDS;
  const foundation = readJson(
    "../../.codex/anchors/scene_xyy_wangti_tavern/characters/char_xyy_zhoumin/character-foundation.json",
  );
  const memorySeed = readJson(
    "../../.codex/anchors/scene_xyy_wangti_tavern/characters/char_xyy_zhoumin/memory-seed.json",
  );
  const motherRequest = memorySeed.episodes.find((row) => row.id === IDS.MOTHER_REQUEST_MEMORY);
  if (!motherRequest) throw new TypeError(`周珉记忆种子缺少 ${IDS.MOTHER_REQUEST_MEMORY}`);

  return buildCharacterFoundationProbeInput({
    probeId: "probe:zhoumin:advancement-for-friend-private-weakness",
    character: { id: IDS.ZHOU, name: "周珉" },
    foundation,
    dynamicState: {
      state_zhoumin_status_failure_pressure: 0.78,
      state_zhoumin_uncertainty_about_xiezenshi_willingness: 0.34,
      state_zhoumin_progress_hope: 0.12,
      state_zhoumin_verified_maternal_mortality_crisis: 0,
    },
    ownedMemory: {
      episodes: [
        motherRequest,
        {
          id: IDS.PRIVATE_DISCLOSURE_MEMORY,
          ownerCharacterId: IDS.ZHOU,
          source: {
            kind: "firsthand",
            immediateSourceCharacterId: IDS.XIE,
            speakerCharacterId: IDS.XIE,
            confidenceBand: "high",
          },
          perceivedAt: {
            storyTime: "before_current_probe",
            timePrecision: "exact_time_unknown",
          },
          locationId: "private_place_name_unknown",
          perception: {
            content: "谢真石曾在无人处亲口告诉周珉，自己的持久力问题小时候还不明显，现在越来越明显；周珉也知道他力竭时会喘气、腿软。",
            topic: "谢真石私下透露的持久力弱点",
          },
          semanticFrame: {
            predicate: "receive_private_body_disclosure",
            roles: {
              speaker: IDS.XIE,
              listener: IDS.ZHOU,
              privacyHolder: IDS.XIE,
            },
          },
        },
      ],
      beliefs: [],
      commitments: [],
    },
    relationshipContext: [{
      targetCharacterId: IDS.XIE,
      knownRelationship: "一起长大的朋友",
      directlyExperiencedEvidenceIds: [IDS.PRIVATE_DISCLOSURE_MEMORY],
      informationBoundary: "这项身体弱点来自谢真石在无人处的亲口透露，不是公开资料。",
    }],
    world: {
      sceneId: "scene_xyy_wangti_tavern",
      locationId: "loc_xyy_tavern",
      zoneId: "guest_room",
      atmosphere: {
        publicScrutiny: 0.04,
        crowding: 0.03,
        privacy: 0.94,
        timePressure: 0.86,
      },
      objectiveFacts: [
        {
          id: IDS.AUTHORITY_FACT,
          content: "周珉已经亲眼核对使者的身份牌、宗门印记和一张尚未填写姓名的候补考核名帖；使者确实有权把一人补入这次内门考核名单。",
          evidenceStrength: "strong",
        },
        {
          id: IDS.EXCHANGE_FACT,
          content: "周珉已经确认交换会当场结算：若他在使者离开前说出一项可核验的谢真石私密弱点，使者就把周珉姓名写入候补名帖并交给他；若拒绝或拖过这次谈话，名帖会交给下一人。名帖只带来参加考核的资格，不保证成为内门弟子。",
          evidenceStrength: "strong",
        },
        {
          id: IDS.WITNESS_SCOPE_FACT,
          content: "谈话发生在望梯酒馆一间关门客房内；谢真石不在房中，此刻只有周珉和使者能直接听见。使者以后是否转述以及谢真石以后是否得知，都尚未发生。",
          evidenceStrength: "direct",
        },
        {
          id: IDS.NO_MATERNAL_CRISIS_FACT,
          content: "周珉当前没有任何可靠信息表明自己的母亲正面临即时生命危险；母亲要求他进入内门的压力仍然存在。",
          evidenceStrength: "direct",
        },
        {
          id: "fact:envoy-does-not-block-exit",
          content: "使者没有锁门、持械威胁或阻挡路线；周珉可以拒绝、追问或打开客房门离开。",
          evidenceStrength: "direct",
        },
      ],
      perceivedEvents: [{
        id: IDS.OFFER_EVENT,
        type: "direct_conditional_offer",
        sourceCharacterId: IDS.ENVOY,
        directedTargetId: IDS.ZHOU,
        content: "使者把空白名帖推到周珉面前，说：‘把谢真石不愿让人知道的身体弱处告诉我，我把这张候补名帖填给你。出了这扇门，这个名额就给别人。’",
        topic: "以朋友私密弱点交换候补内门考核资格",
        truthStatus: "verified",
        provenance: {
          kind: "firsthand_direct_offer",
          speakerObserved: true,
          objectObserved: true,
          corroboratingEvidenceIds: [IDS.AUTHORITY_FACT, IDS.EXCHANGE_FACT],
        },
      }],
      perceivedCharacters: [
        { id: IDS.ENVOY, name: "内门使者", zoneId: "guest_room", identityKnown: true },
      ],
      availableAffordances: [
        {
          id: IDS.EXIT_ROOM_AFFORDANCE,
          type: "move",
          fromZoneId: "guest_room",
          toZoneId: "stairs",
          preconditions: ["客房门可以打开", "使者没有阻挡路线"],
        },
      ],
    },
  });
}
