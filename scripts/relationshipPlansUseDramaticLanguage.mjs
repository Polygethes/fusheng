import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) || null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
};

const {
  applySetupWorld,
  getState,
  recordObservedDraft,
  resetState,
  setUi,
} = await import("../src/state/store.js");
const { playNext } = await import("../src/engine/mockEngine.js");

resetState();
applySetupWorld({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵、散修和城中执法者都被中立城规矩暂时压住。",
});
setUi({ timeGrain: "day", focusMode: "ambient", activeTab: "observe", engineMode: "mock" });

for (let day = 0; day < 3; day += 1) {
  const draft = playNext(getState());
  recordObservedDraft(draft);
}

const state = getState();
const plans = state.characterPlans || [];
const planText = plans
  .map((plan) => [
    plan.shortTerm,
    plan.shortTermPlan,
    plan.immediateObjective,
    plan.hiddenObjective,
    ...(plan.planLog || []).map((item) => item.line || item),
  ].filter(Boolean).join("\n"))
  .join("\n\n");

assert.ok(plans.length >= state.characters.length, "every character should still have a plan");
assert.ok(plans.every((plan) => Number(plan.progress || 0) > 0), "multi-day relationships should advance every character plan");
assert.doesNotMatch(
  planText,
  /关系变化来自|未结清|连续\d+\s*轮|不再按单次互动计算|关系回流/,
  `character plans should read like dramatic next actions, not backend relationship logs:\n${planText}`,
);
assert.doesNotMatch(
  planText,
  /藏住证据[^，。；：\s]{1,8}|撤退并遮掩[^，。；：\s]{1,8}/,
  `character plans should not glue a tactic directly to a character name:\n${planText}`,
);
assert.match(
  planText,
  /灵契|妖丹盒|庇护牌|照骨镜|渡令|魂灯|停剑令|案台|水线|铜盘|药炉|镜面|茶楼/,
  "relationship-shaped plans should keep concrete dramatic anchors",
);
assert.match(
  planText,
  /下一步|先|逼问|保护|撤退|夺回|藏住|靠近/,
  "relationship-shaped plans should still describe playable next actions",
);

console.log("relationshipPlansUseDramaticLanguage:test passed", {
  plans: plans.map((plan) => ({
    characterId: plan.characterId,
    progress: plan.progress,
    shortTerm: plan.shortTerm,
  })),
});
