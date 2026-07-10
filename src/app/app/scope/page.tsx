import { ModuleExplainer, PageIntro, Pill } from "@/components/ui";
import { getModuleGuidance } from "@/features/education/domain/guidance";
import { assessScopeProfile } from "@/features/scope/domain/scope-profile";
import { requireAppContext } from "@/lib/app-context";
import { saveScopeProfileAction } from "./actions";

export default async function ScopePage() {
  const { supabase, membership, organisation } = await requireAppContext();
  const { data } = await supabase.from("organisation_scope_profiles").select("scope_statement,services,locations,information_types,dependencies,exclusions,updated_at").eq("organisation_id", organisation.id).maybeSingle();
  const profile = { scopeStatement: data?.scope_statement ?? "", services: data?.services ?? "", locations: data?.locations ?? "", informationTypes: data?.information_types ?? "", dependencies: data?.dependencies ?? "", exclusions: data?.exclusions ?? "" };
  const gaps = assessScopeProfile(profile);
  const editable = membership.role === "owner";
  return <>
    <PageIntro eyebrow="FOUNDATION" title="Scope & context" body="Set the documented ISMS boundary that informs assessment, control applicability, risks, and audits." action={<Pill tone={gaps.length ? "amber" : "green"}>{gaps.length ? `${gaps.length} decisions needed` : "Reviewable scope"}</Pill>} />
    <ModuleExplainer guidance={getModuleGuidance("scope")} />
    {!editable && <p role="status" style={{ marginBottom: "14px", color: "#596273", fontSize: "13px" }}>Only a workspace owner can change this boundary.</p>}
    <form action={saveScopeProfileAction} className="card app-form">
      <label>ISMS boundary and intended outcomes<textarea name="scopeStatement" defaultValue={profile.scopeStatement} disabled={!editable} placeholder="Describe the organisation, activities, and security outcomes this ISMS covers." /></label>
      <label>Products, services, and processes in scope<textarea name="services" defaultValue={profile.services} disabled={!editable} placeholder="For example: SaaS product delivery, support, finance, and engineering operations." /></label>
      <label>People and locations in scope<textarea name="locations" defaultValue={profile.locations} disabled={!editable} placeholder="For example: UK remote staff, office locations, contractors." /></label>
      <label>Information and assets protected<textarea name="informationTypes" defaultValue={profile.informationTypes} disabled={!editable} placeholder="For example: customer account data, source code, employee records." /></label>
      <label>Material suppliers and technology dependencies<textarea name="dependencies" defaultValue={profile.dependencies} disabled={!editable} placeholder="For example: AWS, Google Workspace, payment provider, managed support." /></label>
      <label>Exclusions and rationale<textarea name="exclusions" defaultValue={profile.exclusions} disabled={!editable} placeholder="Write None, or describe each exclusion and why it is outside the documented boundary." /></label>
      {editable && <button className="button primary">Save scope profile</button>}
      {data?.updated_at && <small style={{ color: "#596273" }}>Last reviewed {new Date(data.updated_at).toLocaleDateString("en-GB")}</small>}
    </form>
  </>;
}
