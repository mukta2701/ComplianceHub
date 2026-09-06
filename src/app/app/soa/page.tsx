import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { Card, EmptyState, ModuleExplainer, PageIntro } from "@/components/ui";
import { SubTabs } from "@/components/sub-tabs";
import { getModuleGuidance } from "@/features/education/domain/guidance";
import { createSoaAction } from "../actions";

export default async function SoaPage() {
  const { supabase, organisation, membership } = await requireAppContext();
  const [{ data: assessments }, { data: registers }, { data: snapshots }] = await Promise.all([
    supabase.from("assessment_sessions").select("id,title").eq("organisation_id", organisation.id).order("updated_at", { ascending: false }),
    supabase.from("soa_registers").select("id,title,version,updated_at").eq("organisation_id", organisation.id).order("updated_at", { ascending: false }),
    supabase.from("soa_snapshots").select("id,title,version,finalised_at").eq("organisation_id", organisation.id).order("finalised_at", { ascending: false }),
  ]);
  return <>
    <PageIntro eyebrow="SOA" title="Statement of Applicability" body="Review which security controls apply to your organisation, why they apply, and what evidence supports them." action={<span style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
      <a className="button secondary" href={`/api/app/soa/export?format=xlsx`}>Export XLSX</a>
      <a className="button secondary" href={`/api/app/soa/export?format=csv`}>CSV</a>
      {membership.role !== "member" && <Link className="button secondary" href="/app/soa/import">Import</Link>}
    </span>} />
    <SubTabs tabs={[{ href: "/app/soa", label: "Statement of Applicability" }, { href: "/app/frameworks", label: "Framework coverage" }]} />
    <details className="section-guide"><summary>How to use the SoA</summary><ModuleExplainer guidance={getModuleGuidance("soa")} /></details>
    {membership.role === "member" ? <Card style={{ padding: "18px" }}><b>Review access only</b><p style={{ margin: "6px 0 0", color: "#596273", fontSize: "13px" }}>You can open existing drafts and download finalised statements. A workspace operator must generate or finalise a statement.</p></Card> : assessments?.length ? (
      <Card style={{ padding: "16px" }}><form action={createSoaAction} style={{ display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "center" }}><label htmlFor="soa-assessment" style={{ display: "flex", alignItems: "center", color: "#596273", fontSize: "12px", fontWeight: 700 }}>Start from</label><select id="soa-assessment" name="assessmentId" required className="field" style={{ flex: "1 1 200px", minWidth: 0, maxWidth: "100%" }}><option value="">Select an assessment</option>{assessments.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}</select><button className="button primary">Generate draft</button></form></Card>
    ) : (
      <EmptyState icon="clipboard" title="Complete an assessment first" body="A Statement of Applicability is generated from a readiness assessment — its answers decide which controls apply. Complete an assessment, then come back here to generate your draft SoA." primary={{ href: "/app/assessment", label: "Start an assessment" }} />
    )}
    <h2 style={{ fontSize: "16px", margin: "24px 0 12px" }}>Draft statements</h2><Card>{registers?.length ? registers.map((r) => <Link href={`/app/soa/${r.id}`} key={r.id} style={{ display: "block", padding: "14px 18px", borderTop: "1px solid #edf0f4" }}>{r.title} <span style={{ float: "right" }}>v{r.version}</span></Link>) : <p style={{ padding: "18px", color: "#596273" }}>No draft statements yet. Generate one from an assessment when you are ready to review applicability decisions.</p>}</Card>
    <h2 style={{ fontSize: "16px", margin: "24px 0 12px" }}>Finalised statements</h2><Card>{snapshots?.length ? snapshots.map((s) => <div style={{ padding: "14px 18px", borderTop: "1px solid #edf0f4" }} key={s.id}>{s.title} <span style={{ marginLeft: "8px" }}>Version {s.version}</span><span style={{ float: "right" }}><a style={{ color: "var(--blue)", marginRight: "12px" }} href={`/api/app/soa/${s.id}/pdf`}>Download PDF</a><a style={{ color: "var(--blue)" }} href={`/api/app/soa/${s.id}/docx`}>Download DOCX</a></span></div>) : <p style={{ padding: "18px", color: "#596273" }}>No finalised statements yet. Finalise a reviewed draft when the applicability decisions and evidence references are ready.</p>}</Card>
  </>;
}
