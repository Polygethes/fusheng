// scripts/compiledPromptCleanContracts.mjs
// Contract test for A10: performance turn execution without model calls,
// asserting Li Xiaohe multi-turn navigation, wake by speech, and prompts containing NO IDs
import assert from "node:assert/strict";
import fs from "node:fs";
import { compileBlueprint } from "../src/worlds/compiler/index.mjs";
import { buildPlayableWorldFromPack } from "../src/worlds/buildPlayableWorldFromPack.mjs";
import { createWorldRuntimeV27 } from "../src/server/pipeline/tavernWorldRuntimeV27.mjs";
import { PERFORMANCE_PHASE } from "../src/server/pipeline/characterPerformanceTurn.mjs";

const fixtures = [
  "scripts/fixtures/blueprints/tiny_hamlet.json",
  "scripts/fixtures/blueprints/river_town.json",
  "scripts/fixtures/blueprints/forest_village.json",
];

const answer = ({ thought = "", to = "", text = "", loud = false, type = "none", target = "", person = "", minutes = 0, gesture = "" } = {}) => (
  { thought, say: { to, text, loud }, do: { type, target, person, minutes }, gesture });

const keyOf = (prompt, kind, label) => {
  const match = prompt.match(new RegExp(`^- (${kind}\\d+) ${label}`, "mu"));
  assert.ok(match, `the prompt lists ${label} with a ${kind} key`);
  return match[1];
};

