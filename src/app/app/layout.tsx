import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAuthUser, getMembership } from "@/lib/app-context";
import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";

function initials(text: string): string {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "CH";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const user = await getAuthUser();
  if (!user) redirect("/sign-in");
  const membership = await getMembership();
  const [{ count: unread }, { data: profile }] = await Promise.all([
    supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
    supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
  ]);
  const organisation = membership ? (Array.isArray(membership.organisations) ? membership.organisations[0] : membership.organisations) : null;
  const orgName = organisation?.name ?? "Your workspace";
  const displayName = profile?.display_name ?? user.email ?? "Member";
  return <AppShell orgName={orgName} orgInitials={initials(orgName)} userInitials={initials(displayName)} unreadCount={unread ?? 0}>{children}</AppShell>;
}
