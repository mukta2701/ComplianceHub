import { redirect, notFound } from "next/navigation";
import { requireAppContext } from "@/lib/app-context";
import { PageIntro } from "@/components/ui";
import { one } from "@/lib/supabase/one";
import { updateTaskAction } from "../../actions";

export default async function EditTaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, organisation, membership } = await requireAppContext();
  if (membership.role === "member") redirect(`/app/tasks/${id}`);
  const { data: task, error: taskError } = await supabase.from("tasks").select("id,title,detail,status,due_on,recurrence,owner_id,control_id,risk_id").eq("id", id).eq("organisation_id", organisation.id).maybeSingle();
  if (taskError) throw new Error("Could not load task");
  if (!task) notFound();
  const [{ data: members, error: membersError }, { data: controls, error: controlsError }, { data: risks, error: risksError }] = await Promise.all([
    supabase.from("memberships").select("user_id,profiles(display_name)").eq("organisation_id", organisation.id),
    supabase.from("controls").select("id,code,title").order("position"),
    supabase.from("risks").select("id,reference,title,status").eq("organisation_id", organisation.id).order("reference"),
  ]);
  if (membersError || controlsError || risksError) throw new Error("Could not load task choices. Reload and try again.");
  return <>
    <PageIntro eyebrow="REMEDIATION" title="Edit task" body="Update the task details, owner, due date and linked records." />
    <form action={updateTaskAction} className="card app-form">
      <input type="hidden" name="id" value={task.id} /><input type="hidden" name="status" value={task.status} />
      <label>Title<input name="title" required maxLength={200} defaultValue={task.title} /></label>
      <label>Detail<textarea name="detail" maxLength={10000} defaultValue={task.detail ?? ""} /></label>
      <div className="form-grid">
        <label>Owner<select name="ownerId" defaultValue={task.owner_id ?? ""}><option value="">Unassigned</option>{members?.map((m) => { const p = one(m.profiles); return <option key={m.user_id} value={m.user_id}>{p?.display_name ?? m.user_id}</option>; })}</select></label>
        <label>Due date<input name="dueOn" type="date" defaultValue={task.due_on ?? ""} /></label>
        <label>Recurrence<select name="recurrence" defaultValue={task.recurrence ?? ""}><option value="">One-off</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="semiannually">Semi-annually</option><option value="annually">Annually</option></select></label>
        <label>Linked control<select name="controlId" defaultValue={task.control_id ?? ""}><option value="">None</option>{controls?.map((c) => <option key={c.id} value={c.id}>{c.code}: {c.title}</option>)}</select></label>
        <label>Linked risk<select name="riskId" defaultValue={task.risk_id ?? ""}><option value="">None</option>{risks?.map((r) => <option key={r.id} value={r.id}>{r.reference}: {r.title}</option>)}</select></label>
      </div>
      <button className="button primary">Save task</button>
    </form>
  </>;
}
