// Pixel stage observer: loads a run's settled frames and plays them on a
// stage generated from its world pack. Live runs stream new frames.
import { pixelFrame } from "./frame.js";
import { buildScene, drawAnimatedProps } from "./tiles.js";
import { drawObjects } from "./objects.js";
import { createLighting } from "./lighting.js";
import { createDirector } from "./director.js";
import { createUi, setupStartPanel } from "./ui.js";
import { createLabelLayer } from "./labels.js";
import { createSaveScreen, slotName, storyTime } from "./saves.js";
import { createSettingsPanel } from "./settings.js";
import { flattenLayout, mapAtTile } from "../worlds/layoutAtlas.mjs";
import { createCamera } from "./camera.js";
import { createMinimap } from "./minimap.js";
import { daylightAt, clockSeconds as parseClockSeconds } from "./daylight.js";
import { createWorldEventsPanel } from "./worldEventsPanel.js";
import { createWeatherLayer, weatherAt } from "./weather.js";
import { createGroundLayer, environmentAt } from "./groundLayer.js";
import { gatewayNote, waitingNote } from "./waiting.js";
import { createFixtureFire } from "./fixtures.js";

const $ = (id) => document.getElementById(id);

document.documentElement.style.setProperty("--frame", pixelFrame("#0c0a10", "#6d5a80", "#2a2236"));
document.documentElement.style.setProperty("--frame2", pixelFrame("#0c0a10", "#4a3e5a", "#221c2c"));

let current = null;
let labelLayer = null;
let currentSlotLabel = "";
let currentWorldId = "";
let currentRunId = "";
let heavenPanel = null;

// The header button names the save being watched, like a game's file label.
async function labelSave(runId) {
  await saveScreen.refresh();
  const slot = saveScreen.slotFor(runId);
  const segment = slot && slot.segments.at(-1) !== runId ? ` · 第 ${slot.segments.indexOf(runId) + 1} 段` : "";
  $("savesBtn").textContent = slot ? `${slotName(slot)} · ${slot.worldTitle}${segment} ▾` : "存档 ▾";
  currentSlotLabel = slot ? `${slotName(slot)} · ${slot.worldTitle} · ${slot.settled} 回合 · ${storyTime(slot)}${segment}` : "";
  $("savesBtn").title = slot ? `${storyTime(slot)} · ${slot.settled} 回合 · 点此读取其他存档` : "读取存档";
}

let opening = 0;

async function open(runId) {
  const ticket = ++opening;
  current?.close();
  labelSave(runId).catch(() => {});
  const url = new URL(location.href);
  url.searchParams.set("run", runId);
  history.replaceState(null, "", url);
  let response = await fetch(`/api/runs/${encodeURIComponent(runId)}/feed`);
  // A starting run has no save until its first turn settles, which can take
  // minutes while a gateway is down; keep waiting until it saves or ends.
  while (response.status === 202) {
    const pending = await response.json().catch(() => ({}));
    if (ticket !== opening) return;
    $("runStatus").textContent = `启动中${pending.calls ? ` · 请求 ${pending.calls}` : ""}${gatewayNote(pending.gatewayWait, Date.now()) || waitingNote(pending.waitingSince, Date.now()) || "…"}`;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    if (ticket !== opening) return;
    response = await fetch(`/api/runs/${encodeURIComponent(runId)}/feed`);
  }
  if (ticket !== opening) return;
  const feed = await response.json();
  if (!feed.ok) { $("runStatus").textContent = `无法载入：${feed.code}`; return; }
  current = mount(runId, feed);
}

