import assert from "node:assert/strict";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "赛博朋克海底避难城，氧气被公司征税，潮汐闸、黑市码头、祈祷舱和藻类工厂决定谁能活到明天。",
  setupPeoplePrompt: "欠债的潜水员走私者、掌管氧气税的公司监察官、被信徒供奉的合成圣女、修理潮汐闸的老工程师、藏着非法鱼人的黑市医生。",
});

const serialized = JSON.stringify(state);
const characterNames = state.characters.map((character) => character.name).join("、");
const locationNames = state.locations.map((location) => location.name).join("、");
const objectNames = state.town.recurringObjects.join("、");
const powerCenters = state.town.powerCenters.join("、");

assert.equal(state.worldSetup.generatedBySkills, true, "custom setup should still run through world and character skills");
assert.equal(state.project.title.includes("海底") || state.town.name.includes("海底"), true, "custom world title should reflect the user's world prompt");
assert.match(serialized, /氧气/, "custom world should preserve the user's central resource");
assert.match(powerCenters, /潮汐闸|黑市码头|祈祷舱|藻类工厂/, "custom world should derive power centers from the prompt instead of generic rooms");
assert.match(objectNames, /氧气|税|闸|藻类|祈祷|黑市/, "custom world should derive recurring objects from the prompt");
assert.match(locationNames, /潮汐闸|黑市码头|祈祷舱|藻类工厂/, "custom locations should come from the user's places");
assert.match(characterNames, /潜水员|监察官|圣女|工程师|医生/, "custom characters should preserve distinctive roles from the people prompt");
assert.doesNotMatch(locationNames, /被公司征税|征税/, "custom locations should not turn resource tax clauses into places");
for (const roleName of ["潜水员走私者", "公司监察官", "合成圣女", "老工程师", "黑市医生"]) {
  assert.ok(characterNames.includes(roleName), `custom character names should preserve role name: ${roleName}`);
}
assert.ok(
  state.characters.every((character) => character.agentProfile?.leverageObject && character.agentProfile?.dramaticObjective),
  "custom characters should become playable agent profiles",
);
assert.ok(
  state.relationships.some((relationship) => /氧气|公司|黑市|潮汐|鱼人|圣女/.test(relationship.unspoken)),
  "custom relationships should carry prompt-specific pressure, not only generic old history",
);

for (const generic of ["门口", "桌边", "街口", "钥匙", "杯子", "纸条"]) {
  assert.ok(!locationNames.includes(generic), `custom world should not fall back to generic location ${generic}`);
  assert.ok(!objectNames.includes(generic), `custom world should not fall back to generic object ${generic}`);
}

console.log("customSetupPromptSpecificSkillWorld:test passed", {
  title: state.project.title,
  characters: characterNames,
  locations: locationNames,
  objects: objectNames,
});
