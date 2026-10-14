import assert from "node:assert/strict";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "赛博朋克海底避难城，氧气被公司征税，潮汐闸、黑市码头、祈祷舱和藻类工厂决定谁能活到明天。",
  setupPeoplePrompt: "欠债的潜水员走私者、掌管氧气税的公司监察官、被信徒供奉的合成圣女、修理潮汐闸的老工程师、藏着非法鱼人的黑市医生。",
});

const genericLines = /我只是照规矩办|这对大家都好|现在不是说这个的时候|我只是没有别的办法|先等一下|话还没说完|我只是按原则行事/;
const voices = state.characters.map((character) => ({
  name: character.name,
  identity: character.publicIdentity || "",
  defenseLanguage: character.defenseLanguage || [],
  dialogueMoves: character.agentProfile?.dialogueMoves || [],
  currentSelfLie: character.currentState?.currentSelfLie || "",
  repeatedSelfLie: character.internalSituation?.repeatedSelfLie || "",
}));

for (const voice of voices) {
  const language = voice.defenseLanguage.join("\n");
  assert.ok(voice.defenseLanguage.length >= 3, `${voice.name} should have at least three defense lines`);
  assert.ok(voice.dialogueMoves.length >= 3, `${voice.name} should carry defense lines into agentProfile dialogue moves`);
  assert.doesNotMatch(language, genericLines, `${voice.name} should not fall back to generic defenses`);
  assert.doesNotMatch(voice.currentSelfLie, genericLines, `${voice.name} should not carry generic current self-lie`);
  assert.doesNotMatch(voice.repeatedSelfLie, genericLines, `${voice.name} should not carry generic repeated self-lie`);
  assert.match(
    language,
    /氧气|潮汐|闸|黑市|祈祷|藻类|公司|税|鱼人|通行|血样|账|舱|牌|章/,
    `${voice.name} should speak through world-specific objects and pressures`,
  );
}

const byName = new Map(voices.map((voice) => [voice.name, voice.defenseLanguage.join("\n")]));
assert.match(byName.get("潜水员走私者") || "", /人先|过闸|路线|黑市|氧气|通行/, "smuggler voice should value passage and people over paperwork");
assert.match(byName.get("公司监察官") || "", /公司|税|账|记录|检查|配额|名单/, "inspector voice should speak from records, tax, and company procedure");
assert.match(byName.get("合成圣女") || "", /祈祷|舱|庇护|编号|拖走|受苦/, "saint voice should speak from sanctuary, prayer, and the vulnerable");
assert.match(byName.get("老工程师") || "", /闸|水压|阀|警铃|工厂|藻类/, "engineer voice should speak from valves, pressure, and infrastructure");
assert.match(byName.get("黑市医生") || "", /诊|药|血样|病人|鱼人|袖口/, "doctor voice should speak from treatment and bodies, not generic rules");
assert.doesNotMatch(byName.get("黑市医生") || "", /氧气不是证物，还在流血/, "doctor voice should not attach bleeding-body language to oxygen");
assert.match(byName.get("黑市医生") || "", /鱼人.*不是证物|血样.*不是证物/, "doctor voice should attach evidence language to a body or sample");

assert.equal(
  new Set(voices.map((voice) => voice.defenseLanguage.join("|"))).size,
  voices.length,
  "each custom character should receive a distinct voice",
);

const shorterPromptState = buildPlayableWorldFromSetup({
  setupWorldPrompt: "赛博朋克海底避难城，氧气被公司征税，潮汐闸、黑市码头和祈祷舱互相牵制。",
  setupPeoplePrompt: "潜水员走私者、公司监察官、合成圣女、老工程师、黑市医生。",
});
const shorterInspector = shorterPromptState.characters.find((character) => character.name === "公司监察官");
const shorterText = shorterInspector?.defenseLanguage?.join("\n") || "";
const shorterLocationNames = shorterPromptState.locations.map((location) => location.name).join("\n");
assert.doesNotMatch(shorterPromptState.town.recurringObjects.join("\n"), /公司监察官|潜水员走私者|合成圣女|老工程师|黑市医生/, "custom recurring objects should not include character names");
assert.doesNotMatch(shorterLocationNames, /互相牵制|决定谁|活到明天|被公司征税/, "custom locations should not include world-rule verb phrases");
assert.match(shorterLocationNames, /祈祷舱/, "custom locations should keep the clean place name from a relational clause");
assert.doesNotMatch(shorterText, /公司监察官没打开|潜水员走私者没打开|合成圣女没打开/, "inspector voice should not treat a character name as a record object");
assert.match(shorterText, /记录没打开|账本没打开|名单没打开|配额/, "inspector voice should open a record, ledger, list, or quota");

console.log("customSetupCharacterVoicesNotGeneric:test passed", voices);
