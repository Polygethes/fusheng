// Blueprint paths: the same strings validateBlueprint reports read and write
// the field, without changing the original, and find the closest input.
import assert from "node:assert/strict";
import { parsePath, getAt, setAt, nearestField } from "../src/play/paths.js";

assert.deepEqual(parsePath("residents[2].desires[0].object"), ["residents", 2, "desires", 0, "object"]);
assert.deepEqual(parsePath("opening.positions.li_dashan"), ["opening", "positions", "li_dashan"]);
assert.throws(() => parsePath("a[x]"), (error) => error.code === "PATH_INVALID");
const bp = { residents: [{ id: "a", desires: [{ object: "药" }] }], opening: { positions: {} } };
assert.equal(getAt(bp, "residents[0].desires[0].object"), "药");
assert.equal(getAt(bp, "residents[3].name"), undefined);
const next = setAt(bp, "residents[0].desires[0].object", "腰伤药包");
assert.equal(next.residents[0].desires[0].object, "腰伤药包");
assert.equal(bp.residents[0].desires[0].object, "药", "the original is unchanged");
assert.equal(next.opening, bp.opening, "untouched branches are shared");
assert.equal(setAt(bp, "opening.positions.a", "home").opening.positions.a, "home");
assert.deepEqual(setAt({}, "town.sites[0].name", "井"), { town: { sites: [{ name: "井" }] } });
assert.equal(nearestField("residents[0].desires[0].object", ["residents[0].desires[0].object"]), "residents[0].desires[0].object");
assert.equal(nearestField("residents[0].routine[2].siteId", ["residents[0].routine", "residents[0].name"]), "residents[0].routine");
assert.equal(nearestField("meta.title", ["town.name"]), null);
console.log("Blueprint paths passed: parse, read, copy-on-write, nearest field.");
