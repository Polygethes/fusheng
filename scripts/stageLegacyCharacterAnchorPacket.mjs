import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getCharacterPsychologyAnchor } from "../src/server/ecology/characterPsychologyAnchor.mjs";

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    result[token.slice(2)] = argv[index + 1];
    index += 1;
  }
  return result;
}

function stableId(value, label) {
  const result = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(result)) throw new Error(`${label} is required`);
  return result;
}

const args = parseArgs(process.argv.slice(2));
const sceneId = stableId(args.scene, "scene id");
const characterId = stableId(args.character, "character id");
const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const packetPath = path.join(
  projectRoot,
  ".codex",
  "anchors",
  sceneId,
  "characters",
  characterId,
  "anchor-payload.json",
);
const stagedTemplate = JSON.parse(await readFile(packetPath, "utf8"));
const legacyAnchor = getCharacterPsychologyAnchor(characterId, { sceneId });

if (!legacyAnchor || legacyAnchor.status !== "validated") {
  throw new TypeError(`No validated legacy anchor is available for ${characterId}`);
}
if ((legacyAnchor.sceneBindings || []).length) {
  throw new TypeError(`${characterId} already has scene bindings and is not a legacy-only anchor`);
}
if (!(legacyAnchor.validation?.holdouts || []).every((row) => row.accepted === true)) {
  throw new TypeError(`${characterId} legacy holdouts are not fully accepted`);
}

const staged = {
  ...structuredClone(legacyAnchor),
  status: "draft",
  sceneBindings: structuredClone(stagedTemplate.sceneBindings || []),
  memoryPolicy: structuredClone(stagedTemplate.memoryPolicy || {}),
  migration: {
    source: "src/server/ecology/characterPsychologyAnchor.mjs#getCharacterPsychologyAnchor",
    sourceStatus: legacyAnchor.status,
    stagedReason: "Legacy psychology is preserved, while scene fact confirmation and unified runtime cutover remain gated.",
  },
};

await writeFile(packetPath, `${JSON.stringify(staged, null, 2)}\n`, "utf8");
console.log("legacy character anchor staged", {
  sceneId,
  characterId,
  sourceStatus: legacyAnchor.status,
  stagedStatus: staged.status,
  confirmedEvidence: staged.evidence?.confirmed?.length || 0,
  acceptedHoldouts: staged.validation?.holdouts?.filter((row) => row.accepted === true).length || 0,
});
