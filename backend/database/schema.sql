-- VIVARQO - Schema PostgreSQL
-- Riferimento: Specifica tecnica Vivarqo 1.0 - 27 ottobre 2026
-- Destinazione: PostgreSQL 18; eseguire una sola volta su un database vuoto.
--
-- Questo file crea lo schema dati, i vincoli, gli indici e i trigger updated_at.
-- La logica applicativa (autorizzazioni, saldo inventario, Stripe, storage file,
-- invio notifiche e procedure di cancellazione/esportazione) resta nel backend.
-- Non contiene dati demo né password/chiavi reali.
-- Nota: l'eliminazione definitiva di un account va eseguita dal backend con
-- una procedura ordinata che rimuova prima i record dipendenti e i file; non
-- eseguire DELETE diretto su users come procedura ordinaria.
-- ============================================================================

BEGIN;

-- Necessaria per email case-insensitive (es. Utente@esempio.it = utente@esempio.it).
CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------------------
-- 1. Account e autenticazione
-- ---------------------------------------------------------------------------
CREATE TABLE users (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email               CITEXT NOT NULL UNIQUE,
    password_hash       TEXT NOT NULL,
    display_name        VARCHAR(120) NOT NULL,
    locale              VARCHAR(10) NOT NULL DEFAULT 'it'
                        CHECK (locale IN ('it', 'en')),
    timezone            VARCHAR(64) NOT NULL DEFAULT 'Europe/Rome',
    email_verified_at   TIMESTAMPTZ,
    account_status      VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ
);

CREATE TABLE user_sessions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash          TEXT NOT NULL UNIQUE,
    expires_at          TIMESTAMPTZ NOT NULL,
    last_seen_at        TIMESTAMPTZ,
    user_agent          TEXT,
    ip_hash             TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE auth_tokens (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash          TEXT NOT NULL UNIQUE,
    token_type          VARCHAR(24) NOT NULL CHECK (token_type IN ('verify_email', 'reset_password')),
    expires_at          TIMESTAMPTZ NOT NULL,
    consumed_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 2. Animali e registri di cura
-- ---------------------------------------------------------------------------
CREATE TABLE animals (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name                        VARCHAR(120) NOT NULL,
    identifier                  CITEXT,
    species                     VARCHAR(160) NOT NULL,
    sex                         VARCHAR(12) NOT NULL DEFAULT 'unknown'
                                CHECK (sex IN ('male', 'female', 'unknown')),
    morph                       VARCHAR(200),
    genetics_notes              TEXT,
    birth_date                  DATE,
    birth_date_estimated        BOOLEAN NOT NULL DEFAULT FALSE,
    acquired_date               DATE,
    origin_description          TEXT,
    previous_breeder            VARCHAR(160),
    location_label              VARCHAR(160),
    status                      VARCHAR(20) NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active', 'sold', 'transferred', 'deceased', 'archived')),
    notes                       TEXT,
    photo_key                   TEXT,
    origin_clutch_id            UUID,
    origin_offspring_batch_id   UUID,
    archived_at                 TIMESTAMPTZ,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT animals_id_user_id_unique UNIQUE (id, user_id),
    CONSTRAINT animals_identifier_length_check CHECK (identifier IS NULL OR char_length(identifier::text) <= 120)
);

CREATE UNIQUE INDEX animals_user_identifier_unique
    ON animals (user_id, identifier)
    WHERE identifier IS NOT NULL;

CREATE TABLE feeding_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    performed_at    TIMESTAMPTZ NOT NULL,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT feeding_sessions_id_user_id_unique UNIQUE (id, user_id)
);

