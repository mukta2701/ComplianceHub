-- Reassert the operator boundary for the existing SoA finalisation RPC.
--
-- The original member-read-only migration hardens installed RPC definitions
-- dynamically.  A preserved local database can already have the finalisation
-- function from an earlier migration without having that replacement applied,
-- so keep the invariant explicit and idempotent for upgrades as well as fresh
-- databases.
do $migration$
declare
  definition text;
begin
  select pg_catalog.pg_get_functiondef('public.finalise_soa(uuid)'::regprocedure)
  into definition;

  if definition like '%public.is_organisation_member(%' then
    execute pg_catalog.replace(
      definition,
      'public.is_organisation_member(',
      'public.is_organisation_operator('
    );
  end if;
end;
$migration$;
