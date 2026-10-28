CREATE INDEX "user_sessions_expires_idx" ON "user_sessions"("expires_at");
CREATE INDEX "auth_tokens_expires_idx" ON "auth_tokens"("expires_at");
