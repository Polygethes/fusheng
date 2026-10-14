// When the gateway is down — every attempt of a request timed out, could not
// connect, or was turned away as busy or unavailable (429/502/503/504) — a run
// waits and sends the request again instead of stopping.
// Each new try is a new request: it is recorded and counts against the run's
// request budget. An operator stop ends the wait; any other error ends it at once.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { GATEWAY_WAITS_SECONDS, isGatewayUnavailable, withGatewayWaits } from "../src/server/model/gatewayWait.mjs";
import { gatewayNote, waitingNote } from "../src/stage/waiting.js";

const silent = () => Object.assign(new Error("模型连续 3 次在 45 秒内没有回应。"), { code: "MODEL_REQUEST_TIMEOUT",
  attempts: [{ attempt: 1, outcome: "timeout" }, { attempt: 2, outcome: "timeout" }, { attempt: 3, outcome: "timeout" }] });
const unreachable = () => Object.assign(new TypeError("fetch failed"), {
  attempts: [{ attempt: 1, outcome: "network_error" }, { attempt: 2, outcome: "timeout" }, { attempt: 3, outcome: "network_error" }] });
// What the user's gateway answered on 2026-10-12 when its admission control went down.
const busy = () => Object.assign(new Error("distributed admission control is unavailable"), { code: "GEMINI_API_ERROR", httpStatus: 503,
  attempts: [{ attempt: 1, outcome: "http_503" }, { attempt: 2, outcome: "http_503" }, { attempt: 3, outcome: "http_503" }] });
const refused = () => Object.assign(new Error("Gemini API returned HTTP 400."), { code: "GEMINI_API_ERROR", httpStatus: 400,
  attempts: [{ attempt: 1, outcome: "http_400" }] });

function fakeClock() {
  const slept = [];
  let now = Date.parse("2026-10-12T01:19:29.000Z");
  return { slept, now: () => now, sleep: async (ms) => { slept.push(ms); now += ms; } };
}

test("the waits add up to a few minutes, longer each time", () => {
  assert.deepEqual(GATEWAY_WAITS_SECONDS, [30, 60, 120, 120]);
});

test("the gateway is down when no attempt got through: silence, a broken connection, or busy/unavailable", () => {
  assert.equal(isGatewayUnavailable(silent()), true);
  assert.equal(isGatewayUnavailable(unreachable()), true, "a connection that fails");
  assert.equal(isGatewayUnavailable(busy()), true, "503: the gateway's admission control is down");
  for (const status of [429, 502, 503, 504]) {
    const error = Object.assign(new Error("busy"), { code: "GEMINI_API_ERROR", httpStatus: status, attempts: [{ attempt: 1, outcome: "timeout" }, { attempt: 2, outcome: `http_${status}` }] });
    assert.equal(isGatewayUnavailable(error), true, `http ${status}`);
  }
  assert.equal(isGatewayUnavailable(refused()), false, "a refusal of the request itself is not the gateway being down");
  assert.equal(isGatewayUnavailable(Object.assign(new Error("x"), { attempts: [{ attempt: 1, outcome: "http_503" }, { attempt: 2, outcome: "http_400" }] })), false,
    "once the gateway answers with a real refusal, waiting will not help");
  assert.equal(isGatewayUnavailable(Object.assign(new Error("x"), { code: "CHARACTER_STAGE_OUTPUT_INVALID" })), false);
  assert.equal(isGatewayUnavailable(Object.assign(new Error("x"), { attempts: [] })), false);
  assert.equal(isGatewayUnavailable(null), false);
});

test("after the gateway turns requests away as unavailable, the run waits and sends again", async () => {
  const clock = fakeClock();
  const rounds = [];
  const result = await withGatewayWaits(async (round) => {
    rounds.push(round);
    if (round < 1) throw busy();
    return { ok: true };
  }, { sleep: clock.sleep, now: clock.now });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(rounds, [0, 1]);
  assert.equal(clock.slept.reduce((sum, ms) => sum + ms, 0), 30_000);
});

