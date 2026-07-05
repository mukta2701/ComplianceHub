import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { summariseEvidenceFreshness, type EvidenceStatus } from "@/features/evidence/domain/evidence";
import { Card, PageIntro, Pill, Stat } from "@/components/ui";
import { Icon } from "@/components/icons";
import { downloadEvidenceAction, linkEvidenceAction, unlinkEvidenceAction, withdrawEvidenceAction } from "./actions";

const TONE: Record<string, string> = { current: "green", expiring: "amber", expired: "red", superseded: "neutral", withdrawn: "neutral" };

export default async function EvidencePage() {
  const { supabase } = await requireAppContext();
  const [{ data: items }, { data: controls }] = await Promise.all([
    supabase.from("evidence").select("id,title,kind,url,storage_path,status,collected_on,valid_until,evidence_links(id,control_id,risk_id,task_id,controls(code,title),risks(reference),tasks(title))").order("created_at", { ascending: false }),
    supabase.from("controls").select("id,code,title").order("position"),
  ]);
  const freshness = summariseEvidenceFreshness((items ?? []).map((i) => ({ status: i.status as EvidenceStatus })));
  return <>
    <PageIntro eyebrow="EVIDENCE" title="Evidence vault" body="Immutable proof attached to controls — freshness is re-checked by the daily sweep, and stale items raise tasks automatically." action={<span style={{ display: "flex", gap: "8px" }}>
      <a className="button secondary" href="/api/app/evidence/export?format=xlsx">Export XLSX</a>
      <a className="button secondary" href="/api/app/evidence/export?format=csv">CSV</a>
      <Link className="button primary" href="/app/evidence/new"><Icon name="plus" />Add evidence</Link>
    </span>} />
    <div className="stats-grid"><Stat label="EVIDENCE ITEMS" value={freshness.total} detail="files, links and notes" /><Stat label="EXPIRING SOON" value={freshness.expiring} detail="within 30 days" tone="amber" /><Stat label="EXPIRED" value={freshness.expired} detail="replacement task raised" tone="red" /></div>
    <div style={{ display: "grid", gap: "14px" }}>{items?.map((item) => <Card key={item.id} style={{ padding: "20px" }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "12px", alignItems: "center" }}>
        <div><h2 style={{ fontSize: "15px", margin: 0 }}>{item.title}</h2><p style={{ fontSize: "12px", color: "#596273", margin: "3px 0 0" }}>Collected {item.collected_on}{item.valid_until && ` · valid until ${item.valid_until}`}</p></div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}><Pill tone={TONE[item.status]}>{item.status}</Pill>
          {item.kind === "link" && item.url && <a style={{ color: "var(--blue)", fontWeight: 700, fontSize: "12px" }} href={item.url} rel="noreferrer" target="_blank">Open link</a>}
          {item.kind === "file" && <form action={downloadEvidenceAction}><input type="hidden" name="id" value={item.id} /><button className="button secondary" style={{ minHeight: "32px", padding: "6px 12px" }}>Download</button></form>}
          {(item.status === "current" || item.status === "expiring" || item.status === "expired") && <><Link style={{ color: "var(--blue)", fontWeight: 700, fontSize: "12px" }} href={`/app/evidence/new?replaces=${item.id}`}>Supersede</Link><form action={withdrawEvidenceAction}><input type="hidden" name="id" value={item.id} /><button className="button secondary" style={{ minHeight: "32px", padding: "6px 12px", color: "var(--red)" }}>Withdraw</button></form></>}
        </div>
      </div>
      <div style={{ marginTop: "12px", display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
        {item.evidence_links?.map((link) => { const c = Array.isArray(link.controls) ? link.controls[0] : link.controls; const r = Array.isArray(link.risks) ? link.risks[0] : link.risks; const t = Array.isArray(link.tasks) ? link.tasks[0] : link.tasks; return <span key={link.id} className="pill neutral">{c ? `${c.code}: ${c.title}` : r ? `Risk ${r.reference}` : `Task: ${t?.title}`}<form action={unlinkEvidenceAction} style={{ display: "inline" }}><input type="hidden" name="linkId" value={link.id} /><button aria-label="Remove link" style={{ border: 0, background: "none", color: "#8b94a2", marginLeft: "4px" }}>×</button></form></span>; })}
        <form action={linkEvidenceAction} style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}><input type="hidden" name="evidenceId" value={item.id} /><select name="target" defaultValue="" aria-label={`Link ${item.title} to a control`} className="rounded"><option value="" disabled>Link to control…</option>{controls?.map((c) => <option key={c.id} value={`control:${c.id}`}>{c.code}: {c.title}</option>)}</select><button className="button secondary" style={{ minHeight: "32px", padding: "6px 12px" }}>Link</button></form>
      </div>
    </Card>)}
    {!items?.length && <Card style={{ padding: "24px", color: "#596273" }}>No evidence yet. Add your first item to start tracking freshness — files, links, or notes attach to any control, risk, or task.</Card>}
    </div>
  </>;
}
