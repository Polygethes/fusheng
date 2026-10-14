import assert from "node:assert/strict";

import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { runBackgroundSlot } from "../src/server/pipeline/backgroundSlotSimulator.mjs";
import {
  applyTavernCausalAffordance,
  listTavernCausalAffordances,
  prepareTavernCausalSlot,
  TAVERN_CAUSAL_DAY_SLOTS,
} from "../src/server/pipeline/tavernCausalEconomy.mjs";
import { runTavernCausalScene } from "../src/server/pipeline/tavernCausalScene.mjs";

const IDS = {
  mother: "char_xyy_xiemu",
  worker: "char_xyy_chenyan",
};
const BUREAUCRATIC = /经手人|办理/u;

function buildWorkScenario() {
  const state = buildPlayableWorldFromSetup({
    setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
    setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
  });
  const dawn = TAVERN_CAUSAL_DAY_SLOTS.find((slot) => slot.id === "dawn");
  const prepared = prepareTavernCausalSlot(state, { day: 1, slot: dawn });
  const visit = prepared.state.tavernState.activeVisits.find((item) => item.visitorId === IDS.worker);
  assert.ok(visit, "the dawn seed must include Chen Yan's work-for-meal visit");
  visit.purposeStatus = "declared";
  visit.purposeDisclosureStatus = "declared";
  visit.declaredPurpose = visit.purpose;
  visit.hostId = IDS.mother;
  visit.receivedBy = IDS.mother;
  visit.stage = "received";
  const runtime = {
    topology: {
      zones: {
        threshold: { id: "threshold", label: "门槛" },
        hall: { id: "hall", label: "堂前" },
        stove: { id: "stove", label: "灶边" },
        courtyard: { id: "courtyard", label: "后院" },
      },
      edges: [
        { from: "threshold", to: "hall", move: 1 },
        { from: "hall", to: "stove", move: 1 },
        { from: "hall", to: "courtyard", move: 1 },
      ],
    },
    agents: {
      [IDS.mother]: { characterId: IDS.mother, characterName: "谢母", present: true, zoneId: "hall" },
      [IDS.worker]: { characterId: IDS.worker, characterName: "陈砚", present: true, zoneId: "hall" },
    },
  };
  const scenario = { state: prepared.state, visit, runtime, sequence: 0, slotContext: prepared.slotContext };
  listFor(scenario, IDS.mother);
  assert.ok(visit.workExchange?.workOrderId, "a concrete multi-unit work order must be selected");
  return scenario;
}

function listFor(scenario, actorId) {
  const perceived = Object.keys(scenario.runtime.agents).filter((id) => id !== actorId);
  return listTavernCausalAffordances(scenario.state, scenario.runtime, actorId, perceived)
    .filter((item) => item.visitId === scenario.visit.id);
}

function take(scenario, actorId, type, speech = "") {
  const selected = listFor(scenario, actorId).find((item) => item.type === type);
  assert.ok(selected, `missing ${type}`);
  scenario.sequence += 1;
  const result = applyTavernCausalAffordance(
    scenario.state,
    scenario.runtime,
    {
      id: `narrative_valve:${scenario.sequence}:${type}`,
      actorId,
      targetCharacterId: selected.targetCharacterId,
      moveToZoneId: selected.moveToZoneId,
      speech,
      visibleAction: selected.canonicalVisibleAction,
      day: 1,
      slotLabel: "清晨",
    },
    selected,
    Object.keys(scenario.runtime.agents).filter((id) => id !== actorId),
  );
  assert.ok(result, `${type} must remain a legal material transition`);
  if (selected.moveToZoneId) scenario.runtime.agents[actorId].zoneId = selected.moveToZoneId;
  return { selected, result };
}

