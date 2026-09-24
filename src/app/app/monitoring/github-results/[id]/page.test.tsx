import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const RESULT_ID = "70000000-0000-4000-8000-000000000001";
const ORGANISATION_ID = "20000000-0000-4000-8000-000000000001";
const hoisted = vi.hoisted(() => ({ loadResult: vi.fn() }));

vi.mock("@/lib/app-context", () => ({
  requireAppContext: () => Promise.resolve({
    supabase: {},
    organisation: { id: ORGANISATION_ID, name: "Example workspace" },
    membership: { role: "member" },
  }),
}));
vi.mock("@/features/github/application/github-record-provenance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/github/application/github-record-provenance")>();
  return { ...actual, loadOfficialGitHubComplianceResult: hoisted.loadResult };
});
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));

import GitHubOfficialResultDetailPage from "./page";

const result = {
  resultId: RESULT_ID,
  outcome: "unknown" as const,
  failureSeverity: null,
  repository: { id: "50000000-0000-4000-8000-000000000001", name: "mukta2701/ComplianceHub", url: "https://github.com/mukta2701/ComplianceHub" },
  checkId: "github.branch.force_pushes",
  catalogueSummary: "The recorded observation could not verify this check.",
  observedAt: "2026-08-25T08:00:00.000Z",
  freshUntil: "2026-08-26T08:00:00.000Z",
  materialisedAt: "2026-08-25T08:01:00.000Z",
  freshness: "stale" as const,
  ruleVersion: "github-repository-v1",
  mappingVersion: "github-iso-27001-v1",
  mappingChecksum: "b".repeat(64),
  isoControlReferences: ["A.8.25"],
};

describe("GitHub official result deep link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.loadResult.mockResolvedValue(result);
  });

  it("lets a member open an exact recorded Unknown and explains freshness limits", async () => {
    render(await GitHubOfficialResultDetailPage({ params: Promise.resolve({ id: RESULT_ID }) }));

    expect(hoisted.loadResult).toHaveBeenCalledWith({}, ORGANISATION_ID, RESULT_ID);
    expect(screen.getByRole("heading", { name: "Recorded GitHub check" })).toBeVisible();
    expect(screen.getByText("Could not be verified at observation")).toBeVisible();
    expect(screen.getByText("Freshness window expired")).toBeVisible();
    expect(screen.getByText(/does not prove today's compliance/)).toBeVisible();
    expect(screen.getByText(RESULT_ID)).toBeVisible();
    expect(screen.getByRole("link", { name: "Open today's Monitoring status" })).toHaveAttribute("href", "/app/monitoring");
    expect(screen.getByRole("link", { name: /mukta2701\/ComplianceHub/ })).toHaveAttribute("href", "https://github.com/mukta2701/ComplianceHub");
    expect(screen.queryByText(/provider_payload|raw GitHub payload/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/compliant|certified/i)).not.toBeInTheDocument();
  });

  it("hides malformed and outside-workspace IDs behind the same not-found response", async () => {
    await expect(GitHubOfficialResultDetailPage({ params: Promise.resolve({ id: "not-a-uuid" }) }))
      .rejects.toThrow("NOT_FOUND");
    expect(hoisted.loadResult).not.toHaveBeenCalled();

    hoisted.loadResult.mockResolvedValueOnce(null);
    await expect(GitHubOfficialResultDetailPage({ params: Promise.resolve({ id: "70000000-0000-4000-8000-000000000099" }) }))
      .rejects.toThrow("NOT_FOUND");
  });
});
