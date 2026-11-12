ALTER TABLE "subscriptions"
  ADD COLUMN "last_stripe_event_created_at" TIMESTAMPTZ(6);

ALTER TABLE "stripe_webhook_events"
  ADD COLUMN "stripe_event_created_at" TIMESTAMPTZ(6),
  ADD COLUMN "payload" JSONB;

CREATE INDEX "stripe_webhook_events_pending_idx"
  ON "stripe_webhook_events" ("result", "event_type", "stripe_event_created_at")
  WHERE "result" = 'pending';

-- Existing non-incomplete subscriptions have already had an authoritative lifecycle
-- event applied. Use the local row update time as a conservative lower bound so
-- delayed pre-deployment snapshots cannot overwrite their current state.
UPDATE "subscriptions"
   SET "last_stripe_event_created_at" = "updated_at"
 WHERE "last_stripe_event_created_at" IS NULL
   AND "status" <> 'incomplete';

ALTER TABLE "reminder_rules"
  ADD COLUMN "description" TEXT;
