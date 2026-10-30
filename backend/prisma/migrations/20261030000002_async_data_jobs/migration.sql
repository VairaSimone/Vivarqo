ALTER TABLE "import_jobs"
  ADD COLUMN "allow_possible_duplicates" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "processing_started_at" TIMESTAMPTZ(6),
  ADD COLUMN "lease_token" UUID,
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_error_code" VARCHAR(80),
  ADD CONSTRAINT "import_jobs_attempts_nonnegative" CHECK ("attempts" >= 0);

ALTER TABLE "export_jobs"
  ADD COLUMN "include_documents" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "processing_started_at" TIMESTAMPTZ(6),
  ADD COLUMN "lease_token" UUID,
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_error_code" VARCHAR(80),
  ADD CONSTRAINT "export_jobs_attempts_nonnegative" CHECK ("attempts" >= 0);

CREATE INDEX "import_jobs_status_created_idx" ON "import_jobs"("status", "created_at");
CREATE INDEX "export_jobs_status_created_idx" ON "export_jobs"("status", "created_at");
