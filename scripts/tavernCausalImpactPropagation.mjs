import assert from "node:assert/strict";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import {
  TAVERN_SCENE_TOPOLOGY,
  buildTavernSceneRuntime,
  createImpactFactor,
  deliverImpactFactor,
  deriveImpactFactorsFromAction,
  selectNextCausalAgent,
} from "../src/server/pipeline/tavernCausalScene.mjs";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
const ids = {
  mother: "char_xyy_xiemu",
  father: "char_xyy_xieheng",
  son: "char_xyy_xiezenshi",
  guest: "char_xyy_luozhao",
};
const runtime = buildTavernSceneRuntime(state, {
  characterIds: Object.values(ids),
  positions: {
    [ids.mother]: "counter",
    [ids.father]: "hall",
    [ids.son]: "courtyard",
    [ids.guest]: "guest_room",
  },
});

assert.equal(TAVERN_SCENE_TOPOLOGY.locationId, "loc_xyy_tavern");
assert.ok(TAVERN_SCENE_TOPOLOGY.zones.guest_room.closed, "the upstairs room must be an occluded space");

const spoken = createImpactFactor({
  sourceCharacterId: ids.mother,
  sourceZoneId: "counter",
  type: "speech",
  modality: "sound",
  intensity: 90,
  radius: 3,
  directedTargetId: ids.father,
  content: "恒哥，门口像是有人敲门。",
});
const heard = deliverImpactFactor(state, runtime, spoken);
const heardBy = new Map(heard.map((delivery) => [delivery.recipientId, delivery]));
assert.ok(heardBy.has(ids.father), "a directed listener in the hall must hear the counter");
assert.ok(heardBy.has(ids.son), "a strong voice can reach the open courtyard through the hall");
assert.ok(!heardBy.has(ids.guest), "a normal voice must not pass through the closed guest-room door");
assert.ok(!heardBy.has(ids.mother), "the source does not receive its own public impact as new information");
assert.ok(heardBy.get(ids.father).impactScore > heardBy.get(ids.son).impactScore, "directed relevance must outrank distant overhearing");

for (const delivery of heard) runtime.agents[delivery.recipientId].inbox.push(delivery);
const selected = selectNextCausalAgent(runtime);
assert.equal(selected.characterId, ids.father, "the most personally affected character must act next");
assert.equal(selected.sourceImpactId, spoken.id);

const touchAcrossZones = createImpactFactor({
  sourceCharacterId: ids.mother,
  sourceZoneId: "counter",
  type: "physical",
  modality: "touch",
  intensity: 100,
  radius: 0,
  directedTargetId: ids.father,
  content: "把钥匙递给谢恒",
});
assert.equal(deliverImpactFactor(state, runtime, touchAcrossZones).length, 0, "touch and object transfer cannot cross zones");
runtime.agents[ids.father].zoneId = "counter";
const touchSameZone = deliverImpactFactor(state, runtime, touchAcrossZones);
assert.deepEqual(touchSameZone.map((item) => item.recipientId), [ids.father], "touch reaches only its physical target in the same zone");

const originalInfo = createImpactFactor({
  sourceCharacterId: ids.mother,
  sourceZoneId: "counter",
  type: "information",
  modality: "sound",
  intensity: 72,
  radius: 2,
  directedTargetId: ids.father,
  content: "王记酒坊只付了三文工钱。",
  provenance: { kind: "firsthand", sourceImpactIds: [] },
});
runtime.agents[ids.son].perceptionMemory.push({
  ...deliverImpactFactor(state, runtime, originalInfo).find((item) => item.recipientId === ids.son),
  impactId: originalInfo.id,
});
const gossipAction = {
  id: "action_gossip",
  actorId: ids.son,
  actorZoneId: "courtyard",
  actionType: "speak",
  speechAct: "gossip",
  targetCharacterId: ids.father,
  speech: "爹，我听娘说王记酒坊只给了三文。",
  visibleAction: "谢真石压低声音转述刚听到的话。",
  informationSourceImpactId: originalInfo.id,
};
const gossipImpacts = deriveImpactFactorsFromAction(state, runtime, gossipAction);
const gossip = gossipImpacts.find((impact) => impact.type === "information");
assert.ok(gossip, "gossip must create a new information impact rather than teleport the original event");
assert.equal(gossip.provenance.kind, "gossip");
assert.ok(gossip.provenance.sourceImpactIds.includes(originalInfo.id), "gossip must preserve the original information provenance");
assert.notEqual(gossip.id, originalInfo.id);

console.log("tavernCausalImpactPropagation:test passed", {
  heardBy: [...heardBy.keys()],
  nextActor: selected.characterId,
  gossipSource: gossip.provenance.sourceImpactIds,
});
