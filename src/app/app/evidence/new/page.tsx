import { requireAppContext } from "@/lib/app-context";
import { createEvidenceAction } from "../actions";

export default async function NewEvidencePage({ searchParams }: { searchParams: Promise<{ replaces?: string; message?: string }> }) {
  const { replaces, message } = await searchParams;
  const { supabase } = await requireAppContext();
  const { data: members } = await supabase.from("memberships").select("user_id,profiles(display_name)");
  return <><h1 className="text-3xl font-bold">Add evidence</h1>
    {message && <p role="alert" className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{message}</p>}
    <form action={createEvidenceAction} className="mt-8 space-y-4 rounded-xl border bg-white p-6">
      {replaces && <input type="hidden" name="replacesEvidenceId" value={replaces} />}
      <label className="block text-sm font-medium">Title<input name="title" required maxLength={200} className="mt-1 w-full rounded border p-2" /></label>
      <label className="block text-sm font-medium">Kind<select name="kind" defaultValue="file" className="mt-1 w-full rounded border p-2"><option value="file">File upload</option><option value="link">Link</option><option value="note">Note</option></select></label>
      <label className="block text-sm font-medium">File (PDF, PNG, JPG, DOCX, XLSX, CSV, TXT — max 25 MB)<input name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.csv,.txt" className="mt-1 w-full rounded border p-2" /></label>
      <label className="block text-sm font-medium">URL (for link evidence)<input name="url" type="url" placeholder="https://" className="mt-1 w-full rounded border p-2" /></label>
      <label className="block text-sm font-medium">Description<textarea name="description" maxLength={10000} className="mt-1 w-full rounded border p-2" /></label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">Owner<select name="ownerId" defaultValue="" className="mt-1 w-full rounded border p-2"><option value="">Unassigned</option>{members?.map((m) => { const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles; return <option key={m.user_id} value={m.user_id}>{p?.display_name ?? m.user_id}</option>; })}</select></label>
        <label className="block text-sm font-medium">Collected on<input name="collectedOn" type="date" className="mt-1 w-full rounded border p-2" /></label>
        <label className="block text-sm font-medium">Valid until<input name="validUntil" type="date" className="mt-1 w-full rounded border p-2" /></label>
        <label className="block text-sm font-medium">Review interval<select name="reviewInterval" defaultValue="" className="mt-1 w-full rounded border p-2"><option value="">None</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="semiannually">Semi-annually</option><option value="annually">Annually</option></select></label>
      </div>
      <button className="rounded bg-blue-600 px-4 py-2 text-white">Save evidence</button>
    </form>
  </>;
}
