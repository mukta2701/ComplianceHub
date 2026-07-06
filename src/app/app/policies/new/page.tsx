import { requireAppContext } from "@/lib/app-context";
import { PageIntro } from "@/components/ui";
import { createPolicyAction } from "../actions";

export default async function NewPolicyPage() {
  const { supabase } = await requireAppContext();
  const { data: members } = await supabase.from("memberships").select("user_id,profiles(display_name)");
  return <>
    <PageIntro eyebrow="POLICIES" title="Author a policy" body="Write the policy content. You approve it and members accept it from the policy's page." />
    <form action={createPolicyAction} className="card app-form">
      <div className="form-grid">
        <label>Reference<input name="reference" required maxLength={40} placeholder="POL-001" /></label>
        <label>Title<input name="title" required maxLength={200} /></label>
        <label>Owner<select name="ownerId" defaultValue=""><option value="">Unassigned</option>{members?.map((m) => { const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles; return <option key={m.user_id} value={m.user_id}>{p?.display_name ?? m.user_id}</option>; })}</select></label>
        <label>Review due<input name="reviewDue" type="date" /></label>
      </div>
      <label>Policy content<textarea name="body" maxLength={100000} rows={10} placeholder="The policy statement, scope, and responsibilities." /></label>
      <button className="button primary">Create policy</button>
    </form>
  </>;
}
