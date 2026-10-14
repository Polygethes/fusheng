// DOM side of the observer: dialog box, roster and inspector, HUD, log,
// timeline and the start panel.
import { R, canvas } from "./pixel.js";
import { drawPortrait } from "./sprites.js";
import { gatewayNote, waitingNote } from "./waiting.js";

const $ = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/gu, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const KIND_COLOR = { speak: "#6f8fd0", move: "#6f6582", pickup: "#c9a25a", take_out: "#c9a25a", transfer: "#d0b060", place: "#a08a5a", store: "#a08a5a",
  work_start: "#d0803c", work_done: "#e0a050", observe: "#7cb6a8", listen: "#7c96b6", fail: "#d0503c", deadline: "#e8c160", process_ready: "#b08a38",
  planning: "#5a4a7a", reflection: "#5a4a7a", show: "#c9a25a", rest: "#4a4458", wait: "#4a4458", clock: "#2a2335" };
const PROVENANCE = { "user-specified-gemini-api": "真实 API · 网关声明的模型", "google-gemini-api": "真实 API", "external-unverified": "外部中继 · 未验证",
  "fresh-world": "新世界 · 尚未运行", fixture: "排练夹具", "mixed-history": "混合历史" };
const STATUS = { running: "运行中", stopping: "正在停止", turn_limit_reached: "已到回合上限", stopped_by_operator: "已停止", failed: "出错停止",
  prepared: "已准备", waiting: "等待中", interrupted: "中断", stalled_no_progress: "停滞", suspended_model_error: "人物暂停" };

