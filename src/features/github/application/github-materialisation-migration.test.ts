import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  `${process.cwd()}/supabase/migrations/20260824184628_github_compliance_materialisation.sql`,
  "utf8",
);
const migrationDirectory = `${process.cwd()}/supabase/migrations`;
const notYetAppliedMigrations = readdirSync(migrationDirectory)
  .filter((name) => name.endsWith(".sql") && name >= "20260824184628_github_compliance_materialisation.sql")
  .sort();

function tableDefinition(name: string): string {
  const start = migration.indexOf(`create table public.${name} (`);
  const end = migration.indexOf("\n);", start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return migration.slice(start, end + 3);
}

describe("GitHub compliance materialisation migration", () => {
  it("declares the finding identity shape once under its explicit constraint name", () => {
    const findingProvenance = tableDefinition("github_finding_provenance");

    expect(findingProvenance).toContain("identity_key text not null,");
    expect(findingProvenance).toContain("constraint github_finding_provenance_identity_key_check check (");
    expect(findingProvenance.match(/github_finding_provenance_identity_key_check/g)).toHaveLength(1);
  });

  it("does not duplicate an automatic column-check name in related provenance tables", () => {
    const evidenceProvenance = tableDefinition("github_evidence_provenance");
    const findingProvenance = tableDefinition("github_finding_provenance");

    expect(evidenceProvenance).not.toContain("github_evidence_provenance_identity_key_check");
    expect(findingProvenance).not.toContain(
      "identity_key text not null check (identity_key ~ '^[0-9a-f]{64}$')",
    );
  });

  it.each(notYetAppliedMigrations)("uses SQL COALESCE syntax in portable pending migration %s", (name) => {
    const sql = readFileSync(`${migrationDirectory}/${name}`, "utf8");

    expect(sql).not.toMatch(/\bpg_catalog\.coalesce\s*\(/i);
  });
});
