import dotenv from "dotenv";
import { resolveSecretEnvironment } from "./secret-files.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

dotenv.config({
  path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env"),
  override: false,
});

const originSchema = z.string().url().refine((value) => {
  try {
    const parsed = new URL(value);
    return parsed.origin === value.replace(/\/$/, "") &&
      parsed.pathname === "/" &&
      parsed.search === "" &&
      parsed.hash === "" &&
      parsed.username === "" &&
      parsed.password === "";
  } catch {
    return false;
  }
}, "must be an origin only, without a path, query, credentials or fragment").transform((value) => new URL(value).origin);

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  // Only set TRUST_PROXY_HOPS when the deployment topology has a known number
  // of trusted reverse proxies; never blindly trust all X-Forwarded-* headers.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(3).default(0),
  APP_ORIGIN: originSchema.default("http://localhost:5173"),
  API_ORIGIN: originSchema.default("http://localhost:3000"),
  DATABASE_URL: z.string().url().refine(
    (value) => value.startsWith("postgresql://") || value.startsWith("postgres://"),
    { message: "must be a PostgreSQL connection URL" },
  ),
  CSRF_SECRET: z.string().min(32),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().email().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_ID: z.string().optional(),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),
  S3_ENDPOINT: z.preprocess((value) => typeof value === "string" && !value.trim() ? undefined : value, z.string().url().optional()),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  SENTRY_DSN: z.string().url().optional(),
  METRICS_BEARER_TOKEN: z.string().min(32).optional(),
  PRIVATE_STORAGE_PATH: z.string().min(1).default("./var/private"),
  EXPORT_MAX_ARCHIVE_BYTES: z.coerce.number().int().min(1024 * 1024).max(Number.MAX_SAFE_INTEGER).default(20 * 1024 * 1024 * 1024),
  EXPORT_MAX_ENTRIES: z.coerce.number().int().min(1).max(1_000_000).default(100_000),
});

const parsedEnvironment = environmentSchema.safeParse(resolveSecretEnvironment(process.env));
if (!parsedEnvironment.success) {
  const issues = parsedEnvironment.error.issues
    .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid environment configuration: ${issues}`);
}

const runtimeEnvironment = parsedEnvironment.data;
const deployedEnvironment = runtimeEnvironment.NODE_ENV === "production" || runtimeEnvironment.NODE_ENV === "staging";
if (deployedEnvironment) {
  const deploymentProblems: string[] = [];
  const stripeMode = runtimeEnvironment.NODE_ENV === "production" ? "live" : "test";
  if (new URL(runtimeEnvironment.APP_ORIGIN).protocol !== "https:") deploymentProblems.push("APP_ORIGIN must use HTTPS in deployed environments");
  if (new URL(runtimeEnvironment.API_ORIGIN).protocol !== "https:") deploymentProblems.push("API_ORIGIN must use HTTPS in deployed environments");
  if (
    new URL(runtimeEnvironment.APP_ORIGIN).hostname.endsWith(".example.com") ||
    new URL(runtimeEnvironment.API_ORIGIN).hostname.endsWith(".example.com")
  ) {
    deploymentProblems.push("APP_ORIGIN and API_ORIGIN must use real deployment hostnames, not example.com placeholders");
  }
  if (
    runtimeEnvironment.CSRF_SECRET.length < 32 ||
    /replace|change[-_ ]?me|example/i.test(runtimeEnvironment.CSRF_SECRET)
  ) {
    deploymentProblems.push("CSRF_SECRET must be a unique random secret with at least 32 characters");
  }
  if (!runtimeEnvironment.RESEND_API_KEY || !runtimeEnvironment.EMAIL_FROM) {
    deploymentProblems.push("RESEND_API_KEY and EMAIL_FROM are required in deployed environments");
  } else if (runtimeEnvironment.EMAIL_FROM.toLowerCase().includes("example.com")) {
    deploymentProblems.push("EMAIL_FROM must use a verified sender domain, not example.com");
  }
  if (!runtimeEnvironment.STRIPE_SECRET_KEY || !runtimeEnvironment.STRIPE_WEBHOOK_SECRET || !runtimeEnvironment.STRIPE_PRICE_ID) {
    deploymentProblems.push("STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and STRIPE_PRICE_ID are required in deployed environments");
  } else {
    const expectedStripePrefix = stripeMode === "live" ? "sk_live_" : "sk_test_";
    if (!runtimeEnvironment.STRIPE_SECRET_KEY.startsWith(expectedStripePrefix)) {
      deploymentProblems.push(`STRIPE_SECRET_KEY must use Stripe ${stripeMode.toUpperCase()} credentials in this environment`);
    }
    if (!/^whsec_[A-Za-z0-9]+$/.test(runtimeEnvironment.STRIPE_WEBHOOK_SECRET)) {
      deploymentProblems.push("STRIPE_WEBHOOK_SECRET must be a valid Stripe webhook signing secret");
    }
    if (!/^price_[A-Za-z0-9]+$/.test(runtimeEnvironment.STRIPE_PRICE_ID)) {
      deploymentProblems.push("STRIPE_PRICE_ID must be a real Stripe Price identifier");
    }
  }
  if (!runtimeEnvironment.VAPID_PUBLIC_KEY || !runtimeEnvironment.VAPID_PRIVATE_KEY || !runtimeEnvironment.VAPID_SUBJECT) {
    deploymentProblems.push("VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT are required in deployed environments");
  } else if (/replace|example/i.test(runtimeEnvironment.VAPID_PUBLIC_KEY) || runtimeEnvironment.VAPID_SUBJECT.toLowerCase().includes("example.com")) {
    deploymentProblems.push("VAPID_PUBLIC_KEY and VAPID_SUBJECT must contain real environment-specific values");
  }
  if (!runtimeEnvironment.S3_BUCKET || !runtimeEnvironment.S3_ACCESS_KEY_ID || !runtimeEnvironment.S3_SECRET_ACCESS_KEY || !runtimeEnvironment.S3_REGION) {
    deploymentProblems.push("S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required in deployed environments");
  } else if (/replace|example/i.test(runtimeEnvironment.S3_BUCKET)) {
    deploymentProblems.push("S3_BUCKET must identify a real private bucket");
  }
  if (runtimeEnvironment.S3_ENDPOINT && new URL(runtimeEnvironment.S3_ENDPOINT).protocol !== "https:") {
    deploymentProblems.push("S3_ENDPOINT must use HTTPS in deployed environments");
  }
  if (deploymentProblems.length) {
    throw new Error(`Invalid ${runtimeEnvironment.NODE_ENV} environment: ${deploymentProblems.join("; ")}`);
  }
}
const vapidValues = [
  runtimeEnvironment.VAPID_PUBLIC_KEY,
  runtimeEnvironment.VAPID_PRIVATE_KEY,
  runtimeEnvironment.VAPID_SUBJECT,
];
if (vapidValues.some(Boolean) && !vapidValues.every(Boolean)) {
  throw new Error("Invalid environment configuration: configure VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT together");
}

export const env = runtimeEnvironment;
export type Environment = z.infer<typeof environmentSchema>;
