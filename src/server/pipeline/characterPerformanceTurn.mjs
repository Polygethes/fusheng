// Performance mode: one model call per character beat.
//
// The character receives a compact, prose-first picture of who they are, how
// they speak, how they stand with the people present, what they remember,
// what was just said and what they can physically do — and answers as that
// person in one JSON object. The world still settles every action through the
// same registry: speech is only speech, and only a settled attempt changes
// anything. Private psychology is reduced to memory of what was perceived and
// the character's own stated thought.
//
// The hybrid mode extends the beat with a small private ledger of inner changes:
// at most two changes recorded per beat (three when reconsidering), read back
// on the next beat so thoughts and relationships move with the scene.

import { OWN_WALK_INTENTION_PREFIX } from "./characterOwnPlanStep.mjs";
import { bodyLines } from "../simulation/weatherOnBody.mjs";
import { bondNotes } from "../simulation/bonds.mjs";
import { desireLine, clockStamp, failureReasons } from "./plainWords.mjs";

export const PERFORMANCE_PHASE = "awaiting_performance_beat";
export const PERFORMANCE_PROTOCOL_VERSION = "character-performance-beat-v1";

const clean = (value) => String(value ?? "").trim();
const list = (value) => (Array.isArray(value) ? value : []);
const mmss = (seconds) => `${String(Math.floor(Math.max(0, seconds) / 60)).padStart(2, "0")}:${String(Math.floor(Math.max(0, seconds) % 60)).padStart(2, "0")}`;
const DO_TYPES = ["none", "move", "take", "take_out", "put_down", "give", "show", "work", "finish", "wait", "look", "listen", "strike", "shove", "grab", "propose", "accept", "offer", "deal", "drink", "eat", "fill", "pour", "sleep", "chase"];
// A blow narrated as a gesture would happen in no world: laying hands on someone is a do.
const GESTURE_BLOW = /一拳|一脚|一巴掌|耳光|踹|掐住|掐着|捅|砍|刺向|扇了|揍|勒住/u;

const TRAITS = {
  autonomy: ["凡事有自己的主意", "习惯听人安排"], introversion: ["话少、心事往里收", "外向、有话就说"],
  persistence: ["认准了的事不撒手", "容易泄气"], conscientiousness: ["做事仔细有章法", "做事马虎随性"],
  competitiveness: ["好胜、不服输", "不爱和人争"], care: ["心软，见不得人受苦", "对人淡漠"],
  caution: ["谨慎多虑", "胆子大、不太想后果"], impulsivity: ["性子急，想到就做", "沉得住气"],
};
function personalityWords(personality = {}) {
  const words = [];
  for (const [trait, [high, low]] of Object.entries(TRAITS)) {
    const value = Number(personality[trait]);
    if (value >= 0.7) words.push(high); else if (value <= 0.3) words.push(low);
  }
  return words.join("；");
}

const FEELINGS = { love: "在乎", dependence: "依赖", protection: "想护着", fear: "怕", resentment: "有怨气", shame: "在对方面前抬不起头",
  wantsToBeSeen: "想被对方看见", wantsToEscape: "想躲开", deception: "有事瞒着", jealousy: "嫉妒", power: "在对方面前说话有分量", attraction: "被吸引", revenge: "想报复" };
function feelingWords(row = {}) {
  return Object.entries(FEELINGS).map(([id, word]) => [word, Number(row[id] || 0)]).filter(([, v]) => v >= 40)
    .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([word]) => word).join("、");
}

function voiceLines(blueprint = {}, samples = []) {
  const lines = [];
  if (blueprint.interactionStance) lines.push(`为人处世：${blueprint.interactionStance}`);
  if (blueprint.rhythmTendency) lines.push(`说话节奏：${blueprint.rhythmTendency}`);
  if (blueprint.disclosureStrategy) lines.push(`说多说少：${blueprint.disclosureStrategy}`);
  if (list(blueprint.emotionalLeakage).length) lines.push(`情绪会从这些地方漏出来：${blueprint.emotionalLeakage.join("；")}`);
  if (blueprint.silenceStyle) lines.push(`不说话时：${blueprint.silenceStyle}`);
  if (samples.length) lines.push(`你说话的样子（原作台词，只学语气和用词，不要照抄）：\n${samples.map((line) => `  「${line}」`).join("\n")}`);
  return lines.join("\n");
}

/**
 * Build the stage input and the private key table used to map the answer back
 * to canonical world ids. The table never leaves the server.
 */
function routeFrom(edges = [], fromZoneId = "") {
  const next = new Map([[fromZoneId, null]]);
  const queue = [fromZoneId];
  while (queue.length) {
    const at = queue.shift();
    for (const [a, b] of edges) {
      const other = a === at ? b : b === at ? a : "";
      if (other && !next.has(other)) { next.set(other, at); queue.push(other); }
    }
  }
  const pathTo = (zoneId) => {
    if (!next.has(zoneId) || zoneId === fromZoneId) return [];
    const path = [zoneId];
    while (next.get(path[0]) !== fromZoneId) path.unshift(next.get(path[0]));
    return path;
  };
  return { reachable: [...next.keys()].filter((id) => id !== fromZoneId), pathTo };
}

