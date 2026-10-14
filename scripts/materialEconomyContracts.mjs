import assert from "node:assert/strict";

import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import {
  applyTavernCausalAffordance,
  buildTavernSituatedServiceChoice,
  listTavernCausalAffordances,
} from "../src/server/pipeline/tavernCausalEconomy.mjs";
import {
  auditMaterialEconomyProfile,
  consumeOfferingStock,
  offeringCurrentlyAvailable,
} from "../src/server/simulation/materialEconomy.mjs";
import { buildTavernSceneRuntime } from "../src/server/pipeline/tavernCausalScene.mjs";
import { buildLuoZhaoTavernBehaviorAcceptanceFixture } from "./fixtures/luoZhaoTavernBehaviorAcceptanceFixture.mjs";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});

const expectedWallets = new Map([
  ["char_xyy_xiezenshi", 10],
  ["char_xyy_zhoumin", 7],
  ["char_xyy_luozhao", 24],
  ["char_xyy_yanzhizhong", 24],
  ["char_xyy_xieheng", 5],
  ["char_xyy_xiemu", 3],
  ["char_xyy_chenyan", 0],
]);

for (const character of state.characters) {
  const profile = character.lifeProfile?.materialEconomy;
  assert.ok(profile, `${character.name} must own a material economy profile`);
  assert.equal(auditMaterialEconomyProfile(profile).valid, true, `${character.name} material economy must validate`);
  assert.equal(character.lifeState.resources.coins, expectedWallets.get(character.id));
  assert.equal(character.lifeState.resources.wallet.amount, expectedWallets.get(character.id));
  assert.equal(character.lifeState.resources.wallet.sourceId, profile.initialWallet.sourceId);
}

const chen = state.characters.find((row) => row.id === "char_xyy_chenyan");
assert.equal(chen.lifeState.resources.coins, 0, "Chen Yan's work-for-meal motive must not coexist with an arbitrary six-wen purse");

const fixture = buildLuoZhaoTavernBehaviorAcceptanceFixture();
const ids = fixture.characterIds;
const luoId = "char_xyy_luozhao";
const xieId = "char_xyy_xiezenshi";
const runtime = buildTavernSceneRuntime(fixture.state, {
  characterIds: [luoId, xieId],
  positions: { [luoId]: "hall", [xieId]: "hall" },
  slotContext: fixture.slotContext,
});
assert.deepEqual(new Set(ids), new Set([luoId, xieId]));
const choice = buildTavernSituatedServiceChoice(fixture.state, runtime, luoId, [xieId]);
assert.ok(choice);
assert.equal(choice.economicContext.wealthBand, "institution_backed_traveler");
assert.equal(choice.economicContext.wallet.amount, 24);
assert.equal(choice.economicContext.access.businessTillAccess, false);
assert.equal(choice.economicContext.access.institutionalSupport, true);
assert.deepEqual(choice.economicContext.consumptionPreferences.priceSensitivity, [0.14, 0.3]);

const teaOffers = choice.offers.filter((row) => row.category === "tea");
assert.deepEqual(teaOffers.map((row) => row.id), ["hot_water", "tea", "house_tea_pot", "fine_cloud_tea_pot"]);
assert.deepEqual(teaOffers.map((row) => row.price.amount), [0, 1, 3, 6]);
assert.equal(teaOffers.at(-1).qualityTier, "fine");
assert.ok(teaOffers.every((row) => !Object.hasOwn(row, "preferred") && !Object.hasOwn(row, "score") && !Object.hasOwn(row, "recommendation")));
const fineRequest = choice.requestAffordances.find((row) => row.offeringId === "fine_cloud_tea_pot");
assert.ok(fineRequest);
assert.equal(fineRequest.paymentCapacity.coversListedPrice, true);
assert.ok(fineRequest.effects.some((row) => /不会自动交付/u.test(row)));

const fineOffering = fixture.state.tavernState.institution.offerings.fine_cloud_tea_pot;
const stock = structuredClone(fixture.state.tavernState.stock);
assert.equal(offeringCurrentlyAvailable(stock, fineOffering, "fine_cloud_tea_pot"), true);
const stockDelta = consumeOfferingStock(stock, fineOffering, "fine_cloud_tea_pot");
assert.deepEqual(stockDelta, { fineTea: -1, water: -2, firewood: -0.08 });
assert.equal(stock.fineTea, fixture.state.tavernState.stock.fineTea - 1);
assert.equal(stock.water, fixture.state.tavernState.stock.water - 2);

const transactionState = structuredClone(fixture.state);
const transactionRuntime = structuredClone(runtime);
const beforeFineTea = transactionState.tavernState.stock.fineTea;
const beforeWater = transactionState.tavernState.stock.water;
const beforeCashBox = transactionState.tavernState.cashBox;
const requestFine = listTavernCausalAffordances(transactionState, transactionRuntime, luoId, [xieId])
  .find((row) => row.type === "request_service" && row.offeringId === "fine_cloud_tea_pot");