function mount(runId, feed) {
  const { world } = feed;
  currentWorldId = world.id;
  currentRunId = runId;
  const atlas = flattenLayout(world.layout);
  const layout = atlas.layout;
  const isV2 = world.layout.layoutVersion === 2;
  const camera = createCamera(atlas);
  const scene = buildScene(layout);
  const lighting = createLighting(layout, scene.width, scene.height);
  const fire = createFixtureFire(layout);
  const weatherLayer = createWeatherLayer();
  const groundLayer = createGroundLayer(layout, atlas.maps.exterior?.rect);
  const stage = $("stage");
  const [initW, initH] = camera.size();
  stage.width = initW; stage.height = initH;
  const ctx = stage.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  labelLayer ||= createLabelLayer(stage);
  const director = createDirector({ world, initial: feed.initial, layout, scene, atlas });
  director.setFrames(feed.frames);
  if (heavenPanel) {
    heavenPanel.destroy();
    heavenPanel = null;
  }
  const heavenBox = $("heavenBox");
  const heavenRoot = $("heaven");
  if (heavenBox && heavenRoot) {
    heavenPanel = createWorldEventsPanel({ root: heavenRoot, runId, world, director });
  }
  let playing = true, speed = 1, follow = true, closed = false;
  let followIndoor = true;
  try {
    const saved = localStorage.getItem("gtown_follow_indoor");
    if (saved !== null) followIndoor = saved === "true";
  } catch {}

  const members = new Map(world.cast.map((row) => [row.id, row]));
  let minimap = null;
  const minimapBox = $("minimapBox");
  const minimapCanvas = $("minimap");
  if (isV2 && minimapBox && minimapCanvas) {
    minimapBox.style.display = "";
    minimap = createMinimap(minimapCanvas, { atlas, scene, members });
    minimap.onClick(({ enter, look }) => {
      if (enter) {
        camera.show(`interior:${enter}`);
        updateCameraSize();
        if (mapTitle) mapTitle.textContent = atlas.maps[camera.mapId]?.label || camera.mapId;
        if (mapExit) mapExit.style.display = "";
      } else if (look) {
        camera.show("exterior");
        camera.lookAt(look[0], look[1], { snap: true });
        updateCameraSize();
        if (mapTitle) mapTitle.textContent = atlas.maps[camera.mapId]?.label || camera.mapId;
        if (mapExit) mapExit.style.display = "none";
      }
    });
  } else if (minimapBox) {
    minimapBox.style.display = "none";
  }

  const mapBar = $("mapBar");
  const mapTitle = $("mapTitle");
  const mapExit = $("mapExit");
  const mapExterior = $("mapExterior");
  const followIndoorCheckbox = $("followIndoor");
  if (isV2 && mapBar) {
    mapBar.style.display = "flex";
    if (followIndoorCheckbox) {
      followIndoorCheckbox.checked = followIndoor;
      followIndoorCheckbox.onchange = () => {
        followIndoor = followIndoorCheckbox.checked;
        try { localStorage.setItem("gtown_follow_indoor", String(followIndoor)); } catch {}
      };
    }
    const updateMapBar = () => {
      const curMap = atlas.maps[camera.mapId];
      if (mapTitle) mapTitle.textContent = curMap?.label || camera.mapId;
      if (mapExit) mapExit.style.display = camera.mapId !== "exterior" ? "" : "none";
    };
    if (mapExterior) mapExterior.onclick = () => { camera.show("exterior"); updateCameraSize(); updateMapBar(); };
    if (mapExit) mapExit.onclick = () => { camera.show("exterior"); updateCameraSize(); updateMapBar(); };
    updateMapBar();
  } else if (mapBar) {
    mapBar.style.display = "none";
  }

  const ui = createUi({ world, run: feed.run, director, onScrub: (i) => { follow = false; $("follow").classList.remove("on"); director.scrub(i); } });

  $("play").onclick = () => { playing = !playing; $("play").textContent = playing ? "❚❚" : "▶"; $("play").setAttribute("aria-label", playing ? "暂停" : "播放"); };
  $("speed").onclick = () => { speed = speed >= 8 ? 1 : speed * 2; $("speed").textContent = `×${speed}`; };
  $("follow").onclick = () => { follow = !follow; $("follow").classList.toggle("on", follow); };

  function updateCameraSize() { fit(); }

  // Pointer drag for panning
  let dragStart = null;
  stage.onpointerdown = (event) => {
    dragStart = { x: event.clientX, y: event.clientY, dragged: false };
  };
  stage.onpointermove = (event) => {
    if (!dragStart) return;
    const dx = event.clientX - dragStart.x;
    const dy = event.clientY - dragStart.y;
    if (Math.hypot(dx, dy) > 4) {
      dragStart.dragged = true;
      if (follow) { follow = false; $("follow").classList.remove("on"); }
      const rect = stage.getBoundingClientRect();
      const [cw, ch] = camera.size();
      const scaleX = cw / rect.width;
      const scaleY = ch / rect.height;
      camera.panBy(-dx * scaleX, -dy * scaleY);
      dragStart.x = event.clientX;
      dragStart.y = event.clientY;
    }
  };
  stage.onpointerup = (event) => {
    if (dragStart && !dragStart.dragged) {
      // Click event
      const [scX, scY] = camera.toScene(event.clientX, event.clientY, stage);
      const hit = director.actorAt(scX, scY);
      if (hit) {
        ui.select(hit);
      } else if (isV2 && camera.mapId === "exterior") {
        // Check if clicked a roof to enter
        const [cw, ch] = [layout.grid.cols, layout.grid.rows];
        for (const roof of layout.roofs || []) {
          const [rc, rr, rw, rh] = roof.rect;
          if (scX >= rc * 16 && scX < (rc + rw) * 16 && scY >= rr * 16 && scY < (rr + rh) * 16) {
            camera.show(`interior:${roof.siteId}`);
            updateCameraSize();
            if (mapTitle) mapTitle.textContent = atlas.maps[camera.mapId]?.label || camera.mapId;
            if (mapExit) mapExit.style.display = "";
            break;
          }
        }
      }
    }
    dragStart = null;
  };

  stage.onwheel = (event) => {
    event.preventDefault();
    const delta = event.deltaY < 0 ? 1 : -1;
    if (camera.setZoom(camera.zoom + delta)) {
      updateCameraSize();
    }
  };

  // Follow actor transitions across maps
  director.onChange(({ frame }) => {
    if (!frame || !follow) return;
    const actor = director.actors.get(frame.actorId);
    if (!actor) return;
    const actorMap = mapAtTile(atlas, actor.tile);
    if (actorMap && actorMap !== camera.mapId) {
      if (followIndoor || actorMap === "exterior") {
        camera.show(actorMap, [actor.x, actor.y]);
        updateCameraSize();
        if (mapTitle) mapTitle.textContent = atlas.maps[camera.mapId]?.label || camera.mapId;
        if (mapExit) mapExit.style.display = camera.mapId !== "exterior" ? "" : "none";
      }
    } else {
      camera.lookAt(actor.x, actor.y);
    }
  });

  director.onJump((actorId) => {
    if (!follow) return;
    const actor = director.actors.get(actorId);
    if (!actor) return;
    const actorMap = mapAtTile(atlas, actor.tile);
    if (actorMap && actorMap !== camera.mapId) {
      if (followIndoor || actorMap === "exterior") {
        camera.show(actorMap, [actor.x, actor.y]);
        updateCameraSize();
        if (mapTitle) mapTitle.textContent = atlas.maps[camera.mapId]?.label || camera.mapId;
        if (mapExit) mapExit.style.display = camera.mapId !== "exterior" ? "" : "none";
      }
    }
  });

  // The stage fills the box the page layout gives it.
  const stageBox = stage.parentElement;
  function fit() {
    const style = getComputedStyle(stageBox);
    const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
    const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    camera.setViewport(stageBox.offsetWidth - padX, stageBox.offsetHeight - padY);
    const [cw, ch] = camera.size();
    if (stage.width !== cw || stage.height !== ch) {
      stage.width = cw; stage.height = ch;
      ctx.imageSmoothingEnabled = false;
    }
    const scale = camera.scale();
    stage.style.width = `${cw * scale}px`;
    stage.style.height = `${ch * scale}px`;
    labelLayer.fit(cw);
    ui.renderTimeline();
  }
  const resizeObserver = new ResizeObserver(() => fit());
  resizeObserver.observe(stageBox);
  fit();

  // Live frames: the server pushes frames as the run's save changes.
  let lastSeq = feed.frames.at(-1)?.seq || 0;
  const live = feed.run.status === "running" || feed.run.status === "stopping";
  const events = new EventSource(`/api/runs/${encodeURIComponent(runId)}/stream?after=${lastSeq}`);
  events.addEventListener("frames", (event) => {
    const data = JSON.parse(event.data);
    const fresh = data.frames.filter((row) => row.seq > lastSeq);
    if (!fresh.length) return;
    lastSeq = fresh.at(-1).seq;
    director.appendFrames(fresh);
    if (follow && !playing) { playing = true; $("play").textContent = "❚❚"; }
  });
  function updateButtons(isRunning) {
    if (isRunning) {
      $("newRun").textContent = "停止运行";
      $("newRun").classList.add("danger");
      $("newRun").onclick = async () => { await fetch(`/api/runs/${encodeURIComponent(runId)}/stop`, { method: "POST" }); };
      if ($("resumeRun")) $("resumeRun").style.display = "none";
    } else {
      $("newRun").textContent = "新的开始";
      $("newRun").classList.remove("danger");
      $("newRun").onclick = startPanelOpener;
      if ($("resumeRun")) $("resumeRun").style.display = "";
    }
    if (heavenBox) heavenBox.hidden = !isRunning;
    heavenPanel?.setLive(isRunning);
  }

  let latestMeta = { ...feed.run, waitingSince: null, gatewayWait: null };
  let isRunLive = live;

  events.addEventListener("status", (event) => {
    const data = JSON.parse(event.data);
    const meta = { ...feed.run, status: data.status, calls: data.calls ?? feed.run.calls, settled: director.frames.filter((row) => row.agentTurnId).length, waitingSince: data.waitingSince ?? null, gatewayWait: data.gatewayWait ?? null, error: data.error ?? null };
    latestMeta = meta;
    isRunLive = data.status === "running";
    ui.setRun(meta, isRunLive);
    updateButtons(isRunLive);
  });
  ui.setRun(feed.run, live);
  updateButtons(live);

  const waitingTimer = setInterval(() => {
    if (isRunLive) ui.setRun(latestMeta, true);
  }, 1000);

  let last = performance.now();
  let frameTimes = [];
  function loop(now) {
    if (closed) return;
    let dt = Math.min(0.5, (now - last) / 1000);
    const frameDuration = (now - last) / 1000;
    last = now;
    if (frameDuration > 0) {
      frameTimes.push(1 / frameDuration);
      if (frameTimes.length > 60) frameTimes.shift();
    }
    while (dt > 0) {
      const step = Math.min(0.05, dt);
      director.update(step, { playing, speed });
      camera.update(step);
      dt -= step;
    }
    const t = now / 1000;
    if (follow && director.frames[director.cursor]) {
      const curFrame = director.frames[director.cursor];
      const curActor = director.actors.get(curFrame.actorId);
      if (curActor) {
        const actorMap = mapAtTile(atlas, curActor.tile);
        if (actorMap === camera.mapId) camera.lookAt(curActor.x, curActor.y);
      }
    }

    const startSec = world.startClock ? parseClockSeconds(world.startClock) : null;
    const daylight = startSec !== null ? daylightAt((startSec + director.clockSeconds) % 86400) : null;
    const camView = camera.view();

    ctx.setTransform(1, 0, 0, 1, -camera.x, -camera.y);
    ctx.drawImage(scene.bg, 0, 0);
    drawAnimatedProps(ctx, scene, t, fire.propLit(director.objects));
    if (camera.mapId === "exterior") groundLayer.draw(ctx, camView, environmentAt(director.frames, director.cursor, feed.initial?.environment), t);
    const { held, drawActors } = director.draw(ctx, t, ui.selected);
    drawObjects(ctx, layout, director.objects, t, held);
    drawActors();
    ctx.drawImage(scene.overlay, 0, 0);

    const line = layout.objects && Object.entries(layout.objects).find(([, spec]) => spec.segments);
    const litSegments = line ? Number(director.objects[line[0]]?.state?.[line[1].segments.stateKey] || 0) : 0;
    if (isV2) {
      lighting.draw(ctx, t, {
        litSegments,
        view: camView,
        daylight,
        lightOn: fire.lightOn(director.objects),
      });
    } else {
      lighting.draw(ctx, t, { litSegments, lightOn: fire.lightOn(director.objects) });
    }
    if (camera.mapId === "exterior") weatherLayer.draw(ctx, camView, weatherAt(director.frames, director.cursor, feed.initial?.weather), t);

    // Outdoor speech hint icon (13x9 pixel balloon) above roof if speaker is indoors
    const curFrame = director.frames[director.cursor];
    const isSpeaking = curFrame && (curFrame.kind === "speak" || curFrame.utterance);
    const speakerActor = isSpeaking ? director.actors.get(curFrame.actorId) : null;
    const speakerMap = speakerActor ? mapAtTile(atlas, speakerActor.tile) : null;
    if (camera.mapId === "exterior" && speakerMap && speakerMap.startsWith("interior:") && Math.floor(t * 3) % 2 === 0) {
      const siteId = speakerMap.replace(/^interior:/u, "");
      const roof = layout.roofs?.find((r) => r.siteId === siteId);
      if (roof) {
        const bx = roof.rect[0] * 16 + Math.round((roof.rect[2] * 16) / 2) - 6;
        const by = roof.rect[1] * 16 - 14;
        // 13x9 pixel speech balloon: white background with dark border and tail
        ctx.fillStyle = "#1b1420";
        ctx.fillRect(bx + 1, by, 11, 7);
        ctx.fillRect(bx, by + 1, 13, 5);
        ctx.fillRect(bx + 4, by + 7, 3, 1);
        ctx.fillRect(bx + 5, by + 8, 1, 1);

        ctx.fillStyle = "#f4f2ea";
        ctx.fillRect(bx + 1, by + 1, 11, 5);
        ctx.fillRect(bx + 4, by + 6, 2, 1);

        // Dots inside
        ctx.fillStyle = "#3a3040";
        ctx.fillRect(bx + 3, by + 3, 1, 1);
        ctx.fillRect(bx + 6, by + 3, 1, 1);
        ctx.fillRect(bx + 9, by + 3, 1, 1);
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    const { labels, avoid } = director.drawEffects(ctx, t, ui.selected);
    // Combine director labels with roof labels if on exterior
    const allLabels = [...labels];
    if (camera.mapId === "exterior" && scene.roofLabels) {
      for (const rl of scene.roofLabels) allLabels.push({ kind: "name", x: rl.x, y: rl.y, text: rl.text, priority: 1 });
    }
    const visibleLabels = allLabels
      .filter((lbl) => camera.contains(lbl.x, lbl.y, 16))
      .map((lbl) => ({ ...lbl, x: lbl.x - camera.x, y: lbl.y - camera.y }));
    const visibleAvoid = avoid
      .filter((av) => camera.contains(av.x, av.y, 16))
      .map((av) => ({ ...av, x: av.x - camera.x, y: av.y - camera.y }));
    labelLayer.draw(visibleLabels, visibleAvoid);

    if (minimap) {
      const spkId = isSpeaking ? curFrame.actorId : null;
      minimap.draw({ actors: director.actors, camera, speakerId: spkId, t });
    }

    ui.tick();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  window.__stage = {
    director,
    camera,
    advance(seconds) { for (let s = 0; s < seconds; s += 1 / 30) director.update(1 / 30, { playing: true, speed: 1 }); },
    get fps() {
      if (!frameTimes.length) return 0;
      return Math.round(frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length);
    },
  };
  if (!feed.frames.length) director.say("这个世界还没有人行动。点右上角“继续 ▶”，勾选授权后开始。", "新存档");
  return {
    close() {
      closed = true;
      clearInterval(waitingTimer);
      events.close();
      resizeObserver.disconnect();
      if (heavenPanel) {
        heavenPanel.destroy();
        heavenPanel = null;
      }
      if (heavenBox) heavenBox.hidden = true;
    }
  };
}

let startPanelOpener = null;
const settingsPanel = createSettingsPanel();
$("settingsBtn").onclick = () => settingsPanel.open();

const startPanel = setupStartPanel({
  onStarted: async (runId) => { open(runId); },
  currentWorld: () => currentWorldId,
  currentRun: () => currentRunId,
  onOpenSettings: () => settingsPanel.open(),
});
startPanelOpener = $("newRun").onclick;
$("resumeRun").onclick = () => startPanel.openResume(currentRunId, currentWorldId, currentSlotLabel);

const saveScreen = createSaveScreen({
  onWatch: (slot) => open(slot.id),
  onContinue: async (slot) => { if (currentRunId !== slot.id) await open(slot.id); startPanel.openResume(slot.id, slot.worldPackId, `${slotName(slot)} · ${slot.worldTitle} · ${slot.settled} 回合 · ${storyTime(slot)}`); },
  onNew: (worldId) => startPanel.openNew(worldId || currentWorldId),
  onStop: async (runId) => { await fetch(`/api/runs/${encodeURIComponent(runId)}/stop`, { method: "POST" }); saveScreen.open(); },
});
$("savesBtn").onclick = () => saveScreen.open();

(async () => {
  try { await Promise.all([document.fonts.load("9px Boutique"), document.fonts.load("18px \"Fusion Pixel 12\"", "藏星谷")]); } catch { /* fall back to system fonts */ }
  const preferred = new URL(location.href).searchParams.get("run");
  if (preferred) { open(preferred); return; }
  // No save chosen yet: show the save screen, with the latest save behind it.
  const saves = await saveScreen.refresh();
  if (saves[0]) open(saves[0].id); else $("runStatus").textContent = "还没有存档；点“新的开始”。";
  saveScreen.open();
})();
