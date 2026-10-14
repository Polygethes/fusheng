import { privateSimulationToAgentOutput } from "../src/server/pipeline/privateSimulator.mjs";
import { privateSimulationSchema, visibilityLayerSchema, sceneInteractionSchema } from "../src/server/pipeline/schemas.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(privateSimulationSchema.required.includes("privateDesire"), "privateSimulationSchema missing privateDesire");
assert(visibilityLayerSchema.required.includes("perCharacter"), "visibilityLayerSchema missing perCharacter");
assert(sceneInteractionSchema.required.includes("misunderstandings"), "sceneInteractionSchema missing misunderstandings");

const output = privateSimulationToAgentOutput({
  characterId: "char_a",
  characterName: "A",
  targetCharacterId: "char_b",
  targetCharacterName: "B",
  tone: "试探",
  publicGoal: "公开保持体面",
  privateDesire: "暗中索取回应",
  defensiveMask: "把索取说成原则",
  shadowImpulse: "让对方先暴露",
  nobleImpulse: "减少伤害",
  selfLie: "我只是负责",
  actionCandidate: "递出一份可被误读的文件",
  whatTheyWantFromOthers: "追问",
  whatTheyRefuseToAdmit: "需要被看见",
  riskTheyWillCreate: "证据债",
  planLine: "继续靠近但伪装成保护",
  memoryLine: "把旧事武器化",
  contradictionScore: 72,
  pressure: 68,
  surfaceJustification: "程序需要",
  desireReason: "被对方确认",
  shameReason: "害怕欲望被命名",
  powerReason: "保留解释权",
  selfDeceptionReason: "把欲望改名为职责",
  unadmittedPleasure: "对方被自己影响",
  postActionSelfPunishment: "事后删改记录",
  falseBeliefs: ["B 的沉默是在回应自己"],
  withheldFacts: ["自己早就知道那封邮件"],
});

assert(output.visibleAction.includes("文件"), "adapter failed visibleAction");
assert(output.realtimePrivateDesire.includes("索取"), "adapter failed realtime private desire");
assert(output.planInfluence.includes("靠近"), "adapter failed plan influence");
console.log("model realtime pipeline schema/adapter test passed", {
  requiredSchemas: 3,
  outputTone: output.tone,
  realtimeContradictionScore: output.realtimeContradictionScore,
});
