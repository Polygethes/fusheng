/**
 * Where a Character's model actually comes from.
 *
 * The project ships no default model. A run either uses credentials the
 * operator supplied, or it borrows the agent shell the project is currently
 * running inside, or it has no model at all and stays on the deterministic
 * fixture path. Nothing is silently assumed, because a silent default meant a
 * run could quietly bill an account nobody chose and record a provenance
 * nobody intended.
 */

export const MODEL_API_TRANSPORT = "model-api";
export const SUBAGENT_TRANSPORT = "subagent";
export const CODEX_TRANSPORT = "codex-cli";
export const NO_MODEL_TRANSPORT = "none";

export const CHARACTER_MODEL_TRANSPORTS = Object.freeze([
  MODEL_API_TRANSPORT,
  SUBAGENT_TRANSPORT,
  CODEX_TRANSPORT,
  NO_MODEL_TRANSPORT,
]);

/**
 * Agent shells this project can borrow a model from. Detection is by process
 * environment only: a shell is "present" when it exported its own marker, so a
 * plain terminal never masquerades as one.
 */
const AGENT_SHELLS = Object.freeze([
  Object.freeze({
    id: "claude-code",
    label: "Claude Code",
    markers: Object.freeze(["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_SESSION_ID"]),
  }),
  Object.freeze({
    id: "codex-cli",
    label: "Codex CLI",
    markers: Object.freeze(["CODEX_SANDBOX", "CODEX_HOME", "CODEX_THREAD_ID", "CODEX_SESSION_ID"]),
  }),
  Object.freeze({
    id: "cursor",
    label: "Cursor",
    markers: Object.freeze(["CURSOR_AGENT", "CURSOR_TRACE_ID"]),
  }),
  Object.freeze({
    id: "copilot",
    label: "GitHub Copilot",
    markers: Object.freeze(["GITHUB_COPILOT_AGENT", "COPILOT_AGENT_ID"]),
  }),
]);

function clean(value = "") {
  return String(value ?? "").trim();
}

function fail(code, message, evidence = {}) {
  const error = new TypeError(message);
  error.code = code;
  error.evidence = evidence;
  return error;
}

/**
 * Which agent shell, if any, this process is running inside.
 * `GTOWN_AGENT_SHELL` is the explicit escape hatch for shells not listed here;
 * `GTOWN_AGENT_SHELL=none` suppresses detection entirely.
 */
export function detectAgentShell(environment = process.env) {
  const declared = clean(environment.GTOWN_AGENT_SHELL);
  if (declared.toLowerCase() === "none") {
    return { present: false, id: "", label: "", markers: [], source: "declared-none" };
  }
  if (declared) {
    const known = AGENT_SHELLS.find((shell) => shell.id === declared.toLowerCase());
    return {
      present: true,
      id: known?.id || declared,
      label: known?.label || declared,
      markers: ["GTOWN_AGENT_SHELL"],
      source: "declared",
    };
  }
  for (const shell of AGENT_SHELLS) {
    const markers = shell.markers.filter((key) => clean(environment[key]));
    if (markers.length) {
      return { present: true, id: shell.id, label: shell.label, markers, source: "detected" };
    }
  }
  return { present: false, id: "", label: "", markers: [], source: "absent" };
}

/**
 * Credentials and model the operator supplied. Both a key and an explicit model
 * are required: a key alone used to fall through to a hard-coded model name,
 * which is exactly the silent default this module exists to remove.
 */
// Private transport configuration. Never put the credentials in status or checkpoints.
export function resolveOperatorApiCredentials(environment = process.env) {
  const apiKey = clean(environment.CHARACTER_TOWN_API_KEY)
    || clean(environment.DEEPSEEK_API_KEY)
    || clean(environment.OPENAI_API_KEY);
  const model = clean(environment.CHARACTER_TOWN_MODEL)
    || clean(environment.OPENAI_MODEL)
    || clean(environment.DEEPSEEK_MODEL);
  const baseUrl = clean(environment.CHARACTER_TOWN_BASE_URL)
    || clean(environment.OPENAI_BASE_URL)
    || clean(environment.DEEPSEEK_BASE_URL);
  return { apiKey, model, baseUrl };
}

export function resolveOperatorApi(environment = process.env) {
  const { apiKey, model, baseUrl } = resolveOperatorApiCredentials(environment);
  return {
    hasKey: Boolean(apiKey),
    hasModel: Boolean(model),
    configured: Boolean(apiKey && model),
    model,
    baseUrl,
  };
}

function concurrencyFor(transport, environment) {
  // Only the stateless HTTP transport isolates characters by running them as
  // independent concurrent requests. The shell transports are bound to one
  // process or one orchestrator turn, so they stay strictly serial.
  if (transport !== MODEL_API_TRANSPORT) {
    return { isolation: "serial-single-session", maxConcurrentCharacters: 1 };
  }
  const requested = Number.parseInt(clean(environment.GTOWN_MODEL_MAX_CONCURRENT_CHARACTERS) || "4", 10);
  if (!Number.isInteger(requested) || requested < 1 || requested > 32) {
    throw fail(
      "GTOWN_MODEL_CONCURRENCY_INVALID",
      "GTOWN_MODEL_MAX_CONCURRENT_CHARACTERS must be an integer from 1 through 32.",
    );
  }
  return { isolation: "per-character-stateless-request", maxConcurrentCharacters: requested };
}

