-- Review hardening: atomic tenant onboarding, relational tenant consistency,
-- an independently authored control catalogue, and complete SoA lifecycle RPCs.

alter table public.assessment_sessions
  add constraint assessment_sessions_id_org_catalogue_key unique (id, organisation_id, catalogue_version_id),
  add constraint assessment_sessions_id_org_key unique (id, organisation_id);
alter table public.catalogue_questions
  add constraint catalogue_questions_id_version_key unique (id, catalogue_version_id);

alter table public.assessment_responses add column catalogue_version_id uuid;
update public.assessment_responses r set catalogue_version_id = s.catalogue_version_id
from public.assessment_sessions s where s.id = r.session_id;
alter table public.assessment_responses alter column catalogue_version_id set not null;
alter table public.assessment_responses
  add constraint assessment_responses_session_tenant_fk
    foreign key (session_id, organisation_id, catalogue_version_id)
    references public.assessment_sessions(id, organisation_id, catalogue_version_id) on delete cascade,
  add constraint assessment_responses_question_version_fk
    foreign key (question_id, catalogue_version_id)
    references public.catalogue_questions(id, catalogue_version_id) on delete restrict;

create table public.control_catalogue_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  version text not null unique,
  title text not null,
  published_at timestamptz not null,
  created_at timestamptz not null default now()
);
create table public.control_catalogue_controls (
  id uuid primary key default extensions.gen_random_uuid(),
  catalogue_version_id uuid not null references public.control_catalogue_versions(id) on delete restrict,
  code text not null,
  title text not null check (char_length(title) between 3 and 160),
  theme text not null check (theme in ('organisational', 'people', 'physical', 'technological')),
  position integer not null check (position > 0),
  unique (id, catalogue_version_id),
  unique (catalogue_version_id, code),
  unique (catalogue_version_id, position)
);
create table public.assessment_control_mappings (
  catalogue_question_id uuid not null references public.catalogue_questions(id) on delete restrict,
  control_id uuid not null references public.control_catalogue_controls(id) on delete restrict,
  rationale text not null default '',
  primary key (catalogue_question_id, control_id)
);

insert into public.control_catalogue_versions (id, version, title, published_at)
values ('40000000-0000-4000-8000-000000000001', '2022.1', 'ComplianceHub 2022 control catalogue', now());

do $$
declare titles text[]; item text; n integer; offset_position integer;
begin
  titles := array[
    'Direction for security policy','Accountability for security roles','Separation of conflicting duties','Leadership liaison with public authorities','Participation in security communities','Security intelligence monitoring','Security in project delivery','Asset and information inventory','Acceptable use expectations','Return of organisational assets','Information sensitivity scheme','Practical information labelling','Safe information transfer','Transfer commitments with external parties','Access governance rules','Identity lifecycle governance','Authentication secret stewardship','Access entitlement reviews','Supplier security governance','Security clauses in supplier contracts','Technology supply chain oversight','Supplier service review and change control','Cloud service lifecycle governance','Incident preparation and coordination','Security event triage','Incident response decisions','Lessons from security incidents','Collection and protection of incident evidence','Security during operational disruption','Technology continuity readiness','Legal and contractual security obligations','Protection of intellectual property','Protection and retention of records','Privacy and personal data safeguards','Independent security assurance','Compliance with security rules','Documented operating procedures'
  ];
  foreach item in array titles loop n := coalesce(n,0)+1; insert into public.control_catalogue_controls(catalogue_version_id,code,title,theme,position) values('40000000-0000-4000-8000-000000000001','5.'||n,item,'organisational',n); end loop;
  offset_position := n; n := 0;
  titles := array['Pre-employment trust checks','Employment security commitments','Security awareness and learning','Consequences for security misconduct','Security duties after role changes','Confidentiality commitments','Secure remote working','Reporting suspected security events'];
  foreach item in array titles loop n := n+1; insert into public.control_catalogue_controls(catalogue_version_id,code,title,theme,position) values('40000000-0000-4000-8000-000000000001','6.'||n,item,'people',offset_position+n); end loop;
  offset_position := offset_position+n; n := 0;
  titles := array['Protected site boundaries','Controlled entry to secure areas','Protection of offices and facilities','Monitoring of physical locations','Protection from environmental threats','Working securely in restricted areas','Clear workspace and locked screens','Safe placement of equipment','Protection of equipment away from premises','Managed storage media','Resilient supporting utilities','Protected power and data cabling','Secure equipment maintenance','Secure disposal or reuse of equipment'];
  foreach item in array titles loop n := n+1; insert into public.control_catalogue_controls(catalogue_version_id,code,title,theme,position) values('40000000-0000-4000-8000-000000000001','7.'||n,item,'physical',offset_position+n); end loop;
  offset_position := offset_position+n; n := 0;
  titles := array['Protected end-user devices','Privileged access restrictions','Information access restrictions','Protection of source code access','Strong authentication methods','Managed technology capacity','Protection against malicious software','Technology vulnerability management','Secure configuration baselines','Safe information deletion','Data masking where appropriate','Controls against unintended data loss','Resilient information backups','Resilient processing facilities','Security event logging','Monitoring for suspicious activity','Consistent system time','Controlled use of powerful utilities','Controlled software installation','Network security safeguards','Secure delivery of network services','Network service separation','Protection from harmful web content','Appropriate use of cryptography','Secure development lifecycle','Application security requirements','Secure architecture principles','Secure software construction','Security testing before acceptance','Governed outsourced development','Separated development and production','Controlled technology changes','Protection of test information','Safeguards during assurance testing'];
  foreach item in array titles loop n := n+1; insert into public.control_catalogue_controls(catalogue_version_id,code,title,theme,position) values('40000000-0000-4000-8000-000000000001','8.'||n,item,'technological',offset_position+n); end loop;
