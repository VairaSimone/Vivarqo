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
    attempts                   INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
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
    processing_started_at TIMESTAMPTZ,
    lease_token           UUID,
    attempts              INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
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
CREATE INDEX push_subscriptions_user_idx ON push_subscriptions (user_id);
CREATE INDEX notifications_user_created_idx ON notifications (user_id, created_at DESC);
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

COMMIT;

-- Verifica rapida dopo l'esecuzione:
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
-- ORDER BY table_name;