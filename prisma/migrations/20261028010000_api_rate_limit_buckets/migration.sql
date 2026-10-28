CREATE TABLE IF NOT EXISTS api_rate_limit_buckets (
    namespace VARCHAR(80) NOT NULL,
    key_hash CHAR(64) NOT NULL,
    hits INTEGER NOT NULL DEFAULT 1 CHECK (hits >= 0),
    reset_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT api_rate_limit_buckets_pkey PRIMARY KEY (namespace, key_hash)
);

CREATE INDEX IF NOT EXISTS api_rate_limit_buckets_reset_idx
    ON api_rate_limit_buckets (reset_at);
