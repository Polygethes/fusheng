// Save-file screen: each slot is a run plus the runs that continued it,
// shown like a game's load menu — a snapshot of the place with everyone where
// they were left, the in-world time reached, the last thing said, and the
// actions 观看 / 继续.
import { buildScene } from "./tiles.js";
import { sprite } from "./sprites.js";
import { canvas, T } from "./pixel.js";
import { flattenLayout } from "../worlds/layoutAtlas.mjs";

const $ = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/gu, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

const STATUS = {
  running: ["运行中", "live"], stopping: ["正在停止", "live"], starting: ["启动中", "live"],
  stopped_by_operator: ["已暂停", ""], turn_limit_reached: ["本段跑完", ""], stopped: ["已停下", ""],
  waiting: ["已保存", ""], prepared: ["已准备", ""], interrupted: ["中断", "warn"], failed: ["出错中断", "warn"],
};

export function storyTime(slot) {
  const seconds = Math.round(slot.storySeconds || 0);
  if (!seconds && !slot.settled) return "尚未开始";
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
  const span = h ? `${h} 时 ${m} 分` : m ? `${m} 分 ${s} 秒` : `${s} 秒`;
  return `${slot.clockLabel ? `${slot.clockLabel}起 ` : ""}${span}`;
}

function savedAt(iso) {
  const date = new Date(iso), now = new Date();
  const hm = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  const day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((day(now) - day(date)) / 86400000);
  if (diff === 0) return `今天 ${hm}`;
  if (diff === 1) return `昨天 ${hm}`;
  return `${date.getMonth() + 1}/${date.getDate()} ${hm}`;
}

export function slotName(slot) {
  return `存档 ${String(slot.slotNumber || 0).padStart(2, "0")}`;
}

// One snapshot per world layout, with the cast drawn where the save left them.
const scenes = new Map();
function thumbnail(world, slot) {
  if (!world?.layout) {
    const [c, x] = canvas(192, 104);
    x.fillStyle = "#221c2c"; x.fillRect(0, 0, c.width, c.height); return c;
  }
  const isV2 = world.layout.layoutVersion === 2;
  const atlas = isV2 ? flattenLayout(world.layout) : null;
  const layout = atlas ? atlas.layout : world.layout;
  const extRect = isV2 && atlas.maps.exterior ? atlas.maps.exterior.rect : [0, 0, layout.grid.cols, layout.grid.rows];
  const [tw, th] = [extRect[2] * T, extRect[3] * T];
  const [c, x] = canvas(tw, th);

  if (!scenes.has(world.id)) scenes.set(world.id, buildScene(layout));
  const scene = scenes.get(world.id);

  // Draw background clipped to exterior rect
  x.drawImage(scene.bg, extRect[0] * T, extRect[1] * T, tw, th, 0, 0, tw, th);

  const used = new Map();
  const members = new Map((world.cast || []).map((row) => [row.id, row]));
  for (const person of slot.cast || []) {
    const personMapId = isV2 ? world.layout.zoneMap?.[person.zoneId] : null;
    if (isV2 && personMapId && personMapId !== "exterior") {
      // 屋里的人在其屋顶上画一个 3×3 的小点
      const siteId = personMapId.replace(/^interior:/u, "");
      const roof = layout.roofs?.find((r) => r.siteId === siteId);
      if (roof) {
        const rx = (roof.rect[0] - extRect[0]) * T + Math.round((roof.rect[2] * T) / 2);
        const ry = (roof.rect[1] - extRect[1]) * T + Math.round((roof.rect[3] * T) / 2);
        x.fillStyle = "#e8c160";
        x.fillRect(rx - 1, ry - 1, 3, 3);
      }
      continue;
    }
    const spots = layout.spots?.[person.zoneId] || [];
    const index = used.get(person.zoneId) || 0;
    used.set(person.zoneId, index + 1);
    const rect = layout.zones?.[person.zoneId]?.rects?.[0];
    const [sx, sy] = spots[index % Math.max(1, spots.length)] || (rect ? [rect[0] + (index % rect[2]), rect[1] + Math.min(rect[3] - 1, 1)] : [1, 1]);
    const px = (sx - extRect[0]) * T + 1;
    const py = (sy - extRect[1]) * T - 6;
    x.drawImage(sprite(members.get(person.id) || { id: person.id, appearance: {} }, "down", 0), px, py);
  }
  x.drawImage(scene.overlay, extRect[0] * T, extRect[1] * T, tw, th, 0, 0, tw, th);
  return c;
}

