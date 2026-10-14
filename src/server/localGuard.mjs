// Guard against DNS rebinding attacks on the local HTTP server.
// Only explicitly trusted local hostnames/IPs matching the server port are allowed.

export function isLocalHostHeader(hostHeader = "", serverPort, env = process.env) {
  if (!hostHeader) return false;
  const raw = String(hostHeader).trim().toLowerCase();

  // Match optional [ipv6] or hostname followed by optional :port
  let hostname = raw;
  let port = null;

  if (raw.startsWith("[")) {
    const closeIdx = raw.indexOf("]");
    if (closeIdx === -1) return false;
    hostname = raw.slice(0, closeIdx + 1);
    const rest = raw.slice(closeIdx + 1);
    if (rest.startsWith(":")) {
      port = rest.slice(1);
    } else if (rest.length > 0) {
      return false;
    }
  } else {
    const colonIdx = raw.lastIndexOf(":");
    if (colonIdx !== -1) {
      hostname = raw.slice(0, colonIdx);
      port = raw.slice(colonIdx + 1);
    }
  }

  if (port !== null && Number(port) !== Number(serverPort)) {
    return false;
  }

  const allowed = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (env.HOST && env.HOST !== "0.0.0.0") {
    allowed.add(env.HOST.toLowerCase());
  }

  return allowed.has(hostname);
}
