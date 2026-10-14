import assert from "node:assert/strict";
import { playModelPeriodWithRunners } from "../src/server/pipeline/openaiPipeline.mjs";
import { runTavernCausalScene } from "../src/server/pipeline/tavernCausalScene.mjs";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";


// This project ships no default model. A contract that drives the real-model
// pipeline must name the model it is pretending to call.
process.env.CHARACTER_TOWN_MODEL ||= "contract-test-model";

const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
state.ui.timeGrain = "scene";
state.ui.engineMode = "openai";

const xieHengId = "char_xyy_xieheng";
const xieMuId = "char_xyy_xiemu";
for (const character of state.characters) {
  if ([xieHengId, xieMuId].includes(character.id)) character.lifeState.present = true;
}
const inputs = [];
await playModelPeriodWithRunners(state, {
  pipelineMode: "live",
  characterAgentProtocolVersion: 1,
  characterIds: [xieHengId, xieMuId],
  positions: { [xieHengId]: "hall", [xieMuId]: "hall" },
  seedImpacts: [{
    sourceCharacterId: "world:relationship-context-probe",
    sourceZoneId: "hall",
    type: "institution",
    modality: "sound",
    intensity: 100,
    radius: 0,
    directedTargetId: xieHengId,
    content: "只用于激活谢恒并检查他本人可见的关系上下文。",
  }],
  minimumActivationScore: 0,
  maxSteps: 1,
  runners: {
    async runTavernAgentDecision() {
      throw new Error("the obsolete tavern scheduler must not run in causal scene mode");
    },
    async runTavernCausalAgent(input) {
      inputs.push(structuredClone(input));
      const candidate = input.privateActionCandidates.find((item) => item.feasible);
      return {
        decision: {
          candidateId: candidate?.candidateId || "",
          actionType: "pass",
          speechAct: "none",
          targetCharacterId: "",
          speech: "",
          visibleAction: "",
          moveToZoneId: "",
          informationSourceImpactId: "",
          commitmentAction: "none",
          commitmentTopic: "",
          privateReason: "只检查本人可见的关系上下文。",
        },
        stage: { name: "CausalAgent:relationship-context", provider: "test", model: "fake", elapsedMs: 0 },
      };
    },
  },
});

const xieHeng = inputs.find((input) => input.agent.id === xieHengId);
assert.ok(xieHeng, "fixture must activate Xie Heng");
const spouse = (xieHeng.agent.relationshipContext || []).find((item) => item.otherCharacterId === xieMuId);
assert.ok(spouse, "Xie Heng must know his own public relationship to Xie Mu when she is present");
assert.equal(spouse.label, "丈夫 / 依赖掌柜却隐瞒代价", "Xie Heng must receive his own directed stance, not a symmetric spouse label");
assert.doesNotMatch(spouse.label, /妻子/, "the reverse Xie Mu-to-Xie Heng label must not leak into Xie Heng's context");
assert.deepEqual(spouse.allowedAddresses, ["他娘", "掌柜"]);
assert.match(spouse.addressingRule, /家庭|夫妻|家人/);
assert.equal("unspoken" in spouse, false, "relationship context must not leak the other Agent's private unspoken state");
assert.equal("misreading" in spouse, false, "relationship context must not leak private interpretations");

const annotatedWrongAddress = await runTavernCausalScene(structuredClone(state), {
  characterIds: [xieMuId, xieHengId],
  positions: { [xieMuId]: "hall", [xieHengId]: "hall" },
  seedImpacts: [{
    sourceCharacterId: "world:wrong-address-probe",
    sourceZoneId: "hall",
    type: "institution",
    modality: "sound",
    intensity: 100,
    radius: 0,
    directedTargetId: xieMuId,
    content: "只用于检查夫妻之间不能套用父子称呼。",
  }],
  minimumActivationScore: 0,
  maxSteps: 1,
  maxLocalFollowupSteps: 0,
  async runAgent(input) {
    const candidate = input.privateActionCandidates.find((item) => (
      item.feasible && item.targetCharacterId === xieHengId
    )) || input.privateActionCandidates.find((item) => item.feasible && item.actionKind === "handle_environment_event");
    assert.ok(candidate, `expected a feasible direct or environmental candidate, got: ${JSON.stringify({
      actorId: input.agent?.id,
      candidates: input.privateActionCandidates.map((item) => ({
        candidateId: item.candidateId,
        targetCharacterId: item.targetCharacterId,
        actionKind: item.actionKind,
        feasible: item.feasible,
      })),
    }, null, 2)}`);
    return { decision: {
      candidateId: candidate.candidateId,
      actionType: "speak",
      speechAct: "inform",
      targetCharacterId: xieHengId,
      speech: "爹，我知道了。",
      visibleAction: "",
      moveToZoneId: "",
      informationSourceImpactId: "",
      commitmentAction: "none",
      commitmentTopic: "",
      privateReason: "故意探测错误亲属称呼。",
    } };
  },
});
assert.ok(
  annotatedWrongAddress.decisions[0].decision.claimAnnotations.some((violation) => violation.code === "DIALOGUE_ADDRESS_NOT_ALLOWED"),
  JSON.stringify(annotatedWrongAddress.decisions[0].decision.claimAnnotations),
);
assert.equal(annotatedWrongAddress.actions.length, 1, "speech diagnostics must not let the world censor a mistaken, teasing, or deceptive utterance");
assert.equal(annotatedWrongAddress.actions[0].speech, "爹，我知道了。", "the public record must preserve what the character actually said");

console.log("modelTavernAgentRelationshipContext:test passed", { relationship: spouse });
