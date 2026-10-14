import assert from "node:assert/strict";
import { initialState } from "../src/data/seed.js";
import { inferPixelPreview, renderApp } from "../src/ui/render.js";

const html = renderApp(initialState);

assert.ok(html.includes('data-book-setup="true"'), "setup should render as an open book");
assert.ok(html.includes('data-book-page="input"'), "book setup should include an input page");
assert.ok(html.includes('data-book-page="preview"'), "book setup should include a preview page");
assert.ok(html.includes('data-immersive-setup="true"'), "setup should render as an immersive world desk");
assert.ok(html.includes('data-pixel-viewport="true"'), "book setup should include a pixel viewport");
assert.ok(html.includes('data-pixel-map-view="top-down"'), "pixel viewport should use a top-down town map");
assert.ok(html.includes('data-pixel-district='), "top-down map should include districts");
assert.ok(html.includes('data-pixel-path='), "top-down map should include streets or paths");
assert.ok(html.includes('data-plan-block='), "top-down map should use realistic plan blocks");
assert.ok(html.includes('data-plan-road='), "top-down map should use realistic road segments");
assert.ok(html.includes('data-plan-fixture='), "objects should render as fixtures, not floating dots");
assert.ok(html.includes('data-pixel-person="true"'), "characters should render as real top-down pixel people");
assert.ok(html.includes('pixel-person-head'), "pixel people should include a head part, not a dot marker");
assert.ok(html.includes('pixel-person-body'), "pixel people should include a body part, not a dot marker");
assert.ok(html.includes('data-movement-source="setup-preview"'), "setup preview should declare that its actors are not event-driven yet");
assert.ok(!html.includes('data-actor-motion="route"'), "setup preview should not fake route movement before events exist");
assert.ok(!html.includes('plan-route-'), "setup preview should not depend on looping CSS route names");
assert.ok(!html.includes('data-pixel-object='), "top-down plan should not render abstract floating object dots");
assert.ok(!html.includes('object-1'), "top-down plan should not render old static object markers");
assert.ok(html.includes('data-pixel-town="true"'), "pixel viewport should include a pixel town/stage");
assert.ok(html.includes("望梯酒馆今天承受什么外界压力？"), "book input page should keep the focused pressure question");
assert.ok(!html.includes("Skill") && !html.includes("底层规则"), "book setup should keep backend skill language hidden");
assert.ok(!html.includes("pixel-sky"), "top-down town map should not render a side-view sky");

const renderedPixelPeople = [...html.matchAll(/data-pixel-actor="([^"]*)"/g)].map((match) => match[1]);
assert.ok(renderedPixelPeople.includes("谢真石") && renderedPixelPeople.includes("谢母"), "the focused preview should show the tavern's real core cast");
assert.ok(!renderedPixelPeople.includes("人物一"), "the focused preview should not fall back to anonymous placeholder people");

const xiyou = inferPixelPreview({
  setupWorldPrompt: "一条漫长的取经路，神佛、妖怪、官府、山野和人心试炼同时存在。",
  setupPeoplePrompt: "唐僧、孙悟空、猪八戒、沙悟净和妖怪。",
});

assert.equal(xiyou.theme, "journey-west", "pixel preview should react to world prompt themes");
assert.equal(xiyou.view, "top-down", "pixel preview should infer a top-down view");
assert.ok(xiyou.actors.includes("孙悟空"), "journey-west preview should show the right cast");
assert.ok(xiyou.objects.includes("通关文牒"), "journey-west preview should show world-specific objects");
assert.ok(xiyou.districts.includes("山门前"), "journey-west preview should include top-down districts");
assert.ok(xiyou.paths.length >= 3, "top-down preview should include connected routes");

console.log("setupBookPixelPreview:test passed", {
  defaultTheme: inferPixelPreview(initialState.ui).theme,
  xiyouTheme: xiyou.theme,
});
