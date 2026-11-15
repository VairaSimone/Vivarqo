ALTER TABLE "finance_recurrences"
  ADD COLUMN "anchor_month" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "anchor_day" INTEGER NOT NULL DEFAULT 1;

UPDATE "finance_recurrences"
SET "anchor_month" = EXTRACT(MONTH FROM "next_occurrence_on")::INTEGER,
    "anchor_day" = EXTRACT(DAY FROM "next_occurrence_on")::INTEGER;

ALTER TABLE "finance_recurrences"
  ADD CONSTRAINT "finance_recurrences_anchor_month_check" CHECK ("anchor_month" BETWEEN 1 AND 12),
  ADD CONSTRAINT "finance_recurrences_anchor_day_check" CHECK ("anchor_day" BETWEEN 1 AND 31);
