// Which part of the atlas the stage shows: one map at a time, scrolled and
// zoomed in whole steps, easing toward whoever the story is about.
// The view fills the box the page gives the stage. A map that fits the box at
// a readable size is shown whole, as large as it fits; a bigger one is seen
// through a window at a fixed size. Zooming scales either by a whole step.
const ZOOM_FACTORS = [2 / 3, 1, 1.5]; // zoom 0, 1 (default), 2
const SMALLEST_WHOLE = 1.5; // screen pixels per map pixel below which a map is not shown whole
const WINDOW_SCALE = 2.5; // screen pixels per map pixel for a map too big to show whole

export function createCamera(atlas, { tile = 16, zoom: startZoom = 1 } = {}) {
  let mapId = "exterior", zoom = startZoom, x = 0, y = 0, tx = 0, ty = 0;
  let box = [36 * tile * WINDOW_SCALE, 20 * tile * WINDOW_SCALE];
  const rectPx = (id) => (atlas.maps[id]?.rect || [0, 0, atlas.layout.grid.cols, atlas.layout.grid.rows]).map((v) => v * tile);
  // Screen pixels per map pixel, in half steps so tiles land on whole device pixels on Retina.
  function scale() {
    const [, , mw, mh] = rectPx(mapId);
    const whole = Math.min(box[0] / mw, box[1] / mh);
    const base = whole >= SMALLEST_WHOLE ? whole : WINDOW_SCALE;
    return Math.max(1, Math.floor(base * ZOOM_FACTORS[zoom] * 2) / 2);
  }
  function size() {
    const [, , mw, mh] = rectPx(mapId);
    const s = scale();
    return [Math.min(mw, Math.floor(box[0] / s)), Math.min(mh, Math.floor(box[1] / s))];
  }
  function clamp(px, py) {
    const [mx, my, mw, mh] = rectPx(mapId);
    const [w, h] = size();
    return [Math.min(Math.max(px, mx), mx + mw - w), Math.min(Math.max(py, my), my + mh - h)];
  }
  // Keeps the same spot in the middle while the view changes size.
  function resized(change) {
    const [w, h] = size();
    const cx = x + w / 2, cy = y + h / 2;
    const changed = change();
    if (changed) api.lookAt(cx, cy, { snap: true });
    return changed;
  }
  const api = {
    get mapId() { return mapId; },
    get x() { return Math.round(x); },
    get y() { return Math.round(y); },
    get zoom() { return zoom; },
    size,
    scale,
    view() { const [w, h] = size(); return [Math.round(x), Math.round(y), w, h]; },
    /** The stage's box in CSS pixels. */
    setViewport(width, height) {
      return resized(() => {
        const next = [Math.max(64, Math.floor(width)), Math.max(64, Math.floor(height))];
        if (next[0] === box[0] && next[1] === box[1]) return false;
        box = next;
        return true;
      });
    },
    show(id, focus) {
      if (!atlas.maps[id]) return false;
      const changed = id !== mapId;
      mapId = id;
      const [mx, my, mw, mh] = rectPx(id);
      api.lookAt(...(focus || [mx + mw / 2, my + mh / 2]), { snap: true });
      return changed;
    },
    lookAt(px, py, { snap = false } = {}) {
      const [w, h] = size();
      [tx, ty] = clamp(px - w / 2, py - h / 2);
      if (snap) { x = tx; y = ty; }
    },
    panBy(dx, dy) { [tx, ty] = clamp(x + dx, y + dy); x = tx; y = ty; },
    setZoom(level) {
      const next = Math.max(0, Math.min(ZOOM_FACTORS.length - 1, level));
      if (next === zoom) return false;
      const before = scale();
      resized(() => { zoom = next; return true; });
      return scale() !== before;
    },
    update(dt) {
      const k = Math.min(1, dt * 5);
      x += (tx - x) * k; y += (ty - y) * k;
      if (Math.abs(tx - x) < 0.5) x = tx;
      if (Math.abs(ty - y) < 0.5) y = ty;
    },
    toScene(clientX, clientY, element) {
      const box = element.getBoundingClientRect();
      const [w, h] = size();
      return [Math.round(x) + ((clientX - box.left) / box.width) * w, Math.round(y) + ((clientY - box.top) / box.height) * h];
    },
    contains(px, py, margin = 0) {
      const [w, h] = size();
      return px >= x - margin && px < x + w + margin && py >= y - margin && py < y + h + margin;
    },
  };
  api.show("exterior");
  return api;
}
