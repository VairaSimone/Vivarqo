ALTER TABLE stock_movements
  DROP CONSTRAINT stock_movements_quantity_check;

ALTER TABLE stock_movements
  ADD CONSTRAINT stock_movements_quantity_check
  CHECK (quantity >= 0 AND (movement_type = 'adjustment' OR quantity > 0));
