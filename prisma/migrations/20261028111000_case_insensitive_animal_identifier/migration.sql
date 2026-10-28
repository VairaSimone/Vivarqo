DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM animals
    WHERE identifier IS NOT NULL
    GROUP BY user_id, lower(identifier)
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Cannot enforce case-insensitive animal identifiers: duplicate identifiers exist within an account. Resolve the conflicts and retry the migration.';
  END IF;
END
$$;

ALTER TABLE animals
  ALTER COLUMN identifier TYPE CITEXT
  USING identifier::citext;

ALTER TABLE animals
  ADD CONSTRAINT animals_identifier_length_check
  CHECK (identifier IS NULL OR char_length(identifier::text) <= 120);