end $$;

insert into public.assessment_control_mappings (catalogue_question_id, control_id, rationale)
select q.id, c.id, 'Readiness evidence informs review of this control.'
from public.catalogue_questions q join public.control_catalogue_controls c on c.code = case q.code
  when 'GOV-01' then '5.1' when 'GOV-02' then '5.2' when 'RISK-01' then '5.7'
  when 'RISK-02' then '5.8' when 'OPS-01' then '5.18' when 'OPS-02' then '8.13'
  when 'OPS-03' then '6.8' when 'ASSURE-01' then '5.36' when 'ASSURE-02' then '5.35'
  when 'ASSURE-03' then '5.27' end
where q.catalogue_version_id = '00000000-0000-4000-8000-000000000001';

create trigger control_catalogue_versions_immutable before update or delete on public.control_catalogue_versions
for each statement execute function public.reject_immutable_change('control catalogue versions are immutable');
create trigger control_catalogue_controls_immutable before update or delete on public.control_catalogue_controls
for each statement execute function public.reject_immutable_change('control catalogue controls are immutable');
create trigger assessment_control_mappings_immutable before update or delete on public.assessment_control_mappings
for each statement execute function public.reject_immutable_change('assessment control mappings are immutable');

alter table public.control_catalogue_versions enable row level security;
alter table public.control_catalogue_controls enable row level security;
alter table public.assessment_control_mappings enable row level security;
create policy control_catalogue_versions_read on public.control_catalogue_versions for select to authenticated using (published_at is not null);
create policy control_catalogue_controls_read on public.control_catalogue_controls for select to authenticated using (exists(select 1 from public.control_catalogue_versions v where v.id=catalogue_version_id and v.published_at is not null));
create policy assessment_control_mappings_read on public.assessment_control_mappings for select to authenticated using (true);
grant select on public.control_catalogue_versions, public.control_catalogue_controls, public.assessment_control_mappings to authenticated;

alter table public.soa_registers add column control_catalogue_version_id uuid references public.control_catalogue_versions(id) on delete restrict;
update public.soa_registers set control_catalogue_version_id = '40000000-0000-4000-8000-000000000001';
alter table public.soa_registers alter column control_catalogue_version_id set not null;
alter table public.soa_registers
  add constraint soa_registers_id_org_key unique (id, organisation_id),
  add constraint soa_registers_assessment_tenant_fk foreign key (assessment_session_id, organisation_id)
    references public.assessment_sessions(id, organisation_id) on delete restrict;

alter table public.soa_items add column control_catalogue_version_id uuid, add column control_id uuid;
update public.soa_items i set control_catalogue_version_id = r.control_catalogue_version_id
from public.soa_registers r where r.id=i.soa_register_id;
update public.soa_items i set control_id=c.id from public.control_catalogue_controls c
where c.catalogue_version_id=i.control_catalogue_version_id and c.code=i.control_code;
alter table public.soa_items alter column control_catalogue_version_id set not null, alter column control_id set not null;
alter table public.soa_items
  add constraint soa_items_register_tenant_fk foreign key (soa_register_id, organisation_id)
    references public.soa_registers(id, organisation_id) on delete cascade,
  add constraint soa_items_control_version_fk foreign key (control_id, control_catalogue_version_id)
    references public.control_catalogue_controls(id, catalogue_version_id) on delete restrict;

