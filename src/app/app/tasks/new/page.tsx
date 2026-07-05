import { requireAppContext } from "@/lib/app-context";
import { PageIntro } from "@/components/ui";
import { createTaskAction } from "../actions";

export default async function NewTaskPage() {
  const { supabase } = await requireAppContext();
  const [{ data: members }, { data: controls }, { data: risks }] = await Promise.all([
    supabase.from("memberships").select("user_id,profiles(display_name)"),
    supabase.from("controls").select("id,code,title").order("position"),
    supabase.from("risks").select("id,reference,title").neq("status", "closed").order("reference"),
  ]);
  return <>
    <PageIntro eyebrow="REMEDIATION" title="New task" body="Create an owned, dated action. Recurring tasks regenerate when you mark them done." />
    <form action={createTaskAction} className="card app-form">
      <label>Title<input name="title" required maxLength={200} /></label>
      <label>Detail<textarea name="detail" maxLength={10000} /></label>
      <div className="form-grid">
        <label>Owner<select name="ownerId" defaultValue=""><option value="">Unassigned</option>{members?.map((m) => { const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles; return <option key={m.user_id} value={m.user_id}>{p?.display_name ?? m.user_id}</option>; })}</select></label>
        <label>Due date<input name="dueOn" type="date" /></label>
        <label>Recurrence<select name="recurrence" defaultValue=""><option value="">One-off</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="semiannually">Semi-annually</option><option value="annually">Annually</option></select></label>
        <label>Linked control<select name="controlId" defaultValue=""><option value="">None</option>{controls?.map((c) => <option key={c.id} value={c.id}>{c.code}: {c.title}</option>)}</select></label>
        <label>Linked risk<select name="riskId" defaultValue=""><option value="">None</option>{risks?.map((r) => <option key={r.id} value={r.id}>{r.reference}: {r.title}</option>)}</select></label>
      </div>
      <button className="button primary">Create task</button>
    </form>
  </>;
}
