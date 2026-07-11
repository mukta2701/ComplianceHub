import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { Card, EmptyState, PageIntro, Pill } from "@/components/ui";
import { Icon } from "@/components/icons";
import { one } from "@/lib/supabase/one";
import { downloadEvidenceAction, linkEvidenceAction, unlinkEvidenceAction, withdrawEvidenceAction } from "./actions";

const TONE: Record<string, string> = { current: "green", expiring: "amber", expired: "red", superseded: "neutral", withdrawn: "neutral" };
const PROVIDER_LABELS: Record<string, string> = { google_workspace: "Google Workspace", github: "GitHub", aws: "AWS" };

export default async function EvidencePage() {
  const { supabase } = await requireAppContext();
  const [{ data: items }, { data: controls }, { data: policies }] = await Promise.all([
    supabase.from("evidence").select("id,title,kind,url,storage_path,status,collected_on,valid_until,source_id,evidence_sources(provider),evidence_links(id,control_id,risk_id,task_id,controls(code,title),risks(reference),tasks(title))").order("created_at", { ascending: false }).limit(200),
    supabase.from("controls").select("id,code,title").order("position"),
    supabase.from("policies").select("id,reference,title").order("reference"),
  ]);
  const evidence = { current: 0, expiring: 0, expired: 0 };
  for (const i of items ?? []) { const st = i.status as string; if (st === "current" || st === "expiring" || st === "expired") evidence[st] += 1; }
  const evidenceTotal = evidence.current + evidence.expiring + evidence.expired;
  const linkOptions = (
    <>
      {controls?.map((c) => <option key={c.id} value={`control:${c.id}`}>{c.code}: {c.title}</option>)}
      <optgroup label="Policies">{policies?.map((p) => <option key={p.id} value={`policy:${p.id}`}>{p.reference}: {p.title}</option>)}</optgroup>
    </>
  );
  return <>
    <PageIntro eyebrow="EVIDENCE" title="Evidence vault" body="Immutable proof attached to controls. Freshness is tracked automatically, and stale items raise a replacement task." action={<span style={{ display: "flex", gap: "8px" }}>
      <a className="button secondary" href="/api/app/evidence/export?format=xlsx">Export XLSX</a>
      <a className="button secondary" href="/api/app/evidence/export?format=csv">CSV</a>
      <Link className="button primary" href="/app/evidence/new"><Icon name="plus" />Add evidence</Link>
    </span>} />
    {!items?.length ? (
      <EmptyState icon="file" title="Add your first evidence" body="Attach immutable proof — files, links, or notes — to any control, risk, or task. Freshness is tracked automatically, and a replacement task is raised when something goes stale." primary={{ href: "/app/evidence/new", label: "Add your first evidence" }} />
    ) : (<>
    <Card style={{ marginBottom: "16px" }}>
      <div className="card-head"><div><h2 style={{ fontSize: "15px", margin: 0 }}>Evidence freshness</h2><p style={{ fontSize: "11.5px", color: "#596273", margin: "3px 0 0" }}>{evidenceTotal} live {evidenceTotal === 1 ? "item" : "items"} in your vault · stale items raise a replacement task</p></div></div>
      <div className="donut">
        <div className="donut-ring">
          <svg viewBox="0 0 120 120" aria-hidden="true"><g transform="rotate(-90 60 60)">
            {evidenceTotal === 0
              ? <circle className="d-empty" cx="60" cy="60" r="46" />
              : (() => {
                  const C = 2 * Math.PI * 46;
                  const parts = [{ v: evidence.current, cls: "d-good" }, { v: evidence.expiring, cls: "d-warn" }, { v: evidence.expired, cls: "d-risk" }].filter((p) => p.v > 0);
                  const gap = parts.length > 1 ? 3 : 0;
                  let acc = 0;
                  return parts.map((p, idx) => { const len = (p.v / evidenceTotal) * C; const dash = Math.max(len - gap, 0.5); const seg = <circle key={idx} className={p.cls} cx="60" cy="60" r="46" style={{ strokeDasharray: `${dash} ${C - dash}`, strokeDashoffset: -acc }} />; acc += len; return seg; });
                })()}
          </g></svg>
          <div className="donut-center"><div className="d-count">{evidenceTotal}</div><div className="d-sub">items</div></div>
        </div>
        <div className="donut-legend">
          <div className="seg-row"><span className="seg-dot" style={{ background: "var(--green)" }} />Current<b>{evidence.current}</b></div>
          <div className="seg-row"><span className="seg-dot" style={{ background: "var(--amber)" }} />Expiring<b>{evidence.expiring}</b></div>
          <div className="seg-row"><span className="seg-dot" style={{ background: "var(--red)" }} />Expired<b>{evidence.expired}</b></div>
        </div>
      </div>
    </Card>
    <div style={{ display: "grid", gap: "14px" }}>{items.map((item) => <Card key={item.id} style={{ padding: "20px" }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "12px", alignItems: "center" }}>
        <div><h2 style={{ fontSize: "15px", margin: 0 }}>{item.title}</h2><p style={{ fontSize: "12px", color: "#596273", margin: "3px 0 0" }}>Collected {item.collected_on}{item.valid_until && ` · valid until ${item.valid_until}`}</p></div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>{item.source_id && (() => { const src = one(item.evidence_sources); const provider = src?.provider ? PROVIDER_LABELS[src.provider] ?? src.provider : null; return <Pill tone="neutral">{provider ? `Auto · ${provider}` : "Auto"}</Pill>; })()}<Pill tone={TONE[item.status]}>{item.status}</Pill>
          {item.kind === "link" && item.url && <a style={{ color: "var(--blue)", fontWeight: 700, fontSize: "12px" }} href={item.url} rel="noreferrer" target="_blank">Open link</a>}
          {item.kind === "file" && <form action={downloadEvidenceAction}><input type="hidden" name="id" value={item.id} /><button className="button secondary" style={{ minHeight: "32px", padding: "6px 12px" }}>Download</button></form>}
          {(item.status === "current" || item.status === "expiring" || item.status === "expired") && <><Link style={{ color: "var(--blue)", fontWeight: 700, fontSize: "12px" }} href={`/app/evidence/new?replaces=${item.id}`}>Supersede</Link><form action={withdrawEvidenceAction}><input type="hidden" name="id" value={item.id} /><button className="button secondary" style={{ minHeight: "32px", padding: "6px 12px", color: "var(--red)" }}>Withdraw</button></form></>}
        </div>
      </div>
      <div style={{ marginTop: "12px", display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
        {item.evidence_links?.map((link) => { const c = one(link.controls); const r = one(link.risks); const t = one(link.tasks); return <span key={link.id} className="pill neutral">{c ? `${c.code}: ${c.title}` : r ? `Risk ${r.reference}` : `Task: ${t?.title}`}<form action={unlinkEvidenceAction} style={{ display: "inline" }}><input type="hidden" name="linkId" value={link.id} /><button aria-label="Remove link" style={{ border: 0, background: "none", color: "#8b94a2", marginLeft: "4px" }}>×</button></form></span>; })}
        <form action={linkEvidenceAction} style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}><input type="hidden" name="evidenceId" value={item.id} /><select name="target" defaultValue="" aria-label={`Link ${item.title} to a control`} className="field"><option value="" disabled>Link to control…</option>{linkOptions}</select><button className="button secondary" style={{ minHeight: "32px", padding: "6px 12px" }}>Link</button></form>
      </div>
    </Card>)}
    </div>
    </>)}
  </>;
}