/**
 * Resolve where this run's Character model comes from.
 *
 * Order: an explicit operator override, then operator-supplied API
 * credentials, then the surrounding agent shell, then no model at all.
 */
export function resolveCharacterModelEnvironment(environment = process.env) {
  const shell = detectAgentShell(environment);
  const api = resolveOperatorApi(environment);
  const override = clean(environment.GTOWN_MODEL_TRANSPORT).toLowerCase();

  if (override && !CHARACTER_MODEL_TRANSPORTS.includes(override)) {
    throw fail(
      "GTOWN_MODEL_TRANSPORT_UNSUPPORTED",
      `GTOWN_MODEL_TRANSPORT must be one of ${CHARACTER_MODEL_TRANSPORTS.join(", ")}.`,
      { requested: override },
    );
  }

  const transport = override
    || (api.configured ? MODEL_API_TRANSPORT : "")
    || (shell.present ? SUBAGENT_TRANSPORT : "")
    || NO_MODEL_TRANSPORT;

  if (transport === MODEL_API_TRANSPORT && !api.configured) {
    throw fail(
      "GTOWN_MODEL_API_INCOMPLETE",
      api.hasKey
        ? "An API transport needs an explicit model: set CHARACTER_TOWN_MODEL (or OPENAI_MODEL / DEEPSEEK_MODEL). This project ships no default model."
        : "An API transport needs a key: set CHARACTER_TOWN_API_KEY (or OPENAI_API_KEY / DEEPSEEK_API_KEY).",
      { hasKey: api.hasKey, hasModel: api.hasModel },
    );
  }

  const base = {
    shell,
    reason: override
      ? "operator-override"
      : transport === MODEL_API_TRANSPORT
        ? "operator-supplied-api"
        : transport === SUBAGENT_TRANSPORT
          ? `borrowed-from-${shell.id || "agent-shell"}`
          : "no-model-configured",
    concurrency: concurrencyFor(transport, environment),
  };

  if (transport === MODEL_API_TRANSPORT) {
    return {
      ...base,
      transport,
      model: api.model,
      reasoningEffort: "",
      authentication: "operator-api-key",
      usesApiKey: true,
      displayLabel: `操作者提供的 API · ${api.model}`,
    };
  }
  if (transport === SUBAGENT_TRANSPORT) {
    return {
      ...base,
      transport,
      model: clean(environment.GTOWN_SUBAGENT_MODEL),
      reasoningEffort: clean(environment.GTOWN_SUBAGENT_REASONING_EFFORT),
      authentication: "agent-shell-session",
      usesApiKey: false,
      displayLabel: shell.present ? `当前环境 · ${shell.label}` : "当前环境 · Agent 外壳",
    };
  }
  if (transport === CODEX_TRANSPORT) {
    return {
      ...base,
      transport,
      model: clean(environment.GTOWN_V27_CODEX_MODEL),
      reasoningEffort: clean(environment.GTOWN_V27_CODEX_REASONING_EFFORT),
      authentication: "saved-chatgpt-login",
      usesApiKey: false,
      displayLabel: "本机 Codex · ChatGPT 登录",
    };
  }
  return {
    ...base,
    transport: NO_MODEL_TRANSPORT,
    model: "",
    reasoningEffort: "",
    authentication: "none",
    usesApiKey: false,
    displayLabel: "未配置模型 · 仅确定性推演",
  };
}

/**
 * Run one task per character, at most `maxConcurrentCharacters` at a time.
 * Characters are independent of each other; a character's own stages remain
 * serial inside its task. Rejections propagate once every in-flight task has
 * settled, so one character's failure never leaves another mid-request.
 */
export async function mapCharactersWithConcurrency(characterIds = [], runOne, {
  maxConcurrentCharacters = 1,
} = {}) {
  if (typeof runOne !== "function") {
    throw fail("GTOWN_MODEL_CONCURRENCY_TASK_REQUIRED", "A per-character task function is required.");
  }
  const limit = Math.max(1, Number(maxConcurrentCharacters) || 1);
  const ids = [...characterIds];
  const results = new Array(ids.length);
  const failures = [];
  let cursor = 0;

  async function worker() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= ids.length) return;
      try {
        results[index] = await runOne(ids[index], index);
      } catch (error) {
        failures.push({ characterId: ids[index], error });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, ids.length) }, worker));
  if (failures.length) {
    const error = new Error(
      `${failures.length} character model task(s) failed: ${failures.map((row) => row.characterId).join(", ")}`,
    );
    error.code = "GTOWN_MODEL_CHARACTER_TASKS_FAILED";
    error.failures = failures;
    throw error;
  }
  return results;
}
