// Relationship compiler for Town scale (Task P2.4)
import { TAVERN_RELATIONSHIP_METRICS } from "../../server/ecology/tavernRelationshipDynamics.mjs";

export function compileRelationships(blueprint, idMap) {
  const relationships = blueprint.relationships || [];
  const residents = blueprint.residents || [];
  const compiled = [];

  for (const rel of relationships) {
    const fromId = idMap.get(rel.from) || rel.from;
    const toId = idMap.get(rel.to) || rel.to;

    const fromRes = residents.find((r) => r.id === rel.from);
    const toRes = residents.find((r) => r.id === rel.to);
    const fromName = fromRes?.name || rel.from;
    const toName = toRes?.name || rel.to;

    // Build complete 13 metrics
    const metrics = {};
    for (const key of TAVERN_RELATIONSHIP_METRICS) {
      metrics[key] = rel.feelings?.[key] ?? 0;
    }

    const addresses = Array.isArray(rel.address) ? rel.address : [];
    const addrText = addresses.join("“、“");
    const addressingRule = addresses.length > 0 ? `${fromName}对${toName}称“${addrText}”。` : "";

    compiled.push({
      fromCharacterId: fromId,
      toCharacterId: toId,
      label: rel.label,
      allowedAddresses: addresses,
      addressingRule,
      metrics,
      unspoken: rel.unspoken || "",
      misreading: rel.misreading || "",
      pressure: rel.pressure || "",
    });
  }

  return compiled;
}
