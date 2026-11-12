-- Keep at most one materialized open occurrence for each reminder rule.
-- Existing duplicates are retired deterministically before the partial unique index
-- is created; completed history is never modified.
UPDATE tasks AS task
   SET status = 'dismissed'
  FROM reminder_rules AS rule
 WHERE task.reminder_rule_id = rule.id
   AND task.user_id = rule.user_id
   AND task.status = 'open'
   AND rule.is_enabled = FALSE;

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
