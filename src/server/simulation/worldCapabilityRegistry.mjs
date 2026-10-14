import { physicalAttemptForSettlement } from "./physicalExpression.mjs";

export const WORLD_CAPABILITY_REGISTRY_VERSION = "world-capability-registry-v1";

function clone(value) {
  if (value === undefined) return undefined;
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function clean(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function fail(code, message, evidence = {}) {
  const error = new Error(message);
  error.code = code;
  error.evidence = clone(evidence);
  return error;
}

/**
 * Capability composition sits below scenes and above concrete resolvers.
 * It exposes possibilities and settles a character-owned attempt; it never
 * ranks, selects, or rewrites an action for the Character Agent.
 */
export function createWorldCapabilityRegistry() {
  const capabilities = new Map();
  const registry = {
    schemaVersion: WORLD_CAPABILITY_REGISTRY_VERSION,
    register(capabilityId, { listAffordances, settleAttempt } = {}) {
      const id = clean(capabilityId);
      if (!id || typeof listAffordances !== "function" || typeof settleAttempt !== "function") {
        throw fail("WORLD_CAPABILITY_REGISTRATION_INVALID", "A capability needs an id, projector, and resolver.", { capabilityId: id });
      }
      if (capabilities.has(id)) throw fail("WORLD_CAPABILITY_DUPLICATE", "Capability is already registered.", { capabilityId: id });
      capabilities.set(id, { listAffordances, settleAttempt });
      return registry;
    },
    list() {
      return [...capabilities.keys()].sort();
    },
    project(context = {}) {
      const affordances = [];
      const ownedProcesses = [];
      for (const [capability, handlers] of capabilities) {
        const surface = handlers.listAffordances(clone(context)) || {};
        for (const row of surface.affordances || []) affordances.push({ capability, ...clone(row) });
        for (const row of surface.ownedProcesses || []) ownedProcesses.push({ capability, ...clone(row) });
      }
      return { affordances, ownedProcesses };
    },
    async settle(context = {}) {
      const capability = clean(context.attempt?.payload?.capabilityBinding?.capability);
      const handlers = capabilities.get(capability);
      if (!handlers) {
        throw fail("WORLD_CAPABILITY_UNKNOWN", "The submitted affordance capability is not registered.", { capability });
      }
      // The enclosing action registry owns executable resolver functions and
      // is intentionally not serializable. Capabilities receive only the
      // objective snapshot and submitted attempt they are allowed to settle.
      const resolution = await handlers.settleAttempt({
        state: clone(context.state || {}),
        attempt: physicalAttemptForSettlement(clone(context.attempt || {})),
      });
      if (!resolution || resolution.authority !== "world-action-registry") {
        throw fail("WORLD_CAPABILITY_RESOLUTION_INVALID", "Capability resolver returned an invalid world resolution.", { capability });
      }
      if (Object.hasOwn(resolution, "selectedAction") || Object.hasOwn(resolution, "selectedResponse")) {
        throw fail("WORLD_CAPABILITY_SELECTION_FORBIDDEN", "A world capability cannot choose a character action.", { capability });
      }
      return clone(resolution);
    },
  };
  return registry;
}
