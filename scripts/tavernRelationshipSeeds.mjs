import assert from "node:assert/strict";
import {
  LEGACY_TAVERN_RELATIONSHIP_EDGE_ORDER,
  LEGACY_TAVERN_RELATIONSHIP_VECTORS,
  TAVERN_CALIBRATED_RELATIONSHIP_SEEDS,
  TAVERN_RELATIONSHIP_VECTOR_FIELDS,
  buildCalibratedTavernRelationships,
  getTavernAddressingRule,
  matchesLegacyTavernRelationshipSeed,
} from "../src/server/ecology/tavernRelationshipSeeds.mjs";

const IDS = {
  xiezenshi: "char_xyy_xiezenshi",
  xieheng: "char_xyy_xieheng",
  xiemu: "char_xyy_xiemu",
  zhoumin: "char_xyy_zhoumin",
  luozhao: "char_xyy_luozhao",
  yanzhizhong: "char_xyy_yanzhizhong",
  chenyan: "char_xyy_chenyan",
};

const characters = [
  { id: IDS.xiezenshi, name: "谢真石" },
  { id: IDS.xieheng, name: "谢恒" },
  { id: IDS.xiemu, name: "谢母" },
  { id: IDS.zhoumin, name: "周珉" },
  { id: IDS.luozhao, name: "洛照" },
  { id: IDS.yanzhizhong, name: "严执中" },
  { id: IDS.chenyan, name: "陈砚" },
];

const seedRelationships = [
  { from: IDS.xiezenshi, to: IDS.zhoumin, label: "同门 / 不对等的友情", pressure: "周珉长期照料，举荐请求尚未回应。" },
  { from: IDS.xiezenshi, to: IDS.xieheng, label: "父子 / 期待与沉默", pressure: "父亲用资源表达爱，儿子把它听成要求。" },
  { from: IDS.xiemu, to: IDS.xieheng, label: "夫妻 / 家计秘而不宣", pressure: "药钱和当票的来路仍未说清。" },
  { from: IDS.xiemu, to: IDS.xiezenshi, label: "母子 / 日常维系", pressure: "母亲想让儿子在饭桌前停一刻。" },
  { from: IDS.yanzhizhong, to: IDS.xiezenshi, label: "掌籍长老 / 候选弟子", pressure: "候选实绩与道路疑问尚待核验。" },
  { from: IDS.zhoumin, to: IDS.yanzhizhong, label: "外门弟子 / 举荐权", pressure: "周珉需要内门机会又不愿显得攀附。" },
  { from: IDS.luozhao, to: IDS.yanzhizhong, label: "来访弟子 / 接待长老", pressure: "这只是正式拜访，不是旧交。" },
  { from: IDS.chenyan, to: IDS.xiezenshi, label: "榜末 / 被称作璞玉的人", pressure: "陈砚知道名声，但两人尚无私人旧怨。" },
  { from: IDS.chenyan, to: IDS.yanzhizhong, label: "榜上弟子 / 记录者", pressure: "真实步数与稀缺名额之间存在压力。" },
];

function edgeKey(relationship) {
  return `${relationship.fromCharacterId}->${relationship.toCharacterId}`;
}

function pairKey(relationship) {
  return [relationship.fromCharacterId, relationship.toCharacterId].sort().join("<->");
}

function vectorOf(relationship) {
  return Object.fromEntries(TAVERN_RELATIONSHIP_VECTOR_FIELDS.map((field) => [field, relationship[field]]));
}

const relationships = buildCalibratedTavernRelationships(seedRelationships, characters, "xiaoyaoyou");
const byEdge = new Map(relationships.map((relationship) => [edgeKey(relationship), relationship]));
const get = (fromCharacterId, toCharacterId) => byEdge.get(`${fromCharacterId}->${toCharacterId}`);

