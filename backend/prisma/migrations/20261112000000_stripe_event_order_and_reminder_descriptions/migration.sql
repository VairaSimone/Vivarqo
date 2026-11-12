ALTER TABLE "subscriptions"
  ADD COLUMN "last_stripe_event_created_at" TIMESTAMPTZ(6);

ALTER TABLE "reminder_rules"
  ADD COLUMN "description" TEXT;
