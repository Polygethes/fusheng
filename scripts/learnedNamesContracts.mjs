// In the one-call modes a person learns a stranger's name by hearing it: the
// stranger says it, or someone calls them by it, while the listener can see
// them. From then on the listener's prompt names them the way they heard it.
import assert from "node:assert/strict";
import { nameFormsByCharacter, learnNamesFromTurns } from "../src/server/pipeline/learnedNames.mjs";
import { loadWorldPack } from "../src/worlds/registry.mjs";
import { defineWorldPack } from "../src/worlds/worldPack.mjs";
import { buildPlayableWorldFromPack } from "../src/worlds/buildPlayableWorldFromPack.mjs";
import { createWorldRuntimeV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";

const clone = (value) => JSON.parse(JSON.stringify(value));
const pack = await loadWorldPack("cangxinggu");
const cid = (rid) => `char_cangxinggu_${rid}`;
const gu = cid("gu_huaishan"), lu = cid("lu_qinghe"), hu = cid("shi_xiaohu");

// 1. The ways a person is called: the full name first, then what others call them (longest first); kinship words are not names.
const forms = nameFormsByCharacter(pack);
assert.deepEqual(forms.get(gu), ["顾怀山", "怀山"]);
assert.deepEqual(forms.get(lu), ["陆青禾", "青禾"]);
assert.deepEqual(forms.get(cid("du_popo")), ["杜婆婆"]);
assert.equal(forms.get(hu)[0], "石小虎");
assert.ok(forms.get(hu).includes("小虎"));
for (const row of forms.values()) {
  for (const generic of ["爹", "娘", "爷爷", "奶奶", "先生", "婆婆", "大夫"]) assert.ok(!row.includes(generic), `${generic} is not a name`);
  for (let i = 2; i < row.length; i += 1) assert.ok(row[i - 1].length >= row[i].length, "longer forms are tried first");
}

// 2. Learning from what was heard.
const learn = (turns, { visible = [], known = [], learned = [] } = {}) => learnNamesFromTurns({ turns, visibleIds: visible, formsById: forms, knownIds: known, learned });
assert.deepEqual(learn([{ speakerId: gu, utterance: "小兄弟，在下顾怀山，借贵地避避雨。" }], { visible: [gu] }), [{ characterId: gu, name: "顾怀山" }], "he says his own name");
assert.deepEqual(learn([{ speakerId: lu, utterance: "怀山，你慢着些。" }], { visible: [gu, lu] }), [{ characterId: gu, name: "怀山" }], "someone calls him by name in front of you");
assert.deepEqual(learn([{ speakerId: lu, utterance: "顾怀山，你听我说。" }], { visible: [gu, lu] }), [{ characterId: gu, name: "顾怀山" }], "the longest form heard wins");
assert.deepEqual(learn([{ speakerId: lu, utterance: "怀山去打水了。" }], { visible: [lu] }), [], "a name for someone you cannot see teaches nothing");
assert.deepEqual(learn([{ speakerId: gu, utterance: "我叫顾怀山。" }], { visible: [] }), [], "a voice you cannot put a face to teaches nothing");
assert.deepEqual(learn([{ speakerId: gu, utterance: "我叫顾怀山。" }], { visible: [gu], known: [gu] }), [], "already known");
assert.deepEqual(learn([{ speakerId: gu, utterance: "我叫顾怀山。" }], { visible: [gu], learned: [{ characterId: gu, name: "怀山" }] }), [], "already learned");
assert.deepEqual(learn([{ speakerId: lu, utterance: "娘在这儿，不怕。" }], { visible: [lu] }), [], "kinship words teach nothing");
assert.deepEqual(learn([{ speakerId: gu, utterance: "青禾，这位小兄弟说村里有井。我是顾怀山。" }], { visible: [gu, lu] }),
  [{ characterId: gu, name: "顾怀山" }, { characterId: lu, name: "青禾" }], "one line can teach two names, in the order of visibleIds");
assert.deepEqual(learn([
  { speakerId: lu, utterance: "怀山，水烧上了吗？" },
  { speakerId: gu, utterance: "我是顾怀山。" },
], { visible: [gu, lu] }), [{ characterId: gu, name: "怀山" }], "the first name you hear for someone is the one you keep");

// 3. In play: 石小虎 hears the stranger say his name, and from then on knows it.
const square = pack.stage.scenePositions[hu];
const moved = defineWorldPack({
  ...clone(pack),
  cast: clone(pack.cast).map((row) => (row.id === gu ? { ...row, startZoneId: square } : row)),
  stage: { ...clone(pack.stage), scenePositions: { ...clone(pack.stage.scenePositions), [gu]: square } },
});
const wait = { performance: { thought: "", say: { to: "", text: "", loud: false }, do: { type: "wait", target: "", person: "", minutes: 5 }, gesture: "" } };
const inputs = [];
let introduced = -1;
const instance = createWorldRuntimeV27(buildPlayableWorldFromPack(moved), {
  worldPack: moved, pacingMode: "scene", characterIds: moved.stage.sceneCast, enableDayPlanning: false, characterAgentCallMode: "performance",
  async runStage(input) {
    inputs.push(input);
    if (input.characterId === gu && introduced < 0) {
      introduced = inputs.length - 1;
      return { performance: { thought: "", say: { to: "", text: "小兄弟，在下顾怀山，借贵地避避雨。", loud: false }, do: { type: "wait", target: "", person: "", minutes: 5 }, gesture: "" } };
    }
    return clone(wait);
  },
});
// Standing about in silence wakes nobody; a gust that everyone outdoors notices does.
await instance.runtime.applyWorldEvent({ kind: "weather", weather: "wind" });
const after = () => inputs.findIndex((row, index) => index > introduced && introduced >= 0 && row.characterId === hu);
for (let i = 0; i < 60 && after() < 0; i += 1) {
  if (!(await instance.runtime.runNext())) break;
}
const later = inputs[after()]?.prompt?.user || "";
const xiaohu = [...instance.runtime.actors.values()].find((actor) => actor.characterId === hu);
const learned = clone(xiaohu?.privateState?.learnedNames || []);
for (const actor of instance.runtime.actors.values()) await actor.close?.();
assert.ok(later, "石小虎 took a beat after the stranger spoke");
assert.ok(later.includes("顾怀山"), "now he knows the name");
assert.ok(!later.includes("浑身湿透的年轻男人，手上缠着烧焦的布条（你不认识这个人）"), "and no longer sees only a stranger");
assert.deepEqual(learned.map((row) => [row.characterId, row.name]), [[gu, "顾怀山"]], "the name is kept in his private state");
assert.ok(Number.isFinite(learned[0].learnedAtSeconds));

console.log("Learned names passed: names are heard, not given; the first form heard is kept; the prompt uses it from then on.");
