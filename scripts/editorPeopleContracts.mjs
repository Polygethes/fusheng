import assert from "node:assert/strict";
import { blankBlueprint, addResident } from "../src/play/blueprintModel.js";

// Mock document/canvas for Node environment
if (!globalThis.document) {
  globalThis.document = {
    createElement: (tag) => {
      const listeners = new Map();
      const children = [];
      const attrs = new Map();
      let innerHTML = "";
      const el = {
        tagName: tag.toUpperCase(),
        type: tag === "input" ? "text" : undefined,
        style: {},
        classList: {
          add: () => {},
          remove: () => {},
          toggle: () => {},
          contains: () => false,
        },
        dataset: {},
        children,
        getAttribute: (k) => attrs.get(k) || null,
        setAttribute: (k, v) => attrs.set(k, String(v)),
        removeAttribute: (k) => attrs.delete(k),
        hasAttribute: (k) => attrs.has(k),
        appendChild: (child) => { children.push(child); return child; },
        removeChild: (child) => {
          const idx = children.indexOf(child);
          if (idx >= 0) children.splice(idx, 1);
          return child;
        },
        addEventListener: (event, fn) => {
          if (!listeners.has(event)) listeners.set(event, []);
          listeners.get(event).push(fn);
        },
        dispatchEvent: (event) => {
          const handlers = listeners.get(event.type) || [];
          for (const h of handlers) h(event);
        },
        getContext: () => ({
          imageSmoothingEnabled: false,
          clearRect: () => {},
          fillRect: () => {},
          drawImage: () => {},
        }),
        get innerHTML() { return innerHTML; },
        set innerHTML(val) { innerHTML = val; },
        querySelectorAll: (selector) => {
          const matches = [];
          if (selector === "[data-path]") {
            const regex = /data-path="([^"]+)"/g;
            let m;
            while ((m = regex.exec(innerHTML)) !== null) {
              const p = m[1];
              matches.push({
                tagName: "INPUT",
                getAttribute: (attr) => (attr === "data-path" ? p : null),
                value: "",
                addEventListener: () => {},
              });
            }
          }
          return matches;
        },
        querySelector: (selector) => null,
      };
      return el;
    },
  };
}

const { render } = await import("../src/play/editors/people.js");

function createMockContainer() {
  const listeners = new Map();
  let innerHTML = "";
  const container = {
    get innerHTML() { return innerHTML; },
    set innerHTML(val) { innerHTML = val; },
    querySelectorAll: (selector) => {
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
    querySelector: (selector) => null,
  };
  return container;
}

// 1. Basic rendering of resident editor
{
  let bp = blankBlueprint("古风");
  const res1 = addResident(bp, bp.households[0]?.id || "");
  bp = res1.blueprint;
  bp.residents[0].name = "张铁匠";
  bp.residents[0].role = "打铁";
  bp.residents[0].age = 42;
  bp.residents[0].desires = [{ verb: "修好", object: "药柜抽屉", outcome: "顺畅", strength: 0.6 }];

  let lastUpdatedPath = null;
  let lastUpdatedValue = null;
  let rewritten = null;
  let replaced = null;

  const ctx = {
    blueprint: () => bp,
    update: (path, value) => {
      lastUpdatedPath = path;
      lastUpdatedValue = value;
    },
    replace: (nextBp) => {
      replaced = nextBp;
    },
    rewrite: (section, label) => {
      rewritten = { section, label };
    },
  };

  const container = createMockContainer();
  render(container, ctx);

  assert.ok(container.innerHTML.includes('data-path="residents[0].name"'), "should render resident name");
  assert.ok(container.innerHTML.includes('data-path="residents[0].age"'), "should render resident age");
  assert.ok(container.innerHTML.includes('data-path="residents[0].role"'), "should render resident role");
  assert.ok(container.innerHTML.includes('data-path="residents[0].householdId"'), "should render resident householdId");
  assert.ok(container.innerHTML.includes('data-path="residents[0].workSiteId"'), "should render resident workSiteId");
  assert.ok(container.innerHTML.includes('data-path="residents[0].speech.style"'), "should render resident speech.style");
  assert.ok(container.innerHTML.includes('data-path="residents[0].situation"'), "should render resident situation");

  // Personality sliders
  assert.ok(container.innerHTML.includes("introversion"), "should contain introversion slider");
  assert.ok(container.innerHTML.includes("外向、有话就说"), "should show slider low text");
  assert.ok(container.innerHTML.includes("话少、心事往里收"), "should show slider high text");

  // Skills and appearance
  assert.ok(container.innerHTML.includes("bun") || container.innerHTML.includes("发髻"), "should show appearance styles");
  assert.ok(container.innerHTML.includes("color"), "should have color inputs");

  // Object hint in desires
  assert.ok(container.innerHTML.includes("写具体的人、地点或东西的名字"), "should have hint for desires object");

  // Routine timeline bar
  bp.residents[0].routine = [{ from: "08:00", to: "12:00", siteId: bp.town.sites[0]?.id || "", activity: "打铁" }];
  render(container, ctx);
  assert.ok(container.innerHTML.includes("timeline-bar-wrapper"), "should render timeline bar");

  // Actions
  assert.ok(container.innerHTML.includes("让模型补全 / 重写这个人"), "should have rewrite resident button");
  assert.ok(container.innerHTML.includes("删除这个人"), "should have delete resident button");
}

console.log("people editor contracts passed");
