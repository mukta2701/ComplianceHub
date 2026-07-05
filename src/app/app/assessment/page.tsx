import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { Card, PageIntro } from "@/components/ui";
import { createAssessmentAction } from "../actions";

export default async function AssessmentsPage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const { supabase } = await requireAppContext(); const { message } = await searchParams;
  const { data } = await supabase.from("assessment_sessions").select("id,title,state,revision,updated_at").order("updated_at", { ascending: false });
  return <>
    <PageIntro eyebrow="ASSESSMENT" title="Readiness assessments" body="Complete the original plain-English catalogue and retain evidence notes." action={<form action={createAssessmentAction}><button className="button primary">New assessment</button></form>} />
    {message && <Card style={{ padding: "12px", background: "#fffbef", borderColor: "#efe1aa", marginBottom: "12px" }}>{message}</Card>}
    <Card>{data?.length ? data.map((item) => <Link style={{ display: "block", padding: "16px 18px", borderTop: "1px solid #edf0f4" }} href={`/app/assessment/${item.id}`} key={item.id}><b>{item.title}</b><span style={{ float: "right", textTransform: "capitalize", color: "#596273" }}>{item.state} · revision {item.revision}</span></Link>) : <p style={{ padding: "20px", color: "#596273" }}>No assessments yet.</p>}</Card>
  </>;
}
