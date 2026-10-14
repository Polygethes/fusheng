import assert from "node:assert/strict";
import { playNext } from "../src/engine/mockEngine.js";

function character({ id, name, objective, boundary, visibleVerb, defense, state }) {
  return {
    id,
    name,
    publicIdentity: `${name}的公开身份`,
    agentProfile: {
      dramaticObjective: objective,
      hiddenFear: `害怕${objective}失败。`,
      leverageObject: "通行证",
      dialogueMoves: [defense],
      responseBoundary: boundary,
    },
    actionLines: {
      visible: objective,
      desire: objective,
      defense,
      shadow: `让对方先暴露对通行证的打算。`,
    },
    actionVerbs: {
      visible: [visibleVerb],
      hidden: ["确认"],
    },
    defenseLanguage: [defense],
    shadowActions: ["把手续变成对方必须回应的难题"],
    nobleActions: ["让无辜者先离开争执"],
    innerCourt: { wants: "recognition" },
    internalSituation: {
      inadmissibleDesire: objective,
      repeatedSelfLie: defense,
    },
    currentState: {
      desire: 64,
      shame: 42,
      rage: 36,
      selfDeception: 58,
      revengeImpulse: 18,
      protectionImpulse: 40,
      currentSelfLie: defense,
      ...state,
    },
  };
}

const taker = character({
  id: "char_luo",
  name: "罗衡",
  objective: "趁港务登记前把通行证带离验章台。",
  boundary: "自己不能空手回船。",
  visibleVerb: "拿走",
  defense: "这张证本来就该跟我走。",
  state: { desire: 82, rage: 54 },
});

const keeper = character({
  id: "char_ji",
  name: "季岚",
  objective: "把通行证留在验章台，等失踪船员名单核对完。",
  boundary: "通行证不能在未验明之前离开场中。",
  visibleVerb: "验章",
  defense: "先核名单，再谈归属。",
  state: { shame: 68, protectionImpulse: 40 },
});

const lastDialogue = {
  source: "agent-dialogue-relationship",
  relationshipSource: "agent-exchange",
  sharedObject: "通行证",
  locationId: "loc_harbor_desk",
  locationName: "潮港验章台",
  eventOutcome: "上一次换岗时，罗衡把通行证抽到袖口，季岚在名单缺页前拦住了他。",
  finalTurn: "缺的那个名字补上以前，证不离台。",
  followupTurn: "缺的那个名字补上以前，证不离台。",
  dialogueTurnCount: 3,
  relationshipDialogueAct: {
    kind: "control",
    reason: "季岚要求先核对失踪船员名单。",
  },
};

const state = {
  project: { id: "project_boundary_event", activeBranchId: "branch_main" },
  ui: {
    activeBranchId: "branch_main",
    activeCharacterIds: [taker.id, keeper.id],
    selectedLocationId: "loc_harbor_desk",
    timeGrain: "scene",
    focusMode: "location",
    engineMode: "mock",
  },
  characters: [taker, keeper],
  locations: [{
    id: "loc_harbor_desk",
    name: "潮港验章台",
    surfaceUse: "核验通行证和船员名单。",
    visibleUse: "通行证在这里登记、扣留或放行。",
    subtext: "谁拿走通行证，谁就能让一艘船提前离港。",
    powerRule: "名单没有核完，通行证不得离台。",
    likelyEvents: ["验章员把缺页名单摊到灯下"],
  }],
  relationships: [{
    id: "rel_ji_luo",
    fromCharacterId: keeper.id,
    toCharacterId: taker.id,
    resentment: 36,
    fear: 28,
    dependence: 8,
    power: 54,
    protection: 18,
    deception: 34,
    wantsToBeSeen: 32,
    wantsToEscape: 12,
    unspoken: "季岚不肯再让罗衡借换岗拿走通行证。",
    misreading: "季岚把罗衡的每一次伸手都看成提前离港。",
    lastDialogue,
    dialogueHistory: [lastDialogue],
  }, {
    id: "rel_luo_ji",
    fromCharacterId: taker.id,
    toCharacterId: keeper.id,
    resentment: 42,
    fear: 12,
    power: 30,
    deception: 28,
    wantsToBeSeen: 24,
    wantsToEscape: 22,
    unspoken: "罗衡认为季岚故意拖延放行。",
    misreading: "罗衡把核验名单看成季岚扣船的借口。",
  }],
  characterMemories: [{
    id: "memory_ji_previous_attempt",
    branchId: "branch_main",
    characterId: keeper.id,
    targetCharacterId: taker.id,
    type: "accurate",
    stance: "control",
    heat: 88,
    reliability: 94,
    content: "罗衡上次趁换岗把通行证抽到袖口，失踪船员名单还缺一页。",
    publicVersion: "上次放行手续没有完成。",
    privateVersion: "季岚记得罗衡伸手时没有看名单。",
    sourceRelationshipShift: {
      sharedObject: "通行证",
      locationId: "loc_harbor_desk",
      locationName: "潮港验章台",
      eventOutcome: lastDialogue.eventOutcome,
      finalTurn: lastDialogue.finalTurn,
    },
  }],
  characterPlans: [],
  interventions: [],
  evidence: [],
  rumors: [],
  irreversibleTraces: [],
  canonEvents: [],
  draftScenes: [],
  branches: [{ id: "branch_main", name: "主分支", parentId: null }],
};