function createScriptedTownWorld(pack, script) {
  const inputs = [];
  const rejected = [];
  const playable = buildPlayableWorldFromPack(pack);
  const instance = createWorldRuntimeV27(playable, {
    worldPack: pack,
    pacingMode: "scene",
    characterIds: pack.stage.sceneCast,
    enableDayPlanning: false,
    characterAgentCallMode: "performance",
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

// 1. Scripted execution on tiny_hamlet
{
  const bp = JSON.parse(fs.readFileSync("scripts/fixtures/blueprints/tiny_hamlet.json", "utf8"));
  const { pack } = compileBlueprint(bp);

  const xiaoheId = "char_tiny_hamlet_li_xiaohe";
  const wangshenId = "char_tiny_hamlet_wang_shen";

  // The exterior town can have several street segments between home and
  // the shop. Keep the original checks and speech beats, but provide one
  // movement beat per hop in the actual compiled topology.
  const from = pack.stage.scenePositions[xiaoheId];
  const to = "herb_shop__front";
  const previous = new Map([[from, null]]);
  const queue = [from];
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    if (current === to) break;
    for (const edge of pack.stage.topology.edges) {
      if (!(Number(edge.move) > 0 && Number.isFinite(Number(edge.move)))) continue;
      const next = edge.from === current ? edge.to : edge.to === current ? edge.from : null;
      if (next && !previous.has(next)) { previous.set(next, current); queue.push(next); }
    }
  }
  assert.ok(previous.has(to), "Li Xiaohe has a topology route to herb_shop__front");
  const movementPath = [];
  for (let current = to; current !== from; current = previous.get(current)) movementPath.unshift(current);

  const script = {
    [xiaoheId]: [
      // Beat 1: Li Xiaohe moves toward herb_shop__front
      (prompt) => {
        // Assert prompt checks during turn 1
        assert.doesNotMatch(prompt, /你在[a-z_]/u, "prompt must not contain '你在<id>'");
        assert.doesNotMatch(prompt, /work_[a-z]/u, "prompt must not contain 'work_<id>'");
        assert.doesNotMatch(prompt, /需要[a-z]/u, "prompt must not contain '需要<skill_id>'");
        assert.doesNotMatch(prompt, /称呼 [a-z]/u, "prompt must not contain '称呼 <id>'");
        assert.doesNotMatch(prompt, /=[a-z0-9_]+[（，\s]/u, "move list must not use id on right of =");
        return answer({ thought: "去药铺找王婶取药包", type: "move", target: "herb_shop" });
      },
      // Beat 3: At herb_shop__front, speaks to Wang Shen
      (prompt) => {
        const wangP = keyOf(prompt, "P", "王婶");
        return answer({ thought: "向王婶问药包", to: wangP, text: "王婶，我爹的药包配好了吗？" });
      },
    ],
    [wangshenId]: [
      // Wang Shen is woken by speech and replies to Li Xiaohe
      (prompt) => {
        const xiaoheP = keyOf(prompt, "P", "李小禾");
        return answer({ thought: "小禾来了", to: xiaoheP, text: "小禾来了，刚包好呢。" });
      },
    ],
  };

  const { instance, inputs, world } = createTownTownWorld(pack, script);
  // Wake Li Xiaohe to start
  await instance.runtime.enqueueWake(xiaoheId, { wakeId: "wake:contract:xiaohe:1", kind: "continuation_due", evidenceIds: [], evidence: [] });

  const first = await instance.runtime.runNext();
  assert.equal(inputs[0].phase, PERFORMANCE_PHASE);
  assert.equal(first.actionAttempt.primitive, "move");
  // Li Xiaohe walked the first hop (not immediately teleported)
  assert.notEqual(world().entities[xiaoheId].zoneId, "li_home__hall");

  // Run remaining scripted beats
  const seen = [];
  for (let i = 0; i < 20 && (script[xiaoheId].length > 0 || script[wangshenId].length > 0); i++) {
    const turn = await instance.runtime.runNext();
    if (!turn) break;
    seen.push(turn);
  }

  // Li Xiaohe reached herb_shop__front
  assert.equal(world().entities[xiaoheId].zoneId, "herb_shop__front", "Li Xiaohe reached herb_shop__front");

  // Wang Shen was woken by speech
  const reply = seen.find((turn) => turn.characterId === wangshenId);
  assert.ok(reply, "Wang Shen was woken by speech");
  assert.equal(reply.actionAttempt.primitive, "speak");
  assert.equal(reply.actionAttempt.payload.speechTargetCharacterId, xiaoheId);
  assert.ok(reply.actionAttempt.payload.utterance.includes("小禾"), "Wang Shen addresses Li Xiaohe as 小禾");

  await closeAll(instance);
}

// 2. Prompt assertions across all 3 fixtures: every resident gets at least one prompt
for (const fixPath of fixtures) {
  const fbp = JSON.parse(fs.readFileSync(fixPath, "utf8"));
  const { pack: fpack } = compileBlueprint(fbp);

  // Script where everyone waits, so we can capture their first prompt
  const capturedPrompts = {};
  const script = {};
  for (const resident of fbp.residents) {
    const charId = `char_${fpack.meta.id}_${resident.id}`;
    script[charId] = [
      (prompt) => {
        capturedPrompts[resident.id] = prompt;
        return answer({ thought: "先等等", type: "wait", minutes: 5 });
      },
    ];
  }

  const { instance } = createScriptedTownWorld(fpack, script);
  // Wake all residents once
  for (const resident of fbp.residents) {
    const charId = `char_${fpack.meta.id}_${resident.id}`;
    await instance.runtime.enqueueWake(charId, { wakeId: `wake:${resident.id}`, kind: "continuation_due", evidenceIds: [], evidence: [] });
  }

  for (let i = 0; i < fbp.residents.length * 2; i++) {
    await instance.runtime.runNext();
    if (Object.keys(capturedPrompts).length === fbp.residents.length) break;
  }

  // Verify prompt for every resident
  for (const resident of fbp.residents) {
    const prompt = capturedPrompts[resident.id];
    assert.ok(prompt, `Must capture prompt for ${resident.id} in ${fpack.meta.id}`);

    // Negative assertions: NO raw IDs in prompt
    assert.doesNotMatch(prompt, /你在[a-z_]/u, `[${resident.id}] prompt must not contain '你在<id>'`);
    assert.doesNotMatch(prompt, /work_[a-z]/u, `[${resident.id}] prompt must not contain 'work_<id>'`);
    assert.doesNotMatch(prompt, /需要[a-z]/u, `[${resident.id}] prompt must not contain '需要<skill_id>'`);
    assert.doesNotMatch(prompt, /称呼 [a-z]/u, `[${resident.id}] prompt must not contain '称呼 <id>'`);
    assert.doesNotMatch(prompt, /=[a-z0-9_]+[（，\s]/u, `[${resident.id}] move list must not use id on right of =`);

    // Positive assertion: style fragment appears in 【你怎么说话】
    if (resident.speech?.style) {
      const matchStyle = prompt.match(/【你怎么说话】[\s\S]*?(?=【|$)/u);
      assert.ok(matchStyle, `[${resident.id}] prompt must have 【你怎么说话】 section`);
      const sampleChunk = resident.speech.style.slice(0, 4);
      assert.ok(matchStyle[0].includes(sampleChunk), `[${resident.id}] speech.style fragment '${sampleChunk}' must appear in 【你怎么说话】`);
    }
  }

  await closeAll(instance);
}

function createTownTownWorld(pack, script) {
  return createScriptedTownWorld(pack, script);
}

console.log("Performance turn and clean prompt contract passed.");
