import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { Card, EmptyState, PageIntro } from "@/components/ui";
import { createAssessmentAction } from "../actions";

export default async function AssessmentsPage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const { supabase } = await requireAppContext(); const { message } = await searchParams;
  const { data } = await supabase.from("assessment_sessions").select("id,title,state,revision,updated_at").order("updated_at", { ascending: false });
  return <>
    <PageIntro eyebrow="ASSESSMENT" title="Readiness assessments" body="Complete the original plain-English catalogue and retain evidence notes." action={<span style={{ display: "flex", gap: "8px" }}>
      <a className="button secondary" href="/api/app/assessment/export?format=xlsx">Export XLSX</a>
      <a className="button secondary" href="/api/app/assessment/export?format=csv">CSV</a>
      <form action={createAssessmentAction}><button className="button primary">New assessment</button></form>
    </span>} />
    {message && <Card style={{ padding: "12px", background: "#fffbef", borderColor: "#efe1aa", marginBottom: "12px" }}>{message}</Card>}
    {data?.length ? (
      <Card>{data.map((item) => <Link style={{ display: "block", padding: "16px 18px", borderTop: "1px solid #edf0f4" }} href={`/app/assessment/${item.id}`} key={item.id}><b>{item.title}</b><span style={{ float: "right", textTransform: "capitalize", color: "#596273" }}>{item.state} · revision {item.revision}</span></Link>)}</Card>
    ) : (
      <EmptyState icon="clipboard" title="Start your first assessment" body="Answer the plain-English readiness catalogue to see exactly where you stand, capture evidence notes as you go, and turn any gaps into risks and tasks. It only takes a few minutes to begin." action={<form action={createAssessmentAction}><button className="button primary">Start your first assessment</button></form>} />
    )}
  </>;
}
