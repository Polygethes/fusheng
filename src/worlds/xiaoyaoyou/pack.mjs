// 《逍遥游·望梯酒馆》 world pack. It references the authored tavern data where
// it already lives instead of copying it, so the pack and the legacy builders
// share one source of truth. The character records still come from the
// authored blueprint through `legacySetup`.
import { defineWorldPack } from "../worldPack.mjs";
import { XIAOYA_YOU_TAVERN_INSTITUTION } from "../../worldbuilding/skills.js";
import { TAVERN_SCENE_TOPOLOGY } from "../../server/pipeline/tavernCausalScene.mjs";
import { TAVERN_RELATIONSHIP_METRICS } from "../../server/ecology/tavernRelationshipDynamics.mjs";
import {
  TAVERN_OPENING_AGENDA_ITEMS,
  TAVERN_SCENE_CHARACTER_IDS,
  TAVERN_SCENE_POSITIONS,
  TAVERN_SOCIAL_BOUNDARIES,
  TAVERN_SOCIAL_FACTS,
} from "../../server/pipeline/tavernSceneConfiguration.mjs";
import { XIAOYAOYOU_LAYOUT } from "./layout.mjs";

const appearance = (hair, hairLight, robe, robeShade, sash, extra = {}) => ({ hair, hairLight, robe, robeShade, sash, ...extra });

export default defineWorldPack({
  meta: {
    id: "xiaoyaoyou",
    title: "逍遥游 · 望梯酒馆",
    language: "zh-Hans",
    source: ["Downloads/逍遥游/逍遥游_策划案.md", "Downloads/逍遥游/xiaoyaoyou_ep01.md"],
    provisional: [],
  },
  legacySetup: {
    worldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
    peoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
  },
  stage: {
    placeId: "loc_xyy_tavern",
    name: "望梯酒馆",
    defaultWorldId: "world:xyy:tavern:v27",
    topology: TAVERN_SCENE_TOPOLOGY,
    sceneCast: TAVERN_SCENE_CHARACTER_IDS,
    scenePositions: TAVERN_SCENE_POSITIONS,
    dayCast: ["char_xyy_xiezenshi", "char_xyy_luozhao"],
  },
  clock: { startLabel: "酉时", defaultPacingMode: "day" },
  cast: [
    { id: "char_xyy_xiezenshi", name: "谢真石", title: "谢家独子 · 梯云宗候选", appearance: appearance("#2b2230", "#4c4058", "#3f6688", "#2c4866", "#c9a25a", { styles: ["bun", "sword"] }) },
    { id: "char_xyy_luozhao", name: "洛照", title: "玉衡宗来访弟子", appearance: appearance("#1c1c28", "#3c3f5c", "#d6d9e6", "#a2a8c2", "#5464a8", { inner: "#6a78b8", styles: ["long"] }) },
    { id: "char_xyy_zhoumin", name: "周珉", title: "梯云宗外门弟子", appearance: appearance("#3a2a22", "#5c4434", "#5c8a4c", "#426a38", "#8a5a32", { styles: ["bun"] }) },
    { id: "char_xyy_xieheng", name: "谢恒", title: "望梯酒馆东家", appearance: appearance("#7c7672", "#a49e98", "#7a4a34", "#583222", "#3a2a22", { beard: "#9a948e", skin: "#dcae88", styles: ["bun", "beard"] }) },
    { id: "char_xyy_xiemu", name: "谢母", title: "掌柜兼掌灶", appearance: appearance("#3a2c28", "#5c4842", "#a4524a", "#7c382f", "#5a3a2a", { apron: "#ece0c4", styles: ["bun", "apron"] }) },
    { id: "char_xyy_yanzhizhong", name: "严执中", title: "梯云宗掌籍长老", appearance: appearance("#e2e0dc", "#ffffff", "#3a4a5a", "#26323e", "#8a7a5a", { beard: "#e8e6e2", styles: ["bun", "beard"] }) },
    { id: "char_xyy_chenyan", name: "陈砚", title: "云梯榜末弟子", appearance: appearance("#2a2226", "#4a3e44", "#6a6a7a", "#4a4a5a", "#a08050", { styles: ["bun"] }) },
  ],
  relationships: [],
  relationshipMetrics: TAVERN_RELATIONSHIP_METRICS,
  objects: XIAOYA_YOU_TAVERN_INSTITUTION.objectTemplates,
  positions: XIAOYA_YOU_TAVERN_INSTITUTION.guestPositions,
  work: XIAOYA_YOU_TAVERN_INSTITUTION.workOrderTemplates,
  social: { facts: TAVERN_SOCIAL_FACTS, boundaries: TAVERN_SOCIAL_BOUNDARIES },
  agenda: { items: TAVERN_OPENING_AGENDA_ITEMS },
  mysteries: [],
  report: {
    renderer: "legacy-tavern",
    metrics: [
      { label: "成柴", objectId: "tavern_resource_sheltered_firewood", stateKey: "processedBundles", unit: "束", target: 2 },
      { label: "水缸", objectId: "tavern_resource_water_vat", stateKey: "fill", unit: "", target: 1, display: "fraction" },
    ],
  },
  layout: XIAOYAOYOU_LAYOUT,
});
