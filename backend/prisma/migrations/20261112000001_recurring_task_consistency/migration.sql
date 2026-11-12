-- Keep at most one materialized open occurrence for each enabled recurrence.
-- Existing duplicates are retired deterministically before the partial unique index
-- is created; completed history is never modified.
WITH ranked_open_tasks AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY reminder_rule_id
           ORDER BY due_at ASC, created_at ASC, id ASC
         ) AS occurrence_rank
    FROM tasks
   WHERE reminder_rule_id IS NOT NULL
     AND status = 'open'
)
UPDATE tasks AS task
   SET status = 'dismissed'
  FROM ranked_open_tasks AS ranked
 WHERE task.id = ranked.id
   AND ranked.occurrence_rank > 1;

UPDATE reminder_rules AS rule
   SET next_due_at = task.due_at
  FROM tasks AS task
 WHERE task.reminder_rule_id = rule.id
   AND task.user_id = rule.user_id
   AND task.status = 'open'
   AND rule.is_enabled = TRUE;

CREATE UNIQUE INDEX tasks_one_open_per_reminder_rule_idx
  ON tasks (reminder_rule_id)
  WHERE reminder_rule_id IS NOT NULL AND status = 'open';

CREATE OR REPLACE FUNCTION vivarqo_check_reminder_rule_tenant_consistency()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.animal_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM animals
        WHERE id = NEW.animal_id AND user_id = NEW.user_id
     ) THEN
    RAISE EXCEPTION 'reminder rule animal must belong to the same user';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER reminder_rules_tenant_guard
  BEFORE INSERT OR UPDATE ON reminder_rules
  FOR EACH ROW EXECUTE FUNCTION vivarqo_check_reminder_rule_tenant_consistency();

CREATE OR REPLACE FUNCTION vivarqo_check_task_tenant_consistency()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.animal_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM animals
        WHERE id = NEW.animal_id AND user_id = NEW.user_id
     ) THEN
    RAISE EXCEPTION 'task animal must belong to the same user';
  END IF;

  IF NEW.reminder_rule_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM reminder_rules
        WHERE id = NEW.reminder_rule_id AND user_id = NEW.user_id
     ) THEN
    RAISE EXCEPTION 'task reminder rule must belong to the same user';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tasks_tenant_guard
  BEFORE INSERT OR UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION vivarqo_check_task_tenant_consistency();
