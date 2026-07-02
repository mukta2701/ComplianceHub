"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createOrganisation } from "@/features/organisations/application/organisation";

export async function createOrganisationAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");
  try {
    const organisation = await createOrganisation({ name: formData.get("name") }, {
      userId: user.id,
      insert: async ({ name, slug, createdBy }) => {
        const uniqueSlug = `${slug}-${crypto.randomUUID().slice(0, 8)}`;
        const { data, error } = await supabase.from("organisations").insert({ name, slug: uniqueSlug, created_by: createdBy }).select("id,name,slug").single();
        if (error) throw error;
        const { error: memberError } = await supabase.from("memberships").insert({ organisation_id: data.id, user_id: user.id, role: "owner" });
        if (memberError) throw memberError;
        return data;
      },
    });
    redirect(`/app?organisation=${organisation.id}`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(`/app/onboarding?message=${encodeURIComponent("Could not create the organisation. Check the name and try again.")}`);
  }
}

export async function signOutAction() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/");
}
