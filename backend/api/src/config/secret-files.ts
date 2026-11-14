import { readFileSync } from "node:fs";

export type SecretFileReader = (path: string) => string;

const FILE_BACKED_VARIABLES = [
  "DATABASE_URL", "CSRF_SECRET", "RESEND_API_KEY", "BREVO_API_KEY", "EMAIL_FROM",
  "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_ID",
  "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT",
  "S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY", "SENTRY_DSN", "METRICS_BEARER_TOKEN",
] as const;

function readRequiredSecret(path: string, variable: string, readSecretFile: SecretFileReader): string {
  let value: string;
  try {
    value = readSecretFile(path).trim();
  } catch {
    throw new Error("Unable to read the configured secret file for " + variable);
  }
  if (!value) throw new Error("The configured secret file for " + variable + " is empty");
  return value;
}

/** Resolve *_FILE variables while keeping their contents out of process.env. */
export function resolveSecretEnvironment(
  source: NodeJS.ProcessEnv,
  readSecretFile: SecretFileReader = (path) => readFileSync(path, "utf8"),
): NodeJS.ProcessEnv {
  const resolved: NodeJS.ProcessEnv = { ...source };

  for (const variable of FILE_BACKED_VARIABLES) {
    const fileVariable = variable + "_FILE";
    const filePath = source[fileVariable]?.trim();
    if (!filePath) continue;
    if (source[variable]?.trim()) {
      throw new Error("Configure either " + variable + " or " + fileVariable + ", not both");
    }
    resolved[variable] = readRequiredSecret(filePath, fileVariable, readSecretFile);
    delete resolved[fileVariable];
  }

  const passwordFile = source.DATABASE_PASSWORD_FILE?.trim();
  if (passwordFile) {
    if (source.DATABASE_URL?.trim() || source.DATABASE_URL_FILE?.trim()) {
      throw new Error("Configure DATABASE_PASSWORD_FILE or DATABASE_URL/DATABASE_URL_FILE, not both");
    }
    const host = source.DATABASE_HOST?.trim();
    const portValue = source.DATABASE_PORT?.trim() || "5432";
    const user = source.DATABASE_USER?.trim();
    const database = source.DATABASE_NAME?.trim();
    const port = Number(portValue);

    if (!host || !user || !database) {
      throw new Error("DATABASE_HOST, DATABASE_USER and DATABASE_NAME are required with DATABASE_PASSWORD_FILE");
    }
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error("DATABASE_PORT must be an integer between 1 and 65535");
    }
    if (!/^[a-zA-Z0-9._:-]+$/.test(host)) throw new Error("DATABASE_HOST contains unsupported characters");
    if (!/^[a-zA-Z_][a-zA-Z0-9_-]{0,62}$/.test(user)) throw new Error("DATABASE_USER contains unsupported characters");
    if (!/^[a-zA-Z_][a-zA-Z0-9_-]{0,62}$/.test(database)) throw new Error("DATABASE_NAME contains unsupported characters");

    const password = readRequiredSecret(passwordFile, "DATABASE_PASSWORD_FILE", readSecretFile);
    const url = new URL("postgresql://localhost");
    url.hostname = host;
    url.port = String(port);
    url.username = user;
    url.password = password;
    url.pathname = "/" + database;
    url.searchParams.set("schema", "public");
    resolved.DATABASE_URL = url.toString();

    delete resolved.DATABASE_PASSWORD_FILE;
    delete resolved.DATABASE_HOST;
    delete resolved.DATABASE_PORT;
    delete resolved.DATABASE_USER;
    delete resolved.DATABASE_NAME;
  }

  return resolved;
}
