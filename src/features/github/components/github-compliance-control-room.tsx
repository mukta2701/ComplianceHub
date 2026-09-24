"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  processApprovedGitHubResultsAction,
  recordGitHubMappingEntryDecisionAction,
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
  classifyGitHubOfficialResult,
  countGitHubOfficialOutcomes,
  type GitHubOfficialResultCurrentness,
  type GitHubRepositoryComplianceState,
} from "../domain/compliance-control-room-state";
import { githubEvidenceTitle, groupChecksByArea } from "./github-check-presentation";

const STATE_PRESENTATION: Record<GitHubRepositoryComplianceState, { label: string; tone: string; detail: string }> = {
  needs_attention: {
    label: "Needs attention",
    tone: "red",
    detail: "GitHub access or collection processing needs attention. Review the statuses and recovery options below.",
  },
  awaiting_approval: {
    label: "Awaiting mapping review",
    tone: "amber",
    detail: "The latest processing job is waiting for a mapping review before it can produce official results.",
  },
  shadow: {
    label: "Collected, not official",
    tone: "blue",
    detail: "Collected checks exist, but no official evidence or findings have been produced yet.",
  },
  official_stale: {
    label: "Records need review",
    tone: "amber",
    detail: "Some results use an older mapping or are past their freshness window. Check each result label before relying on it as current.",
  },
  official_partial: {
    label: "Partial review",
    tone: "amber",
    detail: "Some checks have a current official result. Other checks have no current result yet and are excluded from these counts.",
  },
  official_current: {
    label: "Official records current",
    tone: "green",
    detail: "All 15 expected checks have a current result.",
  },
};

const RETRY_REASONS = [
  { value: "configuration_corrected", label: "Configuration corrected" },
  { value: "provider_recovered", label: "GitHub provider recovered" },
  { value: "owner_reviewed", label: "Owner reviewed" },
] as const;

function currentnessLabel(currentness: GitHubOfficialResultCurrentness): string {
  if (currentness === "historical") return "Historical mapping";
  return currentness === "stale" ? "Stale · recheck needed" : "Current";
}

function outcomeLabel(outcome: "pass" | "fail" | "unknown" | "not_applicable", current: boolean): string {
  if (!current) {
    if (outcome === "pass") return "Passed when recorded";
    if (outcome === "fail") return "Issue when recorded";
    if (outcome === "unknown") return "Could not verify then";
    return "Not applicable when recorded";
  }
  if (outcome === "pass") return "Verified technical pass";
  if (outcome === "fail") return "Verified issue";
  if (outcome === "unknown") return "Could not verify";
  return "Not applicable";
}

