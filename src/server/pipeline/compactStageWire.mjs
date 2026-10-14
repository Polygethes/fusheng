// compactStageWire: 深层心理输出的传输层压缩与还原。
// 发给模型前用短键并省去固定值和可空列表，模型返回后再还原成与 canonical 一字不差的完整对象。
// 只改传输表示，不改任何心理协议、校验规则或数值计算。

function isFixedValueField(subSchema) {
  if (!subSchema || typeof subSchema !== "object") return false;
  if ("const" in subSchema) return true;
  if (Array.isArray(subSchema.enum) && subSchema.enum.length === 1 && subSchema.type !== "array" && subSchema.type !== "object") {
    return true;
  }
  return false;
}

function getFixedValue(subSchema) {
  if (!subSchema || typeof subSchema !== "object") return undefined;
  if ("const" in subSchema) return subSchema.const;
  if (Array.isArray(subSchema.enum) && subSchema.enum.length === 1 && subSchema.type !== "array" && subSchema.type !== "object") {
    return subSchema.enum[0];
  }
  return undefined;
}

function isNullableArray(subSchema) {
  return Boolean(subSchema && typeof subSchema === "object" && subSchema.type === "array" && (subSchema.minItems === undefined || subSchema.minItems === 0));
}

function collectPropertyNames(schema) {
  const names = [];
  const seen = new Set();
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (node.properties && typeof node.properties === "object") {
      for (const propName of Object.keys(node.properties)) {
        if (!seen.has(propName)) {
          seen.add(propName);
          names.push(propName);
        }
      }
    }
    for (const val of Object.values(node)) visit(val);
  }
  visit(schema);
  return names;
}

function findChildSchema(node, key, parentInUnion) {
  if (!node || typeof node !== "object") {
    return { subSchema: null, inUnion: true };
  }
  if (node.properties && node.properties[key]) {
    return { subSchema: node.properties[key], inUnion: parentInUnion };
  }
  const unionBranches = [
    ...(Array.isArray(node.anyOf) ? node.anyOf : []),
    ...(Array.isArray(node.oneOf) ? node.oneOf : [])
  ];
  for (const branch of unionBranches) {
    if (branch && branch.properties && branch.properties[key]) {
      return { subSchema: branch.properties[key], inUnion: true };
    }
  }
  return { subSchema: null, inUnion: true };
}

function valuesEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