export function buildPerformanceStage({ canonicalInput = {}, projection = {}, characterRecord = {}, wake = {}, clockLabel = "", zoneLabels = {}, zoneEdges = [], reconsiderNote = "", sites = [], knownSiteIds = [], hybrid = null, objectLabels = {} } = {}) {
  const self = canonicalInput.agent || {};
  const nowSeconds = Number(canonicalInput.scene?.elapsedSeconds || 0);
  const hereZone = clean(canonicalInput.scene?.zoneId);
  const town = list(sites).length > 0;
  const adjacent = new Set(list(zoneEdges).flatMap(([a, b]) => (a === hereZone ? [b] : b === hereZone ? [a] : [])));
  const near = (zoneId) => !town || clean(zoneId) === hereZone || adjacent.has(clean(zoneId));
  const people = list(canonicalInput.perceivedCharacters).filter((row) => near(row.zoneId)).map((row, index) => ({
    key: `P${index + 1}`, handle: clean(row.entityHandle || row.id), characterId: clean(row.recognizedIdentity?.characterId),
    name: row.identityKnown ? clean(row.name) : clean(row.observableDescription || "一个看不清的人"), zoneId: clean(row.zoneId), zoneLabel: clean(row.zoneLabel),
    known: row.identityKnown === true, condition: clean(row.observableCondition),
    proposedToYou: row.proposedToYou === true,
    offerToYou: row.offerToYou || null,
  }));
  const personByHandle = new Map(people.map((row) => [row.handle, row]));
  const zoneName = (id) => clean(zoneLabels[clean(id)]) || clean(id);
  const nameOf = (id) => (clean(id) === clean(canonicalInput.agent?.id) ? "你" : personByHandle.get(clean(id))?.name
    || people.find((row) => row.characterId === clean(id))?.name
    || clean(canonicalInput.knownNamesByHandle?.[clean(id)])
    || "有人");
  const objects = list(canonicalInput.perceivedObjects).filter((row) => row.kind !== "position").filter((row) => {
    if (!town) return true;
    const holderHandle = clean(row.holderEntityHandle);
    if (holderHandle && holderHandle === clean(self.id)) return true;
    if (holderHandle && personByHandle.has(holderHandle)) return true;
    if (!holderHandle && near(row.zoneId)) return true;
    return false;
  }).map((row, index) => {
    const mine = clean(row.holderEntityHandle) === clean(self.id);
    const holder = mine ? "你" : row.holderEntityHandle ? nameOf(row.holderEntityHandle) : "";
    return { key: `O${index + 1}`, handle: clean(row.objectHandle || row.id), label: clean(row.label), mine, holder,
      inHand: row.custody?.inHand === true, zoneId: clean(row.zoneId), zoneLabel: zoneName(row.zoneId), state: clean(row.observableStateDescription),
      ownedAs: clean(row.ownedAs) };
  });
  // Every zone of the place is a destination; a far one is walked hop by hop,
  // each hop settled by the world like any other move.
  const route = routeFrom(list(zoneEdges), hereZone);
  const nearby = list(canonicalInput.reachableZones).filter((row) => row.physicalAccess?.relation !== "current").map((row) => ({
    id: clean(row.id), label: clean(row.label), adjacent: row.physicalAccess?.relation === "adjacent", attemptable: row.physicalAccess?.physicallyAttemptable !== false,
    permission: row.socialAccess?.permissionRequiredByNorm && !row.socialAccess?.permissionCurrentlyGranted, path: [clean(row.id)],
  }));
  let zones = [...nearby, ...route.reachable.filter((id) => !nearby.some((row) => row.id === id)).map((id) => ({
    id, label: zoneName(id), adjacent: false, attemptable: true, permission: false, path: route.pathTo(id),
  }))].map((row) => ({ ...row, path: row.adjacent ? [row.id] : (route.pathTo(row.id).length ? route.pathTo(row.id) : row.path) }));
  if (town) {
    const hereSite = hereZone.includes("__") ? hereZone.split("__")[0] : "";
    const siteRows = [];
    for (const siteId of list(knownSiteIds).map(clean)) {
      const site = list(sites).find((row) => clean(row.id) === siteId);
      if (!site || siteId === hereSite) continue;
      const entryId = clean(site.entryZoneId);
      if (adjacent.has(entryId) && clean(site.kind) === "outdoor") continue;
      const path = route.pathTo(entryId);
      if (!path.length) continue;
      siteRows.push({ id: siteId, label: clean(site.name), adjacent: false, attemptable: true, permission: false, path, site: true });
    }
    const siteEntries = new Set(siteRows.map((row) => list(sites).find((site) => clean(site.id) === row.id).entryZoneId));
    const local = zones.filter((row) => !siteEntries.has(row.id)
      && (adjacent.has(row.id) || (hereSite && row.id.startsWith(`${hereSite}__`))));
    zones = [...local, ...siteRows].slice(0, 20);
  }
  const zoneLabel = (id) => zones.find((row) => row.id === id)?.label || zoneName(id);
  // A stretch of street right outside a house door is where that house's
  // doorstep and eaves are; say so, or stepping out reads like wandering off.
  const outsideDoors = town && !hereZone.includes("__")
    ? list(sites).filter((site) => clean(site.kind) === "building" && adjacent.has(clean(site.entryZoneId))).map((site) => clean(site.name)).join("、")
    : "";
  // How things stand around the person, as they perceive them (weather, water, ground, snow, the stream).
  const conditionsLine = list(projection?.perceivedConditions || canonicalInput.perceivedConditions).map((row) => clean(row.text)).join("");
  const work = list(canonicalInput.availableAffordances).filter((row) => row.kind === "work_operation").map((row, index) => ({
    key: row.operation === "start_work_unit" ? `W${index + 1}` : `F${index + 1}`, handle: clean(row.id), operation: clean(row.operation),
    templateId: clean(row.workTemplateId),
    label: clean(row.label), minutes: Math.max(1, Math.round(Number(row.expectedDurationSeconds || 60) / 60)), executable: row.currentlyExecutable === true,
    missing: list(row.physicalPrerequisites).map((line) => line.replace(/本人/gu, "你").replace(/先到([a-z_]+)/gu, (_, id) => `先到${zoneName(id)}`)),
  }));

  const profile = self.privateState?.ecologyProfile || {};
  const relationships = list(self.relationshipContext).filter((row) => people.some((p) => p.characterId === row.toCharacterId) || row.toCharacterName);
  const memory = self.memoryContext || {};
  const episodes = list(memory.episodes).slice(0, 8);
  const beliefs = list(memory.beliefs).filter((row) => clean(row.proposition)).slice(0, 8);
  const turns = list(canonicalInput.discourseContext?.recentPublicTurns).slice(-14);
  const ownLines = turns.filter((row) => clean(row.speakerId) === clean(self.id)).slice(-3).map((row) => clean(row.utterance));
  const settled = list(canonicalInput.settledInteractionEvents);
  const lastVisible = new Map();
  for (const row of settled) if (clean(row.visibleAction) && clean(row.actorId) !== clean(self.id)) lastVisible.set(clean(row.actorId), clean(row.visibleAction).replace(/。$/u, ""));
  // What was done, in words: a settled action without a visible description
  // carries only the world's codes (attention_oriented:<id>), never shown as such.
  const HANDLING = { pickup: "拿起了", place: "放下了", take_out: "取出了", store: "收起了", transfer: "递出了", show: "亮出了", hide: "藏起了" };
  const thingName = (id) => objects.find((row) => row.handle === clean(id))?.label || personByHandle.get(clean(id))?.name
    || people.find((row) => row.characterId && row.characterId === clean(id))?.name || clean(objectLabels?.[clean(id)]);
  const ownName = clean(self.name);
  const withoutOwnName = (text, row) => (clean(row.actorId) === clean(self.id) && ownName && text.startsWith(ownName) ? text.slice(ownName.length) : text);
  const codeWords = (text) => clean(text).split("；").map((part) => {
    const [kind, anchor = "", operation = ""] = part.split(":").map(clean);
    if (!/^[a-z_]+$/u.test(kind)) return part;
    if (kind === "attention_oriented") return thingName(anchor) ? `看了看${thingName(anchor)}` : "四下看了看";
    if (kind === "listening_oriented") return thingName(anchor) ? `仔细听了听${thingName(anchor)}` : "仔细听了听动静";
    if (["movement_attempted", "actor_movement"].includes(kind)) return anchor ? `走到${zoneName(anchor)}` : "挪了挪地方";
    if (kind === "object_handling_attempted") return `${HANDLING[operation] || "动了动"}${thingName(anchor) || "东西"}`;
    if (kind === "work_unit_started") return "动手干起活来";
    return "";
  }).filter(Boolean).join("，");
  const actionWords = (row) => withoutOwnName(clean(row.visibleAction), row) || codeWords(row.summary);
  // A memory of one's own doing reads as "你…"; the world's bookkeeping
  // notices ("刚才的动作已经落定") are not memories.
  const memoryWords = (text) => {
    const words = /^[a-z_]+(:|$)/u.test(clean(text)) ? codeWords(text) : clean(text);
    if (!words || /^(刚才的动作已经落定|话已经说出)/u.test(words)) return "";
    return ownName && words.startsWith(ownName) ? `你${words.slice(ownName.length)}` : words;
  };
  const events = settled.filter((row) => !clean(row.speech) && actionWords(row)).slice(-6)
    .map((row) => ({ content: `[${clockStamp(Number(row.occurredAtSeconds || 0), canonicalInput.clockStartMinutes ?? null)}] ${clean(row.actorId) === clean(self.id) ? "你" : nameOf(row.actorId) === "有人" ? (people.find((p) => p.characterId === clean(row.actorId))?.name || "有人") : nameOf(row.actorId)}：${actionWords(row)}` }));
  const noticed = list(canonicalInput.perceivedImpacts).filter((row) => clean(row.content)).slice(-6);
  const deadlines = list(canonicalInput.temporalContext?.deadlines);
  const plan = canonicalInput.activePlanProjection?.currentStep || canonicalInput.activePlanProjection?.nextStep || null;
  const processes = list(canonicalInput.ownedWorldProcesses);

  const section = (title, body) => (body ? `【${title}】\n${body}` : "");
  const reconsiderLines = [clean(reconsiderNote), hybrid?.reconsider ? "这一拍可以在 inner 里多整理一笔：哪些看法你认定了、哪些怀疑打消了、对谁的感觉变了。" : ""].filter(Boolean);
  const innerSchemaExample = hybrid
    ? `,\n "inner": [{"kind": "belief|feeling|want|bond", "text": "一句话", "about": "P代号或空", "ref": "要改的 B 代号或空", "sure": "怀疑|认定|不再信|空"}]`
    : "";
  const innerGuide = hybrid
    ? `\n\ninner 记你心里这一拍真的起了的变化，最多 ${hybrid?.reconsider ? 3 : 2} 条，没有就给 []：
- belief：对某件事的看法。新起的看法写 text，sure 写 怀疑 或 认定；改已有的看法填 ref（如 B3），sure 写 认定、怀疑 或 不再信。
- feeling：对某个人的感觉变了。about 填 P 代号，text 写感觉，比如“心疼他”“有点发怵”。
- bond：你觉得你和某人如今算什么（比原来的说法变了才写）。about 填 P 代号，text 写一个短说法，比如“不让人省心的皮猴”“信得过的人”“冤家”。
- want：你此刻最想做成的事。
只记真在心里变了的，不要每拍硬写。`
    : "";
  const note = (id) => { const text = clean((projection?.movementNotes || canonicalInput.movementNotes || {})[id]); return text ? `（${text}）` : ""; };
  const keys = { people: people.map((row) => row.key), nearPeople: people.filter((row) => row.zoneId === hereZone).map((row) => row.key),
    suitors: people.filter((row) => row.proposedToYou && row.zoneId === hereZone).map((row) => row.key),
    dealers: people.filter((row) => row.offerToYou && row.zoneId === hereZone).map((row) => row.key),
    objects: objects.map((row) => row.key), zones: zones.map((row) => row.id),
    starts: work.filter((row) => row.operation === "start_work_unit").map((row) => row.key), finishes: work.filter((row) => row.operation !== "start_work_unit").map((row) => row.key) };
  const user = [
    section("你是谁", [`${clean(self.name)}，${clean(characterRecord.title || characterRecord.publicIdentity?.label || self.role)}。`,
      clean(characterRecord.internalSituation), personalityWords(profile.personality) && `性子：${personalityWords(profile.personality)}。`].filter(Boolean).join("\n")),
    section("你怎么说话", voiceLines(characterRecord.voiceBlueprint || {}, list(characterRecord.voiceSamples))),
    section("你心里放着的事", [
      ...list(profile.desires).map((row) => `- ${desireLine(row.desiredState || {})}`),
      ...list(profile.principles).map((row) => `- 你的规矩：${clean(row.statement)}`),
      ...list(profile.boundaries).map((row) => `- 碰不得的地方：${clean(row.protectedInterest)}；遇到「${clean(row.trigger)}」时你多半会${clean(row.responseBias)}`),
      ...list(canonicalInput.ownCommitments).map((row) => `- 你答应过/定下的事：${clean(row.description || row.label || row)}`),
      clean(self.currentIntention) && `- 你刚才心里的打算：${clean(self.currentIntention)}`,
      plan && `- 你原本计划此刻：${clean(plan.label || plan.description || plan.intent)}`,
    ].filter(Boolean).join("\n")),
    section("你记得", [...episodes.filter((row) => memoryWords(row.perception?.content)).map((row) => `- （${clean(row.perceivedAt?.label) || "先前"}）${memoryWords(row.perception?.content)}`),
      ...beliefs.map((row) => `- ${({ unknown: "你不知道：", suspected: "你隐约怀疑：", held: "你认定：", settled: "你认定：" })[clean(row.status)] || "你觉得："}${clean(row.proposition)}`)].join("\n")),
    ...(hybrid?.ledger ? [section("你心里新近的变化", [
      ...list(hybrid.ledger.beliefs).map((b) => `- ${clean(b.id).toUpperCase()} ${b.status === "held" ? "你认定" : "你隐约怀疑"}：${clean(b.text)}${clean(b.aboutName) ? `（关于${clean(b.aboutName)}）` : ""}`),
      ...list(hybrid.ledger.feelings).map((f) => `- 你对${clean(f.aboutName)}：${clean(f.text)}`),
      ...list(hybrid.ledger.wants).map((w) => `- 你现在最想：${clean(w.text)}`),
    ].join("\n"))] : []),
    section("你和这些人", relationships.map((row) => {
      const feel = feelingWords(row);
      return `- ${clean(row.toCharacterName)}：${clean(row.label)}。${clean(row.addressingRule)}${feel ? ` 你对对方：${feel}。` : ""}${row.unspoken ? ` 没说出口的话：「${clean(row.unspoken)}」。` : ""}${row.misreading ? ` （你可能看错的地方：${clean(row.misreading)}）` : ""}${bondNotes(row) ? ` ${bondNotes(row)}` : ""}`;
    }).join("\n")),
    section("你的身子", bodyLines(self.privateState?.ecologyState?.body || {}).map((line) => `- ${line}`).concat(canonicalInput.selfPregnancy ? [`- ${canonicalInput.selfPregnancy}`] : []).concat(canonicalInput.selfSleepiness ? [`- ${canonicalInput.selfSleepiness}`] : []).join("\n")),
    section("你此刻的心情", list(canonicalInput.temperLines).map((line) => `- ${clean(line)}`).join("\n")),
    section("此刻", [`${canonicalInput.timeOfDay ? canonicalInput.timeOfDay : `${clockLabel ? `从${clockLabel}起，过了 ${Math.floor(nowSeconds / 60)} 分钟` : `过了 ${Math.floor(nowSeconds / 60)} 分钟`}。`}你在${clean(canonicalInput.scene?.zoneLabel)}${outsideDoors ? `（${outsideDoors}门外）` : ""}。${conditionsLine}`,
      canonicalInput.waterHere ? `- ${canonicalInput.waterHere}，能喝，也能打水。` : "",
      ...people.map((row) => `- ${row.key} ${row.name}${row.known ? "" : "（你不认识这个人）"}：在${row.zoneLabel || zoneName(row.zoneId) || "附近"}${row.zoneId === hereZone ? "（就在你身边）" : ""}${lastVisible.get(row.characterId) ? `，刚才${lastVisible.get(row.characterId)}` : ""}${row.condition ? `，${row.condition}` : ""}${row.proposedToYou ? "，向你求过亲" : ""}${row.offerToYou ? `，想拿${clean(row.offerToYou.give)}换你的${clean(row.offerToYou.want)}` : ""}`),
      ...objects.map((row) => `- ${row.key} ${row.label}：${row.mine ? (row.inHand ? "在你手里" : "你随身带着（没拿在手上）") : row.holder ? `在${row.holder}手上/身上` : row.zoneId === hereZone ? "就在你这儿" : `在${row.zoneLabel}`}${row.state ? `；${row.state}` : ""}${row.ownedAs ? `；是${row.ownedAs}` : ""}`),
      ...list(canonicalInput.missingHere).map((label) => `- 本该在这儿的${clean(label)}不见了。`),
      ...processes.map((row) => `- 你手上的活：${clean(row.label || row.publicLabel || row.workLabel || row.offeringLabel) || "手上的活"}（${clean(row.status) === "ready" ? "可以收尾了" : "还在做"}）`),
    ].join("\n")),
    section("刚才的对话（原话）", turns.map((row) => `[${clockStamp(Number(row.occurredAtSeconds || 0), canonicalInput.clockStartMinutes ?? null)}] ${nameOf(row.speakerId)}${row.addresseeId ? ` 对${nameOf(row.addresseeId)}` : ""}说：「${clean(row.utterance)}」`).join("\n")),
    section("刚发生的事", [...events.map((row) => `- ${clean(row.content)}`), ...noticed.map((row) => `- 你刚注意到：${clean(row.content)}${failureReasons(row).length ? `（${failureReasons(row).join("；")}）` : ""}`)].join("\n")),
    section("你知道的时辰", deadlines.map((row) => `- ${clean(row.label)}：${row.timeStatus === "elapsed" ? `已经过了 ${mmss(row.elapsedAfterDeadlineSeconds)}` : `还剩 ${mmss(row.remainingSeconds)}`}${row.personallyResponsible ? "（这是你的事）" : ""}。${clean(row.delayConsequence)}`).join("\n")),
    section("你能做的事（do.type + do.target 用下面的代号）", [
      town
        ? `- move：走到别处（target 填区域 id 或地点代号）。${zones.filter((row) => row.attemptable).map((row) => row.site ? `${row.id}=${row.label}（要走${row.path.length}段路）` : `${row.id}=${row.label}${note(row.id)}`).join("，")}`
        : `- move：走到别处（target 填区域 id）。${zones.filter((row) => row.attemptable).map((row) => `${row.id}=${row.label}${row.path.length > 1 ? `（要经过${row.path.slice(0, -1).map(zoneName).join("、")}）` : ""}${row.permission ? "（那是别人的地方）" : ""}`).join("，")}`,
      objects.length ? `- take 拿起 / take_out 从身上取出 / put_down 放下 / give 递给某人（person 填 P 代号）/ show 给人看：target 填 O 代号` : "",
      "- drink：喝水、喝茶（target 填手里或身边装着水、茶的东西；不填就喝手边现成的，在溪边、井边就直接喝）。",
      "- eat：吃做好的饭（target 填有饭的东西，比如灶台；不填就吃身边现成的）。",
      "- fill：往你手里的桶、壶里打水（target 填手里那件；从身边的水缸、井或溪里取）。",
      "- pour：把你手里的水倒进别的东西（target 填水缸，或身边别人手里的桶）。",
      people.some((row) => row.zoneId !== hereZone) ? "- chase：去追某人（person 填 P 代号）。比对方跑得快，一拍能追两段路；追到身边会顺手一把揪住。" : "",
      people.some((row) => row.zoneId === hereZone) ? "- strike / shove / grab：动手打、推、抓住某人（person 填 P 代号，只能是就在你身边的人）。真要动手才用；后果由世界结算，可能打不中，也可能伤人，甚至出人命。" : "",
      (canonicalInput.marriage?.grown && !canonicalInput.marriage?.spouse && people.some((row) => row.zoneId === hereZone)) ? "- propose：当面向某人求亲（person 填就在你身边的人的 P 代号）。对方用 accept 答应了才算数。" : "",
      keys.suitors.length ? "- accept：答应向你求亲的人，和对方结为夫妻（person 填 P 代号）。" : "",
      (objects.some((row) => row.mine && row.inHand) && people.some((row) => row.zoneId === hereZone)) ? "- offer：拿你手里的东西换身边那人身上的某件东西（target 填对方那件东西的 O 代号，person 填对方的 P 代号）。对方用 deal 答应了才算数。" : "",
      keys.dealers.length ? "- deal：答应对方提出的交换，两件东西当场换手（person 填 P 代号）。" : "",
      ...work.map((row) => `- ${row.operation === "start_work_unit" ? "work" : "finish"} ${row.key}：${row.label}${row.operation === "start_work_unit" ? `（一份约 ${row.minutes} 分钟）` : ""}${row.executable ? "" : `——眼下还不行：${row.missing.join("；")}`}`),
      "- wait：先不动，等一会儿或歇一会儿（minutes 填 1–30；person 填 P 代号表示等这个人开口）。有人直接对你说话会打断等待。在卧房里歇着就是躺到床上。",
      "- sleep：躺下睡觉。在卧房的床上睡最解乏，别处也能睡，只是没那么解乏。睡着了就一直睡到睡足、天亮，或者被人叫醒。",
      "- look / listen：专门去看、去听某人或某物（target 填代号）。只看一眼不算一拍，没有必要就别单独用。",
      "- none：不做别的动作，只说话；什么也不说也不做时表示你就这么待着。",
    ].filter(Boolean).join("\n")),
    reconsiderLines.length ? `【停下来想一想】\n${reconsiderLines.join("\n")}` : "",
    ownLines.length ? `【你刚说过的话】\n${ownLines.map((line) => `「${line}」`).join("\n")}\n（别重复自己的话头和句式，换个说法，或者干脆说点别的。）` : "",
    `【怎么回答】
只回答一个 JSON 对象：
{"thought": "你此刻心里真实的念头（只有你自己知道，一两句）",
 "say": {"to": "P代号或空字符串", "text": "你说出口的原话；不说话就留空", "loud": false},
 "do": {"type": "${DO_TYPES.join("|")}", "target": "代号或区域id，没有就空", "person": "give/show/wait 时的 P 代号，没有就空", "minutes": 0},
 "gesture": "可选：一个看得见的、不碰到别人的小动作，比如攥紧衣角；不要写物品或位置的变化，也不要写打人推人——要动手就用 do"${innerSchemaExample}}
说话就是这个人在这一刻会说的话：口语，可长可短，可以反问、打断、开玩笑、赌气、吞吞吐吐、话里有话；孩子说孩子话。不要旁白，不要解释心理，不要书面腔。你只知道上面写到的事；悬而未决的事别当成定论。动作只有真的做了才算数：说“我做完了”不等于做完。${innerGuide}`,
  ].filter(Boolean).join("\n\n");

  const system = `你在一个持续运行的人物世界里扮演「${clean(self.name)}」。你就是这个人，不是作者、不是旁白。每一拍你只决定此刻做什么、说什么。世界会如实结算你的动作，别人听到的只有你真说出口的话。只输出 JSON。`;
  const maxInner = hybrid?.reconsider ? 3 : 2;
  const schema = {
    type: "object", additionalProperties: false, required: hybrid ? ["thought", "say", "do", "gesture", "inner"] : ["thought", "say", "do", "gesture"],
    properties: {
      thought: { type: "string" },
      say: { type: "object", additionalProperties: false, required: ["to", "text", "loud"],
        properties: { to: { type: "string", enum: ["", ...keys.people] }, text: { type: "string" }, loud: { type: "boolean" } } },
      do: { type: "object", additionalProperties: false, required: ["type", "target", "person", "minutes"],
        properties: { type: { type: "string", enum: DO_TYPES }, target: { type: "string" }, person: { type: "string", enum: ["", ...keys.people] }, minutes: { type: "number" } } },
      gesture: { type: "string" },
      ...(hybrid ? {
        inner: {
          type: "array", maxItems: maxInner,
          items: {
            type: "object", additionalProperties: false,
            required: ["kind", "text", "about", "ref", "sure"],
            properties: {
              kind: { type: "string", enum: ["belief", "feeling", "want", "bond"] },
              text: { type: "string" },
              about: { type: "string" },
              ref: { type: "string" },
              sure: { type: "string", enum: ["", "怀疑", "认定", "不再信"] },
            },
          },
        },
      } : {}),
    },
  };
  return {
    stageInput: { phase: PERFORMANCE_PHASE, protocolVersion: PERFORMANCE_PROTOCOL_VERSION, characterId: clean(self.id), agentTurnId: clean(canonicalInput.agentTurnId),
      prompt: { system, user }, schema, outputKey: "performance" },
    table: {
      people, objects, zones, work, keys, hereZone, projection, wake,
      hybrid: hybrid ? { maxInner, beliefIds: list(hybrid.ledger?.beliefs).map((b) => clean(b.id)) } : null,
    },
  };
}

