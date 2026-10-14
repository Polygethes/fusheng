import { tavernCharacterAgentV2SystemPrompt, tavernCharacterAgentV2UserPrompt } from "./tavernCharacterAgentV2.mjs";

// One canonical, lossless presentation for an external model. In particular,
// do not summarize away time, operation prerequisites, quantities or receipts.
export function buildV27RelayModelRequest(pending) {
  if (!pending) return null;
  return {
    stageId: pending.stageId, phase: pending.phase, characterId: pending.characterId, agentTurnId: pending.agentTurnId,
    provenance: pending.provenance, submissionContract: pending.submissionContract,
    contextFormat: "shared-json-v1-lossless",
    systemPrompt: tavernCharacterAgentV2SystemPrompt(pending.stageInput),
    userPrompt: tavernCharacterAgentV2UserPrompt(pending.stageInput, { format: "shared" }),
    schema: pending.schema,
  };
}
