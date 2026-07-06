-- Phase D2: the link between a task and its external tracker ticket. Written by
-- the push action (Task 13) and updated by the poll cron (Task 15). Members see
-- the ticket status chip (split member RLS), while the connection that holds the
-- token stays owner-only (Task 9). task_id / connection_id are composite tenant
-- FKs. unique (task_id, connection_id) prevents duplicate tickets per tracker.

create table public.task_tickets (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  task_id uuid not null,
  connection_id uuid not null,
  provider public.integration_provider not null,
  external_id text not null check (char_length(external_id) between 1 and 200),
  external_url text not null default '' check (char_length(external_url) <= 2000),
  external_status text not null default '' check (char_length(external_status) <= 120),
  external_assignee text check (char_length(external_assignee) <= 200),
  last_synced_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organisation_id),
  unique (task_id, connection_id),
  constraint task_tickets_task_tenant_fk foreign key (task_id, organisation_id)
    references public.tasks(id, organisation_id) on delete cascade,
  constraint task_tickets_connection_tenant_fk foreign key (connection_id, organisation_id)
    references public.integration_connections(id, organisation_id) on delete cascade
);
create index task_tickets_org_sync_idx on public.task_tickets(organisation_id, last_synced_at);

create trigger task_tickets_audit after insert or update or delete on public.task_tickets
for each row execute function public.capture_audit_event();

alter table public.task_tickets enable row level security;
create policy task_tickets_members_select on public.task_tickets for select to authenticated
using (public.is_organisation_member(organisation_id));
create policy task_tickets_members_insert on public.task_tickets for insert to authenticated
with check (public.is_organisation_member(organisation_id) and created_by = (select auth.uid()));
create policy task_tickets_members_update on public.task_tickets for update to authenticated
using (public.is_organisation_member(organisation_id)) with check (public.is_organisation_member(organisation_id));
create policy task_tickets_members_delete on public.task_tickets for delete to authenticated
using (public.is_organisation_member(organisation_id));

revoke all on public.task_tickets from anon, authenticated;
grant select, insert, update, delete on public.task_tickets to authenticated;
