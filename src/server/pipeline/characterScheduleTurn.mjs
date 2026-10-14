// The day-schedule beat (spec §9.3). Once a day — at the opening and at 05:00 —
// a town resident writes their own plan for the day in one performance-style
// call: a few blocks, each a place and what they mean to do there. The world
// later follows a block only while nothing new has reached them; the
// schedule is their own commitment, never an instruction.
import { CHARACTER_DAY_PLAN_VERSION } from "../simulation/characterLifeContinuity.mjs";

export const SCHEDULE_PHASE = "awaiting_day_schedule";
export const SCHEDULE_PROTOCOL_VERSION = "character-day-schedule-v1";
export const SCHEDULE_DAY_START_SECONDS = 5 * 3600;
const MIN_BLOCKS = 3;
const MAX_BLOCKS = 10;
const ACTIVITY_WORDS = { rest: "歇着", sleep: "睡觉", wander: "闲逛" };

const clean = (value) => String(value ?? "").trim();
const list = (value) => (Array.isArray(value) ? value : []);
const pad = (value) => String(value).padStart(2, "0");
export const clockText = (seconds) => {
  const s = ((Math.floor(seconds) % 86400) + 86400) % 86400;
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}`;
};
export function parseClock(text) {
  const match = clean(text).match(/^(\d{1,2}):(\d{2})$/u);
  if (!match) return null;
  const h = Number(match[1]), m = Number(match[2]);
  return h < 24 && m < 60 ? h * 3600 + m * 60 : null;
}

/** Seconds from now until the schedule's end: the next 05:00, at least an hour away. */
export function scheduleHorizonSeconds({ startClockSeconds = 0, nowSeconds = 0 } = {}) {
  const clockNow = (Number(startClockSeconds) + Number(nowSeconds)) % 86400;
  let until = (SCHEDULE_DAY_START_SECONDS - clockNow + 86400) % 86400;
  if (until < 3600) until += 86400;
  return until;
}

export function buildScheduleStage({ characterRecord = {}, canonicalInput = {}, sites = [], knownSiteIds = [], work = [],
  startClockSeconds = 0, nowSeconds = 0 } = {}) {
  const self = canonicalInput.agent || {};
  const name = clean(characterRecord.name || self.name);
  // A schedule is written in whole minutes: "06:30" means the start of this
  // minute even when the world clock has already moved a few seconds past it.
  const clockExact = (Number(startClockSeconds) + Number(nowSeconds)) % 86400;
  const intoMinute = clockExact % 60;
  const clockNow = clockExact - intoMinute;
  const horizonSeconds = scheduleHorizonSeconds({ startClockSeconds, nowSeconds }) + intoMinute;
  const siteById = new Map(list(sites).map((row) => [clean(row.id), row]));
  const places = list(knownSiteIds).map(clean).filter((id) => siteById.has(id)).slice(0, 20)
    .map((id, index) => ({ key: `S${index + 1}`, siteId: id, label: clean(siteById.get(id).name), entryZoneId: clean(siteById.get(id).entryZoneId) }));
  const placeBySite = new Map(places.map((row) => [row.siteId, row]));
  const skills = new Set(list(characterRecord.skills).map(clean));
  const siteOfZone = (zoneId) => clean(zoneId).split("__")[0];
  const jobs = list(work)
    .filter((row) => placeBySite.has(siteOfZone(row.zoneId)))
    .filter((row) => list(row.requiredSkillIds).every((id) => skills.has(clean(id))))
    .slice(0, 12)
    .map((row, index) => ({ key: `W${index + 1}`, templateId: clean(row.templateId), label: clean(row.taskLabel), zoneId: clean(row.zoneId),
      siteId: siteOfZone(row.zoneId), minutes: Math.max(1, Math.round(Number(row.durationSecondsPerUnit || 60) / 60)) }));
  const people = list(self.relationshipContext).filter((row) => clean(row.toCharacterId) && clean(row.toCharacterName)).slice(0, 12)
    .map((row, index) => ({ key: `R${index + 1}`, characterId: clean(row.toCharacterId), name: clean(row.toCharacterName), label: clean(row.label) }));
  const profile = self.privateState?.ecologyProfile || characterRecord.ecologyProfile || {};
  const deadlines = list(canonicalInput.temporalContext?.deadlines);
  const habits = list(characterRecord.routineHabits);
  const section = (title, body) => (body ? `【${title}】\n${body}` : "");
  const user = [
    section("你是谁", [`${name}，${clean(characterRecord.title)}。`, clean(characterRecord.internalSituation)].filter(Boolean).join("\n")),
    section("你心里放着的事", [
      ...list(profile.desires).map((row) => `- 你想${clean(row.desiredState?.verb)}${clean(row.desiredState?.object)}`),
      ...deadlines.map((row) => `- ${clean(row.label)}：还剩约 ${Math.max(0, Math.round(Number(row.remainingSeconds || 0) / 60))} 分钟${row.personallyResponsible ? "（这是你的事）" : ""}`),
    ].join("\n")),
    section("你平时的作息", habits.map((row) => `- ${clean(row.from)}–${clean(row.to)} 在${clean(siteById.get(clean(row.siteId))?.name || row.siteId)}：${clean(row.activity)}`).join("\n")),
    section("你知道的地方（place 填 S 代号）", places.map((row) => `- ${row.key} ${row.label}`).join("\n")),
    section("你会做的活（activity 填 work:W 代号，地点必须是活所在的地方）", jobs.map((row) => `- ${row.key} ${row.label}（在${placeBySite.get(row.siteId).label}，一份约 ${row.minutes} 分钟）`).join("\n")),
    section("你可能去找的人（activity 填 visit:R 代号）", people.map((row) => `- ${row.key} ${row.name}${row.label ? `（${row.label}）` : ""}`).join("\n")),
    `【现在】\n现在是 ${clockText(clockNow)}。写下你从现在到明早 ${clockText(SCHEDULE_DAY_START_SECONDS)} 的打算。`,
    `【怎么回答】
