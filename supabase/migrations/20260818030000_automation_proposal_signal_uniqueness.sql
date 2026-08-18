-- A signal can produce at most one review proposal.  The collector is
-- idempotent and relies on this boundary to recover safely from concurrent
-- workers or a proposal write that was interrupted after the signal commit.
create unique index automation_proposals_one_per_signal_idx
  on public.automation_proposals (organisation_id, signal_id)
  where signal_id is not null;
