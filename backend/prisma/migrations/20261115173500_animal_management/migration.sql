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
CREATE TABLE animal_transfers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 animal_id uuid NOT NULL REFERENCES animals(id) ON DELETE RESTRICT, transfer_type varchar(16) NOT NULL CHECK(transfer_type IN ('sale','gift','breeder_transfer')),
 recipient_name varchar(160) NOT NULL, recipient_email varchar(254), recipient_breeder varchar(160), transferred_at timestamptz(6) NOT NULL,
 price_cents bigint CHECK(price_cents IS NULL OR price_cents >= 0), notes text, created_at timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX animal_transfers_user_date_idx ON animal_transfers(user_id,transferred_at DESC);
CREATE INDEX animal_transfers_animal_date_idx ON animal_transfers(animal_id,transferred_at DESC);