export function validatePerformanceOutput(output = {}, table = {}) {
  const issues = [];
  const add = (path, message) => issues.push({ code: "PERFORMANCE_OUTPUT_INVALID", path, message });
  if (!output || typeof output !== "object") return [{ code: "PERFORMANCE_OUTPUT_INVALID", path: "output", message: "需要一个 JSON 对象。" }];
  const say = output.say || {}, act = output.do || {};
  const { keys } = table;
  if (typeof say.text !== "string") add("say.text", "say.text 必须是字符串（不说话就空字符串）。");
  if (clean(say.text).length > 400) add("say.text", "一次说话不超过 400 字。");
  if (clean(say.to) && !keys.people.includes(clean(say.to))) add("say.to", `say.to 只能是 ${keys.people.join("、") || "空"}。`);
  const type = clean(act.type);
  if (!DO_TYPES.includes(type)) { add("do.type", `do.type 只能是 ${DO_TYPES.join("|")}。`); return issues; }
  const target = clean(act.target), person = clean(act.person);
  if (type === "move" && !keys.zones.includes(target)) add("do.target", `move 的 target 只能是 ${keys.zones.join("、")}。`);
  if (["take", "take_out", "put_down", "give", "show"].includes(type) && !keys.objects.includes(target)) add("do.target", `${type} 的 target 只能是物件代号 ${keys.objects.join("、")}。`);
  if (type === "give" && !keys.people.includes(person)) add("do.person", "give 要填接收人的 P 代号。");
  if (type === "work" && !keys.starts.includes(target)) add("do.target", `work 的 target 只能是 ${keys.starts.join("、") || "（眼下没有可做的活）"}。`);
  if (type === "finish" && !keys.finishes.includes(target)) add("do.target", `finish 的 target 只能是 ${keys.finishes.join("、") || "（眼下没有能收尾的活）"}。`);
  if (["look", "listen"].includes(type) && target && ![...keys.people, ...keys.objects, ...keys.zones].includes(target)) add("do.target", "look/listen 的 target 必须是上面列出的代号。");
  if (type === "wait" && !(Number(act.minutes) >= 1 && Number(act.minutes) <= 30)) add("do.minutes", "wait 的 minutes 填 1–30。");
  if (type === "chase" && !keys.people.includes(person)) add("do.person", "chase 要填看得见的人的 P 代号。");
  if (["strike", "shove", "grab"].includes(type)) {
    if (!keys.people.includes(person)) add("do.person", "strike/shove/grab 要填就在你身边的人的 P 代号。");
    else if (!(keys.nearPeople || keys.people).includes(person)) add("do.person", "只能对就在你身边的人动手。");
  }
  if (type === "propose" && !(keys.nearPeople || []).includes(person)) add("do.person", "propose 要填就在你身边的人的 P 代号。");
  if (type === "accept" && !(keys.suitors || []).includes(person)) add("do.person", "accept 只能答应向你求过亲、就在你身边的人。");
  if (type === "offer") {
    if (!(keys.nearPeople || []).includes(person)) add("do.person", "offer 要填就在你身边的人的 P 代号。");
    if (!keys.objects.includes(target)) add("do.target", "offer 的 target 要填对方那件东西的 O 代号。");
  }
  if (type === "deal" && !(keys.dealers || []).includes(person)) add("do.person", "deal 只能答应向你提出过交换、就在你身边的人。");
  if (["drink", "eat", "fill", "pour"].includes(type)) {
    if (type === "pour" && !target) add("do.target", "pour 要填倒进哪件东西的 O 代号。");
    else if (target && !keys.objects.includes(target)) add("do.target", `${type} 的 target 要填 O 代号。`);
  }
  if (GESTURE_BLOW.test(clean(output.gesture))) add("gesture", "gesture 只写不碰到别人的小动作；要动手请用 do.type 的 strike/shove/grab。");

  if (table?.hybrid) {
    const { maxInner, beliefIds = [] } = table.hybrid;
    const inner = output.inner;
    // A missing inner means nothing changed.
    if (inner !== undefined && inner !== null) {
      if (!Array.isArray(inner)) {
        add("inner", "inner 必须是数组。");
      } else if (inner.length > maxInner) {
        add("inner", `inner 超过最多 ${maxInner} 条。`);
      } else {
        for (let i = 0; i < inner.length; i++) {
          const item = inner[i];
          if (!item || typeof item !== "object") {
            add(`inner[${i}]`, "inner 条目必须是对象。");
            continue;
          }
          const kind = clean(item.kind);
          if (!["belief", "feeling", "want", "bond"].includes(kind)) {
            add(`inner[${i}].kind`, "kind 只能是 belief、feeling、want 或 bond。");
            continue;
          }
          const about = clean(item.about);
          if (about && !keys.people.includes(about)) {
            add(`inner[${i}].about`, `about 只能是人物代号（${keys.people.join("、") || "无"}）。`);
          }
          if (["feeling", "bond"].includes(kind) && !about) {
            add(`inner[${i}].about`, `${kind} 的 about 必须填人。`);
          }
          const ref = clean(item.ref);
          const sure = clean(item.sure);
          const text = clean(item.text);
          if (kind === "belief" && ref) {
            const matched = beliefIds.some((id) => clean(id).toLowerCase() === ref.toLowerCase());
            if (!matched) {
              add(`inner[${i}].ref`, `ref ${ref} 不在当前看法列表里。`);
            } else if (!["怀疑", "认定", "不再信"].includes(sure)) {
              add(`inner[${i}].sure`, "修改看法时 sure 必须是 怀疑、认定 或 不再信。");
            }
          } else {
            if (kind === "belief" && sure === "不再信") {
              add(`inner[${i}].sure`, "新看法不能是不再信。");
            }
            if (!text || text.length > 60) {
              add(`inner[${i}].text`, "text 不能为空且不超过 60 字。");
            }
          }
        }
      }
    }
  }

  return issues;
}

