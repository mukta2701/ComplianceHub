import { describe, expect, it } from "vitest";
import { fakeEvidenceProvider } from "./evidence-provider";
import type { EvidenceSourceConnection } from "./evidence-provider";
import { toEvidenceRow } from "./evidence-collection";

function conn(provider: EvidenceSourceConnection["provider"], config: Record<string, unknown> = {}): EvidenceSourceConnection {
  return { id: "src-1", provider, config, accessToken: "t" };
}

describe("fakeEvidenceProvider.collect", () => {
  it("returns a stable, deterministic sample set per provider", async () => {
    const items = await fakeEvidenceProvider.collect(conn("github"));
    expect(items.map((i) => i.title)).toEqual(["Branch protection settings", "Dependabot alerts summary"]);
    for (const item of items) {
      expect(item.externalRef).toMatch(/^AUTO-/);
      expect(item.collectedOn).toBe("2026-01-01");
      // github window is 30 days from the collection baseline.
      expect(item.validUntil).toBe("2026-01-31");
    }
  });

  it("derives collectedOn/validUntil from config.asOf so dates are deterministic", async () => {
    const items = await fakeEvidenceProvider.collect(conn("google_workspace", { asOf: "2026-03-10" }));
    expect(items.every((i) => i.collectedOn === "2026-03-10")).toBe(true);
    // google_workspace window is 90 days.
    expect(items.every((i) => i.validUntil === "2026-06-08")).toBe(true);
  });

  it("yields identical externalRefs on re-collection (upsert-by-externalRef)", async () => {
    const first = await fakeEvidenceProvider.collect(conn("aws"));
    const second = await fakeEvidenceProvider.collect(conn("aws"));
    expect(first.map((i) => i.externalRef)).toEqual(second.map((i) => i.externalRef));
  });

  it("gives different providers distinct externalRefs for their items", async () => {
    const gws = await fakeEvidenceProvider.collect(conn("google_workspace"));
    const gh = await fakeEvidenceProvider.collect(conn("github"));
    const overlap = gws.some((g) => gh.some((h) => h.externalRef === g.externalRef));
    expect(overlap).toBe(false);
  });
});

describe("toEvidenceRow", () => {
  it("maps a link item to a url-bearing evidence row", async () => {
    const [link] = await fakeEvidenceProvider.collect(conn("github"));
    const row = toEvidenceRow(link, { organisationId: "org-1", sourceId: "src-1" });
    expect(row).toEqual({
      organisation_id: "org-1",
      title: "Branch protection settings",
      kind: "link",
      url: "https://github.local/settings/branches",
      description: "",
      status: "current",
      collected_on: "2026-01-01",
      valid_until: "2026-01-31",
      source_id: "src-1",
      external_ref: link.externalRef,
    });
  });

  it("maps a note item into description with a null url", async () => {
    const items = await fakeEvidenceProvider.collect(conn("aws"));
    const note = items.find((i) => i.kind === "note")!;
    const row = toEvidenceRow(note, { organisationId: "org-1", sourceId: "src-9" });
    expect(row.kind).toBe("note");
    expect(row.url).toBeNull();
    expect(row.description).toBe(note.note);
    expect(row.source_id).toBe("src-9");
    expect(row.external_ref).toBe(note.externalRef);
  });

  it("round-trips a re-collection to the same dedup key", async () => {
    const [a] = await fakeEvidenceProvider.collect(conn("google_workspace"));
    const [b] = await fakeEvidenceProvider.collect(conn("google_workspace"));
    const rowA = toEvidenceRow(a, { organisationId: "org-1", sourceId: "src-1" });
    const rowB = toEvidenceRow(b, { organisationId: "org-1", sourceId: "src-1" });
    expect([rowA.source_id, rowA.external_ref]).toEqual([rowB.source_id, rowB.external_ref]);
  });
});
