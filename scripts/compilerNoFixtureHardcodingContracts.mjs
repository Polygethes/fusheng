// Contract test for A7: No hardcoded fixture IDs or names in compiler or catalog
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { SITE_TYPES } from "../src/worlds/catalog/siteTypes.mjs";

// Generic vocabulary the catalog itself owns ("铁匠铺", "药铺", "堂屋") is not a
// fixture leak even when a fixture happens to name its place the same way.
const catalogWords = new Set(Object.values(SITE_TYPES).flatMap((type) => [
  ...String(type.label || "").split(/[/、\s]+/u),
  ...(type.rooms || type.zones || []).map((room) => room.label),
  ...(type.objects || []).map((object) => object.label),
]).filter(Boolean));

const fixtures = [
  "scripts/fixtures/blueprints/tiny_hamlet.json",
  "scripts/fixtures/blueprints/river_town.json",
  "scripts/fixtures/blueprints/forest_village.json",
];

// Collect all fixture-specific character, household, site instance, and opening object tokens
const targetTokens = new Set();
for (const fixPath of fixtures) {
  const bp = JSON.parse(fs.readFileSync(fixPath, "utf8"));
  for (const r of bp.residents || []) {
    if (r.id) targetTokens.add(r.id);
    if (r.name) targetTokens.add(r.name);
  }
  for (const h of bp.households || []) {
    if (h.id) targetTokens.add(h.id);
    if (h.name) targetTokens.add(h.name);
  }
  for (const s of bp.town?.sites || []) {
    // Only check sites where id is unique to the fixture, not a catalog building type
    if (s.id && !["square", "well", "river", "bridge", "wharf", "market", "forest", "field", "street", "herb_shop", "inn", "smithy", "shop", "clinic", "tavern", "teahouse"].includes(s.id)) {
      targetTokens.add(s.id);
    }
    if (s.name) targetTokens.add(s.name);
  }
  for (const o of bp.opening?.objects || []) {
    if (o.name) targetTokens.add(o.name);
  }
}

// Remove tokens that are generic common words or substring collisions
const ignoredTokens = new Set(["东", "西", "南", "北", "药", "水", "井", "晒谷场", "li", "wu", "chen", "sun", "zhao", "qian", "zhou", "wang"]);

const dirsToCheck = [
  "src/worlds/compiler",
  "src/worlds/catalog",
  "src/worlds/blueprint",
];

for (const dir of dirsToCheck) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".mjs"));
  for (const file of files) {
    const filePath = path.join(dir, file);
    const content = fs.readFileSync(filePath, "utf8");

    for (const token of targetTokens) {
      if (ignoredTokens.has(token) || catalogWords.has(token) || token.length < 2) continue;
      // Check if file contains token
      if (content.includes(token)) {
        assert.fail(`File ${filePath} contains hardcoded fixture token: "${token}"`);
      }
    }
  }
}

console.log("No fixture hardcoding contract passed.");
