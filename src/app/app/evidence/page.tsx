import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { Card, EmptyState, PageIntro, Pill, Stat } from "@/components/ui";
import { Icon } from "@/components/icons";
import { one } from "@/lib/supabase/one";
import { downloadEvidenceAction, linkEvidenceAction, unlinkEvidenceAction, withdrawEvidenceAction } from "./actions";
import {
  loadOfficialGitHubEvidenceProvenance,
  parseOfficialRecordSelection,
} from "@/features/github/application/github-record-provenance";
import { OfficialGitHubEvidenceCard } from "@/features/github/components/github-record-provenance";
import { AiSuggestionPanel } from "@/components/ai-suggestion-panel";

const TONE: Record<string, string> = { current: "green", expiring: "amber", expired: "red", superseded: "neutral", withdrawn: "neutral" };
const PROVIDER_LABELS: Record<string, string> = { google_workspace: "Google Workspace", github: "GitHub", aws: "AWS" };

const EVIDENCE_COLUMNS = "id,title,description,kind,url,storage_path,status,collected_on,valid_until,source_id,evidence_sources(provider),evidence_links(id,control_id,risk_id,task_id,policy_id,audit_checklist_item_id,audit_checklist_items(audit_id,checklist_item),controls(code,title),risks(reference),tasks(title),policies(reference,title))";

