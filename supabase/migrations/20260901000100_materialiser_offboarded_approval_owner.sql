-- The immutable approval remains the provenance authorisation after an approver
-- leaves the workspace. Operational ownership, however, may only refer to a
-- current membership. Keep provenance/audit attribution on the approval while
-- assigning NULL when the approved profile has been offboarded.
do $migration$
declare
  function_definition text;
  declaration_anchor constant text := '  approval_row public.github_mapping_approvals;' || chr(10);
  run_anchor constant text := '  select run.*' || chr(10);
  owner_value_anchor constant text :=
    '        approval_row.approved_by,' || chr(10) ||
    '        observation_row.observed_at::date,' || chr(10);
  membership_lookup constant text :=
    '  select membership.user_id' || chr(10) ||
    '  into operational_owner_id' || chr(10) ||
    '  from public.memberships membership' || chr(10) ||
    '  where membership.organisation_id = target_organisation_id' || chr(10) ||
    '    and membership.user_id = approval_row.approved_by' || chr(10) ||
    '  for key share;' || chr(10) || chr(10);
begin
  select pg_get_functiondef(
    'public.materialise_github_observations_task2_server(uuid,uuid,text,text,jsonb)'::regprocedure
  )
  into function_definition;

  if position(declaration_anchor in function_definition) = 0
    or position(run_anchor in function_definition) = 0
    or position(owner_value_anchor in function_definition) = 0
  then
    raise exception 'materialiser owner-assignment successor requires the expected inner function body'
      using errcode = 'P0001';
  end if;

  function_definition := replace(
    function_definition,
    declaration_anchor,
    declaration_anchor || '  operational_owner_id uuid;' || chr(10)
  );
  function_definition := replace(
    function_definition,
    run_anchor,
    membership_lookup || run_anchor
  );
  function_definition := replace(
    function_definition,
    owner_value_anchor,
    '        operational_owner_id,' || chr(10) ||
    '        observation_row.observed_at::date,' || chr(10)
  );

  if position('  operational_owner_id uuid;' in function_definition) = 0
    or position(membership_lookup in function_definition) = 0
    or position('        operational_owner_id,' || chr(10) || '        observation_row.observed_at::date,' in function_definition) = 0
  then
    raise exception 'materialiser owner-assignment successor did not apply completely'
      using errcode = 'P0001';
  end if;

  execute function_definition;
end;
$migration$;
