import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tavernCausalAgentSystemPrompt } from "../src/server/pipeline/tavernCausalScene.mjs";

const fixedStoryNames = /(?:周珉|真石|谢家)/u;
const systemPrompt = tavernCausalAgentSystemPrompt({
  agent: {
    id: "actor_alpha",
    name: "人物甲",
    voiceContract: {
      voiceFormation: { sourceOrder: ["人格", "当下状态", "关系", "表达策略"] },
      personalityVoice: { attentionPriorities: [], appraisalHabits: [] },
      expressionTendencies: { thoughtMovement: [], pressureResponse: {} },
      relationshipRegisters: {},
    },
  },
});

assert.doesNotMatch(
  systemPrompt,
  fixedStoryNames,
  "the reusable runtime prompt must not inject names from the current Xiaoyaoyou cast",
);
assert.match(
  systemPrompt,
  /实际称呼可以因误认、挑衅、玩笑或记忆错误而不同/u,
  "the reusable prompt must distinguish intended audience from the words a fallible or strategic person actually uses",
);
assert.doesNotMatch(
  systemPrompt,
  /对话目标设为一人却使用只属于另一人的姓名或关系称谓/u,
  "target/address mismatch must no longer be a hard speech censor",
);

const runtimeSourcePath = fileURLToPath(new URL("../src/server/pipeline/tavernCausalScene.mjs", import.meta.url));
const runtimeSource = await readFile(runtimeSourcePath, "utf8");
assert.doesNotMatch(
  runtimeSource,
  fixedStoryNames,
  "runtime prompt and validation code must not contain fixed cast or family examples",
);
assert.match(
  runtimeSource,
  /MATERIAL_LODGING_ZONE_CONTRADICTION[\s\S]{0,240}空间拓扑不一致/u,
  "lodging contradictions must be explained as a topology violation, not a family-specific fact",
);

console.log("tavernPhase59GenericRuntimeLanguage:test passed");
