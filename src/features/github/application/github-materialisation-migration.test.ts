import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  `${process.cwd()}/supabase/migrations/20260824184628_github_compliance_materialisation.sql`,
  "utf8",
);
const migrationDirectory = `${process.cwd()}/supabase/migrations`;
const enumMigrationName = "20260824184627_github_compliance_enum_values.sql";
const enumMigrationPath = `${migrationDirectory}/${enumMigrationName}`;
const notYetAppliedMigrations = readdirSync(migrationDirectory)
  .filter((name) => name.endsWith(".sql") && name >= enumMigrationName)
  .sort();

function tableDefinition(name: string): string {
  const start = migration.indexOf(`create table public.${name} (`);
  const end = migration.indexOf("\n);", start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return migration.slice(start, end + 3);
}

describe("GitHub compliance materialisation migration", () => {
  it("commits GitHub enum values before the materialisation migration uses them", () => {
    expect(existsSync(enumMigrationPath)).toBe(true);

    const enumMigration = readFileSync(enumMigrationPath, "utf8");
    expect(enumMigration).toMatch(
      /alter type public\.monitor_finding_status\s+add value if not exists 'in_progress' after 'acknowledged';/,
    );
    expect(enumMigration).toMatch(
      /alter type public\.monitor_finding_status\s+add value if not exists 'exception_requested' after 'in_progress';/,
    );
    expect(enumMigration).toMatch(
      /alter type public\.monitor_finding_status\s+add value if not exists 'risk_accepted' after 'exception_requested';/,
    );
    expect(enumMigration).toMatch(/alter type public\.task_source add value if not exists 'github';/);
    expect(enumMigration).not.toMatch(/\b(?:create|alter table|insert|update|delete)\b/i);
    expect(migration).not.toMatch(/alter type public\.(?:monitor_finding_status|task_source)\b/i);

    const migrations = readdirSync(migrationDirectory)
      .filter((name) => name.endsWith(".sql"))
      .sort();
    expect(migrations.indexOf(enumMigrationName)).toBe(
      migrations.indexOf("20260824184628_github_compliance_materialisation.sql") - 1,
    );
  });

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

  it.each(notYetAppliedMigrations)("uses SQL syntax for portable pending migration %s", (name) => {
    const sql = readFileSync(`${migrationDirectory}/${name}`, "utf8");

    expect(sql).not.toMatch(/\bpg_catalog\.(?:coalesce|greatest|least)\s*\(/i);
  });
});
