import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { renderApp } from "../src/ui/render.js";
import {
  auditDramaticCharacter,
  buildWorldSkillContract,
  dramaticCharacterSkill,
  worldBuildingSkill,
} from "../src/worldbuilding/skills.js";

const contract = buildWorldSkillContract({
  era: "1912 德语布拉格",
  location: "萨姆沙公寓",
  background: "债务家庭",
});

for (const field of ["timepoint", "era", "location", "background", "baseRules", "ruleSets", "boundaries", "simulationClock", "visibilityPolicy", "forbiddenKnowledge"]) {
  assert.ok(contract.requiredFields.includes(field), `world skill should require ${field}`);
}

for (const checkpoint of ["底层规则", "规则组", "边界", "运行方式", "禁止预知"]) {
  assert.ok(worldBuildingSkill.checkpoints.some((item) => item.includes(checkpoint)), `world skill should expose checkpoint: ${checkpoint}`);
}

for (const field of ["publicIdentity", "externalSituation", "internalSituation", "selfMyth", "actionLines", "prehistory", "boundaries", "distinctionAxis", "relationshipPressure"]) {
  assert.ok(dramaticCharacterSkill.minimumFields.includes(field), `character skill should require ${field}`);
}

for (const checkpoint of ["戏剧行动", "人物边界", "前史", "区分轴"]) {
  assert.ok(dramaticCharacterSkill.checkpoints.some((item) => item.includes(checkpoint)), `character skill should expose checkpoint: ${checkpoint}`);
}

const grete = initialState.characters.find((character) => character.id === "char_grete");
const audit = auditDramaticCharacter(grete, initialState.characters);
assert.ok(audit.score >= 80, `Grete should pass dramatic character audit, got ${audit.score}`);
assert.ok(audit.distinctionAxis.length >= 3, "dramatic character audit should name distinction axes");

const launchState = structuredClone(initialState);
launchState.ui.setupStep = "launch";
const html = renderApp(launchState);
for (const label of ["世界建立 Skill", "戏剧人物 Skill", "底层规则", "规则组", "边界", "人物边界", "前史", "区分轴"]) {
  assert.ok(!html.includes(label), `setup UI should hide backend skill concept: ${label}`);
}

console.log("worldCharacterSkillContracts:test passed", {
  worldFields: contract.requiredFields.length,
  characterScore: audit.score,
});
