-- Two narrow records: resumable coordinator progress and immutable dated inputs.
-- A snapshot does not alter assessments, tasks, evidence, findings or legacy reports.
create table public.baseline_progress (
  organisation_id uuid primary key references public.organisations(id),
  objective text not null check (char_length(objective) between 1 and 2000),
  assessment_id uuid,
  operator_id uuid not null references public.profiles(id),
  revision bigint not null check (revision > 0),
  updated_at timestamptz not null,
  last_request_id uuid not null,
  last_request_input jsonb not null,
  last_result jsonb not null,
  foreign key (assessment_id,organisation_id) references public.assessment_sessions(id,organisation_id)
);
create table public.baseline_snapshots (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  request_id uuid not null,
  request_input jsonb not null,
  result jsonb not null,
  saved_by uuid not null references public.profiles(id),
  saved_at timestamptz not null,
  progress_revision bigint not null check (progress_revision > 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and payload->>'schemaVersion' = '1' and payload->>'calculationVersion' = '1'),
  unique (organisation_id,request_id), unique (organisation_id,progress_revision)
);
create index baseline_snapshots_history on public.baseline_snapshots(organisation_id,progress_revision desc);
create trigger baseline_snapshots_immutable before update or delete or truncate on public.baseline_snapshots
for each statement execute function public.reject_immutable_change('baseline snapshots are immutable');
alter table public.baseline_progress enable row level security;
alter table public.baseline_snapshots enable row level security;
create policy baseline_progress_operator_read on public.baseline_progress for select to authenticated using (public.is_organisation_operator(organisation_id));
create policy baseline_snapshots_member_read on public.baseline_snapshots for select to authenticated using (public.is_organisation_member(organisation_id));
revoke all on public.baseline_progress, public.baseline_snapshots from public, anon, authenticated, service_role;
grant select on public.baseline_progress, public.baseline_snapshots to authenticated;

create function public.save_baseline_progress(
  target_organisation_id uuid, expected_revision bigint, baseline_objective text,
  selected_assessment_id uuid, save_request_id uuid, create_snapshot boolean
) returns jsonb language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  actor uuid := auth.uid(); clean_objective text := btrim(baseline_objective,E' \t\n\r\f');
  progress public.baseline_progress%rowtype; previous public.baseline_snapshots%rowtype;
  request_input jsonb; save_result jsonb; snapshot_payload jsonb; snapshot_id uuid;
  next_revision bigint; saved_time timestamptz := statement_timestamp(); saved_date date := (statement_timestamp() at time zone 'UTC')::date;
