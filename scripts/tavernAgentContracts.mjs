import assert from "node:assert/strict";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});

assert.equal(state.worldSetup.tavernLifeVersion, 11, "the Agent-runtime tavern needs the current causal migration boundary");
assert.equal(state.tavernState?.institution?.householdName, "谢家");
assert.deepEqual(state.tavernState?.institution?.ownerIds, ["char_xyy_xieheng"]);
assert.equal(state.tavernState?.institution?.operatorId, "char_xyy_xiemu");
assert.ok(state.tavernState?.institution?.offerings?.meal?.price > 0);
assert.ok(state.tavernState?.institution?.offerings?.tea?.price > 0);
assert.ok(state.tavernState?.institution?.offerings?.fine_cloud_tea_pot?.price > state.tavernState?.institution?.offerings?.tea?.price);

const byId = new Map(state.characters.map((character) => [character.id, character]));
const expectedStanding = {
  char_xyy_xieheng: "proprietor",
  char_xyy_xiemu: "manager",
  char_xyy_xiezenshi: "household_worker",
  char_xyy_zhoumin: "delivery_guest",
  char_xyy_luozhao: "visitor",
  char_xyy_yanzhizhong: "tea_guest",
  char_xyy_chenyan: "work_exchange_guest",
};

for (const [characterId, standing] of Object.entries(expectedStanding)) {
  const character = byId.get(characterId);
  const agency = character?.lifeProfile?.tavernAgency;
  assert.ok(agency, `${character?.name || characterId} needs a layered tavern Agent contract`);
  assert.equal(agency.version, 1);
  assert.equal(agency.standing, standing);
  assert.ok(agency.placeRelationship, `${character.name} must know how this place relates to them`);
  assert.ok(Array.isArray(agency.responsibilities), `${character.name} needs explicit responsibilities`);
  assert.ok(agency.knowledgeBoundary?.publicFacts?.length, `${character.name} needs a knowledge boundary`);
  assert.ok(agency.expression?.roleLabel, `${character.name} needs a visible situational role label`);
  assert.ok(character.lifeProfile?.materialEconomy?.materialPosition, `${character.name} needs a concrete wealth position`);
  assert.ok(character.lifeProfile?.materialEconomy?.consumptionPreferences, `${character.name} needs consumption preference ranges`);
}

for (const characterId of ["char_xyy_zhoumin", "char_xyy_luozhao", "char_xyy_yanzhizhong", "char_xyy_chenyan"]) {
  const character = byId.get(characterId);
  const visit = character.lifeProfile.tavernAgency.visitPolicy;
  assert.ok(visit?.purpose, `${character.name} must know why they come`);
  if (visit.kind === "self_directed") {
    assert.equal(visit.purposeDisclosureRequired, false);
    assert.equal(visit.hostReceptionRequired, false);
    assert.equal(visit.requestedService, "none");
    assert.equal(visit.paymentMode, "none");
    continue;
  }
  assert.ok(visit?.expectedHostIds?.length, `${character.name} must know whom they expect to deal with`);
  assert.ok(visit?.requestedService, `${character.name} must seek a concrete service or exchange`);
  assert.ok(visit?.completionCondition, `${character.name} must know when the visit is over`);
  assert.ok(visit?.paymentMode, `${character.name} must know how the visit is settled`);
}

console.log("tavernAgentContracts:test passed", {
  owner: byId.get(state.tavernState.institution.ownerIds[0]).name,
  operator: byId.get(state.tavernState.institution.operatorId).name,
  standings: Object.values(expectedStanding),
});
