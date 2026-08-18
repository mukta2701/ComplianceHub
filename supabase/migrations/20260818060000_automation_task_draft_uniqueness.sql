-- A proposal may create at most one task draft.  The marker is deterministic,
-- so this constraint makes the check-and-insert path safe under concurrent
-- clicks or retries; the server action treats the unique violation as success.
create unique index tasks_one_automation_proposal_draft_idx
  on public.tasks (organisation_id, detail)
  where detail like '[automation-proposal:%]';
