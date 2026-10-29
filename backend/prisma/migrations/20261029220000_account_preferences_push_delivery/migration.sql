-- Add durable account presentation preferences and individual push delivery attempts.
ALTER TABLE "users"
  ADD COLUMN "weight_unit" VARCHAR(8) NOT NULL DEFAULT 'g',
  ADD COLUMN "temperature_unit" VARCHAR(8) NOT NULL DEFAULT 'C',
  ADD COLUMN "display_preferences" JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE "push_delivery_attempts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "notification_id" UUID,
  "push_subscription_id" UUID,
  "idempotency_key" VARCHAR(220) NOT NULL,
  "attempt_number" INTEGER NOT NULL,
  "status" VARCHAR(16) NOT NULL,
  "response_status" INTEGER,
  "error_code" VARCHAR(64),
  "attempted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "next_attempt_at" TIMESTAMPTZ(6),
  "delivered_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "push_delivery_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "push_delivery_attempts_user_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "push_delivery_attempts_notification_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "push_delivery_attempts_subscription_fkey" FOREIGN KEY ("push_subscription_id") REFERENCES "push_subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "push_delivery_attempts_attempt_number_check" CHECK ("attempt_number" > 0),
  CONSTRAINT "push_delivery_attempts_response_status_check" CHECK ("response_status" IS NULL OR ("response_status" >= 100 AND "response_status" <= 599)),
  CONSTRAINT "push_delivery_attempts_status_check" CHECK ("status" IN ('queued', 'sent', 'retry', 'failed', 'removed', 'skipped'))
);

CREATE UNIQUE INDEX "push_delivery_attempts_idempotency_key_key" ON "push_delivery_attempts"("idempotency_key");
CREATE INDEX "push_delivery_attempts_user_attempted_idx" ON "push_delivery_attempts"("user_id", "attempted_at" DESC);
CREATE INDEX "push_delivery_attempts_status_retry_idx" ON "push_delivery_attempts"("status", "next_attempt_at");
CREATE INDEX "push_delivery_attempts_notification_idx" ON "push_delivery_attempts"("notification_id");
