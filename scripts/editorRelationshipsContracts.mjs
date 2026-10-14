import assert from "node:assert/strict";
import { blankBlueprint, addResident, setRelationship } from "../src/play/blueprintModel.js";

// Mock document for Node environment
if (!globalThis.document) {
  globalThis.document = {
    createElement: () => ({
      classList: { add: () => {}, remove: () => {} },
      appendChild: () => {},
    }),
  };
}

const { render } = await import("../src/play/editors/relationships.js");

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

// 1. Relationships rendering and unlinked residents warning
{
  let bp = blankBlueprint("古风");
  const r1 = addResident(bp, bp.households[0]?.id || "");
  bp = r1.blueprint;
  const r2 = addResident(bp, bp.households[0]?.id || "");
  bp = r2.blueprint;
  const r3 = addResident(bp, bp.households[0]?.id || "");
  bp = r3.blueprint;

  bp.residents[0].name = "阿吉";
  bp.residents[1].name = "小芸";
  bp.residents[2].name = "孤翁";

  // Add relationship from 阿吉 to 小芸
  bp = setRelationship(bp, bp.residents[0].id, bp.residents[1].id, {
    label: "师徒",
    feelings: { protection: 40, wantsToBeSeen: 40 },
    address: ["师妹", "阿芸"],
    unspoken: "一直想跟她说",
    misreading: "以为她不在意",
  });

  const ctx = {
    blueprint: () => bp,
    update: () => {},
    replace: () => {},
    rewrite: () => {},
  };

  const container = createMockContainer();
  render(container, ctx);

  // Top hint about direction
  assert.ok(container.innerHTML.includes("关系有方向"), "should show direction guidance");

  // Unlinked resident notice
  assert.ok(container.innerHTML.includes("孤翁"), "should warn about resident without relationship");

  // Relationship card
  assert.ok(container.innerHTML.includes("阿吉 → 小芸") || (container.innerHTML.includes("阿吉") && container.innerHTML.includes("小芸")), "should display card with A -> B");
  assert.ok(container.innerHTML.includes('data-path="relationships[0].label"'), "should render label input");
  assert.ok(container.innerHTML.includes('data-path="relationships[0].unspoken"'), "should render unspoken input");
  assert.ok(container.innerHTML.includes('data-path="relationships[0].misreading"'), "should render misreading input");

  // Presets buttons
  assert.ok(container.innerHTML.includes("父子 / 母女 / 亲人") || container.innerHTML.includes("夫妻"), "should render relationship preset buttons");

  // Address
  assert.ok(container.innerHTML.includes("师妹，阿芸") || container.innerHTML.includes("师妹, 阿芸") || container.innerHTML.includes("师妹"), "should render address");

  // Feelings sliders
  assert.ok(container.innerHTML.includes("想护着") || container.innerHTML.includes("protection"), "should show protection dimension");
  assert.ok(container.innerHTML.includes("想被看见") || container.innerHTML.includes("wantsToBeSeen"), "should show wantsToBeSeen dimension");

  // Actions
  assert.ok(container.innerHTML.includes("让模型重写这条"), "should have rewrite relationship button");
  assert.ok(container.innerHTML.includes("添加关系"), "should have add relationship section");
}

console.log("relationships editor contracts passed");
