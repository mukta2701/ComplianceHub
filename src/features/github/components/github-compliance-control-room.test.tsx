import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { STANDARD_GITHUB_ISO_MAPPING_PACK } from "../domain/mapping";
import type { GitHubComplianceControlRoom } from "../application/github-compliance-control-room";
import type { GitHubMappingReview } from "../application/github-mapping-review";

const hoisted = vi.hoisted(() => ({
  approve: vi.fn(), recordDecision: vi.fn(), revoke: vi.fn(), process: vi.fn(), retry: vi.fn(), refresh: vi.fn(),
}));
vi.mock("@/app/app/monitoring/github-control-room-actions", () => ({
  approveGitHubMappingPackAction: hoisted.approve,
  recordGitHubMappingEntryDecisionAction: hoisted.recordDecision,
  revokeGitHubMappingApprovalAction: hoisted.revoke,
  processApprovedGitHubResultsAction: hoisted.process,
  retryExhaustedGitHubMaterialisationAction: hoisted.retry,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: hoisted.refresh }) }));

import { GitHubComplianceControlRoomPanel } from "./github-compliance-control-room";
import { GitHubOfficialResultSummary } from "./github-official-result-summary";

const ORG = "a1000000-0000-4000-8000-000000000001";
const REPOSITORY = "a1000000-0000-4000-8000-000000000002";
const RUN = "a1000000-0000-4000-8000-000000000003";
const JOB = "a1000000-0000-4000-8000-000000000004";
const PACK = "91000000-0000-4000-8000-000000000001";
const APPROVAL = "a1000000-0000-4000-8000-000000000005";

function review(): GitHubMappingReview {
  return {
    pack: {
      id: PACK,
      version: STANDARD_GITHUB_ISO_MAPPING_PACK.version,
      title: STANDARD_GITHUB_ISO_MAPPING_PACK.title,
      checksum: STANDARD_GITHUB_ISO_MAPPING_PACK.checksum,
      publishedAt: "2026-08-24T12:00:00.000Z",
    },
    entries: STANDARD_GITHUB_ISO_MAPPING_PACK.mappings.map((entry, index) => ({
      id: `91000000-0000-4000-8000-${String(index + 101).padStart(12, "0")}`,
      ...entry,
      review: {
        entryDigest: "a".repeat(64),
        status: "approved" as const,
        source: "legacy_pack" as const,
        decisionId: null,
        legacyApprovalId: APPROVAL,
        reviewerId: "a1000000-0000-4000-8000-000000000001",
        reviewedAt: "2026-08-25T07:00:00.000Z",
        revision: 0,
        changeReason: null,
      },
    })).sort((left, right) => left.checkId.localeCompare(right.checkId)),
    approvalHistory: [{ id: APPROVAL, mappingPackId: PACK, approvedAt: "2026-08-25T07:00:00.000Z", revokedAt: null }],
    limitations: [
      "These repository checks cover selected technical signals only; they do not certify ISO/IEC 27001 compliance.",
      "A verified technical pass is evidence for review, not proof that the mapped control is fully implemented.",
      "Unknown or not-applicable results do not create compliance-positive evidence or improve readiness.",
    ],
  };
}

function reviewWithEntryDecisions(
  decisions: Array<Partial<GitHubMappingReview["entries"][number]["review"]>>,
): GitHubMappingReview {
  const fixture = review();
  return {
    ...fixture,
    entries: fixture.entries.map((entry, index) => ({
      ...entry,
      review: { ...entry.review, ...decisions[index] },
    })),
  };
}

