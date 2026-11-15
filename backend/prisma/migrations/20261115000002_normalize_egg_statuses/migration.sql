-- Normalize legacy free-text egg statuses before enforcing the controlled lifecycle in the API.
UPDATE "eggs"
SET "status" = CASE lower(trim("status"))
  WHEN 'fertile' THEN 'fertile'
  WHEN 'infertile' THEN 'infertile'
  WHEN 'non fertile' THEN 'infertile'
  WHEN 'non_fertile' THEN 'infertile'
  WHEN 'damaged' THEN 'damaged'
  WHEN 'broken' THEN 'damaged'
  WHEN 'lost' THEN 'lost'
  WHEN 'missing' THEN 'lost'
  WHEN 'incubating' THEN 'incubating'
  WHEN 'in incubation' THEN 'incubating'
  WHEN 'hatched' THEN 'hatched'
  WHEN 'schiuso' THEN 'hatched'
  ELSE 'unknown'
END;

UPDATE "egg_history"
SET "status" = CASE lower(trim("status"))
  WHEN 'fertile' THEN 'fertile'
  WHEN 'infertile' THEN 'infertile'
  WHEN 'non fertile' THEN 'infertile'
  WHEN 'non_fertile' THEN 'infertile'
  WHEN 'damaged' THEN 'damaged'
  WHEN 'broken' THEN 'damaged'
  WHEN 'lost' THEN 'lost'
  WHEN 'missing' THEN 'lost'
  WHEN 'incubating' THEN 'incubating'
  WHEN 'in incubation' THEN 'incubating'
  WHEN 'hatched' THEN 'hatched'
  WHEN 'schiuso' THEN 'hatched'
  ELSE 'unknown'
END;
