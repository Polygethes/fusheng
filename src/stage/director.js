// Turns settled frames into stage animation. Every movement, utterance and
// object change shown here comes from a frame; nothing is invented.
import { O, T, R, D, oval } from "./pixel.js";
import { sprite, iconForObject } from "./sprites.js";
import { routeTiles, mapAtTile } from "../worlds/layoutAtlas.mjs";

const FAILURES = {
  OBJECT_NOT_IN_HAND: "物品尚未拿在手中", OBJECT_NOT_HELD: "未持有该物品", WORK_SKILL_MISSING: "缺少所需技能",
  WORK_WRONG_ZONE: "不在做活的地方", WORK_REQUIRED_TOOL_NOT_HELD: "手里没有所需工具", WORK_ACTOR_ALREADY_ENGAGED: "手上已有活没做完",
  MOVE_TARGET_UNREACHABLE: "去不了那里", OBJECT_NOT_REACHABLE: "够不着那件东西", WORK_UNITS_ALREADY_COMPLETE: "活已经做完了",
  MOVE_BLOCKED_BY_FLOOD: "水太深，过不去",
  MOVE_HELD: "被人抓着，挣不脱",
  CONFRONT_TARGET_NOT_HERE: "对方不在身边",
  CONFRONT_TARGET_DOWN: "对方已经倒在地上",
  MARRY_TARGET_UNKNOWN: "没有这个人",
  MARRY_TARGET_NOT_HERE: "对方不在身边",
  MARRY_TARGET_DOWN: "对方倒在地上",
  MARRY_NOT_GROWN: "还没成年",
  MARRY_ALREADY_MARRIED: "已经成过家了",
  MARRY_KIN: "是亲人，不能成亲",
  MARRY_NO_PROPOSAL: "对方没有向你求过亲",
  SUSTAIN_ACT_UNKNOWN: "不知道要做什么",
  DRINK_TARGET_UNKNOWN: "没有这个东西", DRINK_TARGET_NOT_HERE: "那东西不在身边", DRINK_NOTHING_TO_DRINK: "里面没有能喝的", DRINK_NO_WATER_HERE: "身边没有水",
  EAT_TARGET_UNKNOWN: "没有这个东西", EAT_TARGET_NOT_HERE: "那东西不在身边", EAT_NOTHING_TO_EAT: "没有做好的饭",
  FILL_TARGET_UNKNOWN: "没有这个东西", FILL_TARGET_NOT_HERE: "那东西不在身边", FILL_NOT_HELD: "手里没有拿着能装水的东西", FILL_NOT_A_VESSEL: "那东西装不了水",
  FILL_ALREADY_FULL: "已经装满了", FILL_NO_WATER_HERE: "这里没有水可打",
  POUR_TARGET_UNKNOWN: "没说倒进哪里", POUR_TARGET_NOT_HERE: "那东西不在身边", POUR_TARGET_NOT_A_VESSEL: "那东西装不了水",
  POUR_NOTHING_IN_HAND: "手里没有装着水的东西", POUR_TARGET_FULL: "已经满了",
  EXCHANGE_ACT_UNKNOWN: "不知道要做什么", EXCHANGE_TARGET_UNKNOWN: "没有这个人", EXCHANGE_TARGET_NOT_HERE: "对方不在身边",
  EXCHANGE_TARGET_DOWN: "对方倒在地上", EXCHANGE_NOT_THEIRS: "那东西不在对方身上", EXCHANGE_NOTHING_IN_HAND: "手里没有拿着能换的东西",
  EXCHANGE_NO_OFFER: "对方没有提出过交换", EXCHANGE_NOT_FOR_TRADE: "人不是拿来换的",
  CHASE_ACTOR_UNKNOWN: "不知道是谁在追", CHASE_TARGET_UNKNOWN: "没有这个人", CHASE_TARGET_GONE: "对方已经不在这一带了", CHASE_NO_WAY: "没有路过去",
};
const VERBS = { pickup: "拿起", take_out: "取出", place: "放下", store: "收起", hide: "藏起", show: "亮出", draw: "拔出", sheathe: "收回", consume: "吃下" };