function room(overrides: Partial<GitHubComplianceControlRoom> = {}): GitHubComplianceControlRoom {
  return {
    schemaVersion: 1,
    workspaceId: ORG,
    asOf: "2026-08-25T12:00:00.000Z",
    approval: {
      mappingPackId: PACK,
      version: STANDARD_GITHUB_ISO_MAPPING_PACK.version,
      checksum: STANDARD_GITHUB_ISO_MAPPING_PACK.checksum,
      approvedAt: "2026-08-25T07:00:00.000Z",
      revoked: false,
    },
    pagination: { offset: 0, limit: 20, total: 1, truncated: false },
    repositories: [{
      id: REPOSITORY,
      name: "Mukta2701/ComplianceHub",
      url: "https://github.com/Mukta2701/ComplianceHub",
      visibility: "private",
      defaultBranch: "main",
      archived: false,
      available: true,
      latestCollection: { id: RUN, status: "succeeded", completedAt: "2026-08-25T11:00:00.000Z" },
      latestMaterialisationJob: {
        id: JOB, collectionRunId: RUN, status: "completed", attempts: 1,
        availableAt: "2026-08-25T11:00:00.000Z", exhaustedAt: null,
      },
      officialResults: STANDARD_GITHUB_ISO_MAPPING_PACK.mappings.map((entry, index) => ({
        id: `a2000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        checkId: entry.checkId,
        outcome: (["pass", "fail", "unknown", "not_applicable"] as const)[index % 4],
        severity: index % 4 === 1 ? entry.failureSeverity : null,
        summary: `Verified summary for ${entry.checkId}.`,
        observedAt: "2026-08-25T10:55:00.000Z",
        freshUntil: "2026-08-26T22:55:00.000Z",
        materialisedAt: "2026-08-25T11:01:00.000Z",
        ruleVersion: entry.ruleVersion,
        mappingPackId: PACK,
        mappingVersion: STANDARD_GITHUB_ISO_MAPPING_PACK.version,
        mappingChecksum: STANDARD_GITHUB_ISO_MAPPING_PACK.checksum,
        mappingStatus: "active",
        freshness: "current",
        evidenceId: index % 4 === 0 ? `a3000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}` : null,
        findingId: index % 4 === 1 ? `a4000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}` : null,
      })),
    }],
    exhaustedAttention: { total: 0, truncated: false, items: [] },
    ...overrides,
  };
}

describe("GitHubComplianceControlRoomPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.approve.mockResolvedValue({ ok: true, message: "GitHub mapping approved. Official records can now be processed." });
    hoisted.recordDecision.mockResolvedValue({ ok: true, message: "GitHub mapping entry updated." });
    hoisted.revoke.mockResolvedValue({ ok: true, message: "GitHub mapping approval revoked. Existing records remain historical." });
    hoisted.process.mockResolvedValue({ ok: true, message: "Official GitHub records processed: 1 run updated." });
    hoisted.retry.mockResolvedValue({ ok: true, message: "GitHub processing retry queued." });
  });

  it("shows counts and 15 individual mapping decisions, with changed reasons and technical mapping details", () => {
    const mappingReview = reviewWithEntryDecisions([
      {
        status: "pending", source: "none", decisionId: null, legacyApprovalId: null,
        reviewerId: null, reviewedAt: null, revision: 2, changeReason: "changed",
      },
      {
        status: "rejected", source: "entry_decision", decisionId: APPROVAL, legacyApprovalId: null,
        reviewerId: ORG, reviewedAt: "2026-08-25T08:00:00.000Z", revision: 1, changeReason: null,
      },
    ]);
    render(<GitHubComplianceControlRoomPanel room={room()} review={mappingReview} role="member" unhealthyRepositoryIds={[]} />);

    const workflow = screen.getByRole("list", { name: "How GitHub compliance becomes official" });
    expect(within(workflow).getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByText(STANDARD_GITHUB_ISO_MAPPING_PACK.version)).toBeVisible();
    expect(screen.getByText(STANDARD_GITHUB_ISO_MAPPING_PACK.checksum)).toBeVisible();
    expect(screen.getAllByRole("article", { name: /mapping check$/ })).toHaveLength(15);
    expect(screen.getByRole("note", { name: "GitHub mapping review status" }))
      .toHaveTextContent("15 checks · 1 pending · 13 approved · 1 rejected");
    const pendingEntry = mappingReview.entries[0]!;
    const pendingCard = screen.getByRole("article", { name: `${pendingEntry.checkId} mapping check` });
    expect(within(pendingCard).getByText("Pending review")).toBeVisible();
    expect(within(pendingCard).getByText(/Mapping changed since its last review/)).toBeVisible();
    expect(within(pendingCard).getByText(pendingEntry.isoControlReferences.join(" · "))).toBeVisible();
    expect(within(pendingCard).getByText(pendingEntry.treatments.pass.summary)).toBeVisible();
    expect(within(pendingCard).getByText(pendingEntry.treatments.fail.summary)).toBeVisible();
    const rejectedEntry = mappingReview.entries[1]!;
    expect(within(screen.getByRole("article", { name: `${rejectedEntry.checkId} mapping check` }))
      .getByText("Rejected")).toBeVisible();
    const mapping = screen.getByRole("region", { name: "Individual mapping review" });
    for (const group of ["Repository basics", "Branch protection", "Dependency and code alerts", "Secret protection", "Workflows and access"]) {
      expect(within(mapping).getByRole("heading", { name: group })).toBeInTheDocument();
    }
    expect(within(mapping).getByText("Force-push protection")).toBeVisible();
    expect(within(mapping).getByText("github.branch.force_pushes")).toBeVisible();
    expect(screen.getByText(/do not certify ISO\/IEC 27001 compliance/)).toBeVisible();
    expect(screen.getByRole("heading", { name: "Approval history" })).toBeVisible();
    expect(screen.queryByText(/approved_by|actor|email/i)).not.toBeInTheDocument();
  });

  it("uses exact current-state and outcome wording with only canonical repository/evidence/finding links", () => {
    render(<GitHubComplianceControlRoomPanel room={room()} review={review()} role="member" unhealthyRepositoryIds={[]} />);
    const repository = screen.getByRole("article", { name: "Mukta2701/ComplianceHub official compliance" });
    expect(within(repository).getByText("Official records current")).toBeVisible();
    expect(within(repository).getByText("4 passed")).toBeVisible();
    expect(within(repository).getByText("4 need action")).toBeVisible();
    expect(within(repository).getByText("4 could not verify")).toBeVisible();
    expect(within(repository).getByText("3 not applicable")).toBeVisible();
    expect(within(repository).getByRole("link", { name: "Open Mukta2701/ComplianceHub on GitHub" })).toHaveAttribute(
      "href", "https://github.com/Mukta2701/ComplianceHub",
    );
    expect(within(repository).getAllByRole("link", { name: /^View evidence for / })[0]).toHaveAttribute(
      "href",
      "/app/evidence?evidence=a3000000-0000-4000-8000-000000000001#evidence-a3000000-0000-4000-8000-000000000001",
    );
    expect(within(repository).getAllByRole("link", { name: /^View finding for / })[0]).toHaveAttribute(
      "href",
      "/app/monitoring?finding=a4000000-0000-4000-8000-000000000002#finding-a4000000-0000-4000-8000-000000000002",
    );
    expect(repository).toHaveTextContent("Rule github-repository-v1 · Mapping github-iso-27001-v1");
    expect(within(repository).getByRole("heading", { name: "Branch protection" })).toBeInTheDocument();
    expect(within(repository).getByText("Force-push protection")).toBeInTheDocument();
    expect(repository).not.toHaveTextContent(/compliant|certified|secure|readiness improved/i);
  });

  it("uses singular grammar for one current result needing action", () => {
    const partialRoom = room();
    const failedResult = partialRoom.repositories[0]!.officialResults.find((result) => result.outcome === "fail")!;
    partialRoom.repositories[0]!.officialResults = [failedResult];

    render(<>
      <GitHubComplianceControlRoomPanel room={partialRoom} review={review()} role="member" unhealthyRepositoryIds={[]} />
      <GitHubOfficialResultSummary results={[failedResult]} />
    </>);

    const repository = screen.getByRole("article", { name: "Mukta2701/ComplianceHub official compliance" });
    expect(within(repository).getByText("1 needs action")).toBeVisible();
    expect(screen.getByRole("note", { name: "Current GitHub results summary" }))
      .toHaveTextContent("1 current GitHub result across repositories shown here · 0 passed · 1 needs action · 0 could not be verified");
  });

  it("excludes historical and stale outcomes from current counts but keeps them inspectable", async () => {
    const user = userEvent.setup();
    const roomWithOlderResults = room();
    const results = roomWithOlderResults.repositories[0]!.officialResults;
    results[0] = { ...results[0]!, mappingStatus: "historical" };
    results[1] = { ...results[1]!, freshness: "stale" };

    render(<GitHubComplianceControlRoomPanel room={roomWithOlderResults} review={review()} role="member" unhealthyRepositoryIds={[]} />);

    const repository = screen.getByRole("article", { name: "Mukta2701/ComplianceHub official compliance" });
    expect(within(repository).getByText("3 passed")).toBeVisible();
    expect(within(repository).getByText("3 need action")).toBeVisible();
    expect(within(repository).getByText("1 historical result · 1 stale result (excluded from current counts; details remain below)")).toBeVisible();

    await user.click(within(repository).getByText("Inspect 15 latest results"));
    expect(within(repository).getByText("Historical mapping")).toBeVisible();
    expect(within(repository).getByText("Stale · recheck needed")).toBeVisible();
    expect(within(repository).getByText("Passed when recorded")).toBeVisible();
    expect(within(repository).getByText("Issue when recorded")).toBeVisible();
  });

  it("shows a partial review when only some exact checks have current results", () => {
    const partialRoom = room();
    partialRoom.repositories[0]!.officialResults = partialRoom.repositories[0]!.officialResults.slice(0, 1);

    render(<GitHubComplianceControlRoomPanel room={partialRoom} review={review()} role="member" unhealthyRepositoryIds={[]} />);

    const repository = screen.getByRole("article", { name: "Mukta2701/ComplianceHub official compliance" });
    expect(within(repository).getByText("Partial review")).toBeVisible();
    expect(within(repository).getByText(/Some checks have a current official result/)).toBeVisible();
    expect(within(repository).getByText("1 passed")).toBeVisible();
    expect(within(repository).queryByText("Needs attention")).not.toBeInTheDocument();
  });

  it("uses exact current result status when no legacy pack approval row exists", () => {
    render(<GitHubComplianceControlRoomPanel room={room({ approval: null })} review={review()} role="member" unhealthyRepositoryIds={[]} />);

    const repository = screen.getByRole("article", { name: "Mukta2701/ComplianceHub official compliance" });
    expect(within(repository).getByText("Official records current")).toBeVisible();
  });

  it("keeps existing full current coverage visible while stating that a newer collection is processing", () => {
    const processingRoom = room();
    processingRoom.repositories[0]!.latestMaterialisationJob = {
      ...processingRoom.repositories[0]!.latestMaterialisationJob!,
      status: "pending",
    };

    render(<GitHubComplianceControlRoomPanel room={processingRoom} review={review()} role="member" unhealthyRepositoryIds={[]} />);

    const repository = screen.getByRole("article", { name: "Mukta2701/ComplianceHub official compliance" });
    expect(within(repository).getByText("Official records current")).toBeVisible();
    expect(within(repository).getByText("A newer collection is still processing. The counts below reflect current official results already recorded.")).toBeVisible();
  });

  it("labels the page headline as current and puts old results outside its outcome totals", () => {
    const resultRoom = room();
    const results = resultRoom.repositories[0]!.officialResults;
    results[0] = { ...results[0]!, mappingStatus: "historical" };
    results[1] = { ...results[1]!, freshness: "stale" };

    render(<GitHubOfficialResultSummary results={results} />);

    expect(screen.getByRole("note", { name: "Current GitHub results summary" })).toHaveTextContent(
      "13 current GitHub results across repositories shown here · 3 passed · 3 need action · 4 could not be verified · 3 not applicable",
    );
    expect(screen.getByRole("note", { name: "Current GitHub results summary" })).toHaveTextContent(
      "1 historical result · 1 stale result (excluded from current totals; details remain below)",
    );
  });

  it("never labels an official-mode collection without materialised results as shadow", () => {
    const collectedRoom = room();
    collectedRoom.repositories[0] = {
      ...collectedRoom.repositories[0],
      latestMaterialisationJob: null,
      officialResults: [],
    };

    render(<GitHubComplianceControlRoomPanel
      room={collectedRoom}
      review={review()}
      role="member"
      unhealthyRepositoryIds={[]}
    />);

    const repository = screen.getByRole("article", { name: "Mukta2701/ComplianceHub official compliance" });
    expect(within(repository).getByText("Collected, not official")).toBeVisible();
    expect(repository).not.toHaveTextContent(/\bshadow\b/i);
    expect(screen.getByText(/Only approved mapping entries are used when producing official records/i)).toBeVisible();
  });

  it.each(["admin", "member"] as const)("keeps mapping and recovery controls read-only for %s", (role) => {
    const mappingReview = reviewWithEntryDecisions([
      { status: "pending", source: "none", legacyApprovalId: null, revision: 1, changeReason: "not_reviewed" },
    ]);
    render(<GitHubComplianceControlRoomPanel room={room()} review={mappingReview} role={role} unhealthyRepositoryIds={[]} />);
    expect(screen.getByText("Only workspace Owners can decide mapping entries or recover processing.")).toBeVisible();
    expect(screen.queryByRole("button", { name: /approve|revoke|process|retry/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reject mapping/i })).not.toBeInTheDocument();
  });

  it.each([
    ["approved", "Approve mapping for github.branch.force_pushes"],
    ["rejected", "Reject mapping for github.branch.force_pushes"],
  ] as const)("records one exact Owner decision as %s and reports the safe result", async (decision, buttonName) => {
    const user = userEvent.setup();
    const mappingReview = reviewWithEntryDecisions(review().entries.map(() => ({
      status: "pending", source: "none", legacyApprovalId: null, revision: 3, changeReason: "not_reviewed",
    })));
    const entry = mappingReview.entries.find((candidate) => candidate.checkId === "github.branch.force_pushes")!;
    render(<GitHubComplianceControlRoomPanel
      room={room({ approval: null })}
      review={mappingReview}
      role="owner"
      unhealthyRepositoryIds={[]}
    />);
    const entryCard = screen.getByRole("article", { name: `${entry.checkId} mapping check` });
    await user.click(within(entryCard).getByRole("button", { name: buttonName }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("GitHub mapping entry updated"));
    expect(Object.fromEntries(hoisted.recordDecision.mock.calls[0][0] as FormData)).toEqual({
      entryId: entry.id,
      entryDigest: "a".repeat(64),
      decision,
      expectedRevision: "3",
    });
    expect(hoisted.approve).not.toHaveBeenCalled();
    expect(hoisted.refresh).toHaveBeenCalledOnce();
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("keeps a historical pack approval separate from the individual mapping decisions", () => {
    const historicalRoom = room();
    historicalRoom.approval = {
      ...historicalRoom.approval!,
      mappingPackId: "91000000-0000-4000-8000-000000000099",
      version: "github-iso-27001-v0",
      checksum: "a".repeat(64),
    };
    const historicalReview = review();
    historicalReview.approvalHistory = [{
      id: APPROVAL,
      mappingPackId: historicalRoom.approval.mappingPackId,
      approvedAt: "2026-08-25T07:00:00.000Z",
      revokedAt: null,
    }];
    historicalRoom.repositories[0]!.latestMaterialisationJob = {
      ...historicalRoom.repositories[0]!.latestMaterialisationJob!, status: "pending",
    };

    render(<GitHubComplianceControlRoomPanel
      room={historicalRoom}
      review={historicalReview}
      role="owner"
      unhealthyRepositoryIds={[]}
    />);

    expect(screen.getByText("Earlier pack-wide approval")).toBeVisible();
    expect(screen.getByText(/An earlier pack-wide approval is still active/)).toBeVisible();
    expect(screen.getByText(/Revoking it removes only approvals inherited from that pack; individual check decisions remain in effect/)).toBeVisible();
    const legacyEntry = screen.getByRole("article", { name: "github.branch.force_pushes mapping check" });
    expect(within(legacyEntry).getByText("Effective status comes from an earlier pack-wide approval.")).toBeVisible();
    expect(within(legacyEntry).getByRole("button", { name: "Approve mapping for github.branch.force_pushes" })).toBeVisible();
    expect(within(legacyEntry).getByRole("button", { name: "Reject mapping for github.branch.force_pushes" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Revoke historical mapping" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Approve mapping for official records" })).not.toBeInTheDocument();
    expect(screen.queryByText("Owner approved")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Process approved results" })).not.toBeInTheDocument();
  });

  it("shows approval and revocation lineage with pack identity but no actor identity", () => {
    const historicalReview = review();
    historicalReview.approvalHistory = [{
      id: APPROVAL,
      mappingPackId: PACK,
      approvedAt: "2026-08-24T09:00:00.000Z",
      revokedAt: "2026-08-25T09:30:00.000Z",
    }];
    render(<GitHubComplianceControlRoomPanel room={room({ approval: null })} review={historicalReview} role="member" unhealthyRepositoryIds={[]} />);

    const history = screen.getByRole("heading", { name: "Approval history" }).parentElement!;
    expect(history).toHaveTextContent(`Mapping pack ${PACK}`);
    expect(history).toHaveTextContent("Approved 2026-08-24T09:00:00.000Z");
    expect(history).toHaveTextContent("Revoked 2026-08-25T09:30:00.000Z");
    expect(history).not.toHaveTextContent(/actor|email|approved_by/i);
  });

  it("does not claim checks exist before the first collection", () => {
    const emptyRoom = room({ approval: null });
    emptyRoom.repositories[0]!.latestCollection = null;
    emptyRoom.repositories[0]!.latestMaterialisationJob = null;
    emptyRoom.repositories[0]!.officialResults = [];
    render(<GitHubComplianceControlRoomPanel room={emptyRoom} review={review()} role="member" unhealthyRepositoryIds={[]} />);
    expect(screen.getByText("No official results")).toBeVisible();
    expect(screen.getByText("No collection has completed, so there are no official results to show yet."))
      .toBeVisible();
  });

  it("renders the bounded exhausted recovery queue even when a job is outside the repository page", async () => {
    const user = userEvent.setup();
    const outsideRepository = "a1000000-0000-4000-8000-000000000099";
    const outsideRun = "a1000000-0000-4000-8000-000000000098";
    const outsideJob = "a1000000-0000-4000-8000-000000000097";
    const attentionRoom = room({
      pagination: { offset: 20, limit: 20, total: 45, truncated: true },
      exhaustedAttention: {
        total: 25,
        truncated: true,
        items: [{
          jobId: outsideJob,
          repositoryId: outsideRepository,
          collectionRunId: outsideRun,
          attempts: 25,
          exhaustedAt: "2026-08-25T11:05:00.000Z",
        }],
      },
    });
    render(<GitHubComplianceControlRoomPanel room={attentionRoom} review={review()} role="owner" unhealthyRepositoryIds={[]} />);

    expect(screen.getByRole("heading", { name: "Processing recovery queue" })).toBeVisible();
    expect(screen.getByText("Showing 1 of 25 exhausted jobs.")).toBeVisible();
    expect(screen.getByText(/More exhausted jobs will appear after queued recoveries are processed/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Previous repositories" })).toHaveAttribute("href", "/app/monitoring?githubPage=1");
    expect(screen.getByRole("link", { name: "Next repositories" })).toHaveAttribute("href", "/app/monitoring?githubPage=3");
    await user.click(screen.getByRole("button", { name: "Retry queued exhausted job" }));
    await waitFor(() => expect(hoisted.retry).toHaveBeenCalledOnce());
    expect(Object.fromEntries(hoisted.retry.mock.calls[0][0] as FormData)).toEqual({
      repositoryId: outsideRepository,
      collectionRunId: outsideRun,
      jobId: outsideJob,
      reasonCode: "configuration_corrected",
    });
  });

  it("shows only the closed recovery reason choices for an exhausted job", () => {
    const exhaustedRoom = room();
    exhaustedRoom.repositories[0]!.latestMaterialisationJob = {
      ...exhaustedRoom.repositories[0]!.latestMaterialisationJob!, status: "exhausted", attempts: 25,
      exhaustedAt: "2026-08-25T11:05:00.000Z",
    };
    exhaustedRoom.exhaustedAttention = {
      total: 1,
      truncated: false,
      items: [{
        jobId: JOB,
        repositoryId: REPOSITORY,
        collectionRunId: RUN,
        attempts: 25,
        exhaustedAt: "2026-08-25T11:05:00.000Z",
      }],
    };
    render(<GitHubComplianceControlRoomPanel room={exhaustedRoom} review={review()} role="owner" unhealthyRepositoryIds={[]} />);
    expect(screen.getAllByText("Needs attention")).toHaveLength(2);
    const reason = screen.getByRole("combobox", { name: /Retry reason/ });
    expect(within(reason).getAllByRole("option").map((option) => option.getAttribute("value"))).toEqual([
      "configuration_corrected", "provider_recovered", "owner_reviewed",
    ]);
    expect(screen.queryByRole("textbox", { name: /reason/i })).not.toBeInTheDocument();
  });
});
