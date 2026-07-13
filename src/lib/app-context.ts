import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { one } from "@/lib/supabase/one";

export const ACTIVE_ORGANISATION_COOKIE = "compliancehub_active_organisation";
export const ACTIVE_ORGANISATION_COOKIE_MAX_AGE = 60 * 60 * 24 * 180;

async function readActiveOrganisationId(): Promise<string | null> {
  const store = await cookies();
  const parsed = z.uuid().safeParse(store.get(ACTIVE_ORGANISATION_COOKIE)?.value);
  return parsed.success ? parsed.data : null;
}

export async function setActiveOrganisationCookie(organisationId: string): Promise<void> {
  const parsed = z.uuid().safeParse(organisationId);
  if (!parsed.success) throw new Error("Invalid organisation id");
  const store = await cookies();
  store.set(ACTIVE_ORGANISATION_COOKIE, parsed.data, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ACTIVE_ORGANISATION_COOKIE_MAX_AGE,
  });
}

export const getAuthUser = cache(async () => {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
});

export const getMembership = cache(async () => {
  const user = await getAuthUser();
  if (!user) return null;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("memberships")
    .select("organisation_id,role,job_title,created_at,organisations(id,name)")
    .eq("user_id", user.id)
    // Deterministic fallback: the user's oldest membership wins, with the
    // organisation UUID breaking timestamp ties.
    .order("created_at", { ascending: true })
    .order("organisation_id", { ascending: true });
  const activeOrganisationId = await readActiveOrganisationId();
  return data?.find((membership) => membership.organisation_id === activeOrganisationId) ?? data?.[0] ?? null;
});

export async function requireAppContext() {
  const supabase = await createSupabaseServerClient();
  const user = await getAuthUser();
  if (!user) redirect("/sign-in");
  const membership = await getMembership();
  if (!membership) redirect("/app/onboarding");
  const organisation = one(membership.organisations);
  return { supabase, user, membership, organisation: organisation as { id: string; name: string } };
}
