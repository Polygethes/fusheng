import assert from "node:assert/strict";

// Mock minimal DOM tree for tests
function createMockNode(tagName = "div") {
  const children = [];
  const classList = new Set();
  const attributes = new Map();
  const listeners = new Map();
  const dataset = {};

  const node = {
    tagName: tagName.toUpperCase(),
    hidden: false,
    disabled: false,
    value: "",
    checked: true,
    textContent: "",
    children,
    dataset,
    classList: {
      add: (c) => classList.add(c),
      remove: (c) => classList.delete(c),
      contains: (c) => classList.has(c),
    },
    get className() {
      return Array.from(classList).join(" ");
    },
    set className(val) {
      classList.clear();
      (val || "").split(/\s+/).filter(Boolean).forEach((c) => classList.add(c));
    },
    setAttribute: (k, v) => {
      attributes.set(k, String(v));
      if (k.startsWith("data-")) {
        const dataKey = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        dataset[dataKey] = String(v);
      }
    },
    getAttribute: (k) => attributes.get(k) || null,
    hasAttribute: (k) => attributes.has(k),
    removeAttribute: (k) => attributes.delete(k),
    appendChild: (child) => {
      children.push(child);
      child.parentNode = node;
      return child;
    },
    addEventListener: (ev, fn) => {
      if (!listeners.has(ev)) listeners.set(ev, []);
      listeners.get(ev).push(fn);
    },
    click: () => {
      const handlers = listeners.get("click") || [];
      const promises = [];
      for (const fn of handlers) {
        const res = fn({ target: node, type: "click" });
        if (res && typeof res.then === "function") promises.push(res);
      }
      return Promise.all(promises);
    },
    querySelector: (selector) => findDescendant(node, selector),
    querySelectorAll: (selector) => {
      const results = [];
      collectDescendants(node, selector, results);
      return results;
    },
    closest: () => node,
    getContext: () => ({
      imageSmoothingEnabled: false,
      clearRect: () => {},
      measureText: () => ({ width: 10 }),
      getImageData: () => ({ data: new Uint8ClampedArray(100) }),
      fillRect: () => {},
      drawImage: () => {},
      fillText: () => {},
      setTransform: () => {},
      translate: () => {},
      scale: () => {},
    }),
  };

  let innerHtmlVal = "";
  node._ownHtml = "";
  Object.defineProperty(node, "innerHTML", {
    get() {
      let all = innerHtmlVal;
      function walk(n) {
        for (const c of n.children) {
          all += " " + (c._ownHtml || "");
          walk(c);
        }
      }
      walk(node);
      return all;
    },
    set(val) {
      innerHtmlVal = val;
      node._ownHtml = val;
      children.length = 0;
      parseHtml(val, node);
    },
  });

  return node;
}

function parseHtml(html, parent) {
  const stack = [parent];
  const tagTokenRegex = /<(\/)?([a-zA-Z0-9]+)([^>]*)>|([^<]+)/g;
  let m;
  while ((m = tagTokenRegex.exec(html)) !== null) {
    const isClosing = Boolean(m[1]);
    const tagName = m[2];
    const attrsStr = m[3] || "";
    const text = m[4];
    if (text) {
      if (text.trim()) stack[stack.length - 1].textContent += text.trim();
      continue;
    }
    if (isClosing) {
      if (stack.length > 1) stack.pop();
    } else {
      const el = createMockNode(tagName);
      // parse attributes
      const attrRegex = /([a-zA-Z0-9_-]+)(?:="([^"]*)")?/g;
      let am;
      while ((am = attrRegex.exec(attrsStr)) !== null) {
        const k = am[1];
        const v = am[2] !== undefined ? am[2] : "";
        if (k === "class") el.className = v;
        else if (k === "hidden") el.hidden = true;
        else if (k === "disabled") el.disabled = true;
        else if (k === "checked") el.checked = true;
        else el.setAttribute(k, v);
      }
      stack[stack.length - 1].appendChild(el);
      const isSelfClosing = attrsStr.trim().endsWith("/") || ["input", "img", "br", "hr"].includes(tagName.toLowerCase());
      if (!isSelfClosing) {
        stack.push(el);
      }
    }
  }
}