export function createSaveScreen({ onWatch, onContinue, onNew, onStop }) {
  const modal = $("savesModal");
  let worlds = [], saves = [], filter = "all", data = null;

  function card(slot) {
    const world = worlds.find((row) => row.id === slot.worldPackId);
    const [label, tone] = STATUS[slot.status] || [slot.status || "已保存", ""];
    const live = tone === "live";
    const mode = slot.callMode === "performance" ? "演绎模式" : slot.callMode === "hybrid" ? "混合模式" : slot.callMode === "three-call" ? "深层心理" : "";
    const meta = [storyTime(slot), `${slot.settled} 回合`, slot.segments.length > 1 ? `${slot.segments.length} 段接力` : "", mode].filter(Boolean);
    const element = document.createElement("article");
    element.className = `px alt slot${live ? " live" : ""}`;
    element.tabIndex = 0;
    element.innerHTML = `
      <div class="thumb"><span class="no">${String(slot.slotNumber).padStart(2, "0")}</span></div>
      <div class="body">
        <div class="head"><span class="ctitle">${escapeHtml(slotName(slot))}</span><span class="world">${escapeHtml(slot.worldTitle)}</span>${slot.branchedFrom ? `<span class="chip">分支</span>` : ""}</div>
        <div class="meta">${meta.map(escapeHtml).join("<i>·</i>")}</div>
        <div class="quote">${slot.lastLine ? `${escapeHtml(slot.lastLine.speaker)}：「${escapeHtml(slot.lastLine.text)}」` : `<span class="dim">${slot.settled ? "还没有人开口。" : "故事还没开始。"}</span>`}</div>
        <div class="cast">${(slot.cast || []).map((row) => `<span>${escapeHtml(row.name)}<em>${escapeHtml(row.zone)}</em></span>`).join("")}</div>
      </div>
      <div class="side">
        <span class="status ${tone}">${live ? "● " : ""}${escapeHtml(label)}${live && slot.calls != null ? ` · ${slot.calls} 次调用` : ""}</span>
        <span class="when">${escapeHtml(savedAt(slot.updatedAt))}</span>
        <div class="acts">
          <button class="btn" data-act="watch">观看</button>
          ${live ? `<button class="btn danger" data-act="stop">停止</button>` : `<button class="btn primary" data-act="continue">继续 ▶</button>`}
        </div>
      </div>`;
    element.querySelector(".thumb").prepend(thumbnail(world, slot));
    element.onclick = (event) => {
      const act = event.target.closest("button")?.dataset.act || "watch";
      if (act === "stop") { onStop(slot.id); return; }
      close();
      if (act === "continue") onContinue(slot); else onWatch(slot);
    };
    element.onkeydown = (event) => { if (event.key === "Enter") { close(); onWatch(slot); } };
    return element;
  }

  function render() {
    const tabs = [["all", "全部"], ...worlds.map((row) => [row.id, row.title])];
    $("savesTabs").innerHTML = tabs.map(([id, title]) => `<button class="btn${filter === id ? " on" : ""}" data-world="${escapeHtml(id)}">${escapeHtml(title)}</button>`).join("");
    $("savesTabs").querySelectorAll("button").forEach((button) => { button.onclick = () => { filter = button.dataset.world; render(); }; });
    const list = $("savesList");
    list.innerHTML = "";
    const fresh = document.createElement("article");
    fresh.className = "px alt slot new";
    fresh.tabIndex = 0;
    fresh.innerHTML = `<div class="plus">＋</div><div class="body"><div class="ctitle">新的开始</div><div class="meta">从世界的开场开一个新存档${filter !== "all" ? ` · ${escapeHtml(worlds.find((row) => row.id === filter)?.title || "")}` : ""}</div></div>`;
    fresh.onclick = () => { close(); onNew(filter === "all" ? "" : filter); };
    list.append(fresh);
    if (data?.starting) {
      const pending = document.createElement("article");
      pending.className = "px alt slot live";
      pending.innerHTML = `<div class="plus">…</div><div class="body"><div class="ctitle">新存档启动中</div><div class="meta">${escapeHtml(data.starting.world || "")} · 第一回合结算后出现在这里</div></div>`;
      list.append(pending);
    }
    const shown = saves.filter((row) => filter === "all" || row.worldPackId === filter);
    for (const slot of shown) list.append(card(slot));
    if (!shown.length) list.insertAdjacentHTML("beforeend", `<p class="dim empty">这个世界还没有存档。</p>`);
  }

  async function refresh() {
    const get = (url) => fetch(url).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    const [w, s] = await Promise.all([get("/api/worlds"), get("/api/saves")]);
    worlds = w.worlds || []; saves = s.saves || []; data = s;
    return saves;
  }

  async function open(world = "") {
    if (world) filter = world;
    await refresh();
    render();
    modal.hidden = false;
    $("savesList").querySelector(".slot:not(.new)")?.focus();
  }
  function close() { modal.hidden = true; }

  $("savesClose").onclick = close;
  modal.addEventListener("click", (event) => { if (event.target === modal) close(); });
  addEventListener("keydown", (event) => { if (event.key === "Escape" && !modal.hidden) close(); });

  return {
    open, close, refresh,
    get saves() { return saves; },
    slotFor(runId) { return saves.find((row) => row.segments.includes(runId)) || null; },
  };
}
