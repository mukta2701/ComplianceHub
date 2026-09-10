import { loadPolicyRows } from "../policy-query";
import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { notFound } from "next/navigation";
import { PageIntro } from "@/components/ui";
import { POLICY_TEMPLATES, policyTemplateBySlug } from "@/features/policies/domain/templates";
import { one } from "@/lib/supabase/one";
import { PolicyCreateForm } from "../policy-create-form";
import styles from "../policy-workspace.module.css";
import { hasCapability } from "@/features/organisations/domain/access";

export default async function NewPolicyPage({ searchParams }: { searchParams: Promise<{ template?: string }> }) {
  const { supabase, membership, organisation } = await requireAppContext();
  if (!hasCapability(membership.role, "manage_policies")) notFound();
  const { template: templateSlug } = await searchParams;
  // Pre-fill is presentation only: pick a template by slug and seed the form's
  // defaultValues. The blank-form path (no/unknown slug) keeps its current empty
  // defaults, and createPolicyAction still validates and inserts under RLS.
  const template = templateSlug ? policyTemplateBySlug(templateSlug) : undefined;
  const { data: members, error: ownersError } = await loadPolicyRows((from, to) => supabase.from("memberships").select("user_id,profiles(display_name)").eq("organisation_id", organisation.id).order("user_id").range(from, to));
  return <>
    <Link className={styles.back} href="/app/policies">← Back to policies</Link>
    <PageIntro eyebrow="POLICIES" title="Author a policy" body="Write the policy content. You approve it and members accept it from the policy's page." />
    {ownersError && <p role="alert">Owner choices could not be loaded. Refresh before assigning a policy owner.</p>}
    <PolicyCreateForm initialTemplateSlug={template?.slug} templates={POLICY_TEMPLATES} initial={{ reference: template?.reference ?? "", title: template?.title ?? "", body: template?.body ?? "" }} owners={(members ?? []).map((m) => ({ id: m.user_id, name: one(m.profiles)?.display_name || "Workspace member" }))} />
  </>;
}
