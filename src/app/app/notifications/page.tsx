import { requireAppContext } from "@/lib/app-context";
import { markAllNotificationsReadAction, markNotificationReadAction } from "./actions";

export default async function NotificationsPage() {
  const { supabase } = await requireAppContext();
  const { data } = await supabase.from("notifications").select("id,kind,message,read_at,created_at").order("created_at", { ascending: false }).limit(100);
  const unread = data?.filter((n) => !n.read_at) ?? [];
  return <>
    <div className="flex justify-between"><h1 className="text-3xl font-bold">Notifications</h1>
      {unread.length > 0 && <form action={markAllNotificationsReadAction}><button className="rounded border border-slate-300 px-3 py-2 text-sm">Mark all read</button></form>}</div>
    <div className="mt-8 divide-y rounded-xl border bg-white">
      {data?.length ? data.map((n) => <div key={n.id} className="flex items-center justify-between gap-4 p-4 text-sm">
        <p className={n.read_at ? "text-slate-500" : "font-medium"}>{n.message}<span className="ml-2 text-xs text-slate-400">{new Date(n.created_at).toLocaleString("en-GB")}</span></p>
        {!n.read_at && <form action={markNotificationReadAction}><input type="hidden" name="id" value={n.id} /><button className="text-blue-700">Mark read</button></form>}
      </div>) : <p className="p-4 text-slate-500">Nothing needs your attention. The daily sweep will post here when something changes.</p>}
    </div>
  </>;
}
