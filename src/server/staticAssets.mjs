import { readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

/** Only entry pages, their browser module graph, styles and public images. */
export function createPublicAssetResolver(rootDirectory) {
  const root = realpathSync(rootDirectory);
  const files = new Set(["/index.html", "/v27.html", "/stage.html", "/play.html", "/src/styles.css", "/src/v27-test.css", "/src/ink-tavern-stage.css", "/src/stage.css", "/src/play.css"]);
  const visited = new Set();
  const queue = ["/src/main.js", "/src/v27-test.js", "/src/stage/main.js", "/src/play/main.js"];
  while (queue.length) {
    const name = queue.pop();
    if (visited.has(name)) continue;
    visited.add(name);
    if (!name.startsWith("/src/") || !/\.m?js$/u.test(name)) continue;
    const candidate = path.join(root, name);
    let source;
    try {
      if (realpathSync(candidate) !== candidate) continue;
      source = readFileSync(candidate, "utf8");
    } catch { continue; }
    files.add(name);
    for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*)["'](\.{1,2}\/[^"']+)["']/gu)) {
      queue.push(path.posix.resolve(path.posix.dirname(name), match[1]));
    }
  }
  return function resolvePublicAsset(requestPath) {
    let name;
    try { name = decodeURIComponent(String(requestPath).split("?")[0]); } catch { return null; }
    if (!name.startsWith("/") || name.includes("\\") || name.includes("\0")
      || name.split("/").some((segment) => segment.startsWith("."))) return null;
    if (name === "/") name = "/index.html";
    const publicImage = /^\/assets\/[\w/-]+\.(?:png|webp|svg|jpg|jpeg|gif|ico)$/u.test(name);
    const publicFont = /^\/assets\/fonts\/[\w-]+\.(?:ttf|woff2)$/u.test(name);
    if (!files.has(name) && !publicImage && !publicFont) return null;
    const candidate = path.resolve(root, `.${name}`);
    try {
      if (realpathSync(candidate) !== candidate || !statSync(candidate).isFile()) return null;
      return candidate;
    } catch { return null; }
  };
}
