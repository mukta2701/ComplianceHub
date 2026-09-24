"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  approveGitHubMappingPackAction,
  processApprovedGitHubResultsAction,
  retryExhaustedGitHubMaterialisationAction,
  revokeGitHubMappingApprovalAction,
} from "@/app/app/monitoring/github-control-room-actions";
import { Pill } from "@/components/ui";
import type { MembershipRole } from "@/features/organisations/domain/access";
import { workspaceAccess } from "@/features/organisations/domain/workspace-access";
import type { GitHubComplianceControlRoom } from "../application/github-compliance-control-room";
import type { GitHubMappingReview } from "../application/github-mapping-review";
import {
  classifyGitHubRepositoryCompliance,
  countGitHubOfficialOutcomes,
  type GitHubRepositoryComplianceState,
} from "../domain/compliance-control-room-state";
import { githubEvidenceTitle, githubFindingPresentation, groupChecksByArea } from "./github-check-presentation";
import { formatMonitoringTime } from "./format-monitoring-time";

const STATE_PRESENTATION: Record<GitHubRepositoryComplianceState, { label: string; tone: string; detail: string }> = {
  needs_attention: {
    label: "Needs attention",
    tone: "red",
    detail: "GitHub access or collection processing needs attention. Review the statuses and recovery options below.",
  },
  awaiting_approval: {
    label: "Awaiting approval",
    tone: "amber",
    detail: "Collected checks are stored, but an Owner has not approved the reviewed mapping.",
  },
  shadow: {
    label: "Collected, not official",
    tone: "blue",
    detail: "Collected checks exist, but no official evidence or findings have been produced yet.",
  },
  official_stale: {
    label: "Results need rechecking",
    tone: "amber",
    detail: "Saved results are out of date or no longer match the approved mapping. Review the mapping or run a new check before relying on them.",
  },
  official_current: {
    label: "Official records current",
    tone: "green",
    detail: "All 15 latest results match the active mapping and remain within their verified freshness window.",
  },
};

const RETRY_REASONS = [
  { value: "configuration_corrected", label: "Configuration corrected" },
  { value: "provider_recovered", label: "GitHub provider recovered" },
  { value: "owner_reviewed", label: "Owner reviewed" },
] as const;

function resultPresentation(
  result: GitHubComplianceControlRoom["repositories"][number]["officialResults"][number],
  asOf: string,
  isOfficialCurrent: boolean,
): { label: string; tone: string; description: string } {
  const outOfDate = !Number.isFinite(Date.parse(result.freshUntil))
    || !Number.isFinite(Date.parse(asOf))
    || Date.parse(asOf) >= Date.parse(result.freshUntil);
  if (result.outcome === "pass") {
    if (outOfDate) return {
      label: "Previously passed; needs recheck",
      tone: "amber",
      description: "No issue was found when GitHub was last checked.",
    };
    if (isOfficialCurrent) return {
      label: "Passed at last check",
      tone: "green",
      description: "No issue was found when GitHub was last checked.",
    };
    return {
      label: "Past pass — needs review",
      tone: "amber",
      description: "This saved pass is not currently verified. Review the connection and mapping or run a new check before relying on it.",
    };
  }
  if (result.outcome === "fail") return {
    label: outOfDate ? "Previous issue; needs recheck" : "Issue found",
    tone: outOfDate ? "amber" : "red",
    description: githubFindingPresentation(result.checkId).explanation,
  };
  if (result.outcome === "unknown") return {
    label: outOfDate ? "Could not verify; needs recheck" : "Could not verify",
    tone: "amber",
    description: "GitHub could not confirm this setting at the last check.",
  };
  return {
    label: outOfDate ? "Previously not applicable; needs recheck" : "Not applicable",
    tone: outOfDate ? "amber" : "neutral",
    description: "This check did not apply when GitHub was last checked.",
  };
}

