// What wears a person down, kept by the person: what they tried and could not
// do (and how many times), how long since they last drank or ate, who laid
// hands on them; and how a thirsty, hungry, sleepy or hurting body frays the
// temper. Agitation from what happened fades by the hour; what the body feels
// is read fresh each beat. The person is told it in plain words — how they
// feel, what keeps going wrong, who did what — and decides for themselves
// whether to blame anyone, snap, or swallow it. Nothing here makes anyone act.
const clean = (value) => String(value ?? "").trim();
const clamp01 = (value) => Math.min(1, Math.max(0, value));
const list = (value) => (Array.isArray(value) ? value : []);

export const FADE_PER_HOUR = 0.2;
export const SETBACK_STING = 0.07;
export const SETBACK_STING_MAX = 0.3;
export const HURT_STING = 0.3;
const SETBACK_MEMORY_SECONDS = 2 * 3600;
const HURT_MEMORY_SECONDS = 3600;
const APPLIED_KEEP = 120;

/** A failure, as the person would put it to themselves. */
export const SETBACK_WORDS = Object.freeze({
  OBJECT_NOT_PORTABLE: "那东西太沉，搬不动",
  OBJECT_NOT_POSSESSED: "手里根本没拿着那东西",
  OBJECT_NOT_IN_HAND: "东西还没拿在手里",
  OBJECT_NOT_HELD: "那东西不在自己身上",
  SPEECH_TARGET_NOT_REACHED: "话没传到对方耳朵里",
  MOVE_HELD: "被人抓着，挣不脱",
  MOVE_BLOCKED_BY_FLOOD: "水太深，过不去",
  CONFRONT_TARGET_NOT_HERE: "对方不在身边",
  DRINK_NO_WATER_HERE: "身边没有水",
  DRINK_NOTHING_TO_DRINK: "里面没有能喝的",
  EAT_NOTHING_TO_EAT: "没有做好的饭",
  FILL_NO_WATER_HERE: "这里没有水可打",
  FILL_NOT_HELD: "手里没有能装水的东西",
  POUR_NOTHING_IN_HAND: "手里没有装着水的东西",
});
const wordsFor = (code) => SETBACK_WORDS[clean(code)] || "没做成";

export function emptyTemper() {
  return { agitation: 0, atSeconds: 0, setbacks: {}, hurts: [], lastDrankAtSeconds: null, lastAteAtSeconds: null, appliedEvidenceIds: [] };
}

const faded = (temper, nowSeconds) => clamp01(Number(temper.agitation || 0) - FADE_PER_HOUR * Math.max(0, nowSeconds - Number(temper.atSeconds || 0)) / 3600);

/**
 * Fold what reached the person since their last beat into their temper:
 * `impacts` are the evidence rows of this beat (type, content, directed,
 * sourceCharacterId, semanticFrame.actionResult for their own last action).
 * `nameOf(id)` names someone the person knows ("" when they do not).
 */
export function updateTemper(previous = null, { impacts = [], nowSeconds = 0, nameOf = () => "" } = {}) {
  const temper = { ...emptyTemper(), ...(previous || {}) };
  const applied = new Set(list(temper.appliedEvidenceIds));
  let agitation = faded(temper, nowSeconds);
  const setbacks = Object.fromEntries(Object.entries(temper.setbacks || {}).filter(([, row]) => nowSeconds - Number(row.lastAtSeconds || 0) <= SETBACK_MEMORY_SECONDS));
  const hurts = list(temper.hurts).filter((row) => nowSeconds - Number(row.atSeconds || 0) <= HURT_MEMORY_SECONDS);
  let { lastDrankAtSeconds, lastAteAtSeconds } = temper;
  for (const row of impacts || []) {
    const id = clean(row.evidenceId);
    if (!id || applied.has(id)) continue;
    applied.add(id);
    const at = Number(row.occurredAtSeconds ?? nowSeconds);
    const result = row.semanticFrame?.actionResult;
    if (clean(row.type) === "own_action_result" && result) {
      const primitive = clean(result.primitive);
      const kinds = list(result.resolvedEffectKinds).map(clean);
      if (kinds.includes("sustenance_drink")) lastDrankAtSeconds = at;
      if (kinds.includes("sustenance_eat")) lastAteAtSeconds = at;
      const codes = list(result.failureCodes).map(clean).filter(Boolean);
      if (clean(result.status) === "success" && !codes.length) {
        // Getting it done clears what kept going wrong with that kind of act.
        for (const key of Object.keys(setbacks)) if (key.startsWith(`${primitive}:`)) delete setbacks[key];
        continue;
      }
      for (const code of codes) {
        const key = `${primitive}:${code}`;
        const count = Number(setbacks[key]?.count || 0) + 1;
        setbacks[key] = { text: wordsFor(code), count, lastAtSeconds: at };
        agitation = clamp01(agitation + Math.min(SETBACK_STING_MAX, SETBACK_STING * count));
      }
      continue;
    }
    if (clean(row.type) === "confrontation" && row.directed === true) {
      const byId = clean(row.sourceCharacterId);
      hurts.push({ byCharacterId: byId, byName: nameOf(byId), text: clean(row.content), atSeconds: at });
      agitation = clamp01(agitation + HURT_STING);
    }
  }
  return { agitation: Math.round(agitation * 1000) / 1000, atSeconds: nowSeconds, setbacks, hurts: hurts.slice(-4),
    lastDrankAtSeconds: lastDrankAtSeconds ?? null, lastAteAtSeconds: lastAteAtSeconds ?? null, appliedEvidenceIds: [...applied].slice(-APPLIED_KEEP) };
}

