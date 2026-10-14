import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  classifyV27TurnKind,
  privateV27MaintenancePresentation,
} from "../src/engine/v27TurnPresentation.js";

const html = await readFile(new URL("../v27.html", import.meta.url), "utf8");
const client = await readFile(new URL("../src/v27-test.js", import.meta.url), "utf8");
const sessionClient = await readFile(new URL("../src/engine/v27PersistentModelSessionClient.js", import.meta.url), "utf8");
const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");

function tagContaining(markup, token) {
  const tokenIndex = markup.indexOf(token);
  assert.ok(tokenIndex >= 0, `missing markup token: ${token}`);
  const start = markup.lastIndexOf("<", tokenIndex);
  const end = markup.indexOf(">", tokenIndex);
  assert.ok(start >= 0 && end > tokenIndex, `cannot isolate tag containing: ${token}`);
  return markup.slice(start, end + 1);
}

function sourceBetween(source, startToken, endToken) {
  const start = source.indexOf(startToken);
  assert.ok(start >= 0, `missing source token: ${startToken}`);
  const end = source.indexOf(endToken, start + startToken.length);
  assert.ok(end > start, `missing source boundary after ${startToken}: ${endToken}`);
  return source.slice(start, end);
}

assert.match(html, /id="model-session-status"/u);
assert.match(html, /id="reset-model-session"/u);
assert.match(html, /id="model-consent"[^>]*disabled/u,
  "model consent must remain unavailable until the server reports its real request cap");
assert.doesNotMatch(html, /id="model-consent"[^>]*\schecked(?:\s|=|>)/u,
  "authorization must not survive a refresh through checked markup");
