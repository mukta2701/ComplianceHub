-- §4.3 in-app notifications. Written only by the daily sweep (service role);
-- users read their own rows and mark them read. Email digests are deferred.

create table public.notifications (
  id bigint generated always as identity primary key,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (char_length(kind) between 1 and 80),
  subject_type text not null check (char_length(subject_type) between 1 and 80),
  subject_id text not null check (char_length(subject_id) <= 128),
  message text not null check (char_length(message) between 1 and 500),
  sweep_on date not null default current_date,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_membership_fk foreign key (organisation_id, user_id)
    references public.memberships(organisation_id, user_id) on delete cascade
);
create index notifications_user_unread_idx on public.notifications(user_id) where read_at is null;
alter table public.notifications add constraint notifications_dedup_day_key
  unique (user_id, kind, subject_type, subject_id, sweep_on);

create trigger notifications_audit after insert or update on public.notifications
for each row execute function public.capture_audit_event();

alter table public.notifications enable row level security;
create policy notifications_select_own on public.notifications for select to authenticated
using (user_id = (select auth.uid()));
create policy notifications_update_own on public.notifications for update to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
