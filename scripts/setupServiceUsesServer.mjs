import assert from "node:assert/strict";
import { buildSetupWorldFromServer } from "../src/engine/setupService.js";

const requests = [];
const generated = { project: { title: "蓝肺城" }, worldSetup: { generatedByModel: true } };

const result = await buildSetupWorldFromServer({
  setupWorldPrompt: "海底避难城",
  setupPeoplePrompt: "潜水员和监察官",
}, {
  fetchImpl: async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      status: 200,
      async json() {
        return { ok: true, generated, status: { provider: "openai-pipeline" } };
      },
    };
  },
});

assert.equal(result.generated, generated);
assert.equal(result.status.provider, "openai-pipeline");
assert.equal(requests.length, 1);
assert.equal(requests[0].url, "/api/world/setup");
assert.equal(requests[0].options.method, "POST");
assert.match(requests[0].options.headers["content-type"], /application\/json/);
assert.deepEqual(JSON.parse(requests[0].options.body), {
  setupWorldPrompt: "海底避难城",
  setupPeoplePrompt: "潜水员和监察官",
  allowFallback: true,
});

await assert.rejects(
  () => buildSetupWorldFromServer({}, {
    fetchImpl: async () => ({
      ok: false,
      status: 500,
      async json() {
        return { ok: false, error: "bad setup" };
      },
    }),
  }),
  /bad setup/,
);

console.log("setupServiceUsesServer:test passed", {
  url: requests[0].url,
  title: result.generated.project.title,
});