export function createUi({ world, run, director, onScrub, onSelect, controls }) {
  const members = new Map(world.cast.map((row) => [row.id, row]));
  const nameOf = (id) => members.get(id)?.name || id;
  let selected = world.sceneCast?.[0] || world.cast[0]?.id;
  const portrait = $("portrait").getContext("2d");
  const roster = $("roster");
  roster.innerHTML = "";
  const rosterCanvas = new Map();

  const households = world.households || [];
  if (households.length > 0) {
    roster.classList.add("grouped");
    const assigned = new Set();
    for (const h of households) {
      const hMembers = h.members.filter((id) => members.has(id));
      if (!hMembers.length) continue;
      const groupEl = document.createElement("div");
      groupEl.className = "roster-group";
      const titleEl = document.createElement("div");
      titleEl.className = "roster-group-title";
      titleEl.textContent = h.label;
      groupEl.appendChild(titleEl);
      const gridEl = document.createElement("div");
      gridEl.className = "roster-grid";
      for (const id of hMembers) {
        assigned.add(id);
        const [cv, cx] = canvas(24, 24);
        drawPortrait(cx, members.get(id), 24);
        cv.title = nameOf(id);
        cv.onclick = () => select(id);
        gridEl.appendChild(cv);
        rosterCanvas.set(id, cv);
      }
      groupEl.appendChild(gridEl);
      roster.appendChild(groupEl);
    }
    const others = (world.sceneCast || world.cast.map((row) => row.id)).filter((id) => !assigned.has(id));
    if (others.length > 0) {
      const groupEl = document.createElement("div");
      groupEl.className = "roster-group";
      const titleEl = document.createElement("div");
      titleEl.className = "roster-group-title";
      titleEl.textContent = "其他";
      groupEl.appendChild(titleEl);
      const gridEl = document.createElement("div");
      gridEl.className = "roster-grid";
      for (const id of others) {
        const [cv, cx] = canvas(24, 24);
        drawPortrait(cx, members.get(id), 24);
        cv.title = nameOf(id);
        cv.onclick = () => select(id);
        gridEl.appendChild(cv);
        rosterCanvas.set(id, cv);
      }
      groupEl.appendChild(gridEl);
      roster.appendChild(groupEl);
    }
  } else {
    roster.classList.remove("grouped");
    for (const id of world.sceneCast || world.cast.map((row) => row.id)) {
      const [cv, cx] = canvas(24, 24);
      drawPortrait(cx, members.get(id), 24);
      cv.title = nameOf(id);
      cv.onclick = () => select(id);
      roster.appendChild(cv);
      rosterCanvas.set(id, cv);
    }
  }
  $("title").textContent = world.title;
  document.title = `${world.title} · 像素观察台`;

  function select(id) { selected = id; onSelect?.(id); renderInspector(); }

  function setRun(meta, live) {
    const errorNote = meta.status === "failed" && meta.error ? ` · ${meta.error} 存档完好，可以点“继续”接着跑。` : "";
    $("runStatus").textContent = `${STATUS[meta.status] || meta.status} · 已结算 ${meta.settled} 回合${meta.calls != null ? ` · 请求 ${meta.calls}` : ""}${live ? gatewayNote(meta.gatewayWait, Date.now()) || waitingNote(meta.waitingSince, Date.now()) : ""}${errorNote}`;
    $("runBadge").classList.toggle("live", Boolean(live));
    $("provBadge").textContent = `来源：${PROVENANCE[meta.provenance] || meta.provenance}`;
  }
  setRun(run, false);

  function renderInspector() {
    for (const [id, cv] of rosterCanvas) cv.classList.toggle("sel", id === selected);
    const zone = director.entities[selected]?.zoneId;
    $("cname").textContent = nameOf(selected);
    $("cmeta").textContent = `${members.get(selected)?.title || ""} · ${world.zones?.[zone] || zone || ""}`;
    const actor = director.actors.get(selected);
    const held = Object.entries(director.objects).filter(([, row]) => row.holder === selected);
    $("cheld").textContent = held.length ? held.map(([id, row]) => `${row.label}${actor?.inHand.has(id) ? "（在手里）" : row.hidden ? "（藏着）" : "（随身）"}`).join("、") : "空手";
    const upto = director.frames.slice(0, director.cursor + 1);
    const heard = [...upto].reverse().find((row) => row.utterance && row.status !== "failed" && row.actorId !== selected && (row.perceivedBy || []).includes(selected));
    $("cheard").textContent = heard ? `${nameOf(heard.actorId)}：${heard.utterance.slice(0, 26)}${heard.utterance.length > 26 ? "…" : ""}` : "—";
    const intent = [...upto].reverse().find((row) => row.actorId === selected && row.intention?.text);
    $("cinner").textContent = intent ? intent.intention.text : "—";
    const cledger = $("cledger");
    if (cledger) {
      const innerFrames = upto.filter((row) => row.actorId === selected && row.inner?.items?.length);
      const allItems = innerFrames.flatMap((row) => row.inner.items);
      const recent = allItems.slice(-4).reverse();
      if (!recent.length) {
        cledger.textContent = "—";
      } else {
        const lines = recent.map((item) => {
          if (item.kind === "belief") {
            const sure = item.sure === "held" || item.sure === "认定" ? "认定"
              : item.sure === "dropped" || item.sure === "不再信" ? "不再信" : "怀疑";
            const about = item.aboutName ? `（关于${item.aboutName}）` : "";
            return `${sure}${about}：${item.text}`;
          }
          if (item.kind === "feeling") {
            return `对${item.aboutName}：${item.text}`;
          }
          if (item.kind === "want") {
            return `想：${item.text}`;
          }
          return item.text || "";
        });
        cledger.textContent = lines.join("\n");
      }
    }
    const cbody = $("cbody");
    if (cbody) {
      const felt = [...upto].reverse().find((row) => row.actorId === selected && row.body);
      cbody.textContent = felt?.body.lines?.length ? felt.body.lines.join("，") : "—";
    }
  }

  function renderHud() {
    const now = director.clockSeconds;
    const mm = (s) => `${String(Math.floor(Math.max(0, s) / 60)).padStart(2, "0")}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, "0")}`;
    const rows = director.agenda.map((item) => {
      const left = item.dueAtSeconds - now, status = item.status;
      const label = status === "fulfilled" ? `<span class="ok">按时办妥</span>` : status === "fulfilled_late" ? `<span class="late">迟办妥</span>` : status === "overdue" ? `<span class="late">已过时辰</span>` : `剩 ${mm(left)}`;
      const frac = Math.max(0, Math.min(1, now / Math.max(1, item.dueAtSeconds)));
      return `<div class="row"><span>${escapeHtml(item.label)}</span><span>${label}</span></div><div class="bar"><span style="width:${Math.round(frac * 100)}%"></span></div>`;
    });
    const metrics = (world.report || []).map((metric) => {
      const o = director.objects[metric.objectId];
      const value = metric.kind === "holder" ? (o?.holder ? nameOf(o.holder) : "无人持有") : o?.state?.[metric.stateKey];
      const shown = typeof value === "number" ? (Number.isInteger(value) ? value : value.toFixed(2)) : value ?? "—";
      return `<div class="row"><span>${escapeHtml(metric.label)}</span><span>${escapeHtml(shown)}${metric.unit ? ` ${escapeHtml(metric.unit)}` : ""}${metric.target != null ? ` / ${metric.target}` : ""}</span></div>`;
    });
    $("hud").innerHTML = `<div class="row"><span>${escapeHtml(world.clockLabel)}</span><span>开场后 ${mm(now)}</span></div>${rows.join("")}${metrics.join("")}`;
  }

  function logLine(frame, index) {
    const who = frame.actorId ? `${nameOf(frame.actorId)} ` : "";
    let body;
    if (frame.type === "private") body = `${who}<span class="chip private">私人</span>${frame.kind === "reflection" ? "回想" : "盘算"}`;
    else if (frame.kind === "deadline") body = `【${escapeHtml(frame.label)}】${escapeHtml(frame.status)}`;
    else if (frame.utterance && frame.status !== "failed") body = `${who}：${escapeHtml(frame.utterance.slice(0, 18))}${frame.utterance.length > 18 ? "…" : ""}<span class="chip heard">${(frame.perceivedBy || []).length}人听见</span>`;
    else if (frame.status === "failed") body = `${who}${escapeHtml(frame.kind)}<span class="chip fail">失败</span>`;
    else if (frame.kind === "move") body = `${who}→ ${escapeHtml(world.zones?.[frame.toZone] || frame.toZone)}`;
    else if (frame.kind === "clock") return "";
    else body = `${who}${escapeHtml({ pickup: "拿起", take_out: "取出", transfer: "递交", place: "放下", store: "收起", work_start: "开始干活", work_done: "做完一份", observe: "看", listen: "听", rest: "歇", wait: "等", show: "亮出", process_ready: "活可收尾" }[frame.kind] || frame.kind)}`;
    const t = Math.floor(frame.worldSeconds || 0);
    return `<div data-i="${index}" class="${index === director.cursor ? "cur" : ""}"><b>${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}</b> ${body}</div>`;
  }
  function renderLog() {
    const log = $("log");
    const html = director.frames.slice(0, director.cursor + 1).map(logLine).join("");
    log.innerHTML = html;
    log.scrollTop = log.scrollHeight;
    log.querySelectorAll("div[data-i]").forEach((row) => { row.onclick = () => onScrub(Number(row.dataset.i)); });
  }

  const tl = $("timeline");
  function renderTimeline() {
    const width = Math.max(80, Math.floor(tl.clientWidth));
    if (tl.width !== width) tl.width = width;
    const c = tl.getContext("2d");
    c.imageSmoothingEnabled = false;
    R(c, 0, 0, width, 22, "#15121c");
    const frames = director.frames, n = Math.max(1, frames.length);
    for (let i = 0; i < frames.length; i++) {
      const x0 = Math.floor((i * width) / n), x1 = Math.max(x0 + 1, Math.floor(((i + 1) * width) / n) - (n < 120 ? 1 : 0));
      const f = frames[i], col = f.status === "failed" ? KIND_COLOR.fail : KIND_COLOR[f.kind] || "#4a4458";
      R(c, x0, 3, x1 - x0, 16, col);
      if (i > director.cursor) R(c, x0, 3, x1 - x0, 16, "rgba(12,11,16,.55)");
    }
    if (director.cursor >= 0) { const x = Math.floor(((director.cursor + 0.5) * width) / n); R(c, x - 1, 0, 3, 22, "#e8c160"); }
    $("clock").textContent = `回合 ${Math.max(0, director.cursor + 1)}/${frames.length}`;
  }
  tl.onclick = (event) => {
    const rect = tl.getBoundingClientRect();
    const index = Math.floor(((event.clientX - rect.left) / rect.width) * director.frames.length);
    if (director.frames.length) onScrub(Math.max(0, Math.min(director.frames.length - 1, index)));
  };

  let lastDialog = null;
  function tickDialog() {
    const d = director.dialog;
    if (d !== lastDialog) {
      lastDialog = d;
      const speaker = d.speaker && members.get(d.speaker);
      $("dname").textContent = speaker ? speaker.name : d.mode === "system" ? "世界结算" : d.mode === "idle" ? "" : "旁白";
      $("dto").textContent = d.to?.length ? `→ ${d.to.map(nameOf).join("、")}` : "";
      $("dtag").textContent = d.tag || "";
      $("dtext").className = `dtext ${d.mode}`;
      $("dheard").textContent = d.mode === "speech" && d.heard?.length ? `听见的人：${d.heard.map(nameOf).join("、")}` : "";
      if (speaker) drawPortrait(portrait, speaker, 24); else { portrait.clearRect(0, 0, 24, 24); R(portrait, 0, 0, 24, 24, "#2b2238"); }
    }
    const dtext = $("dtext");
    const shownText = d.text.slice(0, Math.floor(d.shown));
    if (dtext.textContent !== shownText) { dtext.textContent = shownText; dtext.scrollTop = dtext.scrollHeight; }
    $("dcursor").style.visibility = d.shown >= d.text.length && d.text ? "visible" : "hidden";
  }

  director.onChange(() => { renderLog(); renderInspector(); renderHud(); renderTimeline(); });
  renderInspector(); renderHud(); renderTimeline(); renderLog();
  return { tick: tickDialog, select, get selected() { return selected; }, setRun, renderTimeline, renderHud };
}

