// In the one-call modes a person learns a stranger's name by hearing it: the
// stranger says it, or someone calls them by it, while the listener can see
// them. The first form heard is the one kept.
const GENERIC = new Set(["爹", "娘", "爷爷", "奶奶", "先生", "婆婆", "大夫", "师父", "哥", "姐", "叔", "婶", "嫂", "娃", "孩子"]);
const clean = (value) => String(value ?? "").trim();

/** characterId → the ways people call them: the full name first, then others' forms of address, longest first. */
export function nameFormsByCharacter(pack = {}) {
  const forms = new Map();
  for (const member of pack.cast || []) {
    const id = clean(member.id);
    const name = clean(member.name);
    if (!id) continue;
    const others = (pack.relationships || [])
      .filter((rel) => clean(rel.toCharacterId) === id)
      .flatMap((rel) => rel.allowedAddresses || [])
      .map(clean)
      .filter((form) => form.length >= 2 && !GENERIC.has(form) && form !== name);
    forms.set(id, [...(name ? [name] : []), ...[...new Set(others)].sort((a, b) => b.length - a.length)]);
  }
  return forms;
}

/**
 * turns: [{ speakerId, utterance }]，speakerId 是世界里的人物 id，按时间先后排好；
 * visibleIds: 听的人此刻看得见的人（世界 id），顺序就是返回结果的顺序；
 * knownIds: 已经认识的人；learned: 已经学到的 [{ characterId, name }]。
 * 返回新学到的 [{ characterId, name }]。
 */
export function learnNamesFromTurns({ turns = [], visibleIds = [], formsById = new Map(), knownIds = [], learned = [] } = {}) {
  const visible = (visibleIds || []).map(clean).filter(Boolean);
  const settled = new Set([...(knownIds || []).map(clean), ...(learned || []).map((row) => clean(row?.characterId))]);
  const found = [];
  for (const turn of turns || []) {
    const utterance = clean(turn?.utterance);
    if (!utterance || !visible.includes(clean(turn?.speakerId))) continue;
    for (const id of visible) {
      if (settled.has(id)) continue;
      const name = (formsById.get(id) || []).find((form) => utterance.includes(form));
      if (!name) continue;
      found.push({ characterId: id, name });
      settled.add(id);
    }
  }
  return found;
}
