import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCENE_ID = "scene_xyy_wangti_tavern";
const CHARACTER_IDS = ["char_xyy_xiezenshi", "char_xyy_zhoumin", "char_xyy_luozhao"];
const CHARACTER_NAMES = {
  char_xyy_xiezenshi: "谢真石",
  char_xyy_zhoumin: "周珉",
  char_xyy_luozhao: "洛照",
};
const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const requiredSurfaces = [
  "sceneFacts",
  "psychology",
  "voice",
  "relationships",
  "memory",
  "presence",
  "candidateCompilation",
  "validation",
];
const requiredBehaviorCategories = [
  "agent_non_top_choice",
  "unresolved_desire_survives_delay",
  "rumor_differs_from_direct_knowledge",
  "private_zone_blocks_propagation",
  "relationship_changes_expression_not_desire",
  "voice_changes_by_function",
  "body_state_changes_behavior",
  "non_luozhao_portability",
];

const mapped = [];
for (const characterId of CHARACTER_IDS) {
  const characterRoot = path.join(projectRoot, ".codex", "anchors", SCENE_ID, "characters", characterId);
  const runtimeMap = JSON.parse(await readFile(path.join(characterRoot, "runtime-map.json"), "utf8"));
  const manifest = JSON.parse(await readFile(path.join(characterRoot, "manifest.json"), "utf8"));

  assert.ok(["runtime-mapped", "behavior-accepted"].includes(runtimeMap.status));
  assert.equal(manifest.gates.runtimeMapping, "mapped");
  assert.deepEqual(Object.keys(runtimeMap.authoritySurfaces).sort(), [...requiredSurfaces].sort());

  const authorities = [];
  for (const surface of requiredSurfaces) {
    const authority = runtimeMap.authoritySurfaces[surface];
    assert.ok(authority.path && authority.symbol, `${characterId}.${surface} must name an exact live authority`);
    const absolutePath = path.join(projectRoot, authority.path);
    await access(absolutePath);
    const module = await import(pathToFileURL(absolutePath).href);
    assert.ok(Object.hasOwn(module, authority.symbol), `${surface} export is missing: ${authority.path}#${authority.symbol}`);
    assert.ok(["function", "object"].includes(typeof module[authority.symbol]), `${surface} authority must be callable or structured data`);
    for (const derivedPath of authority.derivedProjectionPaths || []) await access(path.join(projectRoot, derivedPath));
    authorities.push(`${authority.path}#${authority.symbol}`);
  }
  assert.equal(new Set(authorities).size, authorities.length, "each runtime surface needs a distinct path#symbol authority");

  const psychologyModule = await import(pathToFileURL(path.join(projectRoot, runtimeMap.authoritySurfaces.psychology.path)).href);
  const runtime = psychologyModule[runtimeMap.authoritySurfaces.psychology.symbol](SCENE_ID, characterId);
  assert.equal(runtime.characterId, characterId);
  assert.equal(runtime.status, "runtime-mapped");
  assert.equal(runtime.source.authority, "character-foundation");
  assert.match(runtime.source.path, /character-foundation\.json$/u);

  const voiceModule = await import(pathToFileURL(path.join(projectRoot, runtimeMap.authoritySurfaces.voice.path)).href);
  const voice = voiceModule[runtimeMap.authoritySurfaces.voice.symbol]({
    id: characterId,
    name: CHARACTER_NAMES[characterId],
    psychologyAnchor: runtime.psychologyAnchor,
  });
  assert.equal(voice.authoritySource, "validated-character-anchor");

  const memoryModule = await import(pathToFileURL(path.join(projectRoot, runtimeMap.authoritySurfaces.memory.path)).href);
  const memoryState = memoryModule[runtimeMap.authoritySurfaces.memory.symbol](
    { ownerCharacterId: characterId, episodes: [], beliefs: [], commitments: [], impressions: [] },
    characterId,
    { sceneId: SCENE_ID },
  );
  assert.equal(memoryState.ownerCharacterId, characterId);
  assert.ok(memoryState.episodes.length > 0);

  assert.ok(Array.isArray(runtimeMap.remainingGaps));
  if (runtimeMap.status === "behavior-accepted") {
    const passedCategories = new Set((runtimeMap.acceptanceTests || [])
      .filter((row) => row.passed === true)
      .map((row) => row.category));
    assert.ok(requiredBehaviorCategories.every((category) => passedCategories.has(category)));
  } else {
    assert.equal(manifest.gates.behaviorAcceptance, "pending");
  }
  mapped.push({ characterId, status: runtimeMap.status, authorities, remainingGaps: runtimeMap.remainingGaps });
}

console.log("validatedCharacterRuntimeMap:test passed", {
  sceneId: SCENE_ID,
  mapped: mapped.map((row) => ({
    characterId: row.characterId,
    status: row.status,
    remainingGaps: row.remainingGaps,
  })),
});
