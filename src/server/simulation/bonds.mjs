// How people come to stand with one another, kept by each of them. The first
// time someone really deals with you — speaks to you, hands you something,
// lays hands on you — you hold a place for them, even if no one wrote one at
// the start. What they then do to you leaves a mark: a blow, a grab, a thing
// of yours taken breeds resentment and fear; a thing handed over warms you
// and leaves you owing them. What you feel about them is kept as a short
// history rather than overwritten, and you may come to call what is between
// you something else. The numbers move slowly; a bond written at the start
// still counts for most of what you feel.
const clean = (value) => String(value ?? "").trim();
const list = (value) => (Array.isArray(value) ? value : []);
const clamp100 = (value) => Math.min(100, Math.max(0, Math.round(value)));

export const MET_LABEL = "打过交道的人";
export const HISTORY_KEEP = 6;
/** How a fact moves what one person holds toward another (0–100 scales). */
export const MARKS = Object.freeze({
  laid_hands: { resentment: 12, fear: 6, love: -4 },
  took_mine: { resentment: 8, love: -3 },
  gave_me: { love: 4, dependence: 2 },
});

function newBond(ownerId, other, nowSeconds) {
  return {
    id: `rel_met_${clean(ownerId)}_to_${clean(other.id)}`, schemaVersion: 1, generatedFrom: "met-in-world",
    fromCharacterId: clean(ownerId), toCharacterId: clean(other.id), toCharacterName: clean(other.name),
    label: MET_LABEL, addressingRule: "", allowedAddresses: [],
    love: 0, attraction: 0, resentment: 0, fear: 0, dependence: 0, power: 0, shame: 0, jealousy: 0, protection: 0,
    revenge: 0, deception: 0, wantsToBeSeen: 0, wantsToPossess: 0, wantsToEscape: 0, wantsToDestroy: 0,
    misreading: "", unspoken: "", evidenceIds: [], authority: "character-owned-relationship-memory",
    metAtSeconds: Number(nowSeconds || 0), history: [], owes: 0,
  };
}

function ensure(rows, ownerId, other, nowSeconds) {
  let row = rows.find((r) => clean(r.toCharacterId) === clean(other.id));
  if (!row) { row = newBond(ownerId, other, nowSeconds); rows.push(row); }
  if (!Array.isArray(row.history)) row.history = [];
  if (!Number.isFinite(Number(row.owes))) row.owes = 0;
  return row;
}
function remember(row, text, atSeconds) {
  if (!clean(text)) return;
  row.history = [...list(row.history), { atSeconds: Number(atSeconds || 0), text: clean(text) }].slice(-HISTORY_KEEP);
}
function mark(row, marks) {
  for (const [key, delta] of Object.entries(marks)) row[key] = clamp100(Number(row[key] || 0) + delta);
}

/** What one evidence row says another person did to the owner: { kind, byId, text } or null. */
export function whatTheyDid(row = {}, ownerId = "") {
  const byId = clean(row.sourceCharacterId);
  if (!byId || byId === clean(ownerId)) return null;
  const type = clean(row.type);
  if (type === "confrontation" && row.directed === true) return { kind: "laid_hands", byId, text: clean(row.content) };
  const handling = row.semanticFrame?.objectHandling;
  if (type === "object_handling" && handling) {
    if (clean(handling.operation) === "transfer" && clean(handling.toCharacterId) === clean(ownerId)) return { kind: "gave_me", byId, text: clean(row.content) };
    if (handling.tookFromRecipient === true) return { kind: "took_mine", byId, text: clean(row.content) };
    return null;
  }
  if (row.directed === true && ["speech", "marriage"].includes(type)) return { kind: "spoke_to_me", byId, text: "" };
  return null;
}

/**
 * Grow the owner's bonds from what reached them this beat. `impacts` are the
 * evidence rows (type, directed, sourceCharacterId, content, semanticFrame);
 * `people` are { id, name } the owner can tell apart by now; `applied` is the
 * evidence already counted. Returns { rows, applied, changed }.
 */
export function growBonds(previousRows = [], { ownerId = "", impacts = [], people = [], applied = [], nowSeconds = 0 } = {}) {
  const rows = list(previousRows).map((row) => ({ ...row, history: list(row.history).map((h) => ({ ...h })) }));
  const seen = new Set(list(applied).map(clean));
  const named = new Map(list(people).filter((p) => clean(p.id) && clean(p.name)).map((p) => [clean(p.id), { id: clean(p.id), name: clean(p.name) }]));
  let changed = false;
  for (const row of impacts || []) {
    const id = clean(row.evidenceId);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const did = whatTheyDid(row, ownerId);
    if (!did || !named.has(did.byId)) continue;
    const bond = ensure(rows, ownerId, named.get(did.byId), nowSeconds);
    const at = Number(row.occurredAtSeconds ?? nowSeconds);
    if (MARKS[did.kind]) mark(bond, MARKS[did.kind]);
    if (did.kind === "gave_me") bond.owes = Number(bond.owes || 0) + 1;
    remember(bond, did.text, at);
    changed = true;
  }
  return { rows, applied: [...seen].slice(-160), changed };
}

/**
 * What the owner wrote down this beat about someone: a feeling (kept in the
 * history) or what they now call the bond (`kind: "bond"` replaces the label).
 * `notes` are { kind, aboutId, aboutName, text }.
 */
export function noteBonds(previousRows = [], { ownerId = "", notes = [], nowSeconds = 0 } = {}) {
  const rows = list(previousRows).map((row) => ({ ...row, history: list(row.history).map((h) => ({ ...h })) }));
  let changed = false;
  for (const note of notes || []) {
    const id = clean(note.aboutId), text = clean(note.text);
    if (!id || id === clean(ownerId) || !text || !["feeling", "bond"].includes(clean(note.kind))) continue;
    const bond = ensure(rows, ownerId, { id, name: clean(note.aboutName) }, nowSeconds);
    if (clean(note.kind) === "bond") { bond.label = text.slice(0, 24); remember(bond, `你觉得你们俩如今是：${text}`, nowSeconds); }
    else remember(bond, `你对对方：${text}`, nowSeconds);
    changed = true;
  }
  return { rows, changed };
}

const COUNT = ["", "一份", "两份", "三份", "好几份"];
/** The extra words for a bond in 【你和这些人】: the last two things between you, and what you owe. */
export function bondNotes(row = {}) {
  const parts = [];
  const recent = list(row.history).slice(-2).map((h) => clean(h.text).replace(/。$/u, "")).filter(Boolean);
  if (recent.length) parts.push(`你们之间最近：${recent.join("；")}。`);
  const owes = Number(row.owes || 0);
  if (owes > 0) parts.push(`你欠着对方${COUNT[Math.min(owes, 4)]}人情。`);
  return parts.join("");
}