assert.equal(TAVERN_CALIBRATED_RELATIONSHIP_SEEDS.length, 18);
assert.equal(relationships.length, 18, "nine unordered pairs need eighteen directed states");
assert.equal(new Set(relationships.map(edgeKey)).size, 18, "every directed edge must be unique");
assert.equal(new Set(relationships.map((relationship) => relationship.id)).size, 18, "every directed edge needs a stable unique id");
assert.equal(new Set(relationships.map(pairKey)).size, 9, "the calibrated graph must contain exactly nine unordered pairs");
for (const pair of new Set(relationships.map(pairKey))) {
  assert.equal(relationships.filter((relationship) => pairKey(relationship) === pair).length, 2, `${pair} must contain both directions exactly once`);
}

for (const relationship of relationships) {
  assert.equal(relationship.generatedFrom, "tavern-calibrated-directional-seed");
  assert.ok(relationship.misreading && relationship.unspoken, `${edgeKey(relationship)} needs direction-specific psychology`);
  assert.ok(relationship.addressingRule && relationship.allowedAddresses.length, `${edgeKey(relationship)} needs a directed address rule`);
  for (const field of TAVERN_RELATIONSHIP_VECTOR_FIELDS) {
    assert.ok(Number.isInteger(relationship[field]), `${edgeKey(relationship)}.${field} must be an integer`);
    assert.ok(relationship[field] >= 0 && relationship[field] <= 100, `${edgeKey(relationship)}.${field} must stay within 0..100`);
  }
}

assert.deepEqual(getTavernAddressingRule(IDS.xiezenshi, IDS.xieheng).allowedAddresses, ["爹"]);
assert.deepEqual(getTavernAddressingRule(IDS.xieheng, IDS.xiezenshi).allowedAddresses, ["真石", "儿子"]);
assert.match(getTavernAddressingRule(IDS.xieheng, IDS.xiemu).addressingRule, /夫妻|家人/);
assert.deepEqual(getTavernAddressingRule("unknown", IDS.xiemu), { addressingRule: "", allowedAddresses: [] });

const reordered = buildCalibratedTavernRelationships(
  [...seedRelationships].reverse(),
  [characters[4], characters[1], characters[6], characters[0], characters[5], characters[2], characters[3]],
  "xiaoyaoyou",
);
assert.deepEqual(reordered, relationships, "calibration must use semantic pair ids, never input array positions");
assert.notEqual(reordered[0], relationships[0], "each build must return independent relationship objects");
assert.notEqual(reordered[0].evidenceIds, relationships[0].evidenceIds);

for (const relationship of relationships) {
  const reverse = get(relationship.toCharacterId, relationship.fromCharacterId);
  assert.ok(reverse, `${edgeKey(relationship)} needs its reverse direction`);
  assert.notDeepEqual(vectorOf(relationship), vectorOf(reverse), `${pairKey(relationship)} must not use mirrored vectors`);
}

const sonToFather = get(IDS.xiezenshi, IDS.xieheng);
const fatherToSon = get(IDS.xieheng, IDS.xiezenshi);
assert.ok(fatherToSon.protection > sonToFather.protection + 40, "father's protective investment should be much stronger");
assert.ok(fatherToSon.power > sonToFather.power + 35, "father holds more practical authority over the son");
assert.ok(sonToFather.wantsToEscape > fatherToSon.wantsToEscape, "the son is more likely to escape the expectation conversation");
assert.ok(sonToFather.resentment > fatherToSon.resentment + 20, "the son's accumulated resistance must not be mirrored onto the father");

const motherToSon = get(IDS.xiemu, IDS.xiezenshi);
const sonToMother = get(IDS.xiezenshi, IDS.xiemu);
assert.ok(motherToSon.protection > sonToMother.protection + 30, "maternal protection must be direction-specific");
assert.ok(sonToMother.dependence > motherToSon.dependence, "the son materially depends more on his mother's daily care");
assert.ok(sonToMother.shame > motherToSon.shame + 20, "the son hides fatigue from his mother more than she hides care from him");

const zhouToXie = get(IDS.zhoumin, IDS.xiezenshi);
const xieToZhou = get(IDS.xiezenshi, IDS.zhoumin);
assert.ok(zhouToXie.protection > xieToZhou.protection + 30, "Zhou Min is the stronger active protector");
assert.ok(zhouToXie.wantsToBeSeen > xieToZhou.wantsToBeSeen + 40, "Zhou Min needs his request and care to be recognized");
assert.ok(xieToZhou.dependence > zhouToXie.dependence, "Xie Zhenshi relies more on the care he receives");
assert.ok(zhouToXie.resentment > xieToZhou.resentment, "unanswered requests create asymmetric frustration");

