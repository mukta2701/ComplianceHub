alter table public.soa_items
  add column decision_revision bigint not null default 0
  check (decision_revision >= 0);

-- Parent activity is part of the guarded command. The original polymorphic
-- trigger initialised both possible OLD row fields in one CASE expression,
-- which fails when a register row is updated because it has no
-- soa_register_id field. Resolve the trigger row shape before reading it.
create or replace function public.prevent_finalised_soa_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_id uuid;
begin
  if tg_table_name = 'soa_registers' then
    target_id := old.id;
  else
    target_id := coalesce(old.soa_register_id, new.soa_register_id);
  end if;
  if exists(select 1 from public.soa_snapshots snapshot where snapshot.soa_register_id = target_id) then
    raise exception 'finalised SoA source records are immutable';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.update_soa_decisions_guarded(
  target_register_id uuid,
  changes jsonb
)
returns table(item_id uuid, decision_revision bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  register_row public.soa_registers;
  change jsonb;
  parsed_item_id uuid;
  parsed_expected_revision bigint;
  parsed_owner_id uuid;
  parsed_status public.soa_implementation_status;
begin
  select r.* into register_row
  from public.soa_registers r
  where r.id = target_register_id
    and actor is not null
    and public.is_organisation_operator(r.organisation_id)
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'control_decision_forbidden',
      detail = 'register_unavailable';
  end if;

  if exists (
    select 1 from public.soa_snapshots s
    where s.soa_register_id = register_row.id
      and s.organisation_id = register_row.organisation_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'control_decision_forbidden',
      detail = 'register_finalised';
  end if;

  if jsonb_typeof(changes) is distinct from 'array' then
    raise exception using
      errcode = '22023',
      message = 'control_decision_invalid',
      detail = 'changes_invalid';
  end if;

  if jsonb_array_length(changes) = 0 then
    raise exception using
      errcode = '22023',
      message = 'control_decision_invalid',
      detail = 'changes_invalid';
  end if;

  -- Parse every item identity before comparing it. PostgreSQL accepts multiple
  -- textual spellings of one UUID, so raw JSON strings are not a safe identity
  -- boundary for a command that must update each row at most once.
  for change in select value from jsonb_array_elements(changes)
  loop
    if jsonb_typeof(change) is distinct from 'object'
      or jsonb_typeof(change->'itemId') is distinct from 'string' then
      raise exception using
        errcode = '22023',
        message = 'control_decision_invalid',
        detail = 'change_invalid';
    end if;

    begin
      parsed_item_id := (change->>'itemId')::uuid;
    exception when invalid_text_representation then
      raise exception using
        errcode = '22023',
        message = 'control_decision_invalid',
        detail = 'change_invalid';
    end;
  end loop;

  if (select count(*) from jsonb_array_elements(changes)) is distinct from
     (select count(distinct (value->>'itemId')::uuid) from jsonb_array_elements(changes)) then
    raise exception using
      errcode = '22023',
      message = 'control_decision_invalid',
      detail = 'duplicate_item';
  end if;

  -- Lock the complete register in a deterministic order. Every revision is
  -- checked only after these locks are held, so concurrent batches cannot
  -- validate against a revision that another batch is about to replace.
  perform item.id
  from public.soa_items item
  where item.soa_register_id = register_row.id
    and item.organisation_id = register_row.organisation_id
  order by item.id
  for update;

  -- Validate the whole request before changing any row.
  for change in select value from jsonb_array_elements(changes)
  loop
    if jsonb_typeof(change) is distinct from 'object'
      or jsonb_typeof(change->'itemId') is distinct from 'string'
      or jsonb_typeof(change->'expectedRevision') is distinct from 'number'
      or (change->>'expectedRevision') !~ '^(0|[1-9][0-9]*)$'
      or jsonb_typeof(change->'applicable') is distinct from 'boolean'
      or jsonb_typeof(change->'status') is distinct from 'string'
      or jsonb_typeof(change->'justification') is distinct from 'string'
      or jsonb_typeof(change->'evidence') is distinct from 'string'
      or not (change ? 'ownerId')
      or (change->'ownerId' <> 'null'::jsonb and jsonb_typeof(change->'ownerId') is distinct from 'string')
      or change->>'status' not in ('pending','absent','in_progress','established','operational','advanced','not_applicable')
      or char_length(change->>'justification') > 10000
      or btrim(change->>'justification') = ''
      or char_length(change->>'evidence') > 10000
      or ((change->>'applicable')::boolean and change->>'status' = 'not_applicable')
      or (not (change->>'applicable')::boolean and change->>'status' <> 'not_applicable') then
      raise exception using
        errcode = '22023',
        message = 'control_decision_invalid',
        detail = 'change_invalid';
    end if;

    begin
      parsed_item_id := (change->>'itemId')::uuid;
      parsed_expected_revision := (change->>'expectedRevision')::bigint;
      parsed_status := (change->>'status')::public.soa_implementation_status;
      parsed_owner_id := case when change->'ownerId' = 'null'::jsonb then null else (change->>'ownerId')::uuid end;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception using
        errcode = '22023',
        message = 'control_decision_invalid',
        detail = 'change_invalid';
    end;

    if not exists (
      select 1 from public.soa_items item
      where item.id = parsed_item_id
        and item.soa_register_id = register_row.id
        and item.organisation_id = register_row.organisation_id
    ) then
      raise exception using
        errcode = 'P0002',
        message = 'control_decision_missing',
        detail = 'item_unavailable';
    end if;

    if not exists (
      select 1 from public.soa_items item
      where item.id = parsed_item_id
        and item.decision_revision = parsed_expected_revision
    ) then
      raise exception using
        errcode = '40001',
        message = 'control_decision_stale',
        detail = 'revision_mismatch';
    end if;

    if parsed_owner_id is not null and not exists (
      select 1 from public.memberships membership
      where membership.organisation_id = register_row.organisation_id
        and membership.user_id = parsed_owner_id
    ) then
      raise exception using
        errcode = '22023',
        message = 'control_decision_invalid',
        detail = 'owner_unavailable';
    end if;
  end loop;

  for change in select value from jsonb_array_elements(changes)
  loop
    parsed_item_id := (change->>'itemId')::uuid;
    return query
      update public.soa_items item
      set applicable = (change->>'applicable')::boolean,
          status = (change->>'status')::public.soa_implementation_status,
          justification = change->>'justification',
          evidence = change->>'evidence',
          owner_id = case when change->'ownerId' = 'null'::jsonb then null else (change->>'ownerId')::uuid end,
          decision_revision = item.decision_revision + 1
      where item.id = parsed_item_id
        and item.soa_register_id = register_row.id
        and item.organisation_id = register_row.organisation_id
      returning item.id, item.decision_revision;
  end loop;

  update public.soa_registers
  set updated_at = clock_timestamp()
  where id = register_row.id;
end;
$$;

revoke all on function public.update_soa_decisions_guarded(uuid,jsonb) from public, anon, service_role;
grant execute on function public.update_soa_decisions_guarded(uuid,jsonb) to authenticated;

-- Creation and successor RPCs insert the rows behind their guarded boundary.
-- Ordinary authenticated sessions must use the decision command for changes.
revoke insert, update, delete on table public.soa_items from public, anon, authenticated;
