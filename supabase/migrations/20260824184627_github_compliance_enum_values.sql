-- PostgreSQL requires newly-added enum labels to be committed before they
-- can be referenced by constraints, functions, or casts in a later
-- migration. Keep these additions isolated from the materialisation schema.
alter type public.monitor_finding_status
  add value if not exists 'in_progress' after 'acknowledged';
alter type public.monitor_finding_status
  add value if not exists 'exception_requested' after 'in_progress';
alter type public.monitor_finding_status
  add value if not exists 'risk_accepted' after 'exception_requested';
alter type public.task_source add value if not exists 'github';
