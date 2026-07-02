import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { signOutAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");
  return <div className="min-h-screen bg-slate-50 text-slate-950">
    <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
      <div className="flex items-center gap-8"><Link href="/app" className="text-xl font-bold">Compliance<span className="text-blue-600">Hub</span></Link>
      <nav aria-label="Workspace" className="flex max-w-[55vw] gap-3 overflow-x-auto text-xs md:max-w-none md:gap-5 md:text-sm"><Link href="/app/assessment">Assessment</Link><Link href="/app/soa">SoA</Link><Link href="/app/risks">Risks</Link><Link href="/app/activity">Activity</Link><Link href="/app/settings">Settings</Link></nav></div>
      <form action={signOutAction}><button className="rounded-lg border border-slate-300 px-3 py-2 text-sm">Sign out</button></form>
    </div></header>
    {children}
  </div>;
}
