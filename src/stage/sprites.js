// Character sprites (14×22, four directions, two-step walk) generated from a
// world pack's appearance fields, plus small item icons for things in hand.
import { O, D, R, circ, canvas, shade, hash } from "./pixel.js";

const TPL = {
  down: ["..............", "..............", "....oooooo....", "...ohhhhhho...", "..ohhHHHHhho..", ".ohhhHHhhhhho.", ".ohhhhhhhhhho.", ".ohhsssssshho.", ".ohssssssssho.", ".ohsessssesho.", ".ohskssssksho.", "..oSssssssSo..", "...oowwwwoo...", "..orrrwwrrro..", ".orrrrwwrrrro.", ".oRrrrrrrrrRo.", ".osbbbbbbbbso.", ".oRrrrrrrrrRo.", "..oRrrrrrrRo..", "..oRRrrrrRRo.."],
  up: ["..............", "..............", "....oooooo....", "...ohhhhhho...", "..ohhHHHHhho..", ".ohhhHHhhhhho.", ".ohhhhhhhhhho.", ".ohhhhhhhhhho.", ".ohhhhHhhhhho.", ".ohhhhhhhhhho.", ".oShhhhhhhhSo.", "..oShhhhhhSo..", "...oossssoo...", "..orrrrrrrro..", ".orrrrrrrrrro.", ".oRrrrrrrrrRo.", ".osbbbbbbbbso.", ".oRrrrrrrrrRo.", "..oRrrrrrrRo..", "..oRRrrrrRRo.."],
  left: ["..............", "..............", "....oooooo....", "...ohhhhhho...", "..ohhHHHHhho..", ".ohhhHHhhhhho.", ".ohhhhhhhhhho.", ".osssshhhhhho.", ".ossssshhhhho.", ".osesssshhhho.", ".oskssssShhho.", "..oSssssShho..", "...oowwwwoo...", "..orwwrrrrro..", ".orrwwrrrrrro.", ".oRrrrrrrrrRo.", ".osbbbbbbbbbo.", ".oRrrrrrrrrRo.", "..oRrrrrrrRo..", "..oRRrrrrRRo.."],
};
const LEGS = {
  fb: [["...opo..opo...", "...ooo..ooo..."], ["...opo..opo...", "...ooo........"], ["...opo..opo...", "........ooo..."]],
  side: [["....opo.opo...", "....ooo.ooo..."], ["...opo...opo..", "...ooo...ooo.."], ["....opopo.....", "....ooooo....."]],
};

const FALLBACK_ROBES = ["#4f86b0", "#6f8f5a", "#a35d4b", "#7a6a8a", "#b8743c", "#5a8a7a", "#8a5a6a"];

export function paletteFor(member = {}) {
  const a = member.appearance || {};
  const robe = a.robe || FALLBACK_ROBES[hash(member.id) % FALLBACK_ROBES.length];
  const skin = a.skin || "#f0c6a0";
  return {
    h: a.hair || "#2b2230", H: a.hairLight || shade(a.hair || "#2b2230", 0.22),
    s: skin, S: shade(skin, -0.16), k: "#e8a090", e: O,
    w: a.inner || "#e6e0d2", r: robe, R: a.robeShade || shade(robe, -0.25), b: a.sash || "#c9a25a",
    p: shade(a.robeShade || robe, -0.45), a: a.accent || "#e8c160", d: "#3a2418",
    y: a.beard || shade(a.hair || "#2b2230", 0.1), A: a.apron || "#e6dcc4", W: "#efe8dc",
  };
}

