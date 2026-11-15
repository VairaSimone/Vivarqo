-- Incubation checks are first-class tasks created from clutch monitoring.
ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_category_check";
ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_category_check"
  CHECK ("category" IN ('feeding', 'weighing', 'shed_check', 'cleaning', 'reproduction', 'incubation', 'document', 'inventory', 'custom'));
