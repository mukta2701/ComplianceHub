import { notFound } from "next/navigation";
import { requireAppContext } from "@/lib/app-context";
import { PageIntro } from "@/components/ui";
import { createGapTaskAction } from "../actions";

export default async function FromGapPage({ searchParams }: { searchParams: Promise<{ questionId?: string }> }) {
  const { questionId } = await searchParams;
  if (!questionId) notFound();
  const { supabase } = await requireAppContext();
  const { data: question } = await supabase.from("catalogue_questions").select("id,code,prompt,remediation").eq("id", questionId).maybeSingle();
  if (!question) notFound();
  const { data: acm } = await supabase.from("assessment_control_mappings").select("control_id").eq("catalogue_question_id", questionId).limit(1).maybeSingle();
  let control: { code: string; title: string } | null = null;
  if (acm) {
    const { data: rcm } = await supabase.from("requirement_control_mappings").select("control_id").eq("requirement_id", acm.control_id).limit(1).maybeSingle();
    if (rcm) { const { data: c } = await supabase.from("controls").select("code,title").eq("id", rcm.control_id).maybeSingle(); control = c ?? null; }
  }
  const { data: members } = await supabase.from("memberships").select("user_id,profiles(display_name)");
  const title = `Close gap: ${question.prompt}`;
  return <>
    <PageIntro eyebrow="REMEDIATION" title="Accept gap as task" body="Assign an owner and a due date. A dated, owned task is created and the gap stays visible until it is done." />
    {control && <p style={{ fontSize: "12px", color: "#596273", marginBottom: "12px" }}>Linked control: <b>{control.code}: {control.title}</b></p>}
    <form action={createGapTaskAction} className="card app-form">
      <input type="hidden" name="questionId" value={question.id} />
      <label>Title<input name="title" readOnly value={title} style={{ background: "#f6f8fb" }} /></label>
      <label>Detail<textarea name="detail" readOnly defaultValue={question.remediation} style={{ background: "#f6f8fb" }} /></label>
      <div className="form-grid">
        <label>Owner<select name="ownerId" required defaultValue=""><option value="" disabled>Select an owner</option>{members?.map((m) => { const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles; return <option key={m.user_id} value={m.user_id}>{p?.display_name ?? m.user_id}</option>; })}</select></label>
        <label>Due date<input name="dueOn" type="date" required /></label>
      </div>
      <button className="button primary">Create task</button>
    </form>
  </>;
}
