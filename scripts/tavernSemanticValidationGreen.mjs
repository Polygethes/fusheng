import assert from "node:assert/strict";
import {
  assertSemanticTurn,
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

const baseContext = {
  characters: [
    { id: ids.xieheng, name: "谢恒" },
    { id: ids.xiemu, name: "谢母" },
    { id: ids.xiezenshi, name: "谢真石", aliases: ["真石"] },
    { id: ids.zhoumin, name: "周珉" },
    { id: ids.luozhao, name: "洛照" },
    { id: ids.chenyan, name: "陈砚" },
  ],
  observations: [],
  facts: [],
  openConversations: [],
  zones: [
    { id: "hall", label: "堂前" },
    { id: "counter", label: "柜台" },
    { id: "courtyard", label: "后院" },
  ],
};

const groundedCases = [
  {
    label: "visible movement starts from the actor's actual zone",
    candidate: {
      characterId: ids.xieheng,
      actorZoneId: "hall",
      targetCharacterId: ids.xiezenshi,
      visibleAction: "谢恒从堂前起身，朝后院走去。",
      moveToZoneId: "courtyard",
    },
    context: baseContext,
  },
  {
    label: "opening address agrees with Zhou Min target",
    candidate: {
      characterId: ids.xieheng,
      targetCharacterId: ids.zhoumin,
      speechAct: "acknowledge",
      utterance: "周珉，药包我先收下。举荐的准话得真石自己给你。",
    },
    context: baseContext,
  },
  {
    label: "visible orientation agrees with Luo Zhao target",
    candidate: {
      characterId: ids.xiemu,
      targetCharacterId: ids.luozhao,
      visibleAction: "谢母收好铜钱，转身看向柜台前的洛照。",
    },
    context: baseContext,
  },
  {
    label: "heard claim cites this actor's hearing observation",
    candidate: {
      characterId: ids.zhoumin,
      targetCharacterId: ids.xieheng,
      speechAct: "ask",
      utterance: "谢东家，方才我听见真石跟您提了举荐的事，能不能让我找他问一句？",
      sourceObservationIds: ["obs_zhoumin_heard_nomination"],
    },
    context: {
      ...baseContext,
      observations: [{
        id: "obs_zhoumin_heard_nomination",
        observerId: ids.zhoumin,
        channel: "hearing",
        content: "周珉在堂前听见谢真石向谢恒提起举荐。",
      }],
    },
  },
  {
    label: "tomorrow deadline cites a fact known by this actor",
    candidate: {
      characterId: ids.zhoumin,
      targetCharacterId: ids.xiezenshi,
      speechAct: "ask",
      utterance: "师门催我明日一早回信，今晚能不能给我一句准话？",
      temporalEvidenceIds: ["fact_zhoumin_reply_deadline"],
    },
    context: {
      ...baseContext,
      facts: [{
        id: "fact_zhoumin_reply_deadline",
        content: "师门要求周珉明日一早以前回信。",
        tags: ["deadline", "明日"],
        knownByCharacterIds: [ids.zhoumin],
      }],
    },
  },
  {
    label: "ordinary answer cites an open question addressed to this actor",
    candidate: {
      characterId: ids.xiemu,
      targetCharacterId: ids.luozhao,
      speechAct: "answer",
      utterance: "住一晚加一顿热饭，一共五文。",
      conversationId: "conv_checkout",
      responseToTurnId: "turn_ask_checkout_price",
    },
    context: {
      ...baseContext,
      openConversations: [{
        id: "conv_checkout",
        status: "open",
        participantIds: [ids.luozhao, ids.xiemu],
        expectedResponderId: ids.xiemu,
        openTurnIds: ["turn_ask_checkout_price"],
        turns: [{
          id: "turn_ask_checkout_price",
          speakerId: ids.luozhao,
          addresseeId: ids.xiemu,
          speechAct: "ask",
          utterance: "掌柜，住一晚加一顿热饭，一共多少？",
        }],
      }],
    },
  },
  {
    label: "yesterday history claim cites a remembered work record",
    candidate: {
      characterId: ids.chenyan,
      targetCharacterId: ids.xiemu,
      speechAct: "acknowledge",
      utterance: "谢婶，我先把昨儿没劈完的那摞柴劈了。",
      temporalEvidenceIds: ["fact_chenyan_unfinished_wood"],
    },
    context: {
      ...baseContext,
      facts: [{
        id: "fact_chenyan_unfinished_wood",
        content: "陈砚记得自己昨日离开时还有一摞柴没有劈完。",
        tags: ["昨日", "unfinished_work"],
        knownByCharacterIds: [ids.chenyan],
      }],
    },
  },
];

for (const testCase of groundedCases) {
  const result = validateSemanticTurn(testCase.candidate, testCase.context);
  assert.equal(result.ok, true, `${testCase.label}: ${JSON.stringify(result.violations)}`);
  assert.doesNotThrow(() => assertSemanticTurn(testCase.candidate, testCase.context));
}

console.log("tavernSemanticValidationGreen:test passed", {
  accepted: groundedCases.length,
});