alter table public.soa_snapshots add column control_catalogue_version_id uuid references public.control_catalogue_versions(id) on delete restrict;
alter table public.soa_snapshots disable trigger soa_snapshots_immutable;
update public.soa_snapshots s set control_catalogue_version_id=r.control_catalogue_version_id from public.soa_registers r where r.id=s.soa_register_id;
alter table public.soa_snapshots enable trigger soa_snapshots_immutable;
alter table public.soa_snapshots alter column control_catalogue_version_id set not null;
alter table public.soa_snapshots
  add constraint soa_snapshots_register_tenant_fk foreign key (soa_register_id, organisation_id)
    references public.soa_registers(id, organisation_id) on delete restrict,
  add constraint soa_snapshots_assessment_tenant_fk foreign key (assessment_session_id, organisation_id)
    references public.assessment_sessions(id, organisation_id) on delete restrict;

alter table public.risks
  add constraint risks_owner_tenant_fk foreign key (organisation_id, owner_id)
    references public.memberships(organisation_id, user_id) on delete set null,
  add constraint risks_assessment_tenant_fk foreign key (source_assessment_session_id, organisation_id)
    references public.assessment_sessions(id, organisation_id) on delete set null,
  add constraint risks_soa_tenant_fk foreign key (source_soa_register_id, organisation_id)
    references public.soa_registers(id, organisation_id) on delete set null;

create or replace function public.save_assessment_response(
  target_session_id uuid, target_question_id uuid, target_answer public.assessment_answer,
  target_evidence_note text, expected_revision bigint
) returns bigint language plpgsql security definer set search_path = '' as $$
declare current_revision bigint; target_org uuid; target_catalogue uuid;
begin
  if char_length(coalesce(target_evidence_note, '')) > 10000 then raise exception 'evidence note is too long'; end if;
  select organisation_id, catalogue_version_id into target_org, target_catalogue from public.assessment_sessions where id=target_session_id;
  if not found or not public.is_organisation_member(target_org) then raise exception 'assessment not found' using errcode='42501'; end if;
  if not exists(select 1 from public.catalogue_questions q where q.id=target_question_id and q.catalogue_version_id=target_catalogue) then raise exception 'question does not belong to assessment catalogue'; end if;
  update public.assessment_sessions set revision=revision+1,updated_at=now()
    where id=target_session_id and revision=expected_revision and state='draft' returning revision into current_revision;
  if not found then raise exception 'assessment revision conflict' using errcode='40001'; end if;
  insert into public.assessment_responses(organisation_id,session_id,question_id,catalogue_version_id,answer,evidence_note,updated_by)
    values(target_org,target_session_id,target_question_id,target_catalogue,target_answer,coalesce(target_evidence_note,''),(select auth.uid()))
    on conflict(session_id,question_id) do update set answer=excluded.answer,evidence_note=excluded.evidence_note,updated_by=excluded.updated_by,updated_at=now();
  return current_revision;
end $$;
revoke all on function public.save_assessment_response(uuid,uuid,public.assessment_answer,text,bigint) from public;
grant execute on function public.save_assessment_response(uuid,uuid,public.assessment_answer,text,bigint) to authenticated;

create or replace function public.create_organisation_with_owner(organisation_name text, organisation_slug text)
returns uuid language plpgsql security definer set search_path='' as $$
declare result_id uuid; actor uuid := (select auth.uid());
begin
  if actor is null then raise exception 'authentication required' using errcode='42501'; end if;
  if char_length(btrim(organisation_name)) not between 1 and 160 or organisation_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then raise exception 'invalid organisation details' using errcode='22023'; end if;
  insert into public.organisations(name,slug,created_by) values(btrim(organisation_name),organisation_slug,actor) returning id into result_id;
  insert into public.memberships(organisation_id,user_id,role) values(result_id,actor,'owner');
  return result_id;
end $$;
revoke all on function public.create_organisation_with_owner(text,text) from public;
grant execute on function public.create_organisation_with_owner(text,text) to authenticated;

create or replace function public.create_soa_draft(target_assessment_id uuid, draft_title text)
returns uuid language plpgsql security definer set search_path='' as $$
declare result_id uuid; target_org uuid; next_version integer; actor uuid := (select auth.uid()); control_version constant uuid := '40000000-0000-4000-8000-000000000001'::uuid;
begin
  select organisation_id into target_org from public.assessment_sessions where id=target_assessment_id;
  if not found or not public.is_organisation_member(target_org) then raise exception 'assessment not found' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_org::text, 0));
  select coalesce(max(version),0)+1 into next_version from public.soa_registers where organisation_id=target_org;
  insert into public.soa_registers(organisation_id,assessment_session_id,control_catalogue_version_id,version,title,created_by)
    values(target_org,target_assessment_id,control_version,next_version,btrim(draft_title),actor) returning id into result_id;
  insert into public.soa_items(organisation_id,soa_register_id,control_catalogue_version_id,control_id,control_code,control_title,position)
    select target_org,result_id,c.catalogue_version_id,c.id,c.code,c.title,c.position-1 from public.control_catalogue_controls c where c.catalogue_version_id=control_version order by c.position;
  return result_id;
