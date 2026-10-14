import assert from "node:assert/strict";
import { blankBlueprint, addResident } from "../src/play/blueprintModel.js";

// Mock document for Node environment
if (!globalThis.document) {
  globalThis.document = {
    createElement: () => ({
      classList: { add: () => {}, remove: () => {} },
      appendChild: () => {},
    }),
  };
}

const { render } = await import("../src/play/editors/opening.js");

function createMockContainer() {
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
    querySelector: () => null,
  };
  return container;
}

// 1. Opening editor rendering
{
  let bp = blankBlueprint("古风");
  const r1 = addResident(bp, bp.households[0]?.id || "");
  bp = r1.blueprint;
  const r2 = addResident(bp, bp.households[0]?.id || "");
  bp = r2.blueprint;

  bp.residents[0].name = "阿吉";
  bp.residents[1].name = "小芸";

  bp.opening = {
    situation: "立秋时节，小镇清晨刚刚醒来。",
    positions: {
      [bp.residents[0].id]: bp.town.sites[0]?.id || "",
      [bp.residents[1].id]: bp.town.sites[0]?.id || "",
    },
    objects: [
      {
        name: "药柜抽屉",
        siteId: bp.town.sites[0]?.id || "",
        holder: null,
        state: {},
        known: "public",
        madeAt: bp.town.sites[0]?.id || "",
        needed: 1,
      },
    ],
    deadlines: [
      {
        label: "早市开市前修好抽屉",
        dueClock: "08:00",
        responsible: [bp.residents[0].id],
        knownBy: [bp.residents[0].id, bp.residents[1].id],
        consequence: "早市开市后抓药会手忙脚乱",
        conditions: [
          {
            kind: "object_ready",
            object: "药柜抽屉",
          },
        ],
      },
    ],
    mysteries: ["后山竹林夜里有怪声"],
    events: [{ id: "ev_1" }],
    visitors: [{ id: "vis_1" }],
  };

  let rewritten = null;
  const ctx = {
    blueprint: () => bp,
    update: () => {},
    replace: () => {},
    rewrite: (section, label) => { rewritten = { section, label }; },
  };

  const container = createMockContainer();
  render(container, ctx);

  // Situation
  assert.ok(container.innerHTML.includes('data-path="opening.situation"'), "should render opening.situation");

  // Positions
  assert.ok(container.innerHTML.includes(`data-path="opening.positions.${bp.residents[0].id}"`), "should render position for resident 0");
  assert.ok(container.innerHTML.includes(`data-path="opening.positions.${bp.residents[1].id}"`), "should render position for resident 1");

  // Objects
  assert.ok(container.innerHTML.includes('data-path="opening.objects[0].name"'), "should render object name");
  assert.ok(container.innerHTML.includes('data-path="opening.objects[0].known"'), "should render object known select");
  assert.ok(container.innerHTML.includes("要做出来"), "should render made-at checkbox option");

  // Deadlines
  assert.ok(container.innerHTML.includes('data-path="opening.deadlines[0].label"'), "should render deadline label");
  assert.ok(container.innerHTML.includes('data-path="opening.deadlines[0].dueClock"'), "should render deadline clock");
  assert.ok(container.innerHTML.includes('data-path="opening.deadlines[0].consequence"'), "should render deadline consequence");
  assert.ok(container.innerHTML.includes("object_ready") || container.innerHTML.includes("东西做好了"), "should render condition kind");

  // Mysteries
  assert.ok(container.innerHTML.includes('data-path="opening.mysteries[0]"'), "should render mystery item");

  // Events & Visitors count
  assert.ok(container.innerHTML.includes("1") && (container.innerHTML.includes("事件") || container.innerHTML.includes("来访")), "should display event/visitor count");

  // Rewrite page button
  assert.ok(container.innerHTML.includes("让模型重写这一页"), "should have rewrite opening button");
}

console.log("opening editor contracts passed");
