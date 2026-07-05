import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { Card, PageIntro } from "@/components/ui";
import { createSoaAction } from "../actions";

export default async function SoaPage() {
  const { supabase } = await requireAppContext();
  const [{ data: assessments }, { data: registers }, { data: snapshots }] = await Promise.all([
    supabase.from("assessment_sessions").select("id,title").order("updated_at", { ascending: false }),
    supabase.from("soa_registers").select("id,title,version,updated_at").order("updated_at", { ascending: false }),
    supabase.from("soa_snapshots").select("id,title,version,finalised_at").order("finalised_at", { ascending: false }),
  ]);
  return <>
    <PageIntro eyebrow="SOA" title="Statement of Applicability" body="Generate a draft from an assessment, review every applicability decision, then finalise an immutable snapshot." action={<span style={{ display: "flex", gap: "8px" }}>
      <a className="button secondary" href={`/api/app/soa/export?format=xlsx`}>Export XLSX</a>
      <a className="button secondary" href={`/api/app/soa/export?format=csv`}>CSV</a>
      <Link className="button secondary" href="/app/soa/import">Import</Link>
    </span>} />
    <Card style={{ padding: "16px" }}><form action={createSoaAction} style={{ display: "flex", gap: "12px" }}><select name="assessmentId" required style={{ flex: 1 }}><option value="">Select an assessment</option>{assessments?.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}</select><button className="button primary">Generate draft</button></form></Card>
    <h2 style={{ fontSize: "16px", margin: "24px 0 12px" }}>Drafts</h2><Card>{registers?.length ? registers.map((r) => <Link href={`/app/soa/${r.id}`} key={r.id} style={{ display: "block", padding: "14px 18px", borderTop: "1px solid #edf0f4" }}>{r.title} <span style={{ float: "right" }}>v{r.version}</span></Link>) : <p style={{ padding: "18px", color: "#596273" }}>No drafts yet.</p>}</Card>
    <h2 style={{ fontSize: "16px", margin: "24px 0 12px" }}>Finalised snapshots</h2><Card>{snapshots?.length ? snapshots.map((s) => <div style={{ padding: "14px 18px", borderTop: "1px solid #edf0f4" }} key={s.id}>{s.title} v{s.version}<span style={{ float: "right" }}><a style={{ color: "var(--blue)", marginRight: "12px" }} href={`/api/app/soa/${s.id}/pdf`}>PDF</a><a style={{ color: "var(--blue)" }} href={`/api/app/soa/${s.id}/docx`}>DOCX</a></span></div>) : <p style={{ padding: "18px", color: "#596273" }}>No finalised snapshots yet.</p>}</Card>
  </>;
}
