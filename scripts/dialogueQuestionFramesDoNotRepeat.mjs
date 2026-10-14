import assert from "node:assert/strict";

const {
  applySetupWorld,
  getState,
  recordObservedDraft,
  resetState,
  setUi,
} = await import("../src/state/store.js");
const { playNext } = await import("../src/engine/mockEngine.js");
const { buildObservationEvents } = await import("../src/ui/render.js");

function seededRandom(seed) {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

function questionFrame(line = "") {
  return String(line || "")
    .replace(/门刚开时|账页翻到这里|日影偏过去|灯影压下来|夜灯亮着/g, "时刻")
    .replace(/灵契|契牌|妖丹盒|庇护牌|渡令|魂灯|照骨镜|剑匣|魔印|符箓|一枚符|纸页|药炉/g, "物件")
    .replace(/铜盘|案台|水线|岸边|镜下|药炉旁|明处|这里/g, "位置")
    .replace(/界石|摊主|水阵|照骨镜|药炉|旁观者/g, "见证者")
    .replace(/袖口带血的人|被追到水线内的人|伤者|人名|旁边的人/g, "被护住的人")
    .replace(/[，。；：\s]/g, "")
    .trim();
}

function runObservedDays(seed) {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  Math.random = seededRandom(seed);
  resetState();
  applySetupWorld({
    setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
    setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵、散修和城中执法者都被中立城规矩暂时压住。",
  });
  setUi({ timeGrain: "day", focusMode: "ambient", activeTab: "observe", engineMode: "mock" });

  const allEvents = [];
  for (let day = 0; day < 2; day += 1) {
    const draft = playNext(getState());
    allEvents.push(...buildObservationEvents(draft, getState()).map((event) => ({ day, text: event.text || "" })));
    recordObservedDraft(draft);
  }
  return allEvents.flatMap((event) =>
    [...event.text.matchAll(/([^。！？：“”]{1,8})说：“([^”]*？)”/g)]
      .map((match) => ({
        seed,
        day: event.day,
        speaker: match[1],
        line: match[2],
        frame: questionFrame(match[2]),
      }))
      .filter((item) => item.line.includes("还是"))
  );
}

const questions = [3, 7, 11, 17, 23].flatMap(runObservedDays);
const repeatedFrames = [];
const seen = new Map();
for (const question of questions) {
  const key = `${question.seed}:${question.speaker}:${question.frame}`;
  const previous = seen.get(key);
  if (previous) repeatedFrames.push([previous, question]);
  else seen.set(key, question);
}

assert.equal(
  repeatedFrames.length,
  0,
  `same speaker should not reuse normalized binary-question frames across observed days:\n${JSON.stringify(repeatedFrames.slice(0, 5), null, 2)}`,
);

console.log("dialogueQuestionFramesDoNotRepeat:test passed", {
  questions: questions.length,
});
