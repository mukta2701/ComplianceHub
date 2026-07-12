-- Active monitoring: a finding can spawn a remediation task through the shared
-- tasks engine (like audit findings do, 202607020021). Add the 'monitoring'
-- source so those tasks are labelled and filterable distinctly from the daily
-- sweep's evidence/policy work.
alter type public.task_source add value if not exists 'monitoring';
