import assert from "node:assert/strict";

import { TAVERN_SCENE_TOPOLOGY } from "../src/server/pipeline/tavernCausalScene.mjs";
import {
  resolveTavernZoneId,
  tavernZoneLabel,
  TAVERN_ZONE_VOCABULARY,
} from "../src/server/ecology/tavernZoneVocabulary.mjs";
import { TAVERN_ECOLOGY_PROFILES } from "../src/server/ecology/tavernEcologyProfile.mjs";
import { buildPlayableWorldFromSetup } from "../src/worldbuilding/skills.js";

const TAVERN_LOCATION_ID = "loc_xyy_tavern";
const topologyZoneIds = new Set(Object.keys(TAVERN_SCENE_TOPOLOGY.zones || {}));

// --- one canonical vocabulary: topology and vocabulary must agree exactly ---
assert.deepEqual(
  [...Object.keys(TAVERN_ZONE_VOCABULARY)].sort(),
  [...topologyZoneIds].sort(),
  "the zone vocabulary covers exactly the topology zones",
);
for (const [zoneId, zone] of Object.entries(TAVERN_SCENE_TOPOLOGY.zones)) {
  assert.equal(
    TAVERN_ZONE_VOCABULARY[zoneId].label,
    zone.label,
    `vocabulary label for ${zoneId} matches the topology label`,
  );
}

// --- the resolver maps ids, labels and aliases onto canonical ids ---
assert.equal(resolveTavernZoneId("courtyard"), "courtyard", "a canonical id resolves to itself");
assert.equal(resolveTavernZoneId("后院"), "courtyard", "a Chinese zone label resolves to its canonical id");
assert.equal(resolveTavernZoneId("灶边"), "stove");
assert.equal(resolveTavernZoneId("堂前"), "hall");
assert.equal(resolveTavernZoneId("柜台"), "counter");
assert.equal(resolveTavernZoneId("客房"), "guest_room", "a zone alias resolves to its canonical id");
assert.equal(resolveTavernZoneId("院子"), "courtyard");
assert.equal(resolveTavernZoneId(" 后院 "), "courtyard", "whitespace does not defeat resolution");
assert.equal(resolveTavernZoneId("名录案"), "名录案", "zones of other locations pass through unchanged");
assert.equal(resolveTavernZoneId(""), "", "empty input stays empty");
assert.equal(tavernZoneLabel("courtyard"), "后院", "canonical ids render with their human label");
assert.equal(tavernZoneLabel("名录案"), "名录案", "unknown zones render as themselves");

// --- ecology profiles carry canonical zone ids, never display labels ---
for (const [characterId, profile] of Object.entries(TAVERN_ECOLOGY_PROFILES)) {
  const homeZoneId = profile.initialConditions?.zoneId;
  if (homeZoneId && profile.initialConditions?.locationId === TAVERN_LOCATION_ID) {
    assert.ok(
      topologyZoneIds.has(homeZoneId),
      `${characterId} homeZoneId ${homeZoneId} must be a canonical topology zone id`,
    );
  }
  for (const item of profile.duties || []) {
    const scope = item.scope || {};
    if (scope.locationId !== TAVERN_LOCATION_ID) continue;
    for (const zoneId of scope.zones || []) {
      assert.ok(
        topologyZoneIds.has(zoneId),
        `${characterId} duty ${item.id} zone ${zoneId} must be a canonical topology zone id`,
      );
    }
    assert.deepEqual(
      scope.zoneLabels,
      (scope.zones || []).map((zoneId) => tavernZoneLabel(zoneId)),
      `${characterId} duty ${item.id} keeps human-readable zone labels next to the ids`,
    );
  }
}

// --- institution data uses the same canonical ids ---
const seededState = buildPlayableWorldFromSetup({
  setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
  setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
});
const institution = seededState.tavernState?.institution || {};
for (const zoneId of institution.serviceZones || []) {
  assert.ok(
    topologyZoneIds.has(zoneId),
    `institution serviceZone ${zoneId} must be a canonical topology zone id`,
  );
}
for (const position of institution.guestPositions || []) {
  assert.ok(
    topologyZoneIds.has(position.zoneId),
    `guest position ${position.id} zone must be canonical`,
  );
}

console.log(JSON.stringify({
  status: "all-passed",
  gate: "tavern-zone-vocabulary",
  checks: {
    vocabularyMatchesTopology: true,
    labelsAndAliasesResolveToCanonicalIds: true,
    otherLocationZonesPassThrough: true,
    ecologyProfilesUseCanonicalZoneIds: true,
    dutyScopesKeepHumanReadableLabels: true,
    institutionDataUsesCanonicalZoneIds: true,
  },
}, null, 2));
