-- Additive enum extension; commit before definitions using the new value.
alter type public.monitor_provider add value if not exists 'jira';