只回答一个 JSON 对象：
{"thought": "你心里怎么盘算今天（只有你自己知道，一两句）",
 "blocks": [{"from": "HH:MM", "to": "HH:MM", "place": "S代号", "activity": "work:W代号|rest|sleep|wander|visit:R代号", "note": "一句话：你打算干什么"}]}
写 ${MIN_BLOCKS}–${MAX_BLOCKS} 段，按时间先后，不重叠；第一段从现在或稍后开始，最后一段不晚于明早 ${clockText(SCHEDULE_DAY_START_SECONDS)}。rest 是歇着，sleep 是睡觉，wander 是闲逛；去找人用 visit。这是你自己的打算，碰到事随时可以改。`,
  ].filter(Boolean).join("\n\n");
  const system = `你是「${name}」。现在是一天的开头，你给自己盘算今天怎么过。只输出 JSON。`;
  const activityEnum = ["rest", "sleep", "wander", ...jobs.map((row) => `work:${row.key}`), ...people.map((row) => `visit:${row.key}`)];
  const schema = {
    type: "object", additionalProperties: false, required: ["thought", "blocks"],
    properties: {
      thought: { type: "string" },
      blocks: { type: "array", minItems: MIN_BLOCKS, maxItems: MAX_BLOCKS, items: {
        type: "object", additionalProperties: false, required: ["from", "to", "place", "activity", "note"],
        properties: { from: { type: "string" }, to: { type: "string" }, place: { type: "string", enum: places.map((row) => row.key) },
          activity: { type: "string", enum: activityEnum }, note: { type: "string" } } } },
    },
  };
  return {
    stageInput: { phase: SCHEDULE_PHASE, protocolVersion: SCHEDULE_PROTOCOL_VERSION, characterId: clean(self.id || characterRecord.id),
      agentTurnId: clean(canonicalInput.agentTurnId), prompt: { system, user }, schema, outputKey: "schedule" },
    table: { places, jobs, people, clockNow, horizonSeconds, nowSeconds: Number(nowSeconds) - intoMinute },
  };
}

// Relative seconds from now for a clock time inside the horizon.
function relativeSeconds(text, table, { end = false } = {}) {
  const clock = parseClock(text);
  if (clock == null) return null;
  let rel = (clock - table.clockNow + 86400) % 86400;
  if (end && rel === 0) rel = 86400;
  if (rel > table.horizonSeconds) rel -= 86400;
  return rel;
}

export function validateScheduleOutput(output = {}, table = {}) {
  const issues = [];
  const add = (path, message) => issues.push({ code: "SCHEDULE_OUTPUT_INVALID", path, message });
  if (!output || typeof output !== "object") return [{ code: "SCHEDULE_OUTPUT_INVALID", path: "output", message: "需要一个 JSON 对象。" }];
  const blocks = list(output.blocks);
  if (blocks.length < MIN_BLOCKS || blocks.length > MAX_BLOCKS) add("blocks", `写 ${MIN_BLOCKS}–${MAX_BLOCKS} 段。`);
  const placeKeys = new Set(list(table.places).map((row) => row.key));
  const jobByKey = new Map(list(table.jobs).map((row) => [row.key, row]));
  const personKeys = new Set(list(table.people).map((row) => row.key));
  const placeByKey = new Map(list(table.places).map((row) => [row.key, row]));
  let previousEnd = -1;
  blocks.forEach((block, index) => {
    const at = `blocks[${index}]`;
    const start = relativeSeconds(block?.from, table);
    const end = relativeSeconds(block?.to, table, { end: true });
    if (start == null || end == null) { add(at, "from/to 写成 HH:MM。"); return; }
    if (start < 0 || end > table.horizonSeconds) add(at, `这一段要在现在（${clockText(table.clockNow)}）和明早 ${clockText(SCHEDULE_DAY_START_SECONDS)} 之间。`);
    if (end <= start) add(at, "to 要晚于 from。");
    if (start < previousEnd) add(at, "各段按时间先后排，不能重叠。");
    previousEnd = Math.max(previousEnd, end);
    if (!placeKeys.has(clean(block?.place))) add(`${at}.place`, `place 只能是 ${[...placeKeys].join("、")}。`);
    const activity = clean(block?.activity);
    if (activity.startsWith("work:")) {
      const job = jobByKey.get(activity.slice(5));
      if (!job) add(`${at}.activity`, `work 只能是 ${[...jobByKey.keys()].map((key) => `work:${key}`).join("、") || "（你眼下没有能做的活）"}。`);
      else if (placeByKey.get(clean(block?.place))?.siteId !== job.siteId) add(`${at}.place`, `${job.label}要在${placeByKey.get([...placeByKey.keys()].find((key) => placeByKey.get(key).siteId === job.siteId))?.label || "活所在的地方"}做。`);
    } else if (activity.startsWith("visit:")) {
      if (!personKeys.has(activity.slice(6))) add(`${at}.activity`, `visit 只能是 ${[...personKeys].map((key) => `visit:${key}`).join("、") || "（没有可去找的人）"}。`);
    } else if (!ACTIVITY_WORDS[activity]) add(`${at}.activity`, "activity 只能是 work:W代号、rest、sleep、wander 或 visit:R代号。");
  });
  return issues;
}

/** Lower a valid schedule into the Character's private life plan (the existing day-plan shape). */
export function lowerScheduleOutput(output = {}, table = {}, { ownerCharacterId = "", agentTurnId = "", previousRevision = 0, dayIndex = 0 } = {}) {
  const owner = clean(ownerCharacterId);
  const now = Number(table.nowSeconds || 0);
  const revision = Math.max(0, Math.floor(Number(previousRevision || 0))) + 1;
  const planId = `character-day-schedule:${owner}:day=${dayIndex}`;
  const placeByKey = new Map(list(table.places).map((row) => [row.key, row]));
  const jobByKey = new Map(list(table.jobs).map((row) => [row.key, row]));
  const personByKey = new Map(list(table.people).map((row) => [row.key, row]));
  const steps = list(output.blocks)
    .map((block) => ({ block, start: relativeSeconds(block.from, table), end: relativeSeconds(block.to, table, { end: true }) }))
    .sort((a, b) => a.start - b.start)
    .map(({ block, start, end }, index) => {
      const place = placeByKey.get(clean(block.place));
      const activityText = clean(block.activity);
      const job = activityText.startsWith("work:") ? jobByKey.get(activityText.slice(5)) : null;
      const person = activityText.startsWith("visit:") ? personByKey.get(activityText.slice(6)) : null;
      const activity = job ? { kind: "work", workTemplateId: job.templateId, workZoneId: job.zoneId }
        : person ? { kind: "visit", characterId: person.characterId }
          : { kind: activityText };
      return {
        schemaVersion: CHARACTER_DAY_PLAN_VERSION,
        authority: "character-agent-owned-day-plan-step",
        ownerCharacterId: owner,
        planId,
        planStepId: `${planId}:step:${pad(index + 1)}`,
        revision,
        status: "planned",
        relativeStartSeconds: start,
        relativeEndSeconds: end,
        dueAtSeconds: now + start,
        endsAtSeconds: now + end,
        activityType: job ? `work:${job.templateId}` : person ? `visit:${person.characterId}` : activityText,
        desiredZoneHandle: place.entryZoneId,
        privatePurpose: clean(block.note).slice(0, 80) || (job ? job.label : ACTIVITY_WORDS[activityText] || "去找人"),
        sourceIds: [`day-schedule:${clean(agentTurnId)}`],
        decisionAuthority: "character-agent",
        selection: null,
        autopilot: true,
        siteId: place.siteId,
        siteZoneId: place.entryZoneId,
        activity,
      };
    });
  return {
    schemaVersion: CHARACTER_DAY_PLAN_VERSION,
    authority: "character-private-life-plan-state",
    ownerCharacterId: owner,
    planId,
    revision,
    status: "active",
    source: "day_schedule",
    anchorAtSeconds: now,
    horizonSeconds: table.horizonSeconds,
    horizonEndsAtSeconds: now + table.horizonSeconds,
    steps,
    lastSettledAtSeconds: now,
  };
}
