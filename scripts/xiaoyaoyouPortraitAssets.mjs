import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";
import { pixelPortraitMarkup } from "../src/ui/pixelPortrait.js";

const expected = new Map([
  ["char_xyy_xiezenshi", "xiezenshi-xianxia.png"],
  ["char_xyy_zhoumin", "zhoumin-xianxia.png"],
  ["char_xyy_luozhao", "luozhao-xianxia.png"],
  ["char_xyy_yanzhizhong", "yanzhizhong-xianxia.png"],
  ["char_xyy_xieheng", "xieheng-xianxia.png"],
  ["char_xyy_xiemu", "xiemu-xianxia.png"],
  ["char_xyy_chenyan", "chenyan-xianxia.png"],
]);
const state = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});

for (const [characterId, filename] of expected) {
  const character = state.characters.find((item) => item.id === characterId);
  assert.ok(character, `${characterId} must exist in the Xiaoyaoyou seed`);
  const markup = pixelPortraitMarkup(character, "medium");
  assert.match(markup, new RegExp(`/assets/portraits/${filename.replace(".", "\\.")}`));
  assert.match(markup, /pixel-portrait--medium/);
  assert.match(markup, /古典仙侠像素肖像/);

  const path = fileURLToPath(new URL(`../assets/portraits/${filename}`, import.meta.url));
  const png = readFileSync(path);
  assert.equal(png.toString("ascii", 1, 4), "PNG", `${filename} must be a PNG`);
  assert.equal(png.readUInt32BE(16), 512, `${filename} width must be 512`);
  assert.equal(png.readUInt32BE(20), 512, `${filename} height must be 512`);
  assert.equal(png[25], 6, `${filename} must keep RGBA transparency`);
}

console.log("xiaoyaoyouPortraitAssets:test passed", { portraits: expected.size });