function MappingReviewSection({
  room,
  review,
  role,
  runAction,
  pending,
}: {
  room: GitHubComplianceControlRoom;
  review: GitHubMappingReview;
  role: MembershipRole;
  runAction: (action: (formData: FormData) => Promise<{ ok: boolean; message: string }>, form: FormData) => Promise<void>;
  pending: boolean;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const exactApprovalActive = room.approval !== null
    && room.approval.mappingPackId === review.pack.id
    && room.approval.version === review.pack.version
    && room.approval.checksum === review.pack.checksum;
  const activeHistory = review.approvalHistory.find((approval) =>
    approval.revokedAt === null && approval.mappingPackId === room.approval?.mappingPackId,
  );
  const approvalLabel = exactApprovalActive
    ? "Owner approved"
    : room.approval
      ? "Different mapping active"
      : "Approval required";
  const canManageMapping = workspaceAccess(role).section("monitoring").canManageOperation("approve-github-mapping");

  function approve() {
    const form = new FormData();
    form.set("version", review.pack.version);
    form.set("checksum", review.pack.checksum);
    form.set("confirmation", "accepted");
    return runAction(approveGitHubMappingPackAction, form);
  }

  function revoke() {
    if (!activeHistory) return;
    const form = new FormData();
    form.set("approvalId", activeHistory.id);
    return runAction(revokeGitHubMappingApprovalAction, form);
  }

  return <section className="github-control-room-section" aria-labelledby="github-mapping-title">
    <div className="github-control-room-heading">
      <div>
        <p className="eyebrow">REVIEWED MAPPING</p>
        <h3 id="github-mapping-title">GitHub checks mapped to ISO/IEC 27001:2022</h3>
        <p>Review the exact published mapping before any collected result becomes an official record.</p>
      </div>
      <Pill tone={exactApprovalActive ? "green" : "amber"}>{approvalLabel}</Pill>
    </div>

    <dl className="github-mapping-identity">
      <div><dt>Version</dt><dd>{review.pack.version}</dd></div>
      <div><dt>Checksum</dt><dd><code>{review.pack.checksum}</code></dd></div>
      <div><dt>Published</dt><dd><time dateTime={review.pack.publishedAt}>{review.pack.publishedAt}</time></dd></div>
    </dl>

    <div className="github-limitations" role="note" aria-label="Mapping limitations">
      <strong>What this mapping does not prove</strong>
      <ul>{review.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
    </div>

    {canManageMapping ? room.approval && activeHistory ? <fieldset className="github-owner-decision">
      <legend>Owner mapping approval</legend>
      <p>{exactApprovalActive
        ? "This exact mapping is active. Revocation stops future official processing; existing records remain historical."
        : "Revoke the historical mapping before approving this reviewed version. Existing records remain historical."}</p>
      <button className="button secondary" type="button" disabled={pending} onClick={() => void revoke()}>
        {exactApprovalActive ? "Revoke active mapping" : "Revoke historical mapping"}
      </button>
    </fieldset> : room.approval ? <p className="github-read-only-note" role="note">
      The active mapping history could not be verified. Refresh before making an Owner decision.
    </p> : <fieldset className="github-owner-decision">
      <legend>Owner mapping approval</legend>
      <label className="github-confirmation">
        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
        <span>I understand these technical signals do not certify ISO compliance or change readiness by themselves.</span>
      </label>
      <button className="button primary" type="button" disabled={!confirmed || pending} onClick={() => void approve()}>
        Approve mapping for official records
      </button>
    </fieldset> : <p className="github-read-only-note" role="note">
      Only workspace Owners can approve mappings or recover processing.
    </p>}

    <details className="github-mapping-details">
      <summary>Check definitions ({review.entries.length})</summary>
      <div className="github-mapping-list">
        {groupChecksByArea(review.entries).map((section) => <section key={section.group.id} aria-label={section.group.title}>
          <h4 className="github-mapping-group">{section.group.title}</h4>
          {section.items.map((entry) => <article key={entry.id} aria-label={`${entry.checkId} mapping check`}>
          <div className="github-mapping-check-head">
            <div><strong>{githubEvidenceTitle(entry.checkId)}</strong></div>
            <Pill tone={entry.failureSeverity}>{entry.failureSeverity} if failed</Pill>
          </div>
          <p><strong>ISO references:</strong> {entry.isoControlReferences.join(" · ")}</p>
          <p><strong>Suggested remediation:</strong> {entry.remediation}</p>
          <details className="github-rule-details">
            <summary>Rule details</summary>
            <p>Check <code>{entry.checkId}</code> · Rule {entry.ruleVersion}</p>
            <p><strong>Verified technical pass → evidence:</strong> {entry.treatments.pass.summary}</p>
            <p><strong>Verified issue → finding:</strong> {entry.treatments.fail.summary}</p>
            <p><strong>Could not verify:</strong> {entry.treatments.unknown.summary}</p>
            <p><strong>Not applicable:</strong> {entry.treatments.not_applicable.summary}</p>
          </details>
          </article>)}
        </section>)}
      </div>
    </details>

    <div className="github-approval-history">
      <h4>Approval history</h4>
      {review.approvalHistory.length === 0 ? <p>No mapping approval has been recorded.</p> : <ol>
        {review.approvalHistory.map((approval) => <li key={approval.id}>
          <span>Mapping pack <code>{approval.mappingPackId}</code></span>
          <span>Approved <time dateTime={approval.approvedAt}>{approval.approvedAt}</time></span>
          {approval.revokedAt
            ? <span>Revoked <time dateTime={approval.revokedAt}>{approval.revokedAt}</time></span>
            : <strong>Active</strong>}
        </li>)}
      </ol>}
    </div>
  </section>;
}

function RepositoryOfficialCard({
  repository,
  room,
  installationHealthy,
  exactReviewedApprovalActive,
  role,
  runAction,
  pending,
}: {
  repository: GitHubComplianceControlRoom["repositories"][number];
  room: GitHubComplianceControlRoom;
  installationHealthy: boolean;
  exactReviewedApprovalActive: boolean;
  role: MembershipRole;
  runAction: (action: (formData: FormData) => Promise<{ ok: boolean; message: string }>, form: FormData) => Promise<void>;
  pending: boolean;
}) {
  const state = classifyGitHubRepositoryCompliance({
    asOf: room.asOf,
    installationHealthy,
    approval: room.approval,
    latestCollection: repository.latestCollection,
    latestMaterialisationJob: repository.latestMaterialisationJob,
    officialResults: repository.officialResults,
  });
  const job = repository.latestMaterialisationJob;
  const run = repository.latestCollection;
  const isOfficialCurrent = state === "official_current"
    && repository.available
    && exactReviewedApprovalActive
    && run?.status === "succeeded"
    && job?.status === "completed"
    && job.collectionRunId === run.id;
  const presentation = STATE_PRESENTATION[state === "official_current" && !isOfficialCurrent ? "needs_attention" : state];
  const counts = countGitHubOfficialOutcomes(repository.officialResults);
  const stateDetail = !run && state === "awaiting_approval"
    ? "No collection has completed yet. An Owner must also approve the reviewed mapping before official processing."
    : !run && state === "shadow"
      ? "No collection has completed yet, so no official records exist."
      : presentation.detail;
  const canProcessResults = workspaceAccess(role).section("monitoring").canManageOperation("process-github-results");

  function targetForm() {
    const form = new FormData();
    form.set("repositoryId", repository.id);
    form.set("collectionRunId", run?.id ?? "");
    form.set("jobId", job?.id ?? "");
    return form;
  }

  function process() {
    return runAction(processApprovedGitHubResultsAction, targetForm());
  }

  return <article className="github-official-repository" aria-label={`${repository.name} official compliance`}>
    <header>
      <div>
        <a href={repository.url} target="_blank" rel="noreferrer" aria-label={`Open ${repository.name} on GitHub`}>
          {repository.name}
        </a>
        <p>{repository.visibility} · default {repository.defaultBranch}{repository.archived ? " · archived" : ""}</p>
      </div>
      <Pill tone={presentation.tone}>{presentation.label}</Pill>
    </header>
    <p className="github-state-detail">{stateDetail}</p>
    <dl className="github-outcome-counts">
      <div><dt>Saved passes</dt><dd>{counts.pass} passed</dd></div>
      <div><dt>Saved issues</dt><dd>{counts.fail} found</dd></div>
      <div><dt>Could not verify</dt><dd>{counts.unknown} unverified</dd></div>
      <div><dt>Not applicable</dt><dd>{counts.notApplicable} not applicable</dd></div>
    </dl>

    {repository.officialResults.length > 0 && <details className="github-official-results">
      <summary>Saved check results ({repository.officialResults.length})</summary>
      {groupChecksByArea(repository.officialResults).map((section) => <section key={section.group.id} aria-label={`${section.group.title} results`}>
        <h4 className="github-results-group">{section.group.title}</h4>
        <ul>{section.items.map((result) => {
          const display = resultPresentation(result, room.asOf, isOfficialCurrent);
          return <li key={result.id}>
        <div>
          <strong>{githubEvidenceTitle(result.checkId)}</strong>
          <Pill tone={display.tone}>{display.label}</Pill>
        </div>
        <p>{display.description}</p>
        <small>Last checked <time dateTime={result.observedAt}>{formatMonitoringTime(result.observedAt) ?? "Date unavailable"}</time></small>
        <span className="github-result-links">
          {result.evidenceId && <a href={`/app/evidence?evidence=${result.evidenceId}#evidence-${result.evidenceId}`} aria-label={`View evidence for ${result.checkId}`}>View evidence</a>}
          {result.findingId && <a href={`/app/monitoring?finding=${result.findingId}#finding-${result.findingId}`} aria-label={`View finding for ${result.checkId}`}>View finding</a>}
        </span>
        <details className="github-result-audit">
          <summary>Audit identifiers</summary>
          <p>Check <code>{result.checkId}</code> · Rule <code>{result.ruleVersion}</code> · Mapping <code>{result.mappingVersion}</code></p>
          <p>Saved result: {result.summary}</p>
          <p>Result valid until <time dateTime={result.freshUntil}>{formatMonitoringTime(result.freshUntil) ?? "Date unavailable"}</time></p>
        </details>
        </li>})}</ul>
      </section>)}
    </details>}

    {canProcessResults && exactReviewedApprovalActive && run && job && ["pending", "awaiting_approval", "retryable"].includes(job.status)
      && <div className="github-recovery-actions">
        <button className="button primary" type="button" disabled={pending} onClick={() => void process()}>
          Process approved results
        </button>
      </div>}
  </article>;
}

function ExhaustedRecoveryItem({
  item,
  repositoryName,
  role,
  pending,
  runAction,
}: {
  item: GitHubComplianceControlRoom["exhaustedAttention"]["items"][number];
  repositoryName: string | null;
  role: MembershipRole;
  pending: boolean;
  runAction: (action: (formData: FormData) => Promise<{ ok: boolean; message: string }>, form: FormData) => Promise<void>;
}) {
  const [reasonCode, setReasonCode] = useState<(typeof RETRY_REASONS)[number]["value"]>("configuration_corrected");
  const canRetry = workspaceAccess(role).section("monitoring").canManageOperation("retry-github-materialisation");

  function retry() {
    const form = new FormData();
    form.set("repositoryId", item.repositoryId);
    form.set("collectionRunId", item.collectionRunId);
    form.set("jobId", item.jobId);
    form.set("reasonCode", reasonCode);
    return runAction(retryExhaustedGitHubMaterialisationAction, form);
  }

  return <li>
    <div>
      <strong>{repositoryName ?? "Selected repository outside this page"}</strong>
      <small>Exhausted after {item.attempts} attempts · <time dateTime={item.exhaustedAt}>{item.exhaustedAt}</time></small>
    </div>
    {canRetry ? <fieldset className="github-recovery-actions">
      <legend>Recover exhausted processing</legend>
      <label>Retry reason<select aria-label={`Retry reason for ${repositoryName ?? item.repositoryId}`} value={reasonCode} onChange={(event) => setReasonCode(event.target.value as typeof reasonCode)}>
        {RETRY_REASONS.map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}
      </select></label>
      <button className="button secondary" type="button" disabled={pending} onClick={() => void retry()}>
        Retry queued exhausted job
      </button>
    </fieldset> : <p className="github-read-only-note">Only a workspace Owner can queue this recovery.</p>}
  </li>;
}

export function GitHubComplianceControlRoomPanel({
  room,
  review,
  role,
  unhealthyRepositoryIds,
}: {
  room: GitHubComplianceControlRoom;
  review: GitHubMappingReview;
  role: MembershipRole;
  unhealthyRepositoryIds: string[];
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function runAction(
    action: (formData: FormData) => Promise<{ ok: boolean; message: string }>,
    form: FormData,
  ) {
    if (pending) return;
    setPending(true);
    setMessage("");
    try {
      const result = await action(form);
      setMessage(result.message);
      if (result.ok) router.refresh();
    } catch {
      setMessage("Could not update the GitHub compliance control room. Please try again.");
    } finally {
      setPending(false);
    }
  }

  const currentPage = Math.floor(room.pagination.offset / room.pagination.limit) + 1;
  const hasPreviousPage = room.pagination.offset > 0;
  const hasNextPage = room.pagination.truncated;
  const exactReviewedApprovalActive = room.approval !== null
    && room.approval.mappingPackId === review.pack.id
    && room.approval.version === review.pack.version
    && room.approval.checksum === review.pack.checksum;

  return <section className="github-control-room" aria-labelledby="github-control-room-title">
    <header className="github-control-room-hero">
      <p className="eyebrow">GITHUB COMPLIANCE CONTROL ROOM</p>
      <h2 id="github-control-room-title">From repository facts to reviewed records</h2>
      <p>GitHub supplies technical facts. ComplianceHub preserves the review boundary and shows exactly what was verified.</p>
    </header>

    <ol className="github-control-room-steps" aria-label="How GitHub compliance becomes official">
      <li><strong>1. Connect</strong><span>Install the private read-only GitHub App.</span></li>
      <li><strong>2. Select</strong><span>Choose repositories separately from mapping approval.</span></li>
      <li><strong>3. Review</strong><span>An Owner reviews the exact ISO mapping and limitations.</span></li>
      <li><strong>4. Process</strong><span>Approved fresh results create traceable evidence or findings.</span></li>
    </ol>

    <MappingReviewSection room={room} review={review} role={role} runAction={runAction} pending={pending} />

    {room.exhaustedAttention.total > 0 && <section className="github-control-room-section" aria-labelledby="github-recovery-title">
      <div className="github-control-room-heading">
        <div>
          <p className="eyebrow">OWNER RECOVERY</p>
          <h3 id="github-recovery-title">Processing recovery queue</h3>
          <p>Showing {room.exhaustedAttention.items.length} of {room.exhaustedAttention.total} exhausted jobs.</p>
        </div>
        <Pill tone="red">Needs attention</Pill>
      </div>
      {room.exhaustedAttention.truncated && <p className="github-queue-note">
        More exhausted jobs will appear after queued recoveries are processed and this page refreshes.
      </p>}
      <ol className="github-exhausted-list">
        {room.exhaustedAttention.items.map((item) => <ExhaustedRecoveryItem
          key={item.jobId}
          item={item}
          repositoryName={room.repositories.find((repository) => repository.id === item.repositoryId)?.name ?? null}
          role={role}
          pending={pending}
          runAction={runAction}
        />)}
      </ol>
    </section>}

    <section className="github-control-room-section" aria-labelledby="github-official-title">
      <div className="github-control-room-heading">
        <div><p className="eyebrow">OFFICIAL RESULT REVIEW</p><h3 id="github-official-title">Repository status</h3></div>
        <span>{room.pagination.total} selected {room.pagination.total === 1 ? "repository" : "repositories"}</span>
      </div>
      {room.repositories.length === 0 ? <p className="github-control-room-empty">No selected repository is ready to review.</p> : <div className="github-official-repository-list">
        {room.repositories.map((repository) => <RepositoryOfficialCard
          key={repository.id}
          repository={repository}
          room={room}
          installationHealthy={!unhealthyRepositoryIds.includes(repository.id)}
          exactReviewedApprovalActive={exactReviewedApprovalActive}
          role={role}
          runAction={runAction}
          pending={pending}
        />)}
      </div>}
      {(hasPreviousPage || hasNextPage) && <nav className="github-control-room-pagination" aria-label="Repository result pages">
        {hasPreviousPage
          ? <a className="button secondary" href={`/app/monitoring?githubPage=${currentPage - 1}`}>Previous repositories</a>
          : <span />}
        <span>Page {currentPage}</span>
        {hasNextPage && <a className="button secondary" href={`/app/monitoring?githubPage=${currentPage + 1}`}>Next repositories</a>}
      </nav>}
    </section>
    <p className="github-control-room-status" role="status" aria-live="polite">{message}</p>
  </section>;
}
