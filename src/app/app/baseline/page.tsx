import styles from "./baseline.module.css";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { z } from "zod";
import { requireAppContext } from "@/lib/app-context";
import { Card, PageIntro } from "@/components/ui";
import { baselinePayloadSchema } from "@/features/baselines/domain/summary";
import { BaselineForm } from "./baseline-form";
import { BaselineReport, formatBaselineDate } from "./baseline-report";

export default async function BaselinePage({ searchParams }: { searchParams: Promise<{ snapshot?: string }> }) {
  const { supabase, organisation, membership } = await requireAppContext();
  const { snapshot } = await searchParams;
  const operator = membership.role === "owner" || membership.role === "admin";
  if (snapshot && !z.uuid().safeParse(snapshot).success) return <Card style={{ padding: "20px" }}>This baseline reference is invalid. <Link href="/app/baseline">Open the latest baseline</Link></Card>;
  let snapshotQuery = supabase.from("baseline_snapshots").select("id,payload,progress_revision").eq("organisation_id", organisation.id);
  if (snapshot) snapshotQuery = snapshotQuery.eq("id", snapshot);
  const [saved, history, draft, assessments] = await Promise.all([
    snapshotQuery.order("progress_revision", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("baseline_snapshots").select("id,saved_at,progress_revision").eq("organisation_id", organisation.id).order("progress_revision", { ascending: false }).limit(20),
    operator ? supabase.from("baseline_progress").select("objective,assessment_id,revision,updated_at").eq("organisation_id", organisation.id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    operator ? supabase.from("assessment_sessions").select("id,title").eq("organisation_id", organisation.id).order("updated_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
  ]);
  if (saved.error || history.error || draft.error || assessments.error) throw new Error("Could not load the saved baseline.");
  const payload = saved.data ? baselinePayloadSchema.parse(saved.data.payload) : null;
  const predecessor = saved.data ? await supabase.from("baseline_snapshots").select("payload").eq("organisation_id", organisation.id).lt("progress_revision", saved.data.progress_revision).order("progress_revision", { ascending: false }).limit(1).maybeSingle() : { data: null, error: null };
  if (predecessor.error) throw new Error("Could not load the previous baseline.");
  const previous = predecessor.data ? baselinePayloadSchema.parse(predecessor.data.payload) : null;
  return <div className={styles.page}>
    <PageIntro eyebrow={organisation.name.toUpperCase()} title="Baseline" body="Resume the team's starting position and review a dated explanation of the work, decisions and evidence still needed." />
    {operator && <Card style={{ padding: "20px", marginBottom: "16px" }}>
      <h3>Continue your baseline</h3>
      <p>{draft.data ? `Progress last saved ${formatBaselineDate(draft.data.updated_at)}.` : "Start with the objective. You can save a partial baseline before every answer is available."}</p>
      <p><Link href="/app/scope">Review scope</Link> · <Link href="/app/assessment">Continue assessment</Link> · <Link href="/app/tasks">Assign or review work</Link></p>
      <BaselineForm objective={draft.data?.objective ?? ""} assessmentId={draft.data?.assessment_id ?? null} revision={draft.data?.revision ?? 0} requestId={randomUUID()} assessments={assessments.data ?? []} />
    </Card>}
    {payload && payload.calculationVersion === 1 ? <BaselineReport payload={payload} previous={previous} operator={operator} /> : <Card style={{ padding: "20px" }}><h3>{payload ? "Baseline calculation version unavailable" : snapshot ? "Baseline not found" : "No dated baseline saved yet"}</h3><p>{payload ? "This saved record needs a compatible reader before its explanation can be shown." : operator ? "Save a dated baseline to capture the starting position and its evidence limitations." : "A workspace coordinator needs to save a dated baseline before you can review it here."}</p></Card>}
    {history.data && history.data.length > 0 && <Card style={{ padding: "20px", marginTop: "16px" }}><h3>Saved baseline history</h3><p>Most recent 20 saves. Each dated link preserves its original content.</p><ul>{history.data.map((item) => <li key={item.id}><Link href={`/app/baseline?snapshot=${item.id}`} aria-current={item.id === saved.data?.id ? "page" : undefined}>Baseline saved {formatBaselineDate(item.saved_at)} · revision {item.progress_revision}</Link></li>)}</ul></Card>}
  </div>;
}
