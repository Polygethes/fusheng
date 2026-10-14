import assert from "node:assert/strict";

import { renderInkTavernStageMarkup } from "../src/ui/inkTavernStage.js";

function actorTag(markup, characterId) {
  const token = `data-character="${characterId}"`;
  const tokenIndex = markup.indexOf(token);
  assert.ok(tokenIndex >= 0, `missing stage actor ${characterId}`);
  const start = markup.lastIndexOf("<", tokenIndex);
  const end = markup.indexOf(">", tokenIndex);
  assert.ok(start >= 0 && end > tokenIndex, `cannot isolate stage actor ${characterId}`);
  return markup.slice(start, end + 1);
}

const observation = {
  nowSeconds: 14 * 3600 + 10 * 60,
  worldVersion: 12,
  characters: [
    {
      characterId: "char_phase111_xie",
      name: "谢真石",
      present: true,
      placeId: "loc_xyy_tavern",
      zoneId: "hall",
      positionId: "",
    },
    {
      characterId: "char_phase111_luo",
      name: "洛照",
      present: true,
      placeId: "loc_xyy_tavern",
      zoneId: "hall",
      positionId: "",
    },
  ],
  turns: [{
    agentTurnId: "agent-turn:phase111:luozhao:pass",
    characterId: "char_phase111_luo",
    publicRealization: {
      actionType: "pass",
      speech: "",
      visibleAction: "洛照停留。",
    },
    outcome: {
      status: "quiet",
      worldFacts: [],
    },
  }],
};

const markup = renderInkTavernStageMarkup(observation, {
  activityRunning: true,
});

for (const characterId of ["char_phase111_xie", "char_phase111_luo"]) {
  const tag = actorTag(markup, characterId);
  assert.ok(tag, `expected actor markup for ${characterId}`);
  assert.match(
    tag,
    /data-local-motion="patrol"/,
    `expected every free-standing NPC to retain ambient patrol after activity starts: ${tag}`,
  );
  assert.match(tag, /class="[^"]*is-patrolling/, `expected patrol presentation class: ${tag}`);
  assert.match(tag, /data-idle-route="[^"]+"/, `expected a legal idle route: ${tag}`);
}

for (const latestAction of [
  { actionType: "none", speech: "", visibleAction: "" },
  { actionType: "observe", speech: "", visibleAction: "洛照望了望门外。" },
  { actionType: "speak", speech: "今日风大。", visibleAction: "洛照朝谢真石开口。" },
  { actionType: "interact", speech: "", visibleAction: "洛照理了理手边的包袱。" },
]) {
  const actionMarkup = renderInkTavernStageMarkup({
    ...observation,
    turns: [{
      ...observation.turns[0],
      agentTurnId: `agent-turn:phase111:luozhao:${latestAction.actionType}`,
      publicRealization: latestAction,
    }],
  }, { activityRunning: true });
  const currentActor = actorTag(actionMarkup, "char_phase111_luo");
  assert.match(
    currentActor,
    /data-local-motion="patrol"/,
    `a one-shot ${latestAction.actionType} presentation must not become a permanent movement lock: ${currentActor}`,
  );
  assert.match(currentActor, /data-idle-route="[^"]+;[^"]+"/, `expected a legal route after ${latestAction.actionType}`);
}

console.log("phase111 all-NPC ambient activity contracts passed");