export default async function EvidencePage({
  searchParams,
}: {
  searchParams: Promise<{ evidence?: string | string[] }>;
} = { searchParams: Promise.resolve({}) }) {
  const { supabase, organisation, membership } = await requireAppContext();
  const isMember = membership?.role === "member";
  const params = await searchParams;
  const [{ data: recentItems, error: itemsError }, { data: controls }, { data: policies }, { data: risks }, { data: tasks }, { data: aiSettings }] = await Promise.all([
    supabase.from("evidence").select(EVIDENCE_COLUMNS).eq("organisation_id", organisation.id).order("created_at", { ascending: false }).limit(200),
    supabase.from("controls").select("id,code,title").order("position"),
    supabase.from("policies").select("id,reference,title").eq("organisation_id", organisation.id).order("reference"),
    supabase.from("risks").select("id,reference,title").eq("organisation_id", organisation.id).in("status", ["open", "treating", "accepted"]).order("reference"),
    supabase.from("tasks").select("id,title").eq("organisation_id", organisation.id).in("status", ["open", "in_progress", "done"]).order("due_on", { ascending: true, nullsFirst: false }).order("title"),
    supabase.from("ai_workspace_settings").select("enabled").eq("organisation_id", organisation.id).maybeSingle(),
  ]);
  if (itemsError) throw new Error("Could not load evidence");
  const items = [...(recentItems ?? [])];
  const requestedEvidence = parseOfficialRecordSelection(params.evidence);
  let selectedMissing = false;
  if (requestedEvidence && !items.some((item) => item.id === requestedEvidence)) {
    const { data: selected, error } = await supabase.from("evidence").select(EVIDENCE_COLUMNS)
      .eq("id", requestedEvidence).eq("organisation_id", organisation.id).maybeSingle();
    if (error) throw new Error("Could not load the selected evidence");
    if (selected) items.unshift(selected); else selectedMissing = true;
  }
  const asOf = new Date().toISOString();
  const officialRecords = await loadOfficialGitHubEvidenceProvenance(
    supabase,
    organisation.id,
    (items ?? []).map((item) => item.id),
    asOf,
  );
  const officialByEvidence = new Map(officialRecords.map((record) => [record.evidenceId, record]));
  const selectedEvidence = requestedEvidence && officialByEvidence.has(requestedEvidence) ? requestedEvidence : null;
  const evidence = { current: 0, expiring: 0, expired: 0 };
  for (const i of items ?? []) { const st = i.status as string; if (st === "current" || st === "expiring" || st === "expired") evidence[st] += 1; }
  const linkOptions = (
    <>
      {controls?.map((c) => <option key={c.id} value={`control:${c.id}`}>{c.code}: {c.title}</option>)}
      <optgroup label="Policies">{policies?.map((p) => <option key={p.id} value={`policy:${p.id}`}>{p.reference}: {p.title}</option>)}</optgroup>
      <optgroup label="Risks">{risks?.map((risk) => <option key={risk.id} value={`risk:${risk.id}`}>Risk {risk.reference}: {risk.title}</option>)}</optgroup>
      <optgroup label="Tasks">{tasks?.map((task) => <option key={task.id} value={`task:${task.id}`}>Task: {task.title}</option>)}</optgroup>
    </>
  );
  return <div className="evidence-vault">
    <PageIntro eyebrow="EVIDENCE" title="Evidence vault" body="Store and review the files, links and notes that support your controls." action={<span style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
      <a className="button secondary" href="/api/app/evidence/export?format=xlsx">Export XLSX</a>
      <a className="button secondary" href="/api/app/evidence/export?format=csv">CSV</a>
      {!isMember && <Link className="button primary" href="/app/evidence/new"><Icon name="plus" />Add evidence</Link>}
    </span>} />
    {selectedMissing && <p role="status">The selected evidence was not found in this workspace. Choose an available record below.</p>}
    {!items?.length ? (
      <EmptyState icon="file" title={isMember ? "No evidence recorded yet" : "Add your first evidence"} body={isMember ? "Evidence added by workspace operators will appear here. You can read the metadata and download available files." : "Attach immutable proof — files, links, or notes — to any control, risk, or task. Freshness is tracked automatically, and a replacement task is raised when something goes stale."} primary={isMember ? undefined : { href: "/app/evidence/new", label: "Add your first evidence" }} />
    ) : (<>
    <div className="stats-grid" aria-label="Evidence freshness">
      <Stat label="CURRENT" value={evidence.current} detail="Ready for review" tone="green" />
      <Stat label="EXPIRING" value={evidence.expiring} detail="Review before expiry" tone="amber" />
      <Stat label="EXPIRED" value={evidence.expired} detail="Needs fresh evidence" tone="red" />
    </div>
    <div style={{ display: "grid", minWidth: 0, gap: "14px" }}>{items.map((item) => {
      const official = officialByEvidence.get(item.id);
      if (official) return <OfficialGitHubEvidenceCard key={item.id} record={official} selected={selectedEvidence === item.id} />;
      const controlLinks = (item.evidence_links ?? []).filter((link) => link.control_id);
      const relatedLinks = (item.evidence_links ?? []).filter((link) => !link.control_id);
      const renderLink = (link: NonNullable<typeof item.evidence_links>[number], editing = false) => {
        const c = one(link.controls); const r = one(link.risks); const t = one(link.tasks); const p = one(link.policies); const a = one(link.audit_checklist_items);
        const label = c ? `${c.code}: ${c.title}` : r ? `Risk ${r.reference}` : t ? `Task: ${t.title}` : p ? `Policy: ${p.reference}: ${p.title}` : a ? `Audit: ${a.checklist_item}` : "Unspecified link";
        const href = r && link.risk_id ? `/app/risks/${link.risk_id}` : t && link.task_id ? `/app/tasks/${link.task_id}` : p && link.policy_id ? `/app/policies/${link.policy_id}` : a ? `/app/audits/${a.audit_id}` : null;
        return <span key={link.id} className={editing ? "evidence-link-label" : "pill neutral"} style={{ maxWidth: "100%", whiteSpace: "normal", overflowWrap: "anywhere" }}>{href && !editing ? <Link href={href}>{label}</Link> : label}</span>;
      };
      return <Card key={item.id} id={`evidence-${item.id}`} style={{ minWidth: 0, overflow: "hidden", padding: "20px" }}>
      <div style={{ display: "flex", minWidth: 0, flexWrap: "wrap", justifyContent: "space-between", gap: "12px", alignItems: "center" }}>
        <div style={{ minWidth: 0, flex: "1 1 320px" }}><h2 style={{ fontSize: "15px", margin: 0, overflowWrap: "anywhere" }}>{item.title}</h2><p style={{ fontSize: "12px", color: "#596273", margin: "3px 0 0", overflowWrap: "anywhere" }}>Collected {item.collected_on}{item.valid_until && ` · valid until ${item.valid_until}`}</p></div>
        <div style={{ display: "flex", minWidth: 0, maxWidth: "100%", flexWrap: "wrap", alignItems: "center", gap: "12px" }}>{item.source_id && (() => { const src = one(item.evidence_sources); const provider = src?.provider ? PROVIDER_LABELS[src.provider] ?? src.provider : null; return <Pill tone="neutral">{provider ? `Auto · ${provider}` : "Auto"}</Pill>; })()}<Pill tone={TONE[item.status]}>{item.status}</Pill>
          {item.kind === "link" && item.url && <a style={{ color: "var(--blue)", fontWeight: 700, fontSize: "12px" }} href={item.url} rel="noreferrer" target="_blank">Open link</a>}
          {item.kind === "file" && <form action={downloadEvidenceAction}><input type="hidden" name="id" value={item.id} /><button className="button secondary" style={{ minHeight: "32px", padding: "6px 12px" }}>Download</button></form>}
          {!isMember && (item.status === "current" || item.status === "expiring" || item.status === "expired") && <><Link style={{ color: "var(--blue)", fontWeight: 700, fontSize: "12px" }} href={`/app/evidence/new?replaces=${item.id}`}>Supersede</Link><form action={withdrawEvidenceAction}><input type="hidden" name="id" value={item.id} /><button className="button secondary" style={{ minHeight: "32px", padding: "6px 12px", color: "var(--red)" }}>Withdraw</button></form></>}
        </div>
      </div>
      {item.description && <details className="evidence-disclosure" open={requestedEvidence === item.id}><summary>Evidence details</summary><p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{item.description}</p></details>}
      {(relatedLinks.length > 0 || (controlLinks.length > 0 && controlLinks.length <= 3)) && <div className="evidence-linked-records">
        {controlLinks.length <= 3 && controlLinks.map((link) => renderLink(link))}
        {relatedLinks.map((link) => renderLink(link))}
      </div>}
      {controlLinks.length > 3 && <details className="evidence-disclosure">
        <summary>Linked controls ({controlLinks.length})</summary>
        <div className="evidence-linked-records">{controlLinks.map((link) => renderLink(link))}</div>
      </details>}
      {!isMember && <details className="evidence-disclosure">
        <summary>Manage links</summary>
        <form action={linkEvidenceAction} className="evidence-link-form"><input type="hidden" name="evidenceId" value={item.id} /><select name="target" defaultValue="" aria-label={`Link ${item.title} to a control`} className="field"><option value="" disabled>Choose a control or record…</option>{linkOptions}</select><button className="button secondary">Link</button></form>
        {(item.evidence_links?.length ?? 0) > 0 && <ul className="evidence-link-management">
          {item.evidence_links?.map((link) => <li key={link.id}>{renderLink(link, true)}<form action={unlinkEvidenceAction}><input type="hidden" name="linkId" value={link.id} /><button className="button secondary" aria-label="Remove link">Remove</button></form></li>)}
        </ul>}
      </details>}
      {aiSettings?.enabled && <AiSuggestionPanel target={{ targetType: "evidence", targetId: item.id }} />}
    </Card>;
    })}
    </div>
    </>)}
  </div>;
}
