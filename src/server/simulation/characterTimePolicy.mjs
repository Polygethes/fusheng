const POLICIES = Object.freeze({
  day: { mode: "day", planningHorizonSeconds: 86400, minPlanBlocks: 5, maxPlanBlocks: 8, maxBlockSeconds: 86400, repeatedWaitReviewLimit: 0 },
  scene: { mode: "scene", planningHorizonSeconds: 1800, minPlanBlocks: 1, maxPlanBlocks: 4, maxBlockSeconds: 300, repeatedWaitReviewLimit: 2, defaultRestSeconds: 120, observationSeconds: 5, listeningSeconds: 10, speechCharactersPerSecond: 4 },
});

export function characterTimePolicy(mode = "day") {
  if (!Object.hasOwn(POLICIES, mode)) throw Object.assign(new Error("Unknown simulation pacing mode."), { code: "SIMULATION_PACING_MODE_INVALID" });
  return structuredClone(POLICIES[mode]);
}
