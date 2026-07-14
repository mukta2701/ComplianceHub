import { requireAppContext } from "@/lib/app-context";
import { Card, PageIntro, Pill } from "@/components/ui";
import { Icon } from "@/components/icons";
import { markAllNotificationsReadAction, markNotificationReadAction } from "./actions";

const KIND_ICON: Record<string, string> = { evidence_expiry: "file", task_overdue: "check", assessment: "clipboard", risk: "alert", system: "bell", policy_violation: "alert", control_drift: "activity" };

export default async function NotificationsPage() {
  const { supabase, organisation } = await requireAppContext();
  const { data } = await supabase.from("notifications").select("id,kind,message,read_at,created_at").eq("organisation_id", organisation.id).order("created_at", { ascending: false }).limit(100);
  const unread = data?.filter((n) => !n.read_at) ?? [];
  return <>
    <PageIntro eyebrow="NOTIFICATIONS" title="Notifications" body="Updates appear here automatically when evidence expires or work falls overdue." action={unread.length > 0 ? <form action={markAllNotificationsReadAction}><button className="button secondary">Mark all read</button></form> : undefined} />
    <Card><ul className="notif-list" aria-label="Notifications">
      {data?.length ? data.map((n) => <li key={n.id} data-unread={!n.read_at}>
        <span className="notif-icon"><Icon name={KIND_ICON[n.kind] ?? "bell"} /></span>
        <span className="notif-body"><p>{n.message}{!n.read_at && <> <Pill>Unread</Pill></>}</p><small>{new Date(n.created_at).toLocaleString("en-GB")}</small></span>
        {!n.read_at && <form action={markNotificationReadAction}><input type="hidden" name="id" value={n.id} /><button className="button secondary" style={{ minHeight: "32px", padding: "6px 12px" }} aria-label={`Mark notification read: ${n.message}`}>Mark read</button></form>}
      </li>) : <li className="notif-empty">Nothing needs your attention. Updates will appear here when something changes.</li>}
    </ul></Card>
  </>;
}
