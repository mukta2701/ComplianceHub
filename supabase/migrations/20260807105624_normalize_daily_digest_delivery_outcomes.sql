-- Parent delivery rows predate the stricter attempt-outcome contract. Bring
-- any legacy free-form error code into the same closed set before validating a
-- status-specific invariant. Attempt rows are immutable and are not rewritten.
alter table public.daily_digest_deliveries
  add constraint daily_digest_deliveries_outcome_consistency check ((
    (status = 'reserved' and error_code is null)
    or (status = 'delivered' and error_code is null)
    or (
      status = 'failed'
      and error_code in ('SLACK_REJECTED','RATE_LIMITED','NO_DIGEST_CHANNEL','INTERNAL_ERROR')
    )
    or (status = 'unknown' and error_code = 'DELIVERY_UNKNOWN')
  ) is true) not valid;

-- The lifecycle trigger correctly rejects ordinary same-state rewrites. A
-- one-time migration is the sole exception, while the audit trigger remains
-- enabled so every corrected parent is still recorded.
alter table public.daily_digest_deliveries
  disable trigger daily_digest_deliveries_protect;

update public.daily_digest_deliveries
set error_code = case
  when status in ('reserved','delivered') then null
  when status = 'failed'
    and error_code in ('SLACK_REJECTED','RATE_LIMITED','NO_DIGEST_CHANNEL','INTERNAL_ERROR')
    then error_code
  when status = 'failed' then 'INTERNAL_ERROR'
  when status = 'unknown' then 'DELIVERY_UNKNOWN'
end
where error_code is distinct from case
  when status in ('reserved','delivered') then null
  when status = 'failed'
    and error_code in ('SLACK_REJECTED','RATE_LIMITED','NO_DIGEST_CHANNEL','INTERNAL_ERROR')
    then error_code
  when status = 'failed' then 'INTERNAL_ERROR'
  when status = 'unknown' then 'DELIVERY_UNKNOWN'
end;

alter table public.daily_digest_deliveries
  enable trigger daily_digest_deliveries_protect;

alter table public.daily_digest_deliveries
  validate constraint daily_digest_deliveries_outcome_consistency;
