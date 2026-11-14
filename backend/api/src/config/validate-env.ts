import { env } from "./env.js";

// Deliberately report provider availability only; never print credentials or secret values.
console.log(JSON.stringify({
  environment: env.NODE_ENV,
  databaseConfigured: Boolean(env.DATABASE_URL),
  providers: {
    email: Boolean((env.EMAIL_PROVIDER === "brevo" ? env.BREVO_API_KEY : env.RESEND_API_KEY) && env.EMAIL_FROM),
    billing: Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET && env.STRIPE_PRICE_ID),
    push: Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT),
    objectStorage: Boolean(env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY && env.S3_REGION),
    sentry: Boolean(env.SENTRY_DSN),
    metricsAuth: Boolean(env.METRICS_BEARER_TOKEN)
  }
}, null, 2));
console.log("Environment configuration valid.");
