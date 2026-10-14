import assert from "node:assert/strict";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { getState, importState } from "../src/state/store.js";

const legacy = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于 Downloads 下《逍遥游》策划案与当前版剧本，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
delete legacy.worldSetup.performanceSeedVersion;
const legacyLine = "九重还没走完，先别替我说到中州。";
const poison = (character) => character.name === "谢真石" ? {
  ...character,
  speechProfile: null,
  defenseLanguage: [legacyLine],
  agentProfile: { ...(character.agentProfile || {}), speechProfile: null, dialogueMoves: [legacyLine] },
  internalSituation: { ...(character.internalSituation || {}), repeatedSelfLie: legacyLine },
  currentState: { ...(character.currentState || {}), currentSelfLie: legacyLine },
} : character;
legacy.characters = legacy.characters.map(poison);
legacy.branches = (legacy.branches || []).map((branch) => ({
  ...branch,
  snapshot: branch.snapshot ? { ...branch.snapshot, characters: (branch.snapshot.characters || legacy.characters).map(poison) } : branch.snapshot,
}));

importState(JSON.stringify(legacy));
const migrated = getState();
assert.equal(migrated.worldSetup.performanceSeedVersion, 2, "generated worlds should migrate away from performance-writing seeds");
assert.ok(!JSON.stringify(migrated.characters).includes(legacyLine), "active characters must not retain prescribed dialogue");
assert.ok((migrated.characters.find((character) => character.name === "谢真石")?.speechProfile?.cadence || "").length > 0, "migration should restore a nonverbatim speech profile");
for (const branch of migrated.branches || []) {
  assert.ok(!JSON.stringify(branch.snapshot?.characters || []).includes(legacyLine), `branch ${branch.id} must not retain prescribed dialogue`);
}

console.log("performanceSeedMigration:test passed", { version: migrated.worldSetup.performanceSeedVersion });
