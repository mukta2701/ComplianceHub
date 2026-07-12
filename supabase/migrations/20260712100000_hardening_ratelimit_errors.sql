-- Production hardening: durable rate limiting + a self-hosted error log.
-- Both tables are service-role-only. The rate-limit counter is incremented
-- atomically through a SECURITY DEFINER function so the locked-down table stays
-- inaccessible to clients while the app can still count. This replaces the
-- per-instance in-memory limiter, which reset on every serverless isolate and so
-- gave effectively no brute-force protection in production.

create table if not exists public.rate_limit_counters (
  key text primary key,
  count integer not null default 0,
  expires_at timestamptz not null
);
create index if not exists rate_limit_counters_expiry_idx on public.rate_limit_counters(expires_at);
alter table public.rate_limit_counters enable row level security;
-- No policies on purpose: only the SECURITY DEFINER function (and service_role) touch it.
revoke all on public.rate_limit_counters from anon, authenticated;

-- Atomic fixed-window increment. Resets the window when the stored one has
-- expired, otherwise bumps the count. Returns the count within the current window.
-- (create-or-replace so this migration is safe to apply via the dashboard too.)
create or replace function public.increment_rate_limit(p_key text, p_window_ms integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  insert into public.rate_limit_counters as r (key, count, expires_at)
  values (p_key, 1, now() + make_interval(secs => p_window_ms / 1000.0))
  on conflict (key) do update
    set count = case when r.expires_at <= now() then 1 else r.count + 1 end,
        expires_at = case when r.expires_at <= now() then now() + make_interval(secs => p_window_ms / 1000.0) else r.expires_at end
  returning r.count into v_count;
  return v_count;
end $$;
revoke all on function public.increment_rate_limit(text, integer) from public;
grant execute on function public.increment_rate_limit(text, integer) to service_role;

-- Self-hosted error log (no third-party error tracker). Written server-side by the
-- logger and the /api/observability route; queryable by an operator via the
-- service role. Never readable or writable by app users.
create table if not exists public.app_errors (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  source text not null check (char_length(source) between 1 and 40),
  message text not null check (char_length(message) between 1 and 2000),
  detail text check (detail is null or char_length(detail) <= 20000),
  context jsonb not null default '{}'::jsonb
);
create index if not exists app_errors_occurred_idx on public.app_errors(occurred_at desc);
alter table public.app_errors enable row level security;
revoke all on public.app_errors from anon, authenticated;
grant insert, select on public.app_errors to service_role;