assert.doesNotMatch(
  html,
  /<(?:input|select|textarea)\b[^>]*\b(?:id|name)=["']model-turns["'][^>]*>/iu,
  "the fixed five-turn automatic batch must not become a user-editable model-turns input",
);
assert.match(html, /id="model-consent-copy"[\s\S]{0,600}本次(?:所选|选择)/u,
  "consent must be scoped to the manual or automatic action the user selected");
assert.match(html, /刷新[^。]{0,80}授权失效/u,
  "the visible consent copy must say that authorization expires on refresh");

const stageIndex = html.indexOf('data-ink-tavern-game-stage="true"');
const ledgerIndex = html.indexOf('data-v27-action-ledger="true"');
assert.ok(stageIndex >= 0, "the AAC page must expose the tavern as its primary game stage");
assert.ok(ledgerIndex > stageIndex, "the action ledger must remain secondary to the full-screen tavern stage");

const inspector = tagContaining(html, 'id="v27-inspector"');
assert.match(inspector, /<(?:aside|dialog)\b/u, "the inspector must use a landmark or dialog element");
assert.match(inspector, /aria-labelledby=["'][^"']+["']/u, "the inspector needs an accessible title");
const openInspector = tagContaining(html, 'id="open-inspector"');
assert.match(openInspector, /<button\b/u);
assert.match(openInspector, /aria-controls=["']v27-inspector["']/u);
assert.match(openInspector, /aria-expanded=["']false["']/u);
const closeInspector = tagContaining(html, 'data-action="close-v27-inspector"');
assert.match(closeInspector, /<button\b/u);
assert.match(closeInspector, /aria-label=["'][^"']+["']/u);

for (const controlId of [
  "run-auto",
  "stop-auto",
  "history-prev",
  "history-play",
  "history-next",
]) {
  assert.match(tagContaining(html, `id="${controlId}"`), /<button\b/u, `${controlId} must be a button`);
}
const turnScrubber = tagContaining(html, 'id="turn-scrubber"');
assert.match(turnScrubber, /<input\b/u);
assert.match(turnScrubber, /type=["']range["']/u);
assert.match(html, /<label\b[^>]*for=["']turn-scrubber["']/u,
  "the turn scrubber needs an explicit accessible label");

assert.match(client, /createV27PersistentModelSessionClient/u);
assert.match(client, /runAuthorizedTurn/u);
assert.match(client, /modelSessionClient\.reset/u);
assert.doesNotMatch(client, /\/api\/v27\/tavern\/model-run/u, "the test page must use the persistent model-session route");
assert.doesNotMatch(client, /localStorage/u, "the dedicated test cursor should be tab-scoped sessionStorage");
assert.match(client, /window\.sessionStorage/u);
assert.match(client, /maxProviderRequestsPerActorTurn = 3/u);
assert.match(client, /modelConfigurationReady/u);
assert.match(client, /consentInput\.disabled = false/u);
assert.match(client, /const AUTO_MODEL_TURN_COUNT\s*=\s*5\s*;/u,
  "automatic real-model generation must have one fixed five-turn ceiling");
const consentCopyBlock = sourceBetween(client, "function updateConsentCopy", "function updateModelSessionStatus");
assert.match(consentCopyBlock, /AUTO_MODEL_TURN_COUNT\s*\*\s*maxProviderRequestsPerActorTurn/u,
  "the displayed automatic batch budget must equal five times the server-reported per-turn cap");
assert.match(consentCopyBlock, /总计最多/u, "the consent copy must disclose the total batch request budget");
assert.match(consentCopyBlock, /usesApiKey/u);
assert.match(consentCopyBlock, /真实外部请求/u);
assert.match(consentCopyBlock, /本机 Codex/u);
assert.match(consentCopyBlock, /不使用项目 API 密钥/u);
assert.match(client, /consentInput\.checked\s*=\s*false/u,
  "the selected manual or automatic action must consume its authorization");
assert.match(
  client,
  /if\s*\([^)]*!consentInput\.checked[^)]*\)\s*return;\s*consentInput\.checked\s*=\s*false/u,
  "authorization must be consumed at the selected action boundary before model work starts",
);
assert.doesNotMatch(
  client,
  /(?:localStorage|sessionStorage)\.(?:setItem|set)\s*\([^\n]*(?:consent|authorization)/iu,
  "authorization must never be persisted across refresh",
);

const autoLoop = client.match(
  /for\s*\([^)]*AUTO_MODEL_TURN_COUNT[^)]*\)\s*\{(?<beforeCall>[\s\S]{0,2000}?)await\s+modelSessionClient\.runAuthorizedTurn\s*\(/u,
);
assert.ok(autoLoop, "automatic generation must serially await each persistent model turn");
assert.match(
  autoLoop.groups.beforeCall,
  /if\s*\([^)]*(?:stop|running)[^)]*\)\s*(?:break|return)\b/iu,
  "stop must be checked before the next real model call leaves the page",
);
assert.doesNotMatch(autoLoop[0], /Promise\.all/u, "real model turns must never run concurrently");

const loadingBlock = sourceBetween(client, "function setLoading", "function clearLoading");
const errorBlock = sourceBetween(client, "function showError", "async function requestJson");
const destructiveOutputMutation = /outputNode\.(?:innerHTML|textContent|replaceChildren)\s*(?:=|\()/u;
assert.doesNotMatch(loadingBlock, destructiveOutputMutation,
  "entering loading state must preserve the action ledger and selected history turn");
assert.doesNotMatch(errorBlock, destructiveOutputMutation,
  "an error must be reported without replacing the existing action ledger");

assert.match(client, /\.seek\s*\([^)]*turnKey/iu,
  "history controls must seek the playback controller with a stable turn key");
assert.match(client, /agentTurnId/u, "history identity must prefer the immutable agent turn id");
assert.match(client, /data-turn-key/u, "ledger rows must expose their stable playback identity");
assert.match(client, /aria-current/u, "the selected ledger row must expose the active playback cursor");
assert.match(client, /["']step["']/u, "the active history row must use aria-current=step");
assert.match(sessionClient, /gtown:v27:persistent-model-session:v2/u,
  "the Phase 92 page must start a clean browser-owned test cursor instead of mixing older protocol history");
assert.match(client, /observerOnlyPsychology/u);
assert.match(client, /automaticCommunicationImpulse/u);
assert.match(client, /selectedIntention/u);
assert.match(client, /privateV27MaintenancePresentation/u,
  "the standalone observer must use the shared maintenance-turn classification and privacy copy");
assert.match(client, /maintenance\.completionLabel/u);
assert.match(client, /maintenance\.description/u);
assert.match(client, /maintenance\.outcome/u);
assert.doesNotMatch(client, /turn\.turnKind === "day_planning"|submissionMode === "day_planning"/u,
  "the standalone observer may not keep a day-plan-only turn classifier that omits reflection");
const privacyConflict = {
  turnKind: "action",
  submissionMode: "reflection",
  wakeKind: "reflection_due",
  characterAgentCompleted: true,
};
assert.equal(classifyV27TurnKind(privacyConflict), "reflection",
  "maintenance submissionMode must fail closed over a conflicting legacy action kind");
const reflectionPresentation = privateV27MaintenancePresentation(privacyConflict);
assert.equal(reflectionPresentation.completionLabel, "私有反思已完成");
assert.equal(reflectionPresentation.outcome.label, "仅更新人物自己的理解");
assert.match(reflectionPresentation.outcome.detail, /没有新增世界事实/u);
assert.match(client, /\$\{maintenance \? "" : `<div class="v27-actor-wrap">/u,
  "the standalone observer must hide its psychology affordance for private maintenance");
assert.match(server, /TAVERN_V27_STATELESS_MODEL_RUN_RETIRED/u);
assert.match(server, /phase92-epistemic-affective-continuity/u);
assert.match(server, /\/api\/v27\/tavern\/model-session\/\{start\|continue\|reset\}/u);
const localAdapterBlock = server.slice(
  server.indexOf("const tavernV27SessionAdapter ="),
  server.indexOf("const handleTavernV27SessionHttp ="),
);
const modelAdapterBlock = server.slice(
  server.indexOf("const tavernV27ModelSessionAdapter ="),
  server.indexOf("const handleTavernV27ModelSessionHttp ="),
);
assert.match(localAdapterBlock, /enableDayPlanning:\s*true/u,
  "the formal local persistent session must opt into private day planning");
assert.match(modelAdapterBlock, /enableDayPlanning:\s*true/u,
  "the formal model persistent session must opt into private day planning");
assert.doesNotMatch(server, /async function handleTavernV27ModelRun/u,
  "the retired stateless route must not retain a provider-backed bypass");

console.log(JSON.stringify({
  status: "all-passed",
  checks: {
    selectedActionAuthorizationIsEphemeral: true,
    fullScreenStagePrecedesActionLedger: true,
    inspectorHasAccessibleOpenAndCloseControls: true,
    boundedSerialAutomaticModelRun: true,
    loadingAndErrorPreserveHistory: true,
    stablePlaybackCursorSynchronizesLedger: true,
    persistentModelSessionClientWired: true,
    resetControlCallsNoLegacyModelRoute: true,
    refreshStateIsTabScoped: true,
    transientMultiTurnModelRouteRemovedFromPage: true,
    statelessServerModelRouteRetiredWithoutProviderBypass: true,
    phase92ObserverPsychologyReachesHoverSurface: true,
    privateReflectionUsesSharedFailClosedPresentation: true,
    phase92StartsWithCleanBrowserCursor: true,
  },
}, null, 2));
