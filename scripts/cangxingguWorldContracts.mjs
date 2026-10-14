// 借星 · 雨夜入谷: the whole of 藏星谷 on the rainy night a young refugee
// couple carries their newborn in through a gap in the hills. The 借星
// documents are its setting only; nothing of their storyline is written in.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isBuiltInWorld, listWorldPackIds, loadWorldPack } from "../src/worlds/registry.mjs";
import { validateBlueprint } from "../src/worlds/blueprint/validateBlueprint.mjs";
import { compileBlueprint } from "../src/worlds/compiler/index.mjs";
import { validateWorldPack } from "../src/worlds/validateWorldPack.mjs";
import { runWorldSmoke } from "../src/worlds/worldSmoke.mjs";
import { createFreshWorldSave } from "../src/worlds/freshWorld.mjs";

const blueprint = JSON.parse(fs.readFileSync("src/worlds/cangxinggu/blueprint.json", "utf8"));
const text = JSON.stringify(blueprint);

// 1. A built-in world, compiled from its blueprint without complaint.
assert.ok(isBuiltInWorld("cangxinggu"));
const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), "cangxinggu-"));
assert.ok(listWorldPackIds({ ...process.env, CHARACTER_TOWN_HOME: emptyHome }).includes("cangxinggu"));
fs.rmSync(emptyHome, { recursive: true, force: true });
assert.deepEqual(validateBlueprint(blueprint).issues, []);
const compiled = compileBlueprint(blueprint);
assert.deepEqual(compiled.report.warnings, [], "no deferred visitors or events, nothing dropped");
const pack = await loadWorldPack("cangxinggu");
assert.equal(pack.meta.id, "cangxinggu");
assert.equal(pack.meta.title, "借星 · 雨夜入谷");
assert.equal(pack.meta.scale, "town");
assert.deepEqual(validateWorldPack(pack).issues, [], "V1–V13 clean");
assert.deepEqual(pack.meta.provisional, [], "every desire is grounded in the valley");

// 2. The valley.
assert.deepEqual(blueprint.town.terrain, { river: "east", forest: "west", hills: "north", fields: "south" });
const sites = Object.fromEntries(blueprint.town.sites.map((row) => [row.id, [row.name, row.type, row.householdId || null]]));
assert.deepEqual(sites, {
  feiwu: ["山口废屋", "home", "gu"],
  shi_home: ["石家老屋", "home", "shi"],
  bao_yard: ["宝家院子", "farmhouse", "bao"],
  he_home: ["何家织屋", "home", "he"],
  lu_workshop: ["鲁家石作", "smithy", "lu"],
  du_lu: ["杜婆婆药庐", "herb_shop", "du"],
  wen_school: ["温先生私塾", "school", "wen"],
  shrine: ["谷神祠", "temple", null],
  square: ["晒谷场", "square", null],
  well: ["老井", "well", null],
  gukou: ["谷口山道", "road_out", null],
  zhenyan: ["北坡阵眼", "array_eye", null],
  wangyun: ["望云坡", "hill", null],
  creek: ["藏星溪边", "river_bank", null],
  bridge: ["溪上石桥", "bridge", null],
  terraces: ["梯田", "field", null],
  herb_field: ["药田", "field", null],
  pinewood: ["后山松林", "forest", null],
});
assert.equal(pack.layout.maps.exterior.grid?.cols ?? pack.layout.maps.exterior.rect?.[2], 96, "a valley-sized map");

