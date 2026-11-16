ALTER TABLE export_jobs
  ADD COLUMN modules TEXT[] NOT NULL
  DEFAULT ARRAY['animals', 'feedings', 'reproduction', 'finance', 'inventory']::TEXT[];

ALTER TABLE export_jobs
  ADD CONSTRAINT export_jobs_modules_valid
  CHECK (
    cardinality(modules) BETWEEN 1 AND 5
    AND modules <@ ARRAY['animals', 'feedings', 'reproduction', 'finance', 'inventory']::TEXT[]
  );