export function setupStartPanel({ onStarted, currentWorld = () => "", currentRun = () => "", onOpenSettings = () => {} }) {
  const modal = $("startModal");
  let resumeTargetRunId = null, resumeTargetWorld = "";
  let isConfigured = false;

  async function openModal({ isResume = false, runId = "", worldId = "", label = "" } = {}) {
    const [worlds, runs, settingsRes] = await Promise.all([
      fetch("/api/worlds").then((r) => r.json()),
      fetch("/api/runs").then((r) => r.json()),
      fetch("/api/settings").then((r) => r.json()).catch(() => ({ ok: false })),
    ]);
    const scaleOf = (id) => worlds.worlds.find((row) => row.id === id)?.scale || "";
    const syncMode = () => {
      const town = scaleOf(resumeTargetRunId ? resumeTargetWorld : $("fWorld").value) === "town";
      const three = $("fMode").querySelector('option[value="three-call"]');
      if (three) { three.disabled = town; three.hidden = town; }
      if (town) $("fMode").value = "performance";
      $("fModeNote").textContent = town ? "小镇只用演绎模式或混合模式：人多，三段调用太慢。" : "";
    };
    $("fWorld").onchange = syncMode;
    $("fWorld").innerHTML = worlds.worlds.map((row) => `<option value="${escapeHtml(row.id)}">${escapeHtml(row.title)}（${row.sceneCast.map(escapeHtml).join("、")}）</option>`).join("");
    const preferredWorld = worldId || currentWorld();
    if (worlds.worlds.some((row) => row.id === preferredWorld)) $("fWorld").value = preferredWorld;

    isConfigured = Boolean(runs.modelKeyConfigured || settingsRes.settings?.configured);
    if (settingsRes.ok && settingsRes.settings?.configured) {
      if (settingsRes.settings.model) $("fModel").value = settingsRes.settings.model;
      if (settingsRes.settings.responseFormat) $("fFormat").value = settingsRes.settings.responseFormat;
    }
    // DeepSeek answers JSON only as json_object.
    const deepseek = settingsRes.settings?.provider === "deepseek";
    const schemaOption = $("fFormat").querySelector('option[value="json_schema"]');
    if (schemaOption) { schemaOption.disabled = deepseek; schemaOption.hidden = deepseek; }
    if (deepseek) $("fFormat").value = "json_object";

    if (isConfigured) {
      $("fGateway").innerHTML = `请求经由：${escapeHtml(runs.gateway)}。密钥只在服务端环境中，页面不会接触。`;
      $("fStart").disabled = false;
      $("fStart").textContent = "开始";
    } else {
      $("fGateway").innerHTML = `尚未配置 API 密钥：请<a href="#" id="fOpenSettingsLink" style="color:var(--gold);text-decoration:underline;">在设置里填 API</a>，配置后才能运行。`;
      const link = $("fOpenSettingsLink");
      if (link) {
        link.onclick = (e) => {
          e.preventDefault();
          modal.hidden = true;
          onOpenSettings();
        };
      }
    }
    $("fAuth").checked = false; $("fError").textContent = "";

    resumeTargetRunId = isResume ? (runId || currentRun() || null) : null;
    resumeTargetWorld = isResume ? (worldId || currentWorld()) : "";
    let inheritedMode = false;
    if (resumeTargetRunId) {
      $("modalTitle").textContent = "继续 · 从存档往下演";
      $("rowWorld").style.display = "none";
      $("rowResume").style.display = "";
      $("fResumeRun").value = label || resumeTargetRunId;
      $("fResumeRun").title = resumeTargetRunId;
      const targetRun = runs.runs?.find((row) => row.id === resumeTargetRunId);
      if (targetRun?.callMode && $("fMode").querySelector(`option[value="${targetRun.callMode}"]`)) {
        $("fMode").value = targetRun.callMode;
        inheritedMode = true;
      }
    } else {
      $("modalTitle").textContent = "新的开始 · 真实模型";
      $("rowWorld").style.display = "";
      $("rowResume").style.display = "none";
      $("fResumeRun").value = "";
      $("fMode").value = "performance";
    }
    syncMode();
    const town = scaleOf(resumeTargetRunId ? resumeTargetWorld : $("fWorld").value) === "town";
    if (!town && inheritedMode) {
      $("fModeNote").textContent = `沿用这个存档原来的模式（${$("fMode").selectedOptions[0]?.textContent.split("（")[0] || ""}）；要换也可以。`;
    }
    modal.hidden = false;
  }

  $("newRun").onclick = () => openModal({ isResume: false });
  if ($("resumeRun")) $("resumeRun").onclick = () => openModal({ isResume: true });
  $("fCancel").onclick = () => { modal.hidden = true; };
  $("fAuth").onchange = () => { $("fError").textContent = ""; };
  $("fStart").onclick = async () => {
    if (!isConfigured) {
      $("fError").textContent = "先在设置里填 API 密钥后才能开始。";
      return;
    }
    if (!$("fAuth").checked) { $("fError").textContent = "先勾选授权，才能发起真实模型调用。"; return; }
    const body = {
      turns: Number($("fTurns").value),
      maxRequests: Number($("fRequests").value),
      model: $("fModel").value.trim(),
      responseFormat: $("fFormat").value,
      callMode: $("fMode").value,
      authorized: true,
    };
    if (resumeTargetRunId) {
      body.resumeFrom = resumeTargetRunId;
      body.world = resumeTargetWorld;
    } else {
      body.world = $("fWorld").value;
    }
    const response = await fetch("/api/runs/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) { $("fError").textContent = result.message || result.code; return; }
    modal.hidden = true;
    onStarted(result.runId);
  };
  return { openNew: (worldId = "") => openModal({ isResume: false, worldId }), openResume: (runId, worldId, label) => openModal({ isResume: true, runId, worldId, label }) };
}
