import { notFound } from "next/navigation";
import { requireAppContext } from "@/lib/app-context";
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
    if (rcm) {
      const { data: c } = await supabase.from("controls").select("code,title").eq("id", rcm.control_id).maybeSingle();
      control = c ?? null;
    }
  }
  const { data: members } = await supabase.from("memberships").select("user_id,profiles(display_name)");
  const title = `Close gap: ${question.prompt}`;
  return <><h1 className="text-3xl font-bold">Accept gap as task</h1>
    <p className="mt-2 text-slate-600">Assign an owner and a due date. A dated, owned task is created and the gap stays visible until it is done.</p>
    {control && <p className="mt-3 text-sm text-slate-500">Linked control: <b>{control.code}: {control.title}</b></p>}
    <form action={createGapTaskAction} className="mt-8 space-y-4 rounded-xl border bg-white p-6">
      <input type="hidden" name="questionId" value={question.id} />
      <label className="block text-sm font-medium">Title<input name="title" readOnly value={title} className="mt-1 w-full rounded border bg-slate-50 p-2" /></label>
      <label className="block text-sm font-medium">Detail<textarea name="detail" readOnly defaultValue={question.remediation} className="mt-1 w-full rounded border bg-slate-50 p-2" /></label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">Owner<select name="ownerId" required defaultValue="" className="mt-1 w-full rounded border p-2"><option value="" disabled>Select an owner</option>{members?.map((m) => { const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles; return <option key={m.user_id} value={m.user_id}>{p?.display_name ?? m.user_id}</option>; })}</select></label>
        <label className="block text-sm font-medium">Due date<input name="dueOn" type="date" required className="mt-1 w-full rounded border p-2" /></label>
      </div>
      <button className="rounded bg-blue-600 px-4 py-2 text-white">Create task</button>
    </form>
  </>;
}
