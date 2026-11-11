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

CREATE OR REPLACE FUNCTION vivarqo_check_document_deletion_tenant_consistency()
RETURNS TRIGGER AS $$
DECLARE
    document_owner_id UUID;
    document_storage_key TEXT;
BEGIN
    SELECT user_id, storage_key
      INTO document_owner_id, document_storage_key
      FROM documents
     WHERE id = NEW.document_id;

    IF document_owner_id IS NULL
       OR document_owner_id <> NEW.user_id
       OR document_storage_key <> NEW.storage_key THEN
        RAISE EXCEPTION 'document deletion job must reference the matching owner and storage key';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER document_deletion_jobs_tenant_guard
    BEFORE INSERT OR UPDATE ON document_deletion_jobs
    FOR EACH ROW EXECUTE FUNCTION vivarqo_check_document_deletion_tenant_consistency();
