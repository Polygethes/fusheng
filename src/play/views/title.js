// Title screen: a real compiled town drifts slowly behind the menu.
import { flattenLayout } from "../../worlds/layoutAtlas.mjs";
import { buildScene, drawAnimatedProps } from "../../stage/tiles.js";
import { createCamera } from "../../stage/camera.js";

const MENU = [
  { id: "new", label: "新的世界", needsModel: false },
  { id: "continue", label: "读取存档", needsModel: false },
  { id: "library", label: "世界库", needsModel: false },
  { id: "settings", label: "设置", needsModel: false },
];

export function render(root, ctx) {
  root.innerHTML = `
    <canvas class="title-bg" aria-hidden="true"></canvas>
    <div class="title-panel px">
      <h1 class="title-name">浮生镇</h1>
      <p class="title-sub">一个会自己过日子的像素小镇</p>
      <nav class="title-menu">${MENU.map((row) => `<button class="btn title-item" data-id="${row.id}">${row.label}</button>`).join("")}</nav>
      <p class="title-note" hidden></p>
    </div>`;
  const canvas = root.querySelector(".title-bg");
  const note = root.querySelector(".title-note");
  let frame = 0, closed = false;

  root.querySelector(".title-menu").onclick = async (event) => {
    const id = event.target.closest("[data-id]")?.dataset.id;
    if (id === "new") ctx.go("new");
    if (id === "continue") location.href = "/stage.html";
    if (id === "library") ctx.go("library");
    if (id === "settings") ctx.openSettings();
  };
  ctx.settingsStatus().then((settings) => {
    if (closed || settings.configured) return;
    note.hidden = false;
    note.textContent = "还没有设置模型 API：生成世界和让人物过日子都要用到它。先点“设置”填好。";
    root.querySelector('[data-id="settings"]').classList.add("primary");
    // First visit without a model: open the settings once per browser session.
    let prompted = false;
    try { prompted = sessionStorage.getItem("gtown.settingsPrompted") === "1"; sessionStorage.setItem("gtown.settingsPrompted", "1"); } catch { /* storage may be blocked */ }
    if (!prompted) ctx.openSettings();
  });

  fetch("/api/create/title-map").then((response) => response.json()).then((data) => {
    if (closed || !data.ok) return;
    const atlas = flattenLayout(data.layout);
    const scene = buildScene(atlas.layout);
    const camera = createCamera(atlas, { zoom: 0 });
    const [w, h] = camera.size();
    canvas.width = w; canvas.height = h;
    const g = canvas.getContext("2d");
    g.imageSmoothingEnabled = false;
    const [mx, my, mw, mh] = atlas.maps.exterior.rect.map((v) => v * 16);
    const start = performance.now();
    const loop = (now) => {
      if (closed) return;
      const t = (now - start) / 1000;
      // A slow figure-eight over the town, about two minutes a lap.
      camera.lookAt(mx + mw / 2 + Math.sin(t / 19) * (mw / 2 - w / 2), my + mh / 2 + Math.sin(t / 11) * (mh / 2 - h / 2), { snap: true });
      g.setTransform(1, 0, 0, 1, -camera.x, -camera.y);
      g.drawImage(scene.bg, 0, 0);
      drawAnimatedProps(g, scene, t);
      g.drawImage(scene.overlay, 0, 0);
      g.setTransform(1, 0, 0, 1, 0, 0);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
  }).catch(() => { /* the menu works without the background */ });

  return () => { closed = true; cancelAnimationFrame(frame); };
}
