import assert from "node:assert/strict";
import { blankBlueprint } from "../src/play/blueprintModel.js";
import { render as renderWorld } from "../src/play/editors/world.js";
import { render as renderPlaces } from "../src/play/editors/places.js";

function createMockContainer() {
  const listeners = new Map();
  let innerHTML = "";
  const container = {
    get innerHTML() { return innerHTML; },
    set innerHTML(val) { innerHTML = val; },
    querySelectorAll: (selector) => {
      // Very basic extraction for test assertions
      const matches = [];
      if (selector === "[data-path]") {
        const regex = /data-path="([^"]+)"/g;
        let m;
        while ((m = regex.exec(innerHTML)) !== null) {
          const val = m[1];
          matches.push({
            tagName: "INPUT",
            getAttribute: (attr) => (attr === "data-path" ? val : null),
            value: "",
            addEventListener: () => {},
          });
        }
      }
      return matches;
    },
    querySelector: (selector) => {
      if (innerHTML.includes(selector.replace(".", 'class="').replace("#", 'id="'))) {
        return {
          addEventListener: (event, fn) => listeners.set(`${selector}:${event}`, fn),
          click: () => listeners.get(`${selector}:click`)?.(),
        };
      }
      return null;
    },
  };
  return { container, listeners };
}

// Test world editor
{
  const bp = blankBlueprint("古风");
  let rewritten = null;
  const ctx = {
    blueprint: () => bp,
    update: () => {},
    replace: () => {},
    rewrite: (section, label) => { rewritten = { section, label }; },
  };

  const { container } = createMockContainer();
  renderWorld(container, ctx);

  assert.ok(container.innerHTML.includes('data-path="meta.title"'), "should render meta.title");
  assert.ok(container.innerHTML.includes('data-path="meta.premise"'), "should render meta.premise");
  assert.ok(container.innerHTML.includes('data-path="meta.genre"'), "should render meta.genre");
  assert.ok(container.innerHTML.includes('data-path="meta.tone"'), "should render meta.tone");
  assert.ok(container.innerHTML.includes('data-path="meta.startDay"'), "should render meta.startDay");
  assert.ok(container.innerHTML.includes('data-path="meta.startClock"'), "should render meta.startClock");
  assert.ok(container.innerHTML.includes('data-path="meta.startLabel"'), "should render meta.startLabel");
  assert.ok(container.innerHTML.includes('data-path="town.name"'), "should render town.name");
  assert.ok(container.innerHTML.includes('data-path="meta.id"'), "should render meta.id");
  assert.ok(container.innerHTML.includes('data-path="town.terrain.river"'), "should render town.terrain.river");
  assert.ok(container.innerHTML.includes('让模型重写这一页'), "should have rewrite button");
}

// Test places editor
{
  const bp = blankBlueprint("古风");
  let rewritten = null;
  const ctx = {
    blueprint: () => bp,
    update: () => {},
    replace: () => {},
    rewrite: (section, label) => { rewritten = { section, label }; },
  };

  const { container } = createMockContainer();
  renderPlaces(container, ctx);

  assert.ok(container.innerHTML.includes('data-path="town.sites[0].name"'), "should render site name field");
  assert.ok(container.innerHTML.includes('data-path="town.sites[0].type"'), "should render site type field");
  assert.ok(container.innerHTML.includes("添加地点"), "should have add site section");
  assert.ok(container.innerHTML.includes("添加一户"), "should have add household section");
  assert.ok(container.innerHTML.includes('让模型重写这一页'), "should have rewrite button");

  // Verify site deletion warning when site has reference
  let replacedBp = null;
  const ctxWithReplace = {
    blueprint: () => bp,
    update: () => {},
    replace: (b) => { replacedBp = b; },
    rewrite: (section, label) => { rewritten = { section, label }; },
  };

  // Check rewrite trigger
  let rwHandler = null;
  const mockContainer2 = {
    get innerHTML() { return ""; },
    set innerHTML(val) {},
    querySelectorAll: () => [],
    querySelector: (sel) => {
      if (sel === ".btn-rewrite") {
        return { addEventListener: (evt, fn) => { rwHandler = fn; } };
      }
      return null;
    },
  };
  renderPlaces(mockContainer2, ctxWithReplace);
  assert.ok(typeof rwHandler === "function");
  rwHandler();
  assert.deepEqual(rewritten, { section: "town", label: "小镇" });
}

console.log("Editor views contracts passed: world and places structure.");