test("after silence the run waits, says so, and sends the request again", async () => {
  const clock = fakeClock();
  const rounds = [], waits = [];
  const result = await withGatewayWaits(async (round) => {
    rounds.push(round);
    if (round < 2) throw silent();
    return { ok: true };
  }, { sleep: clock.sleep, now: clock.now, onWait: (row) => waits.push(row) });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(rounds, [0, 1, 2], "round 0 is the first request; each later round is a retry");
  assert.deepEqual(waits.map(({ round, rounds: of, waitSeconds }) => [round, of, waitSeconds]), [[1, 4, 30], [2, 4, 60]]);
  assert.equal(waits[0].until, "2026-10-12T01:19:59.000Z", "the observer is told when the next try starts");
  assert.equal(waits[1].until, "2026-10-12T01:20:59.000Z");
  assert.equal(clock.slept.reduce((sum, ms) => sum + ms, 0), 90_000, "it waited 30 s and then 60 s");
  assert.ok(clock.slept.every((ms) => ms <= 1000), "the wait is taken in short steps so a stop is noticed quickly");
});

test("any other error ends the run's request at once, without waiting", async () => {
  const clock = fakeClock();
  let sends = 0;
  await assert.rejects(withGatewayWaits(async () => { sends += 1; throw refused(); }, { sleep: clock.sleep, now: clock.now }),
    (error) => error.code === "GEMINI_API_ERROR");
  assert.equal(sends, 1);
  assert.deepEqual(clock.slept, []);
});

test("when the gateway never comes back, the error says how long the run waited", async () => {
  const clock = fakeClock();
  let sends = 0;
  await assert.rejects(withGatewayWaits(async () => { sends += 1; throw silent(); }, { sleep: clock.sleep, now: clock.now }),
    (error) => {
      assert.equal(error.code, "MODEL_REQUEST_TIMEOUT");
      assert.equal(error.message, "模型连续 3 次在 45 秒内没有回应。之后又等了约 6 分钟，网关仍然不通。");
      return true;
    });
  assert.equal(sends, GATEWAY_WAITS_SECONDS.length + 1, "the first request and one retry after each wait");
  assert.equal(clock.slept.reduce((sum, ms) => sum + ms, 0), 330_000);
});

test("a stop during the wait ends it without another request", async () => {
  const clock = fakeClock();
  let sends = 0, stop = false;
  await assert.rejects(withGatewayWaits(async () => { sends += 1; throw unreachable(); }, {
    now: clock.now, shouldStop: () => stop,
    sleep: async (ms) => { await clock.sleep(ms); if (clock.slept.length === 5) stop = true; },
  }), (error) => {
    assert.equal(error.code, "STOPPED_WHILE_WAITING");
    return true;
  });
  assert.equal(sends, 1);
  assert.ok(clock.slept.length <= 6, "the stop is noticed within a second");
});

test("custom waits are honoured", async () => {
  const clock = fakeClock();
  let sends = 0;
  await assert.rejects(withGatewayWaits(async () => { sends += 1; throw silent(); }, { waits: [1], sleep: clock.sleep, now: clock.now }),
    (error) => /之后又等了约 1 分钟/u.test(error.message));
  assert.equal(sends, 2);
});

test("the observer says the gateway is down and when it tries again", () => {
  const until = "2026-10-12T01:19:59.000Z";
  const at = (seconds) => Date.parse(until) + seconds * 1000;
  assert.equal(gatewayNote(null, at(0)), "");
  assert.equal(gatewayNote({ until, round: 1, rounds: 4 }, at(-25)), " · 网关暂时不通，25 秒后再试（第 1/4 次）");
  assert.equal(gatewayNote({ until, round: 1, rounds: 4 }, at(-0.2)), " · 网关暂时不通，1 秒后再试（第 1/4 次）", "never says 0 seconds");
  assert.equal(gatewayNote({ until, round: 2, rounds: 4 }, at(3)), " · 网关暂时不通，正在再试（第 2/4 次）");
  assert.equal(gatewayNote({ until: "not a time", round: 2, rounds: 4 }, at(0)), "");
  assert.equal(waitingNote(null, at(0)), "", "the model-wait note is unchanged");
});

test("the runner sends every request through the gateway wait and counts each retry against the budget", () => {
  const runner = fs.readFileSync(new URL("./runV27GeminiSimulation.mjs", import.meta.url), "utf8");
  assert.match(runner, /import \{ withGatewayWaits \} from "\.\.\/src\/server\/model\/gatewayWait\.mjs";/u);
  assert.match(runner, /return withGatewayWaits\(async \(round\) => \{\s*if \(report\.calls\.length >= maxRequests\)/u,
    "the budget is checked before every try, retries included");
  assert.match(runner, /shouldStop: \(\) => stopRequested/u);
  assert.match(runner, /event: "gateway_wait"/u);
  assert.match(runner, /error\.code === "STOPPED_WHILE_WAITING"/u);
});
