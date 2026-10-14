import assert from "node:assert/strict";
import { normalizeSceneInteraction } from "../src/server/pipeline/sceneInteractionSimulator.mjs";
import { buildCanonicalSceneSource } from "../src/server/pipeline/novelStreamer.mjs";

const compact = {
  selectedLocation: { id: "water", name: "储水区" },
  availableLocations: [{ id: "water", name: "储水区" }, { id: "warehouse", name: "探险队仓库" }],
  activeCharacters: [{ id: "mela", name: "梅拉" }, { id: "lily", name: "莉莉" }],
  relationships: [],
};
const simulations = [
  { characterId: "mela", characterName: "梅拉", targetCharacterId: "lily", targetCharacterName: "莉莉", presenceIntent: "stay", exitUrgency: 10, exitResistance: 70, pressure: 68 },
  { characterId: "lily", characterName: "莉莉", targetCharacterId: "mela", targetCharacterName: "梅拉", presenceIntent: "stay", exitUrgency: 20, exitResistance: 65, pressure: 72 },
];
const repeatedLine = "储水区的水位每天下降一指，而蜥蜴的血是咸的。你想让下一代喝什么？";
const parsed = {
  surfaceEvent: "水位线退到旧苔痕下面。",
  sceneText: "",
  agentExchanges: [{
    sourceCharacterId: "mela", responseCharacterId: "lily", sharedObject: "沙漏",
    dialogueTurns: [
      { speakerId: "mela", speakerName: "梅拉", targetId: "lily", targetName: "莉莉", line: repeatedLine },
      { speakerId: "lily", speakerName: "莉莉", targetId: "mela", targetName: "梅拉", line: "那就去找昨天信号弹落下的地方。" },
      { speakerId: "mela", speakerName: "梅拉", targetId: "lily", targetName: "莉莉", line: repeatedLine.replace(/？$/, "。") },
      { speakerId: "lily", speakerName: "莉莉", targetId: "mela", targetName: "梅拉", line: "沙漏已经留了3轮，这次你不能只把话推回去。" },
      { speakerId: "mela", speakerName: "梅拉", targetId: "lily", targetName: "莉莉", line: "日落前把路线画出来，我跟你去。" },
    ],
    eventOutcome: "梅拉把沙漏留在水位线旁。", relationshipDeltas: [],
  }],
};

const normalized = normalizeSceneInteraction(parsed, simulations, { perCharacter: [] }, compact);
const turns = normalized.agentExchanges.flatMap((exchange) => exchange.dialogueTurns || []);
const melaWaterLines = turns.filter((turn) => turn.speakerId === "mela" && /下一代喝什么/.test(turn.line));
assert.equal(melaWaterLines.length, 1, "punctuation changes must not bypass same-speaker semantic deduplication");
assert.ok(!turns.some((turn) => /(?:\d+|几|多)轮|上一轮|未结清|把话推回去/.test(turn.line)), "backend turn-management language must not enter spoken dialogue");

const source = buildCanonicalSceneSource(compact, normalized);
assert.equal(source.dialogue.filter((turn) => /下一代喝什么/.test(turn.line)).length, 1);
assert.ok(!JSON.stringify(source).includes("3轮"));

console.log("modelSceneDialogueSemanticDedup:test passed", { turns: turns.map((turn) => turn.line) });
