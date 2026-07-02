import "server-only";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function requireAppContext() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");
  const { data: membership } = await supabase.from("memberships").select("organisation_id,role,organisations(id,name)").limit(1).maybeSingle();
  if (!membership) redirect("/app/onboarding");
  const organisation = Array.isArray(membership.organisations) ? membership.organisations[0] : membership.organisations;
  return { supabase, user, membership, organisation: organisation as { id: string; name: string } };
}
