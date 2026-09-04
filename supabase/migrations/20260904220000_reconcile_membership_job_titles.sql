-- Reconcile databases whose migration history records the delegation migration
-- while the columns were absent from the live schema.
alter table public.memberships
  add column if not exists job_title text;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.memberships'::pg_catalog.regclass
      and conname = 'memberships_job_title_length'
  ) then
    alter table public.memberships
      add constraint memberships_job_title_length
      check (job_title is null or char_length(job_title) between 1 and 120);
  end if;
end;
$$;

alter table public.invitations
  add column if not exists job_title text;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.invitations'::pg_catalog.regclass
      and conname = 'invitations_job_title_length'
  ) then
    alter table public.invitations
      add constraint invitations_job_title_length
      check (job_title is null or char_length(job_title) between 1 and 120);
  end if;
end;
$$;
