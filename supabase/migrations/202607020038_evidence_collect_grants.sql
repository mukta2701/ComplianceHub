-- B3 Stage 2: the evidence-collection cron (/api/cron/evidence-collect) is the
-- first service_role reader of public.evidence_sources. 202607020009 already
-- granted service_role select/insert/update on public.evidence (the daily sweep
-- reads + ages evidence; that insert covers the collector's inserts too), and the
-- collector never updates a stored evidence row (immutability guard — it only
-- inserts new items and no-op-skips dupes), so evidence needs no new grant.
-- evidence_sources, however, has never been granted to service_role: the source
-- table's own migration granted only authenticated. Grant exactly the one verb
-- the cron performs — SELECT — nothing else, keeping the least-privilege
-- convention. RLS is bypassed by service_role; the cron scopes every insert by
-- the source's organisation_id per row, and the evidence audit trigger still fires.

grant select on public.evidence_sources to service_role;
