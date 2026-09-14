import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationDirectory = join(process.cwd(), "supabase/migrations");

function successorMigration(): string {
  const matches = readdirSync(migrationDirectory)
    .filter((name) => name.endsWith("_owner_only_github_installation_claim.sql"));
  expect(matches).toHaveLength(1);
  return readFileSync(join(migrationDirectory, matches[0]!), "utf8");
}

describe("Owner-only GitHub installation claim successor", () => {
  it("locks and revalidates the exact Owner around the installation lock", () => {
    const sql = successorMigration();
    const functionStart = sql.indexOf("create or replace function public.claim_github_installation_server");
    const membershipLock = sql.indexOf("membership.role = 'owner'", functionStart);
    const installationLock = sql.indexOf("from public.github_installations", membershipLock);
    const secondOwnerCheck = sql.indexOf("membership.role = 'owner'", installationLock);

    expect(functionStart).toBeGreaterThanOrEqual(0);
    expect(membershipLock).toBeGreaterThan(functionStart);
    expect(sql.slice(membershipLock, installationLock)).toMatch(/for update/i);
    expect(installationLock).toBeGreaterThan(membershipLock);
    expect(secondOwnerCheck).toBeGreaterThan(installationLock);
    expect(sql.slice(secondOwnerCheck)).toMatch(/for update/i);
    expect(sql).not.toMatch(/membership\.role in \('owner', 'admin'\)/);
  });

  it("preserves the service-only signature and explicit grants", () => {
    const sql = successorMigration();
    expect(sql).toMatch(/security definer\s+set search_path = ''/i);
    expect(sql).toContain("revoke all on function public.claim_github_installation_server(");
    expect(sql).toContain("from public, anon, authenticated, service_role");
    expect(sql).toContain("grant execute on function public.claim_github_installation_server(");
    expect(sql).toContain("to service_role");
  });
});
