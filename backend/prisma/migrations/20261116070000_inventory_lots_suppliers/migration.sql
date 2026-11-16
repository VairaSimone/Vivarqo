-- Inventory lots, suppliers and expiry tracking.
CREATE TABLE inventory_suppliers (
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
CREATE INDEX inventory_suppliers_user_name_idx ON inventory_suppliers(user_id, name);

CREATE TABLE inventory_lots (
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
CREATE INDEX inventory_lots_item_expiry_idx ON inventory_lots(item_id, expires_at);
CREATE INDEX inventory_lots_supplier_purchased_idx ON inventory_lots(supplier_id, purchased_at DESC);
ALTER TABLE stock_movements ADD COLUMN lot_id UUID REFERENCES inventory_lots(id) ON DELETE SET NULL;
CREATE INDEX stock_movements_lot_idx ON stock_movements(lot_id);
