import assert from "node:assert/strict";
import xiaoyaoyou from "../src/worlds/xiaoyaoyou/pack.mjs";
import { listWorldPackIds, loadWorldPack } from "../src/worlds/registry.mjs";
import { validateWorldPack } from "../src/worlds/validateWorldPack.mjs";

for (const id of listWorldPackIds()) {
  const result = validateWorldPack(await loadWorldPack(id));
  assert.deepEqual(result.issues, [], `world pack ${id} passes every check`);
}

const broken = (mutate) => { const pack = structuredClone(xiaoyaoyou); mutate(pack); return pack; };
const checksOf = (pack) => new Set(validateWorldPack(pack).issues.map((row) => row.check));
const expectCheck = (check, mutate, message) => assert.ok(checksOf(broken(mutate)).has(check), message);

expectCheck("V1", (p) => { p.stage.topology.edges = p.stage.topology.edges.filter((e) => e.to !== "courtyard"); }, "an unreachable zone is reported");
expectCheck("V1", (p) => { p.stage.topology.edges = p.stage.topology.edges.map((e) => ({ ...e, barrier: undefined })); }, "a closed zone without a barrier is reported");
expectCheck("V2", (p) => { p.work = p.work.filter((t) => t.templateId !== "split_firewood_bundles"); }, "a deadline nobody can complete is reported");
expectCheck("V2", (p) => { p.work = p.work.map((t) => (t.templateId === "split_firewood_bundles" ? { ...t, requiredSkillIds: ["woodcraft"] } : t)); },
  "work that needs a skill nobody responsible has cannot satisfy a deadline");
expectCheck("V2", (p) => { p.agenda.items = p.agenda.items.map((i) => ({ ...i, conditions: [] })); }, "a deadline without objective conditions is reported");
expectCheck("V3", (p) => { p.work = p.work.map((t) => (t.templateId === "fill_water_bucket" ? { ...t, toolIds: ["no_such_bucket"] } : t)); }, "work referring to missing objects is reported");
expectCheck("V3", (p) => { p.objects = p.objects.map((o) => (o.id === "xiezenshi_short_sword" ? { ...o, operations: ["draw", "sheathe"], state: {} } : o)); },
  "a drawable object without a sheathed state is reported");
expectCheck("V4", (p) => {
  p.stage.sceneCast = ["char_xyy_zhoumin"];
  p.objects = p.objects.map((o) => (o.initialHolderActorId === "char_xyy_zhoumin" ? { ...o, initialHolderActorId: "" } : o));
}, "a character whose wants are all off stage is reported");
expectCheck("V5", (p) => {
  p.stage.sceneCast = ["char_xyy_luozhao"];
  p.agenda.items = [];
}, "a scene with no matter between two people is reported");
expectCheck("V6", (p) => { p.stage.sceneCast = p.cast.map((c) => c.id); }, "more than five active characters is reported");
expectCheck("V6", (p) => { p.relationships = [{ fromCharacterId: "char_xyy_xiemu", toCharacterId: "char_nobody" }]; }, "a relationship to nobody is reported");
expectCheck("V7", (p) => {
  p.mysteries = [{ id: "mystery:probe", label: "失星真相" }];
  p.cast[0].agentMemory = { beliefs: [{ mysteryId: "mystery:probe", status: "settled", proposition: "星星是被借走的" }] };
}, "a mystery settled in a character's belief is reported");
expectCheck("V8", (p) => { p.report.metrics = [{ label: "不存在", objectId: "nothing", stateKey: "x" }]; }, "a report metric without state is reported");
expectCheck("V9", (p) => { delete p.layout.zones.courtyard; }, "a zone missing from the layout is reported");
expectCheck("V9", (p) => { p.layout.doors = p.layout.doors.filter((d) => !d.between.includes("courtyard")); }, "a missing door is reported");
expectCheck("V9", (p) => { p.layout.objects.tavern_resource_water_vat.at = [20, 8]; }, "an object drawn outside its zone is reported");

console.log("World pack validator passed: every registered pack is clean and each check catches its failure.");
