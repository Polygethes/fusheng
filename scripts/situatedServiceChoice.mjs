import assert from "node:assert/strict";
import {
  auditSituatedServiceChoiceInput,
  buildSituatedServiceChoiceTool,
  compileSituatedServiceAffordances,
} from "../src/server/simulation/situatedServiceChoice.mjs";

const base = {
  actorId: "char_traveler",
  operatorActorIds: ["char_innkeeper"],
  bodyNeeds: { hunger: 0.24, thirst: 0.42, fatigue: 0.28 },
  ownedTender: [{ id: "coins_traveler", currencyId: "copper_wen", amount: 8 }],
  offers: [
    {
      id: "rough_tea",
      label: "粗茶",
      available: true,
      price: { amount: 1, currencyId: "copper_wen", knownToActor: true },
      needChannels: ["thirst", "stay_legitimacy"],
    },
    {
      id: "plain_meal",
      label: "常饭",
      available: true,
      price: { amount: 5, currencyId: "copper_wen", knownToActor: true },
      needChannels: ["hunger", "fatigue"],
    },
  ],
  tableUseNorm: {
    id: "norm_public_table_use",
    sitWithoutOrderingPhysicallyPossible: true,
    operatorResponseRequiresOwnAction: true,
    pressureOnset: "人物占用客桌且被经营者注意后随时间产生",
  },
};

assert.equal(auditSituatedServiceChoiceInput(base).valid, true);
const affordances = compileSituatedServiceAffordances(base);
assert.equal(affordances.length, 2);
assert.ok(affordances.every((row) => row.type === "request_service"));
assert.ok(affordances.every((row) => row.effects.some((effect) => /不会自动交付/u.test(effect))));
assert.equal(affordances.find((row) => row.offeringId === "plain_meal").paymentCapacity.coversListedPrice, true);
assert.equal(buildSituatedServiceChoiceTool().choiceAuthority, "character-agent");

const poisoned = structuredClone(base);
poisoned.offers[0].preferred = true;
assert.ok(auditSituatedServiceChoiceInput(poisoned).errors.some((row) => row.code === "SERVICE_CHOICE_AUTHOR_ANSWER_LEAK"));

const forcedNorm = structuredClone(base);
forcedNorm.tableUseNorm.sitWithoutOrderingPhysicallyPossible = false;
assert.ok(auditSituatedServiceChoiceInput(forcedNorm).errors.some((row) => row.code === "SERVICE_TABLE_NORM_INVALID"));

console.log("situatedServiceChoice:test passed", {
  neutralOffers: affordances.map((row) => row.offeringId),
  characterChooses: true,
  requestDoesNotAutoServe: true,
  nonPurchaseRemainsAttemptable: true,
});
