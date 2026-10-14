import { instantiateWorldAgenda } from "../../worlds/worldAgenda.mjs";

export const TAVERN_SCENE_CHARACTER_IDS = Object.freeze([
  "char_xyy_xiezenshi", "char_xyy_luozhao", "char_xyy_zhoumin", "char_xyy_xieheng", "char_xyy_xiemu",
]);
export const TAVERN_SCENE_POSITIONS = Object.freeze({
  char_xyy_xiezenshi: "hall", char_xyy_luozhao: "hall", char_xyy_zhoumin: "hall",
  char_xyy_xieheng: "counter", char_xyy_xiemu: "stove",
});

const TAVERN_LOCATION_ID = "loc_xyy_tavern";
const TAVERN_HOUSEHOLD_IDS = Object.freeze(["char_xyy_xieheng", "char_xyy_xiemu", "char_xyy_xiezenshi"]);

export const TAVERN_OPENING_AGENDA_ITEMS = Object.freeze([{
  id: "tavern-opening-preparation", kind: "opening_preparation", placeId: TAVERN_LOCATION_ID,
  label: "开门前的柴水准备", due: { afterOpening: true }, warningLeadSeconds: 300,
  source: "configurable_scene_opening_schedule",
  responsibleActorIds: TAVERN_HOUSEHOLD_IDS,
  delayConsequence: "柴水未齐会记为营业准备延误；到时仍须实际完成，答应或描述做完不能抵账。",
  conditions: [{ objectId: "tavern_resource_sheltered_firewood", stateKey: "processedBundles", minimum: 2 },
    { objectId: "tavern_resource_water_vat", stateKey: "fill", minimum: 1 }],
}]);

export const TAVERN_SOCIAL_FACTS = Object.freeze([
  {
    factId: "social-fact:tavern:household-ownership",
    kind: "ownership_claim",
    claimantId: "household:谢家",
    entityId: TAVERN_LOCATION_ID,
    topic: "望梯酒馆由谢家经营",
    sourceEvidenceIds: [],
  },
  {
    factId: "social-fact:tavern:public-business",
    kind: "public_access_declaration",
    entityId: TAVERN_LOCATION_ID,
    topic: "堂前营业时向来客开放",
    affectedActorIds: [],
    sourceEvidenceIds: [],
  },
]);

export const TAVERN_SOCIAL_BOUNDARIES = Object.freeze([
  {
    id: "social-boundary:tavern:work-areas",
    zoneIds: ["counter", "stove", "courtyard"],
    exemptActorIds: TAVERN_HOUSEHOLD_IDS,
    claimantIds: TAVERN_HOUSEHOLD_IDS,
    permissionRequiredByNorm: true,
    possibleResponseTags: ["owner_may_notice", "owner_may_object"],
    evidenceIds: ["social-fact:tavern:household-ownership"],
  },
  {
    id: "social-boundary:tavern:guest-room",
    zoneIds: ["guest_room"],
    exemptActorIds: TAVERN_HOUSEHOLD_IDS,
    claimantIds: TAVERN_HOUSEHOLD_IDS,
    permissionRequiredByNorm: true,
    possibleResponseTags: ["lodging_access_may_be_checked"],
    evidenceIds: ["social-fact:tavern:household-ownership"],
  },
]);

export function tavernOpeningAgenda(characterIds, { openingAfterSeconds = 900 } = {}) {
  return instantiateWorldAgenda(TAVERN_OPENING_AGENDA_ITEMS, characterIds, { openingAfterSeconds });
}
