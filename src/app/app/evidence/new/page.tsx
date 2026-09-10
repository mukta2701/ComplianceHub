import { redirect } from "next/navigation";
import { requireAppContext } from "@/lib/app-context";
import { PageIntro } from "@/components/ui";
import { Card } from "@/components/ui";
import { one } from "@/lib/supabase/one";
import { createEvidenceAction } from "../actions";
import { z } from "zod";
import Link from "next/link";
import styles from "../evidence.module.css";

export default async function NewEvidencePage({ searchParams }: { searchParams: Promise<{ replaces?: string; message?: string }> }) {
  const { replaces, message } = await searchParams;
  const { supabase, organisation, membership } = await requireAppContext();
  if (membership.role === "member") redirect("/app/evidence");
  const replacementId = z.uuid().safeParse(replaces).data;
  const [{ data: members, error: membersError }, replacementResult] = await Promise.all([
    supabase.from("memberships").select("user_id,profiles(display_name)").eq("organisation_id", organisation.id),
    replacementId ? supabase.from("evidence").select("id,title,status,collected_on,valid_until").eq("id", replacementId).eq("organisation_id", organisation.id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (membersError) throw new Error("Could not load evidence owners");
  if (replacementResult.error) throw new Error("Could not load the evidence being replaced");
  const replacement = replacementResult.data;
  return <div className={styles.page}>
    <PageIntro eyebrow="EVIDENCE" title="Add evidence" body="Create a governed proof record, set its validity window, and connect it to your programme." action={<Link className="button secondary" href="/app/evidence">Back to vault</Link>} />
    {message && <p role="alert" className={styles.truthNote}>{message}</p>}
    <div className={styles.formLayout}>
    <form action={createEvidenceAction} className={`${styles.formCard} card app-form`}>
      {replacementId && <input type="hidden" name="replacesEvidenceId" value={replacementId} />}
      <section className={styles.formSection}><div className={styles.sectionHeading}><span className={styles.sectionNumber}>1</span><div><h2>Describe the proof</h2><p>Give reviewers enough context to recognise what this record establishes.</p></div></div>
      <label>Evidence title<input name="title" required maxLength={200} placeholder="e.g. Quarterly access review export" /></label>
      <label>Description<textarea name="description" maxLength={10000} placeholder="What was checked, where it came from, and any limits a reviewer should know." /></label></section>
      <section className={styles.formSection}><div className={styles.sectionHeading}><span className={styles.sectionNumber}>2</span><div><h2>Add the source</h2><p>Choose one source type. Only the matching file, link or note content is saved.</p></div></div>
      <label>Evidence type<select name="kind" defaultValue="file"><option value="file">File upload</option><option value="link">Web link</option><option value="note">Recorded note</option></select></label>
      <label>File<input name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.csv,.txt" /><small className={styles.fieldHelp}>PDF, PNG, JPG, DOCX, XLSX, CSV or TXT. Maximum 25 MB.</small></label>
      <label>Web address<input name="url" type="url" placeholder="https://" /><small className={styles.fieldHelp}>Used only when the evidence type is Web link.</small></label></section>
      <section className={styles.formSection}><div className={styles.sectionHeading}><span className={styles.sectionNumber}>3</span><div><h2>Set ownership and freshness</h2><p>These dates drive freshness; they do not record a human approval.</p></div></div>
      <div className="form-grid">
        <label>Owner<select name="ownerId" defaultValue=""><option value="">Unassigned</option>{members?.map((m) => { const p = one(m.profiles); return <option key={m.user_id} value={m.user_id}>{p?.display_name ?? m.user_id}</option>; })}</select></label>
        <label>Collected on<input name="collectedOn" type="date" /></label>
        <label>Valid until<input name="validUntil" type="date" /></label>
        <label>Review interval<select name="reviewInterval" defaultValue=""><option value="">None</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="semiannually">Semi-annually</option><option value="annually">Annually</option></select></label>
      </div></section>
      <footer className={styles.formFooter}><Link className="button secondary" href="/app/evidence">Cancel</Link><button className="button primary">Save evidence</button></footer>
    </form>
    <aside className={styles.formAside} aria-label="Evidence guidance">
      {replacement && <Card className={styles.replacement}><span className={styles.eyebrow}>Replacing</span><strong>{replacement.title}</strong><p>{replacement.status} · collected {replacement.collected_on}. The older record stays in history.</p></Card>}
      <Card><h2>What happens next</h2><ul><li>The record appears in the Evidence vault.</li><li>Its freshness follows the valid-until date.</li><li>You can link it to controls, tasks, risks, policies or audit work.</li></ul></Card>
      <Card><h2>Keep it reviewable</h2><p>Name the system, period and test performed. Avoid passwords, access tokens and unrelated personal data.</p></Card>
    </aside>
    </div>
  </div>;
}
