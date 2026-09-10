"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  raiseTaskFromFindingAction,
  transitionGitHubFindingAction,
} from "@/app/app/monitoring/actions";
import { Pill } from "@/components/ui";
import type { ActiveMonitoringFindingStatus } from "@/features/monitoring/domain/finding-status";
import type {
  GitHubFindingTransitionStatus,
  OfficialGitHubEvidenceProvenance,
  OfficialGitHubFindingProvenance,
  OfficialGitHubRecordProvenance,
} from "../application/github-record-provenance";
import { githubEvidenceTitle, githubFindingPresentation } from "./github-check-presentation";
import { formatMonitoringTime } from "./format-monitoring-time";

const STATUS_LABEL: Record<GitHubFindingTransitionStatus, string> = {
  open: "Open",
  acknowledged: "Acknowledged",
  in_progress: "In progress",
  exception_requested: "Exception requested",
  risk_accepted: "Risk accepted",
};

function formatTime(value: string): string {
  return formatMonitoringTime(value) ?? "Date unavailable";
}

function FocusedOfficialRecord({
  id,
  label,
  selected,
  children,
}: {
  id: string;
  label: string;
  selected: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (selected) ref.current?.focus();
  }, [selected]);

  return <article
    ref={ref}
    id={id}
    className="github-official-record"
    aria-label={label}
    aria-current={selected ? "true" : undefined}
    data-selected={selected ? "true" : undefined}
    tabIndex={-1}
  >{children}</article>;
}

function ProvenanceDetails({ record }: { record: OfficialGitHubRecordProvenance }) {
  const freshnessLabel = record.freshness === "current"
    ? `Current through ${formatTime(record.freshUntil)}`
    : `Stale since ${formatTime(record.freshUntil)}`;
  return <>
    <div className="github-official-record-head">
      <a href={record.repository.url} target="_blank" rel="noreferrer" aria-label={`Open ${record.repository.name} on GitHub`}>
        {record.repository.name}
      </a>
      <Pill tone={record.freshness === "current" ? "green" : "amber"}>{freshnessLabel}</Pill>
    </div>
    <p className="github-official-record-summary">{record.catalogueSummary}</p>
    <details className="evidence-disclosure"><summary>Technical details</summary>
    <dl className="github-official-provenance">
      <div><dt>Check</dt><dd><code>{record.checkId}</code></dd></div>
      <div><dt>ISO references</dt><dd>{record.isoControlReferences.join(" · ")}</dd></div>
      <div><dt>Observed</dt><dd><time dateTime={record.observedAt}>{formatTime(record.observedAt)}</time></dd></div>
      <div><dt>Materialised</dt><dd><time dateTime={record.materialisedAt}>{formatTime(record.materialisedAt)}</time></dd></div>
      <div><dt>Rule version</dt><dd><code>{record.ruleVersion}</code></dd></div>
      <div><dt>Mapping version</dt><dd><code>{record.mappingVersion}</code></dd></div>
      <div className="github-official-provenance-wide"><dt>Mapping checksum</dt><dd><code>{record.mappingChecksum}</code></dd></div>
    </dl>
    </details>
  </>;
}

export function OfficialGitHubEvidenceCard({
  record,
  selected,
}: {
  record: OfficialGitHubEvidenceProvenance;
  selected: boolean;
}) {
  return <FocusedOfficialRecord
    id={`evidence-${record.evidenceId}`}
    label={`Official GitHub evidence ${record.checkId}`}
    selected={selected}
  >
    <div className="finding-head">
      <Pill tone="blue">Official GitHub evidence</Pill>
      <h2>{githubEvidenceTitle(record.checkId)}</h2>
    </div>
    <ProvenanceDetails record={record} />
    <p className="github-official-boundary" role="note">
      This is approved technical repository evidence for human review. It does not certify ISO/IEC 27001 compliance or change readiness by itself.
    </p>
  </FocusedOfficialRecord>;
}

export function OfficialGitHubEvidenceProvenancePanel({ record }: { record: OfficialGitHubEvidenceProvenance }) {
  return <section className="github-technical-evidence" aria-label={`Official GitHub provenance ${record.checkId}`}>
    <ProvenanceDetails record={record} />
    <p className="github-official-boundary" role="note">
      This is approved technical repository evidence for human review. It does not certify ISO/IEC 27001 compliance or change readiness by itself.
    </p>
  </section>;
}

