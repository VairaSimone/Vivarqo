-- Store optional links to registered parents and free-text details for external parents.
ALTER TABLE animals
  ADD COLUMN mother_animal_id UUID,
  ADD COLUMN father_animal_id UUID,
  ADD COLUMN mother_description VARCHAR(240),
  ADD COLUMN father_description VARCHAR(240);

ALTER TABLE animals
  ADD CONSTRAINT animals_mother_animal_fk FOREIGN KEY (mother_animal_id) REFERENCES animals(id) ON DELETE SET NULL,
  ADD CONSTRAINT animals_father_animal_fk FOREIGN KEY (father_animal_id) REFERENCES animals(id) ON DELETE SET NULL,
  ADD CONSTRAINT animals_mother_not_self CHECK (mother_animal_id IS NULL OR mother_animal_id <> id),
  ADD CONSTRAINT animals_father_not_self CHECK (father_animal_id IS NULL OR father_animal_id <> id);

CREATE INDEX animals_mother_idx ON animals(mother_animal_id) WHERE mother_animal_id IS NOT NULL;
CREATE INDEX animals_father_idx ON animals(father_animal_id) WHERE father_animal_id IS NOT NULL;
