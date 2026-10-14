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
const { buildObservationEvents } = await import("../src/ui/render.js");

resetState();
applySetupWorld({
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵、散修和城中执法者都被中立城规矩暂时压住。",
});
setUi({ timeGrain: "day", focusMode: "ambient", activeTab: "observe", engineMode: "mock" });

const firstDraft = playNext(getState());
const firstEvents = buildObservationEvents(firstDraft, getState()).filter((event) => event.movementSource === "period-tick");
recordObservedDraft(firstDraft);
const secondDraft = playNext(getState());
const secondEvents = buildObservationEvents(secondDraft, getState()).filter((event) => event.movementSource === "period-tick");

const currentState = getState();
const gate = currentState.locations.find((location) => location.id === "loc_xianxia_contract_gate");
const [source, target] = currentState.characters;
const staleMemoryDraft = {
  id: "draft_stale_relationship_dialogue",
  periodSimulation: {
    ticks: [{
      id: "tick_stale_relationship_dialogue",
      label: "上午",
      locationId: gate.id,
      locationName: gate.name,
      participantIds: [source.id, target.id],
      agentOutputs: [],
      backgroundEvents: [],
      surfaceEvent: "旧关系记忆重新进入现场",
      synthesized: { irreversibleTraces: [] },
      sceneInteraction: {
        agentExchanges: [{
          dialogueTurns: [{
            speakerId: source.id,
            speakerName: source.name,
            targetId: target.id,
            targetName: target.name,
            line: "庇护牌别收回去，刚才那句话当着铜盘说完。",
            turnRole: "turn",
          }],
          eventOutcome: "庇护牌留在铜盘边。",
        }],
      },
    }],
  },
};
const staleMemoryEvents = buildObservationEvents(staleMemoryDraft, currentState)
  .filter((event) => event.movementSource === "period-tick");

const templatePattern = /解释权不能由你替我写完|这次你不能只把话推回去|下一句先写清楚|下一句别再绕过|刚才那句话当着[^。！？”]{1,16}说完|刚才漏掉的名字现在补上|这一件先别换手|谁要带走，先把名字写清楚|贴着规矩走，不贴着谁的袖口走|我(?:先|只|不)?答|谁碰过它|谁要(?:拿走|带走)谁先(?:说清|交代)|谁先伸手谁先说名|谁想命名谁先|谁伸手谁先|伸手的人先(?:报名字|说清|交代)|谁再加码|谁想改价|谁(?:换名字|借规矩退后|先改口|加价|要拖人|要解释|要改口)|谁把旧案说完谁再伸手|谁改口谁进案卷|谁也不会替你撤|它也不会替你撤|要么[^。！？”]{1,24}要么/;
const stale = [...firstEvents, ...secondEvents, ...staleMemoryEvents].filter((event) => templatePattern.test(event.text || ""));

assert.equal(
  stale.length,
  0,
  `observation dialogue should not expose high-frequency template followups:\n${JSON.stringify(stale.slice(0, 6).map((event) => ({
    time: event.time,
    location: event.location,
    text: event.text,
  })), null, 2)}`,
);

console.log("dialogueTemplateFatigue:test passed", {
  checked: firstEvents.length + secondEvents.length + staleMemoryEvents.length,
});
