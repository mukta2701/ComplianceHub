import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { Card, PageIntro } from "@/components/ui";
import { one } from "@/lib/supabase/one";
import { TaskForm } from "../../task-form";
import styles from "../../task-form.module.css";

export default async function EditTaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, organisation, membership } = await requireAppContext();
  if (membership.role === "member") redirect(`/app/tasks/${id}`);
  const { data: task, error: taskError } = await supabase.from("tasks").select("id,title,detail,status,due_on,recurrence,owner_id,control_id,risk_id,updated_at").eq("id", id).eq("organisation_id", organisation.id).maybeSingle();
  if (taskError) throw new Error("Could not load task");
  if (!task) notFound();
  const [membersResult, controlsResult, risksResult, selectedMemberResult, selectedControlResult, selectedRiskResult] = await Promise.all([
    supabase.from("memberships").select("user_id,profiles(display_name)").eq("organisation_id", organisation.id),
    supabase.from("controls").select("id,code,title").order("position"),
    supabase.from("risks").select("id,reference,title,status").eq("organisation_id", organisation.id).order("reference"),
    task.owner_id ? supabase.from("memberships").select("user_id,profiles(display_name)").eq("organisation_id", organisation.id).eq("user_id", task.owner_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    task.control_id ? supabase.from("controls").select("id,code,title").eq("id", task.control_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    task.risk_id ? supabase.from("risks").select("id,reference,title,status").eq("id", task.risk_id).eq("organisation_id", organisation.id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (membersResult.error || controlsResult.error || risksResult.error || selectedMemberResult.error || selectedControlResult.error || selectedRiskResult.error) throw new Error("Could not load task choices. Reload and try again.");
  const members = [...(membersResult.data ?? [])];
  if (selectedMemberResult.data && !members.some((item) => item.user_id === selectedMemberResult.data!.user_id)) members.push(selectedMemberResult.data);
  const controls = [...(controlsResult.data ?? [])];
  if (selectedControlResult.data && !controls.some((item) => item.id === selectedControlResult.data!.id)) controls.push(selectedControlResult.data);
  const risks = [...(risksResult.data ?? [])];
  if (selectedRiskResult.data && !risks.some((item) => item.id === selectedRiskResult.data!.id)) risks.push(selectedRiskResult.data);
  return <>
    <Link href={`/app/tasks/${task.id}`} className={styles.pageBack}><span aria-hidden="true">←</span> Back to task</Link>
    <div className={styles.introGrid}>
      <PageIntro eyebrow="ACCOUNTABLE WORK" title="Edit task" body={`Update ${task.title} without changing its completion or verification status.`} />
      <Card className={styles.guidance}><h2>Keep the task reviewable</h2><ul><li>State the expected outcome</li><li>Keep ownership current</li><li>Link the reason for the work</li></ul></Card>
    </div>
    <TaskForm mode="edit" taskId={task.id} expectedUpdatedAt={task.updated_at} cancelHref={`/app/tasks/${task.id}`}
      values={{ title: task.title, detail: task.detail ?? "", ownerId: task.owner_id ?? "", dueOn: task.due_on ?? "", recurrence: task.recurrence ?? "", controlId: task.control_id ?? "", riskId: task.risk_id ?? "" }}
      options={{ members: members.map((item) => { const profile = one(item.profiles); return { id: item.user_id, label: profile?.display_name ?? item.user_id }; }), controls: controls.map((item) => ({ id: item.id, label: `${item.code}: ${item.title}` })), risks: risks.map((item) => ({ id: item.id, label: `${item.reference}: ${item.title}` })) }} />
  </>;
}
