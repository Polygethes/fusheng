import assert from "node:assert/strict";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { runTavernCausalScene } from "../src/server/pipeline/tavernCausalScene.mjs";

const LUO_ID = "char_xyy_luozhao";
const XIE_ID = "char_xyy_xiezenshi";

function choiceWorld() {
  const state = buildPlayableWorldFromSetup({
    setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
    setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
  });
  for (const character of state.characters || []) {
    character.lifeState = character.lifeState || {};
    character.lifeState.present = [LUO_ID, XIE_ID].includes(character.id);
    if (character.lifeState.present) character.currentLocationId = "loc_xyy_tavern";
  }
  return state;
}

function oneVisibleDecision(candidate) {
  const mode = candidate.realization?.mode || "act";
  const needsSpeech = candidate.realization?.requireSpeech === true || ["speak", "respond"].includes(mode);
  const targetCharacterId = candidate.targetCharacterId || "";
  return {
    candidateId: candidate.candidateId,
    actionType: needsSpeech ? "speak" : "act",
    speechAct: needsSpeech ? "inform" : "none",
    targetCharacterId,
    speech: needsSpeech ? "我先亲眼看看。" : "",
    visibleAction: needsSpeech ? "洛照看向眼前的人" : "洛照停下脚步，按住剑鞘观察堂前",
    moveToZoneId: "",
    vocalMode: "conversational",
    affordanceId: candidate.realization?.affordanceId || "",
    informationSourceImpactId: "",
    commitmentAction: "none",
    commitmentTopic: "",
    decisionValue: "none",
    privateReason: "最高分是压力，不是命令；我此刻先选择观察。",
  };
}

let captured = null;
let chosen = null;
const chosenRun = await runTavernCausalScene(choiceWorld(), {
  allowOrphanVisitors: true,
  characterIds: [LUO_ID, XIE_ID],
  positions: { [LUO_ID]: "hall", [XIE_ID]: "hall" },
  maxSteps: 1,
  minimumActivationScore: 0,
  seedImpacts: [{
    sourceCharacterId: "world:test-sword-cue",
    sourceZoneId: "hall",
    type: "physical",
    modality: "visual",
    intensity: 100,
    radius: 0,
    directedTargetId: LUO_ID,
    content: "堂前有人收剑，剑锋余势在桌沿留下一线轻响。",
    topic: "可亲眼判断的剑势",
  }],
  async runAgent(input) {
    captured = structuredClone(input);
    const feasible = (input.privateActionCandidates || [])
      .filter((candidate) => candidate.feasible)
      .sort((left, right) => right.activationScore - left.activationScore);
    assert.ok(feasible.length >= 2, "the activated character must receive more than one feasible private choice");
    chosen = feasible.find((candidate, index) => (
      index > 0
      && !candidate.realization?.affordanceId
      && candidate.realization?.requireSpeech !== true
      && !["speak", "respond"].includes(candidate.realization?.mode)
    )) || feasible[1];
    return { decision: oneVisibleDecision(chosen) };
  },
});

assert.equal(Object.hasOwn(captured, "decisionMandate"), false, "the world must not send a preselected intention");
assert.equal(captured.choiceAuthority.owner, "character-agent");
assert.equal(captured.choiceAuthority.mathematicsRole, "private-psychological-appraisal");
assert.ok(captured.privateActionCandidates.every((candidate) => !Object.hasOwn(candidate, "observerFactorTrace")));
const formulaTop = captured.privateActionCandidates
  .filter((candidate) => candidate.feasible)
  .sort((left, right) => right.activationScore - left.activationScore)[0];
assert.notEqual(chosen.candidateId, formulaTop.candidateId, "fixture must prove a feasible non-top choice can win");
const canonicalChosenCandidateId = chosen.candidateId.replace(/(?:known|perceived)_slug:[^:]+/u, "xiezenshi");
assert.equal(
  chosenRun.decisions[0]?.candidateId,
  canonicalChosenCandidateId,
  "the Agent chooses an opaque input id and the server resolves it only after choice",
);
assert.equal(chosenRun.decisions[0]?.choiceAuthority, "character-agent");

