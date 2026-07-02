import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function AppHome() {
  const supabase = await createSupabaseServerClient();
  const { data: memberships } = await supabase.from("memberships").select("organisation_id,role,organisations(name)").limit(1);
  if (!memberships?.length) redirect("/app/onboarding");
  const membership = memberships[0];
  const organisation = Array.isArray(membership.organisations) ? membership.organisations[0] : membership.organisations;
  return <main className="mx-auto max-w-6xl px-6 py-12">
    <p className="text-sm font-medium text-blue-700">{organisation?.name ?? "Your organisation"}</p>
    <h1 className="mt-2 text-3xl font-bold">Your compliance workspace</h1>
    <p className="mt-3 max-w-2xl text-slate-600">The authenticated workspace is ready. Continue to the working beta while production data views are connected.</p>
    <Link href="/demo/dashboard" className="mt-8 inline-block rounded-lg bg-blue-600 px-5 py-3 font-semibold text-white">Open dashboard</Link>
  </main>;
}
