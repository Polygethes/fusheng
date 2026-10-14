import assert from "node:assert/strict";

// Mock localStorage and document for node environment before importing review.js
const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => storage.get(k) || null,
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
  clear: () => storage.clear(),
};

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
        }),
      };
    }
    return {
      classList: { add: () => {}, remove: () => {} },
      appendChild: () => {},
    };
  },
};

const { blankBlueprint } = await import("../src/play/blueprintModel.js");
const { saveDraft, clearDraft } = await import("../src/play/draft.js");
const { render } = await import("../src/play/views/review.js");

function createMockElement() {
  let innerHTML = "";
  const el = {
    get innerHTML() { return innerHTML; },
    set innerHTML(val) { innerHTML = val; },
    dataset: {},
    hidden: false,
    disabled: false,
    value: "8",
    textContent: "",
    tagName: "DIV",
    addEventListener: () => {},
    getAttribute: () => null,
    setAttribute: () => {},
    classList: { add: () => {}, remove: () => {} },
    scrollIntoView: () => {},
    focus: () => {},
    closest: () => el,
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
    querySelector: (selector) => {
      return createMockElement();
    },
  };
  return el;
}

function createMockRoot() {
  const root = createMockElement();
  const editorContainer = createMockElement();
  root._editorContainer = editorContainer;
  const originalQS = root.querySelector;
  root.querySelector = (selector) => {
    if (selector === ".tab-editor-container") return editorContainer;
    return originalQS(selector);
  };
  return root;
}

// 1. Without draft
{
  clearDraft();
  const root = createMockRoot();
  const navigated = [];
  const ctx = { go: (p) => navigated.push(p), params: [] };
  render(root, ctx);
  assert.ok(root.innerHTML.includes("还没有草稿"), "should show empty draft message");
}

// 2. With draft
{
  const bp = blankBlueprint("古风");
  bp.meta.title = "测试桃源镇";
  saveDraft({
    blueprint: bp,
    seed: 42,
    mode: "quick",
    lastCheck: {
      ok: false,
      stale: false,
      issues: [
        { section: "world", path: "meta.title", message: "名字太短" },
        { section: "places", path: "town.sites[0].name", message: "地点名无效" },
      ],
    },
  });

  const root = createMockRoot();
  const navigated = [];
  const ctx = { go: (p) => navigated.push(p), params: ["world"] };
  render(root, ctx);

  assert.ok(root.innerHTML.includes("测试桃源镇"), "should show town title");
  assert.ok(root.innerHTML.includes("快速模式草稿"), "should show source tag");
  assert.ok(root.innerHTML.includes("编译并检查"), "should have compile button");
  assert.ok(root.innerHTML.includes("花费估算"), "should have cost estimate");
  assert.ok(root.innerHTML.includes("开始"), "should have start button");
  // Check tab problem counts
  assert.ok(root.innerHTML.includes("世界 · 1"), "world tab should show 1 issue");
  assert.ok(root.innerHTML.includes("地点 · 1"), "places tab should show 1 issue");

  // 3. Render people tab
  {
    const rootPeople = createMockRoot();
    render(rootPeople, { go: () => {}, params: ["people"] });
    assert.ok(rootPeople._editorContainer.innerHTML.includes("people-page") || rootPeople._editorContainer.innerHTML.includes("person-card"), "should render people editor");
  }

  // 4. Render relationships tab
  {
    const rootRel = createMockRoot();
    render(rootRel, { go: () => {}, params: ["relationships"] });
    assert.ok(rootRel._editorContainer.innerHTML.includes("relationships-editor") || rootRel._editorContainer.innerHTML.includes("关系有方向"), "should render relationships editor");
  }

  // 5. Render opening tab
  {
    const rootOpening = createMockRoot();
    render(rootOpening, { go: () => {}, params: ["opening"] });
    assert.ok(rootOpening._editorContainer.innerHTML.includes("opening-editor") || rootOpening._editorContainer.innerHTML.includes("opening.situation"), "should render opening editor");
  }
}

console.log("Review view contracts passed: empty state, draft view, tabs, check panel.");
