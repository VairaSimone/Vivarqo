-- Record the terms version and timestamp accepted at account registration.
-- Nullable columns preserve existing accounts; new registrations require explicit acceptance.
ALTER TABLE users
  ADD COLUMN terms_accepted_at TIMESTAMPTZ(6),
  ADD COLUMN terms_version VARCHAR(32);