export function createDirector({ world, initial, layout, scene, atlas }) {
  const members = new Map(world.cast.map((row) => [row.id, row]));
  const zoneLabel = (id) => world.zones?.[id] || layout.zones?.[id]?.label || id;
  const work = new Map((world.work || []).map((row) => [row.templateId, row]));
  const nameOf = (id) => members.get(id)?.name || id;
  let objects = structuredClone(initial.objects);
  let entities = structuredClone(initial.entities);
  let agenda = structuredClone(initial.agenda || []);
  const actors = new Map();
  const occupancy = new Map();
  let frames = [];
  let cursor = -1;
  let anim = null;
  let effects = [];
  let dialog = { mode: "action", speaker: null, to: [], text: "", shown: 0, tag: "" };
  let clockSeconds = initial.nowSeconds || 0;
  const listeners = new Set();
  const jumpListeners = new Set();

  const tileCenter = ([x, y]) => [x * T + 8, y * T + 13];
  // A free spot in the zone: the one nearest `near` (a tile) when given, so a
  // person stops just inside the door they came through or right by the thing
  // they are about to handle, not always at the zone's first spot.
  function takeSpot(zoneId, actorId, near = null) {
    const spots = layout.spots?.[zoneId] || [];
    const used = occupancy.get(zoneId) || new Map();
    occupancy.set(zoneId, used);
    const free = [...spots.entries()].filter(([index]) => ![...used.values()].includes(index));
    if (near && free.length) free.sort(([, a], [, b]) => Math.hypot(a[0] - near[0], a[1] - near[1]) - Math.hypot(b[0] - near[0], b[1] - near[1]));
    for (const [index, spot] of free) { used.set(actorId, index); return spot; }
    const base = spots[0] || [0, 0];
    used.set(actorId, -1);
    return [base[0] + ((used.size % 3) - 1) * 0.6, base[1] + 0.4];
  }
  function leaveSpot(zoneId, actorId) { occupancy.get(zoneId)?.delete(actorId); }

  // The door tile on the destination's side between two zones, if there is one.
  function entryTile(fromZone, toZone) {
    const destinationMap = atlas?.mapOfZone?.[toZone];
    const doors = (layout.doors || []).filter((row) => row.between?.includes(fromZone) && row.between?.includes(toZone));
    for (const door of doors) for (const tile of door.tiles || []) if (!atlas || mapAtTile(atlas, tile) === destinationMap) return tile;
    return null;
  }

  // Walk up to a fixed thing in the same zone before handling or looking at it.
  function approach(actor, objectId) {
    const spec = layout.objects?.[objectId];
    if (!actor || !spec?.at || spec.zoneId !== actor.zone || objects[objectId]?.holder) return false;
    leaveSpot(actor.zone, actor.id);
    const spot = takeSpot(actor.zone, actor.id, spec.at);
    const tile = [Math.round(spot[0]), Math.round(spot[1])];
    if (tile[0] === actor.tile[0] && tile[1] === actor.tile[1]) return false;
    const route = atlas ? routeTiles(atlas, scene.walkable, actor.tile, tile) : null;
    actor.path = (route || [{ tile, jump: true }]).map(({ tile: at, jump }) => ({ at: tileCenter(at), jump: Boolean(jump) }));
    actor.tile = tile;
    actor.bed = null;
    return true;
  }

  // Lying down: someone resting, waiting or asleep in a room with a bed lies
  // on it; the next thing they actually do (other than talk, look or listen)
  // gets them up.
  const BEDS = (layout.props || []).filter((row) => ["bed", "sickbed"].includes(row.kind) && row.zoneId);
  const LYING_KEEPS = new Set(["rest", "wait", "speak", "observe", "listen", "planning", "sleep"]);
  function settleBed(actor, frame) {
    if (!actor || frame.type === "world") return;
    const zone = entities[actor.id]?.zoneId || actor.zone;
    if (["rest", "wait", "sleep"].includes(frame.kind) && frame.status !== "failed") {
      if (actor.bed?.zoneId === zone) return;
      const taken = new Set([...actors.values()].filter((a) => a !== actor && a.bed).map((a) => a.bed));
      actor.bed = BEDS.find((row) => row.zoneId === zone && !taken.has(row)) || null;
    } else if (!LYING_KEEPS.has(frame.kind)) actor.bed = null;
  }

  function placeActors() {
    occupancy.clear();
    for (const [id, row] of Object.entries(entities)) {
      const spot = takeSpot(row.zoneId, id);
      const [x, y] = tileCenter(spot);
      const prior = actors.get(id);
      actors.set(id, { id, x, y, tile: [Math.round(spot[0]), Math.round(spot[1])], zone: row.zoneId, dir: prior?.dir || "down",
        path: [], step: 0, inHand: prior?.inHand || new Set(), hidden: Boolean(layout.zones?.[row.zoneId]?.offstage) || row.present === false,
        bed: prior?.bed?.zoneId === row.zoneId ? prior.bed : null,
        fallen: ["down", "dead"].includes(row.condition) });
    }
  }
  placeActors();

  function face(actor, target) {
    if (!target) return;
    const dx = target.x - actor.x, dy = target.y - actor.y;
    actor.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? "left" : "right") : dy < 0 ? "up" : "down";
  }
  const handPos = (a) => (a.dir === "down" ? [a.x + 3, a.y - 9] : a.dir === "left" ? [a.x - 9, a.y - 9] : a.dir === "right" ? [a.x + 1, a.y - 9] : [a.x - 6, a.y - 11]);
  function restPos(objectId) {
    const spec = layout.objects?.[objectId];
    const o = objects[objectId];
    if (spec?.at && (!o || !o.zoneId || o.zoneId === spec.zoneId)) return [spec.at[0] * T + 4, spec.at[1] * T];
    const drop = layout.spots?.[o?.zoneId]?.[0];
    return drop ? [drop[0] * T + 9, drop[1] * T + 6] : [0, 0];
  }
  const objectLabel = (id) => objects[id]?.label || id;

  function applyChanges(frame) {
    for (const [id, row] of Object.entries(frame.changes?.objects || {})) objects[id] = row;
    for (const [id, row] of Object.entries(frame.changes?.entities || {})) {
      entities[id] = { ...(entities[id] || {}), ...row };
      if ("condition" in row) {
        const a = actors.get(id);
        if (a) a.fallen = ["down", "dead"].includes(row.condition);
      }
    }
    // Someone the water took is gone from the stage.
    for (const [id, row] of Object.entries(frame.changes?.entities || {})) if (row.present === false) { const gone = actors.get(id); if (gone) gone.hidden = true; }
    if (frame.kind === "deadline") { const item = agenda.find((row) => row.id === frame.deadlineId); if (item) item.status = frame.status; }
    if (Number.isFinite(frame.worldSeconds)) clockSeconds = Math.max(clockSeconds, frame.worldSeconds);
    const actor = actors.get(frame.actorId);
    if (actor && frame.status !== "failed") {
      const changed = Object.entries(frame.changes?.objects || {});
      if (["pickup", "take_out"].includes(frame.kind)) for (const [id, row] of changed) if (row.holder === actor.id) actor.inHand.add(id);
      if (["place", "store", "hide"].includes(frame.kind)) for (const [id] of changed) actor.inHand.delete(id);
      if (frame.kind === "transfer") for (const [id, row] of changed) { actor.inHand.delete(id); actors.get(row.holder)?.inHand.add(id); }
    }
    for (const a of actors.values()) for (const id of [...a.inHand]) if (objects[id]?.holder !== a.id) a.inHand.delete(id);
    settleBed(actor, frame);
    if (frame.type === "world") for (const [id, row] of Object.entries(frame.changes?.objects || {})) if (row.holder) actors.get(row.holder)?.inHand.add(id);
  }

  function caption(frame) {
    const base = actionCaption(frame);
    if (base && frame.ownPlanStep) return { ...base, tag: [base.tag, "按自己的日程"].filter(Boolean).join(" · ") };
    if (!base || !frame.utterance || frame.kind === "speak" || frame.status === "failed" || frame.type === "world") return base;
    return { mode: "speech", text: frame.utterance, to: frame.targetCharacterId ? [frame.targetCharacterId] : [], tag: [frame.vocalMode === "call_out" ? "高声" : "", base.text].filter(Boolean).join(" · ") };
  }

  // A glance, a pause or a wait with nothing said is shown on the map only;
  // the dialog box keeps the last thing that was actually said or done.
  const QUIET = new Set(["observe", "listen", "rest", "wait"]);
  function actionCaption(frame) {
    const who = nameOf(frame.actorId);
    const changedId = Object.keys(frame.changes?.objects || {})[0] || frame.objectId;
    const thing = changedId ? objectLabel(changedId) : "东西";
    if (frame.type === "private") return { mode: "private", text: `${who}在心里盘算接下来的事。`, tag: "私人 · 不是已发生的事" };
    if (frame.kind === "deadline") return { mode: "system", text: `【时限】${frame.label} — ${{ world_deadline_warning: "快到了", world_deadline_due: "到时辰了", world_deadline_fulfilled: "按时办妥", world_deadline_readiness_changed: "条件有变化" }[frame.change] || frame.status}`, tag: "世界" };
    if (frame.kind === "life") return { mode: "system", text: frame.caption, tag: "世事" };
    if (frame.kind === "world_event") return { mode: "system", text: frame.caption, tag: "天意" };
    if (frame.kind === "environment") return { mode: "system", text: frame.caption, tag: "世界" };
    if (frame.kind === "marriage" && frame.status !== "failed") return { mode: "action", text: frame.caption, tag: "婚事" };
    if (frame.kind === "exchange" && frame.status !== "failed") return { mode: "action", text: frame.caption, tag: "交换" };
    if (frame.kind === "sustain" && frame.status !== "failed") return { mode: "action", text: frame.caption, tag: "" };
    if (frame.kind === "sleep" && frame.status !== "failed") return { mode: "action", text: frame.caption, tag: "" };
    if (frame.kind === "woke") return { mode: "system", text: frame.caption, tag: "" };
    if (frame.kind === "confront" && frame.status !== "failed") return { mode: "action", text: frame.caption, tag: "动手" };
    if (frame.kind === "pursue" && frame.status !== "failed") return { mode: "action", text: frame.caption, tag: "追" };
    if (frame.kind === "process_ready") return { mode: "action", text: frame.caption || "手上的活可以收尾了。", tag: "世界" };
    if (frame.kind === "clock") return null;
    if (frame.status === "failed") return { mode: "system", text: `${who}想${VERBS[frame.kind] || "这么做"}${changedId ? thing : ""}——没有发生。${(frame.failureLabels || []).join("、") || (frame.failureCodes || []).map((code) => FAILURES[code] || code).join("、")}`, tag: "世界结算" };
    if (QUIET.has(frame.kind) && !frame.utterance) return null;
    if (frame.kind === "speak") return { mode: "speech", text: frame.utterance, to: frame.targetCharacterId ? [frame.targetCharacterId] : [], tag: frame.vocalMode === "call_out" ? "高声" : "" };
    if (frame.kind === "move") return { mode: "action", text: `${who}走到${zoneLabel(frame.toZone)}。`, tag: "" };
    if (frame.kind === "transfer") { const [id, row] = Object.entries(frame.changes?.objects || {})[0] || []; return { mode: "action", text: `${who}把${id ? objectLabel(id) : "东西"}交给${nameOf(row?.holder)}。`, tag: "" }; }
    if (VERBS[frame.kind]) return { mode: "action", text: `${who}${VERBS[frame.kind]}${thing}。${frame.ownerNames?.length ? `那是${frame.ownerNames.join("、")}的东西。` : ""}`, tag: frame.ownerNames?.length ? "拿了别人的东西" : "" };
    if (frame.kind === "work_start") return { mode: "action", text: `${who}开始${work.get(frame.workTemplateId)?.unitAction || "干活"}。`, tag: "工作已开始，尚未完成" };
    if (frame.kind === "work_done") return { mode: "action", text: `${who}做完了这一${work.get(frame.workTemplateId)?.unitLabel || "份"}。`, tag: "世界结算：完成" };
    if (frame.kind === "observe") return { mode: "action", text: `${who}看向${members.has(frame.targetId) ? nameOf(frame.targetId) : objectLabel(frame.targetId) || zoneLabel(frame.targetId) || "四周"}。`, tag: "" };
    if (frame.kind === "listen") return { mode: "action", text: `${who}侧耳听着。`, tag: "" };
    if (frame.kind === "rest" || frame.kind === "wait") return { mode: "action", text: frame.caption || `${who}停下来${frame.kind === "wait" ? "等着" : "歇一歇"}。`, tag: "" };
    return { mode: "action", text: frame.caption || `${who}动了一下。`, tag: "" };
  }

  function setDialog(frame) {
    const c = caption(frame);
    if (!c) return;
    dialog = { mode: c.mode, speaker: frame.actorId || null, to: c.to || [], heard: (frame.perceivedBy || []).filter((id) => id !== frame.actorId), text: c.text, shown: 0, tag: c.tag };
  }

  function start(index) {
    cursor = index;
    const frame = frames[index];
    for (const a of actors.values()) { a.bubble = null; a.icon = null; a.swing = 0; }
    const actor = actors.get(frame.actorId);
    anim = { frame, t: 0, done: false, hold: 0 };
    setDialog(frame);
    if (!actor || frame.type === "world" && frame.kind !== "process_ready") { applyChanges(frame); anim.done = true; emit(); return; }
    if (frame.kind === "process_ready") { for (const id of frame.actorIds || []) { const a = actors.get(id); if (a) a.icon = "bell"; } applyChanges(frame); anim.done = true; emit(); return; }
    if (frame.type === "private") { actor.icon = "thought"; anim.done = true; emit(); return; }
    if (frame.utterance && frame.status !== "failed") {
      actor.bubble = "speak";
      for (const id of frame.perceivedBy || []) { const a = actors.get(id); if (a && a !== actor) a.icon = "heard"; }
    }
    if (frame.status === "failed") { actor.icon = "fail"; actor.failText = (frame.failureLabels?.[0]) || FAILURES[frame.failureCodes?.[0]] || frame.failureCodes?.[0] || ""; actor.shake = 0.5; anim.until = 2.2; emit(); return; }
    if (actor.bed && !LYING_KEEPS.has(frame.kind)) { actor.bed = null; [actor.x, actor.y] = tileCenter(actor.tile); } // getting up to do something
    if (frame.kind === "marriage") { const target = actors.get(frame.targetCharacterId); face(actor, target); if (target) face(target, actor); anim.until = 1.2; emit(); return; }
    if (frame.kind === "exchange") { const target = actors.get(frame.targetCharacterId); face(actor, target); if (target) face(target, actor); anim.until = 1.2; emit(); return; }
    if (frame.kind === "sustain") { anim.until = 1; emit(); return; }
    if (frame.kind === "confront") {
      const target = actors.get(frame.targetCharacterId);
      face(actor, target); if (target) face(target, actor);
      if (target && ["hit", "felled", "killed", "knocked_down", "pushed_back"].includes(frame.outcome)) target.shake = 0.6;
      if (!frame.utterance && frame.caption) { actor.bubble = "gesture"; actor.gestureText = frame.caption; }
      anim.until = 1.2; emit(); return;
    }
    if (["move", "pursue"].includes(frame.kind)) {
      const toZone = frame.changes?.entities?.[actor.id]?.zoneId || frame.toZone;
      leaveSpot(actor.zone, actor.id);
      const spot = takeSpot(toZone, actor.id, entryTile(actor.zone, toZone) || actor.tile);
      const targetTile = [Math.round(spot[0]), Math.round(spot[1])];
      const route = atlas ? routeTiles(atlas, scene.walkable, actor.tile, targetTile) : null;
      actor.path = (route || [{ tile: targetTile, jump: true }]).map(({ tile, jump }) => ({ at: tileCenter(tile), jump: Boolean(jump) }));
      actor.target = { zone: toZone, tile: targetTile, center: tileCenter(spot) };
      actor.hidden = false;
      emit(); return;
    }
    if (frame.kind === "speak") {
      const target = actors.get(frame.targetCharacterId) || actors.get(frame.perceivedBy?.[0]);
      face(actor, target); actor.bubble = "speak";
      for (const id of frame.perceivedBy || []) { const a = actors.get(id); if (a && a !== actor) a.icon = "heard"; }
      emit(); return;
    }
    const changed = Object.entries(frame.changes?.objects || {});
    const handled = frame.kind === "observe" ? frame.targetId : frame.kind === "pickup" ? (changed[0]?.[0] || frame.objectId)
      : ["work_start", "work_done"].includes(frame.kind) ? (work.get(frame.workTemplateId)?.objectIds || []).find((id) => layout.objects?.[id]?.at) : "";
    if (handled && approach(actor, handled)) { anim.approaching = true; face(actor, { x: layout.objects[handled].at[0] * T + 8, y: layout.objects[handled].at[1] * T + 8 }); }
    if (["pickup", "take_out"].includes(frame.kind) && changed.length) {
      const [id] = changed[0];
      anim.fly = { id, from: frame.kind === "take_out" ? [actor.x, actor.y - 12] : restPos(id), to: () => handPos(actor), t: 0 };
      anim.until = 0.7; emit(); return;
    }
    if (frame.kind === "transfer" && changed.length) {
      const [id, row] = changed[0]; const receiver = actors.get(row.holder);
      face(actor, receiver); if (receiver) face(receiver, actor);
      actor.inHand.delete(id);
      anim.fly = { id, from: handPos(actor), to: () => (receiver ? handPos(receiver) : restPos(id)), t: 0 };
      anim.until = 0.9; emit(); return;
    }
    if (["place", "store", "hide"].includes(frame.kind) && changed.length) {
      const [id] = changed[0]; actor.inHand.delete(id);
      objects[id] = changed[0][1];
      anim.fly = { id, from: handPos(actor), to: () => (frame.kind === "place" ? restPos(id) : [actor.x, actor.y - 10]), t: 0 };
      anim.until = 0.7; emit(); return;
    }
    if (frame.kind === "show") { actor.icon = "show"; actor.showId = Object.keys(frame.changes?.objects || {})[0] || frame.objectId; anim.until = 1.6; emit(); return; }
    if (frame.kind === "work_start" || frame.kind === "work_done") { actor.dir = "up"; actor.working = frame; anim.until = frame.kind === "work_done" ? 1.6 : 2.2; emit(); return; }
    if (frame.kind === "observe") { actor.icon = "eye"; if (!frame.utterance && frame.caption) { actor.bubble = "gesture"; actor.gestureText = frame.caption; } const target = actors.get(frame.targetId); if (target) face(actor, target); anim.gaze = target ? () => [target.x, target.y - 12] : (layout.objects?.[frame.targetId]?.at ? () => restPos(frame.targetId) : null); anim.until = frame.utterance ? 1.7 : 0.8; emit(); return; }
    if (frame.kind === "listen") { actor.icon = "ear"; anim.until = frame.utterance ? 1.4 : 0.6; emit(); return; }
    if (frame.kind === "rest" || frame.kind === "wait") {
      actor.icon = "rest";
      if (!frame.utterance && frame.caption) { actor.bubble = "gesture"; actor.gestureText = frame.caption; }
      anim.until = frame.utterance ? 0.4 : 0.5; emit(); return;
    }
    if (!frame.utterance) { actor.bubble = frame.caption ? "gesture" : null; actor.gestureText = frame.caption; }
    anim.until = 1.5; emit();
  }

  function finish() {
    if (!anim || anim.done) return;
    const frame = anim.frame;
    applyChanges(frame);
    const actor = actors.get(frame.actorId);
    if (actor) {
      if (["move", "pursue"].includes(frame.kind) && actor.target) {
        actor.zone = actor.target.zone; actor.tile = actor.target.tile; [actor.x, actor.y] = actor.target.center; actor.target = null;
        actor.hidden = Boolean(layout.zones?.[actor.zone]?.offstage);
      }
      if (frame.kind === "work_done") effects.push({ kind: "pop", x: actor.x, y: actor.y - 30, text: `+1 ${work.get(frame.workTemplateId)?.unitLabel || ""}`.trim(), t: 0 });
      if (["pickup", "take_out"].includes(frame.kind)) { const id = Object.keys(frame.changes?.objects || {})[0]; if (id) effects.push({ kind: "pop", x: actor.x, y: actor.y - 30, text: `+${objectLabel(id)}`, t: 0 }); }
      actor.working = null;
    }
    anim.done = true;
    emit();
  }

  function snap(index) {
    objects = structuredClone(initial.objects);
    entities = structuredClone(initial.entities);
    agenda = structuredClone(initial.agenda || []);
    clockSeconds = initial.nowSeconds || 0;
    for (const a of actors.values()) a.inHand = new Set();
    for (let i = 0; i < index; i++) applyChanges(frames[i]);
    placeActors();
    effects = [];
    anim = null;
  }

  function update(dt, { playing, speed }) {
    const step = dt * speed;
    for (const a of actors.values()) {
      if (a.path?.length) {
        const next = a.path[0];
        if (next.jump) {
          [a.x, a.y] = next.at;
          a.tile = [Math.round((a.x - 8) / T), Math.round((a.y - 13) / T)];
          a.path.shift();
          for (const fn of jumpListeners) fn(a.id);
          continue;
        }
        const [tx, ty] = next.at, dx = tx - a.x, dy = ty - a.y, dist = Math.hypot(dx, dy), v = 46 * step;
        if (Math.abs(dx) > Math.abs(dy)) a.dir = dx < 0 ? "left" : "right"; else if (dist > 0) a.dir = dy < 0 ? "up" : "down";
        if (dist <= v) { a.x = tx; a.y = ty; a.tile = [Math.round((a.x - 8) / T), Math.round((a.y - 13) / T)]; a.path.shift(); } else { a.x += (dx / dist) * v; a.y += (dy / dist) * v; a.tile = [Math.round((a.x - 8) / T), Math.round((a.y - 13) / T)]; }
        a.step += step * 7;
      } else a.step = 0;
      if (a.shake > 0) a.shake -= step;
    }
    for (const e of effects) e.t += step;
    effects = effects.filter((e) => e.t < (e.life || 1.4));
    if (dialog.shown < dialog.text.length) dialog.shown = Math.min(dialog.text.length, dialog.shown + step * 24);
    if (!anim) { if (playing && cursor + 1 < frames.length) start(cursor + 1); return; }
    const frame = anim.frame, actor = actors.get(frame.actorId);
    // Walking up to the thing comes first; the action itself waits.
    const approaching = anim.approaching && !anim.done && actor?.path?.length > 0;
    if (!approaching) anim.t += step;
    if (approaching) { /* still walking up to it */ }
    else if (!anim.done) {
      if (["move", "pursue"].includes(frame.kind) && actor && !actor.path.length && anim.t > 0.15) finish();
      else if ((frame.kind === "speak" || (frame.utterance && !anim.fly && !["move", "pursue"].includes(frame.kind))) && dialog.shown >= dialog.text.length && anim.t > 0.4) finish();
      else if (anim.fly) { anim.fly.t += step * 1.6; if (anim.fly.t >= 1) finish(); }
      else if (anim.until && anim.t >= anim.until) finish();
      else if (!anim.until && !["move", "pursue"].includes(frame.kind) && frame.kind !== "speak") finish();
      if (actor?.working && Math.floor((anim.t - step) * 2.6) !== Math.floor(anim.t * 2.6)) {
        actor.swing = Math.floor(anim.t * 2.6) % 2;
        if (!actor.swing) for (let i = 0; i < 4; i++) effects.push({ kind: "chip", x: actor.x, y: actor.y - 18, vx: (Math.random() - 0.5) * 50, vy: -30 - Math.random() * 30, t: 0, life: 0.6 });
      }
    } else {
      anim.hold += step;
      const need = frame.type === "private" ? 0.9 : frame.kind === "speak" || frame.utterance ? 1.2 + Math.min(6, dialog.text.length * 0.06) : frame.kind === "clock" ? 0.05 : QUIET.has(frame.kind) ? 0.15 : 0.6;
      if (anim.hold > need && playing) { if (cursor + 1 < frames.length) start(cursor + 1); else anim = { ...anim, idle: true }; }
    }
    for (const e of effects) if (e.kind === "chip") { e.x += e.vx * step; e.y += e.vy * step; e.vy += 120 * step; }
  }

  function draw(c, t, selected) {
    const held = new Set();
    const order = [...actors.values()].filter((a) => !a.hidden).sort((a, b) => a.y - b.y);
    for (const a of order) for (const id of a.inHand) held.add(id);
    if (anim?.fly && !anim.done) held.add(anim.fly.id);
    return { held, drawActors: () => {
      for (const a of order) {
        const member = members.get(a.id) || { id: a.id, appearance: {} };
        if (a.fallen && !a.path?.length) { drawFallen(c, a, member, selected); continue; }
        if (a.bed && !a.path?.length) { drawLying(c, a, member, selected); continue; }
        const leg = a.path?.length ? (Math.floor(a.step) % 2 ? 1 : 2) : 0;
        const breath = leg ? 0 : Math.floor(t * 1.4 + a.x * 0.13) % 2;
        const sx = Math.round(a.x - 7 + (a.shake > 0 ? Math.sin(t * 60) * 1.5 : 0)), sy = Math.round(a.y - 21 - (leg ? 1 : 0));
        oval(c, Math.round(a.x), Math.round(a.y), 5, 2, "rgba(10,6,12,.45)");
        const sp = sprite(member, a.dir, leg);
        if (breath) { c.drawImage(sp, 0, 0, 14, 12, sx, sy + 1, 14, 12); c.drawImage(sp, 0, 12, 14, 10, sx, sy + 12, 14, 10); } else c.drawImage(sp, sx, sy);
        const [hx, hy] = handPos(a);
        let k = 0;
        for (const id of a.inHand) { c.drawImage(iconForObject(id, objectLabel(id), layout.objects?.[id]?.drawer), Math.round(hx + k * 4), Math.round(hy - (a.swing ? 6 : 0))); k++; }
        if (a.working && !a.inHand.size) { R(c, sx + (a.swing ? 2 : 10), sy + (a.swing ? 2 : 12), 2, 5, "#c8a070"); }
        if (a.id === selected) { R(c, sx + 3, sy - 4, 8, 1, "#e8c160"); D(c, sx + 6, sy - 3, "#e8c160"); D(c, sx + 7, sy - 3, "#e8c160"); }
      }
    } };
  }

  // Fallen: the body on its side on the ground, head to the left.
  function drawFallen(c, a, member, selected) {
    const x = Math.round(a.x), y = Math.round(a.y);
    oval(c, x, y, 10, 2, "rgba(10,6,12,.45)");
    c.save(); c.translate(x - 11, y + 1); c.rotate(-Math.PI / 2); c.drawImage(sprite(member, "down", 0), 0, 0); c.restore();
    if (a.id === selected) { R(c, x - 4, y - 18, 8, 1, "#e8c160"); D(c, x - 1, y - 17, "#e8c160"); D(c, x, y - 17, "#e8c160"); }
  }

  // In bed: the head on the pillow, the body a mound under the quilt. Words
  // and icons anchor just above the head.
  function drawLying(c, a, member, selected) {
    const b = a.bed, bx = b.at[0] * T, by = b.at[1] * T, bw = (b.w || 1) * T, bh = (b.h || 2) * T;
    const upright = bh >= bw;
    const hx = Math.round(upright ? bx + (bw - 14) / 2 : bx + 1), hy = Math.round(upright ? by + 1 : by + (bh - 9) / 2);
    [a.x, a.y] = [hx + 7, hy + 21];
    if (upright) { R(c, bx + 3, by + 10, bw - 6, bh - 13, "#4e6a9a"); R(c, bx + 3, by + 10, bw - 6, 1, "#6e8aba"); }
    else { R(c, hx + 12, by + 3, bw - 16, bh - 6, "#4e6a9a"); R(c, hx + 12, by + 3, 1, bh - 6, "#6e8aba"); }
    c.drawImage(sprite(member, "down", 0), 0, 0, 14, 9, hx, hy, 14, 9);
    if (a.id === selected) { R(c, hx + 3, hy - 4, 8, 1, "#e8c160"); D(c, hx + 6, hy - 3, "#e8c160"); D(c, hx + 7, hy - 3, "#e8c160"); }
  }

  // Icons and progress bars are pixel art in the scene. Every word (speech
  // bubbles, gestures, failures, pops, names) is returned as a label for the
  // high-resolution text layer, together with the regions labels must avoid.
  function drawEffects(c, t, selected) {
    const labels = [], avoid = [];
    for (const a of actors.values()) {
      if (a.hidden) continue;
      const x = Math.round(a.x), y = Math.round(a.y) - 29;
      const iconY = y - 2 + (Math.floor(t * 3) % 2);
      const box = (bg) => { R(c, x - 6, iconY, 13, 9, O); R(c, x - 5, iconY + 1, 11, 7, bg); D(c, x - 1, iconY + 9, O); };
      let top = Math.round(a.y) - 24;
      if (a.icon) { avoid.push([x - 8, iconY - 9, 17, 20]); top = Math.min(top, iconY - (a.icon === "thought" ? 10 : 2)); }
      if (a.icon === "heard") { box("#1c2236"); for (let i = 0; i < 3; i++) D(c, x - 3 + i * 3, iconY + 4, "#8fb0e0"); }
      if (a.icon === "eye") { box("#1d2a2a"); R(c, x - 3, iconY + 3, 7, 3, "#e8f0f0"); R(c, x - 1, iconY + 2, 3, 5, "#7cb6a8"); D(c, x, iconY + 4, O); }
      if (a.icon === "ear") { box("#2a2238"); R(c, x - 1, iconY + 2, 3, 5, "#e0b8a0"); D(c, x, iconY + 4, "#a07a6a"); }
      if (a.icon === "rest") { box("#221c2c"); for (let i = 0; i < 3; i++) D(c, x - 3 + i * 3, iconY + 5, "#c8c0d8"); }
      if (a.icon === "bell") { box("#3a3020"); R(c, x - 2, iconY + 2, 5, 4, "#e8c160"); D(c, x, iconY + 6, "#e8c160"); }
      if (a.icon === "thought") { for (const [dx, dy, r] of [[-1, 8, 1], [2, 5, 2]]) { R(c, x + dx - r, iconY + dy - r, r * 2 + 1, r * 2 + 1, "#c8b8e8"); } R(c, x - 6, iconY - 6, 15, 9, O); R(c, x - 5, iconY - 5, 13, 7, "#e8e0f8"); for (let i = 0; i < 3; i++) D(c, x - 2 + i * 3, iconY - 2, "#6a5a8a"); }
      if (a.icon === "show" && a.showId) { const ic = iconForObject(a.showId, objectLabel(a.showId), layout.objects?.[a.showId]?.drawer); c.drawImage(ic, x - 4, y - 8 - (Math.floor(t * 4) % 2)); if (Math.floor(t * 6) % 2) { D(c, x - 6, y - 10, "#fff8c0"); D(c, x + 6, y - 6, "#fff8c0"); } }
      if (a.icon === "fail") {
        const by = y - 4 - (Math.floor(t * 4) % 2);
        R(c, x - 6, by, 13, 11, O); R(c, x - 5, by + 1, 11, 9, "#7a1a1a");
        for (let i = 0; i < 5; i++) { D(c, x - 2 + i, by + 3 + i, "#ffd0c0"); D(c, x + 2 - i, by + 3 + i, "#ffd0c0"); }
        top = Math.min(top, by - 2);
        if (a.failText) labels.push({ kind: "fail", x, y: top, text: a.failText.slice(0, 14), priority: 1 });
      }
      if (a.working) {
        const frac = anim && !anim.done && anim.frame === a.working ? Math.min(1, anim.t / (anim.until || 2)) : 1;
        R(c, x - 14, y - 12, 28, 5, O); R(c, x - 13, y - 11, 26, 3, "#2a2335"); R(c, x - 13, y - 11, Math.round(26 * (a.working.kind === "work_done" ? 0.5 + frac / 2 : frac / 2)), 3, "#e09040");
        avoid.push([x - 15, y - 13, 30, 7]); top = Math.min(top, y - 14);
      }
      if (a.bubble === "speak" && dialog.mode === "speech" && dialog.speaker === a.id) {
        // The whole line is shown, wrapped; a long speech scrolls with the typing.
        labels.push({ kind: "speech", x, y: top, text: dialog.text.slice(0, Math.floor(dialog.shown)) || "…", priority: 0 });
      } else if (a.bubble === "gesture" && a.gestureText) {
        const g = a.gestureText.replace(/。$/u, "");
        labels.push({ kind: "gesture", x, y: top, text: g.length > 12 ? `${g.slice(0, 11)}…` : g, priority: 2 });
      }
      if (a.id === selected || (anim && !anim.done && anim.frame.actorId === a.id)) {
        labels.push({ kind: a.id === selected ? "nameSelected" : "name", x, y: Math.round(a.y) + 3, below: true, text: nameOf(a.id), priority: 4 });
      }
    }
    if (anim?.gaze && !anim.done) {
      const a = actors.get(anim.frame.actorId); const [gx, gy] = anim.gaze();
      const n = Math.floor(Math.hypot(gx - a.x, gy - (a.y - 14)) / 5);
      for (let i = 2; i < n - 1; i++) if ((i + Math.floor(t * 10)) % 2 === 0) { const xx = a.x + ((gx - a.x) * i) / n, yy = a.y - 14 + ((gy - (a.y - 14)) * i) / n; R(c, xx - 1, yy - 1, 4, 4, O); R(c, xx, yy, 2, 2, "#a8f0dc"); }
    }
    if (anim?.fly && !anim.done) {
      const f = anim.fly, k = Math.min(1, f.t), to = f.to();
      const xx = f.from[0] + (to[0] - f.from[0]) * k, yy = f.from[1] + (to[1] - f.from[1]) * k - Math.sin(k * Math.PI) * 14;
      c.drawImage(iconForObject(f.id, objectLabel(f.id), layout.objects?.[f.id]?.drawer), Math.round(xx), Math.round(yy));
    }
    for (const e of effects) {
      if (e.kind === "chip") R(c, e.x, e.y, 2, 1, e.t < 0.3 ? "#d8b07a" : "#9a7a52");
      if (e.kind === "pop" && (e.t < 1 || Math.floor(e.t * 8) % 2)) labels.push({ kind: "pop", x: Math.round(e.x), y: Math.round(e.y - e.t * 10), text: e.text, priority: 3 });
    }
    return { labels, avoid };
  }

  function emit() { for (const fn of listeners) fn({ cursor, frame: frames[cursor] || null }); }

  return {
    get cursor() { return cursor; },
    get frames() { return frames; },
    get dialog() { return dialog; },
    get objects() { return objects; },
    get entities() { return entities; },
    get agenda() { return agenda; },
    get clockSeconds() { return clockSeconds; },
    get idle() { return !anim || anim.idle || (anim.done && cursor + 1 >= frames.length); },
    actors,
    setFrames(next) { frames = next; },
    say(textLine, tag = "") { dialog = { mode: "action", speaker: null, to: [], heard: [], text: textLine, shown: 0, tag }; },
    appendFrames(more) { frames = frames.concat(more); },
    start, finish, snap, update, draw, drawEffects,
    scrub(index) { snap(index); if (frames[index]) start(index); else emit(); },
    actorAt(x, y) { let best = null, bd = 1e9; for (const a of actors.values()) { if (a.hidden) continue; const d = Math.hypot(a.x - x, a.y - 10 - y); if (d < bd) { bd = d; best = a.id; } } return bd < 16 ? best : null; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    onJump(fn) { jumpListeners.add(fn); return () => jumpListeners.delete(fn); },
  };
}