end $$;
revoke all on function public.create_soa_draft(uuid,text) from public;
grant execute on function public.create_soa_draft(uuid,text) to authenticated;

create or replace function public.create_soa_successor(source_snapshot_id uuid, successor_title text)
returns uuid language plpgsql security definer set search_path='' as $$
declare source_row public.soa_snapshots; result_id uuid; next_version integer; actor uuid := (select auth.uid());
begin
  select * into source_row from public.soa_snapshots where id=source_snapshot_id;
  if not found or not public.is_organisation_member(source_row.organisation_id) then raise exception 'SoA snapshot not found' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(source_row.organisation_id::text, 0));
  select coalesce(max(version),0)+1 into next_version from public.soa_registers where organisation_id=source_row.organisation_id;
  insert into public.soa_registers(organisation_id,assessment_session_id,control_catalogue_version_id,version,title,created_by)
    values(source_row.organisation_id,source_row.assessment_session_id,source_row.control_catalogue_version_id,next_version,btrim(successor_title),actor) returning id into result_id;
  insert into public.soa_items(organisation_id,soa_register_id,control_catalogue_version_id,control_id,control_code,control_title,applicable,status,justification,evidence,position)
    select i.organisation_id,result_id,i.control_catalogue_version_id,i.control_id,i.control_code,i.control_title,i.applicable,i.status,i.justification,i.evidence,i.position
    from public.soa_items i where i.soa_register_id=source_row.soa_register_id order by i.position;
  return result_id;
end $$;
revoke all on function public.create_soa_successor(uuid,text) from public;
grant execute on function public.create_soa_successor(uuid,text) to authenticated;

create or replace function public.prevent_finalised_soa_changes()
returns trigger language plpgsql security definer set search_path='' as $$
declare register_id uuid := case when tg_table_name='soa_registers' then old.id else coalesce(old.soa_register_id,new.soa_register_id) end;
begin
  if exists(select 1 from public.soa_snapshots s where s.soa_register_id=register_id) then raise exception 'finalised SoA source records are immutable'; end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger soa_registers_finalised_immutable before update or delete on public.soa_registers for each row execute function public.prevent_finalised_soa_changes();
create trigger soa_items_finalised_immutable before insert or update or delete on public.soa_items for each row execute function public.prevent_finalised_soa_changes();

create or replace function public.finalise_soa(target_register_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare result_id uuid; register_row public.soa_registers; item_count integer;
begin
  select * into register_row from public.soa_registers where id=target_register_id for update;
  if not found or not public.is_organisation_member(register_row.organisation_id) then raise exception 'SoA register not found' using errcode='42501'; end if;
  if exists(select 1 from public.soa_snapshots where soa_register_id=target_register_id) then raise exception 'SoA is already finalised' using errcode='23505'; end if;
  select count(*) into item_count from public.soa_items where soa_register_id=target_register_id;
  if item_count <> 93 then raise exception 'SoA must contain the complete 93-control catalogue'; end if;
  if exists(select 1 from public.soa_items where soa_register_id=target_register_id and btrim(justification)='') then raise exception 'Every SoA item requires a justification'; end if;
  insert into public.soa_snapshots(organisation_id,soa_register_id,assessment_session_id,catalogue_version_id,control_catalogue_version_id,version,organisation_name,title,items,finalised_by)
  select r.organisation_id,r.id,r.assessment_session_id,s.catalogue_version_id,r.control_catalogue_version_id,r.version,o.name,r.title,
    jsonb_agg(jsonb_build_object('controlCode',i.control_code,'controlTitle',i.control_title,'applicable',i.applicable,'status',i.status,'justification',i.justification,'evidence',i.evidence) order by i.position),(select auth.uid())
  from public.soa_registers r join public.organisations o on o.id=r.organisation_id join public.assessment_sessions s on s.id=r.assessment_session_id join public.soa_items i on i.soa_register_id=r.id
  where r.id=target_register_id group by r.organisation_id,r.id,r.assessment_session_id,s.catalogue_version_id,r.control_catalogue_version_id,r.version,o.name,r.title returning id into result_id;
  return result_id;
end $$;
revoke all on function public.finalise_soa(uuid) from public;
grant execute on function public.finalise_soa(uuid) to authenticated;
