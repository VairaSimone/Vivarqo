-- Health reminders are a first-class task category used by companion-care workflows.
ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_category_check";
ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_category_check"
  CHECK ("category" IN ('feeding', 'weighing', 'shed_check', 'cleaning', 'reproduction', 'incubation', 'document', 'inventory', 'health', 'custom'));
