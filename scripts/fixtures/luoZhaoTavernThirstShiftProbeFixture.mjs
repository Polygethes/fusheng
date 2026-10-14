import { buildLuoZhaoTavernEntryChoiceProbeInput } from "./luoZhaoTavernEntryChoiceProbeFixture.mjs";

export const LUO_ZHAO_TAVERN_THIRST_SHIFT_PROBE_ID =
  "probe:luozhao:tavern-entry-thirst-shift";

export function buildLuoZhaoTavernThirstShiftProbeInput() {
  const input = structuredClone(buildLuoZhaoTavernEntryChoiceProbeInput());
  input.probeId = LUO_ZHAO_TAVERN_THIRST_SHIFT_PROBE_ID;

  // This Holdout changes one current-state variable only. It does not describe
  // a permanent appetite, a prior event, or the action Luo Zhao should choose.
  input.dynamicState.thirst = 0.82;
  input.world.serviceChoice.bodyNeeds.thirst = 0.82;
  input.world.serviceChoice.stateScope =
    "本次反事实未见情境只声明洛照当前明显口渴；不生成此前饮水或赶路事件，也不编译为永久身体状态、消费习惯或行动答案。";

  return input;
}
