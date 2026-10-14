import fs from "node:fs";
import { buildCharacterFoundationProbeInput } from "../../src/server/ecology/characterFoundationBlindProbe.mjs";

export const ZHOU_MIN_PROBE_IDS = Object.freeze({
  ZHOU: "char_xyy_zhoumin",
  XIE: "char_xyy_xiezenshi",
  REPORTER: "char_probe_reporter",
  REPORT_EVENT: "impact:zhoumin:unverified-report",
  GUIDANCE_MEMORY: "episode:zhoumin:firsthand-guidance-from-xie",
});

export function buildZhouMinSecondhandClaimProbeInput() {
  const { ZHOU, XIE, REPORTER, REPORT_EVENT, GUIDANCE_MEMORY } = ZHOU_MIN_PROBE_IDS;
  const foundationPath = new URL(
    "../../.codex/anchors/scene_xyy_wangti_tavern/characters/char_xyy_zhoumin/character-foundation.json",
    import.meta.url,
  );
  const foundation = JSON.parse(fs.readFileSync(foundationPath, "utf8"));
  return buildCharacterFoundationProbeInput({
    probeId: "probe:zhoumin:unverified-close-relationship-claim",
    character: { id: ZHOU, name: "周珉" },
    foundation,
    dynamicState: {
      state_zhoumin_status_failure_pressure: 0.62,
      state_zhoumin_concealed_relationship_doubt: 0.18,
    },
    ownedMemory: {
      episodes: [{
        id: GUIDANCE_MEMORY,
        ownerCharacterId: ZHOU,
        source: { kind: "firsthand", immediateSourceCharacterId: XIE, confidenceBand: "high" },
        perception: {
          content: "谢真石此前亲自指出过周珉剑步中的问题；周珉照着改过后，亲身感觉动作确实更顺。",
          topic: "谢真石曾提供真实剑术指导",
        },
        semanticFrame: { predicate: "receive_effective_guidance", roles: { helper: XIE, beneficiary: ZHOU } },
      }],
      beliefs: [],
      commitments: [],
    },
    relationshipContext: [{
      targetCharacterId: XIE,
      knownRelationship: "一起长大的朋友",
      directlyExperiencedEvidenceIds: [GUIDANCE_MEMORY],
    }],
    world: {
      sceneId: "scene_xyy_wangti_tavern",
      locationId: "loc_xyy_tavern",
      zoneId: "hall",
      atmosphere: { publicScrutiny: 0.82, crowding: 0.7, privacy: 0.12 },
      objectiveFacts: [
        { id: "fact:reporter-spoke", content: "这名转述者刚刚确实向周珉说了这番话。" },
        { id: "fact:no-urgent-deadline", content: "眼前没有必须立刻作出举荐决定的客观期限。" },
        { id: "fact:no-corroboration", content: "当前没有出现支持或反驳转述内容的独立证据。" },
      ],
      perceivedEvents: [{
        id: REPORT_EVENT,
        type: "reported_speech",
        sourceCharacterId: REPORTER,
        directedTargetId: ZHOU,
        content: "我听说谢真石从没打算举荐你。",
        topic: "谢真石是否愿意举荐周珉",
        truthStatus: "unverified",
        provenance: {
          kind: "reported",
          directWitnessNamed: false,
          originalSourceNamed: false,
          eventTimeKnown: false,
          corroboratingEvidenceIds: [],
        },
      }],
      perceivedCharacters: [
        { id: REPORTER, name: "转述者", zoneId: "hall", identityKnown: true },
        { id: XIE, name: "谢真石", zoneId: "counter", identityKnown: true },
      ],
      availableAffordances: [
        { id: "affordance:hall-to-counter", type: "move", fromZoneId: "hall", toZoneId: "counter" },
        { id: "affordance:hall-to-courtyard", type: "move", fromZoneId: "hall", toZoneId: "courtyard" },
        { id: "affordance:leave-tavern", type: "leave", fromZoneId: "hall", toZoneId: "threshold" },
      ],
    },
  });
}