// 3. The people: the couple, and the valley's own.
const people = Object.fromEntries(blueprint.residents.map((row) => [row.id, row]));
assert.deepEqual(Object.fromEntries(Object.entries(people).map(([id, row]) => [id, [row.name, row.householdId]])), {
  gu_huaishan: ["顾怀山", "gu"],
  lu_qinghe: ["陆青禾", "gu"],
  shi_shoutian: ["石守田", "shi"],
  shi_xiaohu: ["石小虎", "shi"],
  bao_dachuan: ["宝大川", "bao"],
  liu_chunniang: ["柳春娘", "bao"],
  he_sao: ["何嫂", "he"],
  lu_laoshi: ["鲁老石", "lu"],
  du_popo: ["杜婆婆", "du"],
  wen_xiansheng: ["温先生", "wen"],
});
assert.equal(people.shi_xiaohu.age, 9);
assert.equal(people.shi_xiaohu.appearance.child, true);
assert.ok(Object.values(people).filter((row) => row.id !== "shi_xiaohu").every((row) => row.appearance.child === false));
assert.deepEqual(Object.values(people).filter((row) => row.skills.includes("arrays")).map((row) => row.id).sort(), ["gu_huaishan", "lu_laoshi"], "only two people know 阵法");
assert.ok(people.lu_qinghe.skills.includes("medicine") && people.du_popo.skills.includes("herbalism"));
for (const row of Object.values(people)) {
  assert.ok(row.desires.length >= 2, `${row.name} wants more than one thing`);
  assert.ok(row.secrets.length >= 1 || row.id === "bao_dachuan" || row.id === "liu_chunniang", `${row.name} keeps something to themself`);
  assert.ok(row.speech.samples.length >= 3, `${row.name} has a voice`);
}

// 4. Nobody in the valley knows the couple, and they know nobody.
const strangers = new Set(["gu_huaishan", "lu_qinghe"]);
for (const rel of blueprint.relationships) {
  assert.equal(strangers.has(rel.from), strangers.has(rel.to), `${rel.from} → ${rel.to}: the couple are strangers here`);
}
const tie = (from, to) => blueprint.relationships.find((row) => row.from === from && row.to === to);
for (const [a, b] of [["gu_huaishan", "lu_qinghe"], ["shi_shoutian", "shi_xiaohu"], ["bao_dachuan", "liu_chunniang"]]) {
  assert.ok(tie(a, b) && tie(b, a), `${a} and ${b} are family both ways`);
}
assert.ok(tie("lu_qinghe", "gu_huaishan").address.includes("怀山"));
assert.ok(tie("gu_huaishan", "lu_qinghe").address.includes("青禾"));
assert.ok(blueprint.relationships.length >= 16, "the valley is a web, not a list");

// 4b. Nobody starts out knowing what they could not know. At 19:00 no one in
// the valley has met the couple: only 石小虎 saw a blue flash and 宝大川 found
// footprints. The couple, new here, know no one and no place but the gap they
// came through and the house they are hiding in. What a person wants, says,
// does and hides is written from what that person knows.
const told = (row) => JSON.stringify({ situation: row.situation, desires: row.desires, speech: row.speech, principles: row.principles,
  boundaries: row.boundaries, routine: row.routine, memories: row.memories, secrets: row.secrets });
for (const row of Object.values(people).filter((person) => !strangers.has(person.id))) {
  for (const word of ["顾怀山", "陆青禾", "山口废屋", "襁褓", "婴儿", "夫妇", "玉符的"]) {
    assert.ok(!told(row).includes(word), `${row.name} cannot know of ${word} yet`);
  }
  if (!["shi_xiaohu", "bao_dachuan"].includes(row.id)) {
    for (const word of ["青光", "脚印", "生人"]) assert.ok(!told(row).includes(word), `${row.name} has not seen ${word}`);
  }
}
for (const id of strangers) {
  const row = people[id];
  for (const word of ["石守田", "石小虎", "宝大川", "柳春娘", "何嫂", "鲁老石", "杜婆婆", "温先生", "药庐", "石家", "宝家", "何家", "鲁家", "私塾", "谷神祠", "北坡", "晒谷场", "梯田", "药田", "松林", "望云坡", "老井", "石桥"]) {
    assert.ok(!told(row).includes(word), `${row.name} does not know ${word} yet`);
  }
}

