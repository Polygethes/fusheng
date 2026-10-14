export const PHYSICAL_ACTION_RULE = "interact 对物品仅表示触碰，不是劈柴、装水、倒水、备餐或验收。实际做工、服务和验收使用相应 affordance 给出的 attemptPrimitive 与 actionBinding；先读 operation、physicalPrerequisites 和 expectedDurationSeconds。开始、就绪、完成是不同结果。intention、bodyDelta、对白和主观进展都不会改变物品。";

// Validate only the authored operation identity, never infer intent from prose
// or substitute an action for the Character Agent.
export function validateCapabilityActionBinding(candidate = {}, affordances = [], path = "candidate") {
  const binding = candidate.actionBinding || {};
  if (candidate.attemptPrimitive === "use_affordance" && affordances.some(row => row.attemptPrimitive)
    && !["affordance", "position"].includes(binding.kind)) return [{
    code: "AGENT_CANDIDATE_CAPABILITY_BINDING_REQUIRED", path: `${path}.actionBinding`,
    message: "Use the actual operation's affordance binding. Naming its object alone does not specify work, preparation or acceptance.",
  }];
  const offer = affordances.find(row => row.id === binding.affordanceId && row.attemptPrimitive);
  if (!offer || binding.kind !== "affordance" || candidate.attemptPrimitive === offer.attemptPrimitive) return [];
  return [{ code: "AGENT_CANDIDATE_CAPABILITY_PRIMITIVE_MISMATCH", path: `${path}.attemptPrimitive`,
    message: `This operation requires ${offer.attemptPrimitive} with its affordance binding. Generic contact cannot execute it.`,
    affordanceId: offer.id, requiredPrimitive: offer.attemptPrimitive }];
}
