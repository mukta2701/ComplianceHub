import { redirect } from "next/navigation";
import { requireAppContext } from "@/lib/app-context";
import Link from "next/link";
import { Card, PageIntro } from "@/components/ui";
import { one } from "@/lib/supabase/one";
import { TaskForm } from "../task-form";
import styles from "../task-form.module.css";

export default async function NewTaskPage() {
  const { supabase, organisation, membership } = await requireAppContext();
  if (membership.role === "member") redirect("/app/tasks");
  const [membersResult, controlsResult, risksResult] = await Promise.all([
    supabase.from("memberships").select("user_id,profiles(display_name)").eq("organisation_id", organisation.id),
    supabase.from("controls").select("id,code,title").order("position"),
    supabase.from("risks").select("id,reference,title").eq("organisation_id", organisation.id).neq("status", "closed").order("reference"),
  ]);
  if (membersResult.error || controlsResult.error || risksResult.error) throw new Error("Could not load task choices. Reload and try again.");
  const members = membersResult.data ?? [];
  const controls = controlsResult.data ?? [];
  const risks = risksResult.data ?? [];
  return <>
    <Link href="/app/tasks" className={styles.pageBack}><span aria-hidden="true">←</span> Back to work queue</Link>
    <div className={styles.introGrid}>
      <PageIntro eyebrow="ACCOUNTABLE WORK" title="Create a task" body="Assign clear security and compliance work, with the context needed for review." />
      <Card className={styles.guidance}><h2>A good task is reviewable</h2><ul><li>Name the outcome</li><li>Choose an accountable owner</li><li>Record what proves completion</li></ul></Card>
    </div>
    <TaskForm mode="create" values={{ title: "", detail: "", ownerId: "", dueOn: "", recurrence: "", controlId: "", riskId: "" }}
      options={{ members: members.map((item) => { const profile = one(item.profiles); return { id: item.user_id, label: profile?.display_name ?? item.user_id }; }), controls: controls.map((item) => ({ id: item.id, label: `${item.code}: ${item.title}` })), risks: risks.map((item) => ({ id: item.id, label: `${item.reference}: ${item.title}` })) }} cancelHref="/app/tasks" />
  </>;
}