function rowsFor(dir, leg, member) {
  const a = member.appearance || {};
  const styles = new Set([...(a.styles || []), ...(a.bandaged ? ["bandaged"] : [])]);
  const base = (dir === "right" ? TPL.left : TPL[dir]).map((row) => row.split(""));
  const legs = (dir === "up" || dir === "down" ? LEGS.fb : LEGS.side)[leg];
  base.push(legs[0].split(""), legs[1].split(""));
  const set = (x, y, ch) => { if (base[y]) base[y][x] = ch; };
  if (styles.has("bun")) { set(6, 0, "o"); set(7, 0, "o"); set(4, 1, "a"); set(5, 1, "o"); set(6, 1, "h"); set(7, 1, "H"); set(8, 1, "o"); set(9, 1, "a"); }
  if (styles.has("long")) {
    if (dir === "down") for (let y = 7; y <= 16; y++) { set(0, y, "o"); set(1, y, "h"); set(12, y, "h"); set(13, y, "o"); }
    else if (dir === "up") for (let y = 12; y <= 17; y++) for (let x = 3; x <= 10; x++) set(x, y, y === 17 && (x === 3 || x === 10) ? "o" : x === 6 ? "H" : "h");
    else for (let y = 7; y <= 15; y++) { set(11, y, "h"); set(12, y, "h"); set(13, y, "o"); }
  }
  if (styles.has("beard")) {
    if (dir === "down") { "..oSyyyyyySo..".split("").forEach((c, x) => set(x, 11, c)); "...ooyyyyoo...".split("").forEach((c, x) => set(x, 12, c)); set(6, 13, "y"); set(7, 13, "y"); }
    else if (dir !== "up") { set(3, 11, "y"); set(4, 11, "y"); set(5, 11, "y"); set(3, 12, "y"); set(4, 12, "y"); }
  }
  if (styles.has("apron")) {
    if (dir === "down") for (let y = 15; y <= 19; y++) for (let x = 4; x <= 9; x++) set(x, y, y === 15 ? "b" : "A");
    else if (dir !== "up") for (let y = 15; y <= 19; y++) for (let x = 2; x <= 6; x++) set(x, y, y === 15 ? "b" : "A");
  }
  if (styles.has("sword")) {
    if (dir === "up") for (let i = 0; i < 8; i++) set(10 - i, 12 + i, i < 2 ? "a" : "d");
    else if (dir === "down") { set(11, 17, "d"); set(12, 18, "d"); set(12, 17, "a"); }
    else { set(10, 17, "a"); set(11, 18, "d"); set(12, 19, "d"); }
  }
  if (styles.has("bandaged")) {
    for (let y = 0; y < base.length; y++) for (let x = 0; x < 14; x++) if (y === 16 && base[y][x] === "s") base[y][x] = "W";
  }
  if (a.child) base.splice(17, 1); // a child stands one pixel shorter
  return base;
}

const cache = new Map();
export function sprite(member, dir = "down", leg = 0) {
  const key = `${member.id}|${dir}|${leg}`;
  if (cache.has(key)) return cache.get(key);
  const pal = paletteFor(member);
  const rows = rowsFor(dir, leg, member);
  const [s, sc] = canvas(14, 22);
  const top = 22 - rows.length;
  rows.forEach((row, y) => row.forEach((ch, x) => { if (ch !== ".") D(sc, x, y + top, ch === "o" ? O : pal[ch] || "#f0f"); }));
  let result = s;
  if (dir === "right") { const [f, fc] = canvas(14, 22); fc.translate(14, 0); fc.scale(-1, 1); fc.drawImage(s, 0, 0); result = f; }
  cache.set(key, result);
  return result;
}

export function drawPortrait(c, member, size) {
  c.imageSmoothingEnabled = false;
  c.clearRect(0, 0, size, size);
  R(c, 0, 0, size, size, "#2b2238");
  R(c, 0, size - 6, size, 6, "#231c2e");
  c.drawImage(sprite(member, "down", 0), 0, 0, 14, 16, (size - 14) >> 1, ((size - 16) >> 1) + 3, 14, 16);
}