export function createCompactStageWire(schema) {
  const names = collectPropertyNames(schema);
  const allOriginalKeys = new Set(names);
  const usedShortKeys = new Set();
  const legend = [];
  const keyToShort = new Map();
  const shortToKey = new Map();

  for (const key of names) {
    if (key.length <= 5) {
      keyToShort.set(key, key);
      shortToKey.set(key, key);
      continue;
    }
    const segments = key.split(/(?=[A-Z])|_/).filter(Boolean);
    const base = segments.length === 1 ? segments[0].slice(0, 3).toLowerCase() : segments.map(s => s[0].toLowerCase()).join("");
    let short = base;
    let counter = 2;
    while (usedShortKeys.has(short) || allOriginalKeys.has(short)) {
      short = `${base}${counter}`;
      counter++;
    }
    usedShortKeys.add(short);
    legend.push({ short, key });
    keyToShort.set(key, short);
    shortToKey.set(short, key);
  }

  function transformSchema(node, inUnion) {
    if (node === null || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map(item => transformSchema(item, inUnion));

    const out = {};
    const originalRequired = Array.isArray(node.required) ? new Set(node.required) : null;
    let newProperties = null;
    let newRequired = null;

    if (node.properties && typeof node.properties === "object") {
      newProperties = {};
      newRequired = originalRequired !== null ? [] : null;
      for (const [key, propSchema] of Object.entries(node.properties)) {
        const isReq = originalRequired ? originalRequired.has(key) : false;
        if (!inUnion) {
          if (isReq && isFixedValueField(propSchema)) {
            continue;
          }
          if (isReq && isNullableArray(propSchema)) {
            const shortKey = keyToShort.get(key) ?? key;
            newProperties[shortKey] = transformSchema(propSchema, inUnion);
            continue;
          }
          const shortKey = keyToShort.get(key) ?? key;
          newProperties[shortKey] = transformSchema(propSchema, inUnion);
          if (isReq && newRequired) {
            newRequired.push(shortKey);
          }
        } else {
          const shortKey = keyToShort.get(key) ?? key;
          newProperties[shortKey] = transformSchema(propSchema, true);
          if (isReq && newRequired) {
            newRequired.push(shortKey);
          }
        }
      }
    }

    for (const [k, v] of Object.entries(node)) {
      if (k === "properties") {
        out.properties = newProperties;
      } else if (k === "required") {
        if (newRequired !== null) {
          out.required = newRequired;
        } else if (originalRequired !== null) {
          out.required = node.required.map(r => keyToShort.get(r) ?? r);
        }
      } else if (k === "anyOf") {
        out.anyOf = node.anyOf.map(b => transformSchema(b, true));
      } else if (k === "oneOf") {
        out.oneOf = node.oneOf.map(b => transformSchema(b, true));
      } else if (k === "items") {
        out.items = transformSchema(node.items, inUnion);
      } else {
        out[k] = structuredClone(v);
      }
    }
    return out;
  }

  const wireSchema = transformSchema(schema, false);

  function expand(wireValue) {
    function expandNode(val, schemaNode, inUnion) {
      if (val === null || typeof val !== "object") return val;
      if (Array.isArray(val)) {
        const itemSchema = schemaNode?.items ?? null;
        return val.map(item => expandNode(item, itemSchema, inUnion));
      }
      const result = {};
      for (const [wKey, wVal] of Object.entries(val)) {
        const canonicalKey = shortToKey.get(wKey) ?? wKey;
        const { subSchema, inUnion: childInUnion } = findChildSchema(schemaNode, canonicalKey, inUnion);
        result[canonicalKey] = expandNode(wVal, subSchema, childInUnion);
      }
      if (schemaNode && schemaNode.properties && !inUnion) {
        const required = Array.isArray(schemaNode.required) ? schemaNode.required : [];
        for (const reqKey of required) {
          if (!(reqKey in result)) {
            const propSchema = schemaNode.properties[reqKey];
            if (isFixedValueField(propSchema)) {
              result[reqKey] = structuredClone(getFixedValue(propSchema));
            } else if (isNullableArray(propSchema)) {
              result[reqKey] = [];
            }
          }
        }
      }
      return result;
    }
    return expandNode(wireValue, schema, false);
  }

  function compact(canonicalValue) {
    function compactNode(val, schemaNode, inUnion) {
      if (val === null || typeof val !== "object") return val;
      if (Array.isArray(val)) {
        const itemSchema = schemaNode?.items ?? null;
        return val.map(item => compactNode(item, itemSchema, inUnion));
      }
      const result = {};
      const requiredSet = new Set(Array.isArray(schemaNode?.required) ? schemaNode.required : []);
      for (const [key, childVal] of Object.entries(val)) {
        if (schemaNode && schemaNode.properties && key in schemaNode.properties && !inUnion && requiredSet.has(key)) {
          const propSchema = schemaNode.properties[key];
          if (isFixedValueField(propSchema) && valuesEqual(childVal, getFixedValue(propSchema))) {
            continue;
          }
          if (isNullableArray(propSchema) && Array.isArray(childVal) && childVal.length === 0) {
            continue;
          }
        }
        const shortKey = keyToShort.get(key) ?? key;
        const { subSchema, inUnion: childInUnion } = findChildSchema(schemaNode, key, inUnion);
        result[shortKey] = compactNode(childVal, subSchema, childInUnion);
      }
      return result;
    }
    return compactNode(canonicalValue, schema, false);
  }

  return { schema: wireSchema, legend, expand, compact };
}

export function compactWireLegendText(legend) {
  if (!legend || legend.length === 0) return "";
  const lines = [
    "输出用短键（只是为了少写字，意思和原名完全一样）。每行是“短键 = 原名”：",
    ...legend.map(({ short, key }) => `${short} = ${key}`)
  ];
  return lines.join("\n");
}

export function missingRequiredPaths(schema, value, path = "$") {
  if (value === null || typeof value !== "object") return [];
  if (!schema || typeof schema !== "object") return [];
  if (!schema.properties && (schema.anyOf || schema.oneOf)) {
    return [];
  }
  if (schema.properties && typeof schema.properties === "object") {
    if (typeof value !== "object" || Array.isArray(value)) return [];
    const missing = [];
    const requiredSet = new Set(Array.isArray(schema.required) ? schema.required : []);
    for (const [propKey, propSchema] of Object.entries(schema.properties)) {
      const propPath = `${path}.${propKey}`;
      const hasProp = Object.prototype.hasOwnProperty.call(value, propKey) && value[propKey] !== undefined;
      if (!hasProp) {
        if (requiredSet.has(propKey)) {
          missing.push(propPath);
        }
      } else {
        missing.push(...missingRequiredPaths(propSchema, value[propKey], propPath));
      }
    }
    return missing;
  }
  if (Array.isArray(value)) {
    const missing = [];
    const itemSchema = schema.items;
    if (itemSchema) {
      for (let i = 0; i < value.length; i++) {
        missing.push(...missingRequiredPaths(itemSchema, value[i], `${path}[${i}]`));
      }
    }
    return missing;
  }
  return [];
}
