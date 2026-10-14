const clean = value => String(value ?? "").trim();

// A recipient's stable perception handle is sufficient to recognize the
// source of an encounter. Knowing that person's canonical identity is not.
export function isFirsthandRelationshipEvidence(row = {}, targetHandle = "") {
  const target = clean(targetHandle);
  if (!target || ["gossip", "reported", "sourced_report"].includes(clean(row.provenance?.kind).toLowerCase())) return false;
  return [row.sourceEntityHandle, row.sourceCharacterId, ...Object.values(row.semanticFrame?.roles || {})]
    .some(value => clean(value) === target);
}
