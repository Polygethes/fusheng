import assert from "node:assert/strict";
import { buildSetupWorldForEngine } from "../src/engine/setupService.js";

const prompts = {
  setupWorldPrompt: "仙侠世界当中，正邪两派各种物种所汇集的一个中立城市。",
  setupPeoplePrompt: "正道修士、邪派使者、妖族、鬼修、龙裔、器灵和城中执法者。",
};

for (const engineMode of ["local", "mock", "auto", ""]) {
  let fetchCalls = 0;
  const response = await buildSetupWorldForEngine(prompts, {
    engineMode,
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error(`setup should not call server in ${engineMode || "empty"} mode`);
    },
  });

  assert.equal(fetchCalls, 0, `${engineMode || "empty"} setup should stay local`);
  assert.equal(response.ok, true, "local setup should return an ok response");
  assert.equal(response.provider, "local-skill", "local setup should identify the local skill provider");
  assert.equal(response.generated?.worldSetup?.generatedBySkills, true, "local setup should use world and character skills");
  assert.match(response.generated?.town?.name || "", /停剑城/, "xianxia local setup should build the neutral city");
}

console.log("setupLocalModeDoesNotCallServer:test passed");
