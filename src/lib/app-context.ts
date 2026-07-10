import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const getAuthUser = cache(async () => {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
});

export const getMembership = cache(async () => {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("memberships")
    .select("organisation_id,role,organisations(id,name)").limit(1).maybeSingle();
  return data;
});

export async function requireAppContext() {
  const supabase = await createSupabaseServerClient();
  const user = await getAuthUser();
  if (!user) redirect("/sign-in");
  const membership = await getMembership();
  if (!membership) redirect("/app/onboarding");
  const organisation = Array.isArray(membership.organisations) ? membership.organisations[0] : membership.organisations;
  return { supabase, user, membership, organisation: organisation as { id: string; name: string } };
}
