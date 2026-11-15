ALTER TABLE "user_sessions"
  ADD COLUMN "active_workspace_owner_id" UUID,
  ADD CONSTRAINT "user_sessions_active_workspace_owner_id_fkey"
    FOREIGN KEY ("active_workspace_owner_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "user_sessions_active_workspace_idx" ON "user_sessions"("active_workspace_owner_id");

CREATE TABLE "workspace_memberships" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "owner_user_id" UUID NOT NULL,
  "collaborator_user_id" UUID NOT NULL,
  "role" VARCHAR(24) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMPTZ(6),
  CONSTRAINT "workspace_memberships_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workspace_memberships_owner_user_id_fkey"
    FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "workspace_memberships_collaborator_user_id_fkey"
    FOREIGN KEY ("collaborator_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "workspace_memberships_distinct_users_check" CHECK ("owner_user_id" <> "collaborator_user_id"),
  CONSTRAINT "workspace_memberships_role_check" CHECK ("role" IN ('admin', 'operator', 'breeding', 'viewer'))
);
CREATE UNIQUE INDEX "workspace_memberships_owner_collaborator_key"
  ON "workspace_memberships"("owner_user_id", "collaborator_user_id");
CREATE INDEX "workspace_memberships_collaborator_revoked_idx"
  ON "workspace_memberships"("collaborator_user_id", "revoked_at");
CREATE INDEX "workspace_memberships_owner_revoked_idx"
  ON "workspace_memberships"("owner_user_id", "revoked_at");

CREATE TABLE "workspace_invitations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "owner_user_id" UUID NOT NULL,
  "email" CITEXT NOT NULL,
  "token_hash" VARCHAR(128) NOT NULL,
  "role" VARCHAR(24) NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "accepted_at" TIMESTAMPTZ(6),
  "revoked_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workspace_invitations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workspace_invitations_owner_user_id_fkey"
    FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "workspace_invitations_role_check" CHECK ("role" IN ('admin', 'operator', 'breeding', 'viewer')),
  CONSTRAINT "workspace_invitations_token_hash_key" UNIQUE ("token_hash")
);
CREATE INDEX "workspace_invitations_owner_expires_idx"
  ON "workspace_invitations"("owner_user_id", "expires_at");
CREATE INDEX "workspace_invitations_email_expires_idx"
  ON "workspace_invitations"("email", "expires_at");
