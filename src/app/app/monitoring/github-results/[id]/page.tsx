import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageIntro, Pill } from "@/components/ui";
import { requireAppContext } from "@/lib/app-context";
import {
  loadOfficialGitHubComplianceResult,
  parseOfficialRecordSelection,
} from "@/features/github/application/github-record-provenance";
import { githubEvidenceTitle } from "@/features/github/components/github-check-presentation";
import { formatMonitoringTime } from "@/features/github/components/format-monitoring-time";

const OUTCOME_LABEL = {
  pass: "Passed at observation",
  fail: "Failed at observation",
  unknown: "Could not be verified at observation",
  not_applicable: "Marked not applicable at observation",
} as const;
const OUTCOME_TONE = { pass: "neutral", fail: "red", unknown: "amber", not_applicable: "neutral" } as const;

function formatTime(value: string): string {
  return formatMonitoringTime(value) ?? "Date unavailable";
}

export default async function GitHubOfficialResultDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const resultId = parseOfficialRecordSelection(id);
  if (!resultId) notFound();

  const { supabase, organisation } = await requireAppContext();
  const result = await loadOfficialGitHubComplianceResult(supabase, organisation.id, resultId);
  if (!result) notFound();

  const freshness = result.freshness === "current"
    ? "Within freshness window"
    : "Freshness window expired";
  const freshnessDetail = result.freshness === "current"
    ? `Fresh until ${formatTime(result.freshUntil)}`
    : `Expired ${formatTime(result.freshUntil)}`;

  return <>
    <Link href="/app/monitoring" className="button secondary">← Back to Monitoring</Link>
    <PageIntro
      eyebrow="GITHUB RECORDED OBSERVATION"
      title="Recorded GitHub check"
      body="An immutable record of one check at one point in time."
    />
    <Card className="github-official-record" aria-label="Recorded GitHub result">
      <div className="finding-head">
        <Pill tone="neutral">Immutable observation</Pill>
        <Pill tone={OUTCOME_TONE[result.outcome]}>{OUTCOME_LABEL[result.outcome]}</Pill>
        {result.failureSeverity && <Pill tone="red">{result.failureSeverity} severity</Pill>}
        <Pill tone={result.freshness === "stale" ? "amber" : "neutral"}>{freshness}</Pill>
      </div>
      <div className="github-official-record-head">
        <a href={result.repository.url} target="_blank" rel="noreferrer" aria-label={`Open ${result.repository.name} on GitHub`}>
          {result.repository.name}
        </a>
      </div>
      <h2>{githubEvidenceTitle(result.checkId)}</h2>
      <p className="github-official-record-summary">{result.catalogueSummary}</p>
      <dl className="github-official-provenance">
        <div><dt>Recorded result ID</dt><dd><code>{result.resultId}</code></dd></div>
        <div><dt>Check</dt><dd><code>{result.checkId}</code></dd></div>
        <div><dt>ISO references</dt><dd>{result.isoControlReferences.join(" · ")}</dd></div>
        <div><dt>Observed</dt><dd><time dateTime={result.observedAt}>{formatTime(result.observedAt)}</time></dd></div>
        <div><dt>Freshness</dt><dd>{freshnessDetail}</dd></div>
        <div><dt>Materialised</dt><dd><time dateTime={result.materialisedAt}>{formatTime(result.materialisedAt)}</time></dd></div>
        <div><dt>Rule version</dt><dd><code>{result.ruleVersion}</code></dd></div>
        <div><dt>Mapping version</dt><dd><code>{result.mappingVersion}</code></dd></div>
      </dl>
      <p className="github-official-boundary" role="note">
        This immutable observation records what an approved rule saw at that time. Its freshness window describes the age of this observation; it does not prove today&apos;s compliance or confirm that the mapping remains approved. Review Monitoring for today&apos;s reviewed status and active alerts.
      </p>
      <Link className="button primary" href="/app/monitoring">Open today&apos;s Monitoring status</Link>
    </Card>
  </>;
}
