import assert from "node:assert/strict";
import { attachInteractionCausalityToAgentOutputs } from "../src/server/pipeline/openaiPipeline.mjs";

const compact = {
  activeCharacters: [
    { id: "char_shen", name: "沈珩" },
    { id: "char_yan", name: "阎无咎" },
  ],
};

const agentOutputs = [
  {
    characterId: "char_shen",
    targetCharacterId: "char_yan",
    tone: "求证",
    visibleAction: "沈珩把契牌扣进铜盘。",
    hiddenAction: "要逼出旧案证词。",
    defenseAction: "按城法扣契。",
  },
  {
    characterId: "char_yan",
    targetCharacterId: "char_shen",
    tone: "试探",
    visibleAction: "阎无咎准备递毒誓符。",
    hiddenAction: "要换回出城令。",
    defenseAction: "押的是灵契。",
  },
];

const sceneInteraction = {
  agentExchanges: [
    {
      sourceCharacterId: "char_shen",
      responseCharacterId: "char_yan",
      sourceCharacterName: "沈珩",
      responseCharacterName: "阎无咎",
      sharedObject: "灵契",
      eventOutcome: "沈珩把灵契推到铜盘边，阎无咎没有拿走。",
      dialogueTurns: [
        {
          speakerId: "char_shen",
          speakerName: "沈珩",
          targetId: "char_yan",
          targetName: "阎无咎",
          line: "按城法扣契，不按宗门私仇。",
          turnRole: "claim",
        },
        {
          speakerId: "char_yan",
          speakerName: "阎无咎",
          targetId: "char_shen",
          targetName: "沈珩",
          line: "我押的是灵契，不是命。",
          turnRole: "response",
          respondsTo: "按城法扣契，不按宗门私仇。",
        },
        {
          speakerId: "char_shen",
          speakerName: "沈珩",
          targetId: "char_yan",
          targetName: "阎无咎",
          line: "剑可以停，证据不能走。",
          turnRole: "counter",
          respondsTo: "我押的是灵契，不是命。",
        },
      ],
      relationshipDeltas: [],
      generatedFrom: "model-agent-dialogue",
    },
  ],
};

const attached = attachInteractionCausalityToAgentOutputs(agentOutputs, sceneInteraction, compact);
const shen = attached.find((output) => output.characterId === "char_shen");
const yan = attached.find((output) => output.characterId === "char_yan");

assert.match(
  shen.visibleAction,
  /按城法扣契/,
  "initiator output should absorb its opening dialogue turn from the exchange",
);
assert.match(
  shen.visibleAction,
  /证据不能走/,
  "initiator output should also absorb its later counter turn from the same exchange",
);
assert.match(
  yan.visibleAction,
  /我押的是灵契，不是命/,
  "responder output should absorb its concrete response line from the exchange",
);
assert.equal(
  yan.interactionInput?.dialogueLine,
  "我押的是灵契，不是命。",
  "responder interaction input should record the exact spoken response",
);
assert.equal(
  yan.interactionInput?.respondsToLine,
  "按城法扣契，不按宗门私仇。",
  "responder interaction input should record the line it answered",
);
assert.match(
  yan.interactionInput?.observedVisibleAction || "",
  /按城法扣契/,
  "responder should observe the initiator's actual spoken claim, not only the pre-dialogue action candidate",
);
assert.match(
  yan.interactionInput?.observedVisibleAction || "",
  /证据不能走/,
  "responder should observe the initiator's later counter turn as part of the causal input",
);
assert.deepEqual(
  shen.spokenDialogues?.map((turn) => turn.line),
  ["按城法扣契，不按宗门私仇。", "剑可以停，证据不能走。"],
  "initiator should keep all of its spoken turns for memory and state updates",
);
assert.doesNotMatch(
  `${shen.visibleAction}\n${yan.visibleAction}`,
  /。。/,
  "dialogue merge should not create doubled sentence punctuation",
);
assert.doesNotMatch(
  `${shen.visibleAction}\n${yan.visibleAction}`,
  /。”。/,
  "dialogue merge should not add an extra sentence stop after a quoted line",
);

console.log("modelAgentOutputUsesExchangeDialogue:test passed", {
  shen: shen.visibleAction,
  yan: yan.visibleAction,
});
