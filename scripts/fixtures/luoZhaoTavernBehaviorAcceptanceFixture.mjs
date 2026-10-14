import assert from "node:assert/strict";

import { buildPlayableWorldFromSetup } from "../../src/worldbuilding/skills.js";
import {
  prepareTavernCausalSlot,
  TAVERN_CAUSAL_DAY_SLOTS,
} from "../../src/server/pipeline/tavernCausalEconomy.mjs";

export const LUO_ZHAO_BEHAVIOR_ACCEPTANCE_IDS = Object.freeze({
  luo: "char_xyy_luozhao",
  xieZhenshi: "char_xyy_xiezenshi",
});

export function buildLuoZhaoTavernBehaviorAcceptanceFixture() {
  const ids = LUO_ZHAO_BEHAVIOR_ACCEPTANCE_IDS;
  const initialState = buildPlayableWorldFromSetup({
    setupWorldPrompt: "来源于《逍遥游》，从第一集《璞玉》开场前开始。",
    setupPeoplePrompt: "谢真石、周珉、洛照、严执中、谢恒、谢母、陈砚。",
  });
  const dawn = TAVERN_CAUSAL_DAY_SLOTS.find((slot) => slot.id === "dawn");
  const prepared = prepareTavernCausalSlot(initialState, { day: 1, slot: dawn });
  const visit = prepared.state.tavernState.activeVisits.find((item) => item.visitorId === ids.luo);
  assert.ok(visit, "正式运行种子必须由洛照本人拥有的来访意图造成到店");
  assert.equal(visit.kind, "self_directed");
  assert.equal(visit.purposeDisclosureRequired, false);
  assert.equal(visit.hostReceptionRequired, false);
  assert.equal(visit.requestedService, "none");
  // This is a two-Agent acceptance cell.  Other macro-scheduled visits are not
  // merely marked invisible: they are removed from the isolated scene so no
  // absent person's transaction can become either Agent's material fact.
  prepared.state.tavernState.activeVisits = [visit];

  for (const character of prepared.state.characters) {
    character.lifeState.present = [ids.luo, ids.xieZhenshi].includes(character.id);
  }
  const xie = prepared.state.characters.find((character) => character.id === ids.xieZhenshi);
  const luo = prepared.state.characters.find((character) => character.id === ids.luo);
  assert.ok(xie && luo);
  xie.lifeState.currentActivity = {
    type: "duty",
    description: "把堂前一张空桌上的旧碗收拢到托盘里",
  };
  luo.lifeState.currentActivity = {
    type: "arrival",
    description: "刚跨入门槛，自行观察酒馆内的人与消息来源",
  };

  const sword = prepared.state.tavernState.objectLedger.objects.luozhao_sword;
  const visitLetter = prepared.state.tavernState.objectLedger.objects.luozhao_yuheng_visit_letter;
  assert.equal(sword?.holderActorId, ids.luo);
  assert.equal(sword?.attachment?.active, true);
  assert.equal(sword?.zoneId, "threshold");
  assert.equal(sword?.presentation?.publiclyVisible, true);
  assert.equal(visitLetter?.holderActorId, ids.luo);
  assert.equal(visitLetter?.zoneId, "threshold");
  assert.equal(visitLetter?.custody?.storageMode, "packed");
  assert.equal(visitLetter?.custody?.inHand, false);
  assert.equal(visitLetter?.presentation?.publiclyVisible, false);
  assert.equal(visitLetter?.state?.tavernCustody, false);

  return {
    state: prepared.state,
    slotContext: prepared.slotContext,
    characterIds: [ids.xieZhenshi, ids.luo],
    positions: {
      [ids.xieZhenshi]: "hall",
      [ids.luo]: "threshold",
    },
    // Arrival is already an objective visit + position fact.  Do not inject a
    // second synthetic "someone arrived" stimulus: Luo's own committed entry
    // must create the first perceptible event that can activate Xie Zhenshi.
    seedImpacts: [],
    reviewScenario: {
      storyTime: "第一集《璞玉》开场前，清晨，同一连续时刻",
      location: "望梯酒馆门槛与堂前",
      objectiveFacts: [
        "洛照由本人来访意图抵达酒馆，刚跨入门槛；没有预制住店、接引、点单、付款或必须披露来意的事务。",
        "洛照佩着剑，并把面向梯云宗的拜帖收在随身行囊中；两件物品都没有离身或交给酒馆。",
        "谢真石正在堂前收拢空桌旧碗，掌柜和东家暂时不在当前场景。",
        "洛照只看见一名年岁相近、正在堂前收拢旧碗的年轻人，不知道对方就是谢真石；现场没有剑招、姓名揭示或他人评价。",
        "堂前有多个条件不同的空客位，也有明码可点的茶饭；世界只提供位置、价格、库存、视听和占桌惯例，不替洛照选择是否消费、坐在哪里或何时问话。",
        "两人彼此可见、可听；没有人为任何一方写好第一句话、下一步或关系结果。",
      ],
      authoringAnswerIncluded: false,
      authoringDialogueIncluded: false,
      expectedActionIncluded: false,
      holdoutOutcomeIncluded: false,
      outboundCharacterIds: [ids.xieZhenshi, ids.luo],
      targetCommittedAgentTurns: 6,
      boundedRecoveryAgentTurns: 2,
      possibleRemoteRequests: "目标形成 6 个已提交人物行动，让入店、普通消费或停留、同场反应与信息试探有足够连续时间自然展开；普通调度最多 8 个回合，若最后一步打开真实话轮，再容许 2 个同场恢复回合。每次激活的首份实现若被拒绝，先允许 1 次实现修正；修正仍失败时，再允许同一人物在同一时刻重新比较候选 1 次，因此远程请求硬上限为 30。",
    },
  };
}
