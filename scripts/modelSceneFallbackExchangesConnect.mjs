import assert from "node:assert/strict";
import { normalizeSceneInteraction } from "../src/server/pipeline/sceneInteractionSimulator.mjs";

const privateSimulations = [
  { characterId: "char_shen", characterName: "沈珩", targetCharacterId: "char_yan", targetCharacterName: "阎无咎" },
  { characterId: "char_yan", characterName: "阎无咎", targetCharacterId: "char_shen", targetCharacterName: "沈珩" },
  { characterId: "char_lu", characterName: "鹿青萝", targetCharacterId: "char_shen", targetCharacterName: "沈珩" },
];

const parsed = {
  sceneText: "",
  agentExchanges: [
    {
      sourceCharacterId: "char_shen",
      responseCharacterId: "char_yan",
      sourceCharacterName: "沈珩",
      responseCharacterName: "阎无咎",
      sharedObject: "灵契",
      dialogueTurns: [
        { speakerId: "char_shen", speakerName: "沈珩", targetId: "char_yan", targetName: "阎无咎", line: "灵契先压在铜盘里；谁碰过它，谁站到界石前。", turnRole: "claim" },
        { speakerId: "char_yan", speakerName: "阎无咎", targetId: "char_shen", targetName: "沈珩", line: "灵契进账以前，你敢把价码和旧案分开说吗？", turnRole: "response" },
        { speakerId: "char_shen", speakerName: "沈珩", targetId: "char_yan", targetName: "阎无咎", line: "我先答证据；灵契留在铜盘，谁碰过它谁站出来。", turnRole: "counter" },
      ],
      eventOutcome: "阎无咎按住灵契，沈珩递出的手没有落下；灵契仍停在两人之间。",
      relationshipDeltas: [],
    },
    {
      sourceCharacterId: "char_lu",
      responseCharacterId: "char_shen",
      sourceCharacterName: "鹿青萝",
      responseCharacterName: "沈珩",
      sharedObject: "灵契",
      dialogueTurns: [
        { speakerId: "char_lu", speakerName: "鹿青萝", targetId: "char_shen", targetName: "沈珩", line: "庇护牌亮着就先护人，灵契留给界石，案卷慢一步。", turnRole: "claim" },
        { speakerId: "char_shen", speakerName: "沈珩", targetId: "char_lu", targetName: "鹿青萝", line: "庇护牌不离开这里，伤者的名字你敢写进账册吗？", turnRole: "response" },
        { speakerId: "char_lu", speakerName: "鹿青萝", targetId: "char_shen", targetName: "沈珩", line: "我只答伤口；庇护牌和灵契不能离开铜盘，审讯也不能绕过见证。", turnRole: "counter" },
      ],
      eventOutcome: "鹿青萝伸手碰到庇护牌，没有把它收走。",
      relationshipDeltas: [],
    },
  ],
};

const normalized = normalizeSceneInteraction(parsed, privateSimulations, { perCharacter: [] });
const text = normalized.sceneText || "";

assert.match(
  text,
  /鹿青萝[^。！？]{0,36}(?:听见|接住|打断|插进|刚才|前一句)[^。！？]{0,48}阎无咎|鹿青萝[^。！？]{0,48}(?:听见|接住|打断|插进|刚才|前一句)/,
  `model fallback sceneText should connect the second exchange to the previous one, got:\n${text}`,
);
assert.doesNotMatch(
  text,
  /鹿青萝和沈珩停在灵契旁边。\s*鹿青萝说/,
  `model fallback sceneText should not reopen the second exchange as an isolated pair scene, got:\n${text}`,
);

console.log("modelSceneFallbackExchangesConnect:test passed", {
  sceneText: text,
});
