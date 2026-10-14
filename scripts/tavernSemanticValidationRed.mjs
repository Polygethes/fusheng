import assert from "node:assert/strict";
import {
  SEMANTIC_VIOLATION_CODES,
  validateSemanticTurn,
} from "../src/engine/semanticTurnValidator.js";

const ids = {
  xieheng: "char_xyy_xieheng",
  xiemu: "char_xyy_xiemu",
  xiezenshi: "char_xyy_xiezenshi",
  zhoumin: "char_xyy_zhoumin",
  luozhao: "char_xyy_luozhao",
  chenyan: "char_xyy_chenyan",
};

const context = {
  characters: [
    { id: ids.xieheng, name: "谢恒", aliases: ["爹"] },
    { id: ids.xiemu, name: "谢母" },
    { id: ids.xiezenshi, name: "谢真石", aliases: ["真石"] },
    { id: ids.zhoumin, name: "周珉" },
    { id: ids.luozhao, name: "洛照" },
    { id: ids.chenyan, name: "陈砚" },
  ],
  observations: [{
    id: "obs_xieheng_heard_nomination",
    observerId: ids.xieheng,
    channel: "hearing",
    content: "谢恒听见谢真石提起举荐。",
  }],
  facts: [],
  openConversations: [],
  zones: [
    { id: "hall", label: "堂前" },
    { id: "counter", label: "柜台" },
    { id: "courtyard", label: "后院" },
  ],
};

const cases = [
  {
    label: "target is Zhou Min but the line opens by addressing Zhenshi",
    classification: "claim",
    expectedCode: SEMANTIC_VIOLATION_CODES.DIALOGUE_TARGET_MISMATCH,
    candidate: {
      characterId: ids.xieheng,
      targetCharacterId: ids.zhoumin,
      speechAct: "acknowledge",
      utterance: "真石，周珉的事我先去接手，回头再说。",
    },
  },
  {
    label: "one-character family vocative still identifies the wrong target",
    classification: "claim",
    expectedCode: SEMANTIC_VIOLATION_CODES.DIALOGUE_TARGET_MISMATCH,
    candidate: {
      characterId: ids.xiezenshi,
      targetCharacterId: ids.zhoumin,
      speechAct: "answer",
      utterance: "爹，周珉的事我待会儿再说。",
    },
  },
  {
    label: "visible action turns to Chen Yan while the target remains Luo Zhao",
    classification: "hard",
    expectedCode: SEMANTIC_VIOLATION_CODES.VISIBLE_ACTION_TARGET_MISMATCH,
    candidate: {
      characterId: ids.xiemu,
      targetCharacterId: ids.luozhao,
      visibleAction: "谢母将铜钱一一收进钱箱，合上盖子，然后转身看向门槛处的陈砚。",
    },
  },
  {
    label: "visible action invents a counter starting point while the actor is in the hall",
    classification: "hard",
    expectedCode: SEMANTIC_VIOLATION_CODES.VISIBLE_ACTION_SOURCE_ZONE_MISMATCH,
    candidate: {
      characterId: ids.xieheng,
      actorZoneId: "hall",
      targetCharacterId: ids.xiezenshi,
      visibleAction: "谢恒从柜台起身，朝后院走去。",
    },
  },
  {
    label: "an unheard exchange is presented as something heard moments ago",
    classification: "claim",
    expectedCode: SEMANTIC_VIOLATION_CODES.UNSUPPORTED_PERCEPTION_CLAIM,
    candidate: {
      characterId: ids.zhoumin,
      targetCharacterId: ids.xieheng,
      speechAct: "ask",
      utterance: "谢东家，方才我听见真石在跟您说举荐的事。既然他已经提了，能不能给我个准话？",
      sourceObservationIds: ["obs_xieheng_heard_nomination"],
    },
  },
  {
    label: "a yesterday history claim is invented without a fact source",
    classification: "claim",
    expectedCode: SEMANTIC_VIOLATION_CODES.UNSUPPORTED_TEMPORAL_CLAIM,
    candidate: {
      characterId: ids.chenyan,
      targetCharacterId: ids.xiemu,
      speechAct: "acknowledge",
      utterance: "谢婶，我先把昨儿没劈完的那摞柴劈了。",
    },
  },
  {
    label: "a tomorrow-morning deadline is invented without a fact source",
    classification: "claim",
    expectedCode: SEMANTIC_VIOLATION_CODES.UNSUPPORTED_TEMPORAL_CLAIM,
    candidate: {
      characterId: ids.zhoumin,
      targetCharacterId: ids.xiezenshi,
      speechAct: "ask",
      utterance: "我明日一早要回山，今晚想听你一句实在的。",
    },
  },
  {
    label: "an ordinary answer has no open conversation turn to answer",
    classification: "claim",
    expectedCode: SEMANTIC_VIOLATION_CODES.MISSING_OPEN_CONVERSATION_SOURCE,
    candidate: {
      characterId: ids.xiemu,
      targetCharacterId: ids.luozhao,
      speechAct: "answer",
      utterance: "五文钱，没错。",
    },
  },
];

for (const testCase of cases) {
  const result = validateSemanticTurn(testCase.candidate, context);
  if (testCase.classification === "hard") {
    assert.equal(result.ok, false, `${testCase.label} must be rejected as an impossible visible action`);
    assert.ok(
      result.hardViolations.some((violation) => violation.code === testCase.expectedCode),
      `${testCase.label} must report hard ${testCase.expectedCode}: ${JSON.stringify(result.hardViolations)}`,
    );
  } else {
    assert.equal(result.ok, true, `${testCase.label} is something a person may say and must remain publishable`);
    assert.ok(
      result.claimAnnotations.some((violation) => violation.code === testCase.expectedCode),
      `${testCase.label} must retain claim annotation ${testCase.expectedCode}: ${JSON.stringify(result.claimAnnotations)}`,
    );
    assert.equal(result.violations.length, 0, `${testCase.label} must not be promoted to a world-level rejection`);
  }
}

console.log("tavernSemanticValidationRed:test passed", {
  hardRejected: cases.filter((testCase) => testCase.classification === "hard").length,
  speechAnnotated: cases.filter((testCase) => testCase.classification === "claim").length,
  codes: cases.map((testCase) => `${testCase.classification}:${testCase.expectedCode}`),
});
