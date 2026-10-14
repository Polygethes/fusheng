import assert from "node:assert/strict";

import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { getTavernEcologyProfile } from "../src/server/ecology/tavernEcologyProfile.mjs";
import { applyTavernEcologyOutcome } from "../src/server/pipeline/tavernEcologyOutcome.mjs";
import {
  buildTavernSituatedServiceChoice,
  listTavernCausalAffordances,
} from "../src/server/pipeline/tavernCausalEconomy.mjs";
import { appraiseTavernAgentEcology } from "../src/server/pipeline/tavernEcologyRuntime.mjs";
import {
  appraiseOfferingSustenance,
  normalizeCultivationSustenanceProfile,
  normalizeOfferingSustenance,
} from "../src/server/simulation/cultivationSustenance.mjs";
import {
  appraiseServicePrice,
  normalizeMaterialEconomyProfile,
} from "../src/server/simulation/materialEconomy.mjs";
import { buildLuoZhaoTavernBehaviorAcceptanceFixture } from "./fixtures/luoZhaoTavernBehaviorAcceptanceFixture.mjs";

const world = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});

const LUO = "char_xyy_luozhao";
const XIE = "char_xyy_xiezenshi";
const luo = world.characters.find((row) => row.id === LUO);
assert.ok(luo);
assert.equal(world.worldSetup.tavernLifeVersion, 11);
assert.equal(world.worldSetup.tavernSustenanceVersion, 1);
assert.equal(world.worldSetup.tavernMundaneCurrencyVersion, 1);
assert.equal(luo.lifeProfile.physiology.sustenance.mode, "long_fasting_low_mundane_need");
assert.equal(getTavernEcologyProfile(luo).sustenanceProfile.mode, "long_fasting_low_mundane_need");

const meal = world.tavernState.institution.offerings.meal;
const fineTea = world.tavernState.institution.offerings.fine_cloud_tea_pot;
assert.equal(normalizeOfferingSustenance(meal, "meal").class, "mundane_food");
assert.equal(normalizeOfferingSustenance(fineTea, "fine_cloud_tea_pot").class, "mundane_drink");

const mortalProfile = normalizeCultivationSustenanceProfile({ mode: "ordinary_food_dependent" });
const luoProfile = luo.lifeProfile.physiology.sustenance;
const sameHungryBody = { hunger: 0.8, thirst: 0.2, fatigue: 0.3 };
const mortalMeal = appraiseOfferingSustenance({
  sustenanceProfile: mortalProfile,
  bodyState: sameHungryBody,
  offering: meal,
  offeringId: "meal",
});
const luoMeal = appraiseOfferingSustenance({
  sustenanceProfile: luoProfile,
  bodyState: sameHungryBody,
  offering: meal,
  offeringId: "meal",
});
assert.ok(luoMeal.physiologicalNeed < mortalMeal.physiologicalNeed * 0.25);
assert.ok(luoMeal.recoveryEfficiency > 0, "Luo Zhao's mundane-food recovery must remain low but nonzero");
assert.ok(luoMeal.recoveryEfficiency < mortalMeal.recoveryEfficiency * 0.35);

const baseEcology = {
  characterId: LUO,
  elapsedSeconds: 0,
  body: { hunger: 0.2, thirst: 0.2, fatigue: 0.1, pain: 0, stamina: 0.8, energy: 0.8, exertion: 0.1 },
  desires: {},
  currentIntention: {},
  recentActionSignatures: [],
};
const commonAction = { committed: true, actionKind: "observe", candidateId: "observe-test" };
const mortalHour = applyTavernEcologyOutcome({
  ecologyState: baseEcology,
  action: commonAction,
  materialConsequence: { status: "committed" },
  elapsedSeconds: 3600,
  sustenanceProfile: mortalProfile,
});
const luoHour = applyTavernEcologyOutcome({
  ecologyState: baseEcology,
  action: commonAction,
  materialConsequence: { status: "committed" },
  elapsedSeconds: 3600,
  sustenanceProfile: luoProfile,
});
assert.ok((luoHour.body.hunger - 0.2) < (mortalHour.body.hunger - 0.2) * 0.25);