function OfficialFindingActions({
  findingId,
  currentStatus,
  allowedTransitions,
  canRaiseTask,
}: {
  findingId: string;
  currentStatus: ActiveMonitoringFindingStatus;
  allowedTransitions: GitHubFindingTransitionStatus[];
  canRaiseTask: boolean;
}) {
  const router = useRouter();
  const options = useMemo(
    () => allowedTransitions.filter((status) => status !== currentStatus),
    [allowedTransitions, currentStatus],
  );
  const [targetStatus, setTargetStatus] = useState<GitHubFindingTransitionStatus>(options[0] ?? "open");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const selectedTargetStatus = options.includes(targetStatus) ? targetStatus : options[0] ?? "open";

  function updateStatus() {
    const form = new FormData();
    form.set("id", findingId);
    form.set("status", selectedTargetStatus);
    startTransition(async () => {
      try {
        const result = await transitionGitHubFindingAction(form);
        setMessage(result.message);
        if (result.ok) router.refresh();
      } catch {
        setMessage("Could not update the official GitHub finding.");
      }
    });
  }

  function raiseTask() {
    const form = new FormData();
    form.set("id", findingId);
    startTransition(async () => {
      try {
        await raiseTaskFromFindingAction(form);
        setMessage("Remediation task is linked to this GitHub finding.");
        router.refresh();
      } catch {
        setMessage("Could not raise the remediation task.");
      }
    });
  }

  return <div className="github-finding-review">
    {options.length > 0 && <div className="github-finding-review-controls">
      <label>Review state
        <select value={selectedTargetStatus} onChange={(event) => setTargetStatus(event.target.value as GitHubFindingTransitionStatus)} disabled={pending}>
          {options.map((status) => <option key={status} value={status}>{STATUS_LABEL[status]}</option>)}
        </select>
      </label>
      <button className="button secondary" type="button" disabled={pending} onClick={updateStatus}>Update review state</button>
    </div>}
    {canRaiseTask && <button className="button secondary" type="button" disabled={pending} onClick={raiseTask}>Raise remediation task</button>}
    <p role="status" aria-live="polite">{message}</p>
  </div>;
}

export function OfficialGitHubFindingCard({
  record,
  status,
  taskId,
  role,
  selected,
}: {
  record: OfficialGitHubFindingProvenance;
  status: ActiveMonitoringFindingStatus;
  taskId: string | null;
  role: "owner" | "admin" | "member";
  selected: boolean;
}) {
  const presentation = githubFindingPresentation(record.checkId);
  const freshnessLabel = record.freshness === "current"
    ? `Current through ${formatTime(record.freshUntil)}`
    : `Stale since ${formatTime(record.freshUntil)}`;
  return <FocusedOfficialRecord
    id={`finding-${record.findingId}`}
    label={`GitHub finding: ${presentation.title}`}
    selected={selected}
  >
    <div className="finding-head">
      <Pill tone={record.severity === "critical" || record.severity === "high" ? "red" : "amber"}>{record.severity}</Pill>
      <h3>{presentation.title}</h3>
      <Pill tone={status === "risk_accepted" ? "blue" : status === "open" ? "red" : "amber"}>{STATUS_LABEL[status]}</Pill>
    </div>
    <div className="github-official-record-head">
      <a href={record.repository.url} target="_blank" rel="noreferrer" aria-label={`Open ${record.repository.name} on GitHub`}>
        {record.repository.name}
      </a>
      <Pill tone={record.freshness === "current" ? "green" : "amber"}>{freshnessLabel}</Pill>
    </div>
    <p className="github-official-record-summary">{presentation.explanation}</p>
    <p className="github-finding-remediation"><strong>Recommended action:</strong> {presentation.remediation}</p>
    <dl className="github-finding-overview">
      <div><dt>ISO references</dt><dd>{record.isoControlReferences.join(" · ")}</dd></div>
      <div><dt>Observed</dt><dd><time dateTime={record.observedAt}>{formatTime(record.observedAt)}</time></dd></div>
    </dl>
    {taskId && <Link href={`/app/tasks/${taskId}`}>Open remediation task</Link>}
    {role === "owner"
      ? <OfficialFindingActions findingId={record.findingId} currentStatus={status} allowedTransitions={record.allowedTransitions} canRaiseTask={!taskId} />
      : <p className="github-read-only-note" role="note">Official finding review is read-only for your role. A workspace Owner records review-state decisions.</p>}
    <details className="github-technical-evidence">
      <summary>Technical evidence</summary>
      <p>{record.catalogueSummary}</p>
      <dl className="github-official-provenance">
        <div><dt>Check</dt><dd><code>{record.checkId}</code></dd></div>
        <div><dt>Rule version</dt><dd><code>{record.ruleVersion}</code></dd></div>
        <div><dt>Mapping version</dt><dd><code>{record.mappingVersion}</code></dd></div>
        <div><dt>Materialised</dt><dd><time dateTime={record.materialisedAt}>{formatTime(record.materialisedAt)}</time></dd></div>
        <div><dt>First detected</dt><dd><time dateTime={record.firstDetectedAt}>{formatTime(record.firstDetectedAt)}</time></dd></div>
        <div><dt>Most recent detection</dt><dd><time dateTime={record.mostRecentDetectedAt}>{formatTime(record.mostRecentDetectedAt)}</time></dd></div>
        <div className="github-official-provenance-wide"><dt>Mapping checksum</dt><dd><code>{record.mappingChecksum}</code></dd></div>
      </dl>
      <p className="github-official-boundary" role="note">
        This technical signal does not certify ISO/IEC 27001 compliance or change readiness. It automatically resolves only after a newer fresh passing check; human review, task completion, an exception request, or risk acceptance does not turn it into a passing result.
      </p>
    </details>
  </FocusedOfficialRecord>;
}