const draft = playNext(state);
const initiator = draft.agentOutputs?.find((output) => output.characterId === taker.id);
const responder = draft.agentOutputs?.find((output) => output.characterId === keeper.id);
const exchange = draft.sceneInteraction?.agentExchanges?.find((item) => (
  item.sourceOutputId === initiator?.outputId
  && item.responseOutputId === responder?.outputId
));

assert.match(
  initiator?.visibleAction || "",
  /拿走|带离/,
  `initiator must visibly attempt the action that conflicts with the boundary, got:\n${initiator?.visibleAction || ""}`,
);
assert.equal(
  responder?.boundaryDecision?.rule,
  keeper.agentProfile.responseBoundary,
  "responder should turn the character-skill responseBoundary into an explicit decision",
);
assert.equal(
  responder?.boundaryDecision?.triggeredByMemoryId,
  "memory_ji_previous_attempt",
  "the boundary decision should preserve the relationship memory that made the repeated attempt salient",
);
assert.match(
  responder?.visibleAction || "",
  /挡住|拦住|压回/,
  `responder must physically answer the violation instead of emitting a generic action, got:\n${responder?.visibleAction || ""}`,
);
assert.match(
  responder?.visibleAction || "",
  /通行证不能在未验明之前离开场中/,
  `responder dialogue must state its own boundary, got:\n${responder?.visibleAction || ""}`,
);
assert.ok(exchange, "the boundary response should create a traceable agent exchange");
assert.match(
  exchange?.eventOutcome || "",
  /罗衡[^。；]*(没能|不能)[^。；]*(通行证|原计划)/,
  `the exchange must resolve the attempt into a named consequence, got:\n${exchange?.eventOutcome || ""}`,
);
assert.match(
  exchange?.eventOutcome || "",
  /未验明|核对|离开场中/,
  `the consequence must remain causally grounded in the responder's own boundary, got:\n${exchange?.eventOutcome || ""}`,
);
assert.doesNotMatch(
  exchange?.eventOutcome || "",
  /审讯|扣押|宗门|界石/,
  `a generic world template must not overwrite this harbor character's boundary consequence, got:\n${exchange?.eventOutcome || ""}`,
);
assert.ok(
  (exchange?.relationshipDeltas || []).some((shift) => (
    shift.sourceOutputId === initiator.outputId
    && shift.responseOutputId === responder.outputId
  )),
  "the consequence should remain traceable into relationship evolution",
);

console.log("agentBoundaryTurnsMemoryIntoConsequence:test passed", {
  initiation: initiator.visibleAction,
  boundaryDecision: responder.boundaryDecision,
  response: responder.visibleAction,
  consequence: exchange.eventOutcome,
});