const hungryEcology = { ...structuredClone(baseEcology), body: { ...baseEcology.body, hunger: 0.8 } };
const mealConsequence = {
  status: "committed",
  foodConsumed: true,
  bodyDemand: meal.bodyDemand,
  sustenance: normalizeOfferingSustenance(meal, "meal"),
};
const mortalAfterMeal = applyTavernEcologyOutcome({
  ecologyState: hungryEcology,
  action: { committed: true, actionKind: "consume_food", candidateId: "eat-test" },
  materialConsequence: mealConsequence,
  sustenanceProfile: mortalProfile,
});
const luoAfterMeal = applyTavernEcologyOutcome({
  ecologyState: hungryEcology,
  action: { committed: true, actionKind: "consume_food", candidateId: "eat-test" },
  materialConsequence: mealConsequence,
  sustenanceProfile: luoProfile,
});
assert.ok(luoAfterMeal.body.hunger > mortalAfterMeal.body.hunger);
assert.ok(luoAfterMeal.body.hunger < hungryEcology.body.hunger, "mundane food must retain a low nonzero effect");

const economic = normalizeMaterialEconomyProfile(luo.lifeProfile.materialEconomy, luo.lifeState.resources);
const carriedPrice = appraiseServicePrice({
  economicContext: economic,
  price: { amount: 6, currencyId: "copper_wen" },
});
assert.equal(carriedPrice.coversListedPrice, true);
assert.ok(carriedPrice.acquisitionEase > 0.9);
assert.ok(carriedPrice.acquisitionBurden < 0.08);

const emptyWalletEconomic = normalizeMaterialEconomyProfile(luo.lifeProfile.materialEconomy, { coins: 0 });
const noCarriedCopper = appraiseServicePrice({
  economicContext: emptyWalletEconomic,
  price: { amount: 6, currencyId: "copper_wen" },
});
assert.equal(noCarriedCopper.coversListedPrice, false);
assert.equal(noCarriedCopper.immediateLiquidityFriction, 1);
assert.ok(noCarriedCopper.acquisitionBurden < 0.12, "easy future acquisition should remain distinct from immediate settlement");

const fixture = buildLuoZhaoTavernBehaviorAcceptanceFixture();
const runtime = {
  elapsedSeconds: 0,
  locationId: "loc_xyy_tavern",
  step: 0,
  slotContext: { slotId: "dawn", slotLabel: "清晨", slotBaseId: "dawn" },
  actions: [],
  requestLocks: [],
  agents: {
    [LUO]: { characterId: LUO, characterName: "洛照", present: true, zoneId: "hall" },
    [XIE]: { characterId: XIE, characterName: "谢真石", present: true, zoneId: "hall" },
  },
};
const choice = buildTavernSituatedServiceChoice(fixture.state, runtime, LUO, [XIE]);
assert.ok(choice);
assert.equal(choice.sustenanceContext.mode, "long_fasting_low_mundane_need");
assert.ok(choice.bodyNeeds.effectiveOrdinaryFoodNeed < choice.bodyNeeds.hunger * 0.25);
assert.equal(choice.economicContext.currencyAccess.copper_wen.currencyClass, "mundane");
assert.equal(choice.offers.find((row) => row.id === "meal").sustenance.class, "mundane_food");
assert.equal(choice.offers.find((row) => row.id === "fine_cloud_tea_pot").sustenance.class, "mundane_drink");

const availableAffordances = listTavernCausalAffordances(fixture.state, runtime, LUO, [XIE]);
const ecology = appraiseTavernAgentEcology({
  character: fixture.state.characters.find((row) => row.id === LUO),
  runtime,
  actor: runtime.agents[LUO],
  visibleCharacterIds: [XIE],
  recognizedCharacterIds: [],
  availableAffordances,
});
const mealCandidate = ecology.candidates.find((row) => row.realization?.affordanceId?.includes(":meal:"));
assert.ok(mealCandidate);
assert.ok(mealCandidate.serviceAppraisal.sustenance.physiologicalNeed < 0.05);
assert.ok(mealCandidate.serviceAppraisal.priceAppraisal.acquisitionEase > 0.9);

console.log("cultivationSustenanceEconomyContracts:test passed", {
  luoMode: choice.sustenanceContext.mode,
  mortalMealNeed: mortalMeal.physiologicalNeed,
  luoMealNeed: luoMeal.physiologicalNeed,
  mortalHourlyHungerDelta: mortalHour.body.hunger - 0.2,
  luoHourlyHungerDelta: luoHour.body.hunger - 0.2,
  mundaneCopperAcquisitionEase: carriedPrice.acquisitionEase,
  noCarriedCopperStillCannotSettle: !noCarriedCopper.coversListedPrice,
  fineTeaClass: normalizeOfferingSustenance(fineTea, "fine_cloud_tea_pot").class,
});