function outcomeTone(outcome: "pass" | "fail" | "unknown" | "not_applicable"): string {
  if (outcome === "pass") return "green";
  if (outcome === "fail") return "red";
  return outcome === "unknown" ? "amber" : "neutral";
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
  const exactApprovalActive = room.approval !== null
    && room.approval.mappingPackId === review.pack.id
    && room.approval.version === review.pack.version
    && room.approval.checksum === review.pack.checksum;
  const activeHistory = review.approvalHistory.find((approval) =>
    approval.revokedAt === null && approval.mappingPackId === room.approval?.mappingPackId,
  );
  const canManageMapping = workspaceAccess(role).section("monitoring").canManageOperation("approve-github-mapping");
  const counts = review.entries.reduce((total, entry) => {
    total[entry.review.status] += 1;
    return total;
  }, { pending: 0, approved: 0, rejected: 0 });

  function decide(entry: GitHubMappingReview["entries"][number], decision: "approved" | "rejected") {
    const form = new FormData();
    form.set("entryId", entry.id);
    form.set("entryDigest", entry.review.entryDigest);
    form.set("decision", decision);
    form.set("expectedRevision", String(entry.review.revision));
    return runAction(recordGitHubMappingEntryDecisionAction, form);
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
        <p className="eyebrow">OWNER MAPPING REVIEW</p>
        <h3 id="github-mapping-title">Individual mapping review</h3>
        <p>Review each check separately. Only approved mapping entries are used when producing official records.</p>
      </div>
    </div>

    <p className="github-mapping-review-counts" role="note" aria-label="GitHub mapping review status">
      {review.entries.length} checks · {counts.pending} pending · {counts.approved} approved · {counts.rejected} rejected
    </p>

    <dl className="github-mapping-identity">
      <div><dt>Version</dt><dd>{review.pack.version}</dd></div>
      <div><dt>Checksum</dt><dd><code>{review.pack.checksum}</code></dd></div>
      <div><dt>Published</dt><dd><time dateTime={review.pack.publishedAt}>{review.pack.publishedAt}</time></dd></div>
    </dl>

    <div className="github-limitations" role="note" aria-label="Mapping limitations">
      <strong>What this mapping does not prove</strong>
      <ul>{review.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
    </div>

    {canManageMapping && room.approval && (activeHistory ? <fieldset className="github-legacy-approval">
      <legend>Earlier pack-wide approval</legend>
      <p>{exactApprovalActive
        ? "This earlier approval covered the mapping as a pack. Check-by-check decisions below show the effective review for each entry. Revoking it removes only approvals inherited from that pack; individual check decisions remain in effect. Existing records remain historical."
        : "An earlier pack-wide approval is still active. Revoking it removes only approvals inherited from that pack; individual check decisions remain in effect. Existing records remain historical."}</p>
      <button className="button secondary" type="button" disabled={pending} onClick={() => void revoke()}>
        {exactApprovalActive ? "Revoke earlier approval" : "Revoke historical mapping"}
      </button>
    </fieldset> : <p className="github-read-only-note" role="note">
      The earlier approval record could not be verified. Refresh before attempting to revoke it.
    </p>)}

    {!canManageMapping && <p className="github-read-only-note" role="note">
      Only workspace Owners can decide mapping entries or recover processing.
    </p>}

    <div className="github-mapping-list">
      {groupChecksByArea(review.entries).map((section) => <section key={section.group.id} aria-label={section.group.title}>
        <h4 className="github-mapping-group">{section.group.title}</h4>
        {section.items.map((entry) => {
          const statusTone = entry.review.status === "approved" ? "green" : entry.review.status === "rejected" ? "red" : "amber";
          const canApproveEntry = entry.review.status !== "approved" || entry.review.source === "legacy_pack";
          const canRejectEntry = entry.review.status !== "rejected";
          return <article key={entry.id} aria-label={`${entry.checkId} mapping check`}>
          <div className="github-mapping-check-head">
            <div>
              <strong>{githubEvidenceTitle(entry.checkId)}</strong>
              <code>{entry.checkId}</code>
              <small>Rule {entry.ruleVersion}</small>
            </div>
            <div className="github-mapping-status-pills">
              <Pill tone={statusTone}>{entry.review.status === "pending" ? "Pending review" : entry.review.status === "approved" ? "Approved" : "Rejected"}</Pill>
              <Pill tone={entry.failureSeverity}>{entry.failureSeverity} if failed</Pill>
            </div>
          </div>
          {entry.review.source === "legacy_pack" && <p className="github-mapping-source">Effective status comes from an earlier pack-wide approval.</p>}
          {entry.review.source === "entry_decision" && entry.review.reviewedAt && <p className="github-mapping-source">
            Owner {entry.review.status} on <time dateTime={entry.review.reviewedAt}>{entry.review.reviewedAt}</time>
          </p>}
          {entry.review.source === "legacy_pack" && entry.review.reviewedAt && <p className="github-mapping-source">
            Earlier pack approved on <time dateTime={entry.review.reviewedAt}>{entry.review.reviewedAt}</time>
          </p>}
          {entry.review.changeReason === "changed" ? <p className="github-mapping-change-note" role="note">
            Mapping changed since its last review. This version needs a fresh Owner decision.
          </p> : entry.review.changeReason === "not_reviewed" ? <p className="github-mapping-change-note" role="note">
            This check has not been reviewed by an Owner yet.
          </p> : null}
          <dl className="github-mapping-entry-details">
            <div><dt>ISO references</dt><dd>{entry.isoControlReferences.join(" · ")}</dd></div>
            <div><dt>When the check passes</dt><dd>{entry.treatments.pass.summary}</dd></div>
            <div><dt>When the check finds an issue</dt><dd>{entry.treatments.fail.summary}</dd></div>
            <div><dt>When the result is unknown</dt><dd>{entry.treatments.unknown.summary}</dd></div>
            <div><dt>When the check does not apply</dt><dd>{entry.treatments.not_applicable.summary}</dd></div>
            <div><dt>Suggested remediation</dt><dd>{entry.remediation}</dd></div>
          </dl>
          {canManageMapping && <div className="github-mapping-decision-controls" role="group" aria-label={`Owner decision for ${entry.checkId}`}>
            {canApproveEntry && <button
              className="button primary"
              type="button"
              disabled={pending}
              aria-label={`Approve mapping for ${entry.checkId}`}
              onClick={() => void decide(entry, "approved")}
            >Approve check</button>}
            {canRejectEntry && <button
              className="button secondary"
              type="button"
              disabled={pending}
              aria-label={`Reject mapping for ${entry.checkId}`}
              onClick={() => void decide(entry, "rejected")}
            >Reject check</button>}
          </div>}
          </article>;
        })}
      </section>)}
    </div>

    <div className="github-approval-history">
      <h4>Earlier pack-wide approval history</h4>
      {review.approvalHistory.length === 0 ? <p>No earlier pack-wide approval has been recorded. Individual decisions are shown above.</p> : <ol>
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
  hasApprovedMappingEntry,
  role,
  runAction,
  pending,
}: {
  repository: GitHubComplianceControlRoom["repositories"][number];
  room: GitHubComplianceControlRoom;
  installationHealthy: boolean;
  hasApprovedMappingEntry: boolean;
  role: MembershipRole;
  runAction: (action: (formData: FormData) => Promise<{ ok: boolean; message: string }>, form: FormData) => Promise<void>;
  pending: boolean;
}) {
  const state = classifyGitHubRepositoryCompliance({
    asOf: room.asOf,
    installationHealthy,
    latestCollection: repository.latestCollection,
    latestMaterialisationJob: repository.latestMaterialisationJob,
    officialResults: repository.officialResults,
  });
  const presentation = STATE_PRESENTATION[state];
  const presentationLabel = state === "shadow" && !repository.latestCollection
    ? "No official results"
    : presentation.label;
  const counts = countGitHubOfficialOutcomes(repository.officialResults);
  const job = repository.latestMaterialisationJob;
  const run = repository.latestCollection;
  const stateDetail = !run && state === "awaiting_approval"
    ? "No collection has completed yet; the latest processing job is waiting for mapping review."
    : !run && state === "shadow"
      ? "No collection has completed, so there are no official results to show yet."
      : presentation.detail;
  const processingDetail = job?.status === "pending"
    ? "A newer collection is still processing. The counts below reflect current official results already recorded."
    : job?.status === "awaiting_approval"
      ? "A newer collection is waiting for mapping review before it can become official."
      : null;
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
      <Pill tone={presentation.tone}>{presentationLabel}</Pill>
    </header>
    <p className="github-state-detail">{stateDetail}</p>
    {processingDetail && <p className="github-processing-detail">{processingDetail}</p>}
    <h4 className="github-current-results-heading">Current results</h4>
    <dl className="github-outcome-counts">
      <div><dt>Passed</dt><dd>{counts.current.pass} passed</dd></div>
      <div><dt>Need action</dt><dd>{counts.current.fail} {counts.current.fail === 1 ? "needs" : "need"} action</dd></div>
      <div><dt>Could not verify</dt><dd>{counts.current.unknown} could not verify</dd></div>
      <div><dt>Not applicable</dt><dd>{counts.current.notApplicable} not applicable</dd></div>
    </dl>
    {(counts.historical > 0 || counts.stale > 0) && <p className="github-excluded-results-note">
      {counts.historical > 0 && <>{counts.historical} historical {counts.historical === 1 ? "result" : "results"}</>}
      {counts.historical > 0 && counts.stale > 0 && " · "}
      {counts.stale > 0 && <>{counts.stale} stale {counts.stale === 1 ? "result" : "results"}</>}
      {" (excluded from current counts; details remain below)"}
    </p>}

    {repository.officialResults.length > 0 && <details className="github-official-results">
      <summary>Inspect {repository.officialResults.length} latest results</summary>
      {groupChecksByArea(repository.officialResults).map((section) => <section key={section.group.id} aria-label={`${section.group.title} results`}>
        <h4 className="github-results-group">{section.group.title}</h4>
        <ul>{section.items.map((result) => {
          const currentness = classifyGitHubOfficialResult(result);
          const isCurrent = currentness === "current";
          const resultTone = isCurrent ? outcomeTone(result.outcome) : currentness === "stale" ? "amber" : "neutral";
          return <li key={result.id}>
        <div>
          <strong>{githubEvidenceTitle(result.checkId)}</strong>
          <code>{result.checkId}</code>
          <Pill tone={resultTone}>{outcomeLabel(result.outcome, isCurrent)}</Pill>
          <Pill tone={currentness === "current" ? "green" : currentness === "stale" ? "amber" : "neutral"}>{currentnessLabel(currentness)}</Pill>
        </div>
        <p>{result.summary}</p>
        <small>Rule {result.ruleVersion} · Mapping {result.mappingVersion}</small>
        <small>Observed <time dateTime={result.observedAt}>{result.observedAt}</time> · fresh until <time dateTime={result.freshUntil}>{result.freshUntil}</time></small>
        <span className="github-result-links">
          <a href={`/app/monitoring/github-results/${result.id}`} aria-label={`View recorded result for ${result.checkId}`}>View recorded result</a>
          {result.evidenceId && <a href={`/app/evidence?evidence=${result.evidenceId}#evidence-${result.evidenceId}`} aria-label={`View evidence for ${result.checkId}`}>View evidence</a>}
          {result.findingId && <a href={`/app/monitoring?finding=${result.findingId}#finding-${result.findingId}`} aria-label={`View finding for ${result.checkId}`}>View finding</a>}
        </span>
          </li>;
        })}</ul>
      </section>)}
    </details>}

    {canProcessResults && hasApprovedMappingEntry && run && job && ["pending", "awaiting_approval", "retryable"].includes(job.status)
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
  const hasApprovedMappingEntry = review.entries.some((entry) => entry.review.status === "approved");

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
          hasApprovedMappingEntry={hasApprovedMappingEntry}
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
