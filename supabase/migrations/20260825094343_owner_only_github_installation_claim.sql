create or replace function public.claim_github_installation_server(
  target_organisation_id uuid,
  target_actor_id uuid,
  target_provider_installation_id bigint,
  target_account_id bigint,
  target_account_login text,
  target_account_type text,
  target_repository_selection text,
  target_permissions jsonb,
  target_permissions_ok boolean,
  target_repositories jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_installation public.github_installations;
  installation_exists boolean;
  claimed_installation_id uuid;
  repository_value jsonb;
  repository_count integer;
  distinct_repository_count integer;
begin
  if target_organisation_id is null
    or target_actor_id is null
    or target_provider_installation_id is null
    or target_provider_installation_id <= 0
    or target_account_id is null
    or target_account_id <= 0
    or target_repository_selection <> 'selected'
    or target_permissions_ok is not true
    or pg_catalog.jsonb_typeof(target_permissions) <> 'object'
    or pg_catalog.jsonb_typeof(target_repositories) <> 'array'
  then
    raise exception 'invalid verified GitHub installation claim' using errcode = '22023';
  end if;

  perform 1
  from public.memberships membership
  where membership.organisation_id = target_organisation_id
    and membership.user_id = target_actor_id
    and membership.role = 'owner'
  for update;

  if not found then
    raise exception 'GitHub installation claim requires a current workspace Owner'
      using errcode = '42501';
  end if;

  repository_count := pg_catalog.jsonb_array_length(target_repositories);
  if repository_count > 100 then
    raise exception 'a verified GitHub installation claim may contain at most 100 repositories'
      using errcode = '23514';
  end if;

  for repository_value in
    select value from pg_catalog.jsonb_array_elements(target_repositories)
  loop
    if pg_catalog.jsonb_typeof(repository_value) <> 'object'
      or not (repository_value ?& array[
        'id', 'owner', 'name', 'fullName', 'htmlUrl', 'visibility', 'archived', 'defaultBranch'
      ])
      or pg_catalog.jsonb_typeof(repository_value -> 'id') <> 'number'
      or pg_catalog.jsonb_typeof(repository_value -> 'owner') <> 'string'
      or pg_catalog.jsonb_typeof(repository_value -> 'name') <> 'string'
      or pg_catalog.jsonb_typeof(repository_value -> 'fullName') <> 'string'
      or pg_catalog.jsonb_typeof(repository_value -> 'htmlUrl') <> 'string'
      or pg_catalog.jsonb_typeof(repository_value -> 'visibility') <> 'string'
      or pg_catalog.jsonb_typeof(repository_value -> 'archived') <> 'boolean'
      or pg_catalog.jsonb_typeof(repository_value -> 'defaultBranch') <> 'string'
      or (repository_value ->> 'id') !~ '^[1-9][0-9]*$'
      or repository_value ->> 'fullName' <> (repository_value ->> 'owner') || '/' || (repository_value ->> 'name')
      or repository_value ->> 'htmlUrl' <> 'https://github.com/' || (repository_value ->> 'fullName')
      or repository_value ->> 'visibility' not in ('public', 'private', 'internal')
    then
      raise exception 'invalid canonical GitHub repository inventory' using errcode = '22023';
    end if;
  end loop;

  select count(distinct (value ->> 'id'))
  into distinct_repository_count
  from pg_catalog.jsonb_array_elements(target_repositories);
  if distinct_repository_count <> repository_count then
    raise exception 'GitHub repository inventory contains duplicate provider ids'
      using errcode = '22023';
  end if;

  select count(distinct pg_catalog.lower(value ->> 'fullName'))
  into distinct_repository_count
  from pg_catalog.jsonb_array_elements(target_repositories);
  if distinct_repository_count <> repository_count then
    raise exception 'GitHub repository inventory contains duplicate canonical names'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'github-installation:' || target_provider_installation_id::text,
      0
    )
  );

  select * into existing_installation
  from public.github_installations
  where provider_installation_id = target_provider_installation_id
  for update;

  installation_exists := found;

  if installation_exists and existing_installation.organisation_id <> target_organisation_id then
    raise exception 'GitHub installation is already claimed by another workspace'
      using errcode = '42501';
  end if;

  perform 1
  from public.memberships membership
  where membership.organisation_id = target_organisation_id
    and membership.user_id = target_actor_id
    and membership.role = 'owner'
  for update;

  if not found then
    raise exception 'GitHub installation claim requires a current workspace Owner'
      using errcode = '42501';
  end if;

  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub', target_actor_id::text,
      'role', 'authenticated'
    )::text,
    true
  );

  if installation_exists then
    update public.github_installations
    set account_id = target_account_id,
        account_login = target_account_login,
        account_type = target_account_type,
        repository_selection = target_repository_selection,
        status = 'active',
        connected_by = target_actor_id,
        permissions = target_permissions,
        permissions_ok = true,
        revoked_at = null
    where id = existing_installation.id
    returning id into claimed_installation_id;
  else
    insert into public.github_installations(
      organisation_id, provider_installation_id, account_id, account_login,
      account_type, repository_selection, status, connected_by, permissions,
      permissions_ok
    ) values (
      target_organisation_id, target_provider_installation_id, target_account_id,
      target_account_login, target_account_type, target_repository_selection,
      'active', target_actor_id, target_permissions, true
    ) returning id into claimed_installation_id;
  end if;

  for repository_value in
    select value from pg_catalog.jsonb_array_elements(target_repositories)
  loop
    insert into public.github_repositories(
      organisation_id, installation_id, provider_repository_id, owner_login,
      name, full_name, html_url, visibility, default_branch, archived,
      available, removed_at, last_seen_at
    ) values (
      target_organisation_id,
      claimed_installation_id,
      (repository_value ->> 'id')::bigint,
      repository_value ->> 'owner',
      repository_value ->> 'name',
      repository_value ->> 'fullName',
      repository_value ->> 'htmlUrl',
      repository_value ->> 'visibility',
      repository_value ->> 'defaultBranch',
      (repository_value ->> 'archived')::boolean,
      true,
      null,
      pg_catalog.now()
    )
    on conflict (installation_id, provider_repository_id) do update
    set owner_login = excluded.owner_login,
        name = excluded.name,
        full_name = excluded.full_name,
        html_url = excluded.html_url,
        visibility = excluded.visibility,
        default_branch = excluded.default_branch,
        archived = excluded.archived,
        available = true,
        removed_at = null,
        last_seen_at = excluded.last_seen_at;
  end loop;

  update public.github_repositories repository
  set available = false,
      removed_at = pg_catalog.now()
  where repository.installation_id = claimed_installation_id
    and repository.organisation_id = target_organisation_id
    and repository.available
    and not exists (
      select 1
      from pg_catalog.jsonb_array_elements(target_repositories) inventory(value)
      where (inventory.value ->> 'id')::bigint = repository.provider_repository_id
    );

  return claimed_installation_id;
end;
$$;

alter function public.claim_github_installation_server(
  uuid, uuid, bigint, bigint, text, text, text, jsonb, boolean, jsonb
) owner to postgres;
revoke all on function public.claim_github_installation_server(
  uuid, uuid, bigint, bigint, text, text, text, jsonb, boolean, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.claim_github_installation_server(
  uuid, uuid, bigint, bigint, text, text, text, jsonb, boolean, jsonb
) to service_role;
