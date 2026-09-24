import Link from "next/link";

import { requireAppContext } from "@/lib/app-context";
import { Card, PageIntro, Pill } from "@/components/ui";
import { Icon } from "@/components/icons";
import { markAllNotificationsReadAction, markNotificationReadAction } from "./actions";

const KIND_ICON: Record<string, string> = { evidence_expiry: "file", task_overdue: "check", assessment: "clipboard", risk: "alert", system: "bell", policy_violation: "alert", control_drift: "activity", github_compliance_failure: "alert", github_compliance_recovery: "check", github_compliance_stale: "activity", github_compliance_sustained_unknown: "activity" };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function githubResultHref(notification: { kind: string; subject_type: string; subject_id: string }): string | null {
  if (!notification.kind.startsWith("github_compliance_")
    || notification.subject_type !== "github_official_compliance_result"
    || !UUID_PATTERN.test(notification.subject_id)) return null;
  return `/app/monitoring/github-results/${notification.subject_id}`;
}

export default async function NotificationsPage() {
  const { supabase, organisation } = await requireAppContext();
  const { data } = await supabase.from("notifications").select("id,kind,message,subject_type,subject_id,read_at,created_at").eq("organisation_id", organisation.id).order("created_at", { ascending: false }).limit(100);
  const unread = data?.filter((n) => !n.read_at) ?? [];
  return <>
    <PageIntro eyebrow="NOTIFICATIONS" title="Notifications" body="Updates appear here when evidence expires, work falls overdue, or a GitHub monitoring check needs attention." action={unread.length > 0 ? <form action={markAllNotificationsReadAction}><button className="button secondary">Mark all read</button></form> : undefined} />
    <Card><ul className="notif-list" aria-label="Notifications">
      {data?.length ? data.map((n) => {
        const resultHref = githubResultHref(n);
        return <li key={n.id} data-unread={!n.read_at}>
          <span className="notif-icon"><Icon name={KIND_ICON[n.kind] ?? "bell"} /></span>
          <span className="notif-body"><p>{n.message}{!n.read_at && <> <Pill>Unread</Pill></>}</p>{resultHref && <Link className="notif-record-link" href={resultHref}>Open GitHub result</Link>}<small>{new Date(n.created_at).toLocaleString("en-GB")}</small></span>
          {!n.read_at && <form action={markNotificationReadAction}><input type="hidden" name="id" value={n.id} /><button className="button secondary" style={{ minHeight: "32px", padding: "6px 12px" }} aria-label={`Mark notification read: ${n.message}`}>Mark read</button></form>}
        </li>;
      }) : <li className="notif-empty">No notifications recorded. Check Tasks and Monitoring for outstanding work; an empty inbox does not mean all checks have passed.</li>}
    </ul></Card>
  </>;
}
