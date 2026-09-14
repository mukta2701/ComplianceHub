"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createOrganisation } from "@/features/organisations/application/organisation";
import { clearActiveOrganisationCookie, setActiveOrganisationCookie } from "@/lib/app-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function createOrganisationAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");
  let organisation: Awaited<ReturnType<typeof createOrganisation>>;
  try {
    organisation = await createOrganisation({ name: formData.get("name") }, {
      userId: user.id,
      insert: async ({ name, slug, createdBy }) => {
        const uniqueSlug = `${slug}-${crypto.randomUUID().slice(0, 8)}`;
        void createdBy;
        const { data, error } = await supabase.rpc("create_organisation_with_owner", {
          organisation_name: name,
          organisation_slug: uniqueSlug,
        });
        if (error) throw error;
        return { id: String(data), name, slug: uniqueSlug };
      },
    });
  } catch {
    redirect(`/app/onboarding?message=${encodeURIComponent("Could not create the organisation. Check the name and try again.")}`);
  }

  // Selection happens after the database transaction has committed. A cookie
  // failure must surface as an operational error, not invite a duplicate retry.
  await setActiveOrganisationCookie(organisation.id);
  revalidatePath("/app", "layout");
  redirect("/app");
}

export async function switchWorkspaceAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const parsedOrganisationId = z.uuid().safeParse(formData.get("organisationId"));
  if (!parsedOrganisationId.success) throw new Error("Invalid workspace");

  const { data: membership, error } = await supabase.from("memberships")
    .select("organisation_id")
    .eq("user_id", user.id)
    .eq("organisation_id", parsedOrganisationId.data)
    .maybeSingle();
  if (error) throw new Error("Could not verify workspace membership");
  if (!membership) throw new Error("You are not a member of that workspace");

  await setActiveOrganisationCookie(parsedOrganisationId.data);
  revalidatePath("/app", "layout");
  redirect("/app");
}

export async function signOutAction() {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error("Could not sign out");
  await clearActiveOrganisationCookie();
  redirect("/");
}