// ── item icons (9×9) ──────────────────────────────────────────────────────
const ITEM_DRAW = {
  axe(c) { R(c, 4, 1, 1, 8, "#6b4a2e"); D(c, 4, 8, O); R(c, 1, 1, 3, 4, "#b8c0c8"); R(c, 1, 1, 1, 4, "#e8eef2"); R(c, 0, 1, 1, 4, O); R(c, 1, 0, 3, 1, O); R(c, 1, 5, 3, 1, O); },
  parcel(c) { R(c, 1, 2, 7, 6, O); R(c, 2, 3, 5, 4, "#d7b27a"); R(c, 2, 6, 5, 1, "#a57a44"); R(c, 4, 2, 1, 6, "#b23a32"); R(c, 1, 4, 7, 1, "#b23a32"); D(c, 3, 1, "#b23a32"); D(c, 5, 1, "#b23a32"); },
  paper(c) { R(c, 1, 1, 7, 8, O); R(c, 2, 2, 5, 6, "#efe6cc"); for (let y = 3; y < 8; y += 2) R(c, 3, y, 3, 1, "#a89878"); },
  letter(c) { R(c, 0, 2, 9, 6, O); R(c, 1, 3, 7, 4, "#e8d8b0"); R(c, 3, 3, 3, 4, "#b23a32"); D(c, 4, 4, "#e8c160"); },
  talisman(c) { R(c, 2, 0, 5, 9, O); R(c, 3, 1, 3, 7, "#5aa8a0"); R(c, 3, 1, 3, 1, "#9ad8d0"); D(c, 4, 4, "#e8f8f0"); D(c, 4, 3, "#e8c160"); D(c, 4, 5, "#e8c160"); },
  kite(c) { R(c, 4, 0, 1, 1, O); R(c, 3, 1, 3, 1, O); R(c, 2, 2, 5, 3, O); R(c, 3, 2, 3, 2, "#d65a44"); D(c, 4, 4, "#d65a44"); R(c, 3, 5, 3, 1, O); D(c, 4, 6, "#e8c160"); D(c, 5, 7, "#e8c160"); D(c, 4, 8, "#e8c160"); },
  bundle(c) { R(c, 1, 2, 7, 6, O); R(c, 2, 3, 5, 4, "#8a6a8a"); R(c, 2, 3, 5, 1, "#a888a8"); D(c, 4, 1, O); D(c, 4, 2, "#e8c160"); },
  book(c) { R(c, 1, 1, 7, 7, O); R(c, 2, 2, 5, 5, "#a89060"); R(c, 2, 2, 1, 5, "#6a5030"); R(c, 4, 3, 2, 1, "#5a4020"); },
  chest(c) { R(c, 0, 2, 9, 6, O); R(c, 1, 3, 7, 4, "#8a5a34"); R(c, 1, 3, 7, 1, "#b07a4a"); R(c, 4, 4, 1, 2, "#e8c160"); },
  pills(c) { for (const x of [1, 4, 7]) { R(c, x - 1, 3, 3, 5, O); D(c, x, 4, x === 4 ? "#5aa8d0" : x === 1 ? "#d0605a" : "#7ac06a"); D(c, x, 5, "#e8e8f0"); D(c, x, 6, x === 4 ? "#5aa8d0" : x === 1 ? "#d0605a" : "#7ac06a"); D(c, x, 2, O); } },
  cloth(c) { R(c, 0, 2, 9, 6, O); R(c, 1, 3, 7, 4, "#5a8a7a"); R(c, 1, 3, 7, 1, "#7aaa9a"); R(c, 1, 5, 7, 1, "#3e6a5c"); },
  gourd(c) { circ(c, 4, 6, 3, O); circ(c, 4, 6, 2, "#c0a050"); circ(c, 4, 2, 2, O); D(c, 4, 2, "#c0a050"); D(c, 3, 5, "#e0c070"); },
  rations(c) { R(c, 1, 3, 7, 5, O); R(c, 2, 4, 5, 3, "#d8c090"); D(c, 3, 5, "#a08050"); D(c, 5, 5, "#a08050"); },
  blade(c) { for (let i = 0; i < 8; i++) { D(c, 1 + i, 7 - i, "#d8e0e8"); D(c, 1 + i, 8 - i, O); } R(c, 0, 7, 3, 1, "#e8c160"); },
  disk(c) { circ(c, 4, 4, 4, O); circ(c, 4, 4, 3, "#7a6a50"); circ(c, 4, 4, 1, "#8fd0ff"); D(c, 2, 4, "#3a2a20"); D(c, 5, 2, "#3a2a20"); },
  knife(c) { R(c, 4, 0, 1, 5, "#c8d0d8"); R(c, 4, 5, 1, 4, "#6b4a2e"); D(c, 4, 0, "#e8eef2"); },
  generic(c) { R(c, 1, 2, 7, 6, O); R(c, 2, 3, 5, 4, "#b8a888"); R(c, 2, 3, 5, 1, "#d8c8a8"); },
};
const itemCache = new Map();
export function itemIcon(kind) {
  const name = ITEM_DRAW[kind] ? kind : "generic";
  if (itemCache.has(name)) return itemCache.get(name);
  const [s, c] = canvas(9, 9);
  ITEM_DRAW[name](c);
  itemCache.set(name, s);
  return s;
}

const ICON_BY_DRAWER = { axe: "axe", parcel: "parcel", paper: "paper", letter: "letter", kite: "kite", bundle: "bundle", book: "book",
  chest: "chest", pills: "pills", cloth: "cloth", gourd: "gourd", rations: "rations", sword: "blade", "array-disk": "disk" };
const ICON_BY_LABEL = [[/符/u, "talisman"], [/斧/u, "axe"], [/药包|包裹/u, "parcel"], [/清单|纸|名录/u, "paper"], [/帖|信/u, "letter"], [/纸鸢|风筝/u, "kite"],
  [/包袱|行囊/u, "bundle"], [/剑谱|书|星图/u, "book"], [/药箱|箱/u, "chest"], [/丹瓶|药瓶/u, "pills"], [/衣/u, "cloth"], [/水壶|葫芦/u, "gourd"],
  [/干粮/u, "rations"], [/剑/u, "blade"], [/阵盘/u, "disk"], [/刻刀|刀/u, "knife"]];
export function iconForObject(objectId, label = "", drawer = "") {
  if (ICON_BY_DRAWER[drawer]) return itemIcon(ICON_BY_DRAWER[drawer]);
  const hit = ICON_BY_LABEL.find(([pattern]) => pattern.test(label));
  return itemIcon(hit ? hit[1] : "generic");
}
