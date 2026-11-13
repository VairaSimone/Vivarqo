import { createServer } from "node:net";

export function readEnvValue(contents, name) {
  const expression = new RegExp("^\\s*(?:export\\s+)?" + name + "\\s*=\\s*(.*)$");
  let result;
  for (const line of String(contents || "").split(/\r?\n/)) {
    const match = line.match(expression);
    if (!match) continue;
    let value = match[1].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    result = value;
  }
  return result;
}

export function setEnvValues(contents, updates) {
  const lines = String(contents || "").split(/\r?\n/);
  for (const [name, rawValue] of Object.entries(updates)) {
    const value = String(rawValue);
    const expression = new RegExp("^(\\s*(?:export\\s+)?" + name + "\\s*=).*$");
    let found = false;
    for (let index = 0; index < lines.length; index += 1) {
      const match = lines[index].match(expression);
      if (!match) continue;
      lines[index] = match[1] + value;
      found = true;
    }
    if (!found) lines.push(name + "=" + value);
  }
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n") + "\n";
}

export function getLocalPostgresPort(databaseUrl) {
  if (!databaseUrl) return null;
  try {
    const url = new URL(databaseUrl);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return null;
    if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname.toLowerCase())) return null;
    const port = Number(url.port || 5432);
    return Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : null;
  } catch {
    return null;
  }
}

export function withLocalPostgresPort(databaseUrl, port) {
  const localPort = getLocalPostgresPort(databaseUrl);
  if (localPort === null) return databaseUrl;
  const url = new URL(databaseUrl);
  url.port = String(port);
  return url.toString();
}

export function getPortFromComposeMapping(output) {
  const value = String(output || "").trim().split(/\r?\n/).filter(Boolean).at(-1) || "";
  const match = value.match(/:(\d+)$/);
  if (!match) return null;
  const port = Number(match[1]);
  return Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : null;
}

export function isTcpPortAvailable(port, host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", error => {
      if (["EADDRINUSE", "EACCES", "EADDRNOTAVAIL"].includes(error.code)) resolve(false);
      else reject(error);
    });
    server.listen({ host, port, exclusive: true }, () => {
      server.close(error => error ? reject(error) : resolve(true));
    });
  });
}

export async function findAvailablePort(startPort, endPort = 5500, probe = isTcpPortAvailable) {
  if (!Number.isInteger(startPort) || startPort < 1 || startPort > 65_535) {
    throw new TypeError("La porta iniziale deve essere un intero tra 1 e 65535.");
  }
  const upper = Math.min(65_535, endPort);
  for (let port = startPort; port <= upper; port += 1) {
    if (await probe(port)) return port;
  }
  return null;
}

export function clearUnusedVapidPlaceholder(contents) {
  const publicKey = readEnvValue(contents, "VAPID_PUBLIC_KEY") || "";
  const privateKey = readEnvValue(contents, "VAPID_PRIVATE_KEY") || "";
  const subject = readEnvValue(contents, "VAPID_SUBJECT") || "";
  if (!publicKey && !privateKey && subject === "mailto:admin@example.com") {
    return setEnvValues(contents, { VAPID_SUBJECT: "" });
  }
  return String(contents || "");
}

export function getIncompleteVapidVariables(contents) {
  const values = {
    VAPID_PUBLIC_KEY: readEnvValue(contents, "VAPID_PUBLIC_KEY") || "",
    VAPID_PRIVATE_KEY: readEnvValue(contents, "VAPID_PRIVATE_KEY") || "",
    VAPID_SUBJECT: readEnvValue(contents, "VAPID_SUBJECT") || ""
  };
  const configured = Object.entries(values).filter(([, value]) => value.trim()).map(([name]) => name);
  return configured.length > 0 && configured.length < 3
    ? Object.keys(values).filter(name => !values[name].trim())
    : [];
}
