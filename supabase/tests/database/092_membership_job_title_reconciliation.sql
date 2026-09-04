begin;
select plan(4);

select has_column('public', 'memberships', 'job_title', 'memberships retain the delegated job title column');
select has_column('public', 'invitations', 'job_title', 'invitations retain the delegated job title column');
select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.memberships'::pg_catalog.regclass
      and conname = 'memberships_job_title_length'
  ),
  'membership job titles retain their length constraint'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.invitations'::pg_catalog.regclass
      and conname = 'invitations_job_title_length'
  ),
  'invitation job titles retain their length constraint'
);

select * from finish();
rollback;