begin
  -- Check current membership before any replay. SHARE also blocks removal/demotion
  -- until commit; client JWT role claims never authorise this operation.
  perform 1 from public.memberships where organisation_id=target_organisation_id and user_id=actor for share;
  if actor is null or not public.is_organisation_operator(target_organisation_id) then
    raise exception 'current workspace operator required' using errcode='42501';
  end if;
  if clean_objective is null or char_length(clean_objective) not between 1 and 2000 or expected_revision is null or expected_revision<0 or save_request_id is null or create_snapshot is null then
    raise exception 'invalid baseline input' using errcode='22023';
  end if;
  -- Serialise both first saves (where there is no row to lock) and later edits.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('baseline:'||target_organisation_id::text,0));
  request_input := jsonb_build_object('actor',actor,'revision',expected_revision,'objective',clean_objective,'assessment',selected_assessment_id,'snapshot',create_snapshot);
  select * into previous from public.baseline_snapshots where organisation_id=target_organisation_id and request_id=save_request_id;
  if found then
    if previous.request_input <> request_input then raise exception 'request id already used with different baseline input' using errcode='22023'; end if;
    return previous.result;
  end if;
  select * into progress from public.baseline_progress where organisation_id=target_organisation_id for update;
  if progress.last_request_id=save_request_id then
    if progress.last_request_input <> request_input then raise exception 'request id already used with different baseline input' using errcode='22023'; end if;
    return progress.last_result;
  end if;
  if coalesce(progress.revision,0) <> expected_revision then raise exception 'baseline revision changed; reload before saving' using errcode='PT409'; end if;
  if selected_assessment_id is not null then
    perform 1 from public.assessment_sessions where id=selected_assessment_id and organisation_id=target_organisation_id for share;
    if not found then raise exception 'assessment not found in workspace' using errcode='42501'; end if;
  end if;
  next_revision := expected_revision+1;
  if create_snapshot then
    snapshot_id := extensions.gen_random_uuid();
    -- Every source is captured by this ONE statement, giving all CTEs the same
    -- MVCC read snapshot. Never accept a client-built summary or readiness claim.
    with scope_source as (
      select scope_statement,services,locations,information_types,dependencies,exclusions,updated_at from public.organisation_scope_profiles where organisation_id=target_organisation_id
    ), assessment_source as (
      select s.id,s.title,s.revision,s.catalogue_version_id,v.version as catalogue_version,s.updated_at
      from public.assessment_sessions s join public.catalogue_versions v on v.id=s.catalogue_version_id where s.id=selected_assessment_id and s.organisation_id=target_organisation_id
    ), question_source as (
      select q.id,q.prompt,r.answer,coalesce(r.evidence_note,'') as evidence_note,r.updated_at
      from public.catalogue_questions q join assessment_source s on s.catalogue_version_id=q.catalogue_version_id
      left join public.assessment_responses r on r.question_id=q.id and r.session_id=s.id and r.organisation_id=target_organisation_id
    ), task_source as (
      select t.id,t.title,t.status,t.owner_id,p.display_name as owner_name,t.due_on,t.updated_at,t.assignment_revision
      from public.tasks t left join public.profiles p on p.id=t.owner_id where t.organisation_id=target_organisation_id
    ), contribution_source as (
      select c.id,c.task_id,c.assignment_revision,c.submitter_id,author.display_name as submitter_name,c.reviewer_id,reviewer.display_name as reviewer_name,c.decision,c.note,c.rationale,c.evidence_id,c.created_at,c.reviewed_at
      from public.task_contributions c left join public.profiles author on author.id=c.submitter_id left join public.profiles reviewer on reviewer.id=c.reviewer_id where c.organisation_id=target_organisation_id
    ), evidence_source as (
      select id,title,kind,description,status,valid_until,collected_on,created_at from public.evidence where organisation_id=target_organisation_id
    ), risk_source as (
      select r.id,r.reference,r.title,r.status,r.residual_likelihood,r.residual_impact,r.owner_id,p.display_name as owner_name,r.review_date,r.updated_at
      from public.risks r left join public.profiles p on p.id=r.owner_id where r.organisation_id=target_organisation_id
    ), config_source as (
      select low_max,moderate_max,high_max,appetite_threshold from public.risk_matrix_config where organisation_id=target_organisation_id
    )
    select jsonb_build_object(
      'schemaVersion',1,'calculationVersion',1,'organisationId',target_organisation_id,
      'organisationName',(select name from public.organisations where id=target_organisation_id),
      'objective',clean_objective,'savedAt',saved_time,'progressRevision',next_revision,
      'scope',(select to_jsonb(s) from scope_source s), 'assessment',(select to_jsonb(s) from assessment_source s),
      'questions',coalesce((select jsonb_agg(to_jsonb(s) order by s.id) from question_source s),'[]'::jsonb),
      'tasks',coalesce((select jsonb_agg(to_jsonb(s) order by s.id) from task_source s),'[]'::jsonb),
      'contributions',coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at,s.id) from contribution_source s),'[]'::jsonb),
      'evidence',coalesce((select jsonb_agg(to_jsonb(s) order by s.id) from evidence_source s),'[]'::jsonb),
      'risks',coalesce((select jsonb_agg(to_jsonb(s) order by s.id) from risk_source s),'[]'::jsonb),
      'riskConfig',(select to_jsonb(s) from config_source s),
      'counts',jsonb_build_object(
        'scopeGaps',coalesce((select (case when btrim(scope_statement,E' \t\n\r\f')='' then 1 else 0 end)+(case when btrim(services,E' \t\n\r\f')='' then 1 else 0 end)+(case when btrim(locations,E' \t\n\r\f')='' then 1 else 0 end)+(case when btrim(information_types,E' \t\n\r\f')='' then 1 else 0 end)+(case when btrim(dependencies,E' \t\n\r\f')='' then 1 else 0 end)+(case when btrim(exclusions,E' \t\n\r\f')='' then 1 else 0 end) from scope_source),6),
        'unanswered',(select count(*) from question_source where answer is null),
        'openTasks',(select count(*) from task_source where status in ('open','in_progress')),
        'overdueTasks',(select count(*) from task_source where status in ('open','in_progress') and due_on<saved_date),
        'unassignedTasks',(select count(*) from task_source where status in ('open','in_progress') and owner_id is null),
        'undatedTasks',(select count(*) from task_source where status in ('open','in_progress') and due_on is null),
        'pendingReviews',(select count(*) from contribution_source c join task_source t on t.id=c.task_id and t.assignment_revision=c.assignment_revision and t.owner_id=c.submitter_id where c.decision='pending' and t.status in ('open','in_progress')),
        'expiredEvidence',(select count(*) from evidence_source where status not in ('superseded','withdrawn') and (status='expired' or valid_until<saved_date))
      )
    ) into snapshot_payload;
  end if;
  save_result := jsonb_build_object('revision',next_revision,'snapshot_id',snapshot_id);
  insert into public.baseline_progress(organisation_id,objective,assessment_id,operator_id,revision,updated_at,last_request_id,last_request_input,last_result)
  values(target_organisation_id,clean_objective,selected_assessment_id,actor,next_revision,saved_time,save_request_id,request_input,save_result)
  on conflict (organisation_id) do update set objective=excluded.objective,assessment_id=excluded.assessment_id,operator_id=excluded.operator_id,revision=excluded.revision,updated_at=excluded.updated_at,last_request_id=excluded.last_request_id,last_request_input=excluded.last_request_input,last_result=excluded.last_result;
  if create_snapshot then
    insert into public.baseline_snapshots(id,organisation_id,request_id,request_input,result,saved_by,saved_at,progress_revision,payload)
    values(snapshot_id,target_organisation_id,save_request_id,request_input,save_result,actor,saved_time,next_revision,snapshot_payload);
  end if;
  return save_result;
end $$;
revoke all on function public.save_baseline_progress(uuid,bigint,text,uuid,uuid,boolean) from public, anon, authenticated, service_role;
grant execute on function public.save_baseline_progress(uuid,bigint,text,uuid,uuid,boolean) to authenticated;