let invalidCaptured = null;
const rejectedRun = await runTavernCausalScene(choiceWorld(), {
  allowOrphanVisitors: true,
  characterIds: [LUO_ID, XIE_ID],
  positions: { [LUO_ID]: "hall", [XIE_ID]: "hall" },
  maxSteps: 1,
  minimumActivationScore: 0,
  seedImpacts: [{
    sourceCharacterId: "world:test-sword-cue",
    sourceZoneId: "hall",
    type: "physical",
    modality: "visual",
    intensity: 100,
    radius: 0,
    directedTargetId: LUO_ID,
    content: "堂前有人收剑，剑锋余势在桌沿留下一线轻响。",
    topic: "可亲眼判断的剑势",
  }],
  async runAgent(input) {
    invalidCaptured = structuredClone(input);
    return {
      decision: {
        ...oneVisibleDecision(input.privateActionCandidates.find((candidate) => candidate.feasible)),
        candidateId: "candidate_not_given_to_this_agent",
      },
    };
  },
});

assert.ok(invalidCaptured.privateActionCandidates.length > 0);
assert.equal(rejectedRun.actions.length, 0, "an invalid id must be rejected without executing a substitute action");
assert.equal(rejectedRun.decisions[0]?.decision?.choiceAuthority, "character-agent:rejected");
assert.ok(rejectedRun.decisions[0]?.decision?.semanticViolations?.some((row) => row.code === "AGENT_CANDIDATE_NOT_AVAILABLE"));

const reconsiderationCalls = [];
const reconsideredRun = await runTavernCausalScene(choiceWorld(), {
  allowOrphanVisitors: true,
  characterIds: [LUO_ID, XIE_ID],
  positions: { [LUO_ID]: "hall", [XIE_ID]: "hall" },
  maxSteps: 1,
  minimumActivationScore: 0,
  seedImpacts: [{
    sourceCharacterId: "world:test-sword-cue",
    sourceZoneId: "hall",
    type: "physical",
    modality: "visual",
    intensity: 100,
    radius: 0,
    directedTargetId: LUO_ID,
    content: "堂前有人收剑，剑锋余势在桌沿留下一线轻响。",
    topic: "可亲眼判断的剑势",
  }],
  async runAgent(input) {
    reconsiderationCalls.push({
      characterId: input.agent.id,
      attempt: Number(input.repairFeedback?.attempt || 0),
      mode: input.repairFeedback?.mode || "initial",
    });
    if (!input.repairFeedback || input.repairFeedback.attempt === 1) {
      return {
        stage: { provider: "openai", model: "deterministic-reconsideration-probe" },
        decision: {
          ...oneVisibleDecision(input.privateActionCandidates.find((candidate) => candidate.feasible)),
          candidateId: "candidate_not_given_to_this_agent",
        },
      };
    }
    const feasible = input.privateActionCandidates.find((candidate) => (
      candidate.feasible
      && !candidate.realization?.affordanceId
      && candidate.realization?.requireSpeech !== true
      && !["speak", "respond"].includes(candidate.realization?.mode)
    )) || input.privateActionCandidates.find((candidate) => candidate.feasible);
    return {
      stage: { provider: "openai", model: "deterministic-reconsideration-probe" },
      decision: oneVisibleDecision(feasible),
    };
  },
});

assert.deepEqual(
  reconsiderationCalls.map((call) => call.characterId),
  [LUO_ID, LUO_ID, LUO_ID],
  "an invalid realization and failed repair must return to the same Character Agent before the scheduler may switch people",
);
assert.deepEqual(reconsiderationCalls.map((call) => call.attempt), [0, 1, 2]);
assert.equal(reconsiderationCalls[2].mode, "same-character-reconsideration");
assert.equal(reconsideredRun.actions.length, 1, "the same character's valid reconsideration should become the only committed action");
assert.equal(reconsideredRun.actions[0].actorId, LUO_ID);
assert.equal(reconsideredRun.decisions[0]?.repair?.accepted, true);
assert.equal(reconsideredRun.decisions[0]?.repair?.attempts?.length, 2);

console.log("tavernCharacterAgentChoiceAuthority:test passed", {
  actorId: chosenRun.decisions[0]?.characterId,
  formulaTop: formulaTop.candidateId,
  characterChoice: chosen.candidateId,
  invalidChoiceRejected: true,
  sameCharacterReconsideration: reconsiderationCalls.map((call) => call.attempt),
});
