import assert from "node:assert/strict";
import jiexing from "../src/worlds/jiexing/pack.mjs";
import { buildPlayableWorldFromPack } from "../src/worlds/buildPlayableWorldFromPack.mjs";
import { createWorldRuntimeV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { PERFORMANCE_PHASE } from "../src/server/pipeline/characterPerformanceTurn.mjs";

const XM = "char_jx_guxiaoman";
const HS = "char_jx_guhuaishan";
const keyOf = (prompt, kind, label) => {
  const match = prompt.match(new RegExp(`^- (${kind}\\d+) ${label}`, "mu"));
  assert.ok(match, `the prompt lists ${label} with a ${kind} key`);
  return match[1];
};
const answer = ({ thought = "", to = "", text = "", loud = false, type = "none", target = "", person = "", minutes = 0, gesture = "" } = {}) => (
  { thought, say: { to, text, loud }, do: { type, target, person, minutes }, gesture });

function createScriptedWorld(script, { maxStageProtocolRepairs = 1 } = {}) {
  const inputs = [];
  const rejected = [];
  const instance = createWorldRuntimeV27(buildPlayableWorldFromPack(jiexing), {
    worldPack: jiexing, pacingMode: "scene", characterIds: jiexing.stage.sceneCast, enableDayPlanning: false,
    characterAgentCallMode: "performance", maxStageProtocolRepairs,
    onStageRejected: (row) => rejected.push(row),
    async runStage(input) {
      inputs.push(input);
      const queue = script[input.characterId] || [];
      const next = queue.length ? queue.shift() : () => answer({ thought: "先看看再说", type: "wait", minutes: 10 });
      return { performance: next(input.prompt.user, input) };
    },
  });
  return { instance, inputs, rejected, world: () => instance.runtime.coordinator.worldState };
}

async function closeAll(instance) {
  for (const actor of instance.runtime.actors.values()) await actor.close?.();
}

// 1. A beat is one lean call that speaks in the character's own voice.
{
  const script = {
    [XM]: [
      (prompt) => {
        assert.ok(prompt.length < 9000, `a performance prompt stays lean (${prompt.length} chars)`);
        assert.match(prompt, /【你怎么说话】[\s\S]*原作台词/u, "canon voice samples reach the character");
        assert.match(prompt, /【你和这些人】[\s\S]*顾怀山/u, "relationships are written as prose");
        assert.match(prompt, /array_eye=谷口阵眼（要经过堂屋、院子、篱笆外村道）/u, "far zones are offered with their route");
        assert.doesNotMatch(prompt, /先到[a-z_]+/u, "prerequisites name places, not ids");
        return answer({ thought: "得先让爹知道我醒了", type: "move", target: "main_room", text: "爹——你在堂屋吗？", loud: true });
      },
      (prompt) => answer({ thought: "把星图拿出来给爹看", type: "take_out", target: keyOf(prompt, "O", "手绘星图") }),
      (prompt) => answer({ thought: "让他自己看", to: keyOf(prompt, "P", "顾怀山"), text: "你看嘛，北边这几颗星，跟谷口那段阵纹是对着的。",
        type: "give", target: keyOf(prompt, "O", "手绘星图"), person: keyOf(prompt, "P", "顾怀山"), gesture: "把纸往前一推" }),
      (prompt) => answer({ thought: "去阵眼看看", type: "move", target: "array_eye" }),
    ],
    [HS]: [
      (prompt) => answer({ thought: "这孩子又一大早不安生", to: keyOf(prompt, "P", "顾小满"), text: "嗯。粥在锅里。", gesture: "没抬头，手里的刀停了一下" }),
    ],
  };
  const { instance, inputs, world } = createScriptedWorld(script);
  await instance.runtime.enqueueWake(XM, { wakeId: "wake:contract:xm", kind: "continuation_due", evidenceIds: [], evidence: [] });

  const first = await instance.runtime.runNext();
  assert.equal(inputs[0].phase, PERFORMANCE_PHASE);
  assert.equal(inputs.length, 1, "one model call per beat");
  assert.equal(first.actionAttempt.primitive, "move");
  assert.equal(world().entities[XM].zoneId, "main_room", "the world settled the move");
  assert.equal(first.outcome.durationSeconds >= 15, true, "walking a room takes scene time, not 3 seconds");
  assert.ok(first.actionAttempt.payload.utterance.includes("爹"), "speech travels with the move");

  const seen = [];
  for (let index = 0; index < 24 && !(script[XM].length === 0 && script[HS].length === 0); index += 1) {
    const turn = await instance.runtime.runNext();
    if (!turn) break;
    seen.push(turn);
  }
  assert.ok(!seen.some((turn) => turn.characterId === "char_jx_abao"), "small actions in another room are seen without costing the lane a new beat");
  const reply = seen.find((turn) => turn.characterId === HS);
  assert.ok(reply, "the father was woken by speech, not by a timer");
  assert.equal(reply.actionAttempt.primitive, "speak");
  assert.equal(reply.actionAttempt.payload.speechTargetCharacterId, XM);
  const map = Object.values(world().objects).find((row) => row.label === "手绘星图");
  assert.equal(map.holderCharacterId, HS, "the give settled as a real transfer");
  assert.equal(world().entities[XM].zoneId, "yard", "a far destination is walked one settled hop at a time");
  const xmPrivate = instance.runtime.actors.get(XM).privateState;
  assert.match(xmPrivate.currentIntention, /正往谷口阵眼去/u, "the character remembers where they were heading");
  assert.ok(xmPrivate.memoryContext, "perceived evidence is encoded into memory");

  const speech = seen.find((turn) => turn.actionAttempt?.payload?.utterance?.startsWith("你看嘛"));
  const speechText = speech.actionAttempt.payload.utterance;
  const policy = world().timePolicy;
  assert.ok(speech.outcome.durationSeconds >= Math.ceil(speechText.length / policy.speechCharactersPerSecond) + policy.speechPauseSeconds - 1,
    "speech takes speaking time plus a natural pause");
  await closeAll(instance);
}

// 2. A gesture alone does not cascade into everybody re-reading the room.
{
  const script = {
    [XM]: [() => answer({ thought: "不想说话", type: "none", gesture: "把被角往上拉了拉" })],
  };
  const { instance } = createScriptedWorld(script);
  await instance.runtime.enqueueWake(XM, { wakeId: "wake:contract:quiet", kind: "continuation_due", evidenceIds: [], evidence: [] });
  const turn = await instance.runtime.runNext();
  assert.equal(turn.actionAttempt.primitive, "rest");
  assert.ok(turn.outcome.durationSeconds >= 60, "being quiet lets real time pass");
  assert.deepEqual(instance.runtime.readyQueue.filter((id) => id !== XM), [], "an undirected gesture wakes nobody");
  await closeAll(instance);
}

// 3. A malformed answer is repaired with feedback; an unrepairable one suspends the character and nothing is invented.
{
  const script = {
    [XM]: [
      () => answer({ type: "move", target: "nowhere" }),
      () => answer({ thought: "算了，先待着", type: "wait", minutes: 5 }),
    ],
  };
  const { instance, inputs, rejected } = createScriptedWorld(script);
  await instance.runtime.enqueueWake(XM, { wakeId: "wake:contract:repair", kind: "continuation_due", evidenceIds: [], evidence: [] });
  const turn = await instance.runtime.runNext();
  assert.equal(inputs.length, 2);
  assert.ok(inputs[1].protocolRepairFeedback.issues.some((row) => row.path === "do.target"), "the repair call says what was wrong");
  assert.equal(rejected.length, 1);
  assert.equal(turn.actionAttempt.primitive, "wait");
  assert.equal(turn.actionAttempt.payload.waitCondition.maximumSeconds, 300);
  await closeAll(instance);

  const broken = createScriptedWorld({ [XM]: [() => ({ nonsense: true }), () => ({ nonsense: true })] });
  await broken.instance.runtime.enqueueWake(XM, { wakeId: "wake:contract:broken", kind: "continuation_due", evidenceIds: [], evidence: [] });
  const before = broken.world().nowSeconds;
  await assert.rejects(() => broken.instance.runtime.runNext());
  assert.equal(broken.instance.runtime.actors.get(XM).executionControl.status, "suspended_model_error");
  assert.equal(broken.world().nowSeconds, before, "no substitute action was settled");
  await closeAll(broken.instance);
}


// 4. A due execution review becomes a reconsider beat in the same lean call, and is settled without inventing insights.
{
  const script = {
    [XM]: [(prompt) => {
      assert.match(prompt, /【停下来想一想】\n本人已经等了很久/u, "the review reason reaches the character");
      return answer({ thought: "光等没用，去找爹", type: "move", target: "main_room" });
    }],
  };
  const { instance, inputs } = createScriptedWorld(script);
  const actor = instance.runtime.actors.get(XM);
  actor.executionControl.reviewPending = true;
  actor.privateState.reflectionState = { ...(actor.privateState.reflectionState || {}), ownerCharacterId: XM,
    pendingOpportunity: { ownerCharacterId: XM, opportunityId: `execution-review:${XM}:contract`, sequence: 1, status: "due", dueAtSeconds: 0,
      accumulatedImportance: 0, sourceMemoryIds: [], sourceMemorySnapshots: [], decisionAuthority: "character-agent", selection: null,
      executionReviewReason: "本人已经等了很久，事情没有变化。" } };
  await instance.runtime.scheduleDueOwnedReflections();
  const turn = await instance.runtime.runNext({ characterId: XM });
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0].phase, PERFORMANCE_PHASE, "no separate heavy reflection call");
  assert.equal(turn.actionAttempt.primitive, "move");
  assert.equal(turn.privateResult.reflectionCompleted, true);
  assert.equal(actor.privateState.reflectionState.pendingOpportunity, null, "the opportunity is settled");
  assert.equal(actor.privateState.reflectionState.completedOpportunities.at(-1).insightCount, 0, "no insight was written for the character");
  assert.equal(actor.executionControl.reviewPending, false);
  await closeAll(instance);
}

console.log("Character performance turn passed: one lean call per beat, canon voice and relationships in prose, settled moves/takes/gives/speech, routed far moves, scene-scale durations, quiet peripheral events, repair, honest suspension and in-beat reconsideration.");
