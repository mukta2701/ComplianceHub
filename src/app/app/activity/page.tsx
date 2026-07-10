import { requireAppContext } from "@/lib/app-context";
import { Card, PageIntro } from "@/components/ui";
import { SubTabs } from "@/components/sub-tabs";

export default async function ActivityPage() {
  const { supabase } = await requireAppContext();
  const { data } = await supabase.from("audit_events").select("id,action,entity_type,entity_id,occurred_at,profiles(display_name)").order("occurred_at", { ascending: false }).limit(100);
  return <>
    <PageIntro eyebrow="AUDIT" title="Audit activity" body="Append-only record of important tenant changes." />
    <SubTabs tabs={[{ href: "/app/audits", label: "Internal audits" }, { href: "/app/activity", label: "Audit trail" }]} />
    <Card>{data?.length ? data.map((e) => { const profile = Array.isArray(e.profiles) ? e.profiles[0] : e.profiles; return <div style={{ padding: "14px 18px", borderTop: "1px solid #edf0f4", fontSize: "13px" }} key={e.id}><b style={{ textTransform: "capitalize" }}>{e.action}</b> {e.entity_type.replaceAll("_", " ")} <code style={{ fontSize: "11px", color: "var(--blue)" }}>{e.entity_id}</code><span style={{ float: "right", color: "#596273" }}>{profile?.display_name ?? "System"} · {new Date(e.occurred_at).toLocaleString("en-GB")}</span></div>; }) : <p style={{ padding: "20px", color: "#596273" }}>No recorded activity yet.</p>}</Card>
  </>;
}
