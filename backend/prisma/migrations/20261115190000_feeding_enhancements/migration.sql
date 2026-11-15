ALTER TABLE animals
  ADD COLUMN feeding_interval_days integer,
  ADD CONSTRAINT animals_feeding_interval_days_check
    CHECK (feeding_interval_days IS NULL OR feeding_interval_days BETWEEN 1 AND 365);

ALTER TABLE feeding_entries
  ADD COLUMN prey_state varchar(16) NOT NULL DEFAULT 'unknown',
  ADD COLUMN inventory_item_id uuid REFERENCES inventory_items(id) ON DELETE RESTRICT,
  ADD COLUMN inventory_quantity numeric(12,3),
  ADD COLUMN inventory_deducted boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT feeding_entries_prey_state_check
    CHECK (prey_state IN ('unknown', 'frozen', 'thawed', 'live')),
  ADD CONSTRAINT feeding_entries_inventory_quantity_check
    CHECK (inventory_quantity IS NULL OR inventory_quantity > 0),
  ADD CONSTRAINT feeding_entries_inventory_link_check
    CHECK ((inventory_item_id IS NULL OR inventory_quantity IS NOT NULL)
        AND (inventory_deducted = false OR inventory_item_id IS NOT NULL));

CREATE INDEX feeding_entries_inventory_item_idx ON feeding_entries(inventory_item_id);
CREATE INDEX feeding_entries_animal_outcome_idx ON feeding_entries(animal_id, outcome);
