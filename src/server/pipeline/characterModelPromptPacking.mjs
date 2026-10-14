// A transport representation of one already-projected character input. This
// never retrieves facts, changes source ids, summarizes prose or edits output.
const REFERENCE_KEY = "$contextRef";
const ENCODING = "shared-json-v1";
const FORMATS = new Set(["expanded", "compact", "shared"]);
const bytes = text => new TextEncoder().encode(text).length;
const normalize = value => JSON.parse(JSON.stringify(value));
const isReference = value => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).length === 1 && Object.hasOwn(value, REFERENCE_KEY);
const mapChildren = (value, visit) => Array.isArray(value)
  ? value.map(visit)
  : Object.fromEntries(Object.entries(value).map(([key, child]) => [key, visit(child)]));
const SHARING_RULE = '输入采用无损共享 JSON：stageInput 是完整私人输入；其中仅有 "$contextRef" 字段的对象，等于本段 shared 中对应项的完整值；递归展开即可还原，数组顺序与每处原文不变。共享标签在每条消息中重新定义，不得沿用其他阶段的对应关系。它们只表示重复数据，不是人物、证据、候选或心理来源 ID；输出仍逐字使用展开后的原始 ID 和原有 Schema。所有内容都在本段内，无需工具或外部查询。';

export function resolveCharacterPromptFormat(value = "shared") {
  if (!FORMATS.has(value)) {
    const error = new TypeError(`Character prompt format must be expanded, compact or shared; received ${String(value)}.`);
    error.code = "CHARACTER_PROMPT_FORMAT_UNSUPPORTED";
    throw error;
  }
  return value;
}

export function packCharacterContext(value) {
  const input = normalize(value);
  const plain = { encoding: "plain-json-v1", stageInput: input, shared: {} };
  const counts = new Map(), serialized = new WeakMap();
  let collision = false;
  function count(node) {
    if (!node || typeof node !== "object") return;
    if (isReference(node)) collision = true;
    const text = JSON.stringify(node);
    serialized.set(node, text);
    if (text.length >= 256) counts.set(text, (counts.get(text) || 0) + 1);
    for (const child of Object.values(node)) count(child);
  }
  count(input);
  if (collision) return plain;
  const names = new Map();
  let shared = {};
  function encode(node) {
    if (!node || typeof node !== "object") return node;
    const text = serialized.get(node);
    if ((counts.get(text) || 0) < 2) return mapChildren(node, encode);
    if (!names.has(text)) {
      const name = `s${names.size + 1}`;
      names.set(text, name);
      shared[name] = mapChildren(node, encode);
    }
    return { [REFERENCE_KEY]: names.get(text) };
  }
  let stageInput = encode(input);
  // Sharing a parent can leave a child used only once. Inline those entries so
  // the model does not have to follow needless chains through the dictionary.
  while (Object.keys(shared).length) {
    const uses = new Map();
    function countUses(node) {
      if (!node || typeof node !== "object") return;
      if (isReference(node)) { uses.set(node[REFERENCE_KEY], (uses.get(node[REFERENCE_KEY]) || 0) + 1); return; }
      for (const child of Object.values(node)) countUses(child);
    }
    countUses(stageInput);
    for (const entry of Object.values(shared)) countUses(entry);
    const singles = new Set(Object.keys(shared).filter(name => (uses.get(name) || 0) <= 1));
    if (!singles.size) break;
    function inline(node) {
      if (!node || typeof node !== "object") return node;
      if (isReference(node) && singles.has(node[REFERENCE_KEY])) return inline(shared[node[REFERENCE_KEY]]);
      return mapChildren(node, inline);
    }
    stageInput = inline(stageInput);
    shared = Object.fromEntries(Object.entries(shared).filter(([name]) => !singles.has(name))
      .map(([name, entry]) => [name, inline(entry)]));
  }
  const packed = { encoding: ENCODING, shared, stageInput };
  // Include the model's explanation cost. For small or unique inputs, plain
  // compact JSON is both cheaper and easier to read than a reference envelope.
  return Object.keys(shared).length
    && bytes(JSON.stringify(packed)) + bytes(SHARING_RULE) + 256 < bytes(JSON.stringify(input))
    ? packed : plain;
}

/** Diagnostic inverse, also used by offline replay. Never parses model output. */
export function unpackCharacterContext(packet) {
  if (packet?.encoding === "plain-json-v1") return normalize(packet.stageInput);
  if (packet?.encoding !== ENCODING) throw new TypeError("Unknown character context encoding.");
  const active = new Set();
  function expand(node) {
    if (!node || typeof node !== "object") return node;
    if (isReference(node)) {
      const name = node[REFERENCE_KEY];
      if (!Object.hasOwn(packet.shared, name)) throw new TypeError(`Unknown context reference ${String(name)}.`);
      if (active.has(name)) throw new TypeError("Cyclic context reference.");
      active.add(name);
      const result = expand(packet.shared[name]);
      active.delete(name);
      return result;
    }
    return mapChildren(node, expand);
  }
  return expand(packet.stageInput);
}

export function formatCharacterContextForPrompt(input, format = "shared") {
  resolveCharacterPromptFormat(format);
  if (format === "expanded") return JSON.stringify(input, null, 2);
  if (format === "compact") return JSON.stringify(input);
  const packed = packCharacterContext(input);
  return packed.encoding === ENCODING
    ? `${SHARING_RULE}\n${JSON.stringify(packed)}`
    : JSON.stringify(input);
}