CREATE TABLE feeding_entries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      UUID NOT NULL REFERENCES feeding_sessions(id) ON DELETE CASCADE,
    animal_id       UUID NOT NULL REFERENCES animals(id) ON DELETE RESTRICT,
    outcome         VARCHAR(20) NOT NULL
                    CHECK (outcome IN ('ate', 'refused', 'not_offered', 'unknown')),
    food_type       VARCHAR(120),
    food_size       VARCHAR(120),
    food_weight_g   NUMERIC(10,2) CHECK (food_weight_g IS NULL OR food_weight_g > 0),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE weight_measurements (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    animal_id       UUID NOT NULL REFERENCES animals(id) ON DELETE RESTRICT,
    measured_at     TIMESTAMPTZ NOT NULL,
    weight_g        NUMERIC(10,2) NOT NULL CHECK (weight_g > 0),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE shed_records (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    animal_id       UUID NOT NULL REFERENCES animals(id) ON DELETE RESTRICT,
    occurred_at     TIMESTAMPTZ NOT NULL,
    outcome         VARCHAR(16) NOT NULL CHECK (outcome IN ('complete', 'partial', 'unknown')),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE health_records (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    animal_id           UUID NOT NULL REFERENCES animals(id) ON DELETE RESTRICT,
    record_type         VARCHAR(20) NOT NULL CHECK (record_type IN ('symptom', 'visit', 'diagnosis', 'suspicion', 'treatment', 'checkup')),
    status              VARCHAR(16) NOT NULL DEFAULT 'ongoing' CHECK (status IN ('ongoing', 'resolved', 'chronic')),
    occurred_at         TIMESTAMPTZ NOT NULL,
    title               VARCHAR(160) NOT NULL,
    symptoms            TEXT,
    diagnosis           TEXT,
    suspected_condition TEXT,
    veterinarian        VARCHAR(160),
    clinic              VARCHAR(160),
    medication          VARCHAR(160),
    dosage              VARCHAR(120),
    frequency           VARCHAR(120),
    treatment_start_at  TIMESTAMPTZ,
    treatment_end_at    TIMESTAMPTZ,
    next_due_at         TIMESTAMPTZ,
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT health_records_treatment_dates_check CHECK (
      treatment_end_at IS NULL OR treatment_start_at IS NULL OR treatment_end_at >= treatment_start_at
    )
);
CREATE INDEX health_records_animal_occurred_idx ON health_records (animal_id, occurred_at DESC);
CREATE INDEX health_records_animal_status_idx ON health_records (animal_id, status);

CREATE TABLE animal_notes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    animal_id       UUID NOT NULL REFERENCES animals(id) ON DELETE RESTRICT,
    occurred_at     TIMESTAMPTZ NOT NULL,
    title           VARCHAR(160),
    category        VARCHAR(40) NOT NULL,
    body            TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at     TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- 3. Attività, regole ricorrenti e notifiche
-- ---------------------------------------------------------------------------
CREATE TABLE reminder_rules (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    animal_id       UUID REFERENCES animals(id) ON DELETE RESTRICT,
    title           VARCHAR(160) NOT NULL,
    description     TEXT,
    category        VARCHAR(30) NOT NULL
                    CHECK (category IN ('feeding', 'weighing', 'shed_check', 'cleaning', 'reproduction', 'document', 'inventory', 'custom')),
    interval_days   INTEGER NOT NULL CHECK (interval_days > 0),
    next_due_at     TIMESTAMPTZ NOT NULL,
    is_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT reminder_rules_id_user_id_unique UNIQUE (id, user_id)
);

CREATE TABLE tasks (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    animal_id           UUID REFERENCES animals(id) ON DELETE RESTRICT,
    title               VARCHAR(160) NOT NULL,
    description         TEXT,
    category            VARCHAR(30) NOT NULL
                        CHECK (category IN ('feeding', 'weighing', 'shed_check', 'cleaning', 'reproduction', 'document', 'inventory', 'custom')),
    due_at              TIMESTAMPTZ NOT NULL,
    status              VARCHAR(16) NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open', 'completed', 'dismissed')),
    completed_at        TIMESTAMPTZ,
    reminder_rule_id    UUID REFERENCES reminder_rules(id) ON DELETE SET NULL,
    health_record_id     UUID UNIQUE REFERENCES health_records(id) ON DELETE CASCADE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE notification_preferences (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    in_app_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
    push_enabled        BOOLEAN NOT NULL DEFAULT FALSE,
    categories          JSONB NOT NULL DEFAULT '{}'::jsonb,
    quiet_hours_start   TIME,
    quiet_hours_end     TIME,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE push_subscriptions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint        TEXT NOT NULL UNIQUE,
    p256dh          TEXT NOT NULL,
    auth_secret     TEXT NOT NULL,
    user_agent      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_success_at TIMESTAMPTZ
);

CREATE TABLE notifications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category        VARCHAR(30) NOT NULL,
    title           VARCHAR(160) NOT NULL,
    body            TEXT NOT NULL,
    target_path     TEXT,
    read_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 4. Riproduzioni, eventi, covate, uova, incubazione e gruppi di nascita
-- ---------------------------------------------------------------------------
CREATE TABLE reproduction_cycles (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_a_animal_id  UUID REFERENCES animals(id) ON DELETE RESTRICT,
    parent_b_animal_id  UUID REFERENCES animals(id) ON DELETE RESTRICT,
    name                VARCHAR(160),
    started_on          DATE NOT NULL,
    ended_on            DATE,
    status              VARCHAR(16) NOT NULL DEFAULT 'planned'
                        CHECK (status IN ('planned', 'active', 'completed', 'cancelled')),
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT reproduction_cycles_id_user_id_unique UNIQUE (id, user_id),
    CONSTRAINT reproduction_cycles_dates_check CHECK (ended_on IS NULL OR ended_on >= started_on),
    CONSTRAINT reproduction_cycles_parents_distinct CHECK (
        parent_a_animal_id IS NULL OR parent_b_animal_id IS NULL OR parent_a_animal_id <> parent_b_animal_id
    )
);

CREATE TABLE reproductive_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cycle_id        UUID NOT NULL REFERENCES reproduction_cycles(id) ON DELETE RESTRICT,
    event_type      VARCHAR(24) NOT NULL
                    CHECK (event_type IN ('pairing', 'observation', 'ovulation', 'gravid', 'laying', 'live_birth', 'incubation_start', 'hatch', 'loss', 'other')),
    occurred_at     TIMESTAMPTZ NOT NULL,
    animal_id       UUID REFERENCES animals(id) ON DELETE RESTRICT,
    details         TEXT,
    temperature_c   NUMERIC(5,2),
    humidity_pct    NUMERIC(5,2) CHECK (humidity_pct IS NULL OR humidity_pct BETWEEN 0 AND 100),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE clutches (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cycle_id                UUID NOT NULL REFERENCES reproduction_cycles(id) ON DELETE RESTRICT,
    laid_on                 DATE NOT NULL,
    egg_count               INTEGER NOT NULL CHECK (egg_count >= 0),
    status                  VARCHAR(20) NOT NULL DEFAULT 'active',
    incubator_label         VARCHAR(120),
    incubation_started_at   TIMESTAMPTZ,
    notes                   TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT clutches_id_cycle_id_unique UNIQUE (id, cycle_id)
);

CREATE TABLE eggs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clutch_id       UUID NOT NULL REFERENCES clutches(id) ON DELETE RESTRICT,
    code            VARCHAR(80),
    status          VARCHAR(20) NOT NULL DEFAULT 'unknown',
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX eggs_clutch_code_unique
    ON eggs (clutch_id, code)
    WHERE code IS NOT NULL;

CREATE TABLE incubation_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clutch_id       UUID NOT NULL REFERENCES clutches(id) ON DELETE RESTRICT,
    recorded_at     TIMESTAMPTZ NOT NULL,
    temperature_c   NUMERIC(5,2),
    humidity_pct    NUMERIC(5,2) CHECK (humidity_pct IS NULL OR humidity_pct BETWEEN 0 AND 100),
    event_type      VARCHAR(24) NOT NULL,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE offspring_batches (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cycle_id        UUID NOT NULL REFERENCES reproduction_cycles(id) ON DELETE RESTRICT,
    clutch_id       UUID REFERENCES clutches(id) ON DELETE RESTRICT,
    born_on         DATE NOT NULL,
    count           INTEGER NOT NULL CHECK (count >= 0),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT offspring_batches_id_cycle_id_unique UNIQUE (id, cycle_id)
);

-- FK circolari aggiunte dopo la creazione delle tabelle riproduttive.
ALTER TABLE animals
    ADD CONSTRAINT animals_origin_clutch_fk
    FOREIGN KEY (origin_clutch_id) REFERENCES clutches(id) ON DELETE RESTRICT;

ALTER TABLE animals
    ADD CONSTRAINT animals_origin_offspring_batch_fk
    FOREIGN KEY (origin_offspring_batch_id) REFERENCES offspring_batches(id) ON DELETE RESTRICT;

ALTER TABLE animals
    ADD CONSTRAINT animals_single_origin_check
    CHECK (origin_clutch_id IS NULL OR origin_offspring_batch_id IS NULL);

-- ---------------------------------------------------------------------------
-- 5. Inventario e movimenti
-- ---------------------------------------------------------------------------
CREATE TABLE inventory_items (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name                VARCHAR(160) NOT NULL,
    category            VARCHAR(32) NOT NULL
                        CHECK (category IN ('food', 'substrate', 'material', 'equipment', 'other')),
    unit                VARCHAR(24) NOT NULL,
    quantity_on_hand    NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
    minimum_quantity    NUMERIC(12,3) CHECK (minimum_quantity IS NULL OR minimum_quantity >= 0),
    notes               TEXT,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT inventory_items_id_user_id_unique UNIQUE (id, user_id)
);

CREATE TABLE stock_movements (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id             UUID NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
    movement_type       VARCHAR(16) NOT NULL CHECK (movement_type IN ('in', 'out', 'adjustment')),
    quantity            NUMERIC(12,3) NOT NULL CHECK (quantity >= 0 AND (movement_type = 'adjustment' OR quantity > 0)),
    unit_cost_cents     INTEGER CHECK (unit_cost_cents IS NULL OR unit_cost_cents >= 0),
    occurred_at         TIMESTAMPTZ NOT NULL,
    reference           VARCHAR(160),
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 6. Documenti, condivisioni pubbliche e import/export
-- ---------------------------------------------------------------------------
CREATE TABLE documents (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    animal_id           UUID REFERENCES animals(id) ON DELETE RESTRICT,
    cycle_id            UUID REFERENCES reproduction_cycles(id) ON DELETE RESTRICT,
    original_filename   VARCHAR(255) NOT NULL,
    storage_key         TEXT NOT NULL UNIQUE,
    mime_type           VARCHAR(120) NOT NULL,
    size_bytes          BIGINT NOT NULL CHECK (size_bytes > 0),
    category            VARCHAR(40) NOT NULL,
    note                TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ,
    CONSTRAINT documents_has_parent_check CHECK (animal_id IS NOT NULL OR cycle_id IS NOT NULL)
);

CREATE TABLE public_shares (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    animal_id           UUID NOT NULL UNIQUE REFERENCES animals(id) ON DELETE RESTRICT,
    slug                VARCHAR(100) NOT NULL UNIQUE,
    is_enabled          BOOLEAN NOT NULL DEFAULT FALSE,
    visible_fields      JSONB NOT NULL DEFAULT '[]'::jsonb,
    public_description  TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at          TIMESTAMPTZ
);

CREATE TABLE import_jobs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entity_type     VARCHAR(40) NOT NULL,
    storage_key     TEXT NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'uploaded',
    total_rows      INTEGER NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
    created_count   INTEGER NOT NULL DEFAULT 0 CHECK (created_count >= 0),
    skipped_count   INTEGER NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
    error_count     INTEGER NOT NULL DEFAULT 0 CHECK (error_count >= 0),
    report                    JSONB,
    allow_possible_duplicates  BOOLEAN NOT NULL DEFAULT FALSE,
    processing_started_at      TIMESTAMPTZ,
    lease_token                 UUID,
    attempts                   INTEGER NOT NULL DEFAULT 0,
    last_error_code            VARCHAR(80),
    expires_at                 TIMESTAMPTZ NOT NULL,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE export_jobs (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status                VARCHAR(20) NOT NULL DEFAULT 'pending',
    storage_key           TEXT,
    include_documents     BOOLEAN NOT NULL DEFAULT FALSE,
    modules               TEXT[] NOT NULL DEFAULT ARRAY['animals', 'feedings', 'reproduction', 'finance', 'inventory']::TEXT[] CHECK (cardinality(modules) BETWEEN 1 AND 5 AND modules <@ ARRAY['animals', 'feedings', 'reproduction', 'finance', 'inventory']::TEXT[]),
    processing_started_at TIMESTAMPTZ,
    lease_token           UUID,
    attempts              INTEGER NOT NULL DEFAULT 0,
    last_error_code       VARCHAR(80),
    expires_at            TIMESTAMPTZ NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE api_rate_limit_buckets (
    namespace       VARCHAR(80) NOT NULL,
    key_hash        CHAR(64) NOT NULL,
    hits            INTEGER NOT NULL DEFAULT 1 CHECK (hits >= 0),
    reset_at        TIMESTAMPTZ NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT api_rate_limit_buckets_pkey PRIMARY KEY (namespace, key_hash)
);

-- ---------------------------------------------------------------------------
-- 7. Annotazioni genetiche e registro economico
-- ---------------------------------------------------------------------------
CREATE TABLE animal_genetic_traits (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    animal_id           UUID NOT NULL REFERENCES animals(id) ON DELETE RESTRICT,
    trait_name          VARCHAR(160) NOT NULL,
    trait_value         VARCHAR(240) NOT NULL,
    source_animal_id    UUID REFERENCES animals(id) ON DELETE RESTRICT,
    confidence_note     TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE finance_entries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    animal_id       UUID REFERENCES animals(id) ON DELETE RESTRICT,
    entry_type      VARCHAR(12) NOT NULL CHECK (entry_type IN ('income', 'expense')),
    occurred_on     DATE NOT NULL,
    amount_cents    BIGINT NOT NULL CHECK (amount_cents > 0),
    currency        CHAR(3) NOT NULL DEFAULT 'EUR',
    category        VARCHAR(80) NOT NULL,
    description     VARCHAR(240) NOT NULL,
    document_id     UUID REFERENCES documents(id) ON DELETE RESTRICT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 8. Abbonamenti, webhook e audit
-- ---------------------------------------------------------------------------
CREATE TABLE subscriptions (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    stripe_customer_id      VARCHAR(128) UNIQUE,
    stripe_subscription_id  VARCHAR(128) UNIQUE,
    stripe_price_id         VARCHAR(128),
    status                  VARCHAR(32) NOT NULL
                            CHECK (status IN ('active', 'trialing', 'past_due', 'incomplete', 'incomplete_expired', 'canceled', 'unpaid', 'paused')),
    current_period_start    TIMESTAMPTZ,
    current_period_end      TIMESTAMPTZ,
    cancel_at_period_end    BOOLEAN NOT NULL DEFAULT FALSE,
    last_stripe_event_created_at TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT subscription_period_check CHECK (
        current_period_start IS NULL OR current_period_end IS NULL OR current_period_end >= current_period_start
    )
);

CREATE TABLE stripe_webhook_events (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stripe_event_id     VARCHAR(128) NOT NULL UNIQUE,
    event_type          VARCHAR(120) NOT NULL,
    stripe_event_created_at TIMESTAMPTZ,
    stripe_customer_id  VARCHAR(128),
    stripe_subscription_id VARCHAR(128),
    processed_at        TIMESTAMPTZ,
    result              VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (result IN ('pending', 'processed', 'failed', 'ignored')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE audit_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    action          VARCHAR(80) NOT NULL,
    entity_type     VARCHAR(80),
    entity_id       UUID,
    request_id      VARCHAR(80),
    metadata        JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 9. Indici per filtri, cronologie e chiavi esterne
-- ---------------------------------------------------------------------------
CREATE INDEX user_sessions_user_expires_idx ON user_sessions (user_id, expires_at);
CREATE INDEX user_sessions_expires_idx ON user_sessions (expires_at);
CREATE INDEX auth_tokens_user_type_expires_idx ON auth_tokens (user_id, token_type, expires_at);
CREATE INDEX auth_tokens_expires_idx ON auth_tokens (expires_at);
CREATE INDEX animals_user_status_idx ON animals (user_id, status);
CREATE INDEX animals_user_name_idx ON animals (user_id, name);
CREATE INDEX animals_user_species_idx ON animals (user_id, species);
CREATE INDEX animals_user_location_idx ON animals (user_id, location_label);
CREATE INDEX feeding_sessions_user_performed_idx ON feeding_sessions (user_id, performed_at DESC);
CREATE INDEX feeding_entries_animal_session_idx ON feeding_entries (animal_id, session_id);
CREATE INDEX feeding_entries_session_idx ON feeding_entries (session_id);
CREATE INDEX weight_measurements_animal_measured_idx ON weight_measurements (animal_id, measured_at DESC);
CREATE INDEX shed_records_animal_occurred_idx ON shed_records (animal_id, occurred_at DESC);
CREATE INDEX animal_notes_animal_occurred_idx ON animal_notes (animal_id, occurred_at DESC);
CREATE INDEX reminder_rules_user_next_due_idx ON reminder_rules (user_id, next_due_at) WHERE is_enabled = TRUE;
CREATE INDEX reminder_rules_animal_idx ON reminder_rules (animal_id);
CREATE INDEX tasks_user_status_due_idx ON tasks (user_id, status, due_at);
CREATE INDEX tasks_open_due_worker_idx ON tasks (due_at, id) WHERE status = 'open';
CREATE INDEX tasks_animal_idx ON tasks (animal_id);
CREATE INDEX tasks_reminder_rule_idx ON tasks (reminder_rule_id);
CREATE UNIQUE INDEX tasks_one_open_per_reminder_rule_idx ON tasks (reminder_rule_id) WHERE status = 'open';
CREATE INDEX push_subscriptions_user_idx ON push_subscriptions (user_id);
CREATE INDEX notifications_user_created_idx ON notifications (user_id, created_at DESC);
CREATE INDEX stripe_webhook_events_pending_idx ON stripe_webhook_events (result, event_type, stripe_customer_id, stripe_subscription_id, stripe_event_created_at) WHERE result = 'pending';
CREATE INDEX notifications_user_unread_idx ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX notifications_user_category_target_idx ON notifications (user_id, category, target_path);
CREATE INDEX reproduction_cycles_user_status_started_idx ON reproduction_cycles (user_id, status, started_on DESC);
CREATE INDEX reproduction_cycles_parent_a_idx ON reproduction_cycles (parent_a_animal_id);
CREATE INDEX reproduction_cycles_parent_b_idx ON reproduction_cycles (parent_b_animal_id);
CREATE INDEX reproductive_events_cycle_occurred_idx ON reproductive_events (cycle_id, occurred_at);
CREATE INDEX reproductive_events_animal_idx ON reproductive_events (animal_id);
CREATE INDEX clutches_cycle_laid_idx ON clutches (cycle_id, laid_on);
CREATE INDEX eggs_clutch_idx ON eggs (clutch_id);
CREATE INDEX eggs_clutch_created_idx ON eggs (clutch_id, created_at);
CREATE UNIQUE INDEX eggs_clutch_code_ci_unique ON eggs (clutch_id, lower(code)) WHERE code IS NOT NULL;
CREATE INDEX incubation_logs_clutch_recorded_idx ON incubation_logs (clutch_id, recorded_at);
CREATE INDEX offspring_batches_cycle_idx ON offspring_batches (cycle_id);
CREATE INDEX offspring_batches_cycle_born_idx ON offspring_batches (cycle_id, born_on DESC);
CREATE INDEX offspring_batches_clutch_idx ON offspring_batches (clutch_id);
CREATE INDEX animals_origin_clutch_idx ON animals (origin_clutch_id);
CREATE INDEX animals_origin_batch_idx ON animals (origin_offspring_batch_id);
CREATE INDEX inventory_items_user_active_idx ON inventory_items (user_id, is_active);
CREATE INDEX stock_movements_item_occurred_idx ON stock_movements (item_id, occurred_at DESC);
CREATE INDEX documents_user_created_idx ON documents (user_id, created_at DESC);
CREATE INDEX documents_animal_idx ON documents (animal_id);
CREATE INDEX documents_cycle_idx ON documents (cycle_id);
CREATE INDEX public_shares_user_enabled_idx ON public_shares (user_id, is_enabled);
CREATE INDEX import_jobs_user_created_idx ON import_jobs (user_id, created_at DESC);
CREATE INDEX import_jobs_expiry_idx ON import_jobs (expires_at);
CREATE INDEX export_jobs_user_created_idx ON export_jobs (user_id, created_at DESC);
CREATE INDEX export_jobs_expiry_idx ON export_jobs (expires_at);
CREATE INDEX import_jobs_status_created_idx ON import_jobs (status, created_at);
CREATE INDEX export_jobs_status_created_idx ON export_jobs (status, created_at);
CREATE INDEX api_rate_limit_buckets_reset_idx ON api_rate_limit_buckets (reset_at);
CREATE INDEX animal_genetic_traits_animal_idx ON animal_genetic_traits (animal_id);
CREATE INDEX animal_genetic_traits_history_idx ON animal_genetic_traits (animal_id, trait_name, created_at);
CREATE INDEX animal_genetic_traits_source_animal_idx ON animal_genetic_traits (source_animal_id);
CREATE INDEX finance_entries_user_date_idx ON finance_entries (user_id, occurred_on DESC);
CREATE INDEX finance_entries_user_category_date_idx ON finance_entries (user_id, category, occurred_on DESC);
CREATE INDEX finance_entries_animal_idx ON finance_entries (animal_id);
CREATE INDEX finance_entries_document_idx ON finance_entries (document_id);
CREATE INDEX audit_events_user_created_idx ON audit_events (user_id, created_at DESC);
CREATE INDEX audit_events_entity_idx ON audit_events (entity_type, entity_id);
CREATE INDEX audit_events_request_idx ON audit_events (request_id) WHERE request_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 10. Trigger per mantenere updated_at sulle tabelle modificabili
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vivarqo_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'users', 'animals', 'feeding_sessions', 'feeding_entries',
        'weight_measurements', 'shed_records', 'animal_notes',
        'reminder_rules', 'tasks', 'notification_preferences',
        'reproduction_cycles', 'reproductive_events', 'clutches', 'eggs',
        'offspring_batches', 'inventory_items', 'public_shares',
        'import_jobs', 'export_jobs', 'animal_genetic_traits',
        'finance_entries', 'subscriptions'
    ]
    LOOP
        EXECUTE format(
            'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION vivarqo_set_updated_at()',
            table_name || '_set_updated_at', table_name
        );
    END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 11. Controlli di coerenza multi-account per relazioni sensibili
--     Il backend deve comunque verificare l'autorizzazione su ogni richiesta.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vivarqo_check_tenant_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    owner_id UUID;
    other_owner_id UUID;
BEGIN
    IF TG_TABLE_NAME = 'feeding_entries' THEN
        SELECT user_id INTO owner_id FROM feeding_sessions WHERE id = NEW.session_id;
        SELECT user_id INTO other_owner_id FROM animals WHERE id = NEW.animal_id;
        IF owner_id IS NULL OR other_owner_id IS NULL OR owner_id <> other_owner_id THEN
            RAISE EXCEPTION 'feeding entry session and animal must belong to the same account';
        END IF;

    ELSIF TG_TABLE_NAME = 'reminder_rules' THEN
        IF NEW.animal_id IS NOT NULL THEN
            SELECT user_id INTO owner_id FROM animals WHERE id = NEW.animal_id;
            IF owner_id IS NULL OR owner_id <> NEW.user_id THEN
                RAISE EXCEPTION 'reminder rule animal must belong to the same account';
            END IF;
        END IF;

    ELSIF TG_TABLE_NAME = 'tasks' THEN
        IF NEW.animal_id IS NOT NULL THEN
            SELECT user_id INTO owner_id FROM animals WHERE id = NEW.animal_id;
            IF owner_id IS NULL OR owner_id <> NEW.user_id THEN
                RAISE EXCEPTION 'task animal must belong to the same account';
            END IF;
        END IF;
        IF NEW.reminder_rule_id IS NOT NULL THEN
            SELECT user_id INTO owner_id FROM reminder_rules WHERE id = NEW.reminder_rule_id;
            IF owner_id IS NULL OR owner_id <> NEW.user_id THEN
                RAISE EXCEPTION 'task reminder rule must belong to the same account';
            END IF;
        END IF;

    ELSIF TG_TABLE_NAME = 'reproduction_cycles' THEN
        IF NEW.parent_a_animal_id IS NOT NULL THEN
            SELECT user_id INTO owner_id FROM animals WHERE id = NEW.parent_a_animal_id;
            IF owner_id IS NULL OR owner_id <> NEW.user_id THEN
                RAISE EXCEPTION 'reproduction parent A must belong to the same account';
            END IF;
        END IF;
        IF NEW.parent_b_animal_id IS NOT NULL THEN
            SELECT user_id INTO owner_id FROM animals WHERE id = NEW.parent_b_animal_id;
            IF owner_id IS NULL OR owner_id <> NEW.user_id THEN
                RAISE EXCEPTION 'reproduction parent B must belong to the same account';
            END IF;
        END IF;

    ELSIF TG_TABLE_NAME = 'reproductive_events' THEN
        IF NEW.animal_id IS NOT NULL THEN
            SELECT rc.user_id INTO owner_id
            FROM reproduction_cycles rc WHERE rc.id = NEW.cycle_id;
            SELECT a.user_id INTO other_owner_id
            FROM animals a WHERE a.id = NEW.animal_id;
            IF owner_id IS NULL OR other_owner_id IS NULL OR owner_id <> other_owner_id THEN
                RAISE EXCEPTION 'reproductive event animal and cycle must belong to the same account';
            END IF;
        END IF;

    ELSIF TG_TABLE_NAME = 'public_shares' THEN
        SELECT user_id INTO owner_id FROM animals WHERE id = NEW.animal_id;
        IF owner_id IS NULL OR owner_id <> NEW.user_id THEN
            RAISE EXCEPTION 'public share animal must belong to the same account';
        END IF;

    ELSIF TG_TABLE_NAME = 'documents' THEN
        IF NEW.animal_id IS NOT NULL THEN
            SELECT user_id INTO owner_id FROM animals WHERE id = NEW.animal_id;
            IF owner_id IS NULL OR owner_id <> NEW.user_id THEN
                RAISE EXCEPTION 'document animal must belong to the same account';
            END IF;
        END IF;
        IF NEW.cycle_id IS NOT NULL THEN
            SELECT user_id INTO owner_id FROM reproduction_cycles WHERE id = NEW.cycle_id;
            IF owner_id IS NULL OR owner_id <> NEW.user_id THEN
                RAISE EXCEPTION 'document reproduction cycle must belong to the same account';
            END IF;
        END IF;

    ELSIF TG_TABLE_NAME = 'finance_entries' THEN
        IF NEW.animal_id IS NOT NULL THEN
            SELECT user_id INTO owner_id FROM animals WHERE id = NEW.animal_id;
            IF owner_id IS NULL OR owner_id <> NEW.user_id THEN
                RAISE EXCEPTION 'finance entry animal must belong to the same account';
            END IF;
        END IF;
        IF NEW.document_id IS NOT NULL THEN
            SELECT user_id INTO owner_id FROM documents WHERE id = NEW.document_id;
            IF owner_id IS NULL OR owner_id <> NEW.user_id THEN
                RAISE EXCEPTION 'finance entry document must belong to the same account';
            END IF;
        END IF;

    ELSIF TG_TABLE_NAME = 'animal_genetic_traits' THEN
        SELECT user_id INTO owner_id FROM animals WHERE id = NEW.animal_id;
        IF owner_id IS NULL THEN
            RAISE EXCEPTION 'genetic trait animal does not exist';
        END IF;
        IF NEW.source_animal_id IS NOT NULL THEN
            SELECT user_id INTO other_owner_id FROM animals WHERE id = NEW.source_animal_id;
            IF other_owner_id IS NULL OR owner_id <> other_owner_id THEN
                RAISE EXCEPTION 'genetic trait source animal must belong to the same account';
            END IF;
        END IF;

    ELSIF TG_TABLE_NAME = 'animals' THEN
        IF NEW.origin_clutch_id IS NOT NULL THEN
            SELECT rc.user_id INTO owner_id
            FROM clutches c JOIN reproduction_cycles rc ON rc.id = c.cycle_id
            WHERE c.id = NEW.origin_clutch_id;
            IF owner_id IS NULL OR owner_id <> NEW.user_id THEN
                RAISE EXCEPTION 'origin clutch must belong to the same account';
            END IF;
        END IF;
        IF NEW.origin_offspring_batch_id IS NOT NULL THEN
            SELECT user_id INTO owner_id FROM reproduction_cycles rc
            JOIN offspring_batches ob ON ob.cycle_id = rc.id
            WHERE ob.id = NEW.origin_offspring_batch_id;
            IF owner_id IS NULL OR owner_id <> NEW.user_id THEN
                RAISE EXCEPTION 'origin offspring batch must belong to the same account';
            END IF;
        END IF;

    ELSIF TG_TABLE_NAME = 'offspring_batches' THEN
        IF NEW.clutch_id IS NOT NULL THEN
            SELECT cycle_id INTO owner_id FROM clutches WHERE id = NEW.clutch_id;
            IF owner_id IS NULL OR owner_id <> NEW.cycle_id THEN
                RAISE EXCEPTION 'offspring batch clutch must belong to the same reproduction cycle';
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER feeding_entries_tenant_guard
    BEFORE INSERT OR UPDATE ON feeding_entries
    FOR EACH ROW EXECUTE FUNCTION vivarqo_check_tenant_consistency();
CREATE TRIGGER reminder_rules_tenant_guard
    BEFORE INSERT OR UPDATE ON reminder_rules
    FOR EACH ROW EXECUTE FUNCTION vivarqo_check_tenant_consistency();
CREATE TRIGGER tasks_tenant_guard
    BEFORE INSERT OR UPDATE ON tasks
    FOR EACH ROW EXECUTE FUNCTION vivarqo_check_tenant_consistency();
CREATE TRIGGER reproduction_cycles_tenant_guard
    BEFORE INSERT OR UPDATE ON reproduction_cycles
    FOR EACH ROW EXECUTE FUNCTION vivarqo_check_tenant_consistency();
CREATE TRIGGER reproductive_events_tenant_guard
    BEFORE INSERT OR UPDATE ON reproductive_events
    FOR EACH ROW EXECUTE FUNCTION vivarqo_check_tenant_consistency();
CREATE TRIGGER public_shares_tenant_guard
    BEFORE INSERT OR UPDATE ON public_shares
    FOR EACH ROW EXECUTE FUNCTION vivarqo_check_tenant_consistency();
CREATE TRIGGER documents_tenant_guard
    BEFORE INSERT OR UPDATE ON documents
    FOR EACH ROW EXECUTE FUNCTION vivarqo_check_tenant_consistency();
CREATE TRIGGER finance_entries_tenant_guard
    BEFORE INSERT OR UPDATE ON finance_entries
    FOR EACH ROW EXECUTE FUNCTION vivarqo_check_tenant_consistency();
CREATE TRIGGER animal_genetic_traits_tenant_guard
    BEFORE INSERT OR UPDATE ON animal_genetic_traits
    FOR EACH ROW EXECUTE FUNCTION vivarqo_check_tenant_consistency();
CREATE TRIGGER animals_origin_tenant_guard
    BEFORE INSERT OR UPDATE ON animals
    FOR EACH ROW EXECUTE FUNCTION vivarqo_check_tenant_consistency();
CREATE TRIGGER offspring_batches_clutch_guard
    BEFORE INSERT OR UPDATE ON offspring_batches
    FOR EACH ROW EXECUTE FUNCTION vivarqo_check_tenant_consistency();

-- ---------------------------------------------------------------------------
-- 12. Allineamento consolidato alle migrazioni successive al primo schema
--     Questo file deve rappresentare lo stato finale delle migrazioni versionate.
-- ---------------------------------------------------------------------------

-- Le rettifiche inventariali possono portare lo stock esattamente a zero.
ALTER TABLE stock_movements
    DROP CONSTRAINT IF EXISTS stock_movements_quantity_check;
ALTER TABLE stock_movements
    ADD CONSTRAINT stock_movements_quantity_check
    CHECK (quantity >= 0 AND (movement_type = 'adjustment' OR quantity > 0));

-- Preferenze persistenti per account.
CREATE TABLE user_preferences (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    weight_unit           VARCHAR(8) NOT NULL DEFAULT 'g',
    temperature_unit      VARCHAR(8) NOT NULL DEFAULT 'c',
    date_format           VARCHAR(16) NOT NULL DEFAULT 'locale',
    default_landing_page  VARCHAR(40) NOT NULL DEFAULT 'today',
    compact_tables        BOOLEAN NOT NULL DEFAULT FALSE,
    dashboard_layout      JSONB NOT NULL DEFAULT '{}'::jsonb,
    theme                 VARCHAR(16) NOT NULL DEFAULT 'system',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE account_configurations (
    user_id           UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    animal_categories VARCHAR(24)[] NOT NULL DEFAULT ARRAY[]::VARCHAR(24)[],
    configured_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX account_configurations_configured_at_idx
    ON account_configurations (configured_at);

-- Outbox persistente dei tentativi di consegna Web Push.
CREATE TABLE push_delivery_attempts (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notification_id       UUID REFERENCES notifications(id) ON DELETE SET NULL,
    push_subscription_id  UUID REFERENCES push_subscriptions(id) ON DELETE SET NULL,
    delivery_key          VARCHAR(180) NOT NULL,
    attempt_number        INTEGER NOT NULL,
    status                VARCHAR(24) NOT NULL DEFAULT 'queued',
    scheduled_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    attempted_at          TIMESTAMPTZ,
    sent_at               TIMESTAMPTZ,
    next_attempt_at       TIMESTAMPTZ,
    http_status           INTEGER,
    error_code            VARCHAR(80),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX push_delivery_attempts_delivery_attempt_unique
    ON push_delivery_attempts (delivery_key, attempt_number);
CREATE INDEX push_delivery_attempts_status_scheduled_idx
    ON push_delivery_attempts (status, scheduled_at);
CREATE INDEX push_delivery_attempts_user_created_idx
    ON push_delivery_attempts (user_id, created_at DESC);
CREATE INDEX push_delivery_attempts_notification_idx
    ON push_delivery_attempts (notification_id);

-- Limiti di tentativi e lease dei job asincroni.
ALTER TABLE import_jobs
    ADD CONSTRAINT import_jobs_attempts_nonnegative CHECK (attempts >= 0);
ALTER TABLE export_jobs
    ADD CONSTRAINT export_jobs_attempts_nonnegative CHECK (attempts >= 0);

-- Eliminazione documenti: soft-delete DB + outbox con retry storage.
CREATE TABLE document_deletion_jobs (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_id           UUID NOT NULL UNIQUE REFERENCES documents(id) ON DELETE CASCADE,
    storage_key           TEXT NOT NULL,
    status                VARCHAR(20) NOT NULL DEFAULT 'queued',
    attempts              INTEGER NOT NULL DEFAULT 0,
    next_attempt_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processing_started_at TIMESTAMPTZ,
    lease_token           UUID,
    last_error_code       VARCHAR(80),
    completed_at          TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT document_deletion_jobs_attempts_nonnegative CHECK (attempts >= 0),
    CONSTRAINT document_deletion_jobs_status_check CHECK (status IN ('queued', 'processing', 'completed', 'failed'))
);
CREATE INDEX document_deletion_jobs_status_next_attempt_idx
    ON document_deletion_jobs (status, next_attempt_at);
CREATE INDEX document_deletion_jobs_user_created_idx
    ON document_deletion_jobs (user_id, created_at DESC);


-- Tenant guard for the document deletion outbox: owner and storage key must
-- match the soft-deleted document referenced by the job.
CREATE OR REPLACE FUNCTION vivarqo_check_document_deletion_tenant_consistency()
RETURNS TRIGGER AS $vivarqo$
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
$vivarqo$ LANGUAGE plpgsql;

CREATE TRIGGER document_deletion_jobs_tenant_guard
    BEFORE INSERT OR UPDATE ON document_deletion_jobs
    FOR EACH ROW EXECUTE FUNCTION vivarqo_check_document_deletion_tenant_consistency();


-- Accettazione dei termini e genealogia degli animali.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ(6),
    ADD COLUMN IF NOT EXISTS terms_version VARCHAR(32);

ALTER TABLE animals
    ADD COLUMN IF NOT EXISTS mother_animal_id UUID,
    ADD COLUMN IF NOT EXISTS father_animal_id UUID,
    ADD COLUMN IF NOT EXISTS mother_description VARCHAR(240),
    ADD COLUMN IF NOT EXISTS father_description VARCHAR(240);

DO $vivarqo$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'animals_mother_animal_fk') THEN
        ALTER TABLE animals ADD CONSTRAINT animals_mother_animal_fk
            FOREIGN KEY (mother_animal_id) REFERENCES animals(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'animals_father_animal_fk') THEN
        ALTER TABLE animals ADD CONSTRAINT animals_father_animal_fk
            FOREIGN KEY (father_animal_id) REFERENCES animals(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'animals_mother_not_self') THEN
        ALTER TABLE animals ADD CONSTRAINT animals_mother_not_self
            CHECK (mother_animal_id IS NULL OR mother_animal_id <> id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'animals_father_not_self') THEN
        ALTER TABLE animals ADD CONSTRAINT animals_father_not_self
            CHECK (father_animal_id IS NULL OR father_animal_id <> id);
    END IF;
END
$vivarqo$;

CREATE INDEX IF NOT EXISTS animals_mother_idx ON animals(mother_animal_id) WHERE mother_animal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS animals_father_idx ON animals(father_animal_id) WHERE father_animal_id IS NOT NULL;

-- Parametri obiettivo e intervallo di controllo delle covate.
ALTER TABLE clutches
    ADD COLUMN IF NOT EXISTS target_temperature_min_c NUMERIC(5,2),
    ADD COLUMN IF NOT EXISTS target_temperature_max_c NUMERIC(5,2),
    ADD COLUMN IF NOT EXISTS target_humidity_min_pct NUMERIC(5,2),
    ADD COLUMN IF NOT EXISTS target_humidity_max_pct NUMERIC(5,2),
    ADD COLUMN IF NOT EXISTS check_interval_hours INTEGER;

DO $vivarqo$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clutches_temperature_range_check') THEN
        ALTER TABLE clutches ADD CONSTRAINT clutches_temperature_range_check
            CHECK (target_temperature_min_c IS NULL OR target_temperature_max_c IS NULL OR target_temperature_min_c <= target_temperature_max_c);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clutches_humidity_range_check') THEN
        ALTER TABLE clutches ADD CONSTRAINT clutches_humidity_range_check
            CHECK (target_humidity_min_pct IS NULL OR target_humidity_max_pct IS NULL OR target_humidity_min_pct <= target_humidity_max_pct);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clutches_check_interval_hours_check') THEN
        ALTER TABLE clutches ADD CONSTRAINT clutches_check_interval_hours_check
            CHECK (check_interval_hours IS NULL OR check_interval_hours BETWEEN 1 AND 720);
    END IF;
END
$vivarqo$;

-- Ciclo di vita e collegamento individuale tra uova e piccoli.
ALTER TABLE eggs
    ADD COLUMN IF NOT EXISTS hatched_at DATE,
    ADD COLUMN IF NOT EXISTS offspring_animal_id UUID;

DO $vivarqo$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'eggs_offspring_animal_id_fkey') THEN
        ALTER TABLE eggs ADD CONSTRAINT eggs_offspring_animal_id_fkey
            FOREIGN KEY (offspring_animal_id) REFERENCES animals(id) ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END
$vivarqo$;

CREATE UNIQUE INDEX IF NOT EXISTS eggs_offspring_animal_id_key ON eggs(offspring_animal_id);
CREATE INDEX IF NOT EXISTS eggs_status_idx ON eggs(status);

CREATE TABLE IF NOT EXISTS egg_history (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    egg_id UUID NOT NULL,
    status VARCHAR(20) NOT NULL,
    occurred_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    notes TEXT,
    CONSTRAINT egg_history_pkey PRIMARY KEY (id),
    CONSTRAINT egg_history_egg_id_fkey FOREIGN KEY (egg_id) REFERENCES eggs(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS egg_history_egg_occurred_idx ON egg_history(egg_id, occurred_at DESC);

-- La categoria incubation viene usata dai task automatici dei controlli.
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_category_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_category_check
    CHECK (category IN ('feeding', 'weighing', 'shed_check', 'cleaning', 'reproduction', 'incubation', 'document', 'inventory', 'custom'));


-- ---------------------------------------------------------------------------
-- 14. Strutture riproduttive, incubazione e cura sanitaria (baseline consolidata)
-- Queste definizioni riflettono le migrazioni successive alla baseline iniziale.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS incubators (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    identifier VARCHAR(80),
    capacity INTEGER CHECK (capacity IS NULL OR capacity > 0),
    notes TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    maintenance_interval_days INTEGER,
    next_maintenance_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS incubators_user_name_unique ON incubators(user_id, name);
CREATE INDEX IF NOT EXISTS incubators_user_active_idx ON incubators(user_id, is_active);

ALTER TABLE clutches ADD COLUMN IF NOT EXISTS target_temperature_min_c NUMERIC(5,2);
ALTER TABLE clutches ADD COLUMN IF NOT EXISTS target_temperature_max_c NUMERIC(5,2);
ALTER TABLE clutches ADD COLUMN IF NOT EXISTS target_humidity_min_pct NUMERIC(5,2);
ALTER TABLE clutches ADD COLUMN IF NOT EXISTS target_humidity_max_pct NUMERIC(5,2);
ALTER TABLE clutches ADD COLUMN IF NOT EXISTS check_interval_hours INTEGER;
ALTER TABLE clutches ADD COLUMN IF NOT EXISTS incubator_id UUID;
DO $$ BEGIN
    ALTER TABLE clutches ADD CONSTRAINT clutches_incubator_id_fkey
      FOREIGN KEY (incubator_id) REFERENCES incubators(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE clutches ADD CONSTRAINT clutches_temperature_range_check
      CHECK (target_temperature_min_c IS NULL OR target_temperature_max_c IS NULL OR target_temperature_min_c <= target_temperature_max_c);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE clutches ADD CONSTRAINT clutches_humidity_range_check
      CHECK (target_humidity_min_pct IS NULL OR target_humidity_max_pct IS NULL OR target_humidity_min_pct <= target_humidity_max_pct);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE clutches ADD CONSTRAINT clutches_check_interval_hours_check
      CHECK (check_interval_hours IS NULL OR check_interval_hours BETWEEN 1 AND 720);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS clutches_incubator_idx ON clutches(incubator_id);

ALTER TABLE eggs ADD COLUMN IF NOT EXISTS hatched_at DATE;
ALTER TABLE eggs ADD COLUMN IF NOT EXISTS offspring_animal_id UUID;
ALTER TABLE eggs ADD COLUMN IF NOT EXISTS incubator_id UUID;
ALTER TABLE eggs ADD COLUMN IF NOT EXISTS incubator_position VARCHAR(80);
ALTER TABLE eggs ADD COLUMN IF NOT EXISTS laid_at TIMESTAMPTZ;
ALTER TABLE eggs ADD COLUMN IF NOT EXISTS expected_hatch_at DATE;
ALTER TABLE eggs ADD COLUMN IF NOT EXISTS photo_key TEXT;
DO $$ BEGIN
    ALTER TABLE eggs ADD CONSTRAINT eggs_offspring_animal_id_fkey
      FOREIGN KEY (offspring_animal_id) REFERENCES animals(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE eggs ADD CONSTRAINT eggs_incubator_id_fkey
      FOREIGN KEY (incubator_id) REFERENCES incubators(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS eggs_offspring_animal_id_key ON eggs(offspring_animal_id) WHERE offspring_animal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS eggs_status_idx ON eggs(status);
CREATE INDEX IF NOT EXISTS eggs_incubator_position_idx ON eggs(incubator_id, incubator_position);

CREATE TABLE IF NOT EXISTS hatchling_care (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    animal_id UUID NOT NULL UNIQUE REFERENCES animals(id) ON DELETE CASCADE,
    first_feeding_at TIMESTAMPTZ,
    first_feeding_accepted BOOLEAN,
    first_shed_at TIMESTAMPTZ,
    ready_for_rehoming_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE hatchling_care ADD COLUMN IF NOT EXISTS health_status VARCHAR(24) NOT NULL DEFAULT 'unknown';
ALTER TABLE hatchling_care ADD COLUMN IF NOT EXISTS health_notes TEXT;
ALTER TABLE hatchling_care ADD COLUMN IF NOT EXISTS availability_status VARCHAR(24) NOT NULL DEFAULT 'not_available';
DO $$ BEGIN
  ALTER TABLE hatchling_care ADD CONSTRAINT hatchling_care_availability_status_check
    CHECK (availability_status IN ('not_available', 'available', 'reserved', 'transferred'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS egg_measurements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    egg_id UUID NOT NULL REFERENCES eggs(id) ON DELETE CASCADE,
    measured_at TIMESTAMPTZ(6) NOT NULL,
    weight_g NUMERIC(10,2) NOT NULL CHECK (weight_g > 0),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS egg_measurements_egg_measured_idx ON egg_measurements(egg_id, measured_at DESC);

CREATE TABLE IF NOT EXISTS egg_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    egg_id UUID NOT NULL REFERENCES eggs(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL,
    occurred_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    notes TEXT
);
CREATE INDEX IF NOT EXISTS egg_history_egg_occurred_idx ON egg_history(egg_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS egg_incubator_transfers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    egg_id UUID NOT NULL REFERENCES eggs(id) ON DELETE CASCADE,
    from_incubator_id UUID REFERENCES incubators(id) ON DELETE SET NULL,
    to_incubator_id UUID REFERENCES incubators(id) ON DELETE SET NULL,
    from_position VARCHAR(80),
    to_position VARCHAR(80),
    transferred_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    notes TEXT
);
CREATE INDEX IF NOT EXISTS egg_incubator_transfers_egg_date_idx ON egg_incubator_transfers(egg_id, transferred_at DESC);

CREATE TABLE IF NOT EXISTS clutch_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clutch_id UUID NOT NULL REFERENCES clutches(id) ON DELETE CASCADE,
    action VARCHAR(40) NOT NULL,
    occurred_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    details JSONB,
    notes TEXT
);
CREATE INDEX IF NOT EXISTS clutch_history_clutch_occurred_idx ON clutch_history(clutch_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS incubator_maintenance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incubator_id UUID NOT NULL REFERENCES incubators(id) ON DELETE CASCADE,
    occurred_at TIMESTAMPTZ(6) NOT NULL,
    event_type VARCHAR(32) NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS incubator_maintenance_incubator_date_idx ON incubator_maintenance(incubator_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS species_breeding_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    species VARCHAR(160) NOT NULL,
    female_min_age_months INTEGER CHECK (female_min_age_months IS NULL OR female_min_age_months >= 0),
    male_min_age_months INTEGER CHECK (male_min_age_months IS NULL OR male_min_age_months >= 0),
    female_min_weight_g NUMERIC(10,2) CHECK (female_min_weight_g IS NULL OR female_min_weight_g > 0),
    male_min_weight_g NUMERIC(10,2) CHECK (male_min_weight_g IS NULL OR male_min_weight_g > 0),
    notes TEXT,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS species_breeding_profiles_user_species_unique ON species_breeding_profiles(user_id, species);
CREATE INDEX IF NOT EXISTS species_breeding_profiles_user_idx ON species_breeding_profiles(user_id);

ALTER TABLE animal_genetic_traits ADD COLUMN IF NOT EXISTS inheritance_mode VARCHAR(32);
ALTER TABLE animal_genetic_traits ADD COLUMN IF NOT EXISTS genotype VARCHAR(32);
ALTER TABLE animal_genetic_traits ADD COLUMN IF NOT EXISTS phenotype_rules JSONB;
ALTER TABLE animal_genetic_traits ADD COLUMN IF NOT EXISTS certainty VARCHAR(24) NOT NULL DEFAULT 'unverified';


-- Cessioni animali e collegamento idempotente al ricavo finanziario.
CREATE TABLE IF NOT EXISTS animal_transfers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    animal_id UUID NOT NULL REFERENCES animals(id) ON DELETE RESTRICT,
    transfer_type VARCHAR(16) NOT NULL CHECK (transfer_type IN ('sale','gift','breeder_transfer')),
    recipient_name VARCHAR(160) NOT NULL,
    recipient_email VARCHAR(254),
    recipient_breeder VARCHAR(160),
    transferred_at TIMESTAMPTZ(6) NOT NULL,
    price_cents BIGINT CHECK (price_cents IS NULL OR price_cents >= 0),
    notes TEXT,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS animal_transfers_user_date_idx ON animal_transfers(user_id, transferred_at DESC);
CREATE INDEX IF NOT EXISTS animal_transfers_animal_date_idx ON animal_transfers(animal_id, transferred_at DESC);
ALTER TABLE finance_entries ADD COLUMN IF NOT EXISTS source_transfer_id UUID;
DO $$ BEGIN
  ALTER TABLE finance_entries ADD CONSTRAINT finance_entries_source_transfer_fk
    FOREIGN KEY (source_transfer_id) REFERENCES animal_transfers(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS finance_entries_source_transfer_unique
  ON finance_entries(source_transfer_id) WHERE source_transfer_id IS NOT NULL;

ALTER TABLE finance_entries ADD COLUMN IF NOT EXISTS source_stock_movement_id UUID;
DO $$ BEGIN
  ALTER TABLE finance_entries ADD CONSTRAINT finance_entries_source_stock_movement_fk
    FOREIGN KEY (source_stock_movement_id) REFERENCES stock_movements(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS finance_entries_source_stock_movement_unique
  ON finance_entries(source_stock_movement_id) WHERE source_stock_movement_id IS NOT NULL;


DO $schema$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'export_jobs_modules_valid') THEN
    ALTER TABLE export_jobs ADD CONSTRAINT export_jobs_modules_valid CHECK (
      cardinality(modules) BETWEEN 1 AND 5
      AND modules <@ ARRAY['animals', 'feedings', 'reproduction', 'finance', 'inventory']::TEXT[]
    );
  END IF;
END $schema$;


-- ---------------------------------------------------------------------------
-- 2b. Multi-domain animal and habitat management
-- ---------------------------------------------------------------------------
ALTER TABLE animals
  ADD COLUMN category VARCHAR(24) NOT NULL DEFAULT 'reptiles',
  ADD COLUMN domain_profile JSONB;
CREATE INDEX animals_user_category_status_idx ON animals (user_id, category, status);

CREATE TABLE aquariums (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  water_type VARCHAR(16) NOT NULL CHECK (water_type IN ('freshwater', 'saltwater', 'brackish')),
  volume_liters NUMERIC(10,2) NOT NULL CHECK (volume_liters > 0),
  setup_date DATE,
  location VARCHAR(160),
  notes TEXT,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX aquariums_user_archived_name_idx ON aquariums (user_id, archived_at, name);

CREATE TABLE aquarium_water_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aquarium_id UUID NOT NULL REFERENCES aquariums(id) ON DELETE CASCADE,
  measured_at TIMESTAMPTZ NOT NULL,
  temperature_c NUMERIC(5,2) CHECK (temperature_c IS NULL OR temperature_c BETWEEN -5 AND 60),
  ph NUMERIC(4,2) CHECK (ph IS NULL OR ph BETWEEN 0 AND 14),
  gh_dkh NUMERIC(6,2) CHECK (gh_dkh IS NULL OR gh_dkh >= 0),
  kh_dkh NUMERIC(6,2) CHECK (kh_dkh IS NULL OR kh_dkh >= 0),
  ammonia_mg_l NUMERIC(8,4) CHECK (ammonia_mg_l IS NULL OR ammonia_mg_l >= 0),
  nitrite_mg_l NUMERIC(8,4) CHECK (nitrite_mg_l IS NULL OR nitrite_mg_l >= 0),
  nitrate_mg_l NUMERIC(8,3) CHECK (nitrate_mg_l IS NULL OR nitrate_mg_l >= 0),
  salinity_ppt NUMERIC(7,3) CHECK (salinity_ppt IS NULL OR salinity_ppt >= 0),
  tds_ppm INTEGER CHECK (tds_ppm IS NULL OR tds_ppm >= 0),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX aquarium_water_readings_aquarium_measured_idx ON aquarium_water_readings (aquarium_id, measured_at DESC);

CREATE TABLE aviaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  environment VARCHAR(16) NOT NULL CHECK (environment IN ('indoor', 'outdoor', 'mixed')),
  location VARCHAR(160),
  capacity INTEGER CHECK (capacity IS NULL OR capacity > 0),
  notes TEXT,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX aviaries_user_archived_name_idx ON aviaries (user_id, archived_at, name);

CREATE TABLE aviary_birds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aviary_id UUID NOT NULL REFERENCES aviaries(id) ON DELETE CASCADE,
  animal_id UUID NOT NULL UNIQUE REFERENCES animals(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX aviary_birds_aviary_idx ON aviary_birds (aviary_id);

COMMIT;

-- Verifica rapida dopo l'esecuzione:
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
-- ORDER BY table_name;

-- Animal management hierarchy and history
ALTER TABLE animals ADD COLUMN location_id uuid;
ALTER TABLE animals ADD COLUMN qr_token varchar(64);
CREATE UNIQUE INDEX animals_qr_token_unique ON animals(qr_token);
CREATE TABLE animal_locations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 parent_id uuid REFERENCES animal_locations(id) ON DELETE RESTRICT, kind varchar(16) NOT NULL CHECK(kind IN ('room','rack','shelf','container')),
 name varchar(120) NOT NULL, sort_order integer NOT NULL DEFAULT 0, created_at timestamptz(6) NOT NULL DEFAULT now(), updated_at timestamptz(6) NOT NULL DEFAULT now(),
 CONSTRAINT animal_locations_id_user_id_unique UNIQUE(id,user_id)
);
CREATE INDEX animal_locations_user_parent_sort_idx ON animal_locations(user_id,parent_id,sort_order);
CREATE INDEX animal_locations_user_kind_idx ON animal_locations(user_id,kind);
ALTER TABLE animals ADD CONSTRAINT animals_location_id_fkey FOREIGN KEY(location_id) REFERENCES animal_locations(id) ON DELETE SET NULL;
CREATE TABLE animal_location_moves (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 animal_id uuid NOT NULL REFERENCES animals(id) ON DELETE CASCADE, from_location_id uuid REFERENCES animal_locations(id) ON DELETE SET NULL,
 to_location_id uuid REFERENCES animal_locations(id) ON DELETE SET NULL, moved_at timestamptz(6) NOT NULL DEFAULT now(), reason varchar(500)
);
CREATE INDEX animal_location_moves_user_moved_idx ON animal_location_moves(user_id,moved_at DESC);
CREATE INDEX animal_location_moves_animal_moved_idx ON animal_location_moves(animal_id,moved_at DESC);
CREATE TABLE saved_animal_filters (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name varchar(80) NOT NULL, filters jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz(6) NOT NULL DEFAULT now(),
 updated_at timestamptz(6) NOT NULL DEFAULT now(), CONSTRAINT saved_animal_filters_user_name_unique UNIQUE(user_id,name)
);
CREATE INDEX saved_animal_filters_user_updated_idx ON saved_animal_filters(user_id,updated_at DESC);
CREATE TABLE IF NOT EXISTS animal_transfers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 animal_id uuid NOT NULL REFERENCES animals(id) ON DELETE RESTRICT, transfer_type varchar(16) NOT NULL CHECK(transfer_type IN ('sale','gift','breeder_transfer')),
 recipient_name varchar(160) NOT NULL, recipient_email varchar(254), recipient_breeder varchar(160), transferred_at timestamptz(6) NOT NULL,
 price_cents bigint CHECK(price_cents IS NULL OR price_cents >= 0), notes text, created_at timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS animal_transfers_user_date_idx ON animal_transfers(user_id,transferred_at DESC);
CREATE INDEX IF NOT EXISTS animal_transfers_animal_date_idx ON animal_transfers(animal_id,transferred_at DESC);

-- ---------------------------------------------------------------------------
-- 9. Alimentazioni avanzate: intervalli, prede e scarico inventario
-- ---------------------------------------------------------------------------
ALTER TABLE animals
  ADD COLUMN IF NOT EXISTS feeding_interval_days INTEGER CHECK (feeding_interval_days IS NULL OR feeding_interval_days BETWEEN 1 AND 365);
ALTER TABLE feeding_entries
  ADD COLUMN IF NOT EXISTS prey_state VARCHAR(16) NOT NULL DEFAULT 'unknown' CHECK (prey_state IN ('unknown', 'frozen', 'thawed', 'live')),
  ADD COLUMN IF NOT EXISTS inventory_item_id UUID REFERENCES inventory_items(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS inventory_quantity NUMERIC(12,3) CHECK (inventory_quantity IS NULL OR inventory_quantity > 0),
  ADD COLUMN IF NOT EXISTS inventory_deducted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD CONSTRAINT feeding_entries_inventory_link_check CHECK ((inventory_item_id IS NULL AND inventory_quantity IS NULL AND inventory_deducted = FALSE) OR (inventory_item_id IS NOT NULL AND inventory_quantity IS NOT NULL));
CREATE INDEX IF NOT EXISTS feeding_entries_inventory_item_idx ON feeding_entries(inventory_item_id);
CREATE INDEX IF NOT EXISTS feeding_entries_animal_outcome_idx ON feeding_entries(animal_id, outcome);


-- ---------------------------------------------------------------------------
-- 10. Finance: reproductive links, budgets and recurring entries
-- ---------------------------------------------------------------------------
ALTER TABLE finance_entries
  ADD COLUMN IF NOT EXISTS reproduction_cycle_id UUID,
  ADD COLUMN IF NOT EXISTS clutch_id UUID,
  ADD COLUMN IF NOT EXISTS offspring_batch_id UUID,
  ADD COLUMN IF NOT EXISTS recurrence_id UUID;

CREATE TABLE IF NOT EXISTS finance_budgets (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  period VARCHAR(8) NOT NULL,
  period_start DATE NOT NULL,
  category VARCHAR(80) NOT NULL DEFAULT 'all',
  amount_cents BIGINT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'EUR',
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT finance_budgets_pkey PRIMARY KEY (id),
  CONSTRAINT finance_budgets_period_check CHECK (period IN ('month', 'year')),
  CONSTRAINT finance_budgets_amount_check CHECK (amount_cents > 0),
  CONSTRAINT finance_budgets_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS finance_budgets_scope_unique
  ON finance_budgets(user_id, period, period_start, category, currency);
CREATE INDEX IF NOT EXISTS finance_budgets_user_period_idx
  ON finance_budgets(user_id, period_start);

CREATE TABLE IF NOT EXISTS finance_recurrences (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  entry_type VARCHAR(12) NOT NULL,
  amount_cents BIGINT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'EUR',
  category VARCHAR(80) NOT NULL,
  description VARCHAR(240) NOT NULL,
  animal_id UUID,
  document_id UUID,
  frequency VARCHAR(12) NOT NULL,
  next_occurrence_on DATE NOT NULL,
  anchor_month INTEGER NOT NULL,
  anchor_day INTEGER NOT NULL,
  end_on DATE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT finance_recurrences_pkey PRIMARY KEY (id),
  CONSTRAINT finance_recurrences_entry_type_check CHECK (entry_type IN ('income', 'expense')),
  CONSTRAINT finance_recurrences_frequency_check CHECK (frequency IN ('monthly', 'yearly')),
  CONSTRAINT finance_recurrences_amount_check CHECK (amount_cents > 0),
  CONSTRAINT finance_recurrences_anchor_month_check CHECK (anchor_month BETWEEN 1 AND 12),
  CONSTRAINT finance_recurrences_anchor_day_check CHECK (anchor_day BETWEEN 1 AND 31),
  CONSTRAINT finance_recurrences_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT finance_recurrences_animal_fk FOREIGN KEY (animal_id) REFERENCES animals(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT finance_recurrences_document_fk FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
ALTER TABLE finance_recurrences
  ADD COLUMN IF NOT EXISTS anchor_month INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS anchor_day INTEGER NOT NULL DEFAULT 1;
UPDATE finance_recurrences
SET anchor_month = EXTRACT(MONTH FROM next_occurrence_on)::INTEGER,
    anchor_day = EXTRACT(DAY FROM next_occurrence_on)::INTEGER;
ALTER TABLE finance_recurrences
  ALTER COLUMN anchor_month DROP DEFAULT,
  ALTER COLUMN anchor_day DROP DEFAULT;
CREATE INDEX IF NOT EXISTS finance_recurrences_due_idx
  ON finance_recurrences(user_id, is_active, next_occurrence_on);

DO $finance_links$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_entries_cycle_fk') THEN
    ALTER TABLE finance_entries ADD CONSTRAINT finance_entries_cycle_fk
      FOREIGN KEY (reproduction_cycle_id) REFERENCES reproduction_cycles(id) ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_entries_clutch_fk') THEN
    ALTER TABLE finance_entries ADD CONSTRAINT finance_entries_clutch_fk
      FOREIGN KEY (clutch_id) REFERENCES clutches(id) ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_entries_offspring_batch_fk') THEN
    ALTER TABLE finance_entries ADD CONSTRAINT finance_entries_offspring_batch_fk
      FOREIGN KEY (offspring_batch_id) REFERENCES offspring_batches(id) ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_entries_recurrence_fk') THEN
    ALTER TABLE finance_entries ADD CONSTRAINT finance_entries_recurrence_fk
      FOREIGN KEY (recurrence_id) REFERENCES finance_recurrences(id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END;
$finance_links$;

CREATE UNIQUE INDEX IF NOT EXISTS finance_entries_recurrence_date_unique
  ON finance_entries(recurrence_id, occurred_on);
CREATE INDEX IF NOT EXISTS finance_entries_cycle_idx ON finance_entries(reproduction_cycle_id);
CREATE INDEX IF NOT EXISTS finance_entries_clutch_idx ON finance_entries(clutch_id);
CREATE INDEX IF NOT EXISTS finance_entries_offspring_batch_idx ON finance_entries(offspring_batch_id);
CREATE INDEX IF NOT EXISTS finance_entries_recurrence_idx ON finance_entries(recurrence_id);


-- Premium shared workspaces and collaborators.
ALTER TABLE user_sessions
  ADD COLUMN IF NOT EXISTS active_workspace_owner_id UUID;
DO $workspace_session_fk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_sessions_active_workspace_owner_id_fkey') THEN
    ALTER TABLE user_sessions ADD CONSTRAINT user_sessions_active_workspace_owner_id_fkey
      FOREIGN KEY (active_workspace_owner_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END;
$workspace_session_fk$;
CREATE INDEX IF NOT EXISTS user_sessions_active_workspace_idx ON user_sessions(active_workspace_owner_id);

CREATE TABLE IF NOT EXISTS workspace_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  collaborator_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  role VARCHAR(24) NOT NULL CHECK (role IN ('admin', 'operator', 'breeding', 'viewer')),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMPTZ(6),
  CONSTRAINT workspace_memberships_distinct_users_check CHECK (owner_user_id <> collaborator_user_id),
  CONSTRAINT workspace_memberships_owner_collaborator_key UNIQUE (owner_user_id, collaborator_user_id)
);
CREATE INDEX IF NOT EXISTS workspace_memberships_collaborator_revoked_idx
  ON workspace_memberships(collaborator_user_id, revoked_at);
CREATE INDEX IF NOT EXISTS workspace_memberships_owner_revoked_idx
  ON workspace_memberships(owner_user_id, revoked_at);

CREATE TABLE IF NOT EXISTS workspace_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  email CITEXT NOT NULL,
  token_hash VARCHAR(128) NOT NULL,
  role VARCHAR(24) NOT NULL CHECK (role IN ('admin', 'operator', 'breeding', 'viewer')),
  expires_at TIMESTAMPTZ(6) NOT NULL,
  accepted_at TIMESTAMPTZ(6),
  revoked_at TIMESTAMPTZ(6),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS workspace_invitations_token_hash_key
  ON workspace_invitations(token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS workspace_invitations_pending_owner_email_key
  ON workspace_invitations(owner_user_id, email)
  WHERE (accepted_at IS NULL) AND (revoked_at IS NULL);
CREATE INDEX IF NOT EXISTS workspace_invitations_owner_expires_idx
  ON workspace_invitations(owner_user_id, expires_at);
CREATE INDEX IF NOT EXISTS workspace_invitations_email_expires_idx
  ON workspace_invitations(email, expires_at);


-- Inventory lots and supplier tracking (2026-11).
-- Inventory lots, suppliers and expiry tracking.
CREATE TABLE IF NOT EXISTS inventory_suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(160) NOT NULL,
  email VARCHAR(254),
  phone VARCHAR(40),
  website VARCHAR(255),
  notes TEXT,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT inventory_suppliers_id_user_id_unique UNIQUE (id, user_id)
);
CREATE INDEX IF NOT EXISTS inventory_suppliers_user_name_idx ON inventory_suppliers(user_id, name);

CREATE TABLE IF NOT EXISTS inventory_lots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  supplier_id UUID REFERENCES inventory_suppliers(id) ON DELETE SET NULL,
  lot_code VARCHAR(120),
  quantity_received NUMERIC(12,3) NOT NULL CHECK (quantity_received > 0),
  quantity_remaining NUMERIC(12,3) NOT NULL CHECK (quantity_remaining >= 0 AND quantity_remaining <= quantity_received),
  unit_cost_cents INTEGER CHECK (unit_cost_cents IS NULL OR unit_cost_cents >= 0),
  purchased_at TIMESTAMPTZ(6) NOT NULL,
  expires_at DATE,
  notes TEXT,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS inventory_lots_item_expiry_idx ON inventory_lots(item_id, expires_at);
CREATE INDEX IF NOT EXISTS inventory_lots_supplier_purchased_idx ON inventory_lots(supplier_id, purchased_at DESC);
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS lot_id UUID REFERENCES inventory_lots(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS stock_movements_lot_idx ON stock_movements(lot_id);


-- Genetic catalog, trait history and named integrity constraints.
BEGIN;

ALTER TABLE animal_genetic_traits ADD COLUMN IF NOT EXISTS locus_id UUID;
ALTER TABLE animal_genetic_traits ADD COLUMN IF NOT EXISTS theoretical_genotype VARCHAR(64);
ALTER TABLE animal_genetic_traits ADD COLUMN IF NOT EXISTS observed_phenotype VARCHAR(240);
ALTER TABLE animal_genetic_traits ADD COLUMN IF NOT EXISTS confirmed_genotype VARCHAR(64);

CREATE TABLE IF NOT EXISTS genetic_genes (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  species VARCHAR(160) NOT NULL,
  symbol VARCHAR(40) NOT NULL,
  name VARCHAR(160) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT genetic_genes_pkey PRIMARY KEY (id),
  CONSTRAINT genetic_genes_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS genetic_genes_user_species_symbol_key ON genetic_genes(user_id, species, symbol);
CREATE INDEX IF NOT EXISTS genetic_genes_user_species_idx ON genetic_genes(user_id, species);

CREATE TABLE IF NOT EXISTS genetic_loci (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  gene_id UUID NOT NULL,
  symbol VARCHAR(40) NOT NULL,
  name VARCHAR(160) NOT NULL,
  inheritance_mode VARCHAR(32) NOT NULL,
  description TEXT,
  CONSTRAINT genetic_loci_pkey PRIMARY KEY (id),
  CONSTRAINT genetic_loci_gene_id_fkey FOREIGN KEY (gene_id) REFERENCES genetic_genes(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS genetic_loci_gene_symbol_key ON genetic_loci(gene_id, symbol);
CREATE INDEX IF NOT EXISTS genetic_loci_gene_idx ON genetic_loci(gene_id);

CREATE TABLE IF NOT EXISTS genetic_alleles (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  locus_id UUID NOT NULL,
  symbol VARCHAR(24) NOT NULL,
  name VARCHAR(120) NOT NULL,
  description TEXT,
  is_reference BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT genetic_alleles_pkey PRIMARY KEY (id),
  CONSTRAINT genetic_alleles_locus_id_fkey FOREIGN KEY (locus_id) REFERENCES genetic_loci(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS genetic_alleles_locus_symbol_key ON genetic_alleles(locus_id, symbol);
CREATE UNIQUE INDEX IF NOT EXISTS genetic_alleles_one_reference_per_locus_idx ON genetic_alleles(locus_id) WHERE is_reference = TRUE;
CREATE INDEX IF NOT EXISTS genetic_alleles_locus_idx ON genetic_alleles(locus_id);

CREATE TABLE IF NOT EXISTS animal_genetic_trait_history (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  trait_id UUID,
  animal_id UUID NOT NULL,
  changed_by UUID NOT NULL,
  snapshot JSONB NOT NULL,
  changed_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT animal_genetic_trait_history_pkey PRIMARY KEY (id),
  CONSTRAINT animal_genetic_trait_history_trait_id_fkey FOREIGN KEY (trait_id) REFERENCES animal_genetic_traits(id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT animal_genetic_trait_history_animal_id_fkey FOREIGN KEY (animal_id) REFERENCES animals(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT animal_genetic_trait_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS animal_genetic_history_animal_changed_idx ON animal_genetic_trait_history(animal_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS animal_genetic_history_trait_changed_idx ON animal_genetic_trait_history(trait_id, changed_at DESC);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'animal_genetic_traits_locus_id_fkey') THEN
    ALTER TABLE animal_genetic_traits ADD CONSTRAINT animal_genetic_traits_locus_id_fkey
      FOREIGN KEY (locus_id) REFERENCES genetic_loci(id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS animal_genetic_traits_locus_idx ON animal_genetic_traits(locus_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'health_records_type_check') THEN
    ALTER TABLE health_records ADD CONSTRAINT health_records_type_check
      CHECK (record_type IN ('symptom','visit','diagnosis','suspicion','treatment','checkup'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'incubators_capacity_positive') THEN
    ALTER TABLE incubators ADD CONSTRAINT incubators_capacity_positive
      CHECK (capacity IS NULL OR capacity > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'egg_measurements_weight_positive') THEN
    ALTER TABLE egg_measurements ADD CONSTRAINT egg_measurements_weight_positive CHECK (weight_g > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'species_breeding_profiles_age_nonnegative') THEN
    ALTER TABLE species_breeding_profiles ADD CONSTRAINT species_breeding_profiles_age_nonnegative CHECK (
      (female_min_age_months IS NULL OR female_min_age_months >= 0) AND
      (male_min_age_months IS NULL OR male_min_age_months >= 0)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'species_breeding_profiles_weight_positive') THEN
    ALTER TABLE species_breeding_profiles ADD CONSTRAINT species_breeding_profiles_weight_positive CHECK (
      (female_min_weight_g IS NULL OR female_min_weight_g > 0) AND
      (male_min_weight_g IS NULL OR male_min_weight_g > 0)
    );
  END IF;
END $$;

-- Match Prisma's non-partial unique indexes for nullable finance source links.
DROP INDEX IF EXISTS finance_entries_source_transfer_unique;
CREATE UNIQUE INDEX finance_entries_source_transfer_unique ON finance_entries(source_transfer_id);
DROP INDEX IF EXISTS finance_entries_source_stock_movement_unique;
CREATE UNIQUE INDEX finance_entries_source_stock_movement_unique ON finance_entries(source_stock_movement_id);

COMMIT;
