import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicAssetResolver } from "../src/server/staticAssets.mjs";

const root = await mkdtemp(path.join(tmpdir(), "gtown-review-assets-"));
try {
  await mkdir(path.join(root, "src"));
  await mkdir(path.join(root, "assets"));
  await writeFile(path.join(root, "index.html"), "public");
  await writeFile(path.join(root, ".env"), "DUMMY=private");
  await writeFile(path.join(root, "src/main.js"), 'import "./used.js";');
  await writeFile(path.join(root, "src/used.js"), "export const publicValue = 1;");
  await writeFile(path.join(root, "src/internal.js"), "private");
  await symlink(path.join(root, ".env"), path.join(root, "assets/secret.png"));
  const resolve = createPublicAssetResolver(root);
  for (const url of ["/.env", "/%2eenv", "/.git/config", "/src/internal.js", "/server.mjs", "/src/../.env", "/assets/secret.png", "/%00", "/%zz"]) {
    assert.equal(resolve(url), null, `private or invalid resource must not be exposed: ${url}`);
  }
  assert.ok(resolve("/"));
  assert.ok(resolve("/src/main.js"));
  assert.ok(resolve("/src/used.js"));
  const projectRoot = fileURLToPath(new URL("..", import.meta.url));
  const actual = createPublicAssetResolver(projectRoot);
  for (const url of ["/", "/v27.html", "/src/main.js", "/src/v27-test.js", "/src/state/store.js", "/src/server/simulation/objectLedger.mjs", "/assets/ink-tavern/tavern-topdown-v2.png"]) assert.ok(actual(url), url);
  assert.equal(actual("/src/server/env.mjs"), null);
  for (const url of ["/stage.html", "/src/stage.css", "/src/stage/main.js", "/src/stage/director.js", "/src/stage/tiles.js", "/src/stage/sprites.js", "/src/stage/pixel.js", "/src/stage/worldEventsPanel.js"]) assert.ok(actual(url), `observer asset served: ${url}`);
  for (const url of ["/play.html", "/src/play.css", "/src/play/main.js", "/src/play/views/title.js", "/src/play/blueprintModel.js", "/src/worlds/catalog/index.mjs", "/src/stage/frame.js", "/src/play/views/quick.js", "/src/play/importWindow.js", "/src/play/views/newWorld.js", "/src/play/sse.js", "/src/play/views/review.js", "/src/play/views/craft.js", "/src/play/rewritePanel.js", "/src/play/editors/world.js", "/src/play/editors/places.js", "/src/play/editors/people.js", "/src/play/editors/relationships.js", "/src/play/editors/opening.js", "/src/play/editors/common.js", "/src/play/paths.js"]) assert.ok(actual(url), `game asset served: ${url}`);
  for (const url of ["/src/worlds/jiexing/pack.mjs", "/src/server/observer/runsApi.mjs", "/sim-runs/2026-09-21-fresh-10/world-save.json"]) assert.equal(actual(url), null, `not public: ${url}`);
  // The pixel fonts ship with the project, so the pages look right offline.
  assert.ok(actual("/assets/fonts/BoutiqueBitmap9x9.ttf"), "the bundled 9×9 pixel font is public");
  assert.ok(actual("/assets/fonts/FusionPixel12pxProportionalSC.woff2"), "the bundled 12px pixel font is public");
  assert.equal(actual("/assets/fonts/BoutiqueBitmap9x9-OFL.txt"), null, "only font files are served from assets/fonts");
  assert.equal(actual("/assets/fonts/FusionPixel12px-OFL.txt"), null, "only font files are served from assets/fonts");
  const stageCss = readFileSync(path.join(projectRoot, "src/stage.css"), "utf8");
  assert.match(stageCss, /url\("\/assets\/fonts\/BoutiqueBitmap9x9\.ttf"\)/u);
  assert.match(stageCss, /url\("\/assets\/fonts\/FusionPixel12pxProportionalSC\.woff2"\)/u);
  // A 12px pixel font is sharp on a Retina screen only at multiples of 6px.
  const playCss = readFileSync(path.join(projectRoot, "src/play.css"), "utf8");
  for (const [file, css] of [["stage.css", stageCss], ["play.css", playCss]]) {
    for (const [, size] of css.matchAll(/font-size:\s*(\d+)px/gu)) assert.equal(Number(size) % 6, 0, `${file}: font-size ${size}px blurs the pixel font`);
  }
  assert.doesNotMatch(stageCss, /cdn\.jsdelivr\.net/u, "no page font is loaded from a CDN");
  console.log("review public asset boundary contracts passed");
} finally { await rm(root, { recursive: true, force: true }); }