const chenToYan = get(IDS.chenyan, IDS.yanzhizhong);
const yanToChen = get(IDS.yanzhizhong, IDS.chenyan);
assert.ok(chenToYan.dependence > yanToChen.dependence + 45, "Chen Yan depends on the registrar's decision, not the reverse");
assert.ok(chenToYan.fear > yanToChen.fear + 30);
assert.ok(chenToYan.shame > yanToChen.shame + 40);
assert.ok(chenToYan.wantsToBeSeen > yanToChen.wantsToBeSeen + 40);
assert.ok(yanToChen.power > chenToYan.power + 65, "the registrar controls the scarce assessment opportunity");

const spousePair = new Set([
  `${IDS.xiemu}->${IDS.xieheng}`,
  `${IDS.xieheng}->${IDS.xiemu}`,
]);
for (const relationship of relationships) {
  if (!spousePair.has(edgeKey(relationship))) {
    assert.ok(relationship.attraction <= 3, `${edgeKey(relationship)} must not receive formula-generated romantic attraction`);
  }
  assert.ok(relationship.resentment <= 34, `${edgeKey(relationship)} must not start with implausibly high resentment`);
  assert.ok(relationship.revenge <= 3, `${edgeKey(relationship)} must not start with an invented revenge history`);
  assert.equal(relationship.wantsToDestroy, 0, `${edgeKey(relationship)} must not begin with an invented destruction impulse`);
}
const luoToYan = get(IDS.luozhao, IDS.yanzhizhong);
const yanToLuo = get(IDS.yanzhizhong, IDS.luozhao);
assert.ok(luoToYan.love <= 10 && yanToLuo.love <= 12, "new formal acquaintances must not begin as intimate");
assert.ok(luoToYan.resentment <= 5 && yanToLuo.resentment <= 5, "new formal acquaintances must not inherit invented grudges");

assert.equal(xieToZhou.sourceSeedLabel, "同门 / 不对等的友情");
assert.equal(zhouToXie.sourceSeedPressure, "周珉长期照料，举荐请求尚未回应。", "both directions should retain provenance from the unordered source seed");

for (let index = 0; index < LEGACY_TAVERN_RELATIONSHIP_VECTORS.length; index += 1) {
  const [fromCharacterId, toCharacterId] = LEGACY_TAVERN_RELATIONSHIP_EDGE_ORDER[index];
  const legacy = {
    fromCharacterId,
    toCharacterId,
    ...LEGACY_TAVERN_RELATIONSHIP_VECTORS[index],
  };
  assert.equal(matchesLegacyTavernRelationshipSeed(legacy, index), true, `legacy edge ${index} should be recognized for safe migration`);
  assert.equal(matchesLegacyTavernRelationshipSeed({ ...legacy, resentment: legacy.resentment + 1 }, index), false, "a user-modified vector must not be mistaken for untouched legacy data");
  assert.equal(matchesLegacyTavernRelationshipSeed({ ...legacy, fromCharacterId: toCharacterId, toCharacterId: fromCharacterId }, index), false, "legacy detection must also be directional");
}

assert.equal(buildCalibratedTavernRelationships(seedRelationships, characters, "another_world"), null, "other worlds must keep their own relationship builder");
assert.throws(
  () => buildCalibratedTavernRelationships(seedRelationships, characters.slice(1), "xiaoyaoyou"),
  (error) => error?.code === "TAVERN_RELATIONSHIP_CHARACTER_MISSING" && error.characterIds.includes(IDS.xiezenshi),
  "a partial seven-person cast must fail explicitly instead of creating misaddressed edges",
);

console.log("tavernRelationshipSeeds:test passed", {
  unorderedPairs: 9,
  directedEdges: relationships.length,
  legacyMigrationFixtures: LEGACY_TAVERN_RELATIONSHIP_VECTORS.length,
});
