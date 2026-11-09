CREATE TABLE "document_deletion_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "storage_key" TEXT NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'queued',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processing_started_at" TIMESTAMPTZ(6),
  "lease_token" UUID,
  "last_error_code" VARCHAR(80),
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "document_deletion_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "document_deletion_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "document_deletion_jobs_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "document_deletion_jobs_attempts_nonnegative" CHECK ("attempts" >= 0),
  CONSTRAINT "document_deletion_jobs_status_check" CHECK ("status" IN ('queued', 'processing', 'completed', 'failed'))
);
CREATE UNIQUE INDEX "document_deletion_jobs_document_id_key" ON "document_deletion_jobs"("document_id");
CREATE INDEX "document_deletion_jobs_status_next_attempt_idx" ON "document_deletion_jobs"("status", "next_attempt_at");
CREATE INDEX "document_deletion_jobs_user_created_idx" ON "document_deletion_jobs"("user_id", "created_at" DESC);
