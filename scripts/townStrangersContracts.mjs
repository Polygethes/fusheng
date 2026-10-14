// A town's residents know one another; someone who has just arrived knows only
// the people they came with, and nobody knows them. A stranger is seen, not
// named: everyone has a look that others see before they know a name. What a
// person carries in the open keeps its name; what they keep private is hidden.
import assert from "node:assert/strict";
import fs from "node:fs";
import { validateBlueprint } from "../src/worlds/blueprint/validateBlueprint.mjs";
import { compileBlueprint } from "../src/worlds/compiler/index.mjs";
import { publicLookOf } from "../src/worlds/compiler/cast.mjs";
import { loadWorldPack } from "../src/worlds/registry.mjs";
import { defineWorldPack } from "../src/worlds/worldPack.mjs";
import { buildPlayableWorldFromPack } from "../src/worlds/buildPlayableWorldFromPack.mjs";
import { createWorldRuntimeV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";

const clone = (value) => JSON.parse(JSON.stringify(value));
const hamlet = JSON.parse(fs.readFileSync("scripts/fixtures/blueprints/tiny_hamlet.json", "utf8"));

// 1. Two optional resident fields: newcomer (a boolean) and look (what others see, at most 60 characters).
const withNewcomer = clone(hamlet);
withNewcomer.residents[0].newcomer = true;
withNewcomer.residents[0].look = "一身泥水的外乡汉子";
assert.deepEqual(validateBlueprint(withNewcomer).issues, []);
const notBoolean = clone(hamlet);
notBoolean.residents[0].newcomer = "yes";
assert.ok(validateBlueprint(notBoolean).issues.length > 0, "newcomer must be true or false");
const tooLong = clone(hamlet);
tooLong.residents[0].look = "长".repeat(61);
assert.ok(validateBlueprint(tooLong).issues.length > 0, "a look is one short line");

// 2. Who knows whom.
const charId = (worldId, residentId) => `char_${worldId}_${residentId}`;
{
  const { pack } = compileBlueprint(withNewcomer);
  const id = (rid) => charId(hamlet.meta.id, rid);
  const member = (rid) => pack.cast.find((row) => row.id === id(rid));
  const [newcomer, ...locals] = hamlet.residents.map((row) => row.id);
  const ties = new Set(withNewcomer.relationships.filter((rel) => rel.from === newcomer || rel.to === newcomer)
    .map((rel) => (rel.from === newcomer ? rel.to : rel.from)));
  assert.deepEqual([...member(newcomer).knownActorIds].sort(), [...ties].map(id).sort(), "a newcomer knows only the people they are tied to");
  for (const local of locals) {
    const known = new Set(member(local).knownActorIds);
    assert.equal(known.has(id(newcomer)), ties.has(local), `${local} knows the newcomer only through a tie`);
    for (const other of locals) if (other !== local) assert.ok(known.has(id(other)), `${local} knows ${other}: they live in the same town`);
  }
  const { pack: plain } = compileBlueprint(hamlet);
  for (const row of plain.cast) {
    assert.deepEqual([...row.knownActorIds].sort(), plain.cast.filter((other) => other.id !== row.id).map((other) => other.id).sort(),
      "a town without newcomers is as before: everyone knows everyone");
  }
}

// 3. Everyone has a look, written or derived from age and visible styles.
assert.equal(publicLookOf({ look: "一身泥水的外乡汉子", age: 30, appearance: { styles: ["beard"], child: false } }), "一身泥水的外乡汉子");
assert.equal(publicLookOf({ age: 40, appearance: { styles: ["beard", "apron", "hat"], child: false } }), "一个中年人，留着胡子，系着围裙");
assert.equal(publicLookOf({ age: 9, appearance: { styles: ["short"], child: true } }), "一个孩子");
assert.equal(publicLookOf({ age: 24, appearance: { styles: ["bun", "clean_shaven"], child: false } }), "一个年轻人，挽着发髻");
assert.equal(publicLookOf({ age: 66, appearance: { styles: ["bald", "sword"], child: false } }), "一个上了年纪的人，剃着光头，佩着剑");
assert.equal(publicLookOf({ age: 12, appearance: { styles: ["braid"], child: false } }), "一个孩子，梳着辫子", "under 14 is a child");
{
  const { pack } = compileBlueprint(withNewcomer);
  for (const row of pack.cast) {
    const look = (row.publicSignalFeatures || []).find((feature) => feature.featureId === "look");
    assert.ok(look && look.modality === "visual" && look.physicalFeature, `${row.name} has a look`);
  }
  assert.equal(pack.cast.find((row) => row.id === charId(hamlet.meta.id, hamlet.residents[0].id))
    .publicSignalFeatures.find((feature) => feature.featureId === "look").physicalFeature, "一身泥水的外乡汉子");
}

// 4. 借星 · 雨夜入谷: the couple are newcomers; everyone has a written look.
const blueprint = JSON.parse(fs.readFileSync("src/worlds/cangxinggu/blueprint.json", "utf8"));
const looks = Object.fromEntries(blueprint.residents.map((row) => [row.id, row.look]));
assert.deepEqual(looks, {
  gu_huaishan: "浑身湿透的年轻男人，手上缠着烧焦的布条",
  lu_qinghe: "脸色苍白的年轻女人，怀里紧抱着襁褓",
  shi_shoutian: "拄着拐杖的白发老人",
  shi_xiaohu: "虎头虎脑的小男孩",
  bao_dachuan: "背着弓、一身泥水的壮汉",
  liu_chunniang: "圆脸的年轻妇人",
  he_sao: "瘦削的妇人，鬓边别着一根红头绳",
  lu_laoshi: "满手石粉的老石匠",
  du_popo: "佝偻着背的老婆婆，身上一股药味",
  wen_xiansheng: "穿着旧长衫的清瘦中年人",
});
assert.deepEqual(blueprint.residents.filter((row) => row.newcomer === true).map((row) => row.id).sort(), ["gu_huaishan", "lu_qinghe"]);
const valley = await loadWorldPack("cangxinggu");
const cid = (rid) => charId("cangxinggu", rid);
const castOf = (rid) => valley.cast.find((row) => row.id === cid(rid));
assert.deepEqual(castOf("gu_huaishan").knownActorIds, [cid("lu_qinghe")]);
assert.deepEqual(castOf("lu_qinghe").knownActorIds, [cid("gu_huaishan")]);
// A newcomer knows the house they are in and the way they came, not the valley's places.
assert.deepEqual([...castOf("gu_huaishan").knownSiteIds].sort(), ["feiwu", "gukou"]);
assert.deepEqual([...castOf("lu_qinghe").knownSiteIds].sort(), ["feiwu", "gukou"]);
assert.ok(castOf("shi_xiaohu").knownSiteIds.length > 5, "a villager knows the valley");
for (const row of blueprint.residents.filter((person) => !person.newcomer)) {
  const known = castOf(row.id).knownActorIds;
  assert.ok(!known.includes(cid("gu_huaishan")) && !known.includes(cid("lu_qinghe")), `${row.name} has never met the couple`);
  assert.equal(known.length, 7, `${row.name} knows the other seven villagers`);
}

// 5. Objects: shown in the open with their name; private ones are hidden.
const object = (label) => valley.objects.find((row) => row.label === label);
assert.equal(object("襁褓里的婴儿").presentation.exposure, "public");
assert.equal(object("襁褓里的婴儿").perception?.publicLabel, "襁褓里的婴儿", "others see the baby as a baby, not as 一件可见物件");
for (const label of ["生锈的短剑", "引路玉符", "阵石碎块", "阵纹拓样"]) {
  assert.equal(object(label).presentation.exposure, "hidden", `${label} is private`);
}
assert.equal(object("灶台").perception?.publicLabel, "灶台", "catalog furniture keeps its name too");

// 6. In play: a stranger is seen, not named; a neighbour is named.
const square = valley.stage.scenePositions[cid("shi_xiaohu")];
const moved = defineWorldPack({
  ...clone(valley),
  cast: clone(valley.cast).map((row) => (row.id === cid("gu_huaishan") ? { ...row, startZoneId: square } : row)),
  stage: { ...clone(valley.stage), scenePositions: { ...clone(valley.stage.scenePositions), [cid("gu_huaishan")]: square, [cid("bao_dachuan")]: square } },
});
const inputs = [];
const instance = createWorldRuntimeV27(buildPlayableWorldFromPack(moved), {
  worldPack: moved, pacingMode: "scene", characterIds: moved.stage.sceneCast, enableDayPlanning: false, characterAgentCallMode: "performance",
  async runStage(input) {
    inputs.push(input);
    return { performance: { thought: "", say: { to: "", text: "", loud: false }, do: { type: "wait", target: "", person: "", minutes: 30 }, gesture: "" } };
  },
});
const promptOf = (rid) => inputs.find((row) => row.characterId === cid(rid))?.prompt?.user || "";
// Standing about in silence wakes nobody; a gust that everyone outdoors notices does.
await instance.runtime.applyWorldEvent({ kind: "weather", weather: "wind" });
for (let i = 0; i < 40 && !(promptOf("shi_xiaohu") && promptOf("gu_huaishan")); i += 1) {
  if (!(await instance.runtime.runNext())) break;
}
for (const actor of instance.runtime.actors.values()) await actor.close?.();
const xiaohu = promptOf("shi_xiaohu");
const huaishan = promptOf("gu_huaishan");
assert.ok(xiaohu && huaishan, "both took a beat");
assert.ok(xiaohu.includes("浑身湿透的年轻男人，手上缠着烧焦的布条"), "石小虎 sees what the stranger looks like");
assert.ok(xiaohu.includes("你不认识这个人"), "and is told he does not know him");
assert.ok(!xiaohu.includes("顾怀山"), "but not his name");
assert.ok(xiaohu.includes("宝大川"), "石小虎 knows his neighbour by name");
assert.ok(huaishan.includes("虎头虎脑的小男孩") && huaishan.includes("背着弓、一身泥水的壮汉"), "顾怀山 sees two strangers");
assert.ok(!huaishan.includes("石小虎") && !huaishan.includes("宝大川"), "and knows neither name");

console.log("Town strangers passed: newcomers know only their own, strangers are seen by their look, open objects keep their names.");
