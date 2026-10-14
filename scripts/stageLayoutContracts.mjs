// The observer fits one screen. The stage fills the box the page gives it: a
// map that fits at a readable size is shown whole, as large as it fits; a
// bigger map is seen through a window at a fixed size. Zooming scales either.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createCamera } from "../src/stage/camera.js";

const atlasOf = (cols, rows) => ({ layout: { grid: { cols, rows } }, maps: { exterior: { rect: [0, 0, cols, rows] } } });
const SMALL = atlasOf(24, 13); // 借星's house and yard
const TOWN = atlasOf(64, 48); // a generated town

test("a small map fills a big box whole, in half steps", () => {
  const camera = createCamera(SMALL);
  camera.setViewport(1184, 831);
  assert.equal(camera.scale(), 3);
  assert.deepEqual(camera.size(), [384, 208], "the whole map");
  assert.deepEqual(camera.view(), [0, 0, 384, 208]);
});

test("a small map in a laptop-sized box is still shown whole, smaller", () => {
  const camera = createCamera(SMALL);
  camera.setViewport(734, 511);
  assert.equal(camera.scale(), 1.5);
  assert.deepEqual(camera.size(), [384, 208]);
});

test("a town too big to show whole is seen through a window that fills the box", () => {
  const camera = createCamera(TOWN);
  camera.setViewport(1184, 776);
  assert.equal(camera.scale(), 2.5);
  assert.deepEqual(camera.size(), [473, 310]);
  const [x, y, w, h] = camera.view();
  assert.ok(x >= 0 && y >= 0 && x + w <= 64 * 16 && y + h <= 48 * 16, "the window stays inside the map");
});

test("zooming scales the view by whole steps and keeps it inside the map", () => {
  const camera = createCamera(SMALL);
  camera.setViewport(1184, 831);
  assert.equal(camera.setZoom(2), true);
  assert.equal(camera.scale(), 4.5);
  assert.deepEqual(camera.size(), [263, 184]);
  const [x, y, w, h] = camera.view();
  assert.ok(x >= 0 && y >= 0 && x + w <= 384 && y + h <= 208);
  assert.equal(camera.setZoom(9), false, "there is no step past the last");
  camera.setZoom(0);
  assert.equal(camera.scale(), 2);
  assert.deepEqual(camera.size(), [384, 208], "zoomed out, the small map is whole and smaller");
});

test("the same box twice changes nothing; a new box does", () => {
  const camera = createCamera(TOWN);
  assert.equal(camera.setViewport(1184, 776), true);
  assert.equal(camera.setViewport(1184.6, 776.2), false);
  assert.equal(camera.setViewport(900, 600), true);
  assert.deepEqual(camera.size(), [360, 240]);
});

test("the page is laid out as one screen with people, stage and ledger columns", () => {
  const html = fs.readFileSync(new URL("../stage.html", import.meta.url), "utf8");
  assert.match(html, /<div class="app observer">/u);
  assert.match(html, /<div class="side">\s*<aside class="people">[\s\S]*id="roster"[\s\S]*<\/aside>\s*<aside class="ledger">[\s\S]*id="hud"[\s\S]*class="px alt logbox"[\s\S]*<\/aside>\s*<\/div>/u);
  assert.doesNotMatch(html, /class="foot"/u, "the footnote moved into the source badge's tooltip");
  assert.match(html, /id="provBadge" title="画面只呈现世界结算过的事实/u);
  const css = fs.readFileSync(new URL("../src/stage.css", import.meta.url), "utf8");
  assert.match(css, /\.app\.observer \{[^}]*height: 100vh;/u);
  assert.match(css, /\.observer \.grid \{[^}]*grid-template-columns: 300px minmax\(0, 1fr\) 330px;/u);
  assert.match(css, /\.app \{ max-width: 1240px;/u, "the play page keeps its own width");
  // A dialog that grew with its text squeezed the stage, which rescaled with
  // every new line: the picture and the box jumped and blurred.
  assert.match(css, /\.observer \.dialog \{ height: \d+px; min-height: 0;/u, "the dialog box keeps one height");
  assert.match(css, /\.observer \.dtext \{[^}]*overflow-y: auto;/u, "long speech scrolls inside it");
  assert.match(html, /<div class="dbody"><div class="dhead">/u);
  const main = fs.readFileSync(new URL("../src/stage/main.js", import.meta.url), "utf8");
  assert.match(main, /new ResizeObserver\(\(\) => fit\(\)\)/u, "the stage refits when its box changes");
  assert.match(main, /camera\.setViewport\(/u);
  assert.doesNotMatch(main, /innerHeight - 380/u, "no more guessing the stage height from the window");
});
