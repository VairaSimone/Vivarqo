import dotenv from "dotenv";
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
  METRICS_BEARER_TOKEN: z.string().min(32).optional(),
  PRIVATE_STORAGE_PATH: z.string().min(1).default("./var/private"),
});

const parsedEnvironment = environmentSchema.safeParse(process.env);
if (!parsedEnvironment.success) {
  const issues = parsedEnvironment.error.issues
    .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid environment configuration: ${issues}`);
}

const runtimeEnvironment = parsedEnvironment.data;
if (runtimeEnvironment.NODE_ENV === "production") {
  const productionProblems: string[] = [];
  if (new URL(runtimeEnvironment.APP_ORIGIN).protocol !== "https:") productionProblems.push("APP_ORIGIN must use HTTPS in production");
  if (new URL(runtimeEnvironment.API_ORIGIN).protocol !== "https:") productionProblems.push("API_ORIGIN must use HTTPS in production");
  if (runtimeEnvironment.CSRF_SECRET.toLowerCase().includes("replace-with") || runtimeEnvironment.CSRF_SECRET.length < 32) {
    productionProblems.push("CSRF_SECRET must be a unique random secret with at least 32 characters");
  }
  if (!runtimeEnvironment.RESEND_API_KEY || !runtimeEnvironment.EMAIL_FROM) {
    productionProblems.push("RESEND_API_KEY and EMAIL_FROM are required in production");
  }
  if (!runtimeEnvironment.STRIPE_SECRET_KEY || !runtimeEnvironment.STRIPE_WEBHOOK_SECRET || !runtimeEnvironment.STRIPE_PRICE_ID) {
    productionProblems.push("STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and STRIPE_PRICE_ID are required in production");
  }
  if (!runtimeEnvironment.VAPID_PUBLIC_KEY || !runtimeEnvironment.VAPID_PRIVATE_KEY || !runtimeEnvironment.VAPID_SUBJECT) {
    productionProblems.push("VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT are required in production");
  }
  if (!runtimeEnvironment.S3_BUCKET || !runtimeEnvironment.S3_ACCESS_KEY_ID || !runtimeEnvironment.S3_SECRET_ACCESS_KEY || !runtimeEnvironment.S3_REGION) {
    productionProblems.push("S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required in production");
  }
  if (runtimeEnvironment.S3_ENDPOINT && new URL(runtimeEnvironment.S3_ENDPOINT).protocol !== "https:") {
    productionProblems.push("S3_ENDPOINT must use HTTPS in production");
  }
  if (productionProblems.length) throw new Error(`Invalid production environment: ${productionProblems.join("; ")}`);
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
