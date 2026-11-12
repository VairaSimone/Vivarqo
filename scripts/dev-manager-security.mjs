const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export function isDashboardRequestAllowed(remoteAddress, hostHeader, port) {
  const remote = String(remoteAddress || "").toLowerCase();
  const host = String(hostHeader || "").trim().toLowerCase();
  if (!LOOPBACK.has(remote)) return false;
  return new Set([
    "127.0.0.1:" + port,
    "localhost:" + port,
    "[::1]:" + port
  ]).has(host);
}
