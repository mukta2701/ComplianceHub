import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAppContext } from "@/lib/app-context";
import { Card, PageIntro } from "@/components/ui";
import { one } from "@/lib/supabase/one";
import { createAuditAction } from "../actions";
import styles from "../audit-workspace.module.css";

export default async function NewAuditPage() {
  const { supabase, organisation, membership } = await requireAppContext();
  if (membership.role === "member") redirect("/app/audits");
  const { data:members,error } = await supabase.from("memberships").select("user_id,profiles(display_name)").eq("organisation_id", organisation.id);
  if (error) throw new Error("Could not load audit owners");
  return <div className={styles.page}>
    <Link href="/app/audits" className={styles.pageBack}><span aria-hidden="true">←</span>Back to audit register</Link>
    <PageIntro eyebrow="AUDIT" title="Plan an audit" body="Define the objective, accountable lead, scope and working window before building the checklist." />
    <div className={styles.formLayout}>
      <form action={createAuditAction} className={`${styles.formCard} card app-form`}>
        <section className={styles.formSection}><h2>Audit identity</h2><p>Name the audit so people can recognise its purpose in the register and exported pack.</p><div className="form-grid"><label>Reference<input name="reference" required maxLength={40} placeholder="AUD-001" /></label><label>Title<input name="title" required maxLength={200} placeholder="e.g. Access control internal audit" /></label><label>Framework<input name="framework" required maxLength={120} defaultValue="ISO 27001:2022" /></label><label>Lead auditor<select name="leadAuditorId" defaultValue=""><option value="">Unassigned</option>{members?.map((member) => <option key={member.user_id} value={member.user_id}>{one(member.profiles)?.display_name ?? member.user_id}</option>)}</select></label></div></section>
        <section className={styles.formSection}><h2>Scope and objective</h2><p>State what will be examined and the boundary of the audit. This remains a human decision.</p><label>Scope<textarea name="scope" maxLength={10000} placeholder="Processes, departments, systems and controls included in this audit." /></label></section>
        <section className={styles.formSection}><h2>Working window</h2><p>Dates plan the work. They do not automatically change the audit status or approve a result.</p><div className="form-grid"><label>Planned start<input name="plannedStart" type="date" /></label><label>Planned end<input name="plannedEnd" type="date" /></label></div></section>
        <footer className={styles.formFooter}><Link className="button secondary" href="/app/audits">Cancel</Link><button className="button primary">Plan audit</button></footer>
      </form>
      <aside className={styles.formAside} aria-label="Audit planning guidance"><Card><h2>A useful audit plan</h2><ul><li>States the business objective</li><li>Names a responsible lead</li><li>Defines systems and teams in scope</li><li>Sets a realistic working window</li></ul></Card><Card><h2>After planning</h2><p>Add or populate the checklist, link evidence, record human results, and create owned corrective action for findings.</p></Card></aside>
    </div>
  </div>;
}