/** How much a body in want frays the temper (0–0.5): thirst, hunger, sleepiness, pain. */
export function bodyFraying(body = {}, sleepiness = 0) {
  const step = (value, low, high) => (value >= high ? 0.2 : value >= low ? 0.1 : 0);
  const sum = step(Number(body.thirst || 0), 0.6, 0.8) + step(Number(body.hunger || 0), 0.6, 0.8)
    + step(Number(sleepiness || 0), 0.8, 0.95) + step(Number(body.pain || 0), 0.4, 0.7);
  return Math.round(Math.min(0.5, sum) * 100) / 100;
}

/** The temper now (0–1): what happened, faded by the hour, plus what the body is feeling. */
export function temperNow(temper = {}, { body = {}, sleepiness = 0, nowSeconds = 0 } = {}) {
  return Math.round(clamp01(faded({ ...emptyTemper(), ...temper }, nowSeconds) + bodyFraying(body, sleepiness)) * 1000) / 1000;
}

export function moodLine(value = 0) {
  if (value >= 0.7) return "心里憋着一股火，快压不住了";
  if (value >= 0.45) return "心里烦躁，看什么都不顺眼";
  if (value >= 0.25) return "有点心烦";
  return "";
}

const NUMERALS = ["零", "一", "两", "三", "四", "五", "六", "七", "八", "九", "十"];
const hoursWords = (seconds) => {
  const hours = Math.floor(seconds / 3600);
  if (hours < 1) return "";
  if (hours <= 10) return `${NUMERALS[hours]}个多钟头`;
  return "大半天";
};

/**
 * What the person is told under 【你此刻的心情】: their mood, what keeps going
 * wrong, how long without water or food when it tells, who laid hands on them.
 * `nowSeconds` and `body`/`sleepiness` are this beat's.
 */
export function temperLines(temper = {}, { body = {}, sleepiness = 0, nowSeconds = 0 } = {}) {
  const t = { ...emptyTemper(), ...temper };
  const lines = [];
  const mood = moodLine(temperNow(t, { body, sleepiness, nowSeconds }));
  if (mood) lines.push(mood);
  for (const row of Object.values(t.setbacks || {}).sort((a, b) => Number(b.lastAtSeconds) - Number(a.lastAtSeconds))) {
    if (nowSeconds - Number(row.lastAtSeconds || 0) > SETBACK_MEMORY_SECONDS) continue;
    lines.push(row.count >= 2 ? `你连着 ${row.count} 次没做成：${row.text}。` : `刚才没做成：${row.text}。`);
  }
  const since = (at) => nowSeconds - Number(at ?? 0);
  if (Number(body.thirst || 0) >= 0.5) {
    const words = hoursWords(since(t.lastDrankAtSeconds));
    if (words) lines.push(`你已经${words}没喝上一口水了。`);
  }
  if (Number(body.hunger || 0) >= 0.5) {
    const words = hoursWords(since(t.lastAteAtSeconds));
    if (words) lines.push(`你已经${words}没吃上一口饭了。`);
  }
  for (const row of list(t.hurts)) {
    if (nowSeconds - Number(row.atSeconds || 0) > HURT_MEMORY_SECONDS) continue;
    if (clean(row.text)) lines.push(`刚才：${clean(row.text)}`);
  }
  return lines;
}