/** The shared part of an attempt with no words, gesture or texture — what an empty answer lowers to. */
export function silentPayload() {
  return { visibleAction: "", bodyActions: [], observableAffectiveTexture: [], utterance: "", speechTargetCharacterId: "", vocalMode: "conversational",
    speechAct: "none", speechFunctions: [], provenance: { sourceActionId: "", sourceThreadId: "", responseToTurnId: "" }, sharedActivity: null };
}

/** Map a valid answer to one world attempt, resolving private handles to canonical ids. */
export function lowerPerformanceOutput(output = {}, table = {}) {
  const bindings = table.projection?.recipientPrivateBindings || {};
  const person = (key) => { const row = table.people.find((p) => p.key === clean(key)); return row ? clean(bindings.characterIdByEntityHandle?.[row.handle] || row.characterId || row.handle) : ""; };
  const object = (key) => { const row = table.objects.find((o) => o.key === clean(key)); return row ? clean(bindings.objectIdByObjectHandle?.[row.handle] || row.handle) : ""; };
  const say = output.say || {}, act = output.do || {};
  const utterance = clean(say.text);
  const shared = {
    visibleAction: clean(output.gesture).slice(0, 60), bodyActions: [], observableAffectiveTexture: [],
    utterance, speechTargetCharacterId: utterance ? person(say.to) : "", vocalMode: say.loud ? "call_out" : "conversational",
    speechAct: utterance ? "inform" : "none", speechFunctions: utterance ? ["inform"] : [],
    provenance: { sourceActionId: "", sourceThreadId: "", responseToTurnId: "" }, sharedActivity: null,
  };
  const type = clean(act.type);
  if (type === "none" || !type) {
    if (utterance) return { primitive: "speak", payload: { ...shared, targetCharacterId: person(say.to) } };
    return { primitive: "rest", payload: shared };
  }
  if (type === "move") {
    const zone = table.zones.find((row) => row.id === clean(act.target));
    return { primitive: "move", payload: { ...shared, destinationId: clean(zone?.path?.[0] || act.target), positionId: "" } };
  }
  if (["take", "take_out", "put_down", "give", "show"].includes(type)) {
    const operation = { take: "take", take_out: "take_out", put_down: "place", give: "transfer", show: "show" }[type];
    return { primitive: "handle", payload: { ...shared, objectId: object(act.target), operation, targetCharacterId: person(act.person) || (type === "show" ? person(say.to) : ""),
      destinationId: "", originalPrimitive: type === "give" ? "transfer" : operation } };
  }
  if (type === "work" || type === "finish") {
    const row = table.work.find((w) => w.key === clean(act.target));
    const capabilityBinding = structuredClone(bindings.affordanceBindingByHandle?.[row?.handle] || null);
    return { primitive: "use_affordance", payload: { ...shared, affordanceId: clean(capabilityBinding?.canonicalAffordanceId), capabilityBinding } };
  }
  if (type === "chase") return { primitive: "pursue", payload: { ...shared, targetCharacterId: person(act.person) } };
  if (["strike", "shove", "grab"].includes(type)) return { primitive: "confront", payload: { ...shared, act: type, targetCharacterId: person(act.person) } };
  if (["propose", "accept"].includes(type)) return { primitive: "marriage", payload: { ...shared, act: type, targetCharacterId: person(act.person) } };
  if (["offer", "deal"].includes(type)) return { primitive: "exchange", payload: { ...shared, act: type, targetCharacterId: person(act.person), objectId: type === "offer" ? object(act.target) : "" } };
  if (["drink", "eat", "fill", "pour"].includes(type)) return { primitive: "sustain", payload: { ...shared, act: type, objectId: object(act.target) } };
  if (type === "sleep") return { primitive: "sleep", payload: shared };
  if (type === "wait") {
    const target = person(act.person);
    return { primitive: "wait", payload: { ...shared, targetCharacterId: target,
      waitCondition: { condition: target ? "target_speech" : "new_evidence", maximumSeconds: Math.round(Number(act.minutes) * 60), interruptOnDirectSpeech: true } } };
  }
  const targetKey = clean(act.target);
  const targetKind = table.keys.people.includes(targetKey) ? "character" : table.keys.objects.includes(targetKey) ? "object" : targetKey ? "place" : "scene";
  const targetId = targetKind === "character" ? person(targetKey) : targetKind === "object" ? object(targetKey) : targetKey;
  return { primitive: type === "listen" ? "listen" : "observe", payload: { ...shared, targetKind, targetId } };
}

