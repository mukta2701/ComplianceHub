-- Risk-matrix thresholds are workspace configuration, not member-owned data.
-- Keep reads member-visible, but require an operator for every mutation so a
-- member cannot create or delete the row that controls the workspace's RAG
-- bands and appetite threshold.
drop policy if exists risk_matrix_config_members_insert on public.risk_matrix_config;
create policy risk_matrix_config_members_insert on public.risk_matrix_config
for insert to authenticated
with check (
  public.is_organisation_operator(organisation_id)
  and updated_by = (select auth.uid())
);

drop policy if exists risk_matrix_config_members_delete on public.risk_matrix_config;
create policy risk_matrix_config_members_delete on public.risk_matrix_config
for delete to authenticated
using (public.is_organisation_operator(organisation_id));
