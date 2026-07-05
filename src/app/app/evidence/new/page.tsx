import { requireAppContext } from "@/lib/app-context";
import { PageIntro } from "@/components/ui";
import { createEvidenceAction } from "../actions";

export default async function NewEvidencePage({ searchParams }: { searchParams: Promise<{ replaces?: string; message?: string }> }) {
  const { replaces, message } = await searchParams;
  const { supabase } = await requireAppContext();
  const { data: members } = await supabase.from("memberships").select("user_id,profiles(display_name)");
  return <>
    <PageIntro eyebrow="EVIDENCE" title="Add evidence" body="Attach a file, link or note. Set a valid-until date and the daily sweep will track freshness for you." />
    {message && <p role="alert" className="card" style={{ padding: "12px", borderColor: "#f0c9c9", background: "#fdf2f2", color: "#963f00", fontSize: "13px", marginBottom: "12px" }}>{message}</p>}
    <form action={createEvidenceAction} className="card app-form">
      {replaces && <input type="hidden" name="replacesEvidenceId" value={replaces} />}
      <label>Title<input name="title" required maxLength={200} /></label>
      <label>Kind<select name="kind" defaultValue="file"><option value="file">File upload</option><option value="link">Link</option><option value="note">Note</option></select></label>
      <label>File (PDF, PNG, JPG, DOCX, XLSX, CSV, TXT — max 25 MB)<input name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.csv,.txt" /></label>
      <label>URL (for link evidence)<input name="url" type="url" placeholder="https://" /></label>
      <label>Description<textarea name="description" maxLength={10000} /></label>
      <div className="form-grid">
        <label>Owner<select name="ownerId" defaultValue=""><option value="">Unassigned</option>{members?.map((m) => { const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles; return <option key={m.user_id} value={m.user_id}>{p?.display_name ?? m.user_id}</option>; })}</select></label>
        <label>Collected on<input name="collectedOn" type="date" /></label>
        <label>Valid until<input name="validUntil" type="date" /></label>
        <label>Review interval<select name="reviewInterval" defaultValue=""><option value="">None</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="semiannually">Semi-annually</option><option value="annually">Annually</option></select></label>
      </div>
      <button className="button primary">Save evidence</button>
    </form>
  </>;
}
