// The game's own front door (P6): a title screen over a living pixel town,
// then the two ways to make a world, the review page, and the world library.
// Each view is a module with render(root, ctx) that returns a cleanup.
import { pixelFrame } from "../stage/frame.js";
import { createSettingsPanel } from "../stage/settings.js";
import { render as titleView } from "./views/title.js";
import { render as newWorldView } from "./views/newWorld.js";
import { render as libraryView } from "./views/library.js";
import { render as quickView } from "./views/quick.js";
import { render as reviewView } from "./views/review.js";
import { render as craftView } from "./views/craft.js";

document.documentElement.style.setProperty("--frame", pixelFrame("#0c0a10", "#6d5a80", "#2a2236"));
document.documentElement.style.setProperty("--frame2", pixelFrame("#0c0a10", "#4a3e5a", "#221c2c"));

const root = document.getElementById("app");
const settings = createSettingsPanel({ onSaved: () => route() });
// Later tasks add their views here (quick, review, craft).
const VIEWS = { "": titleView, new: newWorldView, library: libraryView, quick: quickView, review: reviewView, craft: craftView };

let cleanup = null;
async function settingsStatus() {
  try { return (await (await fetch("/api/settings")).json()).settings || {}; } catch { return {}; }
}
const ctx = {
  go: (path) => { location.hash = `#/${path}`; },
  openSettings: () => settings.open(),
  settingsStatus,
};

function route() {
  const [name = "", ...rest] = location.hash.replace(/^#\/?/u, "").split("/");
  const view = VIEWS[name] || VIEWS[""];
  cleanup?.();
  root.innerHTML = "";
  root.dataset.view = VIEWS[name] && name ? name : "title";
  cleanup = view(root, { ...ctx, params: rest }) || null;
}
addEventListener("hashchange", route);
route();
