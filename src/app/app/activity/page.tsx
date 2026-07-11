import { requireAppContext } from "@/lib/app-context";
import { Card, PageIntro, Pill } from "@/components/ui";
import { SubTabs } from "@/components/sub-tabs";
import { one } from "@/lib/supabase/one";

export default async function ActivityPage() {
  const { supabase } = await requireAppContext();
  const { data } = await supabase.from("audit_events").select("id,action,entity_type,occurred_at,profiles(display_name)").order("occurred_at", { ascending: false }).limit(300);

  // Collapse consecutive same-second, same-actor, same-action events (e.g.
  // generating a 93-control SoA in one go) into a single counted row, so the
  // trail reads as human activity rather than a wall of identical entries.
  type Group = { id: string; action: string; entity: string; actor: string; occurred_at: string; sec: string; count: number };
  const groups: Group[] = [];
  for (const event of data ?? []) {
    const actor = one(event.profiles)?.display_name ?? "System";
    const sec = new Date(event.occurred_at).toISOString().slice(0, 19);
    const last = groups[groups.length - 1];
    if (last && last.action === event.action && last.entity === event.entity_type && last.actor === actor && last.sec === sec) last.count += 1;
    else groups.push({ id: event.id, action: event.action, entity: event.entity_type, actor, occurred_at: event.occurred_at, sec, count: 1 });
  }

  return <>
    <PageIntro eyebrow="AUDIT" title="Audit activity" body="Append-only record of important tenant changes." />
    <SubTabs tabs={[{ href: "/app/audits", label: "Internal audits" }, { href: "/app/activity", label: "Audit trail" }]} />
    <Card>{groups.length
      ? groups.map((g) => <div style={{ padding: "14px 18px", borderTop: "1px solid #edf0f4", fontSize: "13px", display: "flex", alignItems: "center", gap: "8px" }} key={g.id}>
          <b style={{ textTransform: "capitalize" }}>{g.action}</b>
          <span style={{ textTransform: "capitalize" }}>{g.entity.replaceAll("_", " ")}</span>
          {g.count > 1 && <Pill tone="neutral">×{g.count}</Pill>}
          <span style={{ marginLeft: "auto", color: "#596273" }}>{g.actor} · {new Date(g.occurred_at).toLocaleString("en-GB")}</span>
        </div>)
      : <p style={{ padding: "20px", color: "#596273" }}>No recorded activity yet.</p>}</Card>
  </>;
}
