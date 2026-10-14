// Resolves a phrase from a resident card (a desire's object or outcome) to
// something real in the town: an object, a resident, or a site. Shared by the
// compiler (desire targets) and validateBlueprint (B4), so both agree.

// Longest run of characters two strings share; "东街铺子" and "东街集市" share "东街".
function commonRun(a, b) {
  const x = [...a], y = [...b];
  let best = 0;
  for (let i = 0; i < x.length; i += 1) {
    for (let j = 0; j < y.length; j += 1) {
      let k = 0;
      while (x[i + k] !== undefined && x[i + k] === y[j + k]) k += 1;
      if (k > best) best = k;
    }
  }
  return best;
}

function candidatesOf({ residents, sites, objects, owner, relationships, catalog }) {
  const rows = [];
  for (const obj of objects) rows.push({ type: "object", id: obj.id, label: obj.name || obj.label || obj.id, names: [obj.name || obj.label].filter(Boolean) });
  for (const res of residents) if (res.id !== owner?.id) rows.push({ type: "character", id: res.id, label: res.name, names: [res.name].filter(Boolean) });
  // What the owner calls people ("爹", "二子") points at them.
  for (const rel of relationships.filter((row) => row.from === owner?.id)) {
    const target = residents.find((res) => res.id === rel.to);
    if (target) rows.push({ type: "character", id: target.id, label: target.name, names: (rel.address || []).filter(Boolean), exactOnly: true });
  }
  for (const site of sites) {
    const typeLabels = String((catalog?.[site.type] || {}).label || "").split(/[/、\s]+/u).filter(Boolean);
    rows.push({ type: "site", id: site.id, label: site.name, names: [site.name, ...typeLabels].filter(Boolean) });
  }
  return rows;
}

export function resolveReference(text, { residents = [], sites = [], objects = [], owner = null, relationships = [], catalog = null, alsoText = "" } = {}) {
  const phrases = [text, alsoText].filter((row) => typeof row === "string" && row.trim());
  if (!phrases.length) return null;
  const rows = candidatesOf({ residents, sites, objects, owner, relationships, catalog });
  const hit = (row) => ({ type: row.type, id: row.id, label: row.label });

  // 1. A name written out in full, in the object phrase first, then the outcome.
  for (const phrase of phrases) {
    for (const row of rows) if (row.names.some((name) => phrase.includes(name) || (row.type !== "character" && name.includes(phrase)))) return hit(row);
  }
  // 2. Otherwise the candidate sharing the longest run of at least two characters.
  let best = null, bestRun = 1;
  for (const phrase of phrases) {
    for (const row of rows.filter((item) => !item.exactOnly)) {
      for (const name of row.names) {
        const run = commonRun(phrase, name);
        if (run > bestRun) { best = row; bestRun = run; }
      }
    }
    if (best) return hit(best);
  }
  return null;
}