function assertNoBackendNarrative(text, { taskLabel = "", completionCriteria = [] } = {}) {
  assert.doesNotMatch(text, BUREAUCRATIC, `visible narrative leaked bureaucratic wording: ${text}`);
  if (taskLabel) assert.equal(text.includes(`“${taskLabel}”`), false, `visible narrative quoted the work-order title: ${text}`);
  for (const criterion of completionCriteria) {
    assert.equal(text.includes(`“${criterion}”`), false, `visible narrative quoted a completion criterion: ${text}`);
  }
  if (completionCriteria.length) {
    assert.equal(
      text.includes(`“${completionCriteria.join("、")}”`),
      false,
      `visible narrative joined and quoted the full acceptance criteria: ${text}`,
    );
  }
}

const scenario = buildWorkScenario();
const work = scenario.visit.workExchange;
const protectedData = {
  taskLabel: work.taskLabel,
  completionCriteria: [...work.completionCriteria],
};

const offered = take(scenario, IDS.mother, "assign_work", "把堂前两张空桌收净，我看过就给你热饭。");
assertNoBackendNarrative(offered.selected.canonicalVisibleAction, protectedData);
const accepted = take(scenario, IDS.worker, "accept_work", "成，我把两张桌子收净。");
assertNoBackendNarrative(accepted.selected.canonicalVisibleAction, protectedData);

export const unitTexts = [];
const requiredUnits = Number(scenario.visit.workExchange.execution.requiredUnits || 0);
assert.ok(requiredUnits > 1, "the regression fixture must execute multiple units");
for (let index = 0; index < requiredUnits; index += 1) {
  const performed = take(scenario, IDS.worker, "perform_work");
  unitTexts.push(performed.selected.canonicalVisibleAction);
  assertNoBackendNarrative(performed.selected.canonicalVisibleAction, protectedData);
}
const submitted = take(scenario, IDS.worker, "submit_work", "两张桌子都收净了，请看一遍。");
assertNoBackendNarrative(submitted.selected.canonicalVisibleAction, protectedData);
const verified = take(scenario, IDS.mother, "verify_work");
assertNoBackendNarrative(verified.selected.canonicalVisibleAction, protectedData);

const slot = await runBackgroundSlot({
  location: { id: "loc_xyy_wangti_tavern", name: "望梯酒馆" },
  slot: { label: "清晨" },
  characters: [
    { id: IDS.mother, name: "谢母" },
    { id: IDS.worker, name: "陈砚" },
  ],
  groundingActions: ["陈砚把两张空桌一一收净，谢母逐张看过桌面后点了头。"],
  lifeEvents: [{
    characterId: IDS.worker,
    characterName: "陈砚",
    targetCharacterId: IDS.mother,
    targetCharacterName: "谢母",
    activityType: "perform_exchange",
    visibleAction: "陈砚把两张空桌一一收净，谢母逐张看过桌面后点了头。",
    taskLabel: protectedData.taskLabel,
    completionCriteria: protectedData.completionCriteria,
  }],
  runCall: async () => ({
    parsed: {
      slotText: `陈砚把“${protectedData.taskLabel}”留给酒馆经手人办理，再按“${protectedData.completionCriteria.join("、")}”逐项验收。`,
      carryFacts: [],
      dialogueTurns: [],
    },
    meta: { model: "fake" },
  }),
});
assertNoBackendNarrative(slot.slotText, protectedData);

const openingScenario = buildWorkScenario();
for (const character of openingScenario.state.characters) {
  character.lifeState.present = [IDS.mother, IDS.worker].includes(character.id);
}
const opening = await runTavernCausalScene(openingScenario.state, {
  characterIds: [IDS.mother, IDS.worker],
  positions: { [IDS.mother]: "hall", [IDS.worker]: "hall" },
  slotContext: openingScenario.slotContext,
  maxSteps: 1,
  minimumActivationScore: 1_000_000,
  runAgent: async () => ({ decision: { actionType: "pass", privateReason: "opening-only" } }),
});
const openingText = opening.publicEvents.map((event) => event.surfaceEvent || event.content || "").join("\n");
assertNoBackendNarrative(openingText, protectedData);

console.log("tavernNarrativeOneWayValve:test passed", {
  units: unitTexts,
  slotText: slot.slotText,
  openingText,
});
