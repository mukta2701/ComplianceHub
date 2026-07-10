import { requireAppContext } from "@/lib/app-context";
import { PageIntro } from "@/components/ui";
import { one } from "@/lib/supabase/one";
import { createAuditAction } from "../actions";

export default async function NewAuditPage() {
  const { supabase } = await requireAppContext();
  const { data: members } = await supabase.from("memberships").select("user_id,profiles(display_name)");
  return <>
    <PageIntro eyebrow="AUDIT" title="Plan an audit" body="Define the scope and window. You will add checklist items and raise findings from the audit's page." />
    <form action={createAuditAction} className="card app-form">
      <div className="form-grid">
        <label>Reference<input name="reference" required maxLength={40} placeholder="AUD-001" /></label>
        <label>Title<input name="title" required maxLength={200} /></label>
        <label>Lead auditor<select name="leadAuditorId" defaultValue=""><option value="">Unassigned</option>{members?.map((m) => { const p = one(m.profiles); return <option key={m.user_id} value={m.user_id}>{p?.display_name ?? m.user_id}</option>; })}</select></label>
        <label>Framework<input name="framework" maxLength={120} defaultValue="ISO 27001:2022" /></label>
        <label>Planned start<input name="plannedStart" type="date" /></label>
        <label>Planned end<input name="plannedEnd" type="date" /></label>
      </div>
      <label>Scope<textarea name="scope" maxLength={10000} placeholder="Which processes, departments, and controls this audit covers." /></label>
      <button className="button primary">Plan audit</button>
    </form>
  </>;
}
