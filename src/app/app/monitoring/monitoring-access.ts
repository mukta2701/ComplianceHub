import type { MembershipRole } from "@/features/organisations/domain/access";
import { workspaceAccess } from "@/features/organisations/domain/workspace-access";

export function shouldShowRunMonitoring(role: MembershipRole, sourceCount: number): boolean {
  return sourceCount > 0 && workspaceAccess(role).section("monitoring").canManageOperation("run-monitoring");
}
