// When the gateway is down — every attempt of a request timed out, could not
// connect, or was turned away as busy or unavailable (429/502/503/504) — a run
// waits and sends the request again instead of stopping. The gateway has gone
// down for several minutes at a time and then recovered.
export const GATEWAY_WAITS_SECONDS = [30, 60, 120, 120];

const DOWN = new Set(["timeout", "network_error", "http_429", "http_502", "http_503", "http_504"]);

/** No attempt of the request got through: silence, a broken connection, or the gateway saying it is busy or unavailable. */
export function isGatewayUnavailable(error) {
  if (error?.code === "MODEL_REQUEST_TIMEOUT") return true;
  const attempts = error?.attempts;
  return Array.isArray(attempts) && attempts.length > 0 && attempts.every((row) => DOWN.has(row.outcome));
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Calls send(round) — round 0 first, then once after each wait — until it
 * answers. A gateway that is down is waited out; any other error is thrown at
 * once. The wait is taken one second at a time so an operator stop ends it quickly.
 */
export async function withGatewayWaits(send, { waits = GATEWAY_WAITS_SECONDS, sleep = defaultSleep, now = () => Date.now(), shouldStop = () => false, onWait = () => {} } = {}) {
  let waitedSeconds = 0;
  for (let round = 0; ; round++) {
    try {
      return await send(round);
    } catch (error) {
      if (!isGatewayUnavailable(error)) throw error;
      if (round >= waits.length) {
        error.message = `${error.message}之后又等了约 ${Math.max(1, Math.round(waitedSeconds / 60))} 分钟，网关仍然不通。`;
        throw error;
      }
      const waitSeconds = waits[round];
      await onWait({ round: round + 1, rounds: waits.length, waitSeconds, until: new Date(now() + waitSeconds * 1000).toISOString() });
      for (let second = 0; second < waitSeconds; second++) {
        if (shouldStop()) throw Object.assign(new Error("等网关回应时被叫停。"), { code: "STOPPED_WHILE_WAITING" });
        await sleep(1000);
      }
      if (shouldStop()) throw Object.assign(new Error("等网关回应时被叫停。"), { code: "STOPPED_WHILE_WAITING" });
      waitedSeconds += waitSeconds;
    }
  }
}
