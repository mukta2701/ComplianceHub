-- Keep the audit actor on risk-matrix updates bound to the authenticated user,
-- matching the insert policy and the other owner-edited workspace settings.
drop policy if exists risk_matrix_config_members_update on public.risk_matrix_config;
create policy risk_matrix_config_members_update on public.risk_matrix_config for update to authenticated
using (public.is_organisation_operator(organisation_id))
with check (public.is_organisation_operator(organisation_id) and updated_by = (select auth.uid()));
