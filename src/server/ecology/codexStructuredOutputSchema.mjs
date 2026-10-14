/** Codex strict JSON requires every object property to be listed in required. */
export function buildCodexStrictOutputSchema(schema = {}) {
  const output = structuredClone(schema);
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "object" && node.properties) {
      const optional = new Set(node.optionalProperties || []);
      node.additionalProperties = false;
      node.required = Object.keys(node.properties);
      delete node.optionalProperties;
      for (const [key, child] of Object.entries(node.properties)) {
        visit(child);
        if (optional.has(key)) {
          node.properties[key] = {
            description: `${child.description || ""} 不适用或需要省略此可选字段时返回 null。`.trim(),
            anyOf: [child, { type: "null" }],
          };
        }
      }
    }
    if (node.items) visit(node.items);
    for (const branch of node.anyOf || []) visit(branch);
    for (const branch of node.oneOf || []) visit(branch);
  };
  visit(output);
  return output;
}

/** Restore only explicitly optional nulls to omission before domain validation. */
export function restoreCodexOptionalFields(value, schema = {}) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(item => restoreCodexOptionalFields(item, schema.items || {}));
  const optional = new Set(schema.optionalProperties || []);
  return Object.fromEntries(Object.entries(value)
    .filter(([key, child]) => !(child === null && optional.has(key)))
    .map(([key, child]) => [key, restoreCodexOptionalFields(child, schema.properties?.[key] || {})]));
}
