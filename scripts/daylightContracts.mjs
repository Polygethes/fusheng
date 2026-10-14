import assert from "node:assert/strict";
import { daylightAt, clockSeconds } from "../src/stage/daylight.js";

assert.equal(clockSeconds("07:30"), 27000);
assert.equal(clockSeconds(""), null);
const alpha = (seconds) => daylightAt(seconds).shade[3];
assert.equal(alpha(12 * 3600), 0, "noon is not shaded");
assert.ok(alpha(0) >= 0.4 && alpha(23 * 3600) >= 0.4, "night is dark");
assert.ok(alpha(6 * 3600) > 0 && alpha(6 * 3600) < alpha(0), "dawn is in between");
assert.equal(daylightAt(12 * 3600).lamps, 0);
assert.equal(daylightAt(0).lamps, 1);
for (let s = 0; s < 86400; s += 600) {
  assert.ok(Math.abs(alpha(s) - alpha((s + 600) % 86400)) <= 0.1, `no jump at ${s}`);
}
assert.deepEqual(daylightAt(86400 + 3600), daylightAt(3600), "wraps around midnight");

console.log("Daylight passed.");