// 5. The opening: a rainy night at 戌时初.
assert.equal(blueprint.meta.startClock, "19:00");
assert.equal(blueprint.meta.startLabel, "戌时初");
const at = blueprint.opening.positions;
assert.deepEqual([at.gu_huaishan, at.lu_qinghe, at.bao_dachuan, at.lu_laoshi, at.shi_xiaohu], ["feiwu", "feiwu", "gukou", "zhenyan", "square"]);
assert.deepEqual([at.shi_shoutian, at.liu_chunniang, at.he_sao, at.du_popo, at.wen_xiansheng], ["shi_home", "bao_yard", "he_home", "du_lu", "wen_school"]);
const objects = Object.fromEntries(blueprint.opening.objects.map((row) => [row.name, row]));
assert.deepEqual([objects["襁褓里的婴儿"]?.holder, objects["襁褓里的婴儿"]?.known], ["lu_qinghe", "public"]);
assert.equal(objects["襁褓里的婴儿"].state.hungry, true);
assert.deepEqual([objects["生锈的短剑"]?.holder, objects["生锈的短剑"]?.known], ["gu_huaishan", "private"]);
assert.deepEqual([objects["引路玉符"]?.holder, objects["引路玉符"]?.known], ["lu_qinghe", "private"]);
assert.deepEqual([objects["阵石碎块"]?.holder, objects["阵石碎块"]?.known], ["shi_xiaohu", "private"]);
assert.deepEqual([objects["阵纹拓样"]?.holder, objects["阵纹拓样"]?.known], ["lu_laoshi", "private"]);
const lines = objects["北坡阵眼的阵纹"];
assert.deepEqual([lines?.madeAt, lines?.madeWith, lines?.needed, lines?.known], ["zhenyan", "mend_array_eye", 2, "public"]);
assert.equal(blueprint.opening.deadlines.length, 1, "one pressure, the valley's own; the rest is up to the people");
const [deadline] = blueprint.opening.deadlines;
assert.equal(deadline.dueClock, "23:00");
assert.deepEqual(deadline.responsible, ["lu_laoshi"]);
assert.ok(deadline.knownBy.includes("lu_laoshi") && deadline.knownBy.includes("shi_shoutian"));
assert.deepEqual(deadline.conditions, [{ kind: "object_ready", object: "北坡阵眼的阵纹" }]);
assert.ok(blueprint.opening.mysteries.length >= 4);
assert.deepEqual([blueprint.opening.events, blueprint.opening.visitors], [[], []]);

// 6. Setting, not storyline: the documents' later plot is not written in.
for (const word of ["接引", "剑宗", "十二岁", "离家", "失星", "穿越"]) {
  assert.ok(!text.includes(word), `the blueprint does not bring in the storyline (${word})`);
}

// 7. The night storm, and where everyone stands once compiled.
assert.equal(pack.stage.perceptionEnvironment.weather, "rain");
assert.ok(pack.stage.perceptionEnvironment.light <= 0.4, "a dark, rainy night");
assert.equal(pack.clock.startClock, "19:00");
const feiwuEntry = pack.stage.sites.find((row) => row.id === "feiwu").entryZoneId;
const castId = (name) => pack.cast.find((row) => row.name === name).id;
assert.ok(pack.stage.scenePositions[castId("顾怀山")].startsWith("feiwu__"));
assert.ok(pack.stage.scenePositions[castId("陆青禾")].startsWith("feiwu__"));
assert.ok(feiwuEntry.startsWith("feiwu__"));
const mend = pack.work.find((row) => row.zoneId === "zhenyan__eye");
assert.deepEqual(mend?.requiredSkillIds, ["arrays"]);

// 8. It runs: smoke without a model, and a fresh save.
const smoke = await runWorldSmoke(pack, { stages: false });
assert.deepEqual(smoke.issues, [], "smoke clean");
const fresh = await createFreshWorldSave(pack, { runId: "cangxinggu-contract" });
assert.equal(fresh.save.worldPackId, "cangxinggu");
assert.equal(fresh.save.checkpoint.actors.length, 10);

console.log("借星 · 雨夜入谷 passed: the whole valley, ten people, a rainy night at 戌时初, setting without storyline.");
