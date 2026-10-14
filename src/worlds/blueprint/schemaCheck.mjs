// A small JSON Schema checker for the blueprint: the first gate for model
// drafts (P5) and player edits (P6). It covers exactly the keywords that
// schema.mjs uses, and reports JSON paths the review page can jump to.

const typeOf = (value) => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
};

const matchesType = (value, type) => {
  const actual = typeOf(value);
  return actual === type || (type === "number" && actual === "integer");
};

const join = (path, key) => (typeof key === "number" ? `${path}[${key}]` : path ? `${path}.${key}` : key);

export function checkAgainstSchema(value, schema, path = "", out = []) {
  if (!schema || typeof schema !== "object") return out;
  const add = (message) => out.push({ path, message });

  if (schema.anyOf) {
    const fits = schema.anyOf.some((option) => !checkAgainstSchema(value, option, path, []).length);
    if (!fits) add(`${path || "值"} 不符合允许的任何一种写法。`);
    return out;
  }
  if (schema.const !== undefined && value !== schema.const) { add(`${path} 必须是 ${JSON.stringify(schema.const)}。`); return out; }
  if (schema.type && !matchesType(value, schema.type)) { add(`${path || "值"} 应该是 ${schema.type}，现在是 ${typeOf(value)}。`); return out; }
  if (schema.enum && !schema.enum.includes(value)) { add(`${path} 只能是 ${schema.enum.join(" / ")} 之一。`); return out; }

  if (typeof value === "string") {
    if (typeof schema.maxLength === "number" && [...value].length > schema.maxLength) add(`${path} 超过 ${schema.maxLength} 字（现在 ${[...value].length} 字）。`);
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) add(`${path} 格式不对：${value}`);
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) add(`${path} 不能小于 ${schema.minimum}。`);
    if (typeof schema.maximum === "number" && value > schema.maximum) add(`${path} 不能大于 ${schema.maximum}。`);
  }
  if (Array.isArray(value)) {
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) add(`${path} 最多 ${schema.maxItems} 项（现在 ${value.length} 项）。`);
    if (typeof schema.minItems === "number" && value.length < schema.minItems) add(`${path} 至少 ${schema.minItems} 项。`);
    if (schema.items) value.forEach((item, index) => checkAgainstSchema(item, schema.items, join(path, index), out));
  }
  if (typeOf(value) === "object") {
    for (const key of schema.required || []) if (!(key in value)) out.push({ path: join(path, key), message: `缺少 ${join(path, key)}。` });
    const known = schema.properties || {};
    for (const [key, child] of Object.entries(value)) {
      if (known[key]) checkAgainstSchema(child, known[key], join(path, key), out);
      else if (schema.additionalProperties === false) out.push({ path: join(path, key), message: `${join(path, key)} 不是蓝图里的字段。` });
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") checkAgainstSchema(child, schema.additionalProperties, join(path, key), out);
    }
  }
  return out;
}
