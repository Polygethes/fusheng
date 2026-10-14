import { escapeHtml } from "./dom.js";

const PALETTES = [
  { background: "#263449", shadow: "#182231", skin: "#d3a27f", light: "#f0c8a5", hair: "#352b2c", garment: "#bc5547", accent: "#f1c85b" },
  { background: "#2f3c31", shadow: "#1b261f", skin: "#b98263", light: "#ddb08b", hair: "#202327", garment: "#4f8b78", accent: "#e1a54c" },
  { background: "#463039", shadow: "#2b1d25", skin: "#e1b08a", light: "#f2d0ad", hair: "#5a302a", garment: "#7f78a9", accent: "#76b6b0" },
  { background: "#34404a", shadow: "#202932", skin: "#8f604e", light: "#bd8369", hair: "#171b21", garment: "#c78c3f", accent: "#8eb4d2" },
  { background: "#3f3a2d", shadow: "#27241c", skin: "#c9916a", light: "#e4b58e", hair: "#4a3625", garment: "#657aa0", accent: "#d76d62" },
  { background: "#293d3e", shadow: "#182829", skin: "#d6aa87", light: "#efd0ad", hair: "#2b2529", garment: "#9d5368", accent: "#7dc4a5" },
];

const XIAOYA_YOU_PORTRAITS = {
  char_xyy_xiezenshi: "/assets/portraits/xiezenshi-xianxia.png",
  char_xyy_zhoumin: "/assets/portraits/zhoumin-xianxia.png",
  char_xyy_luozhao: "/assets/portraits/luozhao-xianxia.png",
  char_xyy_yanzhizhong: "/assets/portraits/yanzhizhong-xianxia.png",
  char_xyy_xieheng: "/assets/portraits/xieheng-xianxia.png",
  char_xyy_xiemu: "/assets/portraits/xiemu-xianxia.png",
  char_xyy_chenyan: "/assets/portraits/chenyan-xianxia.png",
};

function hashText(value = "") {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function pixelPortraitPlan(character = {}) {
  const identity = [
    character.id,
    character.name,
    character.publicIdentity,
    character.species,
    character.appearance,
  ].filter(Boolean).join("|");
  const seed = hashText(identity || "character");
  const description = JSON.stringify(character).slice(0, 1800);
  return {
    seed,
    palette: PALETTES[seed % PALETTES.length],
    hairStyle: (seed >>> 3) % 4,
    eyeStyle: (seed >>> 6) % 3,
    accessory: (seed >>> 9) % 4,
    nonHuman: /妖|兽|狐|鹿|龙|鬼|灵|蜥蜴|猫|鸟|虫/.test(description),
    horned: /角|龙|鹿|恶魔|蜥蜴/.test(description),
  };
}

export function pixelPortraitMarkup(character = {}, size = "medium") {
  const id = character.id || character.name || "character";
  const name = character.name || "人物";
  const source = XIAOYA_YOU_PORTRAITS[id] || "";
  if (source) {
    return `<img class="pixel-portrait pixel-portrait--illustrated pixel-portrait--${escapeHtml(size)}" src="${escapeHtml(source)}" alt="${escapeHtml(`${name}的古典仙侠像素肖像`)}" width="512" height="512" decoding="async" data-pixel-portrait="${escapeHtml(id)}" data-pixel-name="${escapeHtml(name)}">`;
  }
  return `<canvas class="pixel-portrait pixel-portrait--${escapeHtml(size)}" width="20" height="20" role="img" aria-label="${escapeHtml(`${name}的像素头像`)}" data-pixel-portrait="${escapeHtml(id)}" data-pixel-name="${escapeHtml(name)}"></canvas>`;
}

function rect(context, color, x, y, width, height) {
  context.fillStyle = color;
  context.fillRect(x, y, width, height);
}

function drawPortrait(canvas, character) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const plan = pixelPortraitPlan(character);
  const colors = plan.palette;
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, 20, 20);
  rect(context, colors.background, 0, 0, 20, 20);
  rect(context, colors.shadow, 0, 16, 20, 4);
  rect(context, colors.accent, plan.seed % 3, 2, 2, 2);
  rect(context, colors.shadow, 16, 3 + (plan.seed % 4), 2, 2);

  rect(context, colors.garment, 3, 15, 14, 5);
  rect(context, colors.shadow, 3, 19, 14, 1);
  rect(context, colors.light, 8, 13, 4, 3);
  rect(context, plan.nonHuman ? colors.accent : colors.skin, 5, 5, 10, 9);
  rect(context, colors.light, 6, 6, 8, 6);
  rect(context, colors.skin, 5, 9, 10, 4);

  if (plan.horned) {
    rect(context, colors.accent, 5, 2, 2, 4);
    rect(context, colors.accent, 13, 2, 2, 4);
  } else if (plan.nonHuman) {
    rect(context, colors.accent, 4, 4, 3, 3);
    rect(context, colors.accent, 13, 4, 3, 3);
  }

  if (plan.hairStyle === 0) {
    rect(context, colors.hair, 5, 4, 10, 3);
    rect(context, colors.hair, 5, 7, 2, 4);
  } else if (plan.hairStyle === 1) {
    rect(context, colors.hair, 4, 4, 12, 4);
    rect(context, colors.hair, 4, 8, 2, 6);
    rect(context, colors.hair, 14, 8, 2, 5);
  } else if (plan.hairStyle === 2) {
    rect(context, colors.hair, 6, 3, 8, 3);
    rect(context, colors.hair, 4, 5, 3, 5);
    rect(context, colors.hair, 13, 5, 3, 3);
  } else {
    rect(context, colors.hair, 5, 4, 10, 2);
    rect(context, colors.hair, 5, 6, 3, 3);
    rect(context, colors.hair, 12, 6, 3, 3);
  }

  const eye = plan.eyeStyle === 2 ? colors.accent : colors.shadow;
  rect(context, eye, 7, 9, 2, 1);
  rect(context, eye, 12, 9, 2, 1);
  rect(context, colors.shadow, 9, 12, 3, 1);

  if (plan.accessory === 1) rect(context, colors.accent, 14, 8, 2, 5);
  if (plan.accessory === 2) rect(context, colors.accent, 6, 14, 8, 1);
  if (plan.accessory === 3) {
    rect(context, colors.accent, 4, 16, 2, 3);
    rect(context, colors.accent, 14, 16, 2, 3);
  }
}

export function hydratePixelPortraits(root, characters = []) {
  if (!root?.querySelectorAll) return;
  const byId = new Map((characters || []).map((character) => [character.id, character]));
  root.querySelectorAll("canvas[data-pixel-portrait]").forEach((canvas) => {
    const id = canvas.dataset.pixelPortrait || "";
    const character = byId.get(id) || { id, name: canvas.dataset.pixelName || "人物" };
    drawPortrait(canvas, character);
  });
}
