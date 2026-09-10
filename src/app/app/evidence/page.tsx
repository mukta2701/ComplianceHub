import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { Card, EmptyState, PageIntro, Pill, Stat } from "@/components/ui";
import { Icon } from "@/components/icons";
import { one } from "@/lib/supabase/one";
import { downloadEvidenceAction, linkEvidenceAction, unlinkEvidenceAction, withdrawEvidenceAction } from "./actions";
import { loadOfficialGitHubEvidenceProvenance, parseOfficialRecordSelection } from "@/features/github/application/github-record-provenance";
import { OfficialGitHubEvidenceCard } from "@/features/github/components/github-record-provenance";
import { AiSuggestionPanel } from "@/components/ai-suggestion-panel";
import styles from "./evidence.module.css";

const PAGE_SIZE = 25;
const STATUSES = ["all", "current", "expiring", "expired", "superseded", "withdrawn"] as const;
type EvidenceFilter = (typeof STATUSES)[number];
const TONE: Record<string, string> = { current: "green", expiring: "amber", expired: "red", superseded: "neutral", withdrawn: "neutral" };
const PROVIDER_LABELS: Record<string, string> = { google_workspace: "Google Workspace", github: "GitHub", aws: "AWS" };
const EVIDENCE_COLUMNS = "id,title,description,kind,url,storage_path,status,collected_on,valid_until,source_id,observation_key,external_ref,evidence_sources(provider),evidence_links(id,control_id,risk_id,task_id,policy_id,audit_checklist_item_id,audit_checklist_items(audit_id,checklist_item),controls(code,title),risks(reference),tasks(title),policies(reference,title))";

type SearchParams = { evidence?: string | string[]; status?: string | string[]; page?: string | string[] };

function parseFilter(value: SearchParams["status"]): EvidenceFilter {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value) ? value as EvidenceFilter : "all";
}