assert.ok(requestFine);
assert.ok(applyTavernCausalAffordance(transactionState, transactionRuntime, {
  id: "test:luo:request-fine-tea",
  actorId: luoId,
  speech: "来壶好茶。",
  visibleAction: "",
}, requestFine, [xieId]));
let operatorAffordances = listTavernCausalAffordances(transactionState, transactionRuntime, xieId, [luoId]);
assert.equal(operatorAffordances.some((row) => row.type === "serve_guest"), false);
for (let step = 0; step < 5 && !operatorAffordances.some((row) => row.type === "start_service_preparation"); step += 1) {
  const approach = operatorAffordances.find((row) => row.type === "approach_service_station" || row.type === "approach_service_vessel");
  assert.ok(approach);
  assert.ok(applyTavernCausalAffordance(transactionState, transactionRuntime, {
    id: `test:xie:fine-tea-approach:${step}`,
    actorId: xieId,
    speech: "",
    visibleAction: "",
    moveToZoneId: approach.moveToZoneId,
  }, approach, [luoId]));
  transactionRuntime.agents[xieId].zoneId = approach.moveToZoneId;
  operatorAffordances = listTavernCausalAffordances(transactionState, transactionRuntime, xieId, []);
}
const startFine = operatorAffordances.find((row) => row.type === "start_service_preparation");
assert.ok(startFine);
assert.ok(applyTavernCausalAffordance(transactionState, transactionRuntime, {
  id: "test:xie:start-fine-tea",
  actorId: xieId,
  speech: "",
  visibleAction: "",
  moveToZoneId: startFine.moveToZoneId,
}, startFine, []));
transactionRuntime.agents[xieId].zoneId = startFine.moveToZoneId || transactionRuntime.agents[xieId].zoneId;
assert.equal(transactionState.tavernState.stock.fineTea, beforeFineTea - 1);
assert.equal(transactionState.tavernState.stock.water, beforeWater - 2);
const fineProcess = transactionState.tavernState.serviceProcesses.find((row) => row.subjectId === transactionState.tavernState.activeVisits[0].id);
transactionRuntime.elapsedSeconds += fineProcess.durationSeconds;
const finishFine = listTavernCausalAffordances(transactionState, transactionRuntime, xieId, [])
  .find((row) => row.type === "finish_service_preparation");
assert.ok(finishFine);
assert.ok(applyTavernCausalAffordance(transactionState, transactionRuntime, {
  id: "test:xie:finish-fine-tea",
  actorId: xieId,
  speech: "",
  visibleAction: "",
}, finishFine, []));
operatorAffordances = listTavernCausalAffordances(transactionState, transactionRuntime, xieId, []);
for (let step = 0; step < 5 && !operatorAffordances.some((row) => row.type === "serve_guest"); step += 1) {
  const carry = operatorAffordances.find((row) => row.type === "approach_service_delivery");
  assert.ok(carry);
  assert.ok(applyTavernCausalAffordance(transactionState, transactionRuntime, {
    id: `test:xie:fine-tea-delivery:${step}`,
    actorId: xieId,
    speech: "",
    visibleAction: "",
    moveToZoneId: carry.moveToZoneId,
  }, carry, []));
  transactionRuntime.agents[xieId].zoneId = carry.moveToZoneId;
  operatorAffordances = listTavernCausalAffordances(transactionState, transactionRuntime, xieId, [luoId]);
}
const serveFine = operatorAffordances.find((row) => row.type === "serve_guest" && row.targetCharacterId === luoId);
assert.ok(serveFine);
assert.match(serveFine.canonicalVisibleAction, /茶壶.*云岫春芽/u);
assert.ok(applyTavernCausalAffordance(transactionState, transactionRuntime, {
  id: "test:xie:serve-fine-tea",
  actorId: xieId,
  speech: "",
  visibleAction: "",
}, serveFine, [luoId]));
const consumeFine = listTavernCausalAffordances(transactionState, transactionRuntime, luoId, [xieId])
  .find((row) => row.type === "consume_service" && row.offeringId === "fine_cloud_tea_pot");
assert.ok(consumeFine);
assert.ok(applyTavernCausalAffordance(transactionState, transactionRuntime, {
  id: "test:luo:consume-fine-tea",
  actorId: luoId,
  speech: "",
  visibleAction: "",
}, consumeFine, [xieId]));
const payFine = listTavernCausalAffordances(transactionState, transactionRuntime, luoId, [xieId])
  .find((row) => row.type === "pay_cash");
assert.ok(payFine);
assert.ok(applyTavernCausalAffordance(transactionState, transactionRuntime, {
  id: "test:luo:pay-fine-tea",
  actorId: luoId,
  speech: "",
  visibleAction: "",
}, payFine, [xieId]));
const transactionLuo = transactionState.characters.find((row) => row.id === luoId);
assert.equal(transactionLuo.lifeState.resources.coins, 18);
assert.equal(transactionLuo.lifeState.resources.wallet.amount, 18);
assert.equal(transactionState.tavernState.cashBox, beforeCashBox + 6);
assert.equal(transactionState.tavernState.activeVisits[0].paymentStatus, "paid");

console.log("materialEconomyContracts:test passed", {
  characterWallets: Object.fromEntries(expectedWallets),
  luoWealthBand: choice.economicContext.wealthBand,
  teaTiers: teaOffers.map((row) => `${row.label}:${row.price.amount}文`),
  fineTeaTransaction: { walletAfter: transactionLuo.lifeState.resources.coins, price: 6 },
  characterStillChooses: true,
});