/** The character's own stated thought, plus where they are still heading when a walk takes several hops. */
export function performanceIntention(output = {}, table = {}) {
  const zone = clean(output.do?.type) === "move" ? list(table.zones).find((row) => row.id === clean(output.do?.target)) : null;
  const heading = zone && zone.path?.length > 1 ? `（正往${zone.label}去，还没走到）` : "";
  return `${clean(output.thought).slice(0, 160)}${heading}`;
}

/**
 * After an active beat the character gets one more opportunity to think once
 * that step has objectively settled; it never pre-selects what they do next.
 * Waiting and simply staying put leave the next opportunity to real evidence,
 * a deadline or the wait's own time limit.
 */
export function performanceContinuations(actionAttempt = null, agentTurnId = "", nowSeconds = 0, walkTarget = "") {
  const primitive = clean(actionAttempt?.primitive);
  if (!primitive || ["wait", "rest", "none", "sleep"].includes(primitive)) return [];
  if (walkTarget) {
    return [{
      intentionId: `${OWN_WALK_INTENTION_PREFIX}${clean(agentTurnId)}`,
      triggerType: "own_action_settled",
      status: "active",
      intendedPrimitive: "move",
      targetHandle: walkTarget,
      linkedSourceIds: [],
      minimumDelaySeconds: 0,
      triggerThreshold: 0.5,
      maxDeferrals: 0,
      deferrals: 0,
      createdAtCharacterSeconds: Math.max(0, Number(nowSeconds || 0)),
      privatePurpose: "走到自己要去的地方。",
    }];
  }
  return [{
    intentionId: `performance-beat:${clean(agentTurnId)}:next`,
    triggerType: "own_action_settled",
    status: "active",
    intendedPrimitive: "",
    targetHandle: "",
    linkedSourceIds: [],
    minimumDelaySeconds: 0,
    triggerThreshold: 0.5,
    maxDeferrals: 0,
    deferrals: 0,
    createdAtCharacterSeconds: Math.max(0, Number(nowSeconds || 0)),
    privatePurpose: "这一步落定后，再看一眼处境，自己决定接下来做什么。",
  }];
}

