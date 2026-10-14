import assert from "node:assert/strict";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { getState, importState } from "../src/state/store.js";

const legacy = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于 Downloads 下《逍遥游》策划案与当前版剧本，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚，只写开场前史，不预知后续剧情。",
});

delete legacy.worldSetup.psychologyNeedVersion;
for (const character of legacy.characters) {
  delete character.agentProfile.desiredResponse;
  delete character.agentProfile.desiredWitness;
  delete character.internalSituation.desiredResponse;
  character.internalSituation.desiredJudge = "最能看穿自己的人。";
  delete character.innerCourt.desiredResponse;
  character.innerCourt.desiredJudge = "最能看穿自己的人。";
  character.innerCourt.wants = "recognition";
}
for (const branch of legacy.branches || []) {
  branch.snapshot.characters = legacy.characters;
}

importState(JSON.stringify(legacy));
const migrated = getState();
assert.equal(migrated.worldSetup.psychologyNeedVersion, 3, "legacy generated worlds should migrate psychological needs once");
assert.equal(
  new Set(migrated.characters.map((character) => character.agentProfile?.desiredResponse)).size,
  migrated.characters.length,
  "migration should restore distinct agent needs without resetting the world",
);
for (const character of migrated.characters) {
  assert.ok(character.internalSituation.desiredResponse, `${character.name} should gain a desired response`);
  assert.ok(character.innerCourt.desiredResponse, `${character.name} should gain an inner-court desired response`);
  assert.notEqual(character.innerCourt.wants, "recognition", `${character.name} should not retain a backend enum as visible psychology`);
}

console.log("psychologyNeedsMigration:test passed", migrated.characters.map((character) => character.name));