function parsePage(value: SearchParams["page"]): number {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

function hrefFor(filter: EvidenceFilter, page: number, evidence?: string) {
  const params = new URLSearchParams();
  if (filter !== "all") params.set("status", filter);
  if (page > 1) params.set("page", String(page));
  if (evidence) params.set("evidence", evidence);
  const query = params.toString();
  return `/app/evidence${query ? `?${query}` : ""}`;
}

function countValue(result: { count: number | null; error: unknown }, label: string): number | null {
  if (result.error) throw new Error(`Could not load ${label} evidence count`);
  return typeof result.count === "number" ? result.count : null;
}

function displayDate(value: string | null | undefined) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

export default async function EvidencePage({ searchParams }: { searchParams: Promise<SearchParams> } = { searchParams: Promise.resolve({}) }) {
  const { supabase, organisation, membership } = await requireAppContext();
  const isMember = membership?.role === "member";
  const params = await searchParams;
  const filter = parseFilter(params.status);
  const page = parsePage(params.page);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let listQuery = supabase.from("evidence").select(EVIDENCE_COLUMNS, { count: "exact" }).eq("organisation_id", organisation.id);
  if (filter !== "all") listQuery = listQuery.eq("status", filter);

  const [listResult, currentResult, expiringResult, expiredResult, archivedResult, aiResult] = await Promise.all([
    listQuery.order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, to),
    supabase.from("evidence").select("id", { count: "exact", head: true }).eq("organisation_id", organisation.id).eq("status", "current"),
    supabase.from("evidence").select("id", { count: "exact", head: true }).eq("organisation_id", organisation.id).eq("status", "expiring"),
    supabase.from("evidence").select("id", { count: "exact", head: true }).eq("organisation_id", organisation.id).eq("status", "expired"),
    supabase.from("evidence").select("id", { count: "exact", head: true }).eq("organisation_id", organisation.id).in("status", ["superseded", "withdrawn"]),
    supabase.from("ai_workspace_settings").select("enabled").eq("organisation_id", organisation.id).maybeSingle(),
  ]);
  if (listResult.error) throw new Error("Could not load evidence");
  if (aiResult.error) throw new Error("Could not load AI settings");
  const items = [...(listResult.data ?? [])];
  const filteredTotal = typeof listResult.count === "number" ? listResult.count : null;
  const counts = {
    current: countValue(currentResult, "current"),
    expiring: countValue(expiringResult, "expiring"),
    expired: countValue(expiredResult, "expired"),
    archived: countValue(archivedResult, "archived"),
  };

  const requestedEvidence = parseOfficialRecordSelection(params.evidence);
  let selectedMissing = false;
  let selectedItem = requestedEvidence ? items.find((item) => item.id === requestedEvidence) ?? null : items[0] ?? null;
  if (requestedEvidence && !selectedItem) {
    const { data, error } = await supabase.from("evidence").select(EVIDENCE_COLUMNS).eq("id", requestedEvidence).eq("organisation_id", organisation.id).maybeSingle();
    if (error) throw new Error("Could not load the selected evidence");
    selectedItem = data && !Array.isArray(data) ? data : null;
    selectedMissing = !selectedItem;
  }

  const provenanceIds = [...new Set([...(selectedItem ? [selectedItem.id] : []), ...items.map((item) => item.id)])].slice(0, 200);
  const officialRecords = await loadOfficialGitHubEvidenceProvenance(supabase, organisation.id, provenanceIds, new Date().toISOString());
  const officialByEvidence = new Map(officialRecords.map((record) => [record.evidenceId, record]));

  let controls: Array<{ id: string; code: string; title: string }> = [];
  let policies: Array<{ id: string; reference: string; title: string }> = [];
  let risks: Array<{ id: string; reference: string; title: string }> = [];
  let tasks: Array<{ id: string; title: string }> = [];
  if (!isMember) {
    const pickerResults = await Promise.all([
      supabase.from("controls").select("id,code,title").order("position"),
      supabase.from("policies").select("id,reference,title").eq("organisation_id", organisation.id).order("reference"),
      supabase.from("risks").select("id,reference,title").eq("organisation_id", organisation.id).in("status", ["open", "treating", "accepted"]).order("reference"),
      supabase.from("tasks").select("id,title").eq("organisation_id", organisation.id).in("status", ["open", "in_progress", "done"]).order("due_on", { ascending: true, nullsFirst: false }).order("title"),
    ]);
    if (pickerResults.some((result) => result.error)) throw new Error("Could not load evidence link options");
    controls = pickerResults[0].data ?? [];
    policies = pickerResults[1].data ?? [];
    risks = pickerResults[2].data ?? [];
    tasks = pickerResults[3].data ?? [];
  }

  const renderLinkedRecord = (link: NonNullable<NonNullable<typeof selectedItem>["evidence_links"]>[number], editing = false) => {
    const control = one(link.controls); const risk = one(link.risks); const task = one(link.tasks); const policy = one(link.policies); const audit = one(link.audit_checklist_items);
    const label = control ? `${control.code}: ${control.title}` : risk ? `Risk ${risk.reference}` : task ? `Task: ${task.title}` : policy ? `Policy: ${policy.reference}: ${policy.title}` : audit ? `Audit: ${audit.checklist_item}` : "Unspecified link";
    const href = risk && link.risk_id ? `/app/risks/${link.risk_id}` : task && link.task_id ? `/app/tasks/${link.task_id}` : policy && link.policy_id ? `/app/policies/${link.policy_id}` : audit ? `/app/audits/${audit.audit_id}` : null;
    return <span key={link.id} className={editing ? undefined : "pill neutral"}>{href && !editing ? <Link href={href}>{label}</Link> : label}</span>;
  };

  const linkOptions = <>
    <optgroup label="Controls">{controls.map((item) => <option key={item.id} value={`control:${item.id}`}>{item.code}: {item.title}</option>)}</optgroup>
    <optgroup label="Policies">{policies.map((item) => <option key={item.id} value={`policy:${item.id}`}>{item.reference}: {item.title}</option>)}</optgroup>
    <optgroup label="Risks">{risks.map((item) => <option key={item.id} value={`risk:${item.id}`}>Risk {item.reference}: {item.title}</option>)}</optgroup>
    <optgroup label="Tasks">{tasks.map((item) => <option key={item.id} value={`task:${item.id}`}>Task: {item.title}</option>)}</optgroup>
  </>;
  const selectedLinks = selectedItem?.evidence_links ?? [];
  const selectedControlLinks = selectedLinks.filter((link) => link.control_id);
  const selectedRelatedLinks = selectedLinks.filter((link) => !link.control_id);

  const firstVisible = filteredTotal === 0 || items.length === 0 ? 0 : from + 1;
  const lastVisible = filteredTotal === null ? from + items.length : Math.min(to + 1, filteredTotal);
  const totalPages = filteredTotal === null ? null : Math.max(1, Math.ceil(filteredTotal / PAGE_SIZE));
  const rangeText = filteredTotal === null ? `Showing ${items.length} evidence record${items.length === 1 ? "" : "s"} · total unavailable` : `Showing ${firstVisible}–${lastVisible} of ${filteredTotal} evidence records`;

  return <div className={styles.page}>
    <PageIntro eyebrow="EVIDENCE" title="Evidence vault" body="Find the proof behind your controls, understand its freshness, and trace where it is used." action={<span className={styles.pageActions}>
      <a className="button secondary" href="/api/app/evidence/export?format=xlsx">Export XLSX</a>
      <a className="button secondary" href="/api/app/evidence/export?format=csv">CSV</a>
      {!isMember && <Link className="button primary" href="/app/evidence/new"><Icon name="plus" />Add evidence</Link>}
    </span>} />
    <nav className={styles.journey} aria-label="Proof to audit journey">
      <Link href="/app/evidence" aria-current="page"><strong>1</strong>Evidence collected</Link>
      <Link href="/app/monitoring"><strong>2</strong>Systems watched</Link>
      <Link href="/app/audits"><strong>3</strong>Controls audited</Link>
    </nav>
    <div className={styles.summaryGrid} aria-label="Exact evidence freshness totals">
      <Stat label="CURRENT" value={counts.current ?? "—"} detail="Inside its validity window" tone="green" />
      <Stat label="EXPIRING" value={counts.expiring ?? "—"} detail="Review before expiry" tone="amber" />
      <Stat label="EXPIRED" value={counts.expired ?? "—"} detail="Fresh proof required" tone="red" />
      <Stat label="HISTORY" value={counts.archived ?? "—"} detail="Superseded or withdrawn" tone="violet" />
    </div>
    <p className={styles.truthNote}>Freshness describes the record’s validity window. It does not mean a person has reviewed or approved the evidence.</p>
    <div className={styles.toolbar}>
      <nav className={styles.filters} aria-label="Filter evidence by freshness">
        {STATUSES.map((status) => <Link key={status} href={hrefFor(status, 1)} aria-current={filter === status ? "page" : undefined}>{status === "all" ? "All evidence" : status[0].toUpperCase() + status.slice(1)}</Link>)}
      </nav>
      <p className={styles.range}>{rangeText}</p>
    </div>
    {selectedMissing && <p role="status">The selected evidence was not found in this workspace. Choose an available record below.</p>}
    {!items.length && !selectedItem ? <EmptyState icon="file" title={isMember ? "No evidence recorded yet" : "Add your first evidence"} body={isMember ? "Evidence added by workspace operators will appear here." : "Attach a file, link or note to a control, risk, policy, task or audit checklist item."} primary={isMember ? undefined : { href: "/app/evidence/new", label: "Add evidence" }} /> : <div className={styles.workspace}>
      <Card className={styles.listCard} aria-label="Evidence records">
        {items.length ? <ul className={styles.list}>{items.map((item) => { const source = one(item.evidence_sources); const official = officialByEvidence.get(item.id); const title = official?.catalogueSummary ?? item.title; const isSelected = selectedItem?.id === item.id; return <li key={item.id}><Link href={`${hrefFor(filter, page, item.id)}#evidence-${item.id}`} className={styles.recordLink} data-selected={isSelected}>
          {isSelected ? <span className={styles.recordTitle}>{title}</span> : <h3 className={styles.recordTitle}>{title}</h3>}<Pill tone={TONE[item.status]}>{item.status}</Pill>
          <span className={styles.recordMeta}><span>{item.kind}</span><span>Collected {displayDate(item.collected_on)}</span>{source?.provider && <span>{PROVIDER_LABELS[source.provider] ?? source.provider} source</span>}{item.source_id && item.observation_key && <span>Resource: {item.external_ref ?? "reference unavailable"}</span>}{item.source_id && !item.observation_key && <span>Legacy observation identity unknown</span>}</span>
        </Link></li>; })}</ul> : <p className={styles.emptyList}>No evidence matches this freshness filter.</p>}
        {filteredTotal !== null && filteredTotal > PAGE_SIZE && <nav className={styles.pagination} aria-label="Evidence pages">
          {page > 1 ? <Link className="button secondary" href={hrefFor(filter, page - 1)}>Previous</Link> : <span>First page</span>}
          <span>Page {page} of {totalPages}</span>
          {totalPages && page < totalPages ? <Link className="button secondary" href={hrefFor(filter, page + 1)}>Next</Link> : <span>Last page</span>}
        </nav>}
      </Card>
      {selectedItem && (officialByEvidence.has(selectedItem.id) ? <OfficialGitHubEvidenceCard record={officialByEvidence.get(selectedItem.id)!} selected={requestedEvidence === selectedItem.id} /> : <Card id={`evidence-${selectedItem.id}`} className={styles.detail}>
        <div className={styles.detailHeader}><div><p className={styles.eyebrow}>Selected evidence · {selectedItem.kind}</p><h2>{selectedItem.title}</h2></div><Pill tone={TONE[selectedItem.status]}>{selectedItem.status}</Pill></div>
        <dl className={styles.detailMeta}>
          <div><dt>Collected</dt><dd>{displayDate(selectedItem.collected_on)}</dd></div><div><dt>Valid until</dt><dd>{displayDate(selectedItem.valid_until)}</dd></div>
          <div><dt>Source</dt><dd>{selectedItem.source_id ? PROVIDER_LABELS[one(selectedItem.evidence_sources)?.provider ?? ""] ?? "Automated source" : "Added in ComplianceHub"}</dd></div>
          {selectedItem.source_id && <div><dt>Collection identity</dt><dd>{selectedItem.observation_key ? `Resource: ${selectedItem.external_ref ?? "reference unavailable"}` : "Legacy observation identity unknown"}</dd></div>}
        </dl>
        {selectedItem.description ? <p className={styles.description}>{selectedItem.description}</p> : <p className={styles.description}>No description was recorded.</p>}
        <div className={styles.recordActions}>
          {selectedItem.kind === "link" && selectedItem.url && <a className="button secondary" href={selectedItem.url} rel="noreferrer" target="_blank">Open link</a>}
          {selectedItem.kind === "file" && <form action={downloadEvidenceAction}><input type="hidden" name="id" value={selectedItem.id} /><button className="button secondary">Download file</button></form>}
          {!isMember && ["current", "expiring", "expired"].includes(selectedItem.status) && <><Link className="button secondary" href={`/app/evidence/new?replaces=${selectedItem.id}`}>Supersede</Link><form action={withdrawEvidenceAction}><input type="hidden" name="id" value={selectedItem.id} /><button className="button secondary">Withdraw</button></form></>}
        </div>
        {(selectedRelatedLinks.length > 0 || (selectedControlLinks.length > 0 && selectedControlLinks.length <= 3)) && <div className={styles.linked}>{selectedControlLinks.length <= 3 && selectedControlLinks.map((link) => renderLinkedRecord(link))}{selectedRelatedLinks.map((link) => renderLinkedRecord(link))}</div>}
        {selectedControlLinks.length > 3 && <details className={styles.disclosure}><summary>Linked controls ({selectedControlLinks.length})</summary><div className={styles.linked}>{selectedControlLinks.map((link) => renderLinkedRecord(link))}</div></details>}
        {!isMember && <details className={styles.disclosure}><summary>Manage links</summary><form action={linkEvidenceAction} className={styles.linkForm}><input type="hidden" name="evidenceId" value={selectedItem.id} /><select name="target" defaultValue="" aria-label={`Link ${selectedItem.title} to a control`}><option value="" disabled>Choose a control or record…</option>{linkOptions}</select><button className="button secondary">Link</button></form>
          {(selectedItem.evidence_links?.length ?? 0) > 0 && <ul className={styles.linkManagement}>{selectedItem.evidence_links?.map((link) => <li key={link.id}>{renderLinkedRecord(link, true)}<form action={unlinkEvidenceAction}><input type="hidden" name="linkId" value={link.id} /><button className="button secondary" aria-label="Remove link">Remove</button></form></li>)}</ul>}
        </details>}
        {aiResult.data?.enabled && <AiSuggestionPanel target={{ targetType: "evidence", targetId: selectedItem.id }} />}
      </Card>)}
    </div>}
  </div>;
}
