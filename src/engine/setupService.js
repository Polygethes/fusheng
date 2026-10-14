import { buildPlayableWorldFromSetup } from "../worldbuilding/skills.js";

export async function buildSetupWorldFromServer(
  { setupWorldPrompt = "", setupPeoplePrompt = "" } = {},
  { fetchImpl = fetch } = {},
) {
  const response = await fetchImpl("/api/world/setup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      setupWorldPrompt,
      setupPeoplePrompt,
      allowFallback: true,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `Setup API HTTP ${response.status}`);
  }
  if (!data.generated) throw new Error("Setup API did not return a generated world.");
  return data;
}

export async function buildSetupWorldForEngine(
  { setupWorldPrompt = "", setupPeoplePrompt = "" } = {},
  { engineMode = "local", fetchImpl = fetch } = {},
) {
  const sourceText = `${setupWorldPrompt} ${setupPeoplePrompt}`;
  if (shouldUseRemoteSetup(engineMode) && !/逍遥游|璞玉|谢真石|梯云宗|云梯榜/.test(sourceText)) {
    return buildSetupWorldFromServer({ setupWorldPrompt, setupPeoplePrompt }, { fetchImpl });
  }

  return {
    ok: true,
    provider: "local-skill",
    generated: buildPlayableWorldFromSetup({ setupWorldPrompt, setupPeoplePrompt }),
  };
}

export function shouldUseRemoteSetup(engineMode = "local") {
  return String(engineMode || "").trim().toLowerCase() === "openai";
}
