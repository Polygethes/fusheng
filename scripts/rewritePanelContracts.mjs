import assert from "node:assert/strict";

// Mock minimal DOM for rewritePanel
function createMockNode(tagName = "div") {
  const children = [];
  const classList = new Set();
  const attributes = new Map();
  const node = {
    tagName: tagName.toUpperCase(),
    hidden: false,
    disabled: false,
    value: "",
    checked: true,
    textContent: "",
    children,
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
      val.split(/\s+/).filter(Boolean).forEach((c) => classList.add(c));
    },
    setAttribute: (k, v) => attributes.set(k, v),
    getAttribute: (k) => attributes.get(k) || null,
    appendChild: (child) => {
      children.push(child);
      return child;
    },
    querySelector: (selector) => {
      return findDescendant(node, selector);
    },
    querySelectorAll: (selector) => {
      const results = [];
      collectDescendants(node, selector, results);
      return results;
    },
  };

  let innerHTML = "";
  Object.defineProperty(node, "innerHTML", {
    get() {
      return innerHTML;
    },
    set(val) {
      innerHTML = val;
      // Parse child nodes with classes
      children.length = 0;
      parseSimpleHtml(val, node);
    },
  });

  return node;
}

function parseSimpleHtml(html, parent) {
  const stack = [parent];
  const tagTokenRegex = /<(\/)?([a-zA-Z0-9]+)([^>]*)>|([^<]+)/g;
  let m;
  while ((m = tagTokenRegex.exec(html)) !== null) {
    const isClosing = Boolean(m[1]);
    const tagName = m[2];
    const attrs = m[3] || "";
    const text = m[4];
    if (text) {
      if (text.trim()) stack[stack.length - 1].textContent += text.trim();
      continue;
    }
    if (isClosing) {
      if (stack.length > 1) stack.pop();
    } else {
      const el = createMockNode(tagName);
      const classMatch = attrs.match(/class="([^"]+)"/);
      if (classMatch) el.className = classMatch[1];
      const checkedMatch = attrs.match(/\bchecked\b/);
      if (checkedMatch) el.checked = true;
      const typeMatch = attrs.match(/type="([^"]+)"/);
      if (typeMatch) el.type = typeMatch[1];
      stack[stack.length - 1].appendChild(el);
      const isSelfClosing = attrs.trim().endsWith("/") || ["input", "img", "br", "hr"].includes(tagName.toLowerCase());
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
  return false;
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

globalThis.document = {
  createElement: (tag) => createMockNode(tag),
};

const { openRewritePanel } = await import("../src/play/rewritePanel.js");

// Test 1: modal creation and opening
{
  const anchor = createMockNode("div");
  const dummyBlueprint = { meta: { title: "测试世界" } };
  let doneCalledWith = null;

  openRewritePanel({
    anchor,
    sectionPath: "meta",
    label: "世界",
    blueprint: dummyBlueprint,
    onDone: (bp) => {
      doneCalledWith = bp;
    },
  });

  const modal = anchor.querySelector(".rewrite-modal");
  assert.ok(modal, "modal should be appended to anchor");
  assert.equal(modal.hidden, false, "modal should be visible");
  assert.equal(modal.querySelector(".rewrite-modal-title").textContent, "让模型重写 · 世界");
  assert.equal(modal.querySelector(".rewrite-auth").checked, false, "the player ticks the model authorization themselves");

  // Cancel closes modal
  const cancelBtn = modal.querySelector(".btn-cancel-rewrite");
  cancelBtn.onclick();
  assert.equal(modal.hidden, true, "modal should be hidden on cancel");
}

// Test 2: validation error when not authorized
{
  const anchor = createMockNode("div");
  openRewritePanel({
    anchor,
    sectionPath: "meta",
    label: "世界",
    blueprint: {},
    onDone: () => {},
  });

  const modal = anchor.querySelector(".rewrite-modal");
  const authEl = modal.querySelector(".rewrite-auth");
  assert.equal(authEl.checked, false, "not authorized until the player ticks it");
  let requested = false;
  globalThis.fetch = async () => { requested = true; return { json: async () => ({ ok: true }) }; };

  const doBtn = modal.querySelector(".btn-do-rewrite");
  await doBtn.onclick();
  assert.equal(requested, false, "nothing is sent to the model without authorization");

  const statusEl = modal.querySelector(".rewrite-status");
  assert.ok(statusEl.textContent.includes("请勾选授权"), "should warn about authorization");
  assert.ok(statusEl.classList.contains("error"));
}

// Test 3: successful rewrite calls /api/create/rewrite and triggers onDone
{
  const anchor = createMockNode("div");
  const originalBp = { meta: { title: "旧世界" } };
  const updatedBp = { meta: { title: "新世界" } };
  let doneCalledWith = null;
  let fetchBody = null;

  globalThis.fetch = async (url, options) => {
    assert.equal(url, "/api/create/rewrite");
    fetchBody = JSON.parse(options.body);
    return {
      json: async () => ({
        ok: true,
        blueprint: updatedBp,
        issues: [],
      }),
    };
  };

  openRewritePanel({
    anchor,
    sectionPath: "meta",
    label: "世界信息",
    blueprint: originalBp,
    onDone: (bp) => {
      doneCalledWith = bp;
    },
  });

  const modal = anchor.querySelector(".rewrite-modal");
  const instructionEl = modal.querySelector(".rewrite-instruction");
  instructionEl.value = "名字改响亮一点";
  modal.querySelector(".rewrite-auth").checked = true;

  const doBtn = modal.querySelector(".btn-do-rewrite");
  await doBtn.onclick();

  assert.deepEqual(fetchBody, {
    blueprint: originalBp,
    sectionPath: "meta",
    instruction: "名字改响亮一点",
    authorized: true,
    maxRequests: 3,
  });

  assert.deepEqual(doneCalledWith, updatedBp, "onDone should receive updated blueprint");
  const statusEl = modal.querySelector(".rewrite-status");
  assert.ok(statusEl.textContent.includes("已重写"), "should report success");
}

console.log("Rewrite panel contracts passed: creation, cancel, auth check, API call, onDone callback.");
