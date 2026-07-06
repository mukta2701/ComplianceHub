-- Phase C1: audit findings spawn remediation tasks via the existing tasks
-- engine. This adds the only new task source. Kept in its own migration so the
-- value is committed before any code inserts it (a freshly added enum value
-- cannot be used in the same transaction that adds it).

alter type public.task_source add value if not exists 'audit';