function matchesSelector(node, selector) {
  if (selector.startsWith(".")) {
    const cls = selector.slice(1);
    return node.classList.contains(cls);
  }
  if (selector.startsWith("#")) {
    return node.getAttribute("id") === selector.slice(1);
  }
  if (selector.startsWith("[") && selector.endsWith("]")) {
    const [attr, val] = selector.slice(1, -1).split("=");
    if (!val) return node.hasAttribute(attr);
    const cleanVal = val.replace(/^["']|["']$/g, "");
    return node.getAttribute(attr) === cleanVal;
  }
  return node.tagName.toLowerCase() === selector.toLowerCase();
}

function findDescendant(node, selector) {
  for (const child of node.children) {
    if (matchesSelector(child, selector)) return child;
    const found = findDescendant(child, selector);
    if (found) return found;
  }
  return null;
}

function collectDescendants(node, selector, results) {
  for (const child of node.children) {
    if (matchesSelector(child, selector)) results.push(child);
    collectDescendants(child, selector, results);
  }
}

const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => storage.get(k) || null,
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
  clear: () => storage.clear(),
};

globalThis.confirm = () => true;

globalThis.document = {
  createElement: (tag) => {
    if (tag === "canvas") {
      return {
        width: 0,
        height: 0,
        getContext: () => ({
          imageSmoothingEnabled: false,
          clearRect: () => {},
          measureText: () => ({ width: 10 }),
          getImageData: () => ({ data: new Uint8ClampedArray(100) }),
          fillRect: () => {},
          drawImage: () => {},
          fillText: () => {},
          setTransform: () => {},
          translate: () => {},
          scale: () => {},
        }),
      };
    }
    return createMockNode(tag);
  },
};

const { blankBlueprint } = await import("../src/play/blueprintModel.js");
const { saveDraft, clearDraft, loadDraft } = await import("../src/play/draft.js");
const { render, checkStep } = await import("../src/play/views/craft.js");

// 1. Quick mode draft confirmation check
{
  clearDraft();
  saveDraft({ blueprint: blankBlueprint("古风"), seed: 1, mode: "quick" });
  let navigated = [];
  const ctx = { go: (p) => navigated.push(p), params: ["genre"] };
  let confirmed = false;
  globalThis.confirm = (msg) => {
    assert.ok(msg.includes("开始捏世界会替换掉现在的快速模式草稿"));
    confirmed = true;
    return false; // User cancels
  };
  const root = createMockNode("div");
  render(root, ctx);
  assert.ok(confirmed, "should prompt confirmation when quick draft exists");
  assert.equal(navigated[0], "new", "cancelled should return to new page");
}

// 2. Genre step renders 4 genres and selecting one saves craft draft
{
  clearDraft();
  let navigated = [];
  const ctx = { go: (p) => navigated.push(p), params: ["genre"] };
  const root = createMockNode("div");
  render(root, ctx);

  assert.ok(root.innerHTML.includes("古风"), "should show 古风 card");
  assert.ok(root.innerHTML.includes("现代"), "should show 现代 card");
  assert.ok(root.innerHTML.includes("奇幻"), "should show 奇幻 card");
  assert.ok(root.innerHTML.includes("自定义"), "should show 自定义 card");
  assert.ok(root.innerHTML.includes("捏一个世界"), "should show title");
  assert.ok(root.innerHTML.includes("← 返回"), "should show back button");

  const cards = root.querySelectorAll(".genre-card");
  assert.equal(cards.length, 4, "should have 4 genre cards");

  // Click on "古风"
  const gufengCard = cards.find((c) => c.dataset.genre === "古风");
  assert.ok(gufengCard);
  gufengCard.click();

  const saved = loadDraft();
  assert.ok(saved, "draft should be saved");
  assert.equal(saved.mode, "craft", "mode must be craft");
  assert.ok(saved.blueprint.meta.id.startsWith("my_town_"), "blueprint id must start with my_town_");
  assert.equal(navigated[navigated.length - 1], "craft/world", "clicking genre should go to craft/world");
}

// 3. Step validation tests (checkStep)
{
  const bp = blankBlueprint("古风");
  // World check: title and town name
  bp.meta.title = "";
  bp.town.name = "";
  let res = checkStep("world", bp);
  assert.equal(res.ok, false);
  assert.ok(res.issues.some((i) => i.includes("世界名") || i.includes("小镇名")));

  bp.meta.title = "明月镇";
  bp.town.name = "明月镇";
  res = checkStep("world", bp);
  assert.equal(res.ok, true);

  // Places check: at least 1 household, each household has siteId, at least 1 outdoor site
  res = checkStep("places", bp);
  assert.equal(res.ok, false, "empty households should fail places check");

  bp.households = [{ id: "hh_1", name: "张家", siteId: "site_home_1" }];
  res = checkStep("places", bp);
  assert.equal(res.ok, true, "1 household with site and outdoor sites should pass");

  // People check: each household has >= 1 resident, each resident has name and >= 1 desire
  res = checkStep("people", bp);
  assert.equal(res.ok, false, "empty residents should fail people check");

  bp.residents = [{ id: "res_1", name: "", householdId: "hh_1", desires: [] }];
  res = checkStep("people", bp);
  assert.equal(res.ok, false);
  assert.ok(res.issues.some((i) => i.includes("名字") || i.includes("欲望")));

  bp.residents[0].name = "张三";
  bp.residents[0].desires = [{ verb: "修好", object: "房顶", outcome: "不漏雨" }];
  res = checkStep("people", bp);
  assert.equal(res.ok, true);

  // Relationships check: each resident has >= 1 relationship
  res = checkStep("relationships", bp);
  assert.equal(res.ok, false, "no relationships should fail");

  bp.relationships = [{ from: "res_1", to: "res_1", label: "自省" }];
  res = checkStep("relationships", bp);
  assert.equal(res.ok, true);

  // Opening check: >= 1 deadline, each deadline >= 1 condition
  res = checkStep("opening", bp);
  assert.equal(res.ok, false, "no deadlines should fail opening check");

  bp.opening.deadlines = [{ label: "第一天", conditions: [] }];
  res = checkStep("opening", bp);
  assert.equal(res.ok, false, "deadline without conditions should fail");

  bp.opening.deadlines[0].conditions = [{ kind: "time", at: "18:00" }];
  res = checkStep("opening", bp);
  assert.equal(res.ok, true);
}

// 4. Wizard steps navigation
{
  const bp = blankBlueprint("古风");
  bp.meta.title = "仙霞镇";
  bp.town.name = "仙霞镇";
  saveDraft({ blueprint: bp, seed: 1, mode: "craft" });

  const root = createMockNode("div");
  let navigated = [];
  const ctx = { go: (p) => navigated.push(p), params: ["world"] };
  render(root, ctx);

  assert.ok(root.innerHTML.includes("世界与小镇"), "should render step title / steps bar");
  const nextBtn = root.querySelector(".btn-next");
  assert.ok(nextBtn);
  nextBtn.click();
  assert.equal(navigated[navigated.length - 1], "craft/places", "valid world step advances to places");

  // Invalid step warning and continue anyway
  bp.town.name = "";
  saveDraft({ blueprint: bp, seed: 1, mode: "craft" });
  const rootInvalid = createMockNode("div");
  navigated = [];
  render(rootInvalid, { go: (p) => navigated.push(p), params: ["world"] });
  const invalidNextBtn = rootInvalid.querySelector(".btn-next");
  invalidNextBtn.click();
  assert.equal(navigated.length, 0, "should not advance when step is invalid");
  const warningEl = rootInvalid.querySelector(".craft-step-warning");
  assert.equal(warningEl.hidden, false, "warning should be shown");
  const continueAnywayBtn = rootInvalid.querySelector(".btn-continue-anyway");
  assert.equal(continueAnywayBtn.hidden, false, "continue anyway button should be visible");
  continueAnywayBtn.click();
  assert.equal(navigated[navigated.length - 1], "craft/places", "continue anyway advances to places");
}

// 5. People step extra prompt resident generator
{
  const bp = blankBlueprint("古风");
  bp.households = [{ id: "hh_1", name: "张家", siteId: "site_home_1" }];
  saveDraft({ blueprint: bp, seed: 1, mode: "craft" });

  const root = createMockNode("div");
  let navigated = [];
  render(root, { go: (p) => navigated.push(p), params: ["people"] });

  assert.ok(root.innerHTML.includes("用一句话描述，让模型捏一个新居民"), "should render prompt resident bar");

  let calledUrl = null;
  let calledBody = null;
  globalThis.fetch = async (url, opts) => {
    calledUrl = url;
    calledBody = JSON.parse(opts.body);
    // Simulate failure to verify blank resident preserved
    return {
      json: async () => ({ ok: false, message: "模型调用超时" }),
    };
  };

  const inputEl = root.querySelector(".prompt-resident-input");
  inputEl.value = "药铺学徒，十五岁";
  const btn = root.querySelector(".btn-do-prompt-resident");
  await btn.click();

  assert.equal(calledUrl, "/api/create/rewrite");
  assert.equal(calledBody.instruction, "药铺学徒，十五岁");
  assert.ok(calledBody.sectionPath.startsWith("residents/"));

  // Check blank resident was preserved in draft
  const draft = loadDraft();
  assert.ok(draft.blueprint.residents.some((r) => r.name === "新居民"), "should preserve blank resident named 新居民 on error");
}

console.log("Craft wizard contracts passed: quick draft guard, genre pick, step validation, step navigation.");
