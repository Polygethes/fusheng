import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";

const characterA = {
  id: "char_a",
  name: "沈珩",
  publicIdentity: "执律剑修",
  currentState: { desire: 55, shame: 52, rage: 42, selfDeception: 58, revengeImpulse: 35, protectionImpulse: 28, currentSelfLie: "我只是按城规办事。" },
  actionLines: { visible: "验契并扣剑", desire: "让对方承认证据不能走", defense: "把逼近命名为城规", shadow: "用规则逼出迟疑" },
  actionVerbs: { visible: ["验契"], hidden: ["逼问"] },
  defenseLanguage: ["按城规，证据不能走。"],
  shadowActions: ["用城规把沉默逼成证词"],
  nobleActions: ["先停剑，再验契。"],
  innerCourt: { wants: "truth" },
  internalSituation: { repeatedSelfLie: "我只是按城规办事。" },
  agentProfile: { leverageObject: "灵契", dramaticObjective: "让对方承认证据不能走", dialogueMoves: ["按城规，证据不能走。"] },
};

const characterB = {
  id: "char_b",
  name: "阎无咎",
  publicIdentity: "血河楼使者",
  currentState: { desire: 50, shame: 48, rage: 38, selfDeception: 55, revengeImpulse: 30, protectionImpulse: 24, currentSelfLie: "我只是谈价。" },
  actionLines: { visible: "换符并试价", desire: "带走翻案证物", defense: "把逃离命名为交易", shadow: "用价码拖住审讯" },
  actionVerbs: { visible: ["换符"], hidden: ["试价"] },
  defenseLanguage: ["我押的是灵契，不是命。"],
  shadowActions: ["用交易拖住审讯"],
  nobleActions: ["把旧案交到桌面。"],
  innerCourt: { wants: "being_seen" },
  internalSituation: { repeatedSelfLie: "我只是谈价。" },
  agentProfile: { leverageObject: "毒誓符", dramaticObjective: "带走翻案证物", dialogueMoves: ["我押的是灵契，不是命。"] },
};

const state = {
  project: { id: "project_period_carry", activeBranchId: "branch_main" },
  town: { id: "town_period_carry", name: "停剑城" },
  characters: [characterA, characterB],
  locations: [{
    id: "loc_gate",
    name: "四方法契门",
    subtext: "契牌必须压在铜盘里。",
    powerRule: "谁先让契牌离盘，谁先失去解释权。",
    likelyEvents: ["灵契验身", "契牌被扣", "界石亮起"],
  }],
  relationships: [{
    id: "rel_a_b",
    projectId: "project_period_carry",
    fromCharacterId: "char_a",
    toCharacterId: "char_b",
    love: 10,
    attraction: 10,
    resentment: 10,
    fear: 10,
    dependence: 10,
    power: 20,
    shame: 10,
    jealousy: 0,
    protection: 10,
    revenge: 0,
    deception: 10,
    misreading: "尚未形成稳定误读。",
    wantsToBeSeen: 20,
    wantsToEscape: 10,
  }],
  characterMemories: [],
  characterPlans: [],
  interventions: [],
  evidence: [],
  rumors: [],
  irreversibleTraces: [],
  canonEvents: [],
  draftScenes: [],
  branches: [{ id: "branch_main" }],
  ui: {
    activeBranchId: "branch_main",
    activeCharacterIds: ["char_a", "char_b"],
    selectedLocationId: "loc_gate",
    timeGrain: "day",
    focusMode: "ambient",
    userDirective: "",
    injectedEvent: "",
    eventImpact: 0,
  },
};

const draft = playNext(state);
const ticks = draft.periodSimulation?.ticks || [];
assert.ok(ticks.length >= 2, "day playback should produce multiple period ticks");

const firstRelationshipShift = ticks[0].synthesized?.relationshipShift?.find((shift) => shift.generatedFrom === "agent-dialogue-relationship");
assert.ok(firstRelationshipShift?.eventOutcome, "first tick should produce a concrete relationship dialogue outcome");

const laterSimulations = ticks.slice(1).flatMap((tick) => tick.simulationTick?.privateSimulations || []);
const remembered = laterSimulations.find((sim) => sim.relationshipDialogueMemory || sim.memorySource === "agent_dialogue_relationship");

assert.ok(remembered, "later ticks in the same day should see relationship dialogue created by earlier ticks");
assert.match(
  [
    remembered.relationshipDialogueMemory?.eventOutcome,
    remembered.relationshipDialogueMemory?.finalTurn,
    remembered.memoryDialogueEcho,
    remembered.whatTheyRefuseToAdmit,
  ].filter(Boolean).join(" "),
  /灵契|契牌|证据|铜盘|毒誓符/,
  "carried-forward relationship memory should remain tied to the earlier concrete object/dialogue",
);

console.log("periodTicksCarryForwardRelationships:test passed", {
  firstOutcome: firstRelationshipShift.eventOutcome,
  rememberedBy: remembered.characterName,
  echo: remembered.memoryDialogueEcho || remembered.whatTheyRefuseToAdmit,
});
