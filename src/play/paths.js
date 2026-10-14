// Reading and writing a blueprint by the same paths validateBlueprint reports
// ("residents[2].desires[0].object"), so a problem in the list can take the
// player straight to the field that fixes it.
export function parsePath(path = "") {
  const parts = [];
  for (const piece of String(path).split(".")) {
    const match = piece.match(/^([^[\]]*)((?:\[\d+\])*)$/u);
    if (!match) throw Object.assign(new Error(`路径写法不对：${path}`), { code: "PATH_INVALID" });
    if (match[1]) parts.push(match[1]);
    for (const index of match[2].matchAll(/\[(\d+)\]/gu)) parts.push(Number(index[1]));
  }
  return parts;
}

export function getAt(value, path) {
  let current = value;
  for (const key of parsePath(path)) {
    if (current == null) return undefined;
    current = current[key];
  }
  return current;
}

/** A copy with one value replaced; the original is never changed. */
export function setAt(value, path, next) {
  const keys = parsePath(path);
  if (!keys.length) return next;
  const copy = Array.isArray(value) ? [...value] : { ...(value || {}) };
  const [head, ...rest] = keys;
  copy[head] = rest.length ? setAt(copy[head] ?? (typeof rest[0] === "number" ? [] : {}), rest.map((key, i) => (typeof key === "number" ? `[${key}]` : `${i ? "." : ""}${key}`)).join(""), next) : next;
  return copy;
}

/** The deepest field path the page has an input for, given a reported path. */
export function nearestField(reportedPath, fieldPaths) {
  const fields = new Set(fieldPaths);
  let path = String(reportedPath);
  while (path) {
    if (fields.has(path)) return path;
    const cut = Math.max(path.lastIndexOf("."), path.lastIndexOf("["));
    if (cut <= 0) break;
    path = path.slice(0, cut);
  }
  return fields.has(path) ? path : null;
}
