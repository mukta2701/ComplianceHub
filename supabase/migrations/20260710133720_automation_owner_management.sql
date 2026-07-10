drop policy connector_connections_manage_owners on public.connector_connections;
create policy connector_connections_insert_owners on public.connector_connections for insert to authenticated
with check (public.is_organisation_owner(organisation_id) and connected_by = (select auth.uid()));
create policy connector_connections_update_owners on public.connector_connections for update to authenticated
using (public.is_organisation_owner(organisation_id))
with check (public.is_organisation_owner(organisation_id));
create policy connector_connections_delete_owners on public.connector_connections for delete to authenticated
using (public.is_organisation_owner(organisation_id));

drop policy automation_assignments_manage_owners on public.automation_assignments;
create policy automation_assignments_insert_owners on public.automation_assignments for insert to authenticated
with check (public.is_organisation_owner(organisation_id) and assigned_by = (select auth.uid()));
create policy automation_assignments_update_owners on public.automation_assignments for update to authenticated
using (public.is_organisation_owner(organisation_id))
with check (public.is_organisation_owner(organisation_id));
create policy automation_assignments_delete_owners on public.automation_assignments for delete to authenticated
using (public.is_organisation_owner(organisation_id));
