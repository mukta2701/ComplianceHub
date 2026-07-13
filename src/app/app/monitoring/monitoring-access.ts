import { hasCapability, type MembershipRole } from "@/features/organisations/domain/access";

export function shouldShowRunMonitoring(role: MembershipRole, sourceCount: number): boolean {
  return sourceCount > 0 && hasCapability(role, "run_monitoring");
}
