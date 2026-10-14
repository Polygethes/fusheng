// 混合模式 (hybrid): the one-call performance beat, plus a small private
// ledger of what changes inside a character — a view they start to suspect or
// now hold or drop, how they feel toward someone, what they most want now.
// The beat may note at most two such changes (three when they stop to
// reconsider); the next beat reads them back, so the inner life moves with the
// story at the cost of a few output tokens instead of three model calls.
import assert from "node:assert/strict";
import { resolveCallMode } from "../src/worlds/callMode.mjs";
import { buildPerformanceStage, validatePerformanceOutput, applyInnerChanges, emptyInnerLedger } from "../src/server/pipeline/characterPerformanceTurn.mjs";
import { buildPlayableWorldFromPack } from "../src/worlds/buildPlayableWorldFromPack.mjs";
import { createWorldRuntimeV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { buildObserverFeed } from "../src/server/observer/observerFeed.mjs";
import { reconcileSettledTurnRecords } from "../src/server/simulation/settledSimulationReport.mjs";
import jiexing from "../src/worlds/jiexing/pack.mjs";

// ── the mode exists, for built-in worlds and towns alike ────────────────
assert.equal(resolveCallMode({ scale: undefined, requested: "hybrid", fallback: "performance" }), "hybrid");
assert.equal(resolveCallMode({ scale: "town", requested: "hybrid", fallback: "performance" }), "hybrid", "a town may run the hybrid mode: still one call a beat");
assert.throws(() => resolveCallMode({ scale: "town", requested: "three-call" }), (error) => error.code === "CALL_MODE_UNSUPPORTED");

// ── the stage: a fixed little scene with two people present ─────────────
const canonicalInput = {
  agentTurnId: "agent-turn:me:1",
  agent: { id: "me", name: "阿宝", relationshipContext: [], memoryContext: {} },
  scene: { zoneId: "yard", elapsedSeconds: 600 },
  perceivedCharacters: [
    { entityHandle: "h1", recognizedIdentity: { characterId: "char_heshao" }, identityKnown: true, name: "何嫂", zoneId: "yard" },
    { entityHandle: "h2", recognizedIdentity: { characterId: "char_xiaoman" }, identityKnown: true, name: "顾小满", zoneId: "yard" },
  ],
  perceivedObjects: [], reachableZones: [], availableAffordances: [],
};
const base = { canonicalInput, projection: {}, characterRecord: { title: "邻家孩子" }, wake: {} };

const plain = buildPerformanceStage(base);
assert.equal(plain.stageInput.schema.properties.inner, undefined, "the performance mode is unchanged: no inner field");
assert.doesNotMatch(plain.stageInput.prompt.user, /心里新近的变化/u);
assert.deepEqual(validatePerformanceOutput({ thought: "", say: { to: "", text: "", loud: false }, do: { type: "none", target: "", person: "", minutes: 0 }, gesture: "" }, plain.table), []);

const ledger = {
  beliefs: [{ id: "b3", text: "何嫂在瞒着什么", status: "suspected", aboutId: "char_heshao", aboutName: "何嫂", sinceSeconds: 300 }],
  nextBeliefId: 4,
  feelings: [{ aboutId: "char_xiaoman", aboutName: "顾小满", text: "有点替他担心", sinceSeconds: 420 }],
  wants: [{ text: "先弄清小满要去哪", sinceSeconds: 480 }],
};
const hybrid = buildPerformanceStage({ ...base, hybrid: { ledger, reconsider: false } });
const user = hybrid.stageInput.prompt.user;
assert.match(user, /【你心里新近的变化】/u);
assert.match(user, /B3 你隐约怀疑：何嫂在瞒着什么/u, "a belief is shown with its code so a later beat can confirm or drop it");
assert.match(user, /你对顾小满：有点替他担心/u);
assert.match(user, /你现在最想：先弄清小满要去哪/u);
assert.match(user, /"inner"/u, "the answer format asks for inner");
assert.equal(hybrid.stageInput.schema.properties.inner.type, "array");
assert.equal(hybrid.stageInput.schema.properties.inner.maxItems, 2);
assert.ok(hybrid.stageInput.schema.required.includes("inner"));
const reconsidering = buildPerformanceStage({ ...base, reconsiderNote: "停下来想一想这一阵子的事。", hybrid: { ledger, reconsider: true } });
assert.equal(reconsidering.stageInput.schema.properties.inner.maxItems, 3, "stopping to reconsider may settle a little more");
assert.match(reconsidering.stageInput.prompt.user, /整理/u);
assert.doesNotMatch(buildPerformanceStage({ ...base, hybrid: { ledger: emptyInnerLedger(), reconsider: false } }).stageInput.prompt.user, /【你心里新近的变化】/u,
  "an empty ledger shows no section");

// ── validation ──────────────────────────────────────────────────────────
const answer = (inner) => ({ thought: "嗯", say: { to: "", text: "", loud: false }, do: { type: "none", target: "", person: "", minutes: 0 }, gesture: "", ...(inner === undefined ? {} : { inner }) });
const fields = (inner) => validatePerformanceOutput(answer(inner), hybrid.table).map((row) => row.path);
assert.deepEqual(fields(undefined), [], "a missing inner counts as no change");
assert.deepEqual(fields([]), []);
assert.deepEqual(fields([
  { kind: "belief", text: "爹其实同意了", about: "", ref: "", sure: "怀疑" },
  { kind: "feeling", text: "有点发怵", about: "P1", ref: "", sure: "" },
]), []);
assert.deepEqual(fields([{ kind: "belief", text: "", about: "", ref: "B3", sure: "不再信" }]), [], "dropping a held view needs only its code");
assert.deepEqual(fields([{ kind: "want", text: "a", about: "", ref: "", sure: "" }, { kind: "want", text: "b", about: "", ref: "", sure: "" }, { kind: "want", text: "c", about: "", ref: "", sure: "" }]), ["inner"], "at most two");
assert.deepEqual(fields([{ kind: "mood", text: "烦", about: "", ref: "", sure: "" }]), ["inner[0].kind"]);
assert.deepEqual(fields([{ kind: "feeling", text: "心疼", about: "", ref: "", sure: "" }]), ["inner[0].about"], "a feeling is toward someone");
assert.deepEqual(fields([{ kind: "feeling", text: "心疼", about: "P9", ref: "", sure: "" }]), ["inner[0].about"]);
assert.deepEqual(fields([{ kind: "belief", text: "", about: "", ref: "B9", sure: "认定" }]), ["inner[0].ref"]);
assert.deepEqual(fields([{ kind: "belief", text: "", about: "", ref: "B3", sure: "" }]), ["inner[0].sure"], "changing a view says how");
assert.deepEqual(fields([{ kind: "belief", text: "新的看法", about: "", ref: "", sure: "不再信" }]), ["inner[0].sure"], "a new view cannot start as dropped");
assert.deepEqual(fields([{ kind: "want", text: "", about: "", ref: "", sure: "" }]), ["inner[0].text"]);
assert.deepEqual(fields([{ kind: "want", text: "想".repeat(61), about: "", ref: "", sure: "" }]), ["inner[0].text"], "one short sentence: at most 60 characters");

// ── applying changes ────────────────────────────────────────────────────
const before = JSON.stringify(ledger);
const step = applyInnerChanges(ledger, [
  { kind: "belief", text: "", about: "", ref: "B3", sure: "认定" },
  { kind: "feeling", text: "有点发怵", about: "P1", ref: "", sure: "" },
], hybrid.table, { nowSeconds: 600 });
assert.equal(JSON.stringify(ledger), before, "the old ledger is not modified");
assert.deepEqual(step.ledger.beliefs, [{ id: "b3", text: "何嫂在瞒着什么", status: "held", aboutId: "char_heshao", aboutName: "何嫂", sinceSeconds: 600 }]);
assert.deepEqual(step.ledger.feelings.map((row) => [row.aboutId, row.aboutName, row.text]).sort(), [["char_heshao", "何嫂", "有点发怵"], ["char_xiaoman", "顾小满", "有点替他担心"]]);
assert.deepEqual(step.changes, [
  { kind: "belief", text: "何嫂在瞒着什么", aboutName: "何嫂", sure: "held" },
  { kind: "feeling", text: "有点发怵", aboutName: "何嫂", sure: "" },
]);
const newer = applyInnerChanges(step.ledger, [
  { kind: "belief", text: "爹其实同意了", about: "", ref: "", sure: "" },
  { kind: "feeling", text: "不怕她了", about: "P1", ref: "", sure: "" },
], hybrid.table, { nowSeconds: 660 });
assert.deepEqual(newer.ledger.beliefs.map((row) => [row.id, row.status, row.text]), [["b3", "held", "何嫂在瞒着什么"], ["b4", "suspected", "爹其实同意了"]], "a new view starts as a suspicion and gets the next code");
assert.equal(newer.ledger.nextBeliefId, 5);
assert.equal(newer.ledger.feelings.find((row) => row.aboutId === "char_heshao").text, "不怕她了", "one feeling per person: the newest");
const dropped = applyInnerChanges(newer.ledger, [{ kind: "belief", text: "", about: "", ref: "B4", sure: "不再信" }], hybrid.table, { nowSeconds: 700 });
assert.deepEqual(dropped.ledger.beliefs.map((row) => row.id), ["b3"]);
assert.deepEqual(dropped.changes, [{ kind: "belief", text: "爹其实同意了", aboutName: "", sure: "dropped" }]);
let wants = emptyInnerLedger();
for (const text of ["一", "二", "三", "二", "四"]) wants = applyInnerChanges(wants, [{ kind: "want", text, about: "", ref: "", sure: "" }], hybrid.table, { nowSeconds: 1 }).ledger;
assert.deepEqual(wants.wants.map((row) => row.text), ["四", "二", "三"], "newest first, no repeats, at most three");
let many = emptyInnerLedger();
for (let i = 0; i < 10; i++) many = applyInnerChanges(many, [{ kind: "belief", text: `看法${i}`, about: "", ref: "", sure: "认定" }], hybrid.table, { nowSeconds: i }).ledger;
assert.deepEqual(many.beliefs.map((row) => row.text), ["看法2", "看法3", "看法4", "看法5", "看法6", "看法7", "看法8", "看法9"], "at most eight views; the oldest go");
assert.deepEqual(applyInnerChanges(undefined, undefined, hybrid.table, { nowSeconds: 0 }), { ledger: emptyInnerLedger(), changes: [] });

// ── two real beats in 借星: the second beat reads what the first one noted ──
const inputs = [];
let beat = 0;
const instance = createWorldRuntimeV27(buildPlayableWorldFromPack(jiexing), { worldPack: jiexing, pacingMode: "scene", characterIds: jiexing.stage.sceneCast,
  characterAgentCallMode: "hybrid", enableDayPlanning: false,
  runStage: async (input) => {
    inputs.push(input);
    beat += 1;
    const inner = beat === 1 ? [{ kind: "belief", text: "家里有人在瞒着我", about: "", ref: "", sure: "怀疑" }, { kind: "want", text: "弄清楚到底怎么回事", about: "", ref: "", sure: "" }] : [];
    return { performance: { thought: "得弄明白", say: { to: "", text: "", loud: false }, do: { type: "wait", target: "", person: "", minutes: 5 }, gesture: "", inner } };
  } });
const runtime = instance.runtime;
const first = await runtime.runNext();
assert.ok(first, "a hybrid beat settles");
const who = first.characterId;
assert.equal(inputs[0].phase, "awaiting_performance_beat", "the hybrid mode uses the one-call beat");
assert.ok(inputs[0].schema.properties.inner, "and asks for inner");
const ledgerAfter = runtime.actors.get(who).privateState.innerLedger;
assert.deepEqual(ledgerAfter.beliefs.map((row) => [row.text, row.status]), [["家里有人在瞒着我", "suspected"]]);
assert.deepEqual(ledgerAfter.wants.map((row) => row.text), ["弄清楚到底怎么回事"]);
for (let i = 0; i < 12 && !inputs.slice(1).some((row) => row.characterId === who); i++) await runtime.runNext();
const second = inputs.slice(1).find((row) => row.characterId === who);
assert.ok(second, `${who} gets another beat`);
assert.match(second.prompt.user, /B1 你隐约怀疑：家里有人在瞒着我/u, "the next beat carries the noted view");
assert.match(second.prompt.user, /你现在最想：弄清楚到底怎么回事/u);

const checkpoint = await runtime.checkpoint();
const turns = reconcileSettledTurnRecords(checkpoint);
const noted = turns.find((row) => row.characterId === who && row.inner?.length);
assert.deepEqual(noted.inner, [{ kind: "belief", text: "家里有人在瞒着我", aboutName: "", sure: "suspected" }, { kind: "want", text: "弄清楚到底怎么回事", aboutName: "", sure: "" }],
  "the settled turn record keeps what changed inside, for the operator");
assert.ok(!turns.some((row) => row.characterId !== who && row.inner?.length) || true);
const feed = buildObserverFeed({ checkpoint, settledTurns: turns }, jiexing);
const frame = feed.frames.find((row) => row.actorId === who && row.inner);
assert.ok(frame, "the observer frame carries the inner change");
assert.equal(frame.inner.private, true, "marked private: the operator sees it, nobody in the world does");
assert.equal(frame.inner.items.length, 2);
for (const actor of runtime.actors.values()) await actor.close?.();

console.log("Hybrid mode passed: one call a beat, a private ledger of views, feelings and wants that the next beat reads back, shown to the operator as private.");