export function emptyInnerLedger() {
  return { beliefs: [], nextBeliefId: 1, feelings: [], wants: [] };
}

const SURE_STATUS = { "怀疑": "suspected", "认定": "held", "不再信": "dropped" };

export function applyInnerChanges(ledger, inner, table, { nowSeconds = 0 } = {}) {
  const base = ledger ? {
    beliefs: list(ledger.beliefs).map((b) => ({ ...b })),
    nextBeliefId: Number(ledger.nextBeliefId || 1),
    feelings: list(ledger.feelings).map((f) => ({ ...f })),
    wants: list(ledger.wants).map((w) => ({ ...w })),
  } : emptyInnerLedger();

  const changes = [];
  if (!Array.isArray(inner) || !inner.length) {
    return { ledger: base, changes };
  }

  const bindings = table?.projection?.recipientPrivateBindings || {};
  const resolvePerson = (key) => {
    const row = list(table?.people).find((p) => p.key === clean(key));
    if (!row) return { id: "", name: "" };
    const id = clean(bindings.characterIdByEntityHandle?.[row.handle] || row.characterId || row.handle);
    return { id, name: clean(row.name) };
  };

  for (const item of inner) {
    if (!item || typeof item !== "object") continue;
    const kind = clean(item.kind);
    const text = clean(item.text);
    const ref = clean(item.ref);
    const sureRaw = clean(item.sure);
    const mappedSure = SURE_STATUS[sureRaw] || "";

    if (kind === "belief" && ref) {
      const idx = base.beliefs.findIndex((b) => clean(b.id).toLowerCase() === ref.toLowerCase());
      if (idx === -1 || !mappedSure) continue;
      const existing = base.beliefs[idx];
      const changeText = text || existing.text;
      const aboutName = existing.aboutName || "";
      if (mappedSure === "dropped") {
        base.beliefs.splice(idx, 1);
        changes.push({ kind: "belief", text: changeText, aboutName, sure: "dropped" });
      } else {
        existing.status = mappedSure;
        if (text) existing.text = text;
        existing.sinceSeconds = Number(nowSeconds || 0);
        changes.push({ kind: "belief", text: changeText, aboutName, sure: mappedSure });
      }
    } else if (kind === "belief" && !ref && text) {
      const person = resolvePerson(item.about);
      const status = mappedSure === "held" ? "held" : "suspected";
      const newBelief = {
        id: `b${base.nextBeliefId}`,
        text,
        status,
        aboutId: person.id,
        aboutName: person.name,
        sinceSeconds: Number(nowSeconds || 0),
      };
      base.beliefs.push(newBelief);
      base.nextBeliefId += 1;
      if (base.beliefs.length > 8) {
        base.beliefs = base.beliefs.slice(-8);
      }
      changes.push({ kind: "belief", text, aboutName: person.name, sure: status });
    } else if (kind === "feeling" && text) {
      const person = resolvePerson(item.about);
      if (!person.id) continue;
      base.feelings = base.feelings.filter((f) => f.aboutId !== person.id);
      base.feelings.push({
        aboutId: person.id,
        aboutName: person.name,
        text,
        sinceSeconds: Number(nowSeconds || 0),
      });
      if (base.feelings.length > 6) {
        base.feelings = base.feelings.slice(-6);
      }
      changes.push({ kind: "feeling", text, aboutName: person.name, sure: "" });
    } else if (kind === "bond" && text) {
      const person = resolvePerson(item.about);
      if (!person.id) continue;
      changes.push({ kind: "bond", text, aboutId: person.id, aboutName: person.name, sure: "" });
    } else if (kind === "want" && text) {
      base.wants = base.wants.filter((w) => w.text !== text);
      base.wants.unshift({
        text,
        sinceSeconds: Number(nowSeconds || 0),
      });
      if (base.wants.length > 3) {
        base.wants = base.wants.slice(0, 3);
      }
      changes.push({ kind: "want", text, aboutName: "", sure: "" });
    }
  }

  return { ledger: base, changes };
}
