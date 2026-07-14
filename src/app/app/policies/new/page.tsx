import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { notFound } from "next/navigation";
import { PageIntro } from "@/components/ui";
import { Icon } from "@/components/icons";
import { POLICY_TEMPLATES, policyTemplateBySlug } from "@/features/policies/domain/templates";
import { one } from "@/lib/supabase/one";
import { createPolicyAction } from "../actions";
import { hasCapability } from "@/features/organisations/domain/access";

export default async function NewPolicyPage({ searchParams }: { searchParams: Promise<{ template?: string }> }) {
  const { supabase, membership } = await requireAppContext();
  if (!hasCapability(membership.role, "manage_policies")) notFound();
  const { template: templateSlug } = await searchParams;
  // Pre-fill is presentation only: pick a template by slug and seed the form's
  // defaultValues. The blank-form path (no/unknown slug) keeps its current empty
  // defaults, and createPolicyAction still validates and inserts under RLS.
  const template = templateSlug ? policyTemplateBySlug(templateSlug) : undefined;
  const { data: members } = await supabase.from("memberships").select("user_id,profiles(display_name)");
  return <>
    <PageIntro eyebrow="POLICIES" title="Author a policy" body="Write the policy content. You approve it and members accept it from the policy's page." />
    <section className="card template-picker" aria-labelledby="template-picker-heading">
      <div className="template-picker-head">
        <h2 id="template-picker-heading">Start from a template</h2>
        <p>Pre-fill the form with a starter ISO 27001 policy, then edit it to fit your organisation.</p>
      </div>
      <ul className="template-list">
        {POLICY_TEMPLATES.map((t) => {
          const active = t.slug === template?.slug;
          return <li key={t.slug}>
            <Link className={`template-card${active ? " active" : ""}`} href={`/app/policies/new?template=${t.slug}`} aria-current={active ? "true" : undefined}>
              <span className="template-ref">{t.reference}</span>
              <b>{t.title}</b>
              <small>{t.summary}</small>
              <span className="template-cue"><Icon name={active ? "check" : "arrow"} />{active ? "Loaded below" : "Use this template"}</span>
            </Link>
          </li>;
        })}
      </ul>
      {template && <p className="template-note"><Link className="template-clear" href="/app/policies/new">Clear template and start from blank</Link></p>}
    </section>
    <form action={createPolicyAction} className="card app-form">
      <div className="form-grid">
        <label>Reference<input name="reference" required maxLength={40} placeholder="POL-001" defaultValue={template?.reference ?? ""} /></label>
        <label>Title<input name="title" required maxLength={200} defaultValue={template?.title ?? ""} /></label>
        <label>Owner<select name="ownerId" defaultValue=""><option value="">Unassigned</option>{members?.map((m) => { const p = one(m.profiles); return <option key={m.user_id} value={m.user_id}>{p?.display_name ?? m.user_id}</option>; })}</select></label>
        <label>Review due<input name="reviewDue" type="date" /></label>
      </div>
      <label>Policy content<textarea name="body" maxLength={100000} rows={10} placeholder="The policy statement, scope, and responsibilities." defaultValue={template?.body ?? ""} /></label>
      <button className="button primary">Create policy</button>
    </form>
  </>;
}
