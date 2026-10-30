CREATE TABLE "push_delivery_attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "notification_id" UUID,
    "push_subscription_id" UUID,
    "delivery_key" VARCHAR(180) NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'queued',
    "scheduled_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempted_at" TIMESTAMPTZ(6),
    "sent_at" TIMESTAMPTZ(6),
    "next_attempt_at" TIMESTAMPTZ(6),
    "http_status" INTEGER,
    "error_code" VARCHAR(80),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "push_delivery_attempts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "push_delivery_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "push_delivery_attempts_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "push_delivery_attempts_push_subscription_id_fkey" FOREIGN KEY ("push_subscription_id") REFERENCES "push_subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "push_delivery_attempts_delivery_attempt_unique" ON "push_delivery_attempts"("delivery_key", "attempt_number");
CREATE INDEX "push_delivery_attempts_status_scheduled_idx" ON "push_delivery_attempts"("status", "scheduled_at");
CREATE INDEX "push_delivery_attempts_user_created_idx" ON "push_delivery_attempts"("user_id", "created_at" DESC);
CREATE INDEX "push_delivery_attempts_notification_idx" ON "push_delivery_attempts"("notification_id");
