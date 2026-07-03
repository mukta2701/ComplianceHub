import { requireAppContext } from "@/lib/app-context";
import { createTaskAction } from "../actions";

export default async function NewTaskPage() {
  const { supabase } = await requireAppContext();
  const [{ data: members }, { data: controls }, { data: risks }] = await Promise.all([
    supabase.from("memberships").select("user_id,profiles(display_name)"),
    supabase.from("controls").select("id,code,title").order("position"),
    supabase.from("risks").select("id,reference,title").neq("status", "closed").order("reference"),
  ]);
  return <main className="mx-auto max-w-3xl px-6 py-10"><h1 className="text-3xl font-bold">New task</h1>
    <form action={createTaskAction} className="mt-8 space-y-4 rounded-xl border bg-white p-6">
      <label className="block text-sm font-medium">Title<input name="title" required maxLength={200} className="mt-1 w-full rounded border p-2" /></label>
      <label className="block text-sm font-medium">Detail<textarea name="detail" maxLength={10000} className="mt-1 w-full rounded border p-2" /></label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">Owner<select name="ownerId" defaultValue="" className="mt-1 w-full rounded border p-2"><option value="">Unassigned</option>{members?.map((m) => { const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles; return <option key={m.user_id} value={m.user_id}>{p?.display_name ?? m.user_id}</option>; })}</select></label>
        <label className="block text-sm font-medium">Due date<input name="dueOn" type="date" className="mt-1 w-full rounded border p-2" /></label>
        <label className="block text-sm font-medium">Recurrence<select name="recurrence" defaultValue="" className="mt-1 w-full rounded border p-2"><option value="">One-off</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="semiannually">Semi-annually</option><option value="annually">Annually</option></select></label>
        <label className="block text-sm font-medium">Linked control<select name="controlId" defaultValue="" className="mt-1 w-full rounded border p-2"><option value="">None</option>{controls?.map((c) => <option key={c.id} value={c.id}>{c.code}: {c.title}</option>)}</select></label>
        <label className="block text-sm font-medium">Linked risk<select name="riskId" defaultValue="" className="mt-1 w-full rounded border p-2"><option value="">None</option>{risks?.map((r) => <option key={r.id} value={r.id}>{r.reference}: {r.title}</option>)}</select></label>
      </div>
      <button className="rounded bg-blue-600 px-4 py-2 text-white">Create task</button>
    </form>
  </main>;
}
