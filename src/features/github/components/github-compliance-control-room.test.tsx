import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { STANDARD_GITHUB_ISO_MAPPING_PACK } from "../domain/mapping";
import type { GitHubComplianceControlRoom } from "../application/github-compliance-control-room";
import type { GitHubMappingReview } from "../application/github-mapping-review";

const hoisted = vi.hoisted(() => ({
  approve: vi.fn(), revoke: vi.fn(), process: vi.fn(), retry: vi.fn(), refresh: vi.fn(),
}));
vi.mock("@/app/app/monitoring/github-control-room-actions", () => ({
  approveGitHubMappingPackAction: hoisted.approve,
  revokeGitHubMappingApprovalAction: hoisted.revoke,
  processApprovedGitHubResultsAction: hoisted.process,
  retryExhaustedGitHubMaterialisationAction: hoisted.retry,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: hoisted.refresh }) }));

import { GitHubComplianceControlRoomPanel } from "./github-compliance-control-room";

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
    })).sort((left, right) => left.checkId.localeCompare(right.checkId)),
    approvalHistory: [{ id: APPROVAL, mappingPackId: PACK, approvedAt: "2026-08-25T07:00:00.000Z", revokedAt: null }],
    limitations: [
      "These repository checks cover selected technical signals only; they do not certify ISO/IEC 27001 compliance.",
      "A verified technical pass is evidence for review, not proof that the mapped control is fully implemented.",
      "Unknown or not-applicable results do not create compliance-positive evidence or improve readiness.",
    ],
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
    hoisted.revoke.mockResolvedValue({ ok: true, message: "GitHub mapping approval revoked. Existing records remain historical." });
    hoisted.process.mockResolvedValue({ ok: true, message: "Official GitHub records processed: 1 run updated." });
    hoisted.retry.mockResolvedValue({ ok: true, message: "GitHub processing retry queued." });
  });

  it("explains the four phases and shows exact mapping identity, all 15 checks, ISO references, treatments, limitations, and identity-free history", () => {
    render(<GitHubComplianceControlRoomPanel room={room()} review={review()} role="member" unhealthyRepositoryIds={[]} />);

    const workflowDetails = screen.getByText("How results become records").closest("details") as HTMLElement;
    expect(workflowDetails).not.toHaveAttribute("open");
    expect(within(workflowDetails).getByText("1. Connect")).not.toBeVisible();
    expect(screen.getByText("Check definitions (15)").closest("details")).not.toHaveAttribute("open");
    const mappingIdentity = screen.getByText("Internal mapping details").closest("details") as HTMLElement;
    expect(mappingIdentity).not.toHaveAttribute("open");
    expect(within(mappingIdentity).getByText(STANDARD_GITHUB_ISO_MAPPING_PACK.checksum)).not.toBeVisible();
    fireEvent.click(within(mappingIdentity).getByText("Internal mapping details"));
    expect(within(mappingIdentity).getByText(STANDARD_GITHUB_ISO_MAPPING_PACK.checksum)).toBeVisible();
    expect(screen.getAllByRole("article", { name: /mapping check$/ })).toHaveLength(15);
    const mapping = screen.getByText("Check definitions (15)").closest("details") as HTMLElement;
    for (const group of ["Repository basics", "Branch protection", "Dependency and code alerts", "Secret protection", "Workflows and access"]) {
      expect(within(mapping).getByRole("heading", { name: group })).toBeInTheDocument();
    }
    expect(within(mapping).getByText("Force-push protection")).toBeInTheDocument();
    expect(within(mapping).getByText("github.branch.force_pushes")).toBeInTheDocument();
    expect(screen.getByText("A.5.18 · A.8.2")).not.toBeVisible();
    expect(screen.getAllByText(/Verified technical pass → evidence/).length).toBeGreaterThan(0);
    expect(screen.getByText(/do not certify ISO\/IEC 27001 compliance/)).toBeVisible();
    expect(screen.getByRole("heading", { name: "Approval history" })).toBeVisible();
    expect(screen.queryByText(/approved_by|actor|email/i)).not.toBeInTheDocument();
  });

  it("leads catalogue rows with plain titles and nests raw rule details", async () => {
    const user = userEvent.setup();
    render(<GitHubComplianceControlRoomPanel room={room()} review={review()} role="member" unhealthyRepositoryIds={[]} />);

    const catalogue = screen.getByText("Check definitions (15)").closest("details") as HTMLElement;
    expect(screen.queryByText("Review all 15 mapped checks")).not.toBeInTheDocument();
    expect(catalogue).not.toHaveAttribute("open");
    await user.click(within(catalogue).getByText("Check definitions (15)"));
    expect(screen.getAllByRole("article", { name: /mapping check$/ })).toHaveLength(15);
    const firstCheck = within(catalogue).getAllByRole("article", { name: /mapping check$/ })[0] as HTMLElement;
    expect(within(firstCheck).getByText(/if failed/)).toBeVisible();
    expect(within(firstCheck).getByText(/ISO references:/)).toBeVisible();
    expect(within(firstCheck).getByText(/Suggested remediation:/)).toBeVisible();

    const ruleDetails = within(firstCheck).getByText("Rule details").closest("details") as HTMLElement;
    expect(ruleDetails).not.toHaveAttribute("open");
    expect(within(ruleDetails).getByText(/Verified technical pass → evidence/)).not.toBeVisible();
    expect(within(ruleDetails).getAllByText(/github\./)[0]).not.toBeVisible();
    await user.click(within(ruleDetails).getByText("Rule details"));
    expect(within(ruleDetails).getAllByText(/github\./)[0]).toBeVisible();
    expect(within(ruleDetails).getByText(/Verified technical pass → evidence/)).toBeVisible();
    expect(within(ruleDetails).getByText(/Verified issue → finding/)).toBeVisible();
    expect(within(ruleDetails).getByText(/Could not verify:/)).toBeVisible();
    expect(within(ruleDetails).getByText(/Not applicable:/)).toBeVisible();
  });

  it.each([
    ["the connection is unhealthy", (value: GitHubComplianceControlRoom) => value, [REPOSITORY]],
    ["approval is missing", (value: GitHubComplianceControlRoom) => ({ ...value, approval: null }), []],
    ["the result set is incomplete", (value: GitHubComplianceControlRoom) => ({ ...value, repositories: [{ ...value.repositories[0]!, officialResults: value.repositories[0]!.officialResults.slice(0, 1) }] }), []],
    ["the mapping differs", (value: GitHubComplianceControlRoom) => ({ ...value, approval: { ...value.approval!, checksum: "b".repeat(64) } }), []],
    ["the collection is partial", (value: GitHubComplianceControlRoom) => ({ ...value, repositories: [{ ...value.repositories[0]!, latestCollection: { ...value.repositories[0]!.latestCollection!, status: "partial" as const } }] }), []],
    ["processing belongs to an older run", (value: GitHubComplianceControlRoom) => ({ ...value, repositories: [{ ...value.repositories[0]!, latestMaterialisationJob: { ...value.repositories[0]!.latestMaterialisationJob!, collectionRunId: "a1000000-0000-4000-8000-000000000099" } }] }), []],
  ] as const)("does not show a green pass when %s", (_reason, change, unhealthyRepositoryIds) => {
    render(<GitHubComplianceControlRoomPanel room={change(room())} review={review()} role="member" unhealthyRepositoryIds={[...unhealthyRepositoryIds]} />);
    const repository = screen.getByRole("article", { name: "Mukta2701/ComplianceHub official compliance" });
    expect(within(repository).queryByText("Passed at last check")).not.toBeInTheDocument();
    expect(within(repository).getAllByText("Past pass — needs review").length).toBeGreaterThan(0);
    expect(within(repository).getAllByText("Past pass — needs review")[0].closest("span")).not.toHaveClass("green");
  });

  it("labels an unverified saved issue without presenting it as a current finding", () => {
    render(<GitHubComplianceControlRoomPanel room={room({ approval: null })} review={review()} role="member" unhealthyRepositoryIds={[]} />);
    const repository = screen.getByRole("article", { name: "Mukta2701/ComplianceHub official compliance" });
    expect(within(repository).queryAllByText("Issue found")).toHaveLength(0);
    expect(within(repository).getAllByText("Saved issue; needs review").length).toBeGreaterThan(0);
    expect(within(repository).getAllByRole("link", { name: /^View finding for / }).length).toBeGreaterThan(0);
  });

  it("uses readable names for check articles and record links", () => {
    render(<GitHubComplianceControlRoomPanel room={room()} review={review()} role="member" unhealthyRepositoryIds={[]} />);
    const catalogue = screen.getByText("Check definitions (15)").closest("details") as HTMLElement;
    for (const article of within(catalogue).getAllByRole("article", { name: /mapping check$/ })) {
      expect(article.getAttribute("aria-label")).not.toContain("github.");
    }
    const repository = screen.getByRole("article", { name: "Mukta2701/ComplianceHub official compliance" });
    for (const link of within(repository).getAllByRole("link", { name: /^View (evidence|finding) for / })) {
      expect(link.getAttribute("aria-label")).not.toContain("github.");
    }
  });

  it("uses exact current-state and outcome wording with only canonical repository/evidence/finding links", () => {
    render(<GitHubComplianceControlRoomPanel room={room()} review={review()} role="member" unhealthyRepositoryIds={[]} />);
    const repository = screen.getByRole("article", { name: "Mukta2701/ComplianceHub official compliance" });
    expect(within(repository).getByText("Official records current")).toBeVisible();
    expect(within(repository).getByText("4 passed")).toBeVisible();
    expect(within(repository).getByText("4 found")).toBeVisible();
    expect(within(repository).getByText("4 unverified")).toBeVisible();
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
    expect(within(repository).getAllByText("Audit identifiers")[0].closest("details")).not.toHaveAttribute("open");
    expect(repository).toHaveTextContent("Rule github-repository-v1 · Mapping github-iso-27001-v1");
    expect(within(repository).getByRole("heading", { name: "Branch protection" })).toBeInTheDocument();
    expect(within(repository).getByText("Force-push protection")).toBeInTheDocument();
    expect(repository).not.toHaveTextContent(/compliant|certified|secure|readiness improved/i);
  });

  it("calls expired saved results previous observations rather than current passes or issues", () => {
    render(<GitHubComplianceControlRoomPanel
      room={room({ asOf: "2026-08-28T12:00:00.000Z" })}
      review={review()}
      role="member"
      unhealthyRepositoryIds={[]}
    />);

    const repository = screen.getByRole("article", { name: "Mukta2701/ComplianceHub official compliance" });
    expect(within(repository).getAllByText("Previously passed; needs recheck").length).toBeGreaterThan(0);
    expect(within(repository).getAllByText("Previous issue; needs recheck").length).toBeGreaterThan(0);
    expect(repository).not.toHaveTextContent("Verified technical pass");
    expect(within(repository).getAllByRole("link", { name: /^View evidence for / })[0]).toHaveAttribute(
      "href", "/app/evidence?evidence=a3000000-0000-4000-8000-000000000001#evidence-a3000000-0000-4000-8000-000000000001",
    );
  });

  it("marks official records for review when the GitHub connection is unhealthy", () => {
    render(<GitHubComplianceControlRoomPanel
      room={room()}
      review={review()}
      role="member"
      unhealthyRepositoryIds={[REPOSITORY]}
    />);

    const repository = screen.getByRole("article", { name: "Mukta2701/ComplianceHub official compliance" });
    expect(within(repository).getByText("Needs attention")).toBeVisible();
    expect(within(repository).queryByText("Official records current")).not.toBeInTheDocument();
    expect(within(repository).getByText("GitHub access or collection processing needs attention. Review the statuses and recovery options below."))
      .toBeVisible();
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
    expect(screen.getByText(/before any collected result becomes an official record/i)).toBeVisible();
  });

  it.each(["admin", "member"] as const)("keeps mapping and recovery controls read-only for %s", (role) => {
    render(<GitHubComplianceControlRoomPanel room={room()} review={review()} role={role} unhealthyRepositoryIds={[]} />);
    expect(screen.getByText("Only workspace Owners can approve mappings or recover processing.")).toBeVisible();
    expect(screen.queryByRole("button", { name: /approve|revoke|process|retry/i })).not.toBeInTheDocument();
  });

  it("requires an explicit Owner confirmation and reports the safe action result through one live region", async () => {
    const user = userEvent.setup();
    render(<GitHubComplianceControlRoomPanel
      room={room({ approval: null })}
      review={review()}
      role="owner"
      unhealthyRepositoryIds={[]}
    />);
    const fieldset = screen.getByRole("group", { name: "Owner mapping approval" });
    const approve = within(fieldset).getByRole("button", { name: "Approve mapping for official records" });
    expect(approve).toBeDisabled();
    await user.click(within(fieldset).getByRole("checkbox", { name: /I understand/ }));
    expect(approve).toBeEnabled();
    await user.click(approve);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("GitHub mapping approved"));
    expect(Object.fromEntries(hoisted.approve.mock.calls[0][0] as FormData)).toEqual({
      version: STANDARD_GITHUB_ISO_MAPPING_PACK.version,
      checksum: STANDARD_GITHUB_ISO_MAPPING_PACK.checksum,
      confirmation: "accepted",
    });
    expect(hoisted.refresh).toHaveBeenCalledOnce();
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("does not label a historical active mapping as approval of the reviewed pack", () => {
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

    expect(screen.getByText("Different mapping active")).toBeVisible();
    expect(screen.getByText(/Revoke the historical mapping before approving this reviewed version/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Revoke historical mapping" })).toBeVisible();
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
    expect(screen.getByText("Awaiting approval")).toBeVisible();
    expect(screen.getByText("No collection has completed yet. An Owner must also approve the reviewed mapping before official processing."))
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
