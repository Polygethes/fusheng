import assert from "node:assert/strict";
import { field, bindFields, describePath, escapeHtml } from "../src/play/editors/common.js";

// escapeHtml
assert.equal(escapeHtml('<script>alert("x & y")</script>'), "&lt;script&gt;alert(&quot;x &amp; y&quot;)&lt;/script&gt;");
assert.equal(escapeHtml(null), "");

// field() HTML generation
const textField = field({ path: "meta.title", label: "世界名", value: "柳溪镇", maxLength: 24, hint: "最多24字" });
assert.ok(textField.includes('data-path="meta.title"'));
assert.ok(textField.includes('value="柳溪镇"'));
assert.ok(textField.includes('maxlength="24"'));
assert.ok(textField.includes("世界名"));
assert.ok(textField.includes("最多24字"));

const textareaField = field({ path: "meta.premise", label: "前提", value: "山下的小镇", kind: "textarea", maxLength: 400 });
assert.ok(textareaField.includes("<textarea"));
assert.ok(textareaField.includes('data-path="meta.premise"'));
assert.ok(textareaField.includes("山下的小镇"));

const numberField = field({ path: "residents[0].age", label: "年龄", value: 30, kind: "number" });
assert.ok(numberField.includes('type="number"'));
assert.ok(numberField.includes('value="30"'));

const selectField = field({
  path: "town.terrain.river",
  label: "河流",
  value: "north",
  kind: "select",
  options: [{ value: null, label: "无" }, { value: "north", label: "北" }, { value: "south", label: "南" }],
});
assert.ok(selectField.includes("<select"));
assert.ok(selectField.includes('value="north" selected'));
assert.ok(selectField.includes('value=""'));

const clockField = field({ path: "meta.startClock", label: "开场时刻", value: "07:00", kind: "clock" });
assert.ok(clockField.includes('data-path="meta.startClock"'));
assert.ok(clockField.includes('value="07:00"'));

// describePath
const bp = {
  town: { sites: [{}, {}, {}, { id: "site_well", name: "老井", type: "well" }] },
  households: [{ id: "hh_1", name: "张家", siteId: "site_home_1" }],
  residents: [{}, {}, { id: "res_3", name: "王婶", routine: [{}, { siteId: "site_well" }] }],
  opening: { objects: [{}, { name: "药包", siteId: "site_home_1" }] },
};

assert.equal(describePath(bp, "households[0].siteId"), "户「张家」的住处");
assert.equal(describePath(bp, "residents[2].routine[1].siteId"), "「王婶」的作息第 2 段的地点");
assert.equal(describePath(bp, "town.sites[3].type"), "地点「老井」的类型");
assert.equal(describePath(bp, "opening.objects[1].siteId"), "开场物件「药包」的位置");
assert.equal(describePath(bp, "unknown.path.here"), "unknown.path.here");

// bindFields simulated
const updates = [];
const fakeCtx = {
  update: (path, val) => updates.push({ path, val }),
};
const listeners = new Map();
const fakeContainer = {
  querySelectorAll: (selector) => {
    if (selector !== "[data-path]") return [];
    return [
      {
        tagName: "INPUT",
        type: "text",
        getAttribute: (attr) => (attr === "data-path" ? "meta.title" : null),
        value: "新镇",
        addEventListener: (event, fn) => listeners.set(`input:${event}`, fn),
      },
      {
        tagName: "INPUT",
        type: "number",
        getAttribute: (attr) => (attr === "data-path" ? "residents[0].age" : null),
        value: "42",
        addEventListener: (event, fn) => listeners.set(`num:${event}`, fn),
      },
      {
        tagName: "SELECT",
        type: "select-one",
        getAttribute: (attr) => (attr === "data-path" ? "town.terrain.river" : null),
        value: "",
        addEventListener: (event, fn) => listeners.set(`sel:${event}`, fn),
      },
    ];
  },
};

bindFields(fakeContainer, fakeCtx);
listeners.get("input:input")();
listeners.get("num:input")();
listeners.get("sel:change")();

assert.deepEqual(updates, [
  { path: "meta.title", val: "新镇" },
  { path: "residents[0].age", val: 42 },
  { path: "town.terrain.river", val: null },
]);

console.log("Editor common contracts passed: field, describePath, bindFields, escapeHtml.");
