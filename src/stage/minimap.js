// Town minimap rendered into a 160-pixel canvas.
import { T } from "./pixel.js";
import { mapAtTile } from "../worlds/layoutAtlas.mjs";

export function createMinimap(canvasEl, { atlas, scene, members }) {
  const extRect = atlas.maps.exterior?.rect || [0, 0, atlas.layout.grid.cols, atlas.layout.grid.rows];
  const [ec, er, ew, eh] = extRect;
  const extW = ew * T, extH = eh * T;

  const targetW = 160;
  const scale = targetW / extW;
  const targetH = Math.round(extH * scale);

  canvasEl.width = targetW;
  canvasEl.height = targetH;
  const ctx = canvasEl.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  let clickHandler = null;

  canvasEl.onclick = (event) => {
    if (!clickHandler) return;
    const rect = canvasEl.getBoundingClientRect();
    const clickX = ((event.clientX - rect.left) / rect.width) * extW + ec * T;
    const clickY = ((event.clientY - rect.top) / rect.height) * extH + er * T;

    // Check if clicked inside a roof on exterior
    for (const roof of atlas.layout.roofs || []) {
      const [rc, rr, rw, rh] = roof.rect;
      if (clickX >= rc * T && clickX < (rc + rw) * T && clickY >= rr * T && clickY < (rr + rh) * T) {
        clickHandler({ enter: roof.siteId });
        return;
      }
    }
    clickHandler({ look: [clickX, clickY] });
  };

  function draw({ actors, camera, speakerId, t }) {
    ctx.clearRect(0, 0, targetW, targetH);
    // Draw exterior background scaled down
    ctx.drawImage(scene.bg, ec * T, er * T, extW, extH, 0, 0, targetW, targetH);

    // Dark blocks for roofs
    for (const roof of atlas.layout.roofs || []) {
      const [rc, rr, rw, rh] = roof.rect;
      const rx = Math.round((rc - ec) * T * scale);
      const ry = Math.round((rr - er) * T * scale);
      const rwPx = Math.round(rw * T * scale);
      const rhPx = Math.round(rh * T * scale);
      ctx.fillStyle = "rgba(42, 28, 48, 0.75)";
      ctx.fillRect(rx, ry, rwPx, rhPx);

      // Count people inside this roof's interior
      const mapId = `interior:${roof.siteId}`;
      let insideCount = 0;
      for (const a of actors.values()) {
        if (a.hidden) continue;
        const aMap = mapAtTile(atlas, a.tile);
        if (aMap === mapId) insideCount++;
      }
      if (insideCount > 0) {
        ctx.fillStyle = "#e8c160";
        ctx.font = "9px Boutique, monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(insideCount), rx + rwPx / 2, ry + rhPx / 2);
      }
    }

    // Draw outdoor actors as 2x2 dots
    for (const a of actors.values()) {
      if (a.hidden) continue;
      const aMap = mapAtTile(atlas, a.tile);
      if (aMap !== "exterior") continue;

      const ax = Math.round((a.x - ec * T) * scale);
      const ay = Math.round((a.y - er * T) * scale);

      const isSpeaker = a.id === speakerId;
      if (isSpeaker && Math.floor(t * 4) % 2 === 0) {
        ctx.fillStyle = "#ffffff";
      } else {
        const mem = members.get(a.id);
        ctx.fillStyle = mem?.appearance?.robe || "#e0604a";
      }
      ctx.fillRect(ax - 1, ay - 1, 2, 2);
    }

    // Camera view rect if camera is on exterior
    if (camera.mapId === "exterior") {
      const [camX, camY, camW, camH] = camera.view();
      const vx = Math.round((camX - ec * T) * scale);
      const vy = Math.round((camY - er * T) * scale);
      const vw = Math.round(camW * scale);
      const vh = Math.round(camH * scale);
      ctx.strokeStyle = "#e8c160";
      ctx.lineWidth = 1;
      ctx.strokeRect(vx + 0.5, vy + 0.5, vw, vh);
    }
  }

  return {
    draw,
    onClick(handler) { clickHandler = handler; },
  };
}
